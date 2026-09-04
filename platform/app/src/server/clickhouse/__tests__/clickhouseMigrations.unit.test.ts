import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ClickHouse migrations", () => {
  /** @scenario Retention schema migration versions are unique */
  it("uses unique numeric migration versions", () => {
    const migrationDir = resolve(
      process.cwd(),
      "src/server/clickhouse/migrations",
    );
    const versions = readdirSync(migrationDir)
      .map((file) => file.match(/^(\d+)_.*\.sql$/)?.[1])
      .filter((version): version is string => version != null);

    const duplicates = versions.filter(
      (version, index) => versions.indexOf(version) !== index,
    );

    expect(duplicates).toEqual([]);
  });

  /** 验证迁移兼容不支持 renameat2 的老内核。 */
  it("不在迁移中使用 EXCHANGE TABLES（renameat2 需要 Linux 3.15+ 内核）", () => {
    // EXCHANGE TABLES 依赖 renameat2(RENAME_EXCHANGE) 系统调用，在 3.10 内核
    // （如 CentOS 7）上 ClickHouse 报 Code 48 NOT_IMPLEMENTED，迁移会在启动时
    // 直接失败。用「让位 + 换入」的单条 RENAME 语句代替（参考 00058）。
    // 只扫描非注释行，允许注释里提及 EXCHANGE 以记录替代理由。
    const migrationDir = resolve(
      process.cwd(),
      "src/server/clickhouse/migrations",
    );
    const offenders = readdirSync(migrationDir)
      .filter((file) => file.endsWith(".sql"))
      .flatMap((file) => {
        const lines = readFileSync(resolve(migrationDir, file), "utf8").split(
          "\n",
        );
        return lines
          .map((line, index) => ({ line, lineNumber: index + 1 }))
          .filter(
            ({ line }) =>
              !line.trimStart().startsWith("--") &&
              /\bEXCHANGE\s+TABLES\b/i.test(line),
          )
          .map(({ lineNumber }) => `${file}:${lineNumber}`);
      });

    expect(offenders).toEqual([]);
  });
  /** @scenario The pulled-cost exclusion changes the budget rollup in place */
  it("changes the budget rollup view without dropping its trigger", () => {
    // A materialised view is an insert trigger. Between a DROP and the
    // following CREATE there is no trigger, ClickHouse does not replay the
    // inserts made in that window, and this migration has no delta replay —
    // so a successful debit landing in the gap is absent from
    // gateway_budget_scope_totals permanently. Enforcement sums that rollup
    // (getSpendForBudgets* reads sumMerge(SpendNanoUSD)), so the missing money
    // reads as headroom and a budget authorises a request it should refuse.
    // MODIFY QUERY swaps the SELECT with the trigger never absent.
    //
    // This is a static read of the migration text and nothing more: it does not
    // run the migration, write a debit, or consult an enforcement decision. It
    // pins the mechanism the reasoning above depends on. Proving that a debit
    // written mid-rollout still reaches a budget needs a live ClickHouse, next
    // to "Pulled cost never blocks spending" in pulledUsageLedger.integration.
    const sql = readFileSync(
      resolve(
        process.cwd(),
        "src/server/clickhouse/migrations",
        "00082_gateway_budget_scope_totals_exclude_pulled.sql",
      ),
      "utf8",
    );
    const executed = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    expect(executed).toContain("MODIFY QUERY");
    expect(executed).not.toMatch(
      // DROP TABLE drops a materialised view too and leaves the same gap;
      // matching only DROP VIEW waved a reopened hole through (verified: the
      // VIEW-only pattern passed a file carrying a stray DROP TABLE of this mv).
      // Scoped to one statement so an unrelated later DROP cannot trip it.
      /DROP\s+(?:VIEW|TABLE)[^;]*gateway_budget_scope_totals_mv/i,
    );
    // The filter this migration exists to add must survive the rewrite.
    expect(executed).toContain("Scope != 'pulled'");
    // 00070's money column: a view that omits it writes an empty aggregate and
    // every calendar-window budget silently reads zero.
    expect(executed).toContain("sumState(AmountNanoUSD)");
  });
});

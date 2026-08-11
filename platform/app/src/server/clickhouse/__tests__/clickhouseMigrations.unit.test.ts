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

  /** @scenario 迁移不使用 EXCHANGE TABLES（老内核兼容） */
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
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";

const workflow = readFileSync(
  new URL("../workflows/langwatch-app-ci.yml", import.meta.url),
  "utf8",
);

function draftStep(lane: string): string {
  const lines = workflow.split("\n");
  const id = lines.indexOf(`        id: ${lane}-tests`);
  assert.ok(id >= 0, `缺少 ${lane} 测试步骤`);
  const start = lines.indexOf("        run: |", id);
  assert.ok(start > id, `缺少 ${lane} 测试脚本`);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  const values: Record<string, string> = {
    "needs.changes.outputs.heavy": "false",
    "needs.changes.outputs.coverage": "false",
    "needs.changes.outputs.durations": "false",
    "needs.changes.outputs.unit-shard-count": "1",
    "needs.changes.outputs.component-shard-count": "1",
    "matrix.shard": "1",
    "matrix.count": "1",
  };
  return body.join("\n").replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, key: string) => {
    assert.ok(Object.hasOwn(values, key), `未知工作流表达式：${key}`);
    return values[key]!;
  });
}

function runDraft({
  t,
  lane,
  base,
  changed = true,
  exitCode = 0,
}: {
  t: TestContext;
  lane: string;
  base: string;
  changed?: boolean;
  exitCode?: number;
}) {
  const root = mkdtempSync(join(tmpdir(), "draft-test-base-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "platform/app"), { recursive: true });
  mkdirSync(join(root, ".github/scripts"), { recursive: true });
  mkdirSync(join(root, "bin"));
  copyFileSync(
    new URL("./vitest-changed-files.sh", import.meta.url),
    join(root, ".github/scripts/vitest-changed-files.sh"),
  );
  // 执行真实工作流脚本和变更检测脚本，仅替换外部 Git 与测试进程。
  writeFileSync(
    join(root, "bin/git"),
    `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "fetch") {
  fs.writeFileSync(process.env.FETCH_LOG, JSON.stringify(args));
} else if (args[0] === "rev-parse") {
  console.log(process.env.FIXTURE_ROOT);
} else if (args[0] === "diff" && args[1] === "--name-only") {
  if (args[2] === "origin/" + process.env.GITHUB_BASE_REF + "...HEAD") {
    if (process.env.HAS_CHANGES === "true") console.log("platform/app/current.ts");
  } else {
    console.log("platform/app/parent-upgrade.ts");
  }
}
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(root, "bin/pnpm"),
    `#!${process.execPath}
require("node:fs").writeFileSync(process.env.TEST_LOG, JSON.stringify(process.argv.slice(2)));
process.exit(Number(process.env.TEST_EXIT_CODE));
`,
    { mode: 0o755 },
  );
  const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", draftStep(lane)], {
    cwd: join(root, "platform/app"),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(root, "bin")}:${process.env.PATH}`,
      GITHUB_REF: "refs/pull/59/merge",
      GITHUB_BASE_REF: base,
      FIXTURE_ROOT: root,
      FETCH_LOG: join(root, "fetch.json"),
      TEST_LOG: join(root, "test.json"),
      HAS_CHANGES: String(changed),
      TEST_EXIT_CODE: String(exitCode),
    },
  });
  assert.equal(result.error, undefined);
  const fetchArgs: string[] = JSON.parse(
    readFileSync(join(root, "fetch.json"), "utf8"),
  );
  const testArgs: string[] | null = existsSync(join(root, "test.json"))
    ? JSON.parse(readFileSync(join(root, "test.json"), "utf8"))
    : null;
  return { result, fetchArgs, testArgs };
}

for (const lane of ["unit", "component", "integration"]) {
  describe(`当执行 ${lane} 草稿步骤时`, () => {
    for (const base of ["main", "release/langwatch-3.20.1"]) {
      /** @scenario "草稿测试统一使用实际目标分支" */
      it(`以 ${base} 获取历史并选择测试`, (t) => {
        const { result, fetchArgs, testArgs } = runDraft({ t, lane, base });
        assert.equal(result.status, 0, result.stderr);
        assert.ok(fetchArgs.includes("--unshallow"));
        assert.ok(fetchArgs.includes("refs/pull/59/merge"));
        assert.ok(
          fetchArgs.includes(`+refs/heads/${base}:refs/remotes/origin/${base}`),
        );
        assert.ok(testArgs);
        assert.equal(testArgs[0], `test:${lane}`);
        assert.equal(testArgs[testArgs.indexOf("--changed") + 1], `origin/${base}`);
      });

      /** @scenario "草稿相对目标分支无变更时不启动测试" */
      it(`相对 ${base} 无变更时不启动测试`, (t) => {
        const { result, testArgs } = runDraft({ t, lane, base, changed: false });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(testArgs, null);
      });
    }

    /** @scenario "草稿测试失败时工作流仍失败" */
    it("传播测试进程的失败状态", (t) => {
      const { result } = runDraft({
        t,
        lane,
        base: "release/langwatch-3.20.1",
        exitCode: 23,
      });
      assert.equal(result.status, 23);
    });
  });
}

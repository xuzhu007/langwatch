import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";

const workflow = readFileSync(
  new URL("../workflows/langwatch-app-ci.yml", import.meta.url),
  "utf8",
);

function scriptFor(id: string, values: Record<string, string>): string {
  const lines = workflow.split("\n");
  const step = lines.indexOf(`        id: ${id}`);
  assert.ok(step >= 0, `Missing workflow step ${id}`);
  const start = lines.indexOf("        run: |", step);
  assert.ok(start > step);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n").replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, key: string) => {
    assert.ok(Object.hasOwn(values, key), `Unknown workflow expression ${key}`);
    return values[key]!;
  });
}

function runScope(t: TestContext, base: string, nxExit = 0) {
  const root = mkdtempSync(join(tmpdir(), "langwatch-ci-base-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "bin"));
  writeFileSync(
    join(root, "bin/git"),
    `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(["git", ...args])+"\\n");
if (args[0] === "diff") console.log("modules/trace/browser/src/example.ts");
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(root, "bin/pnpm"),
    `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(process.env.CALLS, JSON.stringify(["pnpm", ...process.argv.slice(2)])+"\\n");
if (Number(process.env.NX_EXIT)) process.exit(Number(process.env.NX_EXIT));
console.log(JSON.stringify(["@langwatch/ui"]));
`,
    { mode: 0o755 },
  );
  const result = spawnSync(
    "bash",
    [
      "-e",
      "-c",
      scriptFor("pick", {
        "github.event_name": "pull_request",
        "github.event.pull_request.base.sha": base,
      }),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        CALLS: join(root, "calls"),
        GITHUB_OUTPUT: join(root, "output"),
        GITHUB_STEP_SUMMARY: join(root, "summary"),
        APPLY: "true",
        ALL: '["platform-api","worker","ui"]',
        NX_EXIT: String(nxExit),
      },
    },
  );
  if (result.status !== 0) {
    const guard = spawnSync(
      "bash",
      ["-e", "-c", scriptFor("guard", { "steps.pick.outputs.apps": "" })],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_OUTPUT: join(root, "output"),
          GITHUB_STEP_SUMMARY: join(root, "summary"),
        },
      },
    );
    assert.equal(guard.status, 0, guard.stderr);
  }
  const calls: string[][] = readFileSync(join(root, "calls"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  return { result, calls, output: readFileSync(join(root, "output"), "utf8") };
}

describe("upstream synchronization CI", () => {
  for (const base of ["main-base-sha", "stacked-upgrade-base-sha"]) {
    /** @scenario "Git 和 Nx 使用相同的 PR 目标 SHA" */
    it(`uses the actual PR target commit for Git and Nx (${base})`, (t) => {
      const { result, calls, output } = runScope(t, base);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(calls.some((call) => call.join(" ") === `git diff --name-only ${base} HEAD`));
      assert.ok(calls.some((call) => call[0] === "pnpm" && call.includes(`--base=${base}`)));
      assert.match(output, /apps=\["ui"\]/);
    });
  }

  /** @scenario "范围检测失败时构建所有应用" */
  it("falls back to every application if affected-project detection fails", (t) => {
    const { result, output } = runScope(t, "stacked-upgrade-base-sha", 23);
    assert.equal(result.status, 23, result.stderr);
    assert.match(output, /apps=\["platform-api","worker","ui"\]/);
  });

  /** @scenario "上游同步草稿执行完整验证" */
  it("keeps upstream-sync draft PRs on the full test lane", () => {
    const heavy = workflow.split("\n").find((line) => line.trimStart().startsWith("heavy:"));
    assert.ok(
      heavy?.includes("contains(github.event.pull_request.labels.*.name, 'upstream-sync')"),
    );
    assert.match(workflow, /BASE="\$\{\{ github.event.pull_request.base.sha \}\}"/);
  });
});

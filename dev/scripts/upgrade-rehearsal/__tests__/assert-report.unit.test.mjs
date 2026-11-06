import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertReport } from "../assert-report.mjs";

function evidence(origin = "main") {
  const ids =
    origin === "empty"
      ? ["NO-OP"]
      : ["R01", "R02", "F-1", "Q09", "TARGETS", "ROLLBACK", "REUPGRADE", "NO-OP", "SPANS"];
  return {
    report: { run: { origin }, findings: ids.map((id) => ({ id, verdict: "not-reproduced" })) },
    steps: [{ id: "schema", status: "done" }],
    migrateExit: 0,
  };
}

void describe("upgrade report gate", () => {
  /** @scenario "Only completed rehearsal evidence permits packaging an upgrade image" */
  void it("accepts a completed fork upgrade and a completed empty install", () => {
    assert.doesNotThrow(() => assertReport(evidence()));
    assert.doesNotThrow(() => assertReport(evidence("empty")));
  });

  /** @scenario "Only completed rehearsal evidence permits packaging an upgrade image" */
  void it("rejects failed migrations, an empty ledger and unfinished steps", () => {
    assert.throws(() => assertReport({ ...evidence(), migrateExit: 1 }));
    assert.throws(() => assertReport({ ...evidence(), steps: [] }));
    for (const status of ["pending", "running", "failed", "blocked"]) {
      assert.throws(() => assertReport({ ...evidence(), steps: [{ id: "schema", status }] }));
    }
  });

  /** @scenario "Only completed rehearsal evidence permits packaging an upgrade image" */
  void it("rejects missing, inconclusive or failed rollback evidence", () => {
    for (const verdict of ["inconclusive", "reproduced"]) {
      const input = evidence();
      input.report.findings.find((entry) => entry.id === "ROLLBACK").verdict = verdict;
      assert.throws(() => assertReport(input), /ROLLBACK/);
    }
    const input = evidence();
    input.report.findings = input.report.findings.filter((entry) => entry.id !== "ROLLBACK");
    assert.throws(() => assertReport(input), /ROLLBACK/);
  });

  /** @scenario "Only completed rehearsal evidence permits packaging an upgrade image" */
  void it("rejects a reproduced product loss even when the required upgrade checks pass", () => {
    const input = evidence();
    input.report.findings.push({ id: "SEED-dataset", verdict: "reproduced" });
    assert.throws(() => assertReport(input), /SEED-dataset/);
  });
});

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** A report is evidence only when the exercised upgrade paths actually completed. */
export function assertReport({ report, steps, migrateExit }) {
  if (!["main", "empty"].includes(report.run?.origin)) {
    throw new Error("Expected an actual fork-main upgrade or an empty install");
  }
  if (migrateExit !== 0 || !Array.isArray(steps) || steps.length === 0) {
    throw new Error("The upgrade did not produce a successful, nonempty ledger");
  }
  const open = steps.filter((step) => !["done", "not-needed"].includes(step.status));
  if (open.length)
    throw new Error(`Unsettled upgrade steps: ${open.map((step) => step.id).join(", ")}`);
  const required =
    report.run.origin === "empty"
      ? ["NO-OP"]
      : ["R01", "R02", "F-1", "Q09", "TARGETS", "ROLLBACK", "REUPGRADE", "NO-OP", "SPANS"];
  for (const id of required) {
    const finding = report.findings.find((entry) => entry.id === id);
    if (!finding || !["not-reproduced", "settled"].includes(finding.verdict)) {
      throw new Error(`${id} did not pass: ${finding?.detail ?? "missing evidence"}`);
    }
  }
  const applicable =
    report.run.origin === "empty"
      ? report.findings.filter((entry) => required.includes(entry.id))
      : report.findings;
  const failures = applicable.filter((entry) => entry.verdict === "reproduced");
  if (failures.length)
    throw new Error(`Rehearsal failures: ${failures.map((entry) => entry.id).join(", ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2];
  if (!directory) throw new Error("usage: assert-report.mjs <run-directory>");
  const json = (name) => JSON.parse(readFileSync(join(directory, name), "utf8"));
  assertReport({
    report: json("report.json"),
    steps: json("evidence/ledger-steps-noop-after.json"),
    migrateExit: Number(readFileSync(join(directory, "evidence/head-migrate.exit"), "utf8").trim()),
  });
  process.stdout.write("Upgrade report and final ledger passed\n");
}

// specs/upgrade/upgrade-rehearsal.feature: the seed's OTLP traces.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { otlpBatch, previousMonth } from "../otlp-batch.mjs";

const startMonths = (batch) =>
  batch.resourceSpans[0].scopeSpans[0].spans
    .filter((span) => !span.parentSpanId)
    .map((span) => new Date(Number(BigInt(span.startTimeUnixNano) / 1_000_000n)).getUTCMonth());

void describe("an OTLP batch for a project", () => {
  /** @scenario "Historical seeds remain inside the public collector ingestion window" */
  void it("keeps historical spans inside 31 days even after a 31-day month", () => {
    for (const at of ["2026-11-06T02:00:00Z", "2026-03-31T23:59:00Z", "2027-01-15T08:00:00Z"]) {
      const spans = otlpBatch({ service: "s", count: 4, at }).resourceSpans[0].scopeSpans[0].spans;
      for (const span of spans) {
        const age = Date.parse(at) - Number(BigInt(span.startTimeUnixNano) / 1_000_000n);
        assert.ok(age > 0 && age < 31 * 24 * 60 * 60 * 1000);
      }
    }
  });

  /** @scenario "The seeded traces span the current and the previous month" */
  void it("puts half the traces in the month and half in the month before, under the project's service", () => {
    const batch = otlpBatch({ service: "rehearsal-sk-lw-x", count: 4, at: "2026-10-08T12:00:00Z" });
    const months = startMonths(batch);
    assert.deepEqual(months.toSorted(), [8, 8, 9, 9]);
    const resource = batch.resourceSpans[0].resource.attributes;
    assert.deepEqual(resource, [
      { key: "service.name", value: { stringValue: "rehearsal-sk-lw-x" } },
    ]);
    for (const span of batch.resourceSpans[0].scopeSpans[0].spans) {
      assert.match(span.traceId, /^[0-9a-f]{32}$/);
    }
  });

  void it("gives each trace a root and a child that share its trace id", () => {
    const spans = otlpBatch({ service: "s", count: 1, at: "2026-10-08T12:00:00Z" }).resourceSpans[0]
      .scopeSpans[0].spans;
    assert.equal(spans.length, 2);
    assert.equal(spans[1].traceId, spans[0].traceId);
    assert.equal(spans[1].parentSpanId, spans[0].spanId);
  });
});

void describe("the month before", () => {
  void it("clamps the 31st to the shorter month's last day", () => {
    assert.equal(
      previousMonth({ at: "2026-03-31T00:00:00Z" }).toISOString(),
      "2026-02-28T00:00:00.000Z",
    );
  });

  void it("crosses the year boundary", () => {
    assert.equal(
      previousMonth({ at: "2026-01-15T08:00:00Z" }).toISOString(),
      "2025-12-15T08:00:00.000Z",
    );
  });
});

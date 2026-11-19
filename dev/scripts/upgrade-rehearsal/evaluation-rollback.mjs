// Uses the same project and trace on both images, through their public ingest and read paths.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import { createWire } from "../migration-compat-smoke/smoke.mjs";
import { otlpBatch } from "./otlp-batch.mjs";

const [mode, fixturePath] = process.argv.slice(2);
const { context } = JSON.parse(readFileSync(process.env.SEEDS, "utf8"));
const wire = createWire({
  appBase: process.env.APP_BASE,
  origin: process.env.APP_ORIGIN,
  format: "plain",
  fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }),
});
await wire.signIn({ email: process.env.SEED_EMAIL, password: process.env.SEED_PASSWORD });
const apiKey = await wire.projectKey({
  organizationId: context.organizationId,
  projectId: context.projectId,
});

async function ingest(body) {
  await wire.rest({ method: "POST", path: "/api/otel/v1/traces", apiKey, body });
}

async function waitForTrace({ traceId, test, expectation }) {
  const deadline = Date.now() + 90_000;
  let observed = "the trace did not appear";
  while (Date.now() < deadline) {
    try {
      const trace = await wire.rest({
        method: "GET",
        path: `/api/v1/traces/${traceId}?format=json`,
        apiKey,
      });
      if (test(trace)) return;
      observed = `read ${trace.spans?.length ?? 0} spans and ${trace.evaluations?.length ?? 0} evaluations`;
    } catch (error) {
      observed = error.message;
    }
    await delay(2_000);
  }
  throw new Error(`Timed out waiting for ${expectation}: ${observed}`);
}

function checkEvaluation(trace, evaluationId) {
  return trace.evaluations?.some(
    (evaluation) => evaluation.evaluation_id === evaluationId && evaluation.status === "processed",
  );
}

if (mode === "record") {
  const sample = otlpBatch({ service: "upgrade-evaluation-rollback", count: 1, at: new Date() });
  const [root] = sample.resourceSpans[0].scopeSpans[0].spans;
  const evaluationId = `rehearsal-${root.traceId}`;
  const fixture = {
    traceId: root.traceId,
    rootSpanId: root.spanId,
    evaluationId,
    projectId: context.projectId,
  };
  await ingest(sample);
  await waitForTrace({
    traceId: fixture.traceId,
    test: (trace) => trace.spans?.length === 2,
    expectation: "the candidate's two ingested spans",
  });
  const result = await wire.rest({
    method: "POST",
    path: "/api/v1/evaluations/langwatch/api_keys_and_secrets_detection/evaluate",
    apiKey,
    body: {
      trace_id: fixture.traceId,
      evaluation_id: evaluationId,
      data: { input: "This is a test trace.", output: "The response is public test data." },
    },
  });
  assert.equal(result.status, "processed");
  assert.equal(result.passed, true);
  await waitForTrace({
    traceId: fixture.traceId,
    test: (trace) => checkEvaluation(trace, evaluationId),
    expectation: "the candidate's evaluation on its trace",
  });
  writeFileSync(fixturePath, JSON.stringify(fixture));
} else if (mode === "append" || mode === "check") {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (mode === "append") {
    const sample = otlpBatch({ service: "upgrade-evaluation-rollback", count: 1, at: new Date() });
    const scope = sample.resourceSpans[0].scopeSpans[0];
    const appended = scope.spans[0];
    appended.traceId = fixture.traceId;
    appended.parentSpanId = fixture.rootSpanId;
    scope.spans = [appended];
    fixture.appendedSpanId = appended.spanId;
    writeFileSync(fixturePath, JSON.stringify(fixture));
    await ingest(sample);
  }
  assert.ok(fixture.appendedSpanId, "the rollback did not append a span");
  await waitForTrace({
    traceId: fixture.traceId,
    test: (trace) =>
      checkEvaluation(trace, fixture.evaluationId) &&
      trace.spans?.some((span) => span.span_id === fixture.appendedSpanId),
    expectation: "the candidate evaluation and the span written by the rollback image",
  });
} else {
  throw new Error(`Unknown evaluation rollback mode: ${mode}`);
}

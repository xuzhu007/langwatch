import { describe, expect, it } from "vitest";
import type { Trace } from "~/server/tracer/types";
import { traceBatching } from "../traces/traceBatching";

const makeTrace = (traceId: string) =>
  ({
    trace_id: traceId,
  }) as Trace;

describe("AddDatasetRecordDrawer trace 查询", () => {
  it("将 100 个 trace ID 拆成 URL 安全的批次", () => {
    const traceIds = Array.from(
      { length: 100 },
      (_, index) => `trace-${index}`,
    );

    const chunks = traceBatching.chunkTraceIds(traceIds);

    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.length)).toEqual([50, 50]);
    expect(chunks.flat()).toEqual(traceIds);
  });

  it("合并批次时忽略未返回和无效的 trace", () => {
    const traceIds = ["trace-1", "trace-missing", "trace-2"];

    const traces = traceBatching.mergeTraceBatches(traceIds, [
      [makeTrace("trace-2"), undefined],
      [makeTrace("trace-1"), null],
    ]);

    expect(traces.map((trace) => trace.trace_id)).toEqual([
      "trace-1",
      "trace-2",
    ]);
  });
});

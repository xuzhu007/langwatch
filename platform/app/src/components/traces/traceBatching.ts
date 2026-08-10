import type { Trace } from "~/server/tracer/types";

const TRACE_QUERY_CHUNK_SIZE = 50;

export const traceBatching = {
  chunkTraceIds(traceIds: string[]): string[][] {
    const chunks: string[][] = [];
    for (
      let index = 0;
      index < traceIds.length;
      index += TRACE_QUERY_CHUNK_SIZE
    ) {
      chunks.push(traceIds.slice(index, index + TRACE_QUERY_CHUNK_SIZE));
    }
    return chunks;
  },

  mergeTraceBatches(
    traceIds: string[],
    batches: Array<Array<Trace | null | undefined> | undefined>,
  ): Trace[] {
    const tracesById = new Map<string, Trace>();
    for (const trace of batches.flatMap((batch) => batch ?? [])) {
      if (trace?.trace_id) {
        tracesById.set(trace.trace_id, trace);
      }
    }

    return traceIds.flatMap((traceId) => {
      const trace = tracesById.get(traceId);
      return trace ? [trace] : [];
    });
  },
};

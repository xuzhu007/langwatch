import { useMemo } from "react";

import { api } from "../trace-api.ts";

const CHUNK_SIZE = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function useTracesWithSpansByTraceIds({
  projectId,
  traceIds,
  enabled = true,
  timeRange,
  includeSpans,
  withEditOverlay,
}: {
  projectId: string;
  traceIds: string[];
  enabled?: boolean;
  timeRange?: { from: number; to: number; live?: boolean };
  includeSpans?: boolean;
  withEditOverlay?: boolean;
}) {
  const uniqueTraceIds = useMemo(
    () => Array.from(new Set(traceIds.filter(Boolean))).toSorted(),
    [traceIds],
  );
  const chunks = useMemo(() => chunk(uniqueTraceIds, CHUNK_SIZE), [uniqueTraceIds]);

  const results = api.useQueries((t) =>
    chunks.map((ids) =>
      t.traces.getTracesWithSpans(
        { projectId, traceIds: ids, timeRange, includeSpans, withEditOverlay },
        {
          enabled: enabled && !!projectId,
          refetchOnWindowFocus: false,
        },
      ),
    ),
  );

  const data = useMemo(() => {
    const byId = new Map(
      results
        .flatMap((result) => result.data ?? [])
        .filter((trace) => trace && typeof trace.trace_id === "string")
        .map((trace) => [trace.trace_id, trace]),
    );
    return uniqueTraceIds.flatMap((id) => {
      const trace = byId.get(id);
      return trace ? [trace] : [];
    });
  }, [results, uniqueTraceIds]);

  return {
    data,
    isLoading: results.some((result) => result.isLoading),
    isError: results.some((result) => result.isError),
    error: results.find((result) => result.isError)?.error,
    refetch: async () => {
      await Promise.all(results.map((result) => result.refetch()));
    },
  };
}

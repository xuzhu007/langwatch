import { useMemo } from "react";
import { api } from "~/utils/api";

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
}: {
  projectId: string;
  traceIds: string[];
  enabled?: boolean;
}) {
  const uniqueTraceIds = useMemo(
    () => Array.from(new Set(traceIds)).sort(),
    [traceIds],
  );
  const chunks = useMemo(
    () => chunk(uniqueTraceIds, CHUNK_SIZE),
    [uniqueTraceIds],
  );

  const results = api.useQueries((t) =>
    chunks.map((ids) =>
      t.traces.getTracesWithSpans(
        { projectId, traceIds: ids },
        {
          enabled: enabled && !!projectId,
          refetchOnWindowFocus: false,
        },
      ),
    ),
  );

  const data = useMemo(
    () => results.flatMap((result) => result.data ?? []),
    [results],
  );

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

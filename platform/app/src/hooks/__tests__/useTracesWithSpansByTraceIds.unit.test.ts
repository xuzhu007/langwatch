/** @vitest-environment jsdom */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTracesWithSpansByTraceIds } from "../useTracesWithSpansByTraceIds";

type QueryResult = {
  data?: { trace_id: string }[];
  isLoading: boolean;
  isError: boolean;
  error?: Error;
  refetch: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  captured: [] as {
    input: { projectId: string; traceIds: string[] };
    options: { enabled: boolean };
  }[],
  results: [] as QueryResult[],
}));

vi.mock("~/utils/api", () => ({
  api: {
    useQueries: (
      build: (t: {
        traces: {
          getTracesWithSpans: (
            input: { projectId: string; traceIds: string[] },
            options: { enabled: boolean },
          ) => QueryResult;
        };
      }) => unknown[],
    ) => {
      let resultIndex = 0;
      return build({
        traces: {
          getTracesWithSpans: (input, options) => {
            mocks.captured.push({ input, options });
            return (
              mocks.results[resultIndex++] ?? {
                data: [],
                isLoading: false,
                isError: false,
                refetch: vi.fn(),
              }
            );
          },
        },
      });
    },
  },
}));

const PROJECT_ID = "project-1";

beforeEach(() => {
  mocks.captured = [];
  mocks.results = [];
});

afterEach(cleanup);

describe("useTracesWithSpansByTraceIds", () => {
  it("does not create a query when there are no trace ids", () => {
    renderHook(() =>
      useTracesWithSpansByTraceIds({
        projectId: PROJECT_ID,
        traceIds: [],
      }),
    );

    expect(mocks.captured).toEqual([]);
  });

  it("deduplicates, sorts, and chunks trace ids into URL-safe queries", () => {
    const ids = Array.from(
      { length: 101 },
      (_, index) => `trace-${String(index).padStart(3, "0")}`,
    );

    renderHook(() =>
      useTracesWithSpansByTraceIds({
        projectId: PROJECT_ID,
        traceIds: [...ids].reverse().concat("trace-050"),
      }),
    );

    expect(mocks.captured.map(({ input }) => input.traceIds)).toEqual([
      ids.slice(0, 50),
      ids.slice(50, 100),
      ids.slice(100),
    ]);
  });

  it("flattens data and aggregates loading and error states", () => {
    const error = new Error("trace query failed");
    mocks.results = [
      {
        data: [{ trace_id: "trace-1" }],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      },
      {
        data: [{ trace_id: "trace-51" }],
        isLoading: true,
        isError: true,
        error,
        refetch: vi.fn(),
      },
    ];

    const { result } = renderHook(() =>
      useTracesWithSpansByTraceIds({
        projectId: PROJECT_ID,
        traceIds: Array.from(
          { length: 51 },
          (_, index) => `trace-${String(index + 1).padStart(3, "0")}`,
        ),
      }),
    );

    expect(result.current.data.map((trace) => trace.trace_id)).toEqual([
      "trace-1",
      "trace-51",
    ]);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toBe(error);
  });

  it("retries every chunk", async () => {
    const refetches = [vi.fn(), vi.fn()];
    mocks.results = refetches.map((refetch) => ({
      data: [],
      isLoading: false,
      isError: true,
      refetch,
    }));

    const { result } = renderHook(() =>
      useTracesWithSpansByTraceIds({
        projectId: PROJECT_ID,
        traceIds: Array.from({ length: 51 }, (_, index) => `trace-${index}`),
      }),
    );

    await result.current.refetch();

    expect(refetches[0]).toHaveBeenCalledOnce();
    expect(refetches[1]).toHaveBeenCalledOnce();
  });
});

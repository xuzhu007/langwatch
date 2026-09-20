/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { skipToken } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * The all annotations page holds every annotation it loaded, and its export
 * carries all of them rather than the page on screen.
 * Spec: specs/annotations/annotations-list-selection.feature.
 */

const mocks = vi.hoisted(() => ({
  annotations: [] as unknown[],
  traces: [] as unknown[],
  traceHydrationLoading: false,
  traceHydrationError: null as Error | null,
  traceHydrationRefetch: vi.fn(),
  filters: {} as Record<string, unknown>,
  traceGroupsInput: undefined as unknown,
  traceGroupsEnabled: undefined as boolean | undefined,
  downloadCsv: vi.fn(),
  tableProps: null as Record<string, any> | null,
  annotationsByTraceIdsArgs: null as Record<string, unknown> | null,
}));

vi.mock("~/components/AnnotationsLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("~/components/annotations/AnnotationsTable", () => ({
  AnnotationsTable: (props: Record<string, any>) => {
    mocks.tableProps = props;
    return (
      <button type="button" onClick={props.onExport}>
        {props.exportLabel}
      </button>
    );
  },
}));
vi.mock("~/components/PeriodSelector", () => ({
  usePeriodSelector: () => ({
    period: {
      startDate: new Date("2026-07-01"),
      endDate: new Date("2026-08-01"),
    },
    mode: "relative",
    setPeriod: vi.fn(),
    setRelativePeriod: vi.fn(),
  }),
}));
vi.mock("~/hooks/useFilterParams", () => ({
  useFilterParams: () => ({
    filterParams: { projectId: "p1", filters: mocks.filters },
    queryOpts: { enabled: true },
    nonEmptyFilters: mocks.filters,
  }),
}));
vi.mock("~/hooks/useAnnotationsByTraceIds", () => ({
  useAnnotationsByTraceIds: (args: Record<string, unknown>) => {
    mocks.annotationsByTraceIdsArgs = args;
    return { data: [], isLoading: false };
  },
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1", slug: "acme" } }),
}));
vi.mock("~/hooks/useTracesWithSpansByTraceIds", () => ({
  useTracesWithSpansByTraceIds: () => ({
    data: mocks.traces,
    isLoading: mocks.traceHydrationLoading,
    isError: mocks.traceHydrationError !== null,
    error: mocks.traceHydrationError,
    refetch: mocks.traceHydrationRefetch,
  }),
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, push: vi.fn(), pathname: "/[project]" }),
}));
vi.mock("~/utils/downloadCsv", () => ({
  downloadCsv: mocks.downloadCsv,
  csvFileName: (name: string) => `${name} - 2026-08-08.csv`,
}));
vi.mock("~/utils/api", () => ({
  api: {
    traces: {
      getAllForProject: {
        useQuery: (input: unknown, options: { enabled: boolean }) => {
          mocks.traceGroupsInput = input;
          mocks.traceGroupsEnabled = options.enabled;
          return { data: undefined, isLoading: false };
        },
      },
    },
    annotation: {
      getAll: {
        useQuery: () => ({ data: mocks.annotations, isLoading: false }),
      },
    },
  },
}));

import AllAnnotations from "../all";

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AllAnnotations />
    </ChakraProvider>,
  );

const annotation = (overrides: Record<string, unknown> = {}) => ({
  id: "a1",
  traceId: "trace-1",
  comment: "reads well",
  expectedOutput: null,
  scoreOptions: {},
  isThumbsUp: true,
  anchorKind: null,
  anchorId: null,
  anchorPath: null,
  createdAt: new Date("2026-07-20T10:00:00Z"),
  user: { id: "user-1", name: "Ana", image: null },
  ...overrides,
});

beforeEach(() => {
  mocks.downloadCsv.mockReset();
  mocks.traceHydrationRefetch.mockReset();
  mocks.tableProps = null;
  mocks.annotationsByTraceIdsArgs = null;
  mocks.filters = {};
  mocks.traceGroupsInput = undefined;
  mocks.traceGroupsEnabled = undefined;
  mocks.traceHydrationLoading = false;
  mocks.traceHydrationError = null;
  mocks.traces = [
    {
      trace_id: "trace-1",
      input: { value: "the question" },
      output: { value: "the answer" },
      timestamps: { started_at: 1754049600000 },
    },
  ];
  mocks.annotations = [
    annotation({ id: "a1", createdAt: new Date("2026-07-01T10:00:00Z") }),
    annotation({ id: "a2", createdAt: new Date("2026-07-20T10:00:00Z") }),
    annotation({ id: "a3", traceId: "trace-2", comment: "off topic" }),
  ];
});
afterEach(cleanup);

describe("All annotations page", () => {
  describe("given the page has loaded its annotations", () => {
    /** @scenario "The all annotations page exports everything it holds" */
    it("exports every annotation, not just the page on screen", () => {
      renderPage();

      fireEvent.click(screen.getByRole("button", { name: "Export all" }));

      const call = mocks.downloadCsv.mock.calls[0]?.[0];
      expect(call.rows).toHaveLength(3);
      expect(call.fields).toContain("Trace ID");
      expect(call.rows[0]).toContain("the question");
      expect(call.fileName).toBe("Traces - 2026-08-08.csv");
    });

    /** @scenario "Suggestions are a count chip that opens on hover" */
    it("exports the suggestions under the part each was left on", () => {
      mocks.annotations = [
        annotation({ id: "a1", expectedOutput: "a better answer" }),
        annotation({
          id: "a2",
          expectedOutput: "thirty days",
          anchorKind: "field",
          anchorId: "span-abc123",
          anchorPath: "output",
        }),
        annotation({ id: "a3" }),
      ];
      renderPage();

      fireEvent.click(screen.getByRole("button", { name: "Export all" }));

      const call = mocks.downloadCsv.mock.calls[0]?.[0];
      const suggestionsAt = call.fields.indexOf("Suggestions");
      expect(suggestionsAt).toBeGreaterThan(-1);
      expect(call.fields).not.toContain("Expected output");
      expect(call.rows[0][suggestionsAt]).toBe("a better answer");
      expect(call.rows[1][suggestionsAt]).toBe(
        "Span span-abc123 · Output: thirty days",
      );
      expect(call.rows[2][suggestionsAt]).toBe("");
    });

    it("keeps empty input and output values when hydration succeeds without them", () => {
      mocks.traces = [
        {
          trace_id: "trace-1",
          timestamps: { started_at: 1754049600000 },
        },
      ];

      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Export all" }));

      const call = mocks.downloadCsv.mock.calls[0]?.[0];
      expect(call.rows[0][1]).toBe("");
      expect(call.rows[0][2]).toBe("");
    });

    /** @scenario "Comments are a count chip that opens on hover" */
    it("reads every comment on these traces, anchored ones included", () => {
      renderPage();

      expect(mocks.annotationsByTraceIdsArgs?.anchor).toBe("all");
    });

    it("groups the annotations by trace and dates each row by its newest one", () => {
      renderPage();

      const rows = mocks.tableProps?.rows ?? [];
      expect(rows).toHaveLength(2);
      expect(rows[0].queueItemId).toBeNull();
      expect(rows[0].date).toEqual(new Date("2026-07-20T10:00:00Z"));
      expect(mocks.tableProps?.dateColumnLabel).toBe("Date annotated");
      expect(mocks.tableProps?.showStatusFilter).toBe(false);
    });

    it("does not load trace groups when no filters are active", () => {
      renderPage();
      expect(mocks.traceGroupsInput).toBe(skipToken);
      expect(mocks.traceGroupsEnabled).toBe(true);
    });

    it("loads trace groups when filters are active", () => {
      mocks.filters = { models: ["gpt-5"] };

      renderPage();
      expect(mocks.traceGroupsInput).toMatchObject({
        filters: { models: ["gpt-5"] },
        pageSize: 10000,
      });

      expect(mocks.traceGroupsEnabled).toBe(true);
    });

    it("shows a retryable error instead of rows when trace hydration fails", () => {
      mocks.traceHydrationError = new Error("trace query failed");

      renderPage();

      expect(
        screen.getByRole("heading", {
          name: "Failed to load annotation data",
        }),
      ).toBeInTheDocument();
      expect(mocks.tableProps).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(mocks.traceHydrationRefetch).toHaveBeenCalledOnce();
    });
  });
});

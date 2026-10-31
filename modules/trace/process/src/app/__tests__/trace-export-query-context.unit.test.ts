import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type {
  Protections,
  ResolvedInstantEvalRun,
  TraceExportDownloadInput,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import type { TraceAppDependencies } from "../trace.app.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

const projectId = "project-1";
const protections: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};
const request: TraceExportDownloadInput["request"] = {
  projectId,
  mode: "summary",
  format: "csv",
  filters: {},
  startDate: 1000,
  endDate: 2000,
};
function harness(resolved: ResolvedInstantEvalRun[] = []) {
  const getAllTracesForProject = vi.fn<
    TraceAppDependencies["traces"]["read"]["getAllTracesForProject"]
  >(async () => ({ groups: [], totalHits: 0, traceChecks: {}, scrollId: null }));
  const findRegisteredRuns = vi.fn(async () => resolved);
  const app = createTraceAppHarness({
    authorizeRead: async () => ownProof({ projectId }),
    traces: {
      read: createApiFixture<TraceAppDependencies["traces"]["read"]>({ getAllTracesForProject }),
    },
    projects: createApiFixture<TraceAppDependencies["projects"]>({ findById: async () => null }),
    protections: createApiFixture<NonNullable<TraceAppDependencies["protections"]>>({
      resolve: async () => protections,
    }),
    presence: createApiFixture<NonNullable<TraceAppDependencies["presence"]>>({
      publishProjectEvent: async () => {},
    }),
    explorerEvalRuns: createApiFixture<NonNullable<TraceAppDependencies["explorerEvalRuns"]>>({
      findRegisteredRuns,
    }),
    exportBounds: {
      assertExportWithinRate: async () => {},
      acquireExportSlot: async () => ({ release: async () => {} }),
    },
  });
  const download = async (extra: Partial<typeof request> = {}) => {
    const result = await app.downloadTraceExport({
      request: { ...request, ...extra },
      userId: "user-1",
      authorization: ownProof({ projectId }),
    });
    for await (const chunk of result.stream) void chunk;
  };
  return { download, getAllTracesForProject, findRegisteredRuns };
}

describe("export query context", () => {
  /** @scenario "导出用项目内已验证的即时评估结果筛选" */
  it("validates eval runs against the project and gives count and stream the same filter", async () => {
    const h = harness([
      {
        question: "risky",
        target: "traces",
        runId: "run-1",
        writtenFrom: 3000,
        writtenUntil: 4000,
      },
    ]);
    const evalRuns = { key: { question: "risky", target: "traces" as const, runId: "run-1" } };
    await h.download({ filterQuery: 'eval.trace:"risky"', evalRuns });
    expect(h.findRegisteredRuns).toHaveBeenCalledWith({
      projectId,
      references: Object.values(evalRuns),
    });
    const filters = h.getAllTracesForProject.mock.calls.map((call) => call[2].filterWhere);
    expect(filters).toHaveLength(2);
    expect(filters[0]).toEqual(filters[1]);
    expect(filters[0]?.sql).toContain("instant_eval_judgments");
    expect(Object.values(filters[0]?.params ?? {})).toContain("run-1");
  });
  it("matches no traces for an unregistered eval run", async () => {
    const h = harness();
    await h.download({
      filterQuery: 'eval.trace:"risky"',
      evalRuns: { key: { question: "risky", target: "traces", runId: "other-project" } },
    });
    expect(h.getAllTracesForProject.mock.calls[0]?.[2].filterWhere?.sql).toContain("1 = 0");
  });
  /** @scenario "导出保留浏览器默认隐藏的来源范围" */
  it("preserves the default hidden origins and explicit origin override", async () => {
    const h = harness();
    await h.download();
    expect(h.getAllTracesForProject.mock.calls[0]?.[2].filterWhere?.params).toMatchObject({
      hiddenOrigins: ["langy"],
    });
    h.getAllTracesForProject.mockClear();
    await h.download({ filterQuery: "origin:langy" });
    expect(h.getAllTracesForProject.mock.calls[0]?.[2].filterWhere?.params).not.toHaveProperty(
      "hiddenOrigins",
    );
  });
});

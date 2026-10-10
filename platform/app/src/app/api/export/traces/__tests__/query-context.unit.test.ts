import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedInstantEvalRun } from "~/server/app-layer/traces/filter-to-clickhouse";
import type { ExportService } from "~/server/export/export.service";
import { app } from "../[[...route]]/app";

const harness = vi.hoisted(() => ({
  count: vi.fn<ExportService["getTotalCount"]>().mockResolvedValue(0),
  export: vi.fn<ExportService["exportTraces"]>(async function* () {}),
  resolve: vi.fn<() => Promise<ResolvedInstantEvalRun[]>>(),
}));

vi.mock("~/server/api/security", () => ({
  createServiceApp: ({ basePath }: { basePath: string }) => {
    const hono = new Hono().basePath(basePath);
    const secured = {
      hono,
      access: () => secured,
      post: hono.post.bind(hono),
    };
    return secured;
  },
  handlerManagedAuth: (value: unknown) => value,
}));
vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(async () => ({ user: { id: "user-1" } })),
}));
vi.mock("~/server/app-layer/permissions/imperative", () => ({
  probeProjectPermission: vi.fn(async () => true),
}));
vi.mock("~/server/api/utils", () => ({
  getUserProtectionsForProject: vi.fn(async () => ({})),
}));
vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ broadcast: { broadcastToTenant: vi.fn() } }),
}));
vi.mock("~/server/app-layer/instant-evals/run", () => ({
  getInstantEvalRunService: () => ({ resolveForExplorer: harness.resolve }),
}));
vi.mock("~/server/export/export.service", () => ({
  ExportService: {
    create: async () => ({
      getTotalCount: harness.count,
      exportTraces: harness.export,
    }),
  },
}));

function download(body: Record<string, unknown> = {}) {
  return app.request("/api/export/traces/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: "project-1",
      mode: "summary",
      format: "csv",
      filters: {},
      startDate: 1_000,
      endDate: 2_000,
      ...body,
    }),
  });
}

describe("导出查询上下文", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.resolve.mockResolvedValue([
      {
        question: "有风险",
        target: "traces",
        runId: "run-1",
        writtenFrom: 3_000,
        writtenUntil: 4_000,
      },
    ]);
  });

  describe("当请求携带即时评估运行时", () => {
    /** @scenario "导出用项目内已验证的即时评估结果筛选" */
    it("校验项目并将同一筛选传给计数与导出", async () => {
      const evalRuns = {
        key: { question: "有风险", target: "traces", runId: "run-1" },
      };
      const response = await download({
        filterQuery: 'eval.trace:"有风险"',
        evalRuns,
      });
      await response.text();
      expect(response.status).toBe(200);
      expect(harness.resolve).toHaveBeenCalledWith({
        projectId: "project-1",
        evalRuns,
      });
      const filterWhere = harness.count.mock.calls[0]![0].filterWhere!;
      expect(filterWhere.sql).toContain("FROM instant_eval_judgments");
      expect(filterWhere.params).toMatchObject({
        tenantId: "project-1",
        evalRun_0: "run-1",
        evalWrittenFrom_1: 3_000,
        evalWrittenUntil_2: 4_000,
      });
      expect(harness.export.mock.calls[0]![0].filterWhere).toEqual(filterWhere);
    });

    it("无法验证的运行不匹配任何追踪", async () => {
      harness.resolve.mockResolvedValue([]);
      const response = await download({
        filterQuery: 'eval.trace:"有风险"',
        evalRuns: {
          key: { question: "有风险", target: "traces", runId: "other-project" },
        },
      });
      await response.text();
      expect(harness.count.mock.calls[0]![0].filterWhere!.sql).toContain(
        "1 = 0",
      );
    });
  });

  describe("当导出使用默认来源范围时", () => {
    /** @scenario "导出保留浏览器默认隐藏的来源范围" */
    it("默认排除 Langy 而显式来源保持不变", async () => {
      await (await download()).text();
      expect(harness.count.mock.calls[0]![0].filterWhere!.params).toMatchObject(
        {
          hiddenOrigins: ["langy"],
        },
      );
      await (await download({ filterQuery: "origin:langy" })).text();
      expect(
        harness.count.mock.calls[1]![0].filterWhere!.params,
      ).not.toHaveProperty("hiddenOrigins");
      expect(harness.resolve).not.toHaveBeenCalled();
    });
  });
});

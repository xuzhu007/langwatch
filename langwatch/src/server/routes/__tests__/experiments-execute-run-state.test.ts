/**
 * @vitest-environment node
 *
 * Regression guard: the browser SSE execute endpoint must create run state so
 * POST /api/experiments/abort can verify the run belongs to the caller's
 * project instead of returning 404 "Run not found" for UI-triggered runs.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({ user: { id: "user_1" } }),
}));

vi.mock("~/server/api/rbac", async (importActual) => {
  const actual = await importActual<typeof import("~/server/api/rbac")>();
  return { ...actual, hasProjectPermission: vi.fn().mockResolvedValue(true) };
});

vi.mock("~/server/experiments-v3/execution/dataLoader", () => ({
  loadExecutionData: vi.fn().mockResolvedValue({
    datasetRows: [{ input: "hello" }, { input: "world" }],
    datasetColumns: [{ id: "input", name: "input", type: "string" }],
    loadedPrompts: new Map(),
    loadedAgents: new Map(),
    loadedEvaluators: new Map(),
  }),
}));

const createRun = vi.fn().mockResolvedValue(undefined);
const addEvent = vi.fn().mockResolvedValue(undefined);
const completeRun = vi.fn().mockResolvedValue(undefined);
const stopRun = vi.fn().mockResolvedValue(undefined);
const failRun = vi.fn().mockResolvedValue(undefined);

vi.mock("~/server/experiments-v3/execution/runStateManager", () => ({
  runStateManager: {
    createRun: (...args: unknown[]) => createRun(...args),
    addEvent: (...args: unknown[]) => addEvent(...args),
    completeRun: (...args: unknown[]) => completeRun(...args),
    stopRun: (...args: unknown[]) => stopRun(...args),
    failRun: (...args: unknown[]) => failRun(...args),
  },
}));

const summary = {
  runId: "run-ui-123",
  totalCells: 2,
  completedCells: 2,
  failedCells: 0,
  duration: 10,
  timestamps: { startedAt: 100, finishedAt: 110 },
};

vi.mock("~/server/experiments-v3/execution/orchestrator", () => ({
  requestAbort: vi.fn().mockResolvedValue(undefined),
  runOrchestrator: vi.fn(async function* () {
    yield { type: "execution_started", runId: "run-ui-123", total: 2 };
    yield { type: "done", summary };
  }),
}));

const validExecuteBody = {
  projectId: "project_ui",
  experimentId: "experiment_1",
  experimentSlug: "experiment-slug",
  name: "UI Evaluation",
  dataset: {
    id: "dataset-1",
    name: "Dataset",
    type: "inline" as const,
    columns: [{ id: "input", name: "input", type: "string" }],
    inline: {
      columns: [{ id: "input", name: "input", type: "string" }],
      records: { input: ["hello", "world"] },
    },
  },
  targets: [],
  evaluators: [],
  scope: { type: "cell" as const, targetId: "target-1", rowIndex: 0 },
};

describe("POST /api/experiments/execute run state", () => {
  it("creates and completes run state for browser SSE executions", async () => {
    const { app } = await import("../experiments-v3");

    const res = await app.request("http://localhost/api/experiments/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validExecuteBody),
    });

    expect(res.status).toBe(200);
    await res.text();

    expect(createRun).toHaveBeenCalledWith({
      runId: "run-ui-123",
      projectId: "project_ui",
      experimentId: "experiment_1",
      experimentSlug: "experiment-slug",
      total: 2,
    });
    expect(addEvent).toHaveBeenCalledWith("run-ui-123", {
      type: "execution_started",
      runId: "run-ui-123",
      total: 2,
    });
    expect(completeRun).toHaveBeenCalledWith("run-ui-123", summary);
    expect(stopRun).not.toHaveBeenCalled();
    expect(failRun).not.toHaveBeenCalled();
  });
});

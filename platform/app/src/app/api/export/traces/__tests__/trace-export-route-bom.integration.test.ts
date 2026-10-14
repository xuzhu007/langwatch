/**
 * Fork 定制：Trace Explorer 导出的 CSV 以 UTF-8 BOM 开头，Excel 才会按 UTF-8
 * 解析中文；JSONL 不加，没有匹配数据时响应体仍是 0 字节（页面靠它提示
 * “Export produced no data”）。读回的是响应字节，`Response.text()` 会把 BOM
 * 吞掉，用它断言等于没断言。
 *
 * Authentication, RBAC and the export service are the boundary: what is under
 * test is what the route puts on the wire for the chunks the service yields.
 *
 * @see specs/traces/fork-csv-utf8-bom.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { globalForApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { app } from "../[[...route]]/app";

const session = {
  user: { id: "user_1", name: "Tester", email: "tester@example.com" },
  expires: new Date(Date.now() + 60_000).toISOString(),
};

const { exportChunks } = vi.hoisted(() => ({
  exportChunks: { current: [] as string[] },
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(async () => session),
}));
vi.mock(
  "~/server/app-layer/permissions/imperative",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("~/server/app-layer/permissions/imperative")
    >()),
    probeProjectPermission: vi.fn(async () => true),
  }),
);
vi.mock("~/server/api/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/api/utils")>()),
  getUserProtectionsForProject: vi.fn(async () => ({})),
}));
vi.mock("~/server/export/export.service", () => ({
  ExportService: {
    create: vi.fn(async () => ({
      getTotalCount: vi.fn(async () => exportChunks.current.length),
      exportTraces: async function* () {
        for (const [index, chunk] of exportChunks.current.entries()) {
          yield {
            chunk,
            progress: {
              exported: index + 1,
              total: exportChunks.current.length,
            },
          };
        }
      },
    })),
  },
}));

function download(format: "csv" | "json") {
  return app.request("/api/export/traces/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: "project_1",
      mode: "summary",
      format,
      filters: {},
      startDate: Date.UTC(2026, 9, 7),
      endDate: Date.UTC(2026, 9, 14),
    }),
  });
}

async function bodyBytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

describe("POST /api/export/traces/download", () => {
  beforeEach(() => {
    globalForApp.__langwatch_app = createTestApp({});
  });

  describe("when the CSV export streams several batches", () => {
    /** @scenario Trace Explorer 导出的 CSV 以 BOM 开头且只写一次 */
    it("starts the file with the UTF-8 BOM and writes it once", async () => {
      exportChunks.current = ["trace_id,input\r\nt1,你好\r\n", "t2,再见\r\n"];

      const response = await download("csv");

      expect(response.status).toBe(200);
      const bytes = await bodyBytes(response);
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
      expect(text).toBe("\uFEFFtrace_id,input\r\nt1,你好\r\nt2,再见\r\n");
    });
  });

  describe("when nothing matches the CSV export", () => {
    /** @scenario Trace Explorer 没有匹配数据的 CSV 导出仍是 0 字节 */
    it("answers an empty body", async () => {
      exportChunks.current = [];

      const response = await download("csv");

      expect(response.status).toBe(200);
      expect((await bodyBytes(response)).length).toBe(0);
    });
  });

  describe("when the export is JSONL", () => {
    /** @scenario Trace Explorer 导出的 JSONL 不加 BOM */
    it("leaves the first line as the service wrote it", async () => {
      exportChunks.current = ['{"trace_id":"t1"}\n'];

      const response = await download("json");

      const bytes = await bodyBytes(response);
      expect(bytes[0]).toBe("{".charCodeAt(0));
    });
  });
});

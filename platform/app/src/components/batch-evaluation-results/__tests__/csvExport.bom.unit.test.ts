/**
 * @vitest-environment jsdom
 *
 * Fork 定制：Experiments 结果导出的 CSV 以 UTF-8 BOM 开头，Excel 才会按
 * UTF-8 解析中文。读回的是写进文件的字节，而不是传给 Blob 之前的字符串。
 *
 * @see specs/traces/fork-csv-utf8-bom.feature
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { downloadCsv } from "../csvExport";
import type { BatchEvaluationData } from "../types";

let lastBlob: Blob | undefined;

beforeAll(() => {
  window.URL.createObjectURL = vi.fn((blob: Blob) => {
    lastBlob = blob;
    return "blob:test";
  });
  window.URL.revokeObjectURL = vi.fn();
});

const data: BatchEvaluationData = {
  runId: "run-1",
  experimentId: "exp-1",
  projectId: "project-1",
  createdAt: 1705320000000,
  datasetColumns: [{ name: "问题", hasImages: false }],
  targetColumns: [],
  evaluatorIds: [],
  evaluatorNames: {},
  comparisonColumns: [],
  rows: [{ index: 0, datasetEntry: { 问题: "退款怎么申请" }, targets: {} }],
};

describe("Experiments results CSV download", () => {
  describe("given a run whose dataset holds Chinese text", () => {
    describe("when the results are downloaded", () => {
      /** @scenario Experiments 结果导出的 CSV 以 BOM 开头 */
      it("starts the file with the UTF-8 BOM and keeps the text whole", async () => {
        lastBlob = undefined;
        downloadCsv(data, "实验");

        const bytes = new Uint8Array(await lastBlob!.arrayBuffer());
        expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
        expect(await lastBlob!.text()).toContain("退款怎么申请");
      });
    });
  });
});

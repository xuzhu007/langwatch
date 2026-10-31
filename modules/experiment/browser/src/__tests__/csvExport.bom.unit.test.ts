/** Batch result CSV downloads begin with a UTF-8 BOM. */
import { beforeAll, describe, expect, it, vi } from "vitest";

import { downloadCsv } from "../ui/sections/batch-evaluation-results.csv.ts";
import type { BatchEvaluationData } from "../ui/sections/batch-evaluation-results.types.ts";

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
        expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
        expect(await lastBlob!.text()).toContain("退款怎么申请");
      });
    });
  });
});

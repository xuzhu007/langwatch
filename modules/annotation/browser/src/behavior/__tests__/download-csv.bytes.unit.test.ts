import { downloadCsv } from "@langwatch/csv/download";
/** @vitest-environment jsdom */
import { beforeAll, describe, expect, it, vi } from "vitest";

let lastBlob: Blob | undefined;

beforeAll(() => {
  window.URL.createObjectURL = vi.fn((blob: Blob) => {
    lastBlob = blob;

    return "blob:test";
  });

  window.URL.revokeObjectURL = vi.fn();
});

/** The text actually written to the file, read back out of the blob. */
const writtenFile = async (args: { fields: string[]; rows: (string | number)[][] }) => {
  lastBlob = undefined;
  downloadCsv({ ...args, fileName: "f.csv" });

  return lastBlob!.text();
};

describe("the file downloadCsv actually writes", () => {
  describe("given a heading and a cell a spreadsheet would run", () => {
    it("shows them as text and leaves a number a number", async () => {
      const file = await writtenFile({
        fields: ["Trace ID", "=cmd|' /c calc'!A1", "-5", "@handle"],
        rows: [["ok", "=1+1", "-5", "plain"]],
      });

      expect(file.split("\r\n")).toEqual([
        "Trace ID,'=cmd|' /c calc'!A1,-5,'@handle",
        "ok,'=1+1,-5,plain",
      ]);
    });
  });

  it("keeps quoted, multiline, and Unicode annotation text intact", async () => {
    const file = await writtenFile({
      fields: ["Comment", "Reviewer"],
      rows: [[`said "yes", then\nleft`, "🦊"]],
    });

    expect(file).toBe('Comment,Reviewer\r\n"said ""yes"", then\nleft",🦊');
  });
});

describe("the bytes downloadCsv writes (fork)", () => {
  describe("given a table holding Chinese text", () => {
    /** @scenario 浏览器生成的 CSV 下载以 BOM 开头且中文完整 */
    it("starts the file with the UTF-8 BOM that Excel reads the encoding from", async () => {
      lastBlob = undefined;
      downloadCsv({
        fields: ["名称", "备注"],
        rows: [["张三", "退款申请"]],
        fileName: "f.csv",
      });

      const bytes = new Uint8Array(await lastBlob!.arrayBuffer());
      expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
      // A UTF-8 decode drops the mark again, so the text is exactly the CSV.
      expect((await lastBlob!.text()).split("\r\n")).toEqual(["名称,备注", "张三,退款申请"]);
    });
  });
});

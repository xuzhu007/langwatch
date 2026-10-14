/**
 * Fork 定制：CSV 下载以 UTF-8 BOM 开头，Excel 才会按 UTF-8 解析中文。
 *
 * @see specs/traces/fork-csv-utf8-bom.feature
 */
import { describe, expect, it } from "vitest";
import {
  stripUtf8Bom,
  UTF8_BOM,
  withUtf8Bom,
  withUtf8BomStream,
} from "../csvBom";

async function collect(chunks: string[]): Promise<string[]> {
  async function* source() {
    for (const [index, chunk] of chunks.entries()) {
      yield { chunk, progress: { exported: index + 1 } };
    }
  }
  const out: string[] = [];
  for await (const { chunk } of withUtf8BomStream(source())) out.push(chunk);
  return out;
}

describe("withUtf8BomStream()", () => {
  describe("given a CSV written in several batches", () => {
    describe("when the batches are streamed", () => {
      /** @scenario Trace Explorer 导出的 CSV 以 BOM 开头且只写一次 */
      it("marks the first batch and leaves every later one as it was", async () => {
        const out = await collect(["编号,名称\r\n1,张三\r\n", "2,李四\r\n"]);

        expect(out).toEqual([
          `${UTF8_BOM}编号,名称\r\n1,张三\r\n`,
          "2,李四\r\n",
        ]);
        expect(out.join("").split(UTF8_BOM)).toHaveLength(2);
      });

      it("keeps the rest of each item untouched", async () => {
        async function* source() {
          yield { chunk: "a\r\n", progress: { exported: 1, total: 1 } };
        }
        const items = [];
        for await (const item of withUtf8BomStream(source())) items.push(item);

        expect(items).toEqual([
          { chunk: `${UTF8_BOM}a\r\n`, progress: { exported: 1, total: 1 } },
        ]);
      });
    });
  });

  describe("given an export with no content", () => {
    describe("when nothing is streamed at all", () => {
      /** @scenario Trace Explorer 没有匹配数据的 CSV 导出仍是 0 字节 */
      it("writes nothing, so the body stays 0 bytes", async () => {
        expect(await collect([])).toEqual([]);
      });
    });

    describe("when the first batch is empty", () => {
      it("marks the first batch that carries text instead", async () => {
        expect(await collect(["", "a\r\n"])).toEqual(["", `${UTF8_BOM}a\r\n`]);
      });
    });
  });
});

describe("withUtf8Bom()", () => {
  describe("when the text already starts with the mark", () => {
    it("does not add a second one", () => {
      expect(withUtf8Bom(`${UTF8_BOM}a`)).toBe(`${UTF8_BOM}a`);
    });
  });
});

describe("stripUtf8Bom()", () => {
  describe("when the text starts with the mark", () => {
    it("drops it", () => {
      expect(stripUtf8Bom(`${UTF8_BOM}trace_id`)).toBe("trace_id");
    });
  });

  describe("when the text has no mark", () => {
    it("returns it unchanged", () => {
      expect(stripUtf8Bom("trace_id")).toBe("trace_id");
    });
  });
});

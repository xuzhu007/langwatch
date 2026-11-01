/** UTF-8 BOM helpers for Excel-compatible CSV exports and imports. */
export const UTF8_BOM = "\uFEFF";

/** The CSV text with the mark Excel needs in front of it, exactly once. */
export function withUtf8Bom(csv: string): string {
  return csv.startsWith(UTF8_BOM) ? csv : `${UTF8_BOM}${csv}`;
}

/** The text without a leading mark, for a parser that keeps it. */
export function stripUtf8Bom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text;
}

/**
 * A streamed CSV with the mark in front of its first non-empty chunk, and
 * nowhere else. A stream with no content stays empty, so a client that reads
 * a 0-byte body as "nothing matched" still can.
 */
export async function* withUtf8BomStream<T extends { chunk: string }>(
  source: AsyncIterable<T>,
): AsyncGenerator<T> {
  let marked = false;
  for await (const item of source) {
    if (marked || item.chunk.length === 0) {
      yield item;
      continue;
    }
    marked = true;
    yield { ...item, chunk: withUtf8Bom(item.chunk) };
  }
}

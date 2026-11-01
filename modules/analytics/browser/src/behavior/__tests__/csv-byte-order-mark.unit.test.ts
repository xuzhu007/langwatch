/**
 * @vitest-environment jsdom
 * The shared CSV writer marks downloads as UTF-8 for spreadsheets by default,
 * while callers can explicitly request plain CSV bytes.
 * @see modules/analytics/specs/dashboard-widget-export.feature
 */

import { downloadCsv } from "@langwatch/csv/download";
import { beforeAll, describe, expect, it, vi } from "vitest";

let lastBlob: Blob | undefined;

beforeAll(() => {
  window.URL.createObjectURL = vi.fn((blob: Blob) => {
    lastBlob = blob;
    return "blob:test";
  });
  window.URL.revokeObjectURL = vi.fn();
});

/** The bytes actually written to the file, read back out of the blob. */
async function writtenBytes({ byteOrderMark }: { byteOrderMark?: boolean }) {
  lastBlob = undefined;
  downloadCsv({
    fields: ["Model"],
    rows: [["modèle"]],
    fileName: "f.csv",
    ...(byteOrderMark === undefined ? {} : { byteOrderMark }),
  });
  return [...new Uint8Array(await lastBlob!.arrayBuffer())];
}

const PLAIN = [...new TextEncoder().encode("Model\r\nmodèle")];

describe("downloadCsv", () => {
  describe("when the caller asks for a byte order mark", () => {
    /** @scenario "CSV downloads include a byte order mark unless the caller opts out" */
    it("starts the file with the UTF-8 mark, then the same bytes", async () => {
      expect(await writtenBytes({ byteOrderMark: true })).toEqual([0xef, 0xbb, 0xbf, ...PLAIN]);
    });
  });

  describe("when the caller keeps the default", () => {
    /** @scenario "CSV downloads include a byte order mark unless the caller opts out" */
    it("starts the file with the UTF-8 mark", async () => {
      expect(await writtenBytes({})).toEqual([0xef, 0xbb, 0xbf, ...PLAIN]);
    });
  });

  describe("when the caller disables the byte order mark", () => {
    /** @scenario "CSV downloads include a byte order mark unless the caller opts out" */
    it("writes plain CSV bytes", async () => {
      expect(await writtenBytes({ byteOrderMark: false })).toEqual(PLAIN);
    });
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyToClipboard } from "../clipboard";

/** Helper: set up DOM mocks for the textarea-based fallback path. */
function mockExecCommandFallback(execCommandReturn: boolean) {
  const mockTextarea = {
    value: "",
    style: {} as CSSStyleDeclaration,
    focus: vi.fn(),
    select: vi.fn(),
  };
  vi.spyOn(document, "createElement").mockReturnValue(
    mockTextarea as unknown as HTMLElement,
  );
  vi.spyOn(document.body, "appendChild").mockImplementation(
    () => mockTextarea as unknown as Node,
  );
  vi.spyOn(document.body, "removeChild").mockImplementation(
    () => mockTextarea as unknown as Node,
  );
  // jsdom does not implement execCommand — define it so it can be spied on
  document.execCommand = vi.fn().mockReturnValue(execCommandReturn);
  return { mockTextarea };
}

describe("copyToClipboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when navigator.clipboard is available", () => {
    it("uses clipboard API and returns true on success", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });

      const result = await copyToClipboard("hello");

      expect(writeText).toHaveBeenCalledWith("hello");
      expect(result).toBe(true);
    });

    it("falls back to execCommand when clipboard API throws", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("denied"));
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      const { mockTextarea } = mockExecCommandFallback(true);

      const result = await copyToClipboard("hello");

      expect(result).toBe(true);
      expect(mockTextarea.value).toBe("hello");
      expect(document.execCommand).toHaveBeenCalledWith("copy");
    });
  });

  describe("when navigator.clipboard is unavailable", () => {
    it("falls back to execCommand and returns true on success", async () => {
      vi.stubGlobal("navigator", {});
      const { mockTextarea } = mockExecCommandFallback(true);

      const result = await copyToClipboard("hello");

      expect(result).toBe(true);
      expect(mockTextarea.value).toBe("hello");
    });

    it("returns false when execCommand fails", async () => {
      vi.stubGlobal("navigator", {});
      mockExecCommandFallback(false);

      const result = await copyToClipboard("hello");

      expect(result).toBe(false);
    });
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { generateUUID } from "../generateUUID";

// UUID v4 format: 8-4-4-4-12 hex chars
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateUUID", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a valid UUID v4 string", () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(UUID_V4_REGEX);
  });

  it("returns unique values on successive calls", () => {
    const uuids = new Set(Array.from({ length: 100 }, () => generateUUID()));
    expect(uuids.size).toBe(100);
  });

  describe("when crypto.randomUUID is unavailable", () => {
    it("falls back to getRandomValues and produces valid UUID v4", () => {
      const original = crypto.randomUUID;
      // Simulate non-secure context where randomUUID is undefined
      vi.stubGlobal("crypto", {
        ...crypto,
        randomUUID: undefined,
        getRandomValues: crypto.getRandomValues.bind(crypto),
      });

      const uuid = generateUUID();
      expect(uuid).toMatch(UUID_V4_REGEX);

      vi.stubGlobal("crypto", { ...crypto, randomUUID: original });
    });
  });

  describe("when both randomUUID and getRandomValues are unavailable", () => {
    it("falls back to Math.random and still produces UUID-shaped string", () => {
      vi.stubGlobal("crypto", {
        randomUUID: undefined,
        getRandomValues: undefined,
      });

      const uuid = generateUUID();
      // Math.random fallback produces UUID format but version/variant bits may differ
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      vi.unstubAllGlobals();
    });
  });
});

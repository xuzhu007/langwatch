/**
 * Both shapes a custom model list has ever been sent in, and the shape it goes back in.
 * @see specs/model-providers/custom-model-max-tokens.feature
 */

import { describe, expect, it } from "vitest";

import { toCanonicalCustomModelList, toCustomModelEntry } from "../custom-model-list.rules.ts";

describe("toCanonicalCustomModelList", () => {
  describe("given the string shape the field started as", () => {
    it("reads each id as its own label", () => {
      expect(toCanonicalCustomModelList(["gpt-5-mini"], "chat")).toEqual([
        { id: "gpt-5-mini", label: "gpt-5-mini", type: "chat" },
      ]);
    });
  });

  describe("given the object shape it takes now", () => {
    it("reads the display name as the label", () => {
      expect(
        toCanonicalCustomModelList([{ modelId: "gpt-5-mini", displayName: "Fast" }], "chat"),
      ).toEqual([{ id: "gpt-5-mini", label: "Fast", type: "chat" }]);
    });

    it("falls back to the id when no display name was given", () => {
      expect(toCanonicalCustomModelList([{ modelId: "gpt-5-mini" }], "embedding")).toEqual([
        { id: "gpt-5-mini", label: "gpt-5-mini", type: "embedding" },
      ]);
    });

    it("ignores a display name that is not text", () => {
      expect(toCanonicalCustomModelList([{ modelId: "m", displayName: 42 }], "chat")).toEqual([
        { id: "m", label: "m", type: "chat" },
      ]);
    });
  });

  describe("given the two shapes mixed in one list", () => {
    it("reads both, because a customer may have written the list over time", () => {
      expect(toCanonicalCustomModelList(["a", { modelId: "b", displayName: "B" }], "chat")).toEqual(
        [
          { id: "a", label: "a", type: "chat" },
          { id: "b", label: "B", type: "chat" },
        ],
      );
    });
  });

  describe("given entries it cannot read", () => {
    it("drops them and keeps the rest, rather than failing the write", () => {
      expect(toCanonicalCustomModelList(["a", null, 7, {}, { modelId: 9 }, "b"], "chat")).toEqual([
        { id: "a", label: "a", type: "chat" },
        { id: "b", label: "b", type: "chat" },
      ]);
    });
  });

  describe("given the field was not sent at all", () => {
    it("answers undefined, which is not the same as an empty list", () => {
      // Undefined leaves the stored list alone; an empty array would clear it.
      expect(toCanonicalCustomModelList(undefined, "chat")).toBeUndefined();
      expect(toCanonicalCustomModelList(null, "chat")).toBeUndefined();
      expect(toCanonicalCustomModelList("not a list", "chat")).toBeUndefined();
      expect(toCanonicalCustomModelList([], "chat")).toEqual([]);
    });
  });

  describe("given the type it stamps", () => {
    it("is the one the caller asked for, not one read from the entry", () => {
      expect(toCanonicalCustomModelList([{ modelId: "m", type: "chat" }], "embedding")).toEqual([
        { id: "m", label: "m", type: "embedding" },
      ]);
    });
  });

  describe("given a model sent with its ceiling and capabilities", () => {
    /** @scenario "The server keeps a custom model's Max Tokens ceiling on save and sends it back" */
    it("keeps the Max Tokens ceiling, the supported parameters and the inputs", () => {
      const sent = {
        modelId: "m",
        displayName: "M",
        mode: "chat",
        maxTokens: 32768,
        supportedParameters: ["temperature", "top_p"],
        multimodalInputs: ["image"],
      };

      expect(toCanonicalCustomModelList([sent], "chat")).toEqual([
        {
          id: "m",
          label: "M",
          type: "chat",
          maxTokens: 32768,
          supportedParameters: ["temperature", "top_p"],
          multimodalInputs: ["image"],
        },
      ]);
    });

    it("drops a ceiling that is not a positive number, and names it does not know", () => {
      expect(
        toCanonicalCustomModelList(
          [
            { modelId: "zero", maxTokens: 0 },
            {
              modelId: "text",
              maxTokens: "8192",
              supportedParameters: ["temperature", "response_format"],
              multimodalInputs: ["image", "video"],
            },
          ],
          "chat",
        ),
      ).toEqual([
        { id: "zero", label: "zero", type: "chat" },
        {
          id: "text",
          label: "text",
          type: "chat",
          supportedParameters: ["temperature"],
          multimodalInputs: ["image"],
        },
      ]);
    });
  });
});

describe("toCustomModelEntry", () => {
  describe("given a stored model with a ceiling", () => {
    /** @scenario "The server keeps a custom model's Max Tokens ceiling on save and sends it back" */
    it("sends the ceiling and the capabilities back to the editor", () => {
      expect(
        toCustomModelEntry(
          {
            id: "m",
            label: "M",
            maxTokens: 32768,
            supportedParameters: ["temperature"],
            multimodalInputs: ["image"],
          },
          "chat",
        ),
      ).toEqual({
        modelId: "m",
        displayName: "M",
        mode: "chat",
        maxTokens: 32768,
        supportedParameters: ["temperature"],
        multimodalInputs: ["image"],
      });
    });
  });

  describe("given a stored model with no ceiling and empty lists", () => {
    it("leaves them out, so the editor offers its own defaults", () => {
      expect(
        toCustomModelEntry(
          { id: "m", label: "M", maxTokens: null, supportedParameters: [], multimodalInputs: [] },
          "embedding",
        ),
      ).toEqual({ modelId: "m", displayName: "M", mode: "embedding" });
    });
  });

  describe("given a stored parameter the editor does not offer", () => {
    it("leaves that one out rather than failing the whole list", () => {
      expect(
        toCustomModelEntry(
          { id: "m", label: "M", supportedParameters: ["temperature", "response_format"] },
          "chat",
        ),
      ).toEqual({
        modelId: "m",
        displayName: "M",
        mode: "chat",
        supportedParameters: ["temperature"],
      });
    });
  });
});

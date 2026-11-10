import { mergeCustomModelMetadata } from "@langwatch/model-provider-contract";
import { FALLBACK_MAX_TOKENS } from "@langwatch/prompt-contract";
import { describe, expect, it } from "vitest";

import { getMaxTokenLimit } from "../max-token-limit.ts";
import { buildModelChangeValues } from "../max-tokens.utils.ts";

/** A custom model's metadata exactly as the model-provider contract builds it. */
function customModelMetadata({ maxTokens }: { maxTokens?: number | null }) {
  const metadata = mergeCustomModelMetadata(
    {},
    {
      custom: {
        provider: "custom",
        customModels: [{ modelId: "glm-chat", displayName: "GLM chat", mode: "chat", maxTokens }],
        customEmbeddingsModels: [],
      },
    },
  );
  return metadata["custom/glm-chat"];
}

describe("getMaxTokenLimit", () => {
  describe("given a custom chat model registered without a Max Tokens ceiling", () => {
    /** @scenario "A custom model with no Max Tokens ceiling falls back to the default limit" */
    it("reads the default limit, not the zero context length, and a model switch saves it", () => {
      const metadata = customModelMetadata({ maxTokens: null });
      expect(metadata?.contextLength).toBe(0);

      expect(getMaxTokenLimit(metadata)).toBe(FALLBACK_MAX_TOKENS);

      const switched = buildModelChangeValues({
        newModel: "custom/glm-chat",
        newModelMetadata: metadata,
      });
      expect(switched.maxTokens).toBe(FALLBACK_MAX_TOKENS);
      expect(switched.max_tokens).toBe(FALLBACK_MAX_TOKENS);
    });

    it("reads the default limit when the ceiling is absent rather than null", () => {
      expect(getMaxTokenLimit(customModelMetadata({}))).toBe(FALLBACK_MAX_TOKENS);
    });
  });

  describe("given a custom chat model with a Max Tokens ceiling", () => {
    it("reads the configured ceiling", () => {
      expect(getMaxTokenLimit(customModelMetadata({ maxTokens: 32768 }))).toBe(32768);
    });
  });

  describe("given no model metadata", () => {
    it("reads the default limit", () => {
      expect(getMaxTokenLimit(undefined)).toBe(FALLBACK_MAX_TOKENS);
    });
  });
});

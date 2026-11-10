import type { ModelMetadataForFrontend } from "@langwatch/model-provider-contract";
import { FALLBACK_MAX_TOKENS } from "@langwatch/prompt-contract";

/** A count of zero or less is unknown: a custom model with no ceiling carries contextLength 0. */
const positiveOrUnknown = (count: number | null | undefined): number | undefined =>
  typeof count === "number" && count > 0 ? count : undefined;

/**
 * The ceiling a model will accept for one completion. Lives in the package-global model, not
 * beside the LLM-parameter surface, because `behavior` reads it too. Never zero: a zero would
 * become the max tokens default and cap the slider. Spec: custom-model-max-tokens.feature.
 */
export function getMaxTokenLimit(modelMetadata: ModelMetadataForFrontend | undefined): number {
  return (
    positiveOrUnknown(modelMetadata?.maxCompletionTokens) ??
    positiveOrUnknown(modelMetadata?.contextLength) ??
    FALLBACK_MAX_TOKENS
  );
}

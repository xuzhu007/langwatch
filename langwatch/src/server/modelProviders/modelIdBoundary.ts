/**
 * Model ID translation at the LiteLLM boundary.
 *
 * LiteLLM expects SOME provider model IDs with dashes, but our registry/source-of-truth
 * can contain dots (usually version numbers).
 *
 * Example (Anthropic): "anthropic/claude-opus-4.5" -> "anthropic/claude-opus-4-5"
 *
 * Additionally, some models require alias expansion to their full dated versions.
 * Example: "anthropic/claude-sonnet-4" -> "anthropic/claude-sonnet-4-20250514"
 *
 * IMPORTANT: This logic is duplicated in Python (langwatch_nlp/studio/utils.py).
 * Changes here MUST be mirrored there.
 * @see langwatch_nlp/langwatch_nlp/studio/utils.py#translate_model_id_for_litellm
 */

/**
 * Model aliases that need expansion to their full dated versions.
 * LiteLLM requires the full dated version for certain models.
 */
const MODEL_ALIASES: Record<string, string> = {
  "anthropic/claude-sonnet-4": "anthropic/claude-sonnet-4-20250514",
  "anthropic/claude-opus-4": "anthropic/claude-opus-4-20250514",
  "anthropic/claude-3.5-haiku": "anthropic/claude-3-5-haiku-20241022",
  "anthropic/claude-3.5-sonnet": "anthropic/claude-3-5-sonnet-20240620",
};

/**
 * Providers that need dot-to-dash translation for their model IDs.
 *
 * IMPORTANT: Do NOT apply this to OpenAI-compatible "custom" providers.
 * Custom model ids are opaque identifiers owned by the upstream endpoint
 * (e.g. internal MaaS), and rewriting them breaks routing.
 */
const PROVIDERS_NEEDING_TRANSLATION = ["anthropic"];

/**
 * Extracts the provider from a model ID string.
 * @param modelId - Full model ID (e.g., "anthropic/claude-3.5-sonnet")
 * @returns Provider name or empty string if no prefix
 */
function getProvider(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex === -1) {
    return "";
  }
  return modelId.slice(0, slashIndex).toLowerCase();
}

function isBareAnthropicModelId(modelId: string): boolean {
  return /^claude-/i.test(modelId);
}

/**
 * Translates a model ID for use with LiteLLM.
 *
 * Order matters:
 * 1) exact alias expansion (full-string match)
 * 2) dot→dash translation for selected providers
 */
export function translateModelIdForLitellm(modelId: string): string {
  if (!modelId) {
    return modelId;
  }

  // First, check for exact alias matches that need expansion
  if (MODEL_ALIASES[modelId]) {
    return MODEL_ALIASES[modelId];
  }

  const provider = getProvider(modelId);

  // Only translate providers that need it.
  // For legacy/unknown provider-less ids, ONLY translate anthropic-shaped ones
  // (e.g. "claude-3.5-sonnet"). Do not rewrite arbitrary bare ids.
  const needsTranslation =
    PROVIDERS_NEEDING_TRANSLATION.includes(provider) ||
    (provider === "" && isBareAnthropicModelId(modelId));

  if (!needsTranslation) {
    return modelId;
  }

  // Replace dots with dashes in the entire model ID
  return modelId.replace(/\./g, "-");
}

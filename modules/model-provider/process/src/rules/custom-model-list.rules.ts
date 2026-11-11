import {
  multimodalInputValues,
  supportedParameterValues,
  type CustomModelEntry,
  type Model,
} from "@langwatch/model-provider-contract";

/** A stored custom model: its ceiling and capabilities travel with it. */
export type StoredCustomModel = Pick<
  Model,
  "id" | "label" | "maxTokens" | "supportedParameters" | "multimodalInputs"
>;

/**
 * A customer's custom model list, in whichever shape they sent it.
 */
export function toCanonicalCustomModelList(
  value: unknown,
  type: "chat" | "embedding",
): (StoredCustomModel & { type: "chat" | "embedding" })[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value.flatMap((model) => {
    if (typeof model === "string") return [{ id: model, label: model, type }];
    if (!model || typeof model !== "object") return [];
    const item = model as Record<string, unknown>;

    return typeof item.modelId === "string"
      ? [
          {
            id: item.modelId,
            label: typeof item.displayName === "string" ? item.displayName : item.modelId,
            type,
            ...sentCapabilities(item),
          },
        ]
      : [];
  });
}

/** A stored custom model as the browser edits it; no ceiling and empty lists are left out. */
export function toCustomModelEntry(
  model: StoredCustomModel,
  mode: CustomModelEntry["mode"],
): CustomModelEntry {
  const supportedParameters = knownValues(model.supportedParameters, supportedParameterValues);
  const multimodalInputs = knownValues(model.multimodalInputs, multimodalInputValues);

  return {
    modelId: model.id,
    displayName: model.label,
    mode,
    ...(isPositive(model.maxTokens) ? { maxTokens: model.maxTokens } : {}),
    ...(supportedParameters.length > 0 ? { supportedParameters } : {}),
    ...(multimodalInputs.length > 0 ? { multimodalInputs } : {}),
  };
}

function sentCapabilities(
  item: Record<string, unknown>,
): Pick<StoredCustomModel, "maxTokens" | "supportedParameters" | "multimodalInputs"> {
  // The execution path parses these against the known names; an unknown one would fail every run.
  const supportedParameters = Array.isArray(item.supportedParameters)
    ? knownValues(item.supportedParameters, supportedParameterValues)
    : undefined;
  const multimodalInputs = Array.isArray(item.multimodalInputs)
    ? knownValues(item.multimodalInputs, multimodalInputValues)
    : undefined;

  return {
    ...(isPositive(item.maxTokens) ? { maxTokens: item.maxTokens } : {}),
    ...(supportedParameters ? { supportedParameters } : {}),
    ...(multimodalInputs ? { multimodalInputs } : {}),
  };
}

function knownValues<T extends string>(value: unknown, known: readonly T[]): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is T => known.some((name) => name === entry));
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

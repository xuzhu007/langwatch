import { DEFAULT_EMBEDDINGS_MODEL, DEFAULT_MODEL } from "../../utils/constants";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorDefinition,
  type Evaluators,
  type EvaluatorTypes,
} from "./evaluators.generated";

export const getEvaluatorDefinitions = (evaluator: string) => {
  for (const [key, val] of Object.entries(AVAILABLE_EVALUATORS)) {
    if (key === evaluator) return val;
  }
  return undefined;
};

export const getEvaluatorDefaultSettings = <T extends EvaluatorTypes>(
  evaluator: EvaluatorDefinition<T> | undefined,
  project?: { defaultModel?: string | null; embeddingsModel?: string | null },
) => {
  if (!evaluator) return {};
  return Object.fromEntries(
    Object.entries(evaluator.settings).map(([key, setting]) => {
      if (key === "model") {
        const settingDefault = (setting as any).default;
        // Use project default for standard LLM models (format: "provider/model")
        // but keep specialized defaults (e.g. "text-moderation-stable" for OpenAI Moderation)
        if (
          typeof settingDefault === "string" &&
          settingDefault.includes("/")
        ) {
          return [key, project?.defaultModel ?? DEFAULT_MODEL];
        }
        return [key, settingDefault];
      }
      if (key === "embeddings_model") {
        return [key, project?.embeddingsModel ?? DEFAULT_EMBEDDINGS_MODEL];
      }
      return [key, (setting as any).default];
    }),
  ) as Evaluators[T]["settings"];
};

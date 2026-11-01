import { z } from "zod";

import { parseJSON } from "./content-format.ts";
import type { ChatMessage } from "./types.ts";

const functionSchema = z.object({ name: z.string().min(1), arguments: z.unknown().optional() });
const callSchema = z
  .object({
    id: z.unknown().optional(),
    type: z.unknown().optional(),
    function: z.unknown().optional(),
  })
  .passthrough();

/** Accept the stringified and flattened tool calls emitted by older gateways. */
export function normalizeToolCalls(raw: unknown): ChatMessage["tool_calls"] {
  const value = typeof raw === "string" ? parseJSON(raw) : raw;
  const calls: NonNullable<ChatMessage["tool_calls"]> = [];

  for (const item of Array.isArray(value) ? value : [value]) {
    const call = callSchema.safeParse(item);
    if (!call.success) continue;
    const fn = functionSchema.safeParse(call.data.function ?? item);
    if (!fn.success) continue;
    calls.push({
      function: {
        name: fn.data.name,
        arguments:
          typeof fn.data.arguments === "string"
            ? fn.data.arguments
            : JSON.stringify(fn.data.arguments ?? {}),
      },
      id: typeof call.data.id === "string" ? call.data.id : "",
      type: typeof call.data.type === "string" ? call.data.type : "function",
    });
  }

  return calls.length > 0 ? calls : void 0;
}

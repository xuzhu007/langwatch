import { generate } from "@langwatch/ksuid";

export function generateClientId(): string {
  return generate("client").toString();
}

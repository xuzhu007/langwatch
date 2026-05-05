import { generate } from "@langwatch/ksuid";

/**
 * Generate a client-safe identifier using LangWatch's KSUID generator.
 *
 * `@langwatch/ksuid` relies on `crypto.getRandomValues`, which works in
 * modern browsers even when the app is served over plain HTTP.
 */
export function generateClientId(): string {
  return generate("client").toString();
}

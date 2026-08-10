import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

export function createTabId() {
  return generate(KSUID_RESOURCES.PLAYGROUND_TAB).toString();
}

export function createWindowId() {
  return generate(KSUID_RESOURCES.PLAYGROUND_WINDOW).toString();
}

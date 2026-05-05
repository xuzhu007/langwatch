import { generateClientId } from "~/utils/generateClientId";

export function createTabId() {
  return `tab-${generateClientId()}`;
}

export function createWindowId() {
  return `window-${generateClientId()}`;
}

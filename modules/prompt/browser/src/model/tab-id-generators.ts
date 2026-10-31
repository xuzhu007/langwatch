import { generate } from "@langwatch/ksuid";

export function createTabId() {
  return generate("pgtab").toString();
}

export function createWindowId() {
  return generate("pgwindow").toString();
}

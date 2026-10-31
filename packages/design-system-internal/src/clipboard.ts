/** Copies from HTTPS or an internal HTTP host, including a denied modern API. */
export const writeClipboardText = async ({ text }: { text: string }): Promise<void> => {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some browsers expose the API but reject permission; try the DOM fallback.
    }
  }
  const scratch = document.createElement("textarea");
  try {
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    scratch.className = "ds-visually-hidden";
    document.body.append(scratch);
    scratch.focus();
    scratch.select();
    if (!document.execCommand("copy")) throw new Error("The browser refused to copy.");
  } finally {
    scratch.remove();
  }
};

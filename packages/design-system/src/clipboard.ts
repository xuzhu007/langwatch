/** Copies through the modern API, with a DOM fallback on HTTP or permission failure. */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 优先使用现代 Clipboard API。
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 失败后继续尝试 execCommand 降级方案。
    }
  }

  // 降级方案：通过临时 textarea 调用旧版 execCommand("copy")。
  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    try {
      textarea.value = text;
      // 移出屏幕，避免可见闪烁。
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      textarea.remove();
    }
  }

  return false;
}

/** Clipboard API compatible form for callers that handle failure with catch. */
export async function writeClipboardText(text: string): Promise<void> {
  if (!(await copyToClipboard(text))) {
    throw new Error("The browser refused to copy.");
  }
}

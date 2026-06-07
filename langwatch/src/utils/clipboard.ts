/**
 * 复制文本到剪贴板，并兼容非安全上下文。
 *
 * 降级链路：
 * 1. navigator.clipboard.writeText()：安全上下文可用（HTTPS / localhost）
 * 2. 通过临时 textarea 调用 document.execCommand("copy")：HTTP 下可用
 *
 * @returns 复制成功返回 true，否则返回 false
 */
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
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      // 移出屏幕，避免可见闪烁。
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }

  return false;
}

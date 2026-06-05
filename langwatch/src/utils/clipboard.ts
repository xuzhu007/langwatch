export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 继续尝试 HTTP 环境可用的降级方案。
    }
  }

  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";

    try {
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      if (document.execCommand("copy")) {
        return;
      }
    } catch {
      // 降级复制失败时统一在函数末尾抛出错误。
    } finally {
      textarea.remove();
    }
  }
  throw new Error("clipboard unavailable");
}

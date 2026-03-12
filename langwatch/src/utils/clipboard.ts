/**
 * Copies text to the clipboard, with fallback for non-secure contexts (HTTP).
 *
 * `navigator.clipboard` is only available in secure contexts (HTTPS / localhost).
 * This utility falls back to the legacy `document.execCommand("copy")` approach
 * when the Clipboard API is unavailable (e.g. HTTP intranet deployments).
 *
 * @returns `true` if the copy succeeded, `false` otherwise.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Prefer the modern Clipboard API when available
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API may throw even when present (e.g. permission denied);
      // fall through to legacy approach.
    }
  }

  // Legacy fallback using a temporary textarea + execCommand
  if (typeof document !== "undefined") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      // Prevent scrolling to bottom
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      return success;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * 生成 UUID v4，并兼容非安全上下文。
 *
 * 降级链路：
 * 1. crypto.getRandomValues()：现代浏览器可用，HTTP 下也可用
 * 2. Math.random()：最后兜底（SSR 或很旧的环境）
 */
export function generateUUID(): string {
  // 优先使用 crypto.getRandomValues，HTTP 下也可用。
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // 按 RFC 4122 设置 version (4) 和 variant (10xx) 位。
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-");
  }

  // 最后兜底：Math.random（例如没有 crypto 的 SSR 环境）。
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

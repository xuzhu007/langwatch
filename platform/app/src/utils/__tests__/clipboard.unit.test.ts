/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "../clipboard";

const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const execCommandDescriptor = Object.getOwnPropertyDescriptor(
  document,
  "execCommand",
);

describe("copyToClipboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (clipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
    if (execCommandDescriptor) {
      Object.defineProperty(document, "execCommand", execCommandDescriptor);
    } else {
      Reflect.deleteProperty(document, "execCommand");
    }
  });

  it("优先使用现代 Clipboard API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await expect(copyToClipboard("modern")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("modern");
  });

  it("HTTP 下缺少 Clipboard API 时使用 execCommand 降级", async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await expect(copyToClipboard("fallback")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("现代 API 拒绝后继续使用 execCommand 降级", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await expect(copyToClipboard("fallback")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("execCommand 抛错时返回失败并清理临时节点", async () => {
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        throw new Error("blocked");
      }),
    });

    await expect(copyToClipboard("fallback")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });
});

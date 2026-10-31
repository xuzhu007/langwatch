/** @vitest-environment jsdom */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackupCodesPanel } from "../../../features/two-step-verification/ui/blocks/backup-codes-panel.tsx";

const host = vi.hoisted(() => ({ succeeded: vi.fn(), failed: vi.fn() }));
vi.mock("../../../model/personal-workspace-host.ts", () => ({
  usePersonalWorkspaceHost: () => host,
}));
const codes = ["11111111", "22222222", "33333333"];
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
const execCommand = vi.fn(() => true);
let copiedText: string | undefined;
function clickCopy() {
  render(
    <DesignSystemProvider>
      <BackupCodesPanel codes={codes} onDone={() => {}} />
    </DesignSystemProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy all" }));
}
beforeEach(() => {
  vi.clearAllMocks();
  copiedText = undefined;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  execCommand.mockImplementation(() => {
    copiedText = (document.activeElement as HTMLTextAreaElement).value;
    return true;
  });
  Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
});
afterEach(() => {
  cleanup();
  if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
  if (execCommandDescriptor) Object.defineProperty(document, "execCommand", execCommandDescriptor);
  else Reflect.deleteProperty(document, "execCommand");
});
describe("backup code copying over HTTP", () => {
  /** @scenario "HTTP 页面可以复制恢复码和配置值" */
  it("copies all codes and reports success when the modern API is absent", async () => {
    clickCopy();
    await waitFor(() =>
      expect(host.succeeded).toHaveBeenCalledWith({ title: "Backup codes copied" }),
    );
    expect(copiedText).toBe(codes.join("\n"));
    expect(document.querySelector("textarea")).toBeNull();
  });
  /** @scenario "所有复制方式失败时提示手动复制" */
  it("reports manual-copy guidance when every copy method fails", async () => {
    execCommand.mockReturnValue(false);
    clickCopy();
    await waitFor(() =>
      expect(host.failed).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/copy.*by hand/i) }),
      ),
    );
    expect(host.succeeded).not.toHaveBeenCalled();
  });
  /** @scenario "安全上下文优先使用现代剪贴板接口" */
  it("prefers the modern API in a secure context", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    clickCopy();
    await waitFor(() => expect(host.succeeded).toHaveBeenCalled());
    expect(writeText).toHaveBeenCalledWith(codes.join("\n"));
    expect(execCommand).not.toHaveBeenCalled();
  });
  /** @scenario "现代剪贴板接口拒绝时继续尝试兼容方式" */
  it("falls back to the DOM after modern API rejection", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    clickCopy();
    await waitFor(() => expect(host.succeeded).toHaveBeenCalled());
    expect(copiedText).toBe(codes.join("\n"));
    expect(document.querySelector("textarea")).toBeNull();
  });
});

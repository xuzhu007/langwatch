/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackupCodesPanel } from "../me/twoFactor/BackupCodesPanel";
import { CopyValueRows } from "../settings/CopyValueRows";

const toaster = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  create: vi.fn(),
}));
vi.mock("../ui/toaster", () => ({ toaster }));

const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const execCommandDescriptor = Object.getOwnPropertyDescriptor(
  document,
  "execCommand",
);
const CODES = ["11111111", "22222222", "33333333"];
const VALUE = "verification=review-token";

describe.each([
  { component: "恢复码面板", button: "Copy all", text: CODES.join("\n") },
  { component: "配置值列表", button: "Copy DNS record", text: VALUE },
])("$component 的剪贴板兼容性", ({ component, button, text }) => {
  const success = component === "恢复码面板" ? toaster.success : toaster.create;
  const error = component === "恢复码面板" ? toaster.error : toaster.create;
  let copiedText: string | undefined;
  let execCommand: ReturnType<typeof vi.fn>;

  function renderSubject() {
    render(
      <ChakraProvider value={defaultSystem}>
        {component === "恢复码面板" ? (
          <BackupCodesPanel codes={CODES} onDone={vi.fn()} />
        ) : (
          <CopyValueRows rows={[{ label: "DNS record", value: VALUE }]} />
        )}
      </ChakraProvider>,
    );
  }

  beforeEach(() => {
    copiedText = undefined;
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    execCommand = vi.fn(() => {
      copiedText = (document.activeElement as HTMLTextAreaElement).value;
      return true;
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
  });

  afterEach(() => {
    cleanup();
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

  describe("当浏览器未提供现代剪贴板接口时", () => {
    /** @scenario HTTP 页面可以复制恢复码和配置值 */
    it("点击按钮复制完整内容并提示成功", async () => {
      renderSubject();
      fireEvent.click(screen.getByRole("button", { name: button }));

      await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
      expect(copiedText).toBe(text);
      expect(success).toHaveBeenCalledWith(
        expect.objectContaining(
          component === "恢复码面板"
            ? { title: "Backup codes copied" }
            : { type: "success" },
        ),
      );
      expect(document.querySelector("textarea")).toBeNull();
    });

    /** @scenario 所有复制方式失败时提示手动复制 */
    it("兼容方式失败时提示手动复制且不提示成功", async () => {
      execCommand.mockReturnValue(false);
      renderSubject();
      fireEvent.click(screen.getByRole("button", { name: button }));

      await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining(
          component === "恢复码面板"
            ? { description: expect.stringMatching(/copy.*by hand/i) }
            : { title: expect.stringMatching(/manually/i), type: "error" },
        ),
      );
      if (component === "恢复码面板") {
        expect(success).not.toHaveBeenCalled();
      } else {
        expect(toaster.create).not.toHaveBeenCalledWith(
          expect.objectContaining({ type: "success" }),
        );
      }
    });

    if (component === "配置值列表") {
      /** @scenario HTTP 页面点击配置值行也可以复制 */
      it("点击整行复制该值并提示成功", async () => {
        renderSubject();
        fireEvent.click(screen.getByText(VALUE));

        await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
        expect(copiedText).toBe(VALUE);
        expect(toaster.create).toHaveBeenCalledWith(
          expect.objectContaining({ type: "success" }),
        );
      });
    }
  });

  describe("当浏览器提供现代剪贴板接口时", () => {
    /** @scenario 安全上下文优先使用现代剪贴板接口 */
    it("优先使用现代接口并提示成功", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      renderSubject();
      fireEvent.click(screen.getByRole("button", { name: button }));

      await waitFor(() => expect(success).toHaveBeenCalled());
      expect(writeText).toHaveBeenCalledWith(text);
      expect(execCommand).not.toHaveBeenCalled();
    });

    /** @scenario 现代剪贴板接口拒绝时继续尝试兼容方式 */
    it("现代接口拒绝后仍然复制完整内容", async () => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      });
      renderSubject();
      fireEvent.click(screen.getByRole("button", { name: button }));

      await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
      expect(copiedText).toBe(text);
      expect(success).toHaveBeenCalledWith(
        expect.objectContaining(
          component === "恢复码面板" ? { title: "Backup codes copied" } : { type: "success" },
        ),
      );
    });
  });
});

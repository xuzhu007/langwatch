/** @vitest-environment jsdom */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyValueRow } from "../copy-value-row.tsx";
const toaster = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@langwatch/design-system/toaster", () => ({ toaster }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("CopyValueRow on an internal HTTP host", () => {
  /** @scenario "HTTP 页面点击配置值行也可以复制" */
  /** @scenario "HTTP 页面可以复制恢复码和配置值" */
  it("copies the displayed value when its text is clicked", async () => {
    const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const command = Object.getOwnPropertyDescriptor(document, "execCommand");
    let copied: string | undefined;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => {
        copied = (document.activeElement as HTMLTextAreaElement).value;
        return true;
      },
    });
    try {
      renderWithDesignSystem(<CopyValueRow label="DNS record" value="verification=test" />);
      fireEvent.click(screen.getByText("verification=test"));
      await waitFor(() =>
        expect(toaster.create).toHaveBeenCalledWith(expect.objectContaining({ type: "success" })),
      );
      expect(copied).toBe("verification=test");
      expect(document.querySelector("textarea")).toBeNull();
    } finally {
      if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
      if (command) Object.defineProperty(document, "execCommand", command);
      else Reflect.deleteProperty(document, "execCommand");
    }
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY_FEEDBACK_MS, CopyButton } from "../copy-button.tsx";

const stubClipboard = ({ writeText }: { writeText: (text: string) => Promise<void> }) => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
};

const clickCopy = async ({ name }: { name: string }) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

describe("CopyButton", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("when clicked", () => {
    it("writes the value to the clipboard and names itself Copied", async () => {
      const writeText = vi.fn((_text: string) => Promise.resolve());
      stubClipboard({ writeText });
      render(<CopyButton value="app.main.langwatch.localhost" label="Copy hostname" />);

      await clickCopy({ name: "Copy hostname" });

      expect(writeText).toHaveBeenCalledWith("app.main.langwatch.localhost");
      expect(screen.getByRole("status").textContent).toBe("Copied");
      expect(screen.getByRole("button").getAttribute("aria-label")).toBe("Copied");
    });

    it("returns to its idle name once the feedback window passes", async () => {
      stubClipboard({ writeText: () => Promise.resolve() });
      render(<CopyButton value="5560" label="Copy port" />);

      await clickCopy({ name: "Copy port" });
      act(() => {
        vi.advanceTimersByTime(COPY_FEEDBACK_MS);
      });

      expect(screen.getByRole("button").getAttribute("aria-label")).toBe("Copy port");
    });
  });

  it.each([false, true])(
    "copies over HTTP or after modern API rejection (modern=%s)",
    async (modern) => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: modern ? { writeText: () => Promise.reject(new Error("denied")) } : undefined,
      });
      const execCommand = vi.fn(() => {
        expect(document.activeElement).toBeInstanceOf(HTMLTextAreaElement);
        expect((document.activeElement as HTMLTextAreaElement).value).toBe("internal-value");
        return true;
      });
      const descriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
      Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
      try {
        render(<CopyButton value="internal-value" />);
        await clickCopy({ name: "Copy" });
        expect(execCommand).toHaveBeenCalledWith("copy");
        expect(screen.getByRole("status").textContent).toBe("Copied");
        expect(document.querySelector("textarea")).toBeNull();
      } finally {
        if (descriptor) Object.defineProperty(document, "execCommand", descriptor);
        else Reflect.deleteProperty(document, "execCommand");
      }
    },
  );

  describe("when the clipboard refuses", () => {
    it("names itself Copy failed", async () => {
      stubClipboard({ writeText: () => Promise.reject(new Error("denied")) });
      render(<CopyButton value="secret-free" />);

      await clickCopy({ name: "Copy" });

      expect(screen.getByRole("button").getAttribute("aria-label")).toBe("Copy failed");
    });
  });
});

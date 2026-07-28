import { useCallback, useEffect, useRef, useState } from "react";
import { copyToClipboard } from "~/utils/clipboard";

/**
 * Single shared duration for the transient "copied ✓" confirmation across
 * every copy button in traces-v2. Previously each site hard-coded its own
 * value (1200 / 1500 / 2000ms), so the feedback flickered for a different
 * length depending on which button you clicked. Consolidated to 1500ms.
 */
export const COPY_FEEDBACK_MS = 1500;

/**
 * The "copy to clipboard, then flash a ✓ for a beat" pattern, extracted from
 * the ~9 hand-rolled `useState(false)` + `setTimeout` copies that used to
 * live across the trace drawer / toolbar.
 *
 * `copy(text)` writes to the clipboard and — only once the write actually
 * resolves — flips `copied` true for {@link COPY_FEEDBACK_MS}, then back.
 * Awaiting the promise keeps the confirmation honest: on permission-denied
 * (Safari private mode, non-secure contexts) nothing reached the clipboard,
 * so we must not claim success. Rejections are swallowed: the surfaces are
 * tiny buttons with no slot for an error string, and the user can retry.
 *
 * Rapid repeat copies coalesce onto a single timer (each call re-arms it),
 * and the timer is cleared on unmount so a pending reset can't fire into an
 * unmounted component.
 */
export function useCopyToClipboard(): {
  copied: boolean;
  copy: (text: string) => void;
} {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  const copy = useCallback(
    (text: string) => {
      void copyToClipboard(text).then((copied) => {
        if (copied) {
          // The write can resolve after the component unmounts; don't touch
          // state then (avoids a React set-state-on-unmounted no-op warning).
          if (!mountedRef.current) return;
          setCopied(true);
          clearTimer();
          timerRef.current = setTimeout(() => {
            setCopied(false);
            timerRef.current = null;
          }, COPY_FEEDBACK_MS);
        }
        // 复制失败时保持静默：小图标按钮没有错误文本空间，用户可重试。
      });
    },
    [clearTimer],
  );

  return { copied, copy };
}

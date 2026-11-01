import { useCallback, useEffect, useRef, useState } from "react";

import { copyToClipboard } from "./clipboard.ts";

/**
 * Single shared duration for the "copied ✓" confirmation across every copy
 * button in traces-v2. Each site previously hard-coded its own value
 * (1200/1500/2000ms), flickering differently per button. Consolidated.
 */
export const COPY_FEEDBACK_MS = 1500;

/**
 * Copy text to clipboard and flash `copied: true` for {@link COPY_FEEDBACK_MS}.
 * Rapid repeats coalesce onto one timer; cleared on unmount.
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

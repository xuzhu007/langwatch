import { useEffect, useRef, useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { SLACK_APP_MANIFEST } from "~/features/automations/providers/slack/slackAppManifest";
import { copyToClipboard } from "~/utils/clipboard";

const COPIED_FOR_MS = 1500;

/** Copies the Slack app manifest, reporting "copied" briefly or a toast when the clipboard refuses. */
export function useCopySlackAppManifest() {
  const [isCopied, setIsCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    },
    [],
  );

  const copyManifest = () => {
    // fork 定制：内网自托管走纯 HTTP，Clipboard API 不可用，copyToClipboard
    // 会降级到 execCommand("copy")；两条路都失败才提示手动复制。
    void copyToClipboard(SLACK_APP_MANIFEST).then((copied) => {
      if (!copied) {
        copyFailed();
        return;
      }
      setIsCopied(true);
      copyResetTimer.current = setTimeout(
        () => setIsCopied(false),
        COPIED_FOR_MS,
      );
    });
  };

  return { isCopied, copyManifest };
}

function copyFailed() {
  toaster.create({
    type: "error",
    title: "Couldn't copy the manifest",
    description: "Select the manifest text and copy it manually.",
  });
}

import { copyToClipboard } from "@langwatch/design-system/clipboard";
import { CopyButton } from "@langwatch/design-system/copy-button";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One fact to publish elsewhere: what it is called, what it says, and a way
 * to take it without retyping it. Every value here is meant to be pasted
 * into somebody else's administration screen, so none of it is truncated.
 */
import { HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { toaster } from "@langwatch/design-system/toaster";

export function CopyValueRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  /** What the value is for, where the label alone does not say it. */
  hint?: string;
}) {
  const copyValue = async () => {
    const copied = await copyToClipboard(value);
    toaster.create(
      copied
        ? { title: `${label} copied`, type: "success" }
        : { title: "Copy failed; please copy the value manually", type: "error" },
    );
  };
  return (
    <HStack gap={2} align="start" width="full" data-testid="copy-value-row">
      <VStack align="start" gap={0} minWidth="7rem" flexShrink={0}>
        <Text fontSize="xs" color="fg.muted">
          {label}
        </Text>
        {hint && (
          <Text fontSize="xs" color="fg.subtle">
            {hint}
          </Text>
        )}
      </VStack>
      <Text
        as="button"
        cursor="pointer"
        onClick={() => void copyValue()}
        textStyle="monoSm"
        wordBreak="break-all"
        flex={1}
      >
        {value}
      </Text>
      <CopyButton value={value} label={label} aria-label={`Copy ${label}`} />
    </HStack>
  );
}

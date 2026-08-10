import { Button, type ButtonProps } from "@chakra-ui/react";
import { CopyIcon } from "lucide-react";
import { copyToClipboard } from "~/utils/clipboard";
import { toaster } from "./ui/toaster";

interface CopyButtonProps
  extends Omit<ButtonProps, "value" | "label" | "onClick"> {
  value: string;
  label: string;
}

export function CopyButton(props: CopyButtonProps) {
  const { value, label, ...rest } = props;

  return (
    <Button
      variant="ghost"
      data-variant="ghost"
      size="sm"
      cursor="pointer"
      onClick={(event) => {
        if (!value) return;
        event.stopPropagation();
        void copyToClipboard(value).then((copied) => {
          toaster.create({
            title: copied
              ? `${label} copied to your clipboard`
              : `Unable to copy ${label}, please copy it manually`,
            type: copied ? "success" : "error",
            duration: 2000,
            meta: {
              closable: true,
            },
          });
        });
      }}
      {...rest}
    >
      <CopyIcon width={14} height={14} />
    </Button>
  );
}

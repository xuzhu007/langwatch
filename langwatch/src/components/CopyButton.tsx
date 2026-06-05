import { Button, type ButtonProps } from "@chakra-ui/react";
import { CopyIcon } from "lucide-react";
import { copyTextToClipboard } from "~/utils/clipboard";
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

        void (async () => {
          await copyTextToClipboard(value);
          toaster.create({
            title: `${label} copied to your clipboard`,
            type: "success",
            duration: 2000,
            meta: {
              closable: true,
            },
          });
        })();
      }}
      {...rest}
    >
      <CopyIcon width={14} height={14} />
    </Button>
  );
}

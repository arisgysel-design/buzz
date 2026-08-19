import { Plus } from "lucide-react";

import { Button } from "@/shared/ui/button";

type CreateNewButtonProps = {
  ariaLabel?: string;
  dataTestId?: string;
  disabled?: boolean;
  label?: string;
  labelClassName?: string;
  onClick: () => void;
  variant?: "default" | "outline";
};

export function CreateNewButton({
  ariaLabel,
  dataTestId,
  disabled = false,
  label = "New",
  labelClassName,
  onClick,
  variant = "default",
}: CreateNewButtonProps) {
  return (
    <Button
      aria-label={ariaLabel}
      data-testid={dataTestId}
      disabled={disabled}
      onClick={onClick}
      size="sm"
      type="button"
      variant={variant}
    >
      <Plus className="h-4 w-4" />
      <span className={labelClassName}>{label}</span>
    </Button>
  );
}

import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "outline" | "ghost";
type ButtonSize = "default" | "sm" | "icon";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "bg-[var(--accent)] text-white hover:bg-[color:rgba(180,143,104,0.95)]",
  outline:
    "border border-[var(--line)] bg-white text-[var(--foreground)] hover:bg-[var(--panel-soft)]",
  ghost: "text-[var(--foreground)] hover:bg-[var(--panel-soft)]",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-9 rounded-md px-3",
  sm: "h-8 rounded-md px-2.5 text-xs",
  icon: "h-8 w-8 rounded-md",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "default", size = "default", type = "button", ...props },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-60",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  ),
);

Button.displayName = "Button";

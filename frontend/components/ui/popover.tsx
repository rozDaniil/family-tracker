"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  className,
  sideOffset = 6,
  ...props
}: PopoverPrimitive.PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        className={`z-50 rounded-xl border border-[var(--line)] bg-white p-0 shadow-[0_8px_28px_rgba(89,66,39,.16)] ${className ?? ""}`}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

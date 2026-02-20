"use client";

import * as React from "react";
import { DayPicker } from "react-day-picker";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      locale={ru}
      showOutsideDays={showOutsideDays}
      className={cn("p-2", className)}
      classNames={{
        root: "rdp-root",
        months: "flex flex-col",
        month: "space-y-3",
        caption: "flex items-center justify-between px-1 pt-1",
        caption_label:
          "text-sm font-semibold capitalize text-[var(--accent-ink)]",
        nav: "flex items-center gap-1",
        button_previous:
          "inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--line)] bg-white text-xs",
        button_next:
          "inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--line)] bg-white text-xs",
        month_grid: "w-full border-collapse",
        weekdays: "grid grid-cols-7",
        weekday:
          "text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:rgba(63,58,52,.68)]",
        week: "mt-1 grid grid-cols-7",
        day: "p-0 text-center text-sm",
        day_button:
          "mx-auto h-8 w-8 rounded-md p-0 text-sm transition hover:bg-[var(--panel-soft)]",
        // selected:
        //   "bg-transparent [&>button]:bg-[var(--accent)] [&>button]:text-white [&>button:hover]:bg-[color:rgba(180,143,104,0.95)]",
        today:
          "bg-transparent [&>button]:bg-[color:rgba(180,143,104,0.14)] [&>button]:text-[var(--accent-ink)]",
        outside: "text-[color:rgba(63,58,52,.38)]",
        range_start:
          "bg-transparent [&>button]:bg-[var(--accent)] [&>button]:text-white [&>button]:rounded-l-md [&>button]:rounded-r-none",
        range_middle:
          "bg-transparent [&>button]:bg-[color:rgba(180,143,104,0.2)] [&>button]:text-[var(--accent-ink)] [&>button]:rounded-none",
        range_end:
          "bg-transparent [&>button]:bg-[var(--accent)] [&>button]:text-white [&>button]:rounded-r-md [&>button]:rounded-l-none",
        disabled: "opacity-40",
        ...classNames,
      }}
      {...props}
    />
  );
}

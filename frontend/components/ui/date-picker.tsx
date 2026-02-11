"use client";

import { CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CalendarProps } from "@/components/ui/calendar";

function parseDateKey(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function formatDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Select date",
  allowClear = false,
  disabled = false,
  className,
  calendarProps,
}: {
  value?: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
  calendarProps?: Omit<CalendarProps, "mode" | "selected" | "onSelect">;
}) {
  const parsed = parseDateKey(value);

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled}
            className="w-full justify-start rounded-xl px-3 py-2 text-left font-normal"
          >
            <CalendarIcon className="h-4 w-4 text-[color:rgba(63,58,52,.7)]" />
            {parsed ? format(parsed, "dd.MM.yyyy") : <span>{placeholder}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={parsed}
            onSelect={(next) => {
              if (next) onChange(formatDateKey(next));
            }}
            {...calendarProps}
          />
        </PopoverContent>
      </Popover>
      {allowClear && value ? (
        <Button
          variant="outline"
          size="icon"
          disabled={disabled}
          aria-label="Clear date"
          onClick={() => onChange("")}
          className="rounded-xl"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

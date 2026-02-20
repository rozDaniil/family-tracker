"use client";

import { CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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

export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = "Select range",
  disabled = false,
  className,
}: {
  from?: string | null;
  to?: string | null;
  onChange: (range: { from: string; to: string }) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const fromDate = parseDateKey(from);
  const toDate = parseDateKey(to);
  const selectedRange: DateRange | undefined = fromDate
    ? { from: fromDate, to: toDate }
    : undefined;

  const label = fromDate
    ? toDate
      ? `${format(fromDate, "dd.MM.yyyy")} - ${format(toDate, "dd.MM.yyyy")}`
      : `${format(fromDate, "dd.MM.yyyy")} - ...`
    : placeholder;

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
            <span>{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="range"
            defaultMonth={fromDate}
            numberOfMonths={1}
            selected={selectedRange}
            onSelect={(next) => {
              if (!next || !next.from) {
                onChange({ from: "", to: "" });
                return;
              }
              onChange({
                from: formatDateKey(next.from),
                to: next.to ? formatDateKey(next.to) : "",
              });
            }}
          />
        </PopoverContent>
      </Popover>
      {from || to ? (
        <Button
          variant="outline"
          size="icon"
          disabled={disabled}
          aria-label="Clear range"
          onClick={() =>
            onChange({
              from: formatDateKey(new Date()),
              to: "",
            })
          }
          className="rounded-xl"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

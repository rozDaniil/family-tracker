"use client";

import { useMemo, useState } from "react";
import { Reveal } from "@/components/landing/reveal";
import { cn } from "@/lib/utils";

type RhythmPeriod = "day" | "week" | "month";

const PERIODS: { id: RhythmPeriod; label: string; summary: string; note: string }[] = [
  {
    id: "day",
    label: "День",
    summary: "Вечером спокойно собрались дома.",
    note: "Фокус на деталях конкретного дня.",
  },
  {
    id: "week",
    label: "Неделя",
    summary: "Больше совместных ужинов и прогулок.",
    note: "Ритм привычек за несколько дней.",
  },
  {
    id: "month",
    label: "Месяц",
    summary: "Появился устойчивый семейный темп.",
    note: "История месяца без спешки.",
  },
];

export function RhythmDemo() {
  const [active, setActive] = useState<RhythmPeriod>("month");

  const current = useMemo(() => PERIODS.find((p) => p.id === active) ?? PERIODS[2], [active]);

  return (
    <section className="grid gap-4 md:grid-cols-[.78fr_1fr] md:items-start">
      <Reveal>
        <article className="rounded-3xl bg-white/62 p-5">
          <p className="text-xs uppercase tracking-[0.12em] text-[color:rgba(63,58,52,.58)]">Ритм и история</p>
          <h2 className="mt-2 page-title text-4xl leading-[1.03] text-[var(--accent-ink)]">Видно не только день, но и путь.</h2>
          <p className="mt-3 text-sm leading-relaxed text-[color:rgba(63,58,52,.79)]">
            День показывает детали, неделя — движение, месяц — общую картину. Так прожитое складывается в понятную историю.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {PERIODS.map((period) => (
              <button
                key={period.id}
                type="button"
                onClick={() => setActive(period.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm",
                  active === period.id
                    ? "border-[var(--accent)] bg-[var(--panel-soft)] text-[var(--accent-ink)]"
                    : "border-[var(--line)] bg-white/85 text-[color:rgba(63,58,52,.78)]",
                )}
              >
                {period.label}
              </button>
            ))}
          </div>
        </article>
      </Reveal>

      <Reveal delayMs={100}>
        <article className="rounded-3xl bg-[var(--panel)]/82 p-4 md:p-5">
          <p className="mb-3 text-xs uppercase tracking-[0.12em] text-[color:rgba(63,58,52,.62)]">{current.label}</p>
          <div key={current.id} className="landing-morph space-y-3 rounded-2xl bg-white/84 p-4">
            <p className="text-sm font-semibold text-[var(--accent-ink)]">{current.summary}</p>
            <p className="text-xs text-[color:rgba(63,58,52,.72)]">{current.note}</p>
            {active === "day" ? (
              <div className="space-y-2 pt-1">
                <div className="rounded-lg bg-[color:rgba(90,71,53,.1)] p-2 text-xs text-[color:rgba(63,58,52,.8)]">Утро: спокойный сбор в школу</div>
                <div className="rounded-lg bg-[color:rgba(90,71,53,.14)] p-2 text-xs text-[color:rgba(63,58,52,.8)]">День: короткий звонок и поддержка</div>
                <div className="rounded-lg bg-[color:rgba(90,71,53,.1)] p-2 text-xs text-[color:rgba(63,58,52,.8)]">Вечер: вместе за столом</div>
                <div className="rounded-lg bg-[color:rgba(90,71,53,.08)] p-2 text-xs text-[color:rgba(63,58,52,.8)]">Перед сном: тихий разговор</div>
              </div>
            ) : null}

            {active === "week" ? (
              <div className="grid grid-cols-7 gap-1.5 pt-1">
                {Array.from({ length: 7 }).map((_, idx) => (
                  <div key={`week-${idx}`} className="space-y-1">
                    <div className="h-3 rounded-md bg-[color:rgba(90,71,53,.22)]" />
                    <div className="h-8 rounded-md bg-[color:rgba(90,71,53,.09)]" />
                    <div className="h-4 rounded-md bg-[color:rgba(90,71,53,.14)]" />
                  </div>
                ))}
              </div>
            ) : null}

            {active === "month" ? (
              <div className="grid grid-cols-7 gap-1 pt-1">
                {Array.from({ length: 35 }).map((_, idx) => (
                  <div
                    key={`month-${idx}`}
                    className={cn(
                      "h-4 rounded-[6px] bg-[color:rgba(90,71,53,.08)]",
                      idx % 6 === 0 && "bg-[color:rgba(90,71,53,.18)]",
                      idx % 10 === 0 && "bg-[color:rgba(180,143,104,.3)]",
                    )}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </article>
      </Reveal>
    </section>
  );
}

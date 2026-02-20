"use client";

import { useEffect, useMemo, useState } from "react";
import { Reveal } from "@/components/landing/reveal";
import { cn } from "@/lib/utils";

type LensView = "child" | "home" | "study" | "week";

const LENSES: { id: LensView; label: string; title: string; text: string; chips: string[] }[] = [
  {
    id: "child",
    label: "Ребенок",
    title: "Через линзу ребенка видно настроение и вовлеченность.",
    text: "Тот же день, но акцент на том, что радовало, что давалось легче, а где нужна поддержка.",
    chips: ["Настроение", "Интерес", "Поддержка"],
  },
  {
    id: "home",
    label: "Дом",
    title: "Через линзу дома видно общий быт и атмосферу.",
    text: "Появляется ясность, как распределялись дела и где семья была особенно в контакте.",
    chips: ["Быт", "Атмосфера", "Совместность"],
  },
  {
    id: "study",
    label: "Учеба",
    title: "Через линзу учебы видно спокойный учебный ритм.",
    text: "Не оценка, а контекст: как шел учебный день и что помогало сохранять устойчивость.",
    chips: ["Ритм", "Фокус", "Контекст"],
  },
  {
    id: "week",
    label: "Неделя",
    title: "Через недельную линзу видно динамику всей семьи.",
    text: "Небольшие факты складываются в историю, где легче заметить вклад каждого.",
    chips: ["Динамика", "История", "Видимость вклада"],
  },
];

export function LensDemo() {
  const [active, setActive] = useState<LensView>("child");

  useEffect(() => {
    const id = setInterval(() => {
      setActive((prev) => {
        const index = LENSES.findIndex((lens) => lens.id === prev);
        const next = (index + 1) % LENSES.length;
        return LENSES[next]?.id ?? "child";
      });
    }, 4200);
    return () => clearInterval(id);
  }, []);

  const lens = useMemo(() => LENSES.find((item) => item.id === active) ?? LENSES[0], [active]);

  return (
    <section>
      <Reveal>
        <article className="rounded-3xl bg-[var(--panel)]/82 p-5 md:p-6">
          <h2 className="page-title text-4xl leading-[1.03] text-[var(--accent-ink)]">Один день, несколько взглядов.</h2>
          <div key={lens.id} className="landing-morph mt-4 rounded-2xl bg-white/84 p-4">
            <p className="text-sm font-semibold text-[var(--accent-ink)]">{lens.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-[color:rgba(63,58,52,.79)]">{lens.text}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {lens.chips.map((chip) => (
                <span key={`${lens.id}-${chip}`} className="rounded-full bg-[var(--panel-soft)] px-2.5 py-1 text-xs text-[var(--accent-ink)]">
                  {chip}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-4">
            {LENSES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActive(item.id)}
                className={cn(
                  "rounded-2xl px-3 py-3 text-left transition",
                  active === item.id
                    ? "bg-[color:rgba(180,143,104,.2)] text-[var(--accent-ink)]"
                    : "bg-transparent text-[color:rgba(63,58,52,.68)]",
                )}
              >
                <p className={cn("transition", active === item.id ? "text-base font-semibold" : "text-sm")}>{item.label}</p>
                <p className={cn("mt-1 leading-relaxed transition", active === item.id ? "text-xs opacity-100" : "text-xs opacity-70")}>
                  {item.text}
                </p>
              </button>
            ))}
          </div>
        </article>
      </Reveal>
    </section>
  );
}

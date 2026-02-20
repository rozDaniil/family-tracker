import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
import { HeroProcessCanvas } from "@/components/landing/hero-process-canvas";

export function HeroScene() {
  return (
    <section className="relative overflow-hidden rounded-[32px] border border-[color:rgba(90,71,53,.14)] bg-[linear-gradient(135deg,#f7efe3_0%,#f2e7d8_50%,#ece0d1_100%)] p-5 md:p-9">
      <div className="landing-orb landing-orb-left" />
      <div className="landing-orb landing-orb-right" />
      <div className="grid gap-8 md:grid-cols-[1.02fr_1fr] md:items-center">
        <Reveal>
          <div className="space-y-5">
            <p className="inline-flex items-center rounded-full bg-white/72 px-3 py-1 text-xs text-[color:rgba(63,58,52,.74)]">
              Family Life Calendar
            </p>
            <h1 className="page-title text-5xl leading-[0.98] text-[var(--accent-ink)] md:text-7xl">
              Отражайте день.
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-[color:rgba(63,58,52,.82)]">
              Когда прожитое видно, легче замечать вклад друг друга и сохранять
              уважение в простых ежедневных делах.
            </p>
            <div className="flex flex-wrap gap-2.5 pt-2">
              <Link
                href="/today"
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm text-white"
              >
                Смотреть календарь
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/auth"
                className="inline-flex items-center gap-2 rounded-xl bg-white/80 px-4 py-2.5 text-sm text-[var(--accent-ink)]"
              >
                Войти в Family Life
              </Link>
            </div>
          </div>
        </Reveal>

        <Reveal delayMs={80}>
          <div className="hero-process relative min-h-[330px] rounded-[28px] bg-white/52 p-4 md:min-h-[390px]">
            <HeroProcessCanvas />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

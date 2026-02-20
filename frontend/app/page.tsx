import { HeroScene } from "@/components/landing/hero-scene";
import { LensDemo } from "@/components/landing/lens-demo";
import { RhythmDemo } from "@/components/landing/rhythm-demo";
import { Reveal } from "@/components/landing/reveal";
import { StoryNarrative } from "@/components/landing/story-narrative";

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
      <div className="space-y-5 md:space-y-6">
        <HeroScene />

        <StoryNarrative
          eyebrow="Память дня"
          title="Мы многое делаем, но детали стираются."
          description="Рутинные, важные и теплые моменты часто исчезают в общем потоке. Календарь бережно сохраняет факты дня, чтобы семья видела прожитое яснее."
          imageSrc="/images/landing/family_life_3_1536x1024.png"
          imageAlt="Теплая домашняя сцена с деталями семейной жизни"
        >
          <div className="rounded-2xl bg-white/86 p-3">
            <p className="text-xs text-[color:rgba(63,58,52,.62)]">Небольшие факты дня</p>
            <p className="mt-1 text-sm text-[var(--accent-ink)]">Остаются в живой семейной истории, а не теряются к вечеру.</p>
          </div>
        </StoryNarrative>

        <section className="py-2 md:py-4">
          <Reveal>
            <h2 className="page-title max-w-4xl text-4xl leading-[1.02] text-[var(--accent-ink)] md:text-6xl">
              Когда день отражён, вклад становится видимым.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[color:rgba(63,58,52,.8)] md:text-base">
              Это не про отчёт. Это про ясность, уважение и спокойное понимание того, кто поддержал этот день.
            </p>
          </Reveal>

          <Reveal delayMs={110}>
            <div className="relative mt-4 min-h-[186px]">
              <article className="absolute left-0 top-0 w-[72%] rounded-3xl bg-[color:rgba(233,220,202,.74)] p-4 md:w-[58%]">
                <p className="text-xs text-[color:rgba(63,58,52,.6)]">До</p>
                <p className="mt-1 text-sm text-[color:rgba(63,58,52,.8)]">Прошло и осталось без слов.</p>
              </article>
              <article className="absolute bottom-0 right-0 w-[78%] rounded-3xl bg-[color:rgba(255,248,236,.9)] p-4 shadow-[0_14px_24px_rgba(89,66,39,.08)] md:w-[60%]">
                <p className="text-xs text-[color:rgba(63,58,52,.6)]">После</p>
                <p className="mt-1 text-sm font-medium text-[var(--accent-ink)]">Стало понятно, кто поддержал этот день.</p>
              </article>
            </div>
          </Reveal>
        </section>

        <RhythmDemo />
        <LensDemo />
      </div>
    </div>
  );
}

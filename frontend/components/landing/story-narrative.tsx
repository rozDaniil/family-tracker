import Image from "next/image";
import { Reveal } from "@/components/landing/reveal";
import { cn } from "@/lib/utils";

type StoryNarrativeProps = {
  eyebrow: string;
  title: string;
  description: string;
  imageSrc?: string;
  imageAlt?: string;
  reverse?: boolean;
  children?: React.ReactNode;
};

export function StoryNarrative({
  eyebrow,
  title,
  description,
  imageSrc,
  imageAlt = "",
  reverse = false,
  children,
}: StoryNarrativeProps) {
  return (
    <section
      className={cn(
        "grid gap-4 md:items-center",
        imageSrc ? "md:grid-cols-[1fr_.92fr]" : "md:grid-cols-[1fr_.74fr]",
        reverse && "md:[&>*:first-child]:order-2 md:[&>*:last-child]:order-1",
      )}
    >
      <Reveal>
        <article className="rounded-3xl bg-white/58 p-5 md:p-6">
          <p className="text-xs uppercase tracking-[0.12em] text-[color:rgba(63,58,52,.58)]">{eyebrow}</p>
          <h2 className="mt-2 page-title text-4xl leading-[1.03] text-[var(--accent-ink)] md:text-5xl">{title}</h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-[color:rgba(63,58,52,.8)] md:text-base">{description}</p>
        </article>
      </Reveal>

      <Reveal delayMs={120}>
        {imageSrc ? (
          <article className="relative overflow-hidden rounded-3xl shadow-[0_14px_28px_rgba(89,66,39,.08)]">
            <div className="relative h-72 md:h-[22rem]">
              <Image src={imageSrc} alt={imageAlt} fill className="object-cover" sizes="(max-width: 1024px) 100vw, 42vw" />
            </div>
            {children ? <div className="absolute bottom-3 left-3 right-3">{children}</div> : null}
          </article>
        ) : (
          <article className="rounded-3xl bg-[var(--panel)]/78 p-4 md:p-5">{children}</article>
        )}
      </Reveal>
    </section>
  );
}

import type { Category, EventItem, Member } from "@/lib/types";

function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("ru-RU");
}

export function EventCard({
  event,
  category,
  member,
  memberNames,
  authorName,
  onStop,
  onOpen,
}: {
  event: EventItem;
  category?: Category;
  member?: Member;
  memberNames?: string[];
  authorName?: string;
  onStop?: (eventId: string) => void;
  onOpen?: () => void;
}) {
  const startDate = formatDate(event.date_local);
  const endDate = formatDate(event.end_date_local ?? event.date_local);
  const sameDay =
    (event.end_date_local ?? event.date_local) === event.date_local;
  const participantsLabel =
    memberNames && memberNames.length > 0
      ? memberNames.join(", ")
      : member
        ? member.display_name
        : null;

  return (
    <article
      className={`rounded-2xl border border-[var(--line)] bg-white/70 p-4 shadow-[0_2px_16px_rgba(95,72,47,.08)] ${onOpen ? "cursor-pointer transition hover:border-[var(--accent)]" : ""}`}
      onClick={onOpen}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: category?.color ?? "#B48F68" }}
          />
          <span className="text-xs uppercase tracking-[0.08em] text-[color:rgba(63,58,52,.7)]">
            {category?.name ?? "Без категории"}
          </span>
        </div>
        {event.kind === "ACTIVE" && event.is_active ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStop?.(event.id);
            }}
            className="rounded-lg bg-[var(--panel-soft)] px-3 py-1 text-xs text-[var(--accent-ink)] hover:bg-[var(--line)]"
          >
            Завершить
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-base font-semibold">{event.title}</p>
      {event.description ? (
        <p className="mt-1 text-sm text-[color:rgba(63,58,52,.8)]">
          {event.description}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[color:rgba(63,58,52,.72)]">
        {sameDay ? (
          <span>{startDate}</span>
        ) : (
          <span>
            {startDate} {"->"} {endDate}
          </span>
        )}
        {authorName ? <span>Автор: {authorName}</span> : null}
        {participantsLabel ? <span>Участники: {participantsLabel}</span> : null}
      </div>
    </article>
  );
}

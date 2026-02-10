export function EmptyState({ title }: { title: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-6 text-sm text-[color:rgba(63,58,52,.75)]">
      <p className="page-title text-2xl text-[var(--accent-ink)]">{title}</p>
      <p className="mt-2">Здесь просто пока ничего нет.</p>
    </div>
  );
}

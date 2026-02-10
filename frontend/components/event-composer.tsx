"use client";

import { FormEvent, useState } from "react";
import { api } from "@/lib/api";
import type { Category, Member } from "@/lib/types";
import { useEventComposerStore } from "@/stores/event-composer-store";
import { useSessionStore } from "@/stores/session-store";

function todayLocal() {
  return new Date().toISOString().slice(0, 10);
}

export function EventComposer({
  categories,
  members,
  onCreated,
}: {
  categories: Category[];
  members: Member[];
  onCreated: () => Promise<void>;
}) {
  const { token } = useSessionStore();
  const { mode, setMode } = useEventComposerStore();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [memberId, setMemberId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = token && title.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || !token) return;
    setSubmitting(true);
    try {
      await api.createEvent(token, {
        title: title.trim(),
        description: description.trim() || undefined,
        category_id: categoryId || null,
        member_id: memberId || undefined,
        kind: mode,
        date_local: todayLocal(),
      });
      setTitle("");
      setDescription("");
      await onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
      <div className="flex flex-wrap gap-2 text-sm">
        {(["NOTE", "RANGE", "ACTIVE"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={`rounded-lg px-3 py-1 ${
              mode === value ? "bg-[var(--accent)] text-white" : "bg-white/80 hover:bg-white"
            }`}
          >
            {value === "NOTE" ? "Заметка" : value === "RANGE" ? "Интервал" : "Start/Stop"}
          </button>
        ))}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Что произошло?"
        className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Короткая заметка (опционально)"
        className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
        rows={2}
      />
      <div className="grid gap-2 md:grid-cols-2">
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 outline-none"
        >
          <option value="">Категория</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <select
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 outline-none"
        >
          <option value="">Кто участвовал (опционально)</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.display_name}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={!canSubmit || submitting}
        className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {submitting ? "Сохраняем..." : "Добавить событие"}
      </button>
    </form>
  );
}

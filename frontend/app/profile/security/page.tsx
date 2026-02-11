"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { api } from "@/lib/api";
import { useSessionStore } from "@/stores/session-store";

export default function ProfileSecurityPage() {
  const { token } = useSessionStore();
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await api.changePassword(token, {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setMessage("Пароль изменен");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить пароль");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <h1 className="page-title text-4xl text-[var(--accent-ink)]">Смена пароля</h1>
      <Link href="/profile" className="inline-block text-sm text-[var(--accent-ink)] underline underline-offset-2">
        ← Назад в профиль
      </Link>

      {message ? <p className="text-sm text-[color:rgba(63,58,52,.8)]">{message}</p> : null}
      {error ? <p className="text-sm text-[color:#8B5D55]">{error}</p> : null}

      <form onSubmit={savePassword} className="space-y-3 rounded-2xl border border-[var(--line)] bg-white/75 p-4 md:p-5">
        <input
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          type="password"
          placeholder="Текущий пароль"
          className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
        />
        <input
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          type="password"
          placeholder="Новый пароль"
          className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-70"
        >
          {saving ? "Сохраняем..." : "Сохранить"}
        </button>
      </form>
    </section>
  );
}

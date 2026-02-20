"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/api";
import { useSessionStore } from "@/stores/session-store";

export default function ProfileSecurityPage() {
  const { token } = useSessionStore();
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatNewPassword, setRepeatNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordMismatch, setPasswordMismatch] = useState<string | null>(null);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showRepeatNewPassword, setShowRepeatNewPassword] = useState(false);

  function validatePasswordsOnBlur() {
    if (!newPassword || !repeatNewPassword) return;
    if (newPassword !== repeatNewPassword) {
      setPasswordMismatch("Новые пароли не совпадают");
      return;
    }
    setPasswordMismatch(null);
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (newPassword && repeatNewPassword && newPassword !== repeatNewPassword) {
      setPasswordMismatch("Новые пароли не совпадают");
      return;
    }

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
      setRepeatNewPassword("");
      setPasswordMismatch(null);
      setMessage("Пароль изменен");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить пароль");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <h1 className="page-title text-4xl text-[var(--accent-ink)]">Смена пароля</h1>
      <Link href="/profile" className="inline-block text-sm text-[var(--accent-ink)] underline underline-offset-2">
        ← Назад в профиль
      </Link>

      {message ? <p className="text-sm text-[color:rgba(63,58,52,.8)]">{message}</p> : null}
      {error ? <p className="text-sm text-[color:#8B5D55]">{error}</p> : null}

      <form onSubmit={savePassword} className="space-y-3 rounded-2xl border border-[var(--line)] bg-white/75 p-4 md:p-5">
        <div className="relative">
          <input
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            type={showCurrentPassword ? "text" : "password"}
            placeholder="Текущий пароль"
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 pr-10 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => setShowCurrentPassword((current) => !current)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:rgba(63,58,52,.7)]"
            aria-label={showCurrentPassword ? "Скрыть текущий пароль" : "Показать текущий пароль"}
          >
            {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <div className="relative">
          <input
            value={newPassword}
            onChange={(e) => {
              const value = e.target.value;
              setNewPassword(value);
              if (repeatNewPassword && value === repeatNewPassword) {
                setPasswordMismatch(null);
              }
            }}
            onBlur={validatePasswordsOnBlur}
            type={showNewPassword ? "text" : "password"}
            placeholder="Новый пароль"
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 pr-10 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => setShowNewPassword((current) => !current)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:rgba(63,58,52,.7)]"
            aria-label={showNewPassword ? "Скрыть новый пароль" : "Показать новый пароль"}
          >
            {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <div className="relative">
          <input
            value={repeatNewPassword}
            onChange={(e) => {
              const value = e.target.value;
              setRepeatNewPassword(value);
              if (newPassword && value === newPassword) {
                setPasswordMismatch(null);
              }
            }}
            onBlur={validatePasswordsOnBlur}
            type={showRepeatNewPassword ? "text" : "password"}
            placeholder="Повторите новый пароль"
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 pr-10 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => setShowRepeatNewPassword((current) => !current)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:rgba(63,58,52,.7)]"
            aria-label={showRepeatNewPassword ? "Скрыть повторный пароль" : "Показать повторный пароль"}
          >
            {showRepeatNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {passwordMismatch ? <p className="text-xs text-[color:#8B5D55]">{passwordMismatch}</p> : null}
        <button
          type="submit"
          disabled={saving || Boolean(passwordMismatch)}
          className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-70"
        >
          {saving ? "Обновляем..." : "Обновить пароль"}
        </button>
      </form>
    </section>
  );
}

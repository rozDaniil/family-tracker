"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("token");
    if (fromUrl) setToken(fromUrl);
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword({ token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md rounded-2xl border border-[var(--line)] bg-white/80 p-5">
      <h1 className="page-title text-3xl text-[var(--accent-ink)]">Новый пароль</h1>
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Токен из письма"
          autoComplete="one-time-code"
          className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="Новый пароль"
          autoComplete="new-password"
          className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
        />
        {error ? <p className="text-xs text-[color:#8B5D55]">{error}</p> : null}
        {done ? <p className="text-xs">Пароль обновлён. Можно войти заново.</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-70"
        >
          {busy ? "Сохраняем..." : "Сохранить пароль"}
        </button>
      </form>
      <div className="mt-3 text-sm">
        <Link href="/auth" className="underline underline-offset-2">
          Ко входу
        </Link>
      </div>
    </section>
  );
}

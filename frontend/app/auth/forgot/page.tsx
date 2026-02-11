"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword({ email });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md rounded-2xl border border-[var(--line)] bg-white/80 p-5">
      <h1 className="page-title text-3xl text-[var(--accent-ink)]">Сброс пароля</h1>
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email"
          autoComplete="email"
          className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
        />
        {error ? <p className="text-xs text-[color:#8B5D55]">{error}</p> : null}
        {sent ? <p className="text-xs">Если email существует, мы отправили ссылку для сброса.</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-70"
        >
          {busy ? "Отправляем..." : "Отправить"}
        </button>
      </form>
      <div className="mt-3 text-sm">
        <Link href="/auth" className="underline underline-offset-2">
          Назад ко входу
        </Link>
      </div>
    </section>
  );
}

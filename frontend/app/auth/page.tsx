"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSessionStore } from "@/stores/session-store";

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { login, signup } = useSessionStore();

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem("flc.auth_password");
    const remember = window.localStorage.getItem("flc.remember_me") === "1";
    setRememberMe(remember);
    if (!remember) return;
    const storedEmail = window.localStorage.getItem("flc.auth_email") ?? "";
    setEmail(storedEmail);
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (typeof window !== "undefined") {
        if (rememberMe) {
          window.localStorage.setItem("flc.remember_me", "1");
          window.localStorage.setItem("flc.auth_email", email);
        } else {
          window.localStorage.removeItem("flc.remember_me");
          window.localStorage.removeItem("flc.auth_email");
        }
      }
      if (mode === "login") {
        await login({ email, password, remember_me: rememberMe });
      } else {
        await signup({
          email,
          password,
          display_name: displayName.trim() || "Участник",
          remember_me: rememberMe,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка авторизации");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md rounded-2xl border border-[var(--line)] bg-white/80 p-5">
      <h1 className="page-title text-3xl text-[var(--accent-ink)]">Вход в Family Life</h1>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`rounded-lg px-3 py-1 text-sm ${mode === "login" ? "bg-[var(--accent)] text-white" : "bg-[var(--panel-soft)]"}`}
        >
          Вход
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`rounded-lg px-3 py-1 text-sm ${mode === "signup" ? "bg-[var(--accent)] text-white" : "bg-[var(--panel-soft)]"}`}
        >
          Регистрация
        </button>
      </div>

      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        {mode === "signup" ? (
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Ваше имя"
            autoComplete="name"
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
          />
        ) : null}
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email"
          autoComplete="email"
          className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="Пароль"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
        />
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4"
          />
          Запомнить меня
        </label>
        {error ? <p className="text-xs text-[color:#8B5D55]">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-70"
        >
          {busy ? "Подождите..." : mode === "login" ? "Войти" : "Создать аккаунт"}
        </button>
      </form>

      <div className="mt-4 space-y-2 text-sm">
        <a
          href={api.googleStartUrl()}
          className="inline-flex rounded-lg border border-[var(--line)] bg-white px-3 py-1.5"
        >
          Войти через Google
        </a>
        <div>
          <Link href="/auth/forgot" className="text-[var(--accent-ink)] underline underline-offset-2">
            Забыли пароль?
          </Link>
        </div>
      </div>
    </section>
  );
}

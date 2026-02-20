"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

function InvitePageContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acceptInvite() {
    if (!token) {
      setError("Ссылка приглашения некорректна.");
      return;
    }
    const name = displayName.trim();
    if (!name) {
      setError("Введите имя.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.acceptInvite({ token, display_name: name });
      window.location.href = "/today";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось принять приглашение.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-[var(--line)] bg-white/85 p-6 shadow-[0_18px_34px_rgba(89,66,39,.08)]">
      <h1 className="page-title text-4xl text-[var(--accent-ink)]">Приглашение в семью</h1>
      <p className="mt-2 text-sm text-[color:rgba(63,58,52,.75)]">
        Введите имя, чтобы присоединиться к семейному календарю.
      </p>
      <div className="mt-4 space-y-3">
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Ваше имя"
          className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
        />
        {error ? <p className="text-xs text-[color:#8B5D55]">{error}</p> : null}
        <button
          type="button"
          onClick={() => void acceptInvite()}
          disabled={busy}
          className="w-full rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-70"
        >
          {busy ? "Подключаем..." : "Принять приглашение"}
        </button>
      </div>
      <div className="mt-4 text-sm">
        <Link href="/auth" className="underline underline-offset-2">
          Назад ко входу
        </Link>
      </div>
    </section>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<section className="mx-auto max-w-md rounded-3xl border border-[var(--line)] bg-white/85 p-6" />}>
      <InvitePageContent />
    </Suspense>
  );
}

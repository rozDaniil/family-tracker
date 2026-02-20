"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

function VerifyPageContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<"idle" | "success" | "error">(token ? "idle" : "error");
  const [message, setMessage] = useState(
    token ? "Проверяем ссылку..." : "В ссылке отсутствует токен подтверждения.",
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        await api.confirmVerification({ token });
        if (cancelled) return;
        setStatus("success");
        setMessage("Email подтвержден. Можно войти в аккаунт.");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Не удалось подтвердить email.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-[var(--line)] bg-white/85 p-6 shadow-[0_18px_34px_rgba(89,66,39,.08)]">
      <h1 className="page-title text-4xl text-[var(--accent-ink)]">Подтверждение email</h1>
      <p className={`mt-4 text-sm ${status === "error" ? "text-[color:#8B5D55]" : "text-[color:rgba(63,58,52,.75)]"}`}>
        {message}
      </p>
      <div className="mt-4 text-sm">
        <Link href="/auth" className="underline underline-offset-2">
          Перейти ко входу
        </Link>
      </div>
    </section>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<section className="mx-auto max-w-md rounded-3xl border border-[var(--line)] bg-white/85 p-6" />}>
      <VerifyPageContent />
    </Suspense>
  );
}

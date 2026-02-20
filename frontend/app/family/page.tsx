"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { api } from "@/lib/api";
import type { Member, PendingInvite } from "@/lib/types";
import { useSessionStore } from "@/stores/session-store";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function FamilyPage() {
  const { token } = useSessionStore();
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [inviteUrl, setInviteUrl] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [creatingLink, setCreatingLink] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);

  const loadFamilyData = useCallback(async () => {
    if (!token) return;
    const [membersRes, pendingRes] = await Promise.all([
      api.getMembers(token),
      api.getPendingInvites(token),
    ]);
    setMembers(membersRes);
    setPendingInvites(pendingRes);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [membersRes, pendingRes] = await Promise.all([
          api.getMembers(token),
          api.getPendingInvites(token),
        ]);
        if (cancelled) return;
        setMembers(membersRes);
        setPendingInvites(pendingRes);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function sendInviteToEmail() {
    if (!token || sendingInvite) return;
    setInviteError(null);
    setInviteNotice(null);

    const normalizedEmail = inviteEmail.trim().toLowerCase();
    const normalizedName = inviteName.trim();
    if (!EMAIL_RE.test(normalizedEmail)) {
      setInviteError("Введите корректный email для приглашения.");
      return;
    }

    setSendingInvite(true);
    try {
      const result = await api.createInviteLink(token, {
        recipient_email: normalizedEmail,
        recipient_name: normalizedName || undefined,
      });
      setInviteUrl(result.invite_url);
      setInviteEmail("");
      setInviteName("");
      setInviteNotice("Приглашение отправлено на email.");
      await loadFamilyData();
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : "Не удалось отправить приглашение.");
    } finally {
      setSendingInvite(false);
    }
  }

  async function generateInviteLink() {
    if (!token || creatingLink) return;
    setInviteError(null);
    setInviteNotice(null);
    setCreatingLink(true);
    try {
      const result = await api.createInviteLink(token, {
        recipient_name: inviteName.trim() || undefined,
      });
      setInviteUrl(result.invite_url);
      setInviteNotice("Ссылка приглашения сгенерирована.");
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : "Не удалось создать ссылку приглашения.");
    } finally {
      setCreatingLink(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[color:rgba(63,58,52,.75)]">Загружаем участников...</p>;
  }

  return (
    <section className="space-y-4">
      <header>
        <h1 className="page-title text-4xl text-[var(--accent-ink)]">Моя Семья</h1>
        <p className="text-sm text-[color:rgba(63,58,52,.75)]">Один проект, несколько участников, единый календарь жизни.</p>
      </header>

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
        <p className="mb-3 text-xs text-[color:rgba(63,58,52,.68)]">
          Участники добавляются только через приглашение.
        </p>

        <div className="grid gap-2 md:grid-cols-2">
          <input
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            type="email"
            placeholder="Email для приглашения"
            className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
          />
          <input
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
            type="text"
            placeholder="Введите имя (опционально)"
            className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void sendInviteToEmail()}
            className="cursor-pointer rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-70"
            disabled={sendingInvite || creatingLink || !inviteEmail.trim()}
          >
            {sendingInvite ? "Отправляем..." : "Пригласить"}
          </button>
          <button
            type="button"
            onClick={() => void generateInviteLink()}
            className="cursor-pointer rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--accent-ink)] disabled:opacity-70"
            disabled={creatingLink || sendingInvite}
          >
            {creatingLink ? "Генерируем..." : "Сгенерировать ссылку"}
          </button>
        </div>

        {inviteError ? (
          <p className="mt-2 text-xs text-[color:#8B5D55]">{inviteError}</p>
        ) : null}
        {inviteNotice ? (
          <p className="mt-2 text-xs text-[color:rgba(63,58,52,.72)]">{inviteNotice}</p>
        ) : null}

        {inviteUrl ? (
          <div className="mt-3 rounded-xl border border-[var(--line)] bg-white p-3 text-sm">
            <p className="text-[color:rgba(63,58,52,.72)]">Ссылка приглашения</p>
            <p className="mt-1 break-all font-mono text-xs">{inviteUrl}</p>
          </div>
        ) : null}
      </div>

      {pendingInvites.length > 0 ? (
        <section className="space-y-2 rounded-2xl border border-[var(--line)] bg-white/70 p-4">
          <h2 className="text-sm font-semibold text-[rgba(63,58,52,.78)]">Ожидают подтверждения</h2>
          <div className="space-y-2">
            {pendingInvites.map((invite) => (
              <article key={invite.id} className="rounded-xl border border-[var(--line)] bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{invite.display_name}</p>
                  <span className="rounded-full bg-[var(--panel-soft)] px-2 py-0.5 text-[11px] text-[color:rgba(63,58,52,.7)]">
                    {invite.is_expired ? "Приглашение истекло" : "Ожидает подтверждения"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[color:rgba(63,58,52,.62)]">{invite.recipient_email}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {members.length === 0 ? (
        <EmptyState title="Участников пока нет" />
      ) : (
        <div className="space-y-2">
          {members.map((member) => (
            <article key={member.id} className="rounded-xl border border-[var(--line)] bg-white/70 px-4 py-3">
              <p className="text-sm font-semibold">{member.display_name}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

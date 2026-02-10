"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { api } from "@/lib/api";
import type { Member } from "@/lib/types";
import { useSessionStore } from "@/stores/session-store";

export default function FamilyPage() {
  const { token } = useSessionStore();
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteUrl, setInviteUrl] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [creatingMember, setCreatingMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const membersRes = await api.getMembers(token);
      if (cancelled) return;
      setMembers(membersRes);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function generateInvite() {
    if (!token) return;
    setInviting(true);
    try {
      const result = await api.createInviteLink(token);
      setInviteUrl(result.invite_url);
    } finally {
      setInviting(false);
    }
  }

  async function createMember() {
    if (!token || !newMemberName.trim()) return;
    setCreatingMember(true);
    try {
      const created = await api.createMember(token, { display_name: newMemberName.trim() });
      setMembers((current) => [...current, created]);
      setNewMemberName("");
    } finally {
      setCreatingMember(false);
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
        <div className="mb-4 grid gap-2 md:grid-cols-[1fr_auto]">
          <input
            value={newMemberName}
            onChange={(e) => setNewMemberName(e.target.value)}
            placeholder="Имя нового участника"
            className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
          />
          <button
            type="button"
            onClick={createMember}
            disabled={creatingMember || !newMemberName.trim()}
            className="cursor-pointer rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creatingMember ? "Добавляем..." : "Добавить участника"}
          </button>
        </div>
        <button
          type="button"
          onClick={generateInvite}
          className="cursor-pointer rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--accent-ink)]"
          disabled={inviting}
        >
          {inviting ? "Готовим ссылку..." : "Пригласить по ссылке"}
        </button>
        {inviteUrl ? (
          <div className="mt-3 rounded-xl border border-[var(--line)] bg-white p-3 text-sm">
            <p className="text-[color:rgba(63,58,52,.72)]">Ссылка приглашения</p>
            <p className="mt-1 break-all font-mono text-xs">{inviteUrl}</p>
          </div>
        ) : null}
      </div>

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

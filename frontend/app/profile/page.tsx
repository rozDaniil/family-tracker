"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Camera } from "lucide-react";
import { api } from "@/lib/api";
import type { CircleContact, ProfileItem } from "@/lib/types";
import { useSessionStore } from "@/stores/session-store";

export default function ProfilePage() {
  const { token, logout } = useSessionStore();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileItem | null>(null);
  const [circle, setCircle] = useState<CircleContact[]>([]);
  const [nickDrafts, setNickDrafts] = useState<Record<string, string>>({});
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingNickId, setSavingNickId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [showAvatarEditor, setShowAvatarEditor] = useState(false);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [birthday, setBirthday] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [profileRes, circleRes] = await Promise.all([
          api.getProfile(token),
          api.getCircle(token),
        ]);
        if (cancelled) return;

        setProfile(profileRes);
        setDisplayName(profileRes.display_name);
        setAvatarUrl(profileRes.avatar_url ?? "");
        setBirthday(profileRes.birthday ?? "");
        setIsEditing(false);
        setShowAvatarEditor(false);
        setAvatarLoadFailed(false);
        setCircle(circleRes);
        setNickDrafts(
          Object.fromEntries(circleRes.map((item) => [item.member_id, item.nickname ?? ""])),
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить профиль");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const avatarInitials = useMemo(() => {
    const sourceName = isEditing ? displayName : profile?.display_name ?? "";
    const parts = sourceName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "FL";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }, [displayName, isEditing, profile?.display_name]);

  const activeAvatarUrl = isEditing ? avatarUrl : (profile?.avatar_url ?? "");
  const hasAvatar = activeAvatarUrl.trim().length > 0 && !avatarLoadFailed;

  const birthdayText = useMemo(() => {
    const value = isEditing ? birthday : profile?.birthday;
    if (!value) return "Дата не указана";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
  }, [birthday, isEditing, profile?.birthday]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!token || !profile) return;
    setSavingProfile(true);
    setMessage(null);
    setError(null);
    try {
      const updated = await api.patchProfile(token, {
        display_name: displayName.trim(),
        avatar_url: avatarUrl.trim() || null,
        birthday: birthday || null,
      });
      setProfile(updated);
      setDisplayName(updated.display_name);
      setAvatarUrl(updated.avatar_url ?? "");
      setBirthday(updated.birthday ?? "");
      setAvatarLoadFailed(false);
      setShowAvatarEditor(false);
      setIsEditing(false);
      setMessage("Профиль сохранен");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить профиль");
    } finally {
      setSavingProfile(false);
    }
  }

  async function resendVerification() {
    if (!token) return;
    setMessage(null);
    setError(null);
    try {
      await api.resendMyVerification(token);
      setMessage("Письмо отправлено повторно");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить письмо");
    }
  }

  async function saveNickname(memberId: string) {
    if (!token) return;
    setSavingNickId(memberId);
    setMessage(null);
    setError(null);
    try {
      const updated = await api.patchCircleNickname(token, memberId, {
        nickname: (nickDrafts[memberId] ?? "").trim() || null,
      });
      setCircle((current) => current.map((item) => (item.member_id === memberId ? updated : item)));
      setNickDrafts((current) => ({ ...current, [memberId]: updated.nickname ?? "" }));
      setMessage("Никнейм сохранен");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить никнейм");
    } finally {
      setSavingNickId(null);
    }
  }

  function startEditing() {
    if (!profile) return;
    setDisplayName(profile.display_name);
    setAvatarUrl(profile.avatar_url ?? "");
    setBirthday(profile.birthday ?? "");
    setShowAvatarEditor(false);
    setAvatarLoadFailed(false);
    setIsEditing(true);
    setMessage(null);
    setError(null);
  }

  function cancelEditing() {
    if (!profile) return;
    setDisplayName(profile.display_name);
    setAvatarUrl(profile.avatar_url ?? "");
    setBirthday(profile.birthday ?? "");
    setShowAvatarEditor(false);
    setAvatarLoadFailed(false);
    setIsEditing(false);
    setError(null);
  }

  function clearAvatarDraft() {
    setAvatarUrl("");
    setAvatarLoadFailed(false);
    setShowAvatarEditor(false);
  }

  if (loading) {
    return <p className="text-sm text-[color:rgba(63,58,52,.75)]">Загружаем профиль...</p>;
  }

  if (!profile) {
    return <p className="text-sm text-[color:#8B5D55]">Профиль недоступен</p>;
  }

  return (
    <section className="space-y-5">
      <h1 className="page-title text-4xl text-[var(--accent-ink)]">Профиль</h1>
      {message ? <p className="text-sm text-[color:rgba(63,58,52,.8)]">{message}</p> : null}
      {error ? <p className="text-sm text-[color:#8B5D55]">{error}</p> : null}

      <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-white/75 p-4 md:p-5">
        <h2 className="text-base font-semibold">Профиль человека</h2>
        <div className="flex flex-col gap-4 md:flex-row md:justify-between">
          <div className="flex items-center gap-3">
            <div className="relative h-24 w-24 overflow-hidden rounded-full border border-[var(--line)] bg-[var(--panel-soft)]">
              {hasAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={activeAvatarUrl}
                  alt={`Аватар ${isEditing ? displayName : profile.display_name}`}
                  className="h-full w-full object-cover"
                  onError={() => setAvatarLoadFailed(true)}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xl font-semibold text-[var(--accent-ink)]">
                  {avatarInitials}
                </div>
              )}

              {isEditing ? (
                <button
                  type="button"
                  onClick={() => setShowAvatarEditor((current) => !current)}
                  className="absolute bottom-0 right-0 rounded-full border border-[var(--line)] bg-white p-1.5 text-[var(--accent-ink)]"
                  aria-label="Обновить фото"
                >
                  <Camera className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            <div className="space-y-1">
              {isEditing ? (
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Имя"
                  className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none md:min-w-[260px]"
                />
              ) : (
                <p className="text-base font-semibold">{profile.display_name}</p>
              )}

              <p className="text-sm text-[color:rgba(63,58,52,.85)]">{profile.email ?? "Email не указан"}</p>

              {profile.email_verified ? (
                <p className="text-xs text-[color:rgba(63,58,52,.68)]">Email подтвержден</p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-3 md:min-w-[260px] md:self-stretch md:items-end">
            {!isEditing ? (
              <button
                type="button"
                onClick={startEditing}
                className="self-start text-sm text-[var(--accent-ink)] underline underline-offset-2 md:self-auto"
              >
                Редактировать профиль →
              </button>
            ) : null}

            {!profile.email_verified ? (
              <div className="space-y-2 rounded-xl border border-[color:rgba(139,93,85,.35)] bg-[color:rgba(139,93,85,.08)] p-3 md:mt-auto md:max-w-[280px]">
                <p className="text-sm font-medium text-[color:#8B5D55]">Подтверждение еще не завершено</p>
                <button
                  type="button"
                  onClick={() => void resendVerification()}
                  className="text-xs text-[color:#8B5D55] underline underline-offset-2"
                >
                  Отправить письмо еще раз
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {isEditing ? (
          <form onSubmit={saveProfile} className="space-y-3 border-t border-[var(--line)] pt-4">
            {showAvatarEditor ? (
              <div className="space-y-2">
                <label className="block text-xs text-[color:rgba(63,58,52,.8)]">Ссылка на фото</label>
                <div className="flex flex-col gap-2 md:flex-row">
                  <input
                    value={avatarUrl}
                    onChange={(e) => {
                      setAvatarUrl(e.target.value);
                      setAvatarLoadFailed(false);
                    }}
                    placeholder="https://..."
                    className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
                  />
                  <button
                    type="button"
                    onClick={clearAvatarDraft}
                    className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
                  >
                    Удалить фото
                  </button>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="block text-xs text-[color:rgba(63,58,52,.8)]">Дата рождения</label>
                <input
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                  type="date"
                  className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={savingProfile}
                className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-70"
              >
                {savingProfile ? "Сохраняем..." : "Сохранить"}
              </button>
              <button
                type="button"
                onClick={cancelEditing}
                className="rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm"
              >
                Отменить
              </button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-[color:rgba(63,58,52,.75)]">Дата рождения: {birthdayText}</p>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-white/75 p-4 md:p-5">
        <h2 className="text-base font-semibold">Мой круг</h2>
        {circle.length === 0 ? (
          <p className="text-sm text-[color:rgba(63,58,52,.72)]">
            Пока в вашем круге только вы. Когда пригласите близких, они появятся здесь.
          </p>
        ) : (
          <div className="space-y-2">
            {circle.map((item) => (
              <article key={item.member_id} className="rounded-xl border border-[var(--line)] bg-white p-3">
                <p className="text-sm font-semibold">{item.display_name}</p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={nickDrafts[item.member_id] ?? ""}
                    onChange={(e) =>
                      setNickDrafts((current) => ({ ...current, [item.member_id]: e.target.value }))
                    }
                    placeholder="Локальный никнейм (например: Мама)"
                    className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-sm outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void saveNickname(item.member_id)}
                    disabled={savingNickId === item.member_id}
                    className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-xs disabled:opacity-70"
                  >
                    {savingNickId === item.member_id ? "..." : "Сохранить"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-[var(--line)] bg-white/75 p-4 md:p-5">
        <h2 className="text-base font-semibold">Настройки безопасности</h2>
        <Link href="/profile/security" className="block text-sm text-[var(--accent-ink)] underline underline-offset-2">
          Смена пароля →
        </Link>
        <button
          type="button"
          onClick={() => void logout()}
          className="text-left text-sm text-[var(--accent-ink)] underline underline-offset-2"
        >
          Выйти из аккаунта →
        </button>
      </section>
    </section>
  );
}

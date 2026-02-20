"use client";

import Link from "next/link";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Cropper, { Area } from "react-easy-crop";
import { X } from "lucide-react";
import { AvatarEditable } from "@/components/avatar-editable";
import { api } from "@/lib/api";
import type { CircleContact, ProfileItem } from "@/lib/types";
import { useSessionStore } from "@/stores/session-store";

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () =>
      reject(new Error("Не удалось загрузить изображение")),
    );
    image.src = src;
  });
}

async function getCroppedBlob(imageSrc: string, area: Area): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(area.width));
  canvas.height = Math.max(1, Math.round(area.height));

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas не поддерживается");

  ctx.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), "image/jpeg", 0.92);
  });
  if (!blob) throw new Error("Не удалось подготовить изображение");
  return blob;
}

export default function ProfilePage() {
  const { token, logout } = useSessionStore();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileItem | null>(null);
  const [circle, setCircle] = useState<CircleContact[]>([]);
  const [nickDrafts, setNickDrafts] = useState<Record<string, string>>({});
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingNickId, setSavingNickId] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [birthday, setBirthday] = useState("");

  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const cropObjectUrlRef = useRef<string | null>(null);

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
        setAvatarLoadFailed(false);
        setCircle(circleRes);
        setNickDrafts(
          Object.fromEntries(
            circleRes.map((item) => [item.member_id, item.nickname ?? ""]),
          ),
        );
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Не удалось загрузить профиль",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    return () => {
      if (cropObjectUrlRef.current) {
        URL.revokeObjectURL(cropObjectUrlRef.current);
        cropObjectUrlRef.current = null;
      }
    };
  }, []);

  const avatarInitials = useMemo(() => {
    const sourceName = isEditing ? displayName : (profile?.display_name ?? "");
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
    return date.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  }, [birthday, isEditing, profile?.birthday]);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

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
      setIsEditing(false);
      setMessage("Профиль сохранен");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось сохранить профиль",
      );
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
      setError(
        err instanceof Error ? err.message : "Не удалось отправить письмо",
      );
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
      setCircle((current) =>
        current.map((item) => (item.member_id === memberId ? updated : item)),
      );
      setNickDrafts((current) => ({
        ...current,
        [memberId]: updated.nickname ?? "",
      }));
      setMessage("Имя в вашем круге сохранено");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось сохранить имя в вашем круге",
      );
    } finally {
      setSavingNickId(null);
    }
  }

  function startEditing() {
    if (!profile) return;
    setDisplayName(profile.display_name);
    setAvatarUrl(profile.avatar_url ?? "");
    setBirthday(profile.birthday ?? "");
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
    setAvatarLoadFailed(false);
    setIsEditing(false);
    setError(null);
  }

  function openCropWithFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Выберите файл изображения");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Размер фото не должен превышать 5MB");
      return;
    }

    if (cropObjectUrlRef.current) {
      URL.revokeObjectURL(cropObjectUrlRef.current);
      cropObjectUrlRef.current = null;
    }

    const objectUrl = URL.createObjectURL(file);
    cropObjectUrlRef.current = objectUrl;
    setCropSource(objectUrl);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setCropModalOpen(true);
  }

  function onAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    openCropWithFile(file);
    if (avatarFileInputRef.current) avatarFileInputRef.current.value = "";
  }

  function closeCropModal() {
    setCropModalOpen(false);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    if (cropObjectUrlRef.current) {
      URL.revokeObjectURL(cropObjectUrlRef.current);
      cropObjectUrlRef.current = null;
    }
    setCropSource(null);
  }

  async function saveCroppedAvatar() {
    if (!token || !cropSource || !croppedAreaPixels) {
      setError("Не удалось подготовить фото");
      return;
    }

    setUploadingAvatar(true);
    setError(null);
    try {
      const blob = await getCroppedBlob(cropSource, croppedAreaPixels);
      const file = new File([blob], `avatar-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });
      const updated = await api.uploadAvatar(token, file);
      setProfile(updated);
      setAvatarUrl(updated.avatar_url ?? "");
      setAvatarLoadFailed(false);
      setMessage("Фото обновлено");
      closeCropModal();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось загрузить фото",
      );
    } finally {
      setUploadingAvatar(false);
    }
  }

  function clearAvatarDraft() {
    setAvatarUrl("");
    setAvatarLoadFailed(false);
    setMessage(null);
  }

  if (loading) {
    return (
      <p className="text-sm text-[color:rgba(63,58,52,.75)]">
        Загружаем профиль...
      </p>
    );
  }

  if (!profile) {
    return <p className="text-sm text-[color:#8B5D55]">Профиль недоступен</p>;
  }

  return (
    <>
      <section className="space-y-5">
        <h1 className="page-title text-4xl text-[var(--accent-ink)]">
          Профиль
        </h1>
        {message ? (
          <p className="text-sm text-[color:rgba(63,58,52,.8)]">{message}</p>
        ) : null}
        {error ? <p className="text-sm text-[color:#8B5D55]">{error}</p> : null}

        <section
          className={`relative space-y-3 rounded-2xl border border-[var(--line)] bg-white/75 p-4 md:p-5 `}
        >
          {/* <h2 className="text-base font-semibold">Профиль человека</h2> */}
          <div className="flex flex-col mb-3 gap-4 md:flex-row md:justify-between">
            <div className="flex items-center gap-3">
              <AvatarEditable
                src={activeAvatarUrl}
                alt={`Аватар ${isEditing ? displayName : profile.display_name}`}
                fallback={avatarInitials}
                isEditing={isEditing}
                avatarSize={120}
                buttonSize={40}
                holePadding={7}
                deletePosition="top-right"
                canDelete={hasAvatar}
                onUploadClick={() => avatarFileInputRef.current?.click()}
                onDeleteClick={clearAvatarDraft}
                onImageError={() => setAvatarLoadFailed(true)}
              />
              <input
                ref={avatarFileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={onAvatarFileChange}
                className="hidden"
              />

              <div className="space-y-1">
                {isEditing ? (
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Имя"
                    className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none md:min-w-[260px]"
                  />
                ) : (
                  <p className="text-lg font-semibold text-[var(--accent-ink)]">
                    {profile.display_name}
                  </p>
                )}

                <p className="text-sm text-[color:rgba(63,58,52,.62)]">
                  {profile.email ?? "Email не указан"}
                </p>

                {profile.email_verified ? (
                  <p className="text-xs text-[color:rgba(63,58,52,.5)]">
                    Email подтвержден
                  </p>
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
            </div>
          </div>

          {isEditing ? (
            <form
              onSubmit={saveProfile}
              className="space-y-3 border-t border-[var(--line)] pt-4"
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="block text-xs text-[color:rgba(63,58,52,.8)]">
                    Дата рождения
                  </label>
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
                  className="px-1 py-2 text-sm text-[var(--accent-ink)] underline underline-offset-2"
                >
                  Отменить
                </button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-[color:rgba(63,58,52,.75)]">
              Дата рождения: {birthdayText}
            </p>
          )}

          {!profile.email_verified && !isEditing ? (
            <div className="space-y-2 rounded-xl border border-[color:rgba(139,93,85,.35)] bg-[color:rgba(139,93,85,.08)] p-3 md:absolute md:bottom-5 md:right-5 md:w-[280px]">
              <p className="text-sm font-medium text-[color:#8B5D55]">
                Подтверждение еще не завершено
              </p>
              <button
                type="button"
                onClick={() => void resendVerification()}
                className="text-xs text-[color:#8B5D55] underline underline-offset-2"
              >
                Отправить письмо еще раз
              </button>
            </div>
          ) : null}
        </section>

        {!isEditing ? (
          <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-white/75 p-4 md:p-5">
            <h2 className="text-base font-semibold">Участники круга</h2>
            {circle.length === 0 ? (
              <p className="text-sm text-[color:rgba(63,58,52,.72)]">
                Ваш круг начинается с вас. Когда пригласите близких, они
                появятся здесь.
              </p>
            ) : (
              <div className="space-y-2">
                {circle.map((item) => (
                  <article
                    key={item.member_id}
                    className="rounded-xl border border-[var(--line)] bg-white p-3"
                  >
                    <div className="space-y-2">
                      <p className="text-xs text-[color:rgba(63,58,52,.62)]">Имя в системе</p>
                      <p className="text-sm font-semibold">{item.display_name}</p>
                    </div>
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-[color:rgba(63,58,52,.62)]">Имя в вашем круге</p>
                      <div className="flex gap-2">
                        <input
                          value={nickDrafts[item.member_id] ?? ""}
                          onChange={(e) =>
                            setNickDrafts((current) => ({
                              ...current,
                              [item.member_id]: e.target.value,
                            }))
                          }
                          placeholder="Например: муж, мама, бабушка…"
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
                      <p className="text-xs text-[color:rgba(63,58,52,.62)]">Это имя видите только вы.</p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}

        <section className="space-y-2 rounded-2xl border border-[var(--line)] bg-white/75 p-4 md:p-5">
          <h2 className="text-base font-semibold">Настройки безопасности</h2>
          <Link
            href="/profile/security"
            className="block text-sm text-[var(--accent-ink)] underline underline-offset-2"
          >
            Обновить пароль →
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

      {cropModalOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          onClick={closeCropModal}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--line)] bg-white"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
              <h3 className="text-base font-semibold text-[var(--accent-ink)]">
                Обрезка фото
              </h3>
              <button
                type="button"
                onClick={closeCropModal}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] bg-white"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="relative h-[420px] w-full bg-[#111]">
              {cropSource ? (
                <Cropper
                  image={cropSource}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                />
              ) : null}
            </div>

            <div className="space-y-3 px-4 py-4">
              <div className="flex items-center gap-3">
                <span className="w-16 text-xs text-[color:rgba(63,58,52,.72)]">
                  Масштаб
                </span>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  className="h-2 w-full"
                />
              </div>
              <button
                type="button"
                onClick={() => void saveCroppedAvatar()}
                disabled={uploadingAvatar}
                className="w-full rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-70"
              >
                {uploadingAvatar ? "Сохраняем..." : "Сохранить фото"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

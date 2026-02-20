"use client";

import { Camera, Trash2 } from "lucide-react";
import { useId } from "react";

type DeletePosition = "top-right" | "bottom-left";

type AvatarEditableProps = {
  src: string;
  alt: string;
  fallback: string;
  isEditing: boolean;
  avatarSize?: number;
  buttonSize?: number;
  holePadding?: number;
  deletePosition?: DeletePosition;
  canDelete?: boolean;
  onUploadClick: () => void;
  onDeleteClick: () => void;
  onImageError?: () => void;
};

export function AvatarEditable({
  src,
  alt,
  fallback,
  isEditing,
  avatarSize = 120,
  buttonSize = 40,
  holePadding = 7,
  deletePosition = "top-right",
  canDelete = true,
  onUploadClick,
  onDeleteClick,
  onImageError,
}: AvatarEditableProps) {
  const maskId = useId().replace(/:/g, "");
  const hasImage = src.trim().length > 0;

  const buttonInset = holePadding;
  const cameraCx = avatarSize - buttonInset - buttonSize / 2;
  const cameraCy = avatarSize - buttonInset - buttonSize / 2;

  const deleteCx =
    deletePosition === "top-right"
      ? avatarSize - buttonInset - buttonSize / 2
      : buttonInset + buttonSize / 2;
  const deleteCy =
    deletePosition === "top-right"
      ? buttonInset + buttonSize / 2
      : avatarSize - buttonInset - buttonSize / 2;

  const holeRadius = buttonSize / 2 + holePadding;

  const controlsVisibilityClass = isEditing
    ? "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
    : "opacity-0";

  return (
    <div
      className="group relative"
      style={{ width: `${avatarSize}px`, height: `${avatarSize}px` }}
    >
      <div className="h-full w-full overflow-hidden rounded-full border border-[var(--line)] bg-[var(--panel-soft)]">
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt}
            className="h-full w-full object-cover"
            onError={onImageError}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl font-semibold text-[var(--accent-ink)]">
            {fallback}
          </div>
        )}
      </div>

      {isEditing ? (
        <>
          <svg
            className={`pointer-events-none absolute inset-0 transition-opacity ${controlsVisibilityClass}`}
            width={avatarSize}
            height={avatarSize}
            viewBox={`0 0 ${avatarSize} ${avatarSize}`}
            aria-hidden="true"
          >
            <defs>
              <mask id={maskId} x="0" y="0" width={avatarSize} height={avatarSize} maskUnits="userSpaceOnUse">
                <rect width={avatarSize} height={avatarSize} fill="black" />
                <circle cx={avatarSize / 2} cy={avatarSize / 2} r={avatarSize / 2} fill="white" />
                <circle cx={cameraCx} cy={cameraCy} r={holeRadius} fill="black" />
                {canDelete ? <circle cx={deleteCx} cy={deleteCy} r={holeRadius} fill="black" /> : null}
              </mask>
            </defs>
            <rect
              x="0"
              y="0"
              width={avatarSize}
              height={avatarSize}
              fill="rgba(17,17,17,0.35)"
              mask={`url(#${maskId})`}
            />
          </svg>

          <button
            type="button"
            onClick={onUploadClick}
            className={`absolute z-10 inline-flex items-center justify-center rounded-full border border-white bg-[var(--accent)] text-white shadow-[0_4px_14px_rgba(89,66,39,.2)] transition-opacity ${controlsVisibilityClass}`}
            style={{
              width: `${buttonSize}px`,
              height: `${buttonSize}px`,
              left: `${cameraCx - buttonSize / 2}px`,
              top: `${cameraCy - buttonSize / 2}px`,
            }}
            aria-label="Загрузить фото"
          >
            <Camera className="h-5 w-5" />
          </button>

          {canDelete ? (
            <button
              type="button"
              onClick={onDeleteClick}
              className={`absolute z-10 inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-white text-[color:#8B5D55] shadow-[0_2px_10px_rgba(89,66,39,.14)] transition-opacity ${controlsVisibilityClass}`}
              style={{
                width: `${buttonSize}px`,
                height: `${buttonSize}px`,
                left: `${deleteCx - buttonSize / 2}px`,
                top: `${deleteCy - buttonSize / 2}px`,
              }}
              aria-label="Удалить фото"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

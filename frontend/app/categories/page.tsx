"use client";

import { FormEvent, useEffect, useState } from "react";
import { BookOpen, Check, Home, NotebookText, Sparkles, Trees, Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { api } from "@/lib/api";
import type { Category } from "@/lib/types";
import { useSessionStore } from "@/stores/session-store";

const ICONS = [
  { value: "Home", label: "Дом", Icon: Home },
  { value: "Sparkles", label: "Быт", Icon: Sparkles },
  { value: "Users", label: "Дети", Icon: Users },
  { value: "Trees", label: "Прогулки", Icon: Trees },
  { value: "BookOpen", label: "Учеба", Icon: BookOpen },
  { value: "NotebookText", label: "Заметки", Icon: NotebookText },
] as const;
const COLORS = ["#D7BFA8", "#B8C6A3", "#E0C8A8", "#AFC7B4", "#E5C4B8", "#C8B7AA", "#B9C8D9", "#D9C7B9"];
const iconByName = Object.fromEntries(ICONS.map((item) => [item.value, item.Icon])) as Record<string, typeof Home>;
const IMMUTABLE_BASE_CATEGORIES = new Set(["Дом", "Быт", "Дети", "Прогулки"]);

export default function CategoriesPage() {
  const { token } = useSessionStore();
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string>(ICONS[0].value);
  const [color, setColor] = useState(COLORS[0]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const categoriesRes = await api.getCategories(token);
        if (!cancelled) {
          setCategories(categoriesRes);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить категории");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, refreshKey]);

  async function createCategory(event: FormEvent) {
    event.preventDefault();
    if (!token || !name.trim()) return;
    setError(undefined);
    try {
      await api.createCategory(token, { name: name.trim(), icon, color });
      setName("");
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать категорию");
    }
  }

  async function toggleArchive(category: Category) {
    if (!token) return;
    setError(undefined);
    try {
      await api.patchCategory(token, category.id, { is_archived: !category.is_archived });
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить категорию");
    }
  }

  async function deleteCategory(category: Category) {
    if (!token) return;
    setError(undefined);
    try {
      await api.deleteCategory(token, category.id);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить категорию");
    }
  }

  if (loading) {
    return <p className="text-sm text-[color:rgba(63,58,52,.75)]">Загружаем категории...</p>;
  }

  return (
    <section className="space-y-4">
      <header>
        <h1 className="page-title text-4xl text-[var(--accent-ink)]">Категории</h1>
        <p className="text-sm text-[color:rgba(63,58,52,.75)]">Категории помогают мягко группировать события.</p>
      </header>

      <form onSubmit={createCategory} className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Новая категория"
          className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
        />

        <div>
          <p className="text-xs uppercase tracking-[0.08em] text-[color:rgba(63,58,52,.68)]">Иконка</p>
          <div className="mt-2 grid grid-cols-3 gap-2 md:grid-cols-6">
            {ICONS.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setIcon(value)}
                className={`cursor-pointer rounded-xl border px-2 py-2 text-center text-xs ${
                  icon === value ? "border-[var(--accent)] bg-white" : "border-[var(--line)] bg-white/60"
                }`}
              >
                <Icon className="mx-auto mb-1 h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.08em] text-[color:rgba(63,58,52,.68)]">Цвет</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {COLORS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setColor(value)}
                aria-label={`Выбрать цвет ${value}`}
                className={`relative h-8 w-8 cursor-pointer rounded-full border-2 ${color === value ? "scale-105 border-[var(--accent-ink)] ring-2 ring-white" : "border-transparent"}`}
                style={{ backgroundColor: value }}
              >
                {color === value ? <Check className="absolute left-1.5 top-1.5 h-4 w-4 text-white drop-shadow-sm" /> : null}
              </button>
            ))}
          </div>
        </div>

        <button className="cursor-pointer rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white">Добавить</button>
        {error ? <p className="text-xs text-[color:#8B5D55]">{error}</p> : null}
      </form>

      {categories.length === 0 ? (
        <EmptyState title="Категорий пока нет" />
      ) : (
        <div className="space-y-2">
          {categories.map((category) => {
            const Icon = iconByName[category.icon] ?? NotebookText;
            const isImmutableBase = category.is_default && IMMUTABLE_BASE_CATEGORIES.has(category.name);
            return (
              <article key={category.id} className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-white/70 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color }} />
                  <Icon className="h-4 w-4" />
                  <p className="text-sm">{category.name}</p>
                  {category.is_default ? <span className="text-xs text-[color:rgba(63,58,52,.65)]">базовая</span> : null}
                </div>
                <div className="flex gap-2">
                  {!isImmutableBase ? (
                    <>
                      <button type="button" onClick={() => toggleArchive(category)} className="cursor-pointer rounded-lg bg-[var(--panel-soft)] px-3 py-1 text-xs">
                        {category.is_archived ? "Вернуть" : "Скрыть"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteCategory(category)}
                        className="cursor-pointer px-2 py-1 text-xs text-[color:#8B3A2E] underline-offset-2 hover:underline"
                      >
                        Удалить
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

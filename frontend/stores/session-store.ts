"use client";

import { create } from "zustand";
import { api } from "@/lib/api";
import type { FamilyProject, SessionPayload } from "@/lib/types";

const SESSION_KEY = "flc.session";

type SessionState = {
  token?: string;
  userId?: string;
  memberId?: string;
  projectId?: string;
  project?: FamilyProject;
  loading: boolean;
  ensureSession: () => Promise<void>;
};

function readPersisted(): SessionPayload | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionPayload;
  } catch {
    return null;
  }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  loading: true,
  async ensureSession() {
    if (get().token && get().project) return;

    const existing = readPersisted();
    const session = existing
      ? await api.createSession("Участник семьи", existing.user_id)
      : await api.createSession("Родитель");

    if (typeof window !== "undefined") {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }

    const project = await api.getProject(session.token);
    set({
      token: session.token,
      userId: session.user_id,
      memberId: session.member_id,
      projectId: session.project_id,
      project,
      loading: false,
    });
  },
}));

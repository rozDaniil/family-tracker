"use client";

import { create } from "zustand";
import { api } from "@/lib/api";
import type { FamilyProject } from "@/lib/types";

type SessionState = {
  token?: string;
  userId?: string;
  memberId?: string;
  projectId?: string;
  project?: FamilyProject;
  emailVerified?: boolean;
  loading: boolean;
  ensureSession: () => Promise<void>;
  login: (payload: { email: string; password: string; remember_me?: boolean }) => Promise<void>;
  signup: (payload: { email: string; password: string; display_name: string; remember_me?: boolean }) => Promise<void>;
  logout: () => Promise<void>;
};

export const useSessionStore = create<SessionState>((set) => ({
  loading: true,
  async ensureSession() {
    if (typeof document !== "undefined") {
      const hasCsrfCookie = document.cookie
        .split(";")
        .map((item) => item.trim())
        .some((item) => item.startsWith("flc_csrf="));
      if (!hasCsrfCookie) {
        set({
          token: undefined,
          userId: undefined,
          memberId: undefined,
          projectId: undefined,
          project: undefined,
          emailVerified: undefined,
          loading: false,
        });
        return;
      }
    }

    try {
      const session = await api.getSession();
      set({
        token: "cookie-auth",
        userId: session.user.id,
        memberId: session.member.id,
        projectId: session.project.id,
        project: session.project,
        emailVerified: session.email_verified,
        loading: false,
      });
      return;
    } catch {
      // continue to refresh fallback
    }

    try {
      const refreshed = await api.refresh();
      set({
        token: "cookie-auth",
        userId: refreshed.user.id,
        memberId: refreshed.member.id,
        projectId: refreshed.project.id,
        project: refreshed.project,
        emailVerified: refreshed.email_verified,
        loading: false,
      });
      return;
    } catch {
      set({
        token: undefined,
        userId: undefined,
        memberId: undefined,
        projectId: undefined,
        project: undefined,
        emailVerified: undefined,
        loading: false,
      });
    }
  },

  async login(payload) {
    const session = await api.login(payload);
    set({
      token: "cookie-auth",
      userId: session.user.id,
      memberId: session.member.id,
      projectId: session.project.id,
      project: session.project,
      emailVerified: session.email_verified,
      loading: false,
    });
  },

  async signup(payload) {
    const session = await api.signup(payload);
    set({
      token: "cookie-auth",
      userId: session.user.id,
      memberId: session.member.id,
      projectId: session.project.id,
      project: session.project,
      emailVerified: session.email_verified,
      loading: false,
    });
  },

  async logout() {
    try {
      await api.logout();
    } finally {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("flc.auth_password");
        const remember = window.localStorage.getItem("flc.remember_me") === "1";
        if (!remember) {
          window.localStorage.removeItem("flc.auth_email");
        }
      }
      set({
        token: undefined,
        userId: undefined,
        memberId: undefined,
        projectId: undefined,
        project: undefined,
        emailVerified: undefined,
        loading: false,
      });
    }
  },
}));

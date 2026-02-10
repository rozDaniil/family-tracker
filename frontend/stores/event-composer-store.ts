"use client";

import { create } from "zustand";
import type { EventKind } from "@/lib/types";

type ComposerState = {
  mode: EventKind;
  setMode: (mode: EventKind) => void;
};

export const useEventComposerStore = create<ComposerState>((set) => ({
  mode: "NOTE",
  setMode: (mode) => set({ mode }),
}));

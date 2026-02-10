"use client";

import { create } from "zustand";

type FiltersState = {
  categoryId?: string;
  memberId?: string;
  setCategoryId: (id?: string) => void;
  setMemberId: (id?: string) => void;
};

export const useFiltersStore = create<FiltersState>((set) => ({
  categoryId: undefined,
  memberId: undefined,
  setCategoryId: (id) => set({ categoryId: id }),
  setMemberId: (id) => set({ memberId: id }),
}));

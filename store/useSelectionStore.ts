'use client';
import { create } from 'zustand';

/** Multi-selection in the order of battle (UI only: never saved, never part of the world). */
interface SelectionState {
  ships: string[];
  tfs: string[];
  toggleShip: (id: string) => void;
  toggleTf: (id: string) => void;
  setShips: (ids: string[]) => void;
  clear: () => void;
}

const flip = (xs: string[], id: string) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]);

export const useSelectionStore = create<SelectionState>((set) => ({
  ships: [],
  tfs: [],
  toggleShip: (id) => set((s) => ({ ships: flip(s.ships, id) })),
  toggleTf: (id) => set((s) => ({ tfs: flip(s.tfs, id) })),
  setShips: (ships) => set({ ships }),
  clear: () => set({ ships: [], tfs: [] }),
}));

'use client';
/**
 * Focus on what needs deciding: auto-pause settings (remembered per browser), dismissed queue items (this session), the last
 * auto-pause reason, and pan requests for the tactical map.
 */
import { create } from 'zustand';
import { DEFAULT_PAUSE_KINDS, type ActionKind } from '../lib/sim/actions';
import type { Vec2 } from '../lib/types/map';

const KEY = 'al.autopause';

interface FocusState {
  autoPause: boolean;
  pauseKinds: ActionKind[];
  dismissed: string[];
  /** Why the clock was last stopped automatically (shown in the strip until the clock runs again). */
  pausedFor: string | null;
  pan: { at: Vec2; seq: number } | null;
  cursor: number;
  hydrate: () => void;
  setAutoPause: (on: boolean) => void;
  toggleKind: (k: ActionKind) => void;
  dismiss: (id: string) => void;
  setPausedFor: (text: string | null) => void;
  panTo: (at: Vec2) => void;
  setCursor: (i: number) => void;
}

const persist = (s: Pick<FocusState, 'autoPause' | 'pauseKinds'>) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ autoPause: s.autoPause, pauseKinds: s.pauseKinds }));
  } catch {
    /* private mode: settings last for the session */
  }
};

export const useFocusStore = create<FocusState>((set, get) => ({
  autoPause: true,
  pauseKinds: [...DEFAULT_PAUSE_KINDS],
  dismissed: [],
  pausedFor: null,
  pan: null,
  cursor: -1,
  hydrate: () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const v = JSON.parse(raw) as { autoPause?: boolean; pauseKinds?: ActionKind[] };
      set({ autoPause: v.autoPause ?? true, pauseKinds: Array.isArray(v.pauseKinds) ? v.pauseKinds : [...DEFAULT_PAUSE_KINDS] });
    } catch {
      /* keep defaults */
    }
  },
  setAutoPause: (autoPause) => {
    set({ autoPause });
    persist(get());
  },
  toggleKind: (k) => {
    const cur = get().pauseKinds;
    set({ pauseKinds: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] });
    persist(get());
  },
  dismiss: (id) => set((s) => ({ dismissed: [...s.dismissed, id] })),
  setPausedFor: (pausedFor) => set({ pausedFor }),
  panTo: (at) => set((s) => ({ pan: { at, seq: (s.pan?.seq ?? 0) + 1 } })),
  setCursor: (cursor) => set({ cursor }),
}));

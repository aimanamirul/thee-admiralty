'use client';

/**
 * The action currently hovered / focused. Holds the preview *function*, not its text, so the strip can recompute it as the
 * world changes while the pointer rests on the action (e.g. a route estimate while the clock runs).
 */
import { create } from 'zustand';
import type { WorldDraft } from '../lib/types/world';

export type PreviewFn = (w: WorldDraft) => string;

interface PreviewState {
  fn: PreviewFn | null;
  /** Identifies who set the preview, so a stale "leave" from another element does not clear it. */
  owner: string | null;
  show: (fn: PreviewFn, owner: string) => void;
  clear: (owner: string) => void;
}

export const usePreviewStore = create<PreviewState>((set, get) => ({
  fn: null,
  owner: null,
  show: (fn, owner) => set({ fn, owner }),
  clear: (owner) => {
    if (get().owner === owner) set({ fn: null, owner: null });
  },
}));

let seq = 0;
/** Unique owner id per call site instance. */
export const previewOwner = () => `p${++seq}`;

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

/** Grace period before a cleared preview disappears, so moving from one action to the next never flashes the placeholder. */
const CLEAR_DELAY_MS = 140;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

export const usePreviewStore = create<PreviewState>((set, get) => ({
  fn: null,
  owner: null,
  show: (fn, owner) => {
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = undefined;
    set({ fn, owner });
  },
  clear: (owner) => {
    if (get().owner !== owner) return;
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      clearTimer = undefined;
      if (get().owner === owner) set({ fn: null, owner: null });
    }, CLEAR_DELAY_MS);
  },
}));

let seq = 0;
/** Unique owner id per call site instance. */
export const previewOwner = () => `p${++seq}`;

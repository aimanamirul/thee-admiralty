'use client';
import { create } from 'zustand';

const KEY = 'al.sound';
const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
};

/** Sound is off until the player turns it on (browsers block audio before a click, and surprises are rude). */
interface SoundState {
  on: boolean;
  /** Read the saved preference (client only; called once from the cockpit). */
  hydrate: () => void;
  toggle: () => void;
}

export const useSoundStore = create<SoundState>((set, get) => ({
  on: false,
  hydrate: () => set({ on: read() }),
  toggle: () => {
    const on = !get().on;
    set({ on });
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* private mode: the choice lasts for the session */
    }
  },
}));

'use client';

/**
 * Tutorial state machine. Imports the game store; the game store never imports this (one-way dependency).
 * Lessons come from `lib/tutorial/lessons.ts`; `evaluate` runs on every game-store change.
 */
import { create } from 'zustand';
import { LESSONS, type TutorialView, type UiFlag } from '../lib/tutorial/lessons';
import { createTutorialMap, createTutorialWorld } from '../lib/sim/tutorialScenario';
import type { WorldDraft } from '../lib/types/world';
import { DEFAULT_SEED, useFleetStore } from './useFleetStore';

const STORAGE_KEY = 'al.tutorial';
/** Progress checkpoint taken at the start of every lesson, so a reload resumes the briefing instead of restarting it. */
const CHECKPOINT_KEY = 'al.tutorial.checkpoint';
const CHECKPOINT_VERSION = 3;

export type TutorialStatus = 'new' | 'done' | 'skipped';

interface TutorialState {
  active: boolean;
  lessonIndex: number;
  flags: UiFlag[];
  startSeq: number;
  /** Objective met: the card says "complete" and waits for the player to press Next. */
  completing: boolean;
  /** Highest lesson reached; lessons at or below it can be revisited with Back / Next. */
  furthest: number;
  /** The clock was started by the lesson's `run.when` condition. */
  ranWhen: boolean;
  /** All lessons done; the final card offers keep-playing / new theatre. */
  graduated: boolean;
  status: TutorialStatus;
  begin: () => void;
  /** Continue a briefing saved in localStorage; false if there is none. */
  resume: () => boolean;
  skip: () => void;
  finish: (newTheatre: boolean) => void;
  evaluate: () => void;
  advance: () => void;
  /** Next briefing: needs the objective met, or a lesson already reached (recap). */
  next: () => void;
  /** Previous briefing, restored to the state it started in. */
  back: () => void;
}

/** What a lesson started with, kept in memory so Back / Next can return to it (only the latest one survives a reload). */
interface Snap {
  /** Sector selected on the plot, so a lesson that builds on the previous click still finds it. */
  sector: number | null;
  flags: UiFlag[];
  world: Omit<WorldDraft, 'map'>;
  log: ReturnType<typeof useFleetStore.getState>['log'];
  logSeq: number;
}
let snapshots: Record<number, Snap> = {};
/** Live state of the furthest lesson, saved when the player goes back so Next returns to it rather than to its start. */
let progress: (Snap & { startSeq: number; ranWhen: boolean }) | null = null;

export const canGoBack = (lessonIndex: number) => lessonIndex > 0 && !!snapshots[lessonIndex - 1];

function readStatus(): TutorialStatus {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'done' || v === 'skipped' ? v : 'new';
  } catch {
    return 'new';
  }
}
function writeStatus(s: TutorialStatus) {
  try {
    localStorage.setItem(STORAGE_KEY, s);
  } catch {}
}

interface Checkpoint {
  version: number;
  lessonIndex: number;
  lessonId: string;
  flags: UiFlag[];
  /** World before the lesson's onEnter ran; the map is regenerated from the fixed tutorial seed on resume. */
  world: Omit<WorldDraft, 'map'>;
  log: ReturnType<typeof useFleetStore.getState>['log'];
  logSeq: number;
}

function readCheckpoint(): Checkpoint | null {
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Checkpoint;
    // Discard checkpoints from an older lesson script.
    if (c.version !== CHECKPOINT_VERSION || LESSONS[c.lessonIndex]?.id !== c.lessonId) return null;
    return c;
  } catch {
    return null;
  }
}
function clearCheckpoint() {
  try {
    localStorage.removeItem(CHECKPOINT_KEY);
  } catch {}
}

/** For the title screen: the lesson a saved briefing would resume at. */
export function savedBriefing(): { lessonIndex: number; title: string } | null {
  const c = readCheckpoint();
  return c ? { lessonIndex: c.lessonIndex, title: LESSONS[c.lessonIndex].title } : null;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let entering = false;

export function tutorialView(startSeq: number): TutorialView {
  const g = useFleetStore.getState();
  return {
    tick: g.tick, map: g.map, selectedSectorId: g.selectedSectorId, sectors: g.sectors, fleets: g.fleets, ships: g.ships,
    vendors: g.vendors, research: g.research, resources: g.resources, spares: g.spares, contacts: g.contacts, shipping: g.shipping, running: g.running, log: g.log, startSeq,
  };
}

export const useTutorialStore = create<TutorialState>((set, get) => {
  const enter = (i: number) => {
    const lesson = LESSONS[i];
    const g = useFleetStore.getState();
    entering = true;
    try {
      try {
        const { map: _map, ...world } = g.snapshotWorld();
        snapshots[i] = { sector: g.selectedSectorId, flags: get().flags, world: structuredClone(world), log: g.log, logSeq: g.logSeq };
        const cp: Checkpoint = { version: CHECKPOINT_VERSION, lessonIndex: i, lessonId: lesson.id, flags: get().flags, world, log: g.log, logSeq: g.logSeq };
        localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(cp));
      } catch {}
      if (i > get().furthest) progress = null;
      set((s) => ({
        lessonIndex: i,
        furthest: Math.max(s.furthest, i),
        completing: false,
        ranWhen: false,
        flags: lesson.reveals.includes('*') ? ['*'] : [...new Set([...s.flags, ...lesson.reveals])],
      }));
      g.setDesignerPreset(lesson.preset ?? null);
      if (lesson.tab) g.setTab(lesson.tab);
      if (lesson.select !== undefined) g.selectSector(lesson.select);
      if (lesson.onEnter) g.mutate(lesson.onEnter);
      if (lesson.selectContact) g.selectContact(lesson.selectContact);
      if (lesson.selectMerchant) g.selectMerchant(lesson.selectMerchant);
      // Ledger entries written by onEnter itself must not satisfy this lesson's own gate.
      set({ startSeq: useFleetStore.getState().logSeq });
      if (lesson.run && !lesson.run.when) {
        g.setSpeed(lesson.run.speed);
        g.setRunning(true);
      } else {
        g.setRunning(false);
      }
    } finally {
      entering = false;
    }
    // A lesson whose objective already holds on entry shows as complete and waits for Next (no store change would re-evaluate it).
    queueMicrotask(() => get().evaluate());
  };

  /** Save the live state of the furthest lesson before leaving it backwards. */
  const keepProgress = () => {
    const s = get();
    if (s.lessonIndex !== s.furthest) return;
    const g = useFleetStore.getState();
    const { map: _map, ...world } = g.snapshotWorld();
    progress = { sector: g.selectedSectorId, flags: s.flags, world, log: g.log, logSeq: g.logSeq, startSeq: s.startSeq, ranWhen: s.ranWhen };
  };

  /** Go to lesson `i`: its start state for a recap, or the saved live state when returning to the furthest lesson. */
  const restore = (i: number) => {
    const snap = snapshots[i];
    if (!snap) return;
    if (timer) clearTimeout(timer);
    const g = useFleetStore.getState();
    if (progress && i === get().furthest) {
      const p = progress;
      progress = null;
      g.loadWorld({ ...structuredClone(p.world), map: createTutorialMap() } as WorldDraft, { log: p.log, logSeq: p.logSeq });
      const lesson = LESSONS[i];
      set({ lessonIndex: i, flags: p.flags, graduated: false, completing: false, ranWhen: p.ranWhen, startSeq: p.startSeq });
      g.setDesignerPreset(lesson.preset ?? null);
      if (lesson.tab) g.setTab(lesson.tab);
      g.selectSector(p.sector);
      if (lesson.select !== undefined) g.selectSector(lesson.select);
      if (lesson.selectContact) g.selectContact(lesson.selectContact);
      if (lesson.selectMerchant) g.selectMerchant(lesson.selectMerchant);
      g.setRunning(!!lesson.run && (!lesson.run.when || p.ranWhen));
      if (lesson.run) g.setSpeed(lesson.run.speed);
      queueMicrotask(() => get().evaluate());
      return;
    }
    g.loadWorld({ ...structuredClone(snap.world), map: createTutorialMap() } as WorldDraft, { log: snap.log, logSeq: snap.logSeq });
    set({ flags: snap.flags, graduated: false, completing: false, ranWhen: false });
    g.selectSector(snap.sector);
    enter(i);
  };

  return {
    active: false,
    lessonIndex: -1,
    furthest: -1,
    flags: [],
    startSeq: 0,
    completing: false,
    ranWhen: false,
    graduated: false,
    status: readStatus(),

    resume: () => {
      const c = readCheckpoint();
      if (!c) return false;
      if (timer) clearTimeout(timer);
      const world = { ...c.world, map: createTutorialMap() } as WorldDraft;
      useFleetStore.getState().loadWorld(world, { log: c.log, logSeq: c.logSeq });
      snapshots = {};
      progress = null;
      set({ active: true, lessonIndex: -1, furthest: c.lessonIndex, flags: c.flags, graduated: false, completing: false, ranWhen: false });
      enter(c.lessonIndex);
      return true;
    },

    begin: () => {
      if (timer) clearTimeout(timer);
      clearCheckpoint();
      useFleetStore.getState().loadWorld(createTutorialWorld());
      snapshots = {};
      progress = null;
      set({ active: true, lessonIndex: -1, furthest: -1, flags: [], graduated: false, completing: false, ranWhen: false });
      enter(0);
    },

    skip: () => {
      if (timer) clearTimeout(timer);
      const g = useFleetStore.getState();
      g.setDesignerPreset(null);
      g.mutate((w) => {
        w.scripted = false;
        w.policy.autoSpares = true;
      });
      writeStatus('skipped');
      clearCheckpoint();
      set({ active: false, flags: ['*'], completing: false, graduated: false, status: 'skipped' });
    },

    finish: (newTheatre) => {
      if (timer) clearTimeout(timer);
      writeStatus('done');
      clearCheckpoint();
      useFleetStore.getState().setDesignerPreset(null);
      set({ active: false, flags: ['*'], completing: false, graduated: false, status: 'done' });
      if (newTheatre) useFleetStore.getState().newTheatre(DEFAULT_SEED);
    },

    advance: () => {
      const { lessonIndex } = get();
      if (lessonIndex + 1 < LESSONS.length) enter(lessonIndex + 1);
      else {
        writeStatus('done');
        clearCheckpoint();
        set({ graduated: true, completing: false, status: 'done' });
      }
    },

    next: () => {
      const s = get();
      if (!s.active || s.graduated || s.lessonIndex < 0) return;
      if (s.lessonIndex < s.furthest) restore(s.lessonIndex + 1);
      else if (s.completing) get().advance();
    },

    back: () => {
      const s = get();
      if (!s.active || s.lessonIndex <= 0 || !snapshots[s.lessonIndex - 1]) return;
      keepProgress();
      restore(s.lessonIndex - 1);
    },

    evaluate: () => {
      const s = get();
      if (!s.active || s.completing || s.graduated || entering || s.lessonIndex < 0) return;
      const lesson = LESSONS[s.lessonIndex];
      const g = useFleetStore.getState();
      const v = tutorialView(s.startSeq);
      if (lesson.run?.when && !s.ranWhen && lesson.run.when(v)) {
        set({ ranWhen: true });
        g.setSpeed(lesson.run.speed);
        g.setRunning(true);
      }
      if (lesson.gate(v)) {
        set({ completing: true });
        g.setRunning(false);
      }
    },
  };
});

/** True while the briefing is running and has not yet handed over the whole UI. */
export function useTutorialLocked(): boolean {
  return useTutorialStore((s) => s.active && !s.flags.includes('*'));
}

/** True when the UI element is visible: always outside the tutorial, otherwise once a lesson has revealed it. */
export function useUiFlag(flag: UiFlag): boolean {
  return useTutorialStore((s) => !s.active || s.flags.includes('*') || s.flags.includes(flag));
}

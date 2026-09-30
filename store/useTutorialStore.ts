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
const CHECKPOINT_VERSION = 1;
const COMPLETE_DELAY_MS = 1400;

export type TutorialStatus = 'new' | 'done' | 'skipped';

interface TutorialState {
  active: boolean;
  lessonIndex: number;
  flags: UiFlag[];
  startSeq: number;
  /** Objective met; showing "complete" before advancing. */
  completing: boolean;
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
}

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
    vendors: g.vendors, research: g.research, resources: g.resources, spares: g.spares, running: g.running, log: g.log, startSeq,
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
        const cp: Checkpoint = { version: CHECKPOINT_VERSION, lessonIndex: i, lessonId: lesson.id, flags: get().flags, world, log: g.log, logSeq: g.logSeq };
        localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(cp));
      } catch {}
      set((s) => ({
        lessonIndex: i,
        completing: false,
        ranWhen: false,
        flags: lesson.reveals.includes('*') ? ['*'] : [...new Set([...s.flags, ...lesson.reveals])],
      }));
      g.setDesignerPreset(lesson.preset ?? null);
      if (lesson.tab) g.setTab(lesson.tab);
      if (lesson.select !== undefined) g.selectSector(lesson.select);
      if (lesson.onEnter) g.mutate(lesson.onEnter);
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
  };

  return {
    active: false,
    lessonIndex: -1,
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
      set({ active: true, lessonIndex: -1, flags: c.flags, graduated: false, completing: false, ranWhen: false });
      enter(c.lessonIndex);
      return true;
    },

    begin: () => {
      if (timer) clearTimeout(timer);
      clearCheckpoint();
      useFleetStore.getState().loadWorld(createTutorialWorld());
      set({ active: true, lessonIndex: -1, flags: [], graduated: false, completing: false, ranWhen: false });
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
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => get().advance(), COMPLETE_DELAY_MS);
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

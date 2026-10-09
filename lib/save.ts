/**
 * Saved games (browser storage). A save is the world minus its map (regenerated from the seed, deterministic) plus the ledger and the
 * player's saved designs. Autosaved during play; the title screen offers Continue, optionally with a catch-up of the days spent away.
 */
import { generateMap } from './generator/seedMap';
import { createTutorialMap } from './sim/tutorialScenario';
import { TUTORIAL_SEED } from './sim/tutorialScenario';
import type { ShipDesign } from './types/hull';
import type { MapArchetype } from './types/map';
import { normalizeShipping } from './types/shipping';
import { normalizeStations } from './sim/moc';
import type { GameEvent, WorldDraft } from './types/world';

export const SAVE_KEY = 'al.save.v1';
export const SAVE_VERSION = 1;
/** One simulated day of catch-up per this many real minutes away, to at most CATCH_UP_MAX_DAYS. */
export const CATCH_UP_MINUTES_PER_DAY = 2;
export const CATCH_UP_MAX_DAYS = 30;
/** Away for less than this many days' worth of time: no catch-up is offered. */
export const CATCH_UP_MIN_DAYS = 3;

export interface SaveGame {
  version: number;
  /** Date.now() when written. */
  savedAt: number;
  archetype: MapArchetype;
  world: Omit<WorldDraft, 'map' | 'events'>;
  log: GameEvent[];
  logSeq: number;
  designs: ShipDesign[];
}

export interface SaveSummary {
  savedAt: number;
  tick: number;
  seed: string;
  archetype: MapArchetype;
  ships: number;
  fiscalYear: number;
  support: number;
  /** Simulated days a catch-up would run if the player continued now (0 = none offered). */
  catchUpDays: number;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** Everything a save needs from the game state. */
export function makeSave(world: WorldDraft, log: GameEvent[], logSeq: number, designs: ShipDesign[], now = Date.now()): SaveGame {
  const { map, events: _events, ...rest } = world;
  void _events;
  return { version: SAVE_VERSION, savedAt: now, archetype: map.archetype, world: structuredClone(rest), log, logSeq, designs };
}

export function writeSave(save: SaveGame, s: Storage | null = store()): boolean {
  if (!s) return false;
  try {
    s.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function readSave(s: Storage | null = store()): SaveGame | null {
  if (!s) return null;
  try {
    const raw = s.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw) as SaveGame;
    if (save.version !== SAVE_VERSION || !save.world || typeof save.world.tick !== 'number' || typeof save.world.seed !== 'string' || !Array.isArray(save.log)) return null;
    return save;
  } catch {
    return null;
  }
}

export function clearSave(s: Storage | null = store()): void {
  try {
    s?.removeItem(SAVE_KEY);
  } catch {}
}

/** Days of catch-up earned by `awayMs` of real time. */
export function catchUpDaysFor(awayMs: number): number {
  const days = Math.floor(awayMs / 60000 / CATCH_UP_MINUTES_PER_DAY);
  return days < CATCH_UP_MIN_DAYS ? 0 : Math.min(CATCH_UP_MAX_DAYS, days);
}

export function summarize(save: SaveGame, now = Date.now()): SaveSummary {
  return {
    savedAt: save.savedAt,
    tick: save.world.tick,
    seed: save.world.seed,
    archetype: save.archetype,
    ships: Object.keys(save.world.ships).length,
    fiscalYear: save.world.politics.fiscal.year,
    support: save.world.politics.support,
    catchUpDays: catchUpDaysFor(now - save.savedAt),
  };
}

/** Rebuild a playable world from a save (the map is regenerated; fields added since the save was written are filled in). */
export function restoreWorld(save: SaveGame): WorldDraft {
  const map = save.world.seed === TUTORIAL_SEED ? createTutorialMap() : generateMap(save.world.seed, save.archetype);
  const w = { ...structuredClone(save.world), map, events: [] } as WorldDraft;
  w.shipping = normalizeShipping(w.shipping);
  normalizeStations(w);
  return w;
}

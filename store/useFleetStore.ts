'use client';

/**
 * Central Zustand store. The simulation itself is pure engine code in `lib/sim`; the store's job is to
 * hand the engines a structured clone of the world, commit the result, and keep UI-only state.
 */
import { create } from 'zustand';
import { STARTER_DESIGNS } from '../lib/data/catalog';
import * as cmd from '../lib/sim/commands';
import type { CommandResult } from '../lib/sim/commands';
import { createInitialWorld } from '../lib/sim/scenario';
import { advanceDay } from '../lib/sim/worldEngine';
import { lobbyVendor } from '../lib/sim/diplomacyEngine';
import * as hulk from '../lib/sim/fleetEngine';
import type { Fleet, HierarchyKind, Ship, Tempo } from '../lib/types/fleet';
import type { ShipDesign } from '../lib/types/hull';
import type { MapArchetype, MapData } from '../lib/types/map';
import type { Contact, GameEvent, ResearchState, Resources, Roe, SectorState, WorldDraft } from '../lib/types/world';
import type { NamingTradition } from '../lib/types/fleet';
import type { SanctionEvent, Vendor, VendorId } from '../lib/types/diplomacy';

export type PanelTab = 'SECTOR' | 'FLEET' | 'RND' | 'DIPLO';
export type SimSpeed = 1 | 4 | 16;

const LOG_CAP = 400;
export const DEFAULT_SEED = 'ADMIRALTY-001';

interface WorldSlice {
  seed: string;
  tick: number;
  map: MapData;
  resources: Resources;
  ships: Record<string, Ship>;
  fleets: Fleet[];
  spares: Record<string, number>;
  sectors: Record<number, SectorState>;
  vendors: Record<VendorId, Vendor>;
  sanctions: SanctionEvent[];
  research: ResearchState;
  contacts: Contact[];
  tension: number;
  scripted: boolean;
  policy: { autoSpares: boolean };
  stats: WorldDraft['stats'];
}

interface UiSlice {
  log: GameEvent[];
  logSeq: number;
  running: boolean;
  speed: SimSpeed;
  tab: PanelTab;
  selectedSectorId: number | null;
  selectedTaskForceId: string | null;
  selectedShipId: string | null;
  designerOpen: boolean;
  designs: ShipDesign[];
  toast: { text: string; ok: boolean; id: number } | null;
  /** Root font-size multiplier; every rem-based UI size and canvas label follows it. */
  uiScale: number;
  /** Design the designer opens with (set by the tutorial); null = first saved design. */
  designerPreset: ShipDesign | null;
}

interface Actions {
  step: (days?: number) => void;
  setRunning: (on: boolean) => void;
  setSpeed: (s: SimSpeed) => void;
  newTheatre: (seed: string, archetype?: MapArchetype) => void;
  setTab: (t: PanelTab) => void;
  selectSector: (id: number | null) => void;
  selectTaskForce: (id: string | null) => void;
  selectShip: (id: string | null) => void;
  setDesignerOpen: (open: boolean) => void;
  saveDesign: (d: ShipDesign) => void;
  deleteDesign: (id: string) => void;
  dismissToast: () => void;
  setUiScale: (v: number) => void;
  /** Replace the whole world (tutorial scenario, loaded games). Resets selection, clock and ledger. */
  loadWorld: (w: WorldDraft) => void;
  /** Apply an arbitrary edit to the world through the normal command path (scripted events). */
  mutate: (fn: (w: WorldDraft) => void) => void;
  setDesignerPreset: (d: ShipDesign | null) => void;
  // commands (each returns the engine's verdict)
  orderShip: (a: { designName: string; hullId: ShipDesign['hullId']; moduleIds: string[]; squadronId: string; tradition: NamingTradition; customName?: string }) => CommandResult;
  buySpares: (moduleId: string, qty: number) => CommandResult;
  substituteModule: (shipId: string, index: number, moduleId: string) => CommandResult;
  startResearch: (id: string) => CommandResult;
  stopResearch: (id: string) => CommandResult;
  fundBureau: () => CommandResult;
  expandIndustry: () => CommandResult;
  lobby: (vendorId: VendorId, ministryId: string) => CommandResult;
  setRoe: (sectorId: number, roe: Roe) => CommandResult;
  assignTaskForce: (tfId: string, sectorId: number | null) => CommandResult;
  setTempo: (tfId: string, tempo: Tempo) => CommandResult;
  toggleHold: (shipId: string) => CommandResult;
  designateHulk: (shipId: string) => CommandResult;
  stripHulk: (shipId: string) => CommandResult;
  restoreHulk: (shipId: string) => CommandResult;
  renameNode: (kind: HierarchyKind, id: string, name: string) => CommandResult;
  createFleet: (name: string) => CommandResult;
  createTaskForce: (fleetId: string, name: string) => CommandResult;
  createSquadron: (tfId: string, name: string) => CommandResult;
  moveShip: (shipId: string, squadronId: string) => CommandResult;
  setAutoSpares: (on: boolean) => CommandResult;
}

export type GameState = WorldSlice & UiSlice & Actions;

const pickWorld = (s: GameState): WorldDraft => {
  // The map is large and immutable during play: share it, clone everything else.
  const mutable = structuredClone({
    resources: s.resources, ships: s.ships, fleets: s.fleets, spares: s.spares, sectors: s.sectors, vendors: s.vendors,
    sanctions: s.sanctions, research: s.research, contacts: s.contacts, tension: s.tension, scripted: s.scripted, policy: s.policy, stats: s.stats,
  });
  return { seed: s.seed, tick: s.tick, map: s.map, events: [], ...mutable };
};

const worldPatch = (w: WorldDraft): WorldSlice => ({
  seed: w.seed, tick: w.tick, map: w.map, resources: w.resources, ships: w.ships, fleets: w.fleets, spares: w.spares,
  sectors: w.sectors, vendors: w.vendors, sanctions: w.sanctions, research: w.research, contacts: w.contacts,
  tension: w.tension, scripted: w.scripted, policy: w.policy, stats: w.stats,
});

function appendLog(log: GameEvent[], seq: number, tick: number, pending: WorldDraft['events']) {
  if (pending.length === 0) return { log, logSeq: seq };
  const added = pending.map((e, i) => ({ id: seq + i + 1, tick, severity: e.severity, text: e.text }));
  const merged = log.concat(added);
  return { log: merged.length > LOG_CAP ? merged.slice(merged.length - LOG_CAP) : merged, logSeq: seq + added.length };
}

function freshState(seed: string, archetype?: MapArchetype): WorldSlice & Pick<UiSlice, 'log' | 'logSeq'> {
  const w = createInitialWorld(seed, archetype);
  const { log, logSeq } = appendLog([], 0, 0, w.events);
  return { ...worldPatch(w), log, logSeq };
}

export const useFleetStore = create<GameState>((set, get) => {
  /** Run a command against a cloned world; commit on success and stream its events to the ledger. */
  const run = (fn: (w: WorldDraft) => CommandResult): CommandResult => {
    const s = get();
    const w = pickWorld(s);
    const res = fn(w);
    if (res.ok) {
      const l = appendLog(s.log, s.logSeq, w.tick, w.events);
      set({ ...worldPatch(w), ...l, toast: null });
    } else {
      set({ toast: { text: res.reason ?? 'ORDER REFUSED', ok: false, id: s.toast ? s.toast.id + 1 : 1 } });
    }
    return res;
  };

  return {
    ...freshState(DEFAULT_SEED),
    running: false,
    speed: 1,
    tab: 'FLEET',
    selectedSectorId: null,
    selectedTaskForceId: null,
    selectedShipId: null,
    designerOpen: false,
    designs: STARTER_DESIGNS,
    toast: null,
    uiScale: 1,
    designerPreset: null,

    step: (days = 1) => {
      const s = get();
      const w = pickWorld(s);
      let log = s.log;
      let seq = s.logSeq;
      for (let i = 0; i < days; i++) {
        advanceDay(w);
        const l = appendLog(log, seq, w.tick, w.events);
        log = l.log;
        seq = l.logSeq;
        w.events = [];
      }
      set({ ...worldPatch(w), log, logSeq: seq });
    },
    setRunning: (running) => set({ running }),
    setSpeed: (speed) => set({ speed }),
    newTheatre: (seed, archetype) =>
      set({
        ...freshState(seed.trim() || DEFAULT_SEED, archetype),
        running: false,
        selectedSectorId: null,
        selectedTaskForceId: null,
        selectedShipId: null,
        toast: null,
      }),
    loadWorld: (w) => {
      const { log, logSeq } = appendLog([], 0, w.tick, w.events);
      w.events = [];
      set({
        ...worldPatch(w),
        log,
        logSeq,
        running: false,
        speed: 1,
        selectedSectorId: null,
        selectedTaskForceId: null,
        selectedShipId: null,
        designerOpen: false,
        toast: null,
      });
    },
    mutate: (fn) => {
      run((w) => {
        fn(w);
        return { ok: true };
      });
    },
    setDesignerPreset: (designerPreset) => set({ designerPreset }),
    setTab: (tab) => set({ tab }),
    selectSector: (id) => set(id === null ? { selectedSectorId: null } : { selectedSectorId: id, tab: 'SECTOR' }),
    selectTaskForce: (id) => set(id === null ? { selectedTaskForceId: null } : { selectedTaskForceId: id, tab: 'FLEET' }),
    selectShip: (id) => set({ selectedShipId: id }),
    setDesignerOpen: (designerOpen) => set({ designerOpen }),
    saveDesign: (d) => set((s) => ({ designs: [...s.designs.filter((x) => x.id !== d.id), d] })),
    deleteDesign: (id) => set((s) => ({ designs: s.designs.filter((x) => x.id !== id) })),
    dismissToast: () => set({ toast: null }),
    setUiScale: (v) => set({ uiScale: Math.max(0.85, Math.min(1.6, Math.round(v * 20) / 20)) }),

    orderShip: (a) => run((w) => cmd.orderShip(w, a)),
    buySpares: (id, qty) => run((w) => cmd.buySpares(w, id, qty)),
    substituteModule: (shipId, index, id) => run((w) => cmd.substituteModule(w, shipId, index, id)),
    startResearch: (id) => run((w) => cmd.startResearch(w, id)),
    stopResearch: (id) => run((w) => cmd.stopResearch(w, id)),
    fundBureau: () => run((w) => cmd.fundBureau(w)),
    expandIndustry: () => run((w) => cmd.expandIndustry(w)),
    lobby: (vendorId, ministryId) => run((w) => lobbyCmd(w, vendorId, ministryId)),
    setRoe: (sectorId, roe) => run((w) => cmd.setRoe(w, sectorId, roe)),
    assignTaskForce: (tfId, sectorId) => run((w) => cmd.assignTaskForce(w, tfId, sectorId)),
    setTempo: (tfId, tempo) => run((w) => cmd.setTempo(w, tfId, tempo)),
    toggleHold: (id) => run((w) => cmd.toggleHold(w, id)),
    designateHulk: (id) => run((w) => hulk.designateHulk(w, id)),
    stripHulk: (id) => run((w) => hulk.stripHulk(w, id)),
    restoreHulk: (id) =>
      run((w) => {
        hulk.unHulk(w, id);
        return { ok: true };
      }),
    renameNode: (kind, id, name) => run((w) => cmd.renameNode(w, kind, id, name)),
    createFleet: (name) => run((w) => cmd.createFleet(w, name)),
    createTaskForce: (fleetId, name) => run((w) => cmd.createTaskForce(w, fleetId, name)),
    createSquadron: (tfId, name) => run((w) => cmd.createSquadron(w, tfId, name)),
    moveShip: (shipId, sqId) => run((w) => cmd.moveShip(w, shipId, sqId)),
    setAutoSpares: (on) => run((w) => cmd.setAutoSpares(w, on)),
  };
});

function lobbyCmd(w: WorldDraft, vendorId: VendorId, ministryId: string): CommandResult {
  const r = lobbyVendor(w, vendorId, ministryId);
  return r.ok ? { ok: true } : { ok: false, reason: r.reason };
}

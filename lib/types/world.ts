/** Shared simulation-level types: resources, contacts, events and the mutable world the engines step. */
import type { SanctionEvent, Vendor, VendorId } from './diplomacy';
import type { BridgeKey } from './equipment';
import type { Fleet, Ship } from './fleet';
import type { MapData, Vec2 } from './map';

export interface Resources {
  budget: number;
  industrialCapacity: number;
  researchPoints: number;
  politicalCapital: number;
}

export type Roe = 'HOLD_FIRE' | 'RETURN_FIRE' | 'WEAPONS_FREE';

export interface SectorState {
  threat: number;
  roe: Roe;
}

/** What the plot shows. The true intent is hidden until a task force identifies the track. */
export type ContactClass = 'UNKNOWN' | 'HOSTILE' | 'NEUTRAL';

export interface Contact {
  id: string;
  sectorId: number;
  position: Vec2;
  heading: number;
  cls: ContactClass;
  /** Hidden ground truth. */
  hostile: boolean;
  /** Strength scalar derived from sector threat at spawn. */
  strength: number;
  bornTick: number;
  expiresTick: number;
  /** Scripted contacts steer straight at this task force instead of drifting. */
  pursue?: string;
}

export type EventSeverity = 'INFO' | 'ADVISORY' | 'WARNING' | 'CRITICAL' | 'COMBAT';

export interface GameEvent {
  id: number;
  tick: number;
  severity: EventSeverity;
  text: string;
}

export interface ResearchState {
  /** Projects currently consuming RP (max RESEARCH_SLOTS). */
  active: string[];
  progress: Record<string, number>;
  completed: string[];
}

export interface PendingEvent {
  severity: EventSeverity;
  text: string;
}

/** Everything a simulated day reads and mutates. The store hands engines a structured clone of this. */
export interface WorldDraft {
  seed: string;
  tick: number;
  map: MapData;
  resources: Resources;
  ships: Record<string, Ship>;
  fleets: Fleet[];
  /** Spare-parts inventory keyed by module id. */
  spares: Record<string, number>;
  sectors: Record<number, SectorState>;
  vendors: Record<VendorId, Vendor>;
  sanctions: SanctionEvent[];
  research: ResearchState;
  contacts: Contact[];
  /** Global geopolitical tension 0-100; drives sanction risk. */
  tension: number;
  events: PendingEvent[];
  /** Tutorial worlds disable random events (contacts, sanctions, failures, threat drift) so lessons are deterministic. */
  scripted: boolean;
  /** Standing orders. */
  policy: { autoSpares: boolean };
  /** Running statistics for the ledger. */
  stats: { hostilesDestroyed: number; shipsLost: number; incidents: number };
}

export type Bridges = ReadonlySet<BridgeKey>;

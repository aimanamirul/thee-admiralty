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

/** Standing operating procedure for unknown contacts in a sector (the ladder's automatic behaviour). */
export type Sop = 'OBSERVE' | 'CHALLENGE' | 'ASSERTIVE';

export interface SectorState {
  threat: number;
  roe: Roe;
  sop: Sop;
}

/** Hidden ground truth of a contact, revealed by hailing, boarding or visual identification. */
export type ContactIntent = 'MERCHANT' | 'FISHING' | 'SMUGGLER' | 'SHADOWER' | 'WARSHIP' | 'RAIDER';

/** Escalation ladder steps. SHADOW as a manual order means "hold: do not escalate". */
export type LadderAction = 'SHADOW' | 'HAIL' | 'WARN' | 'BOARD' | 'ENGAGE';

/** What the plot shows. The true intent is hidden until a task force identifies the track. */
export type ContactClass = 'UNKNOWN' | 'HOSTILE' | 'NEUTRAL';

export interface Contact {
  id: string;
  sectorId: number;
  position: Vec2;
  heading: number;
  cls: ContactClass;
  /** Hidden ground truth: intent === 'RAIDER'. */
  hostile: boolean;
  intent: ContactIntent;
  /** Ladder progress. */
  hailed?: boolean;
  /** Did not answer a hail. */
  suspicious?: boolean;
  warned?: boolean;
  fleeing?: boolean;
  boardAttempts?: number;
  /** Player override: the next step to take (or SHADOW = hold), replacing the sector SOP for this contact. */
  order?: LadderAction | null;
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

/** The navy's fiscal year: an annual appropriation paid in quarterly tranches. */
export interface FiscalState {
  /** 1-based fiscal year. */
  year: number;
  /** This year's appropriation (M). */
  appropriation: number;
  /** Quarterly tranches already paid this year (1-4). */
  tranchesPaid: number;
  /** Budget balance at the start of the year, before the first tranche (carryover or debt). */
  openingBalance: number;
  /** Next year's appropriation boost won in budget hearings this year (0-0.2). */
  hearingBoost: number;
  /** Set 30 days before year end: next year's appropriation, no longer moving. */
  lockedForecast: number | null;
  /** A parliamentary inquiry this year cuts next year's appropriation by 20%. */
  inquiryPenalty: boolean;
}

/** Civil-military politics: how willing the civilian government is to back the navy. */
export interface PoliticsState {
  /** Domestic support 0-100. */
  support: number;
  fiscal: FiscalState;
  /** Earliest tick for the next budget hearing. */
  hearingReadyTick: number;
  /** Procurement frozen by a parliamentary inquiry until this tick. */
  inquiryUntil: number | null;
  nextElectionTick: number;
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
  politics: PoliticsState;
  /** Running statistics for the ledger. */
  stats: { hostilesDestroyed: number; shipsLost: number; incidents: number; seizures: number };
}

export type Bridges = ReadonlySet<BridgeKey>;

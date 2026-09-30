/** Civilian shipping (docs/PLAN-shipping.md, phases T1-T3): lanes, identified merchant ships and the theatre's trade index. */
import type { VendorId } from './diplomacy';
import type { Vec2 } from './map';

export type ShipKind = 'TANKER' | 'CONTAINER' | 'BULK' | 'FERRY';

/** A flag state the player already knows about, or the neutral open registry. DOMESTIC_YARDS = the home flag. */
export type Flag = Extract<VendorId, 'DOMESTIC_YARDS' | 'NAVAL_GROUP_THALES' | 'RAYTHEON' | 'ASELSAN' | 'ZVEZDA_NORD' | 'NORDVIK' | 'SEORAK'> | 'OPEN_REGISTRY';

/** A flag, or every foreign flag (the home flag is never a target). */
export type FlagFilter = Flag | 'ALL';

/** What an exclusion order allows the navy to do to matching ships (never passenger ferries): search and release, search / seize
 *  contraband / turn back the rest, or strike on sight (only in sectors at WEAPONS FREE; elsewhere it falls back to turning back). */
export type InterdictionPolicy = 'INSPECT_ALL' | 'TURN_BACK' | 'UNRESTRICTED';
export const POLICY_LABEL: Record<InterdictionPolicy, string> = { INSPECT_ALL: 'SEARCH & RELEASE', TURN_BACK: 'SEARCH, SEIZE, TURN BACK', UNRESTRICTED: 'UNRESTRICTED' };

/** Button labels: distinct, short, and honest about what the policy does. */
export const POLICY_SHORT: Record<InterdictionPolicy, string> = { INSPECT_ALL: 'Search', TURN_BACK: 'Turn back', UNRESTRICTED: 'Strike' };

export interface ExclusionZone {
  id: string;
  flag: FlagFilter;
  sectors: number[];
  declaredTick: number;
  /** Notice ends: no force before this day. */
  effectiveTick: number;
  policy: InterdictionPolicy;
}

export interface Lane {
  id: string;
  /** e.g. "LANE 1: WESTERN APPROACHES - EASTERN REACH" */
  name: string;
  /** Polyline over water from one map-edge gate to the other. */
  path: Vec2[];
  length: number;
  /** Sectors the lane crosses, in order. */
  sectors: number[];
  /** Ships entering per day at full traffic. */
  base: number;
  /** War-risk 0-100: insurers' view of recent attacks and sector threat along the lane. */
  risk: number;
  /** Share of normal traffic still using the lane (0-1), from the war-risk premium. */
  traffic: number;
  /** Set while shipping avoids the lane (risk too high). */
  reroutedUntil: number | null;
}

export type MerchantStatus = 'UNDERWAY' | 'DISTRESS';

export interface Merchant {
  id: string;
  name: string;
  kind: ShipKind;
  flag: Flag;
  laneId: string;
  /** Distance travelled along the lane path, in tiles from the path's first point. */
  dist: number;
  dir: 1 | -1;
  position: Vec2;
  heading: number;
  /** Cargo value (M). */
  cargo: number;
  bornTick: number;
  status: MerchantStatus;
  /** Distress: help must arrive by this tick or the ship founders. */
  distressUntil: number | null;
  /** Task force assigned to escort this ship, or to inspect it (`TaskForce.escortMode`). */
  escort: string | null;
  /** Hidden truth: carries contraband. Never shown to the player. */
  contraband: boolean;
  /** Intelligence tip-off (mostly right, sometimes wrong): a search of a tipped ship is likelier to find something. */
  tip: boolean;
  /** Already searched: not searched again. */
  checked: boolean;
  /** Turned back by an exclusion order: heads for the gate it came from. */
  turnedBack: boolean;
  /** Boarding party at work: the ship is held until `doneTick`. `turnAfter`: send it back if the search finds nothing. */
  inspecting: { tfId: string; doneTick: number; turnAfter: boolean } | null;
}

export interface ShippingStats {
  transited: number;
  /** Lost to raiders (sunk, seized, foundered). */
  lost: number;
  rescued: number;
  escorted: number;
  /** Value of cargo lost to raiders (M). */
  cargoLost: number;
  inspections: number;
  /** Contraband seized. */
  seized: number;
  turnedBack: number;
  /** Turned-back ships that have left the plot. */
  returned: number;
  /** Ships struck by our own forces (unrestricted interdiction, ordered strikes). */
  struck: number;
  /** Civilian crew casualties from our own strikes. */
  toll: number;
  /** Value of cargo destroyed by our own strikes (M). */
  cargoLostByUs: number;
  /** Strikes outside a legal exclusion order (the gravest incident). */
  gravest: number;
}

/** Counters for the current fiscal year, reported at year end. */
export interface YearStats {
  counts: ShippingStats;
  indexSum: number;
  days: number;
  lossBySector: Record<number, number>;
}

export interface ShippingState {
  lanes: Lane[];
  ships: Merchant[];
  seq: number;
  /** Trade volume index: 100 = normal traffic on every lane. Only attacks and threat lower it. */
  index: number;
  stats: ShippingStats;
  /** Maritime exclusion orders (T5). */
  zones: ExclusionZone[];
  zoneSeq: number;
  year: YearStats;
  /** The last fiscal year's shipping report (ledger text with name tokens). */
  lastReport: string | null;
}

export const emptyStats = (): ShippingStats => ({
  transited: 0, lost: 0, rescued: 0, escorted: 0, cargoLost: 0, inspections: 0, seized: 0, turnedBack: 0, returned: 0, struck: 0, toll: 0, cargoLostByUs: 0, gravest: 0,
});

export const emptyShipping = (): ShippingState => ({
  lanes: [],
  ships: [],
  seq: 0,
  index: 100,
  stats: emptyStats(),
  zones: [],
  zoneSeq: 0,
  year: { counts: emptyStats(), indexSum: 0, days: 0, lossBySector: {} },
  lastReport: null,
});

/** Fill in fields a state saved by an older build lacks. */
export function normalizeShipping(s: Partial<ShippingState> | undefined): ShippingState {
  const d = emptyShipping();
  if (!s) return d;
  return {
    ...d,
    ...s,
    stats: { ...d.stats, ...s.stats },
    year: { ...d.year, ...s.year, counts: { ...d.year.counts, ...s.year?.counts } },
    zones: s.zones ?? [],
    ships: (s.ships ?? []).map((m) => ({ ...m, contraband: m.contraband ?? false, tip: m.tip ?? false, checked: m.checked ?? false, turnedBack: m.turnedBack ?? false, inspecting: m.inspecting ?? null })),
  };
}

export const KIND_LABEL: Record<ShipKind, string> = { TANKER: 'TANKER', CONTAINER: 'CONTAINER SHIP', BULK: 'BULK CARRIER', FERRY: 'FERRY' };
export const KIND_TAG: Record<ShipKind, string> = { TANKER: 'TKR', CONTAINER: 'CON', BULK: 'BLK', FERRY: 'FRY' };

/** Fraction of the appropriation a fully collapsed trade index costs. */
export const TRADE_BUDGET_SHARE = 0.15;
/** Daily domestic-support drain per trade-index point below 100. */
export const TRADE_SUPPORT_DRAIN = 0.002;

/** Multiplier on next year's appropriation forecast (1 at a normal trade index). */
export function tradeFactor(index: number): number {
  return 1 - TRADE_BUDGET_SHARE * (1 - Math.max(0, Math.min(100, index)) / 100);
}

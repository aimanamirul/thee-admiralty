/** Civilian shipping (docs/PLAN-shipping.md, phases T1-T3): lanes, identified merchant ships and the theatre's trade index. */
import type { VendorId } from './diplomacy';
import type { Vec2 } from './map';

export type ShipKind = 'TANKER' | 'CONTAINER' | 'BULK' | 'FERRY';

/** A flag state the player already knows about, or the neutral open registry. DOMESTIC_YARDS = the home flag. */
export type Flag = Extract<VendorId, 'DOMESTIC_YARDS' | 'NAVAL_GROUP_THALES' | 'RAYTHEON' | 'ASELSAN' | 'ZVEZDA_NORD' | 'NORDVIK' | 'SEORAK'> | 'OPEN_REGISTRY';

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
  /** Task force assigned to escort this ship. */
  escort: string | null;
}

export interface ShippingStats {
  transited: number;
  lost: number;
  rescued: number;
  escorted: number;
  /** Value of cargo lost (M). */
  cargoLost: number;
}

export interface ShippingState {
  lanes: Lane[];
  ships: Merchant[];
  seq: number;
  /** Trade volume index: 100 = normal traffic on every lane. Only attacks and threat lower it. */
  index: number;
  stats: ShippingStats;
}

export const emptyShipping = (): ShippingState => ({
  lanes: [],
  ships: [],
  seq: 0,
  index: 100,
  stats: { transited: 0, lost: 0, rescued: 0, escorted: 0, cargoLost: 0 },
});

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

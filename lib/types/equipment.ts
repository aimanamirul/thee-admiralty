/** Modules, sockets and protocol tags for the naval equipment designer. */
import type { VendorId } from './diplomacy';

export type Protocol = 'TACTICOS_ETHERNET' | 'NATO_LINK16' | 'EASTERN_ANALOG' | 'DOMESTIC_OPEN';

export const PROTOCOLS: Protocol[] = ['TACTICOS_ETHERNET', 'NATO_LINK16', 'EASTERN_ANALOG', 'DOMESTIC_OPEN'];

export type ModuleSlot = 'POWERPLANT' | 'CMS' | 'SENSOR' | 'ARMAMENT';

export const SLOT_ORDER: ModuleSlot[] = ['POWERPLANT', 'CMS', 'SENSOR', 'ARMAMENT'];

export type ArmamentRole = 'SAM' | 'SSM' | 'GUN' | 'ASW';

export interface PowerStats {
  kind: 'POWER';
}
export interface CmsStats {
  kind: 'CMS';
  /** Detect-to-fire reaction time in seconds at zero friction. */
  reactionSec: number;
  /** Simultaneous engagement channels. */
  channels: number;
  /** Multiplier on integration friction with foreign modules (open-architecture CMS < 1). */
  integration?: number;
}
export interface SensorStats {
  kind: 'SENSOR';
  rangeKm: number;
  tracks: number;
}
export interface ArmamentStats {
  kind: 'ARMAMENT';
  role: ArmamentRole;
  /** VLS cells / canisters / barrels. */
  rounds: number;
  /** Hull-damage (or intercept value) per round. */
  damage: number;
  rangeKm: number;
}
export type ModuleStats = PowerStats | CmsStats | SensorStats | ArmamentStats;

export interface EquipmentModule {
  id: string;
  name: string;
  slot: ModuleSlot;
  vendorId: VendorId;
  protocol: Protocol;
  /** Continuous electrical demand in MW. */
  powerDrawMW: number;
  /** Electrical output in MW (power plants only). */
  powerGenerationMW: number;
  weightT: number;
  /** Budget cost (millions). */
  cost: number;
  /** Vendor standing tier (0-3) required to procure. */
  requiredTier: 0 | 1 | 2 | 3;
  /** Base reliability 0-1; feeds failure rates. */
  reliability: number;
  /** R&D project that must be complete before this module exists in the catalogue. */
  unlockedBy?: string;
  stats: ModuleStats;
  blurb: string;
}

/** A module instance installed on a hull. */
export interface InstalledModule {
  moduleId: string;
  slot: ModuleSlot;
  /** 0-1 wear condition. */
  condition: number;
  failed: boolean;
}

/** Unordered protocol pair key, e.g. "NATO_LINK16|TACTICOS_ETHERNET". */
export type BridgeKey = string;

export function bridgeKey(a: Protocol, b: Protocol): BridgeKey {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

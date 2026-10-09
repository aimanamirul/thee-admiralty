/** Hull bases and ship designs. */
import type { ModuleSlot, Protocol, BridgeKey } from './equipment';
import type { VendorId } from './diplomacy';

export type Draft = 'Shallow' | 'Medium' | 'Deep';
export type HullClassId = 'FAC' | 'CORVETTE' | 'FRIGATE' | 'DESTROYER' | 'CARRIER' | 'SUB_SEORAK' | 'SUB_KB' | 'SUB_DAHAI';
export type HullPlatform = 'SURFACE' | 'SUBSURFACE';

export interface HullBase {
  id: HullClassId;
  name: string;
  pennantPrefix: string;
  displacementT: number;
  /** Design draft in metres at base displacement. */
  draftM: number;
  structuralHP: number;
  /** Hull-mounted auxiliary generation (MW), on top of the propulsion plant. */
  baseGenerationMW: number;
  /** Hotel load (MW) — always drawn. */
  hotelLoadMW: number;
  /** Maximum module payload (tonnes). */
  payloadT: number;
  sockets: Record<ModuleSlot, number>;
  cost: number;
  buildDays: number;
  upkeepPerDay: number;
  /** Extra strike weight of an embarked air group. */
  strikeRating: number;
  /** Absent = SURFACE. */
  platform?: HullPlatform;
  /** Builder of the hull; its price is paid to this vendor and a sanction on it stalls construction. Absent = the domestic yards. */
  vendorId?: VendorId;
  /** Hidden sub-suppliers of the hull itself (same rules as module `origins`). */
  origins?: VendorId[];
  /** Vendor standing tier (0-3) needed to buy the hull. Absent = 0. */
  requiredTier?: 0 | 1 | 2 | 3;
  /** Submarines: base acoustic stealth (0-100) and days submerged before snorkelling, before plant modifiers. */
  stealth?: number;
  enduranceDays?: number;
}

export interface ShipDesign {
  id: string;
  name: string;
  hullId: HullClassId;
  moduleIds: string[];
}

export interface IntegrationFriction {
  moduleId: string;
  moduleName: string;
  moduleProtocol: Protocol;
  cmsProtocol: Protocol;
  severity: number;
  bridged: boolean;
  bridgeKey: BridgeKey;
}

export interface DesignEvaluation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  powerGenerationMW: number;
  powerDrawMW: number;
  powerMarginMW: number;
  displacementT: number;
  payloadUsedT: number;
  payloadT: number;
  draftM: number;
  draft: Draft;
  structuralHP: number;
  cost: number;
  frictions: IntegrationFriction[];
  /** Sum of *unbridged* friction severity. */
  frictionIndex: number;
  reactionMultiplier: number;
  trackingLagSec: number;
  reactionSec: number;
  detectionKm: number;
  trackCapacity: number;
  channels: number;
  firepower: number;
  interceptors: number;
  combatRating: number;
  upkeepPerDay: number;
  vendors: string[];
  /** Submarines only (0 on surface hulls): acoustic stealth 0-100 and days submerged before the boat must snorkel. */
  stealth: number;
  submergedDays: number;
  /** Best sonar detection range in km (0 = no sonar). Never counted as radar detection. */
  sonarKm: number;
  platform: HullPlatform;
}

/** Hull bases and ship designs. */
import type { ModuleSlot, Protocol, BridgeKey } from './equipment';

export type Draft = 'Shallow' | 'Medium' | 'Deep';
export type HullClassId = 'FAC' | 'CORVETTE' | 'FRIGATE' | 'DESTROYER' | 'CARRIER';

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
}

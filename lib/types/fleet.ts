/** Fleet hierarchy: Fleet -> Task Force -> Squadron -> Ship hull. */
import type { HullClassId } from './hull';
import type { InstalledModule } from './equipment';
import type { VendorId } from './diplomacy';
import type { Vec2 } from './map';

/** The naval "Rule of Thirds" cycle. */
export type OpState = 'ACTIVE_PATROL' | 'TRANSIT_WORKUP' | 'MAINTENANCE_DOCK';

export type NamingTradition = 'VIRTUES' | 'GEOGRAPHIC' | 'CELESTIAL';

export type BuildStatus = 'CONSTRUCTING' | 'COMMISSIONED';

export interface Ship {
  id: string;
  name: string;
  pennant: string;
  hullId: HullClassId;
  designName: string;
  state: OpState;
  /** Days spent in the current state. */
  stateDays: number;
  /** Consecutive days on patrol beyond the nominal rotation limit. */
  overdeployDays: number;
  readiness: number;
  integrity: number;
  /** 0-100 experience. */
  veterancy: number;
  modules: InstalledModule[];
  buildStatus: BuildStatus;
  buildProgressDays: number;
  buildTotalDays: number;
  /** Vendor whose sanction is stalling construction. */
  frozenBy: VendorId | null;
  isPartsHulk: boolean;
  /** Player override: keep on station regardless of rotation. */
  holdStation: boolean;
  commissionedTick: number | null;
}

export interface Squadron {
  id: string;
  name: string;
  shipIds: string[];
}

export type Tempo = 'ROTATE_THIRDS' | 'SURGE';

export interface TaskForce {
  id: string;
  name: string;
  squadrons: Squadron[];
  /** Sector this task force is stationed in. null = in port. */
  assignedSectorId: number | null;
  position: Vec2;
  heading: number;
  speedTilesPerDay: number;
  route: Vec2[];
  /** Where the task force is trying to be (sector anchor or home port). */
  destination: Vec2 | null;
  tempo: Tempo;
}

export interface Fleet {
  id: string;
  name: string;
  taskForces: TaskForce[];
}

export type HierarchyKind = 'FLEET' | 'TASKFORCE' | 'SQUADRON' | 'SHIP';

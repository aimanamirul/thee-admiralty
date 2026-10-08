/**
 * Fleet simulation: the "Rule of Thirds" (Patrol / Transit-Workup / Maintenance) state machine,
 * readiness decay, over-deployment breakdowns, spares and hull cannibalisation, task-force movement.
 */
import { HULLS, MODULE_BY_ID } from '../data/catalog';
import { mt } from '../data/tokens';
import type { Rng } from '../generator/prng';
import type { InstalledModule } from '../types/equipment';
import type { Fleet, OpState, Ship, TaskForce } from '../types/fleet';
import type { HullClassId } from '../types/hull';
import type { Vec2 } from '../types/map';
import type { Bridges, WorldDraft } from '../types/world';
import type { Combatant } from './combatSim';
import { moduleOrdersBlocked, moduleSpareUseBlocked } from './diplomacyEngine';
import { evaluateLoadout } from './designEngine';
import { findRoute, snapToWater } from './navigation';
import { boatDay, dockDays, isBoat, patrolLimit } from './submarines';

export const PATROL_LIMIT_DAYS = 30;
export const WORKUP_DAYS = 14;
export const MIN_DOCK_DAYS = 8;
export const STATION_RADIUS = 3;
export const DEEP_DRAFT_M = 6.8;

const clamp = (v: number, lo = 0, hi = 100) => (v < lo ? lo : v > hi ? hi : v);
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

export const OP_STATE_LABEL: Record<OpState, string> = {
  ACTIVE_PATROL: 'ACTIVE PATROL',
  TRANSIT_WORKUP: 'TRANSIT / WORKUP',
  MAINTENANCE_DOCK: 'MAINTENANCE DOCK',
};

// -------------------------------------------------------------------------- hierarchy helpers

export function allTaskForces(fleets: Fleet[]): TaskForce[] {
  return fleets.flatMap((f) => f.taskForces);
}

export function taskForceShipIds(tf: TaskForce): string[] {
  return tf.squadrons.flatMap((s) => s.shipIds);
}

export function findTaskForceOfShip(fleets: Fleet[], shipId: string): TaskForce | undefined {
  return allTaskForces(fleets).find((tf) => tf.squadrons.some((s) => s.shipIds.includes(shipId)));
}

export function removeShip(world: WorldDraft, shipId: string): void {
  delete world.ships[shipId];
  for (const tf of allTaskForces(world.fleets)) for (const sq of tf.squadrons) sq.shipIds = sq.shipIds.filter((id) => id !== shipId);
}

export function nextShipId(world: WorldDraft): string {
  let max = 0;
  for (const id of Object.keys(world.ships)) max = Math.max(max, Number(id.replace('SHP-', '')) || 0);
  return `SHP-${max + 1}`;
}

export function createShip(args: {
  id: string;
  name: string;
  pennant: string;
  hullId: HullClassId;
  designName: string;
  moduleIds: string[];
  constructing: boolean;
  state?: OpState;
  stateDays?: number;
  readiness?: number;
  veterancy?: number;
  tick: number;
}): Ship {
  const hull = HULLS[args.hullId];
  const modules: InstalledModule[] = args.moduleIds
    .map((id) => MODULE_BY_ID[id])
    .filter(Boolean)
    .map((m) => ({ moduleId: m.id, slot: m.slot, condition: 1, failed: false }));
  return {
    id: args.id,
    name: args.name,
    pennant: args.pennant,
    hullId: args.hullId,
    designName: args.designName,
    state: args.state ?? 'TRANSIT_WORKUP',
    stateDays: args.stateDays ?? 0,
    overdeployDays: 0,
    readiness: args.constructing ? 0 : args.readiness ?? 60,
    integrity: 100,
    veterancy: args.veterancy ?? 0,
    modules,
    buildStatus: args.constructing ? 'CONSTRUCTING' : 'COMMISSIONED',
    buildProgressDays: args.constructing ? 0 : hull.buildDays,
    buildTotalDays: hull.buildDays,
    frozenBy: null,
    isPartsHulk: false,
    holdStation: false,
    commissionedTick: args.constructing ? null : args.tick,
  };
}

/** Combat figures for a ship counting only its working modules. */
export function combatantOf(ship: Ship, bridges: Bridges): Combatant {
  const working = ship.modules.filter((m) => !m.failed).map((m) => m.moduleId);
  return {
    id: ship.id,
    label: `${ship.pennant} ${ship.name.toUpperCase()}`,
    eval: evaluateLoadout(ship.hullId, working, bridges),
    readiness: ship.readiness,
    veterancy: ship.veterancy,
    integrity: ship.integrity,
    structuralHP: HULLS[ship.hullId].structuralHP,
  };
}

// ------------------------------------------------------------------------------- spares & hulks

/** Consume a spare for `moduleId` from stock or, failing that, by cannibalising a parts hulk. */
export function takeSpare(world: WorldDraft, moduleId: string): 'STOCK' | 'HULK' | null {
  const stockUsable = !moduleSpareUseBlocked(world, moduleId);
  if (stockUsable && (world.spares[moduleId] ?? 0) > 0) {
    world.spares[moduleId]--;
    return 'STOCK';
  }
  for (const hulk of Object.values(world.ships)) {
    if (!hulk.isPartsHulk) continue;
    const idx = hulk.modules.findIndex((m) => m.moduleId === moduleId && !m.failed);
    if (idx >= 0) {
      hulk.modules.splice(idx, 1);
      world.events.push({ severity: 'ADVISORY', text: `CANNIBALISED ${mt(moduleId)} from hulk ${hulk.pennant} ${hulk.name.toUpperCase()}` });
      return 'HULK';
    }
  }
  // Standing order: rush-buy from the vendor at a premium (blocked while the vendor is sanctioned).
  const mod = MODULE_BY_ID[moduleId];
  if (world.policy.autoSpares && mod && !moduleOrdersBlocked(world, mod) && !(mod.unlockedBy && !world.research.completed.includes(mod.unlockedBy))) {
    const cost = mod.cost * 0.6;
    if (world.resources.budget >= cost) {
      world.resources.budget -= cost;
      world.events.push({ severity: 'INFO', text: `RUSH ORDER: ${mt(mod.id)} (${cost.toFixed(1)} M)` });
      return 'STOCK';
    }
  }
  return null;
}

export function designateHulk(world: WorldDraft, shipId: string): { ok: boolean; reason?: string } {
  const ship = world.ships[shipId];
  if (!ship) return { ok: false, reason: 'NO SUCH SHIP' };
  if (ship.buildStatus !== 'COMMISSIONED') return { ok: false, reason: 'STILL UNDER CONSTRUCTION' };
  if (ship.isPartsHulk) return { ok: false, reason: 'ALREADY A PARTS HULK' };
  if (ship.state !== 'MAINTENANCE_DOCK') return { ok: false, reason: 'ONLY A DOCKED SHIP CAN BE DESIGNATED' };
  ship.isPartsHulk = true;
  ship.holdStation = false;
  world.events.push({ severity: 'ADVISORY', text: `${ship.pennant} ${ship.name.toUpperCase()} designated PARTS HULK — modules now available for cannibalisation` });
  return { ok: true };
}

/** Move all working modules of a hulk to the spares pool and scrap the hull. */
export function stripHulk(world: WorldDraft, shipId: string): { ok: boolean; reason?: string } {
  const ship = world.ships[shipId];
  if (!ship?.isPartsHulk) return { ok: false, reason: 'NOT A PARTS HULK' };
  let n = 0;
  for (const m of ship.modules) {
    if (m.failed) continue;
    world.spares[m.moduleId] = (world.spares[m.moduleId] ?? 0) + 1;
    n++;
  }
  world.events.push({ severity: 'INFO', text: `${ship.pennant} ${ship.name.toUpperCase()} stripped: ${n} modules to spares, hull scrapped` });
  removeShip(world, shipId);
  return { ok: true };
}

export function unHulk(world: WorldDraft, shipId: string): void {
  const ship = world.ships[shipId];
  if (ship?.isPartsHulk) ship.isPartsHulk = false;
}

// -------------------------------------------------------------------------------- daily update

function setState(ship: Ship, state: OpState) {
  ship.state = state;
  ship.stateDays = 0;
  if (state === 'MAINTENANCE_DOCK' || state === 'ACTIVE_PATROL') ship.overdeployDays = 0;
}

/** A damaged ship breaks off and heads for the yard: it joins the dock cycle (readiness and integrity recover there). */
export function sendToRepair(world: WorldDraft, ship: Ship, why: string): void {
  if (ship.state === 'MAINTENANCE_DOCK') return;
  setState(ship, 'MAINTENANCE_DOCK');
  world.events.push({ severity: 'WARNING', text: `${ship.pennant} ${ship.name.toUpperCase()}: ${why} — integrity ${ship.integrity.toFixed(0)}%, breaks off and returns to dock for repair` });
}

const isCriticalFailure = (s: Ship) => s.modules.some((m) => m.failed && (m.slot === 'POWERPLANT' || m.slot === 'CMS'));

export function advanceFleets(world: WorldDraft, rng: Rng): void {
  const map = world.map;
  const tfs = allTaskForces(world.fleets);
  const atStation = new Map<string, boolean>();

  // ---- task-force movement
  for (const tf of tfs) {
    const ships = taskForceShipIds(tf).map((id) => world.ships[id]).filter((s) => s && s.buildStatus === 'COMMISSIONED' && !s.isPartsHulk);
    const sector = tf.assignedSectorId !== null ? map.sectors[tf.assignedSectorId] : undefined;
    const wantsStation = !!sector && ships.some((s) => s.state !== 'MAINTENANCE_DOCK');
    // Escort duty (shipping): follow the ship, or answer its distress call; overrides the station while it lasts.
    const escortee = tf.escort ? world.shipping.ships.find((m) => m.id === tf.escort) : undefined;
    const atSea = ships.some((s) => s.state !== 'MAINTENANCE_DOCK');
    if (tf.escort && (!escortee || !atSea)) {
      if (escortee && escortee.escort === tf.id) escortee.escort = null;
      tf.escort = null;
    }
    const goal = tf.escort && escortee ? snapToWater(map, escortee.position) : wantsStation && sector ? sector.anchor : map.homePort;
    if (!tf.destination || dist(tf.destination, goal) > 0.5) {
      tf.destination = { ...goal };
      tf.route = [];
    }
    if (tf.route.length === 0 && dist(tf.position, tf.destination) > 1.2) {
      const deep = ships.some((s) => HULLS[s.hullId].draftM >= DEEP_DRAFT_M);
      tf.route = findRoute(map, tf.position, tf.destination, deep);
    }
    let budget = tf.speedTilesPerDay;
    while (tf.route.length && budget > 0) {
      const wp = tf.route[0];
      const d = dist(tf.position, wp);
      tf.heading = Math.atan2(wp.y - tf.position.y, wp.x - tf.position.x);
      if (d <= budget) {
        tf.position = { x: wp.x, y: wp.y };
        budget -= d;
        tf.route.shift();
      } else {
        tf.position = { x: tf.position.x + ((wp.x - tf.position.x) / d) * budget, y: tf.position.y + ((wp.y - tf.position.y) / d) * budget };
        budget = 0;
      }
    }
    atStation.set(tf.id, !!sector && dist(tf.position, sector.anchor) <= STATION_RADIUS);
  }

  // ---- per-ship Rule of Thirds
  for (const tf of tfs) {
    const onStation = atStation.get(tf.id) ?? false;
    const sector = tf.assignedSectorId !== null ? map.sectors[tf.assignedSectorId] : undefined;
    for (const id of taskForceShipIds(tf)) {
      const ship = world.ships[id];
      if (!ship || ship.buildStatus !== 'COMMISSIONED') continue;
      if (ship.isPartsHulk) continue;
      ship.stateDays++;
      const label = `${ship.pennant} ${ship.name.toUpperCase()}`;

      if (ship.state === 'ACTIVE_PATROL') {
        const boat = isBoat(ship);
        if (ship.stateDays > patrolLimit(ship)) ship.overdeployDays++;
        if (boat && onStation) boatDay(world, ship, sector);
        const over = ship.overdeployDays;
        const stress = 1 + over / 20;
        if (!onStation) {
          ship.readiness -= 0.25;
        } else {
          ship.readiness -= 0.9 * stress;
          ship.integrity -= 0.1 * stress;
          ship.veterancy = clamp(ship.veterancy + 0.3 * (1 - ship.veterancy / 140));
          // Grounding hazard: deep-draft hulls in littoral waters.
          const draftM = HULLS[ship.hullId].draftM;
          const draftMult = draftM >= DEEP_DRAFT_M ? 2.5 : draftM >= 4.2 ? 0.8 : 0.1;
          const groundP = 0.004 * (sector?.littoralFraction ?? 0) * draftMult * stress;
          if (!world.scripted && !boat && rng.chance(groundP)) {
            const dmg = rng.range(4, 14);
            ship.integrity -= dmg;
            world.events.push({ severity: 'WARNING', text: `${label}: GROUNDING on shoal in ${sector?.label ?? 'sector'} — hull −${dmg.toFixed(0)}%` });
          }
          if (draftM < 4.2 && (sector?.littoralFraction ?? 0) > 0.2) ship.veterancy = clamp(ship.veterancy + 0.08);
          // Wear & random module failures — the over-deployment penalty.
          for (const m of ship.modules) {
            if (m.failed) continue;
            const rel = MODULE_BY_ID[m.moduleId]?.reliability ?? 0.9;
            m.condition = clamp(m.condition - 0.004 * stress, 0, 1);
            const p = (1 - rel) * 0.015 * (1 + (over / 10) ** 1.5) * (1 + (100 - ship.integrity) / 100) * (1.6 - m.condition);
            if (!world.scripted && rng.chance(p)) {
              m.failed = true;
              const hit = m.slot === 'POWERPLANT' ? 15 : m.slot === 'CMS' ? 12 : 6;
              ship.readiness -= hit;
              world.events.push({
                severity: over > 5 ? 'CRITICAL' : 'WARNING',
                text: `${label}: ${mt(m.moduleId)} FAILED${over > 5 ? ` (OVERDEPLOYED ${over}d)` : ''}`,
              });
            }
          }
        }
        ship.readiness = clamp(ship.readiness);
        ship.integrity = clamp(ship.integrity);

        const forced = ship.readiness < 12 || ship.integrity < 25;
        const rotate =
          tf.tempo === 'ROTATE_THIRDS' && !ship.holdStation &&
          (ship.stateDays >= patrolLimit(ship) || ship.readiness < 35 || isCriticalFailure(ship));
        if (forced || rotate) {
          setState(ship, 'MAINTENANCE_DOCK');
          world.events.push({ severity: 'INFO', text: `${label}: rotating to MAINTENANCE DOCK (readiness ${ship.readiness.toFixed(0)}%)` });
        }
      } else if (ship.state === 'TRANSIT_WORKUP') {
        ship.readiness = clamp(ship.readiness + (ship.readiness < 60 ? 1.6 : -0.3));
        ship.veterancy = clamp(ship.veterancy + 0.04);
        if (isCriticalFailure(ship)) {
          setState(ship, 'MAINTENANCE_DOCK');
        } else if (tf.assignedSectorId !== null && ship.stateDays >= WORKUP_DAYS && ship.readiness >= 55) {
          setState(ship, 'ACTIVE_PATROL');
          world.events.push({ severity: 'INFO', text: `${label}: workup complete — proceeding on PATROL, ${sector?.label ?? ''}` });
        }
      } else {
        // MAINTENANCE_DOCK
        ship.readiness = clamp(ship.readiness + 2.4);
        ship.integrity = clamp(ship.integrity + 1.8);
        for (const m of ship.modules) if (!m.failed) m.condition = clamp(m.condition + 0.04, 0, 1);
        if ((ship.refitDaysLeft ?? 0) > 0) {
          ship.refitDaysLeft = (ship.refitDaysLeft ?? 0) - 1;
          if (ship.refitDaysLeft === 0) world.events.push({ severity: 'INFO', text: `${label}: refit complete — back to workup when readiness allows` });
          continue;
        }
        const failed = ship.modules.find((m) => m.failed);
        if (failed) {
          const src = takeSpare(world, failed.moduleId);
          if (src) {
            failed.failed = false;
            failed.condition = 1;
            world.events.push({ severity: 'INFO', text: `${label}: ${mt(failed.moduleId)} repaired from ${src === 'STOCK' ? 'spares' : 'hulk'}` });
          } else if (ship.stateDays % 10 === 0) {
            world.events.push({ severity: 'WARNING', text: `${label}: DOCK STALLED — no spare ${mt(failed.moduleId)} (buy spares or designate a parts hulk)` });
          }
        } else if (ship.readiness >= 90 && ship.integrity >= 90 && ship.stateDays >= dockDays(ship, MIN_DOCK_DAYS)) {
          setState(ship, 'TRANSIT_WORKUP');
        }
      }
    }
  }
}

/** Fraction of commissioned, non-hulk ships in each state (for the Rule-of-Thirds gauge). */
export function stateCounts(ships: Ship[]): Record<OpState, number> {
  const out: Record<OpState, number> = { ACTIVE_PATROL: 0, TRANSIT_WORKUP: 0, MAINTENANCE_DOCK: 0 };
  for (const s of ships) if (s.buildStatus === 'COMMISSIONED' && !s.isPartsHulk) out[s.state]++;
  return out;
}

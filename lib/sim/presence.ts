/**
 * Naval presence: how much a force on station deters. A FAC pair is a nuisance to a raider; a frigate group is a wall; a carrier group
 * owns the sector. Presence feeds sector threat reduction, raider spawns and behaviour, and how reliably shipping is covered.
 *
 * - Ship power is in frigate-equivalents (1.0 = a healthy Argus-class frigate): structure, air defence, firepower and air group, scaled by
 *   readiness and integrity. A FAC is ~0.4, a corvette ~0.6, a carrier ~5.
 * - Presence has diminishing returns: 1 frigate-equivalent = 1.0, two = 1.6, four = 2.2, capped at 2.5.
 */
import { HULLS } from '../data/catalog';
import type { Ship, TaskForce } from '../types/fleet';
import type { Vec2 } from '../types/map';
import type { WorldDraft } from '../types/world';
import { evaluateLoadout } from './designEngine';
import { allTaskForces, taskForceShipIds } from './fleetEngine';

/** Structure + air defence + firepower + air group of one healthy frigate. */
export const REF_POWER = 430;
export const PRESENCE_CAP = 2.5;
const K = -Math.log(1 - 1 / PRESENCE_CAP);
/** Sector threat falls by this much per day per point of presence (one frigate on patrol = 0.5/day, as before). */
export const DETERRENCE_PER_DAY = 0.5;
/** A raid of strength s is deterred (turns away) by a force whose presence × this exceeds s. */
export const DETER_STRENGTH_PER_PRESENCE = 30;
/** Share of would-be raiders that never spawn, per point of presence (capped). */
export const SPAWN_DETERRENCE = 0.25;
export const SPAWN_DETERRENCE_CAP = 0.6;

const NO_BRIDGES: ReadonlySet<never> = new Set();

/** Frigate-equivalents of one ship (0 if it cannot fight). */
export function shipPower(ship: Ship): number {
  const working = ship.modules.filter((m) => !m.failed).map((m) => m.moduleId);
  const hull = HULLS[ship.hullId];
  const ev = evaluateLoadout(ship.hullId, working, NO_BRIDGES);
  const raw = hull.structuralHP * 0.5 + ev.interceptors * 12 + ev.firepower * 0.12 + hull.strikeRating * 3;
  const condition = (0.5 + 0.5 * ship.readiness / 100) * (0.4 + 0.6 * ship.integrity / 100);
  return (raw / REF_POWER) * condition;
}

/** Diminishing returns: frigate-equivalents -> presence (1 -> 1.0, 2 -> 1.6, 4 -> 2.2, cap 2.5). */
export const presenceFrom = (power: number) => (power <= 0 ? 0 : PRESENCE_CAP * (1 - Math.exp(-K * power)));

type View = Pick<WorldDraft, 'fleets' | 'ships'>;

function shipsOf(w: View, tf: TaskForce, activeOnly: boolean): Ship[] {
  return taskForceShipIds(tf)
    .map((id) => w.ships[id])
    .filter((s): s is Ship => !!s && s.buildStatus === 'COMMISSIONED' && !s.isPartsHulk && (activeOnly ? s.state === 'ACTIVE_PATROL' : s.state !== 'MAINTENANCE_DOCK'));
}

/** Power of a task force's ships: those on active patrol, or all ships at sea. */
export function taskForcePower(w: View, tf: TaskForce, activeOnly: boolean): number {
  return shipsOf(w, tf, activeOnly).reduce((a, s) => a + shipPower(s), 0);
}

export const taskForcePresence = (w: View, tf: TaskForce, activeOnly = true) => presenceFrom(taskForcePower(w, tf, activeOnly));

/** Task forces holding a sector: assigned, not on escort duty, on station within 3 tiles of the anchor. */
export function holdersOf(w: View & Pick<WorldDraft, 'map'>, sectorId: number): TaskForce[] {
  const sec = w.map.sectors[sectorId];
  if (!sec) return [];
  return allTaskForces(w.fleets).filter((tf) => tf.assignedSectorId === sectorId && !tf.escort && Math.hypot(tf.position.x - sec.anchor.x, tf.position.y - sec.anchor.y) <= 3);
}

/** Presence of the forces holding a sector, counting ships on active patrol. */
export function sectorPresence(w: View & Pick<WorldDraft, 'map'>, sectorId: number): { presence: number; power: number } {
  const power = holdersOf(w, sectorId).reduce((a, tf) => a + taskForcePower(w, tf, true), 0);
  return { presence: presenceFrom(power), power };
}

/** Presence of every task force with a ship at sea within `radius` of a point (for shipping cover). */
export function presenceNear(w: View, p: Vec2, radius: number): number {
  let power = 0;
  for (const tf of allTaskForces(w.fleets)) {
    if (Math.hypot(tf.position.x - p.x, tf.position.y - p.y) <= radius) power += taskForcePower(w, tf, false);
  }
  return presenceFrom(power);
}

/** Plain words for a presence value. */
export const presenceLabel = (p: number) => (p <= 0 ? 'none' : p < 0.5 ? 'token' : p < 0.9 ? 'light' : p < 1.4 ? 'solid' : p < 2 ? 'strong' : 'dominant');

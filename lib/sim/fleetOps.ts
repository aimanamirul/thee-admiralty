/**
 * Refit of commissioned ships and bulk fleet operations. A refit swaps one module of a docked ship for another of the same socket:
 * the yard takes REFIT_DAYS, the new module is paid for (less a salvage credit for the old one), and the ship may not leave the dock
 * until the work is done. Bulk operations apply the single-ship command to many and report what happened to each.
 */
import { HULLS, MODULE_BY_ID } from '../data/catalog';
import { mt } from '../data/tokens';
import type { Tempo } from '../types/fleet';
import type { ModuleSlot } from '../types/equipment';
import type { WorldDraft } from '../types/world';
import { assignTaskForce, createSquadron, createTaskForce, moveShip, setTempo, type CommandResult } from './commands';
import { evaluateLoadout, procurability } from './designEngine';
import { moduleOrdersBlocked } from './diplomacyEngine';
import { allTaskForces, findTaskForceOfShip, taskForceShipIds } from './fleetEngine';
import { bridgeSet } from './researchEngine';
import { setStance, type Stance } from './submarines';

export const REFIT_DAYS = 12;
export const REFIT_YARD_FEE = 8;
const NEW_RATE = 0.8;
const SALVAGE_RATE = 0.25;

const fail = (reason: string): CommandResult => ({ ok: false, reason });
const done = (message: string): CommandResult => ({ ok: true, message });

/** Cost of fitting `newId` in place of `oldId` (millions). */
export const refitCost = (oldId: string, newId: string) => Math.max(REFIT_YARD_FEE, MODULE_BY_ID[newId].cost * NEW_RATE - MODULE_BY_ID[oldId].cost * SALVAGE_RATE + REFIT_YARD_FEE);

/** Why this refit cannot be ordered, or null. */
export function refitBlocked(world: WorldDraft, shipId: string, index: number, newId: string): string | null {
  const ship = world.ships[shipId];
  if (!ship || ship.buildStatus !== 'COMMISSIONED' || ship.isPartsHulk) return 'ONLY A COMMISSIONED SHIP CAN BE REFITTED';
  if (ship.state !== 'MAINTENANCE_DOCK') return 'THE SHIP MUST BE IN DOCK';
  if ((ship.refitDaysLeft ?? 0) > 0) return `ALREADY IN THE YARD (${ship.refitDaysLeft} DAYS LEFT)`;
  const old = ship.modules[index];
  const next = MODULE_BY_ID[newId];
  if (!old || !next || old.slot !== next.slot) return 'INCOMPATIBLE SOCKET';
  if (old.moduleId === newId) return 'ALREADY FITTED';
  const p = procurability(next, world.vendors, new Set(world.research.completed));
  if (!p.ok) return `${mt(next.id)}: ${p.reason}`;
  const blocker = moduleOrdersBlocked(world, next);
  if (blocker) return `${mt(next.id)}: SUPPLY BLOCKED BY SANCTION`;
  const trial = ship.modules.map((m, i) => (i === index ? newId : m.moduleId));
  const ev = evaluateLoadout(ship.hullId, trial, bridgeSet(world.research.completed));
  if (!ev.valid) return ev.errors[0];
  if (world.resources.budget < refitCost(old.moduleId, newId)) return `INSUFFICIENT BUDGET: ${refitCost(old.moduleId, newId).toFixed(0)} M`;
  return null;
}

export function refitShip(world: WorldDraft, shipId: string, index: number, newId: string): CommandResult {
  const why = refitBlocked(world, shipId, index, newId);
  if (why) return fail(why);
  const ship = world.ships[shipId];
  const old = ship.modules[index];
  const cost = refitCost(old.moduleId, newId);
  world.resources.budget -= cost;
  ship.modules[index] = { moduleId: newId, slot: old.slot, condition: 1, failed: false };
  ship.refitDaysLeft = REFIT_DAYS;
  world.events.push({ severity: 'INFO', text: `${ship.pennant} ${ship.name.toUpperCase()}: refit ${mt(old.moduleId)} → ${mt(newId)} (${cost.toFixed(0)} M, ${REFIT_DAYS} days in the yard)` });
  return done(`Refit ordered: ${cost.toFixed(0)} M, ${REFIT_DAYS} days`);
}

/** Docked ships carrying `fromId` in a socket of `slot` (the candidates of a bulk refit). */
export function refitCandidates(world: WorldDraft, shipIds: string[], slot: ModuleSlot, fromId: string): { shipId: string; index: number }[] {
  const out: { shipId: string; index: number }[] = [];
  for (const id of shipIds) {
    const s = world.ships[id];
    if (!s) continue;
    const index = s.modules.findIndex((m) => m.slot === slot && m.moduleId === fromId);
    if (index >= 0) out.push({ shipId: id, index });
  }
  return out;
}

/** Refit every selected ship that carries `fromId`; ships that cannot be refitted are skipped and counted. Stops when the budget runs out. */
export function refitMany(world: WorldDraft, shipIds: string[], slot: ModuleSlot, fromId: string, toId: string): CommandResult {
  const cands = refitCandidates(world, shipIds, slot, fromId);
  if (cands.length === 0) return fail('NO SELECTED SHIP CARRIES THAT MODULE');
  let ok = 0;
  let spent = 0;
  const reasons = new Set<string>();
  for (const c of cands) {
    const cost = refitCost(fromId, toId);
    const why = refitBlocked(world, c.shipId, c.index, toId);
    if (why) {
      reasons.add(why);
      continue;
    }
    refitShip(world, c.shipId, c.index, toId);
    ok++;
    spent += cost;
  }
  if (ok === 0) return fail([...reasons][0] ?? 'NO REFIT POSSIBLE');
  const skipped = cands.length - ok;
  return done(`${ok} refit${ok === 1 ? '' : 's'} ordered (${spent.toFixed(0)} M)${skipped ? `; ${skipped} skipped: ${[...reasons][0]}` : ''}`);
}

// ------------------------------------------------------------------------------------------ bulk fleet operations

export function moveShips(world: WorldDraft, shipIds: string[], squadronId: string): CommandResult {
  if (shipIds.length === 0) return fail('NO SHIPS SELECTED');
  let n = 0;
  for (const id of shipIds) if (moveShip(world, id, squadronId).ok) n++;
  return n ? done(`${n} ship${n === 1 ? '' : 's'} transferred`) : fail('INVALID TRANSFER');
}

export function assignTaskForces(world: WorldDraft, tfIds: string[], sectorId: number | null): CommandResult {
  if (tfIds.length === 0) return fail('NO TASK FORCES SELECTED');
  let n = 0;
  for (const id of tfIds) if (assignTaskForce(world, id, sectorId).ok) n++;
  return n ? done(`${n} task force${n === 1 ? '' : 's'} ordered`) : fail('NO SUCH TASK FORCE');
}

export function setTempoMany(world: WorldDraft, tfIds: string[], tempo: Tempo): CommandResult {
  if (tfIds.length === 0) return fail('NO TASK FORCES SELECTED');
  let n = 0;
  for (const id of tfIds) if (setTempo(world, id, tempo).ok) n++;
  return n ? done(`${n} task force${n === 1 ? '' : 's'} on ${tempo}`) : fail('NO SUCH TASK FORCE');
}

/** Why a split cannot be made, or null. */
export function splitBlocked(world: WorldDraft, shipIds: string[]): string | null {
  if (shipIds.length === 0) return 'NO SHIPS SELECTED';
  const tfs = new Set<string>();
  for (const id of shipIds) {
    const tf = findTaskForceOfShip(world.fleets, id);
    if (!tf || !world.ships[id]) return 'A SELECTED SHIP IS NOT IN A TASK FORCE';
    tfs.add(tf.id);
  }
  if (tfs.size > 1) return 'SELECTED SHIPS BELONG TO DIFFERENT TASK FORCES';
  const tf = allTaskForces(world.fleets).find((t) => t.id === [...tfs][0])!;
  if (taskForceShipIds(tf).every((id) => shipIds.includes(id))) return 'THAT IS THE WHOLE TASK FORCE';
  if (tf.escort) return 'CANCEL THE ESCORT ORDER FIRST';
  return null;
}

/** Detach the selected ships into a new task force on the same station, tempo and orders. */
export function splitTaskForce(world: WorldDraft, shipIds: string[], name = ''): CommandResult {
  const why = splitBlocked(world, shipIds);
  if (why) return fail(why);
  const parent = findTaskForceOfShip(world.fleets, shipIds[0])!;
  const fleet = world.fleets.find((f) => f.taskForces.some((t) => t.id === parent.id))!;
  createTaskForce(world, fleet.id, name);
  const tf = fleet.taskForces[fleet.taskForces.length - 1];
  createSquadron(world, tf.id, 'Detachment');
  tf.assignedSectorId = parent.assignedSectorId;
  tf.position = { ...parent.position };
  tf.heading = parent.heading;
  tf.destination = parent.destination ? { ...parent.destination } : null;
  tf.route = parent.route.map((p) => ({ ...p }));
  tf.tempo = parent.tempo;
  tf.speedTilesPerDay = parent.speedTilesPerDay;
  for (const id of shipIds) moveShip(world, id, tf.squadrons[0].id);
  world.events.push({ severity: 'INFO', text: `${parent.name}: ${shipIds.length} ship${shipIds.length === 1 ? '' : 's'} detached as ${tf.name}` });
  return done(`${tf.name} formed`);
}

/** Why `fromId` cannot be merged into `intoId`, or null. Both must be on the same station: in port together or within a few tiles. */
export function mergeBlocked(world: WorldDraft, fromId: string, intoId: string): string | null {
  const from = allTaskForces(world.fleets).find((t) => t.id === fromId);
  const into = allTaskForces(world.fleets).find((t) => t.id === intoId);
  if (!from || !into) return 'NO SUCH TASK FORCE';
  if (from.id === into.id) return 'CHOOSE TWO DIFFERENT TASK FORCES';
  if (from.escort || into.escort) return 'CANCEL THE ESCORT ORDER FIRST';
  if (Math.hypot(from.position.x - into.position.x, from.position.y - into.position.y) > 3) return 'THE TWO TASK FORCES ARE NOT ON THE SAME STATION';
  return null;
}

/** Fold `fromId` into `intoId` (squadrons move across) and disband the empty shell. */
export function mergeTaskForces(world: WorldDraft, fromId: string, intoId: string): CommandResult {
  const why = mergeBlocked(world, fromId, intoId);
  if (why) return fail(why);
  const from = allTaskForces(world.fleets).find((t) => t.id === fromId)!;
  const into = allTaskForces(world.fleets).find((t) => t.id === intoId)!;
  into.squadrons.push(...from.squadrons);
  from.squadrons = [];
  for (const f of world.fleets) f.taskForces = f.taskForces.filter((t) => t.id !== fromId);
  world.events.push({ severity: 'INFO', text: `${from.name} merged into ${into.name}` });
  return done(`${from.name} merged into ${into.name}`);
}

export const hullName = (shipId: string, world: WorldDraft) => HULLS[world.ships[shipId].hullId].name;

/** Set the stance of every selected submarine (surface ships and boats already on that stance are skipped). */
export function setStanceMany(world: WorldDraft, shipIds: string[], stance: Stance): CommandResult {
  if (shipIds.length === 0) return fail('NO SHIPS SELECTED');
  let n = 0;
  let why = '';
  for (const id of shipIds) {
    const r = setStance(world, id, stance);
    if (r.ok) n++;
    else if (!why && !/SURFACE/.test(r.reason ?? '')) why = r.reason ?? '';
  }
  return n ? done(`${n} boat${n === 1 ? '' : 's'} on ${stance}`) : fail(why || 'NO SUBMARINE SELECTED');
}

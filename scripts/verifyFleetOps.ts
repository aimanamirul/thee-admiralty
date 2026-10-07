/**
 * Refit of commissioned ships and bulk fleet operations. Usage: npm run verify:fleetops
 */
import { MODULES } from '../lib/data/catalog';
import { evaluateLoadout, procurability } from '../lib/sim/designEngine';
import { allTaskForces, sendToRepair, taskForceShipIds } from '../lib/sim/fleetEngine';
import * as ops from '../lib/sim/fleetOps';
import { bridgeSet } from '../lib/sim/researchEngine';
import { createInitialWorld } from '../lib/sim/scenario';
import { advanceDay } from '../lib/sim/worldEngine';
import type { WorldDraft } from '../lib/types/world';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};

for (const seed of ['ADMIRALTY-001', 'FLEETOPS-2', 'FLEETOPS-3']) {
  const w: WorldDraft = createInitialWorld(seed);
  const fleet = Object.values(w.ships).filter((s) => s.buildStatus === 'COMMISSIONED' && !s.isPartsHulk);
  check(fleet.length >= 3, `${seed}: starting fleet has hulls`);
  const done = new Set(w.research.completed);
  w.resources.budget = 5000;

  // find a ship + module with a legal alternative
  let target: { id: string; index: number; alt: string } | null = null;
  outer: for (const s of fleet) {
    for (let i = 0; i < s.modules.length; i++) {
      for (const a of MODULES) {
        if (a.slot !== s.modules[i].slot || a.id === s.modules[i].moduleId || !procurability(a, w.vendors, done).ok) continue;
        const ev = evaluateLoadout(s.hullId, s.modules.map((m, j) => (j === i ? a.id : m.moduleId)), bridgeSet(w.research.completed));
        if (ev.valid) {
          target = { id: s.id, index: i, alt: a.id };
          break outer;
        }
      }
    }
  }
  if (!target) {
    console.log(`  ${seed}: no legal refit alternative on any hull (skipped)`);
    continue;
  }
  const ship = w.ships[target.id];
  const oldId = ship.modules[target.index].moduleId;

  // not in dock -> refused
  if (ship.state !== 'MAINTENANCE_DOCK') check(!!ops.refitBlocked(w, target.id, target.index, target.alt), `${seed}: refit refused at sea`);
  sendToRepair(w, ship, 'test');
  check(ship.state === 'MAINTENANCE_DOCK', 'docked');
  check(ops.refitBlocked(w, target.id, target.index, target.alt) === null, `${seed}: refit allowed in dock`);
  check(!!ops.refitBlocked(w, target.id, target.index, oldId), 'same module refused');

  const before = w.resources.budget;
  const r = ops.refitShip(w, target.id, target.index, target.alt);
  check(r.ok, `${seed}: refit ok (${r.reason})`);
  check(ship.modules[target.index].moduleId === target.alt && !ship.modules[target.index].failed, 'module swapped');
  check(Math.abs(before - w.resources.budget - ops.refitCost(oldId, target.alt)) < 1e-6, 'cost charged');
  check(ship.refitDaysLeft === ops.REFIT_DAYS, 'yard time set');
  check(!!ops.refitBlocked(w, target.id, target.index, oldId), 'cannot start a second refit while in the yard');

  // the ship stays in dock until the yard is done, then leaves
  ship.readiness = 100;
  ship.integrity = 100;
  let leftAt = -1;
  for (let d = 1; d <= ops.REFIT_DAYS + 40; d++) {
    ship.readiness = 100;
    ship.integrity = 100;
    advanceDay(w);
    if (!w.ships[target.id]) break;
    if (ship.state !== 'MAINTENANCE_DOCK' && leftAt < 0) leftAt = d;
    if (d < ops.REFIT_DAYS) check(ship.state === 'MAINTENANCE_DOCK', `${seed}: still in the yard on day ${d}`);
  }
  check(leftAt >= ops.REFIT_DAYS, `${seed}: left dock only after refit (day ${leftAt})`);
  check((ship.refitDaysLeft ?? 0) === 0, 'yard time cleared');

  // budget refusal
  sendToRepair(w, ship, 'again');
  ship.refitDaysLeft = 0;
  w.resources.budget = 0;
  check(!ops.refitShip(w, target.id, target.index, oldId).ok, 'refit refused without money');
  w.resources.budget = 5000;

  // bulk refit counts only ships carrying the module
  const w2: WorldDraft = createInitialWorld(seed);
  w2.resources.budget = 5000;
  const ids = Object.values(w2.ships).filter((s) => s.buildStatus === 'COMMISSIONED' && !s.isPartsHulk).map((s) => s.id);
  for (const id of ids) sendToRepair(w2, w2.ships[id], 'bulk');
  const slot = ship.modules[target.index].slot;
  const cands = ops.refitCandidates(w2, ids, slot, oldId);
  const rb = ops.refitMany(w2, ids, slot, oldId, target.alt);
  if (cands.length) {
    const swapped = Object.values(w2.ships).reduce((n, s) => n + s.modules.filter((m) => m.moduleId === target!.alt && m.slot === slot && (s.refitDaysLeft ?? 0) > 0).length, 0);
    check(rb.ok || cands.every((c) => ops.refitBlocked(w2, c.shipId, c.index, target!.alt)), `${seed}: bulk refit ok or all blocked (${rb.reason})`);
    check(swapped <= cands.length, 'bulk refit never touches more ships than carry the module');
  }
  check(!ops.refitMany(w2, ids, slot, 'NO-SUCH-MODULE', target.alt).ok, 'bulk refit refuses when nothing matches');

  // split / merge conserve ships and ids
  const w3: WorldDraft = createInitialWorld(seed);
  const countShips = (x: WorldDraft) => allTaskForces(x.fleets).flatMap((t) => taskForceShipIds(t)).length;
  const total = countShips(w3);
  const tf = allTaskForces(w3.fleets).find((t) => taskForceShipIds(t).length >= 2);
  if (tf) {
    const some = taskForceShipIds(tf).slice(0, 1);
    check(!ops.splitBlocked(w3, some), 'split allowed');
    check(!!ops.splitBlocked(w3, taskForceShipIds(tf)), 'cannot split the whole task force');
    const nTf = allTaskForces(w3.fleets).length;
    check(ops.splitTaskForce(w3, some).ok, 'split ok');
    check(allTaskForces(w3.fleets).length === nTf + 1 && countShips(w3) === total, 'split conserves ships');
    const ids3 = allTaskForces(w3.fleets).map((t) => t.id);
    check(new Set(ids3).size === ids3.length, 'task force ids unique');
    const created = allTaskForces(w3.fleets).find((t) => !ids3.slice(0, nTf).includes(t.id) && t.id !== tf.id && taskForceShipIds(t).includes(some[0]))!;
    check(!!created && created.tempo === tf.tempo && created.assignedSectorId === tf.assignedSectorId, 'detachment inherits station and tempo');
    check(ops.mergeTaskForces(w3, created.id, tf.id).ok, 'merge ok');
    check(allTaskForces(w3.fleets).length === nTf && countShips(w3) === total, 'merge conserves ships');
    check(!ops.mergeBlocked(w3, tf.id, tf.id) === false, 'cannot merge a task force into itself');
    // far apart -> refused
    const other = allTaskForces(w3.fleets).find((t) => t.id !== tf.id);
    if (other) {
      other.position = { x: tf.position.x + 50, y: tf.position.y };
      check(!!ops.mergeBlocked(w3, other.id, tf.id), 'merge refused when far apart');
    }
  }

  // bulk assign / tempo
  const tfs = allTaskForces(w3.fleets).map((t) => t.id);
  const sector = w3.map.sectors[0].id;
  check(ops.assignTaskForces(w3, tfs, sector).ok && allTaskForces(w3.fleets).every((t) => t.assignedSectorId === sector), 'bulk assign');
  check(ops.setTempoMany(w3, tfs, 'SURGE').ok && allTaskForces(w3.fleets).every((t) => t.tempo === 'SURGE'), 'bulk tempo');
  check(!ops.assignTaskForces(w3, [], sector).ok && !ops.moveShips(w3, [], 'x').ok, 'empty selections refused');
}

if (failures) {
  console.log(`\nFLEETOPS FAILED (${failures})`);
  process.exit(1);
}
console.log('FLEETOPS OK');

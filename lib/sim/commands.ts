/** Player commands. Each mutates a WorldDraft and reports success or a human-readable refusal. */
import { HULLS, MODULE_BY_ID, PROJECT_BY_ID } from '../data/catalog';
import { generatePennant, generateShipName } from '../generator/nameGenerator';
import { Rng } from '../generator/prng';
import type { HierarchyKind, NamingTradition, Tempo } from '../types/fleet';
import type { HullClassId } from '../types/hull';
import type { Roe, WorldDraft } from '../types/world';
import { evaluateLoadout, procurability } from './designEngine';
import { lobbyVendor, vendorBlocksOrders } from './diplomacyEngine';
import type { VendorId } from '../types/diplomacy';
import { allTaskForces, createShip, nextShipId } from './fleetEngine';
import { bridgeSet, canStart, FUND_BUREAU_COST, FUND_BUREAU_RP } from './researchEngine';
import { syncConstructionFreezes } from './diplomacyEngine';

export interface CommandResult {
  ok: boolean;
  reason?: string;
  message?: string;
}
const fail = (reason: string): CommandResult => ({ ok: false, reason });
const done = (message: string): CommandResult => ({ ok: true, message });

const vendorMap = (w: WorldDraft) => w.vendors as Record<string, WorldDraft['vendors'][keyof WorldDraft['vendors']]>;

export function orderShip(
  world: WorldDraft,
  a: { designName: string; hullId: HullClassId; moduleIds: string[]; squadronId: string; tradition: NamingTradition; customName?: string },
): CommandResult {
  const sq = allTaskForces(world.fleets).flatMap((t) => t.squadrons).find((s) => s.id === a.squadronId);
  if (!sq) return fail('SELECT A SQUADRON TO RECEIVE THE HULL');
  const ev = evaluateLoadout(a.hullId, a.moduleIds, bridgeSet(world.research.completed));
  if (!ev.valid) return fail(ev.errors[0]);
  const done_ = new Set(world.research.completed);
  for (const id of a.moduleIds) {
    const m = MODULE_BY_ID[id];
    const p = procurability(m, vendorMap(world), done_);
    if (!p.ok) return fail(`${m.name}: ${p.reason}`);
  }
  if (world.resources.budget < ev.cost) return fail(`INSUFFICIENT BUDGET: ${ev.cost.toFixed(0)} M REQUIRED`);
  world.resources.budget -= ev.cost;

  const used = new Set(Object.values(world.ships).map((s) => s.name));
  const pennants = new Set(Object.values(world.ships).map((s) => s.pennant));
  const id = nextShipId(world);
  const rng = new Rng(`${world.seed}:commission:${id}:${world.tick}`);
  const name = a.customName?.trim() ? a.customName.trim() : generateShipName(rng, a.tradition, used);
  if (used.has(name)) return fail(`NAME "${name}" ALREADY IN THE REGISTRY`);
  const ship = createShip({
    id, name, pennant: generatePennant(rng.fork('pen'), a.hullId, pennants), hullId: a.hullId,
    designName: a.designName, moduleIds: a.moduleIds, constructing: true, tick: world.tick,
  });
  world.ships[id] = ship;
  sq.shipIds.push(id);
  syncConstructionFreezes(world);
  world.events.push({ severity: 'INFO', text: `LAID DOWN: ${ship.pennant} ${name.toUpperCase()} (${HULLS[a.hullId].name}) — ${ev.cost.toFixed(0)} M, ${ship.buildTotalDays} days` });
  return done(`${name} laid down`);
}

export function buySpares(world: WorldDraft, moduleId: string, qty: number): CommandResult {
  const m = MODULE_BY_ID[moduleId];
  if (!m) return fail('UNKNOWN MODULE');
  const p = procurability(m, vendorMap(world), new Set(world.research.completed));
  if (!p.ok) return fail(`${m.name}: ${p.reason}`);
  if (vendorBlocksOrders(world.vendors[m.vendorId])) return fail('VENDOR SANCTIONED');
  const cost = m.cost * 0.35 * qty;
  if (world.resources.budget < cost) return fail(`INSUFFICIENT BUDGET: ${cost.toFixed(1)} M`);
  world.resources.budget -= cost;
  world.spares[moduleId] = (world.spares[moduleId] ?? 0) + qty;
  return done(`${qty}× ${m.name} added to spares`);
}

/** Swap a module on a hull still under construction — the escape hatch from export freezes. */
export function substituteModule(world: WorldDraft, shipId: string, index: number, newModuleId: string): CommandResult {
  const ship = world.ships[shipId];
  if (!ship || ship.buildStatus !== 'CONSTRUCTING') return fail('ONLY HULLS UNDER CONSTRUCTION CAN BE RE-KITTED');
  const old = ship.modules[index];
  const next = MODULE_BY_ID[newModuleId];
  if (!old || !next || old.slot !== next.slot) return fail('INCOMPATIBLE SOCKET');
  const p = procurability(next, vendorMap(world), new Set(world.research.completed));
  if (!p.ok) return fail(`${next.name}: ${p.reason}`);
  const cost = Math.max(0, next.cost * 1.5 - MODULE_BY_ID[old.moduleId].cost * 0.5);
  if (world.resources.budget < cost) return fail(`INSUFFICIENT BUDGET: ${cost.toFixed(0)} M`);
  const trial = ship.modules.map((m, i) => (i === index ? newModuleId : m.moduleId));
  const ev = evaluateLoadout(ship.hullId, trial, bridgeSet(world.research.completed));
  if (!ev.valid) return fail(ev.errors[0]);
  world.resources.budget -= cost;
  ship.modules[index] = { moduleId: newModuleId, slot: next.slot, condition: 1, failed: false };
  syncConstructionFreezes(world);
  world.events.push({ severity: 'INFO', text: `${ship.pennant}: substituted ${MODULE_BY_ID[old.moduleId].name} → ${next.name} (${cost.toFixed(0)} M premium)` });
  return done('Substitution complete');
}

export function startResearch(world: WorldDraft, id: string): CommandResult {
  const c = canStart(world.research, id);
  if (!c.ok) return fail(c.reason ?? 'CANNOT START');
  world.research.active.push(id);
  world.events.push({ severity: 'INFO', text: `R&D STARTED: ${PROJECT_BY_ID[id].name}` });
  return done('Project started');
}

export function stopResearch(world: WorldDraft, id: string): CommandResult {
  world.research.active = world.research.active.filter((a) => a !== id);
  return done('Project paused (progress kept)');
}

export function fundBureau(world: WorldDraft): CommandResult {
  if (world.resources.budget < FUND_BUREAU_COST) return fail(`NEEDS ${FUND_BUREAU_COST} M`);
  world.resources.budget -= FUND_BUREAU_COST;
  world.resources.researchPoints += FUND_BUREAU_RP;
  return done(`+${FUND_BUREAU_RP} RP`);
}

export function expandIndustry(world: WorldDraft): CommandResult {
  const ic = world.resources.industrialCapacity;
  if (ic >= 8) return fail('INDUSTRIAL CAPACITY AT MAXIMUM');
  const cost = 150 * ic;
  if (world.resources.budget < cost) return fail(`NEEDS ${cost} M`);
  world.resources.budget -= cost;
  world.resources.industrialCapacity++;
  world.events.push({ severity: 'INFO', text: `Industrial capacity expanded to ${ic + 1} slipways` });
  return done('Capacity expanded');
}

export function setRoe(world: WorldDraft, sectorId: number, roe: Roe): CommandResult {
  if (!world.sectors[sectorId]) return fail('NO SUCH SECTOR');
  world.sectors[sectorId].roe = roe;
  return done(`ROE ${roe}`);
}

export function assignTaskForce(world: WorldDraft, tfId: string, sectorId: number | null): CommandResult {
  const tf = allTaskForces(world.fleets).find((t) => t.id === tfId);
  if (!tf) return fail('NO SUCH TASK FORCE');
  tf.assignedSectorId = sectorId;
  tf.destination = null;
  tf.route = [];
  const label = sectorId === null ? 'PORT' : world.map.sectors[sectorId].name;
  world.events.push({ severity: 'INFO', text: `${tf.name} ordered to ${label}` });
  return done('Orders issued');
}

export function setTempo(world: WorldDraft, tfId: string, tempo: Tempo): CommandResult {
  const tf = allTaskForces(world.fleets).find((t) => t.id === tfId);
  if (!tf) return fail('NO SUCH TASK FORCE');
  tf.tempo = tempo;
  world.events.push({ severity: tempo === 'SURGE' ? 'WARNING' : 'INFO', text: `${tf.name} tempo: ${tempo === 'SURGE' ? 'SURGE — rotation suspended, expect breakdowns' : 'ROTATE THIRDS'}` });
  return done('Tempo set');
}

export function toggleHold(world: WorldDraft, shipId: string): CommandResult {
  const s = world.ships[shipId];
  if (!s) return fail('NO SUCH SHIP');
  s.holdStation = !s.holdStation;
  return done(s.holdStation ? 'Holding station' : 'Released to rotation');
}

export function renameNode(world: WorldDraft, kind: HierarchyKind, id: string, name: string): CommandResult {
  const n = name.trim();
  if (!n) return fail('NAME CANNOT BE EMPTY');
  if (kind === 'SHIP') {
    const s = world.ships[id];
    if (!s) return fail('NO SUCH SHIP');
    if (Object.values(world.ships).some((o) => o.id !== id && o.name.toLowerCase() === n.toLowerCase())) return fail('NAME ALREADY IN THE REGISTRY');
    s.name = n;
    return done('Renamed');
  }
  for (const f of world.fleets) {
    if (kind === 'FLEET' && f.id === id) { f.name = n; return done('Renamed'); }
    for (const tf of f.taskForces) {
      if (kind === 'TASKFORCE' && tf.id === id) { tf.name = n; return done('Renamed'); }
      for (const sq of tf.squadrons) if (kind === 'SQUADRON' && sq.id === id) { sq.name = n; return done('Renamed'); }
    }
  }
  return fail('NOT FOUND');
}

let uid = 0;
const freshId = (prefix: string, world: WorldDraft) => `${prefix}-${world.tick}-${++uid}`;

export function createFleet(world: WorldDraft, name: string): CommandResult {
  world.fleets.push({ id: freshId('FLT', world), name: name.trim() || `Fleet ${world.fleets.length + 1}`, taskForces: [] });
  return done('Fleet created');
}

export function createTaskForce(world: WorldDraft, fleetId: string, name: string): CommandResult {
  const f = world.fleets.find((x) => x.id === fleetId);
  if (!f) return fail('NO SUCH FLEET');
  f.taskForces.push({
    id: freshId('TF', world), name: name.trim() || `TF ${20 + allTaskForces(world.fleets).length}`, squadrons: [],
    assignedSectorId: null, position: { ...world.map.homePort }, heading: 0, speedTilesPerDay: 9, route: [], destination: null, tempo: 'ROTATE_THIRDS',
  });
  return done('Task force created');
}

export function createSquadron(world: WorldDraft, tfId: string, name: string): CommandResult {
  const tf = allTaskForces(world.fleets).find((t) => t.id === tfId);
  if (!tf) return fail('NO SUCH TASK FORCE');
  tf.squadrons.push({ id: freshId('SQ', world), name: name.trim() || `Squadron ${tf.squadrons.length + 1}`, shipIds: [] });
  return done('Squadron created');
}

export function moveShip(world: WorldDraft, shipId: string, squadronId: string): CommandResult {
  const target = allTaskForces(world.fleets).flatMap((t) => t.squadrons).find((s) => s.id === squadronId);
  if (!target || !world.ships[shipId]) return fail('INVALID TRANSFER');
  for (const tf of allTaskForces(world.fleets)) for (const sq of tf.squadrons) sq.shipIds = sq.shipIds.filter((i) => i !== shipId);
  target.shipIds.push(shipId);
  return done('Transferred');
}

export function setAutoSpares(world: WorldDraft, on: boolean): CommandResult {
  world.policy.autoSpares = on;
  return done(on ? 'Auto-procurement ON' : 'Auto-procurement OFF');
}

export function lobbyVendorCmd(world: WorldDraft, vendorId: VendorId, ministryId: string): CommandResult {
  const r = lobbyVendor(world, vendorId, ministryId);
  return r.ok ? { ok: true } : { ok: false, reason: r.reason };
}

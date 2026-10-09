/**
 * Hull diversity: what does a unit of budget buy, per hull class? Builds the best loadout each hull can legally carry from the
 * unrestricted catalogue (greedy), then compares purchase cost, running cost, presence and survivability.
 * The checks fail only on a degenerate meta (one hull class dominating on every axis, or an unusable class).
 * Usage: npm run verify:hulls
 */
import { hullPlatform, HULL_LIST, MODULES, modulePlatform } from '../lib/data/catalog';
import { evaluateLoadout } from '../lib/sim/designEngine';
import { createShip } from '../lib/sim/fleetEngine';
import { hullDailyCost } from '../lib/sim/politicsEngine';
import { presenceFrom, shipPower } from '../lib/sim/presence';
import { bridgeSet } from '../lib/sim/researchEngine';
import type { HullBase } from '../lib/types/hull';
import type { EquipmentModule } from '../lib/types/equipment';

const bridges = bridgeSet([]);
const byValue = (m: EquipmentModule) => {
  const s = m.stats;
  if (s.kind === 'POWER') return m.powerGenerationMW;
  if (s.kind === 'CMS') return s.channels / s.reactionSec;
  if (s.kind === 'SENSOR') return s.rangeKm + s.tracks;
  return s.damage * s.rounds + (s.role === 'SAM' ? 40 * s.rounds : 0);
};

function bestLoadout(h: HullBase): string[] | null {
  const chosen: string[] = [];
  const tryAdd = (m: EquipmentModule) => {
    const next = [...chosen, m.id];
    // evaluate with a plant and a CMS present so partial loads are not rejected for what is still to come
    const pad = [...next];
    if (!pad.some((id) => MODULES.find((x) => x.id === id)!.slot === 'POWERPLANT')) pad.push(MODULES.find((x) => x.slot === 'POWERPLANT')!.id);
    if (!pad.some((id) => MODULES.find((x) => x.id === id)!.slot === 'CMS')) pad.push(MODULES.find((x) => x.slot === 'CMS')!.id);
    const ev = evaluateLoadout(h.id, pad, bridges);
    const slotErr = ev.errors.some((e) => /sockets|PAYLOAD|DRAFT/i.test(e));
    if (!slotErr) chosen.push(m.id);
    return !slotErr;
  };
  for (const slot of ['POWERPLANT', 'CMS', 'SENSOR', 'ARMAMENT'] as const) {
    const pool = MODULES.filter((m) => m.slot === slot && m.requiredTier <= (hullPlatform(h) === 'SUBSURFACE' ? 2 : 1) && !m.unlockedBy && (modulePlatform(m) === 'ANY' || modulePlatform(m) === hullPlatform(h))).sort((a, b) => byValue(b) / (b.cost + 1) - byValue(a) / (a.cost + 1));
    for (let i = 0; i < h.sockets[slot]; i++) for (const m of pool) if (tryAdd(m)) break;
  }
  return evaluateLoadout(h.id, chosen, bridges).valid ? chosen : null;
}

interface Row { sub: boolean; id: string; cost: number; upkeep: number; power: number; hp: number; presence1: number }
const rows: Row[] = [];
console.log('hull        cost   upkeep/d  power(fe)  cost/fe   upkeep/fe   HP    presence of 1');
for (const h of HULL_LIST) {
  const mods = bestLoadout(h);
  if (!mods) {
    console.log(`${h.id.padEnd(10)}  no valid loadout from the open catalogue`);
    continue;
  }
  const ev = evaluateLoadout(h.id, mods, bridges);
  const ship = createShip({ id: 'x', name: 'x', pennant: 'x', hullId: h.id, designName: 'x', moduleIds: mods, constructing: false, state: 'ACTIVE_PATROL', readiness: 100, tick: 0 });
  const power = shipPower(ship);
  const up = hullDailyCost(h.id, 'ACTIVE_PATROL');
  rows.push({ sub: hullPlatform(h) === 'SUBSURFACE', id: h.id, cost: ev.cost, upkeep: up, power, hp: h.structuralHP, presence1: presenceFrom(power) });
  console.log(`${h.id.padEnd(10)} ${ev.cost.toFixed(0).padStart(5)} ${up.toFixed(2).padStart(9)} ${power.toFixed(2).padStart(10)} ${(ev.cost / power).toFixed(0).padStart(9)} ${(up / power).toFixed(2).padStart(11)} ${String(h.structuralHP).padStart(5)} ${presenceFrom(power).toFixed(2).padStart(8)}`);
}

// Equal-budget fleets: how much presence does a given purchase budget buy as one class? (diminishing returns apply)
console.log('\npresence bought by a fixed purchase budget, all one class:');
const budgets = [300, 800, 2000, 4000];
const table: Record<string, number[]> = {};
for (const r of rows) table[r.id] = budgets.map((b) => presenceFrom(Math.floor(b / r.cost) * r.power));
console.log(`${'budget'.padEnd(10)} ${budgets.map((b) => String(b).padStart(7)).join('')}`);
for (const r of rows) console.log(`${r.id.padEnd(10)} ${table[r.id].map((p) => p.toFixed(2).padStart(7)).join('')}`);
console.log('\npresence per daily running cost, one class on patrol (budget 800 M):');
for (const r of rows) console.log(`${r.id.padEnd(10)} ${(table[r.id][1] / (Math.max(1, Math.floor(800 / r.cost)) * r.upkeep)).toFixed(3)} presence per M/day`);

let failures = 0;
const fail = (m: string) => {
  failures++;
  console.log(`  FAIL: ${m}`);
};
if (rows.length < 7) fail('a hull class has no usable loadout');
// no class strictly dominates every other on cost-efficiency AND running-cost-efficiency AND durability per money
for (const a of rows) {
  const dominated = rows.filter((b) => b.id !== a.id && a.cost / a.power <= b.cost / b.power && a.upkeep / a.power <= b.upkeep / b.power && a.hp / a.cost >= b.hp / b.cost);
  if (dominated.length === rows.length - 1) fail(`${a.id} dominates every other class on cost, upkeep and durability per money`);
}
// at a small budget something must be affordable that still gives presence; at a large one the biggest hull must matter
if (!(table['FAC']?.[0] > 0)) fail('a 300 M budget buys no presence at all');
// a swarm does not beat a capital ship for the same money (the user-facing promise: a FAC squadron deters less than a task group)
{
  const dd = rows.find((r) => r.id === 'DESTROYER');
  const fac = rows.find((r) => r.id === 'FAC');
  if (dd && fac) {
    const swarm = presenceFrom(Math.floor(dd.cost / fac.cost) * fac.power);
    if (!(swarm < dd.presence1)) fail(`${Math.floor(dd.cost / fac.cost)} FACs (same money) give ${swarm.toFixed(2)} presence, a destroyer ${dd.presence1.toFixed(2)}`);
  }
}
// boats deter by uncertainty and ambush, so they must not be a cheaper way to buy deterrence than a frigate
{
  const frigate = rows.find((r) => r.id === 'FRIGATE');
  // ...and they must not be dearer to run than the frigate they cannot replace as a visible presence
  for (const b of rows.filter((r) => r.sub)) if (frigate && b.upkeep > frigate.upkeep) fail(`${b.id} costs more to run than a frigate (${b.upkeep.toFixed(2)} vs ${frigate.upkeep.toFixed(2)} M/day)`);
  for (const b of rows.filter((r) => r.sub)) if (frigate && !(b.cost / b.power > frigate.cost / frigate.power)) fail(`${b.id} buys deterrence cheaper than a frigate (${(b.cost / b.power).toFixed(0)} vs ${(frigate.cost / frigate.power).toFixed(0)} M per frigate-equivalent)`);
}
const surface = rows.filter((r) => !r.sub);
const spread = Math.max(...surface.map((r) => r.cost / r.power)) / Math.min(...surface.map((r) => r.cost / r.power));
console.log(`\ncost-per-presence spread (worst / best): ${spread.toFixed(2)}x`);
if (spread > 2.5) fail(`cost per frigate-equivalent varies ${spread.toFixed(1)}x across classes: some class is a trap or a bargain`);
if (failures) {
  console.log(`\nHULLS FAILED (${failures})`);
  process.exit(1);
}
console.log('\nHULLS OK');

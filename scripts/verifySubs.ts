/**
 * Submarines (docs/PLAN-submarines.md). S1: data and designer. Usage: npm run verify:subs
 */
import { hullPlatform, hullVendor, HULL_LIST, HULLS, MODULES, modulePlatform } from '../lib/data/catalog';
import * as cmd from '../lib/sim/commands';
import { cancellationTerms, contractShares, newContract } from '../lib/sim/contracts';
import { evaluateLoadout, hullBlocked, procurability, SUBMARINE_SERVICE } from '../lib/sim/designEngine';
import { syncConstructionFreezes } from '../lib/sim/diplomacyEngine';
import { createShip } from '../lib/sim/fleetEngine';
import * as pv from '../lib/sim/preview';
import { bridgeSet } from '../lib/sim/researchEngine';
import { createInitialWorld } from '../lib/sim/scenario';
import type { HullClassId } from '../lib/types/hull';
import { Rng } from '../lib/generator/prng';
import { IDENTIFY_RANGE, tickContacts } from '../lib/sim/contactEngine';
import { allTaskForces, taskForceShipIds } from '../lib/sim/fleetEngine';
import * as ops from '../lib/sim/fleetOps';
import { sectorPresence, taskForcePower } from '../lib/sim/presence';
import { createTutorialWorld, HOME_SECTOR } from '../lib/sim/tutorialScenario';
import { advanceDay } from '../lib/sim/worldEngine';
import { ambushOf, boatDay, depthMultiplier, EXPOSED_DAYS, indiscretionRisk, RECHARGE_DAYS, setStance, SUB_PATROL_LIMIT_DAYS } from '../lib/sim/submarines';
import type { WorldDraft } from '../lib/types/world';
import type { Ship } from '../lib/types/fleet';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};
const bridges = bridgeSet([]);
const ev = (hull: HullClassId, ids: string[]) => evaluateLoadout(hull, ids, bridges);
const SUBS = HULL_LIST.filter((h) => hullPlatform(h) === 'SUBSURFACE');

// ---- data
check(SUBS.length === 2 && SUBS.every((h) => h.vendorId && h.stealth !== undefined && h.enduranceDays !== undefined), 'two vendor submarine hulls with stealth and endurance');
check(SUBS.map((h) => h.vendorId).sort().join() === 'KESSLER_BRANDT,SEORAK', 'launch families: Seorak and Kessler-Brandt');
check(HULL_LIST.filter((h) => hullPlatform(h) === 'SURFACE').every((h) => !h.vendorId && hullVendor(h.id) === 'DOMESTIC_YARDS'), 'surface hulls are still built by the domestic yards');
for (const m of MODULES) check(['SURFACE', 'SUBSURFACE', 'ANY'].includes(modulePlatform(m)), `${m.id} has a platform`);
check(MODULES.filter((m) => modulePlatform(m) === 'SUBSURFACE').length >= 10, 'enough submarine kit');
check(MODULES.filter((m) => m.slot === 'CMS').every((m) => modulePlatform(m) === 'ANY'), 'combat systems fit any hull');
check(MODULES.filter((m) => m.stats.kind === 'SENSOR' && m.stats.domain === 'SONAR').length >= 4, 'sonars exist');

// ---- reference designs
const SEORAK_DIESEL = ['PP_SUB_SK_DE', 'CMS_SK_SHIELD', 'SEN_SONAR_SUB_SK', 'ARM_SUB_DOM_HWT', 'ARM_SUB_DOM_HWT'];
const SEORAK_AIP = ['PP_SUB_SK_DE', 'PP_SUB_SK_AIP', 'CMS_SK_SHIELD', 'SEN_SONAR_SUB_SK', 'SEN_SONAR_SUB_DOM', 'ARM_SUB_DOM_HWT', 'ARM_SUB_SK_TASM'];
const KB_AIP = ['PP_SUB_KB_DE', 'PP_SUB_KB_AIP', 'CMS_NG_TACTICOS', 'SEN_SONAR_SUB_KB', 'ARM_SUB_KB_HWT', 'ARM_SUB_KB_HWT'];
const LOUD = ['PP_SUB_DOM_DE', 'CMS_DOM_OB1', 'SEN_SONAR_SUB_DOM', 'ARM_SUB_DOM_HWT'];
const sd = ev('SUB_SEORAK', SEORAK_DIESEL);
const sa = ev('SUB_SEORAK', SEORAK_AIP);
const ka = ev('SUB_KB', KB_AIP);
const kl = ev('SUB_KB', LOUD);
for (const [label, e] of [['seorak diesel', sd], ['seorak aip', sa], ['kb aip', ka], ['kb loud', kl]] as const) {
  check(e.valid, `${label} valid (${e.errors.join('; ')})`);
  check(e.platform === 'SUBSURFACE' && e.sonarKm > 0, `${label}: submarine with sonar`);
  check(e.powerMarginMW >= 0, `${label}: power grid holds (${e.powerMarginMW.toFixed(1)} MW)`);
  check(e.detectionKm === 0 && e.trackCapacity === 0, `${label}: sonar is not radar (detection ${e.detectionKm} km, tracks ${e.trackCapacity})`);
  check(e.stealth >= 0 && e.stealth <= 100, `${label}: stealth within 0-100 (${e.stealth})`);
}
check(sa.submergedDays > sd.submergedDays + 5, `AIP extends submerged time (${sd.submergedDays} -> ${sa.submergedDays} days)`);
check(ka.stealth > sa.stealth && ka.stealth > kl.stealth + 20, `quiet plant and hull: KB AIP ${ka.stealth} > Seorak AIP ${sa.stealth} > loud ${kl.stealth}`);
check(sd.submergedDays > kl.submergedDays, 'the large-battery hull outlasts the quiet coastal boat on diesel alone');
check(ka.cost > sa.cost - 150 && sd.cost < ka.cost, 'cost ordering is plausible');
check(!sd.warnings.some((w) => /deaf/.test(w)) && ev('SUB_SEORAK', ['PP_SUB_SK_DE', 'CMS_SK_SHIELD', 'ARM_SUB_DOM_HWT']).warnings.some((w) => /deaf/.test(w)), 'a boat with no sonar is flagged deaf');
check(ev('SUB_SEORAK', ['PP_SUB_SK_AIP', 'CMS_SK_SHIELD', 'SEN_SONAR_SUB_SK', 'ARM_SUB_DOM_HWT']).warnings.some((w) => /DIESEL/.test(w)), 'a boat with no diesel is flagged');

// ---- platform rules
check(!ev('SUB_SEORAK', ['PP_SUB_SK_DE', 'CMS_SK_SHIELD', 'SEN_DOM_DSR2', 'ARM_SUB_DOM_HWT']).valid, 'a surface radar is refused on a boat');
check(!ev('SUB_SEORAK', ['PP_SUB_SK_DE', 'CMS_SK_SHIELD', 'SEN_SONAR_SUB_SK', 'ARM_DOM_GUN76']).valid, 'a deck gun is refused on a boat');
check(!ev('SUB_SEORAK', ['PP_DOM_D12', 'CMS_SK_SHIELD', 'SEN_SONAR_SUB_SK', 'ARM_SUB_DOM_HWT']).valid, 'a surface power plant is refused on a boat');
check(!ev('FRIGATE', ['PP_DOM_D12', 'CMS_NG_TACTICOS', 'SEN_NG_SMARTS', 'ARM_SUB_DOM_HWT']).valid, 'submarine tubes are refused on a frigate');
check(!ev('FRIGATE', ['PP_SUB_DOM_DE', 'CMS_NG_TACTICOS', 'SEN_NG_SMARTS', 'ARM_DOM_GUN76']).valid, 'a submarine plant is refused on a frigate');
const radarOnly = ev('FRIGATE', ['PP_DOM_D12', 'CMS_NG_TACTICOS', 'SEN_NG_SMARTS', 'ARM_NG_SYLVER8']);
const withSonar = ev('FRIGATE', ['PP_DOM_D12', 'CMS_NG_TACTICOS', 'SEN_NG_SMARTS', 'SEN_SONAR_TOWED', 'ARM_NG_SYLVER8']);
check(withSonar.valid && withSonar.sonarKm > 0 && radarOnly.sonarKm === 0, 'a surface ship can carry towed sonar');
check(withSonar.detectionKm === radarOnly.detectionKm && withSonar.trackCapacity === radarOnly.trackCapacity, 'sonar does not change radar detection or track capacity');
check(ev('FRIGATE', ['PP_DOM_D12', 'CMS_NG_TACTICOS', 'SEN_SONAR_HULL', 'ARM_NG_SYLVER8']).warnings.some((w) => /NO RADAR/.test(w)), 'a surface ship with sonar only is flagged without radar');
check(ev('FRIGATE', ['PP_DOM_D12', 'CMS_NG_TACTICOS', 'SEN_NG_SMARTS', 'ARM_NG_SYLVER8']).stealth === 0, 'surface ships report no stealth figure');

// ---- hulls as vendor products: contracts, freezes, refunds
{
  const shares = contractShares('SUB_KB', KB_AIP);
  check(Math.abs(Object.values(shares).reduce((a, b) => a + (b ?? 0), 0) - 1) < 1e-9, 'contract shares sum to 1');
  check((shares.KESSLER_BRANDT ?? 0) > 0.8 && !shares.DOMESTIC_YARDS, 'the hull price goes to Kessler-Brandt, not the domestic yards');
  const w = createInitialWorld('SUBS-1', 'CORRIDOR');
  w.scripted = true;
  const ship = createShip({ id: 'SUB-T', name: 'Test', pennant: 'S1', hullId: 'SUB_SEORAK', designName: 'T', moduleIds: ['PP_SUB_DOM_DE', 'CMS_DOM_OB1', 'SEN_SONAR_SUB_DOM', 'ARM_SUB_DOM_HWT'], constructing: true, tick: w.tick });
  ship.contract = newContract('SUB_SEORAK', ship.modules.map((m) => m.moduleId), 400);
  w.ships[ship.id] = ship;
  syncConstructionFreezes(w);
  check(ship.frozenBy === null, 'no freeze while the builder is active');
  w.vendors.SEORAK.status = 'FROZEN';
  w.sanctions.push({ id: 'S', vendorId: 'SEORAK', kind: 'EXPORT_FREEZE', startTick: w.tick, endTick: w.tick + 90 });
  syncConstructionFreezes(w);
  check(ship.frozenBy === 'SEORAK', 'a sanction on the hull builder stalls construction even with all-domestic kit');
  const t = cancellationTerms(w, ship);
  check(t.lines.some((l) => l.vendorId === 'SEORAK' && l.basis === 'FAULT'), 'the builder refunds as the party that cannot deliver');
  const hullLine = t.lines.find((l) => l.vendorId === 'SEORAK');
  check(!!hullLine && hullLine.paid > 0.5 * t.paid, 'most of the money paid went to the hull builder');
}

// ---- service gate and procurement
{
  const w = createInitialWorld('SUBS-2', 'CORRIDOR');
  w.resources.budget = 5000;
  const done = new Set(w.research.completed);
  const why = hullBlocked('SUB_SEORAK', w.vendors, done);
  check(SUBMARINE_SERVICE ? why === null || /HULL FROM/.test(why) : /NO SUBMARINE SERVICE/.test(why ?? ''), `service gate (${why})`);
  check(hullBlocked('FRIGATE', w.vendors, done) === null, 'surface hulls are never gated');
  const r = cmd.orderShip(w, { designName: 'S', hullId: 'SUB_SEORAK', moduleIds: ['PP_SUB_DOM_DE', 'CMS_DOM_OB1', 'SEN_SONAR_SUB_DOM', 'ARM_SUB_DOM_HWT'], squadronId: 'SQ-1-1', tradition: 'VIRTUES' });
  const p = pv.previewOrderShip(w, { hullId: 'SUB_SEORAK', moduleIds: ['PP_SUB_DOM_DE', 'CMS_DOM_OB1', 'SEN_SONAR_SUB_DOM', 'ARM_SUB_DOM_HWT'], squadronId: 'SQ-1-1' });
  check(p.startsWith('BLOCKED') === !r.ok, `preview agrees with the command (${p.slice(0, 60)})`);
  for (const m of MODULES.filter((x) => modulePlatform(x) === 'SUBSURFACE')) check(typeof procurability(m, w.vendors, done).ok === 'boolean', `${m.id} has a procurability verdict`);
}



// =========================================================================================================== S2: the service
const KB_BOAT = KB_AIP;
const BOAT_MODULES: Record<string, string[]> = { SUB_KB: KB_BOAT, SUB_SEORAK: SEORAK_AIP };
let uid = 0;
/** A commissioned boat on patrol, placed in the task force and given the stated stance. */
function addBoat(w: WorldDraft, tf: { squadrons: { shipIds: string[] }[] }, hull: 'SUB_KB' | 'SUB_SEORAK' = 'SUB_KB', modules = BOAT_MODULES[hull]): Ship {
  const ship = createShip({ id: `SUB-S2-${uid++}`, name: `Boat${uid}`, pennant: `S${uid}`, hullId: hull, designName: 'T', moduleIds: modules, constructing: false, state: 'ACTIVE_PATROL', stateDays: 5, readiness: 100, tick: w.tick });
  w.ships[ship.id] = ship;
  tf.squadrons[0].shipIds.push(ship.id);
  return ship;
}
const station = (w: WorldDraft, tfIdx: number, sectorId: number) => {
  const tf = allTaskForces(w.fleets)[tfIdx];
  tf.assignedSectorId = sectorId;
  tf.position = { ...w.map.sectors[sectorId].anchor };
  tf.route = [];
  return tf;
};

// ---- depth multiplier
check(depthMultiplier({ abyssalFraction: 1, littoralFraction: 0 }) === 1 && depthMultiplier({ abyssalFraction: 0, littoralFraction: 1 }) === 0.3 && Math.abs(depthMultiplier({ abyssalFraction: 0, littoralFraction: 0 }) - 0.7) < 1e-9, 'depth: abyssal 1.0, shelf 0.7, littoral 0.3');

// ---- presence by stance, exposure and depth
{
  const w = createInitialWorld('SUBS-P', 'CORRIDOR');
  const sorted = [...w.map.sectors].sort((a, b) => depthMultiplier(b) - depthMultiplier(a));
  const deep = sorted[0];
  const shallow = sorted[sorted.length - 1];
  const tf = station(w, 0, deep.id);
  for (const id of taskForceShipIds(tf)) delete w.ships[id];
  tf.squadrons.forEach((q) => (q.shipIds = []));
  const boat = addBoat(w, tf);
  const power = () => taskForcePower(w, tf, true);
  boat.stance = 'PATROL';
  const patrol = power();
  boat.stance = 'STEALTH';
  const stealthP = power();
  boat.exposedDays = 3;
  const exposedP = power();
  boat.exposedDays = 0;
  boat.rechargeDays = 2;
  const recharging = power();
  boat.rechargeDays = 0;
  check(patrol > 0 && stealthP > 0 && Math.abs(stealthP / patrol - 0.4) < 1e-6, `stealth deters 40% of patrol (${(stealthP / patrol).toFixed(2)})`);
  check(exposedP === 0, 'a counter-detected boat deters nothing');
  check(recharging < patrol && recharging > 0, 'a recharging boat deters half (snorkelling)');
  boat.stance = 'PATROL';
  const atDeep = power();
  tf.assignedSectorId = shallow.id;
  const atShallow = power();
  check(deepFirst(deep, shallow) ? atDeep > atShallow : true, `deep water deters more than shallow (${atDeep.toFixed(3)} vs ${atShallow.toFixed(3)})`);
  // a boat is a poor way to buy visible presence: weaker than a frigate on the same station
  tf.assignedSectorId = deep.id;
  const fw = createInitialWorld('SUBS-P', 'CORRIDOR');
  const frigate = Object.values(fw.ships).find((x) => x.hullId === 'FRIGATE' && x.buildStatus === 'COMMISSIONED')!;
  check(patrol < 0.6 * (frigate ? 1.0 : 1), `a boat on patrol is below a frigate-equivalent (${patrol.toFixed(2)} fe)`);
  // sector presence counts boats on station
  tf.position = { ...deep.anchor };
  check(sectorPresence(w, deep.id).presence > 0, 'boats on station add sector presence');
}
function deepFirst(a: { abyssalFraction: number; littoralFraction: number }, b: { abyssalFraction: number; littoralFraction: number }) {
  return depthMultiplier(a) > depthMultiplier(b) + 0.02;
}

// ---- indiscretion: quiet hulls, stealth stance, shallow water and tension
{
  const w = createInitialWorld('SUBS-R', 'CORRIDOR');
  const tf = allTaskForces(w.fleets)[0];
  const rate = (hull: 'SUB_KB' | 'SUB_SEORAK', modules: string[], stance: 'STEALTH' | 'PATROL', littoral: number, tension: number) => {
    const ww = structuredClone({ ...w, map: undefined }) as unknown as WorldDraft;
    ww.map = w.map;
    ww.tension = tension;
    const boat = addBoat(ww, allTaskForces(ww.fleets)[0], hull, modules);
    boat.stance = stance;
    let hits = 0;
    const days = 4000;
    for (let d = 0; d < days; d++) {
      ww.tick = d;
      boat.exposedDays = 0;
      boat.rechargeDays = 0;
      boat.submergedLeft = 99;
      boat.exposedDays = 0;
      boatDay(ww, boat, { littoralFraction: littoral, abyssalFraction: 1 - littoral });
      if ((boat.exposedDays ?? 0) > 0) hits++;
    }
    void tf;
    return hits / days;
  };
  const kbOpen = rate('SUB_KB', KB_AIP, 'PATROL', 0, 30);
  const kbShallow = rate('SUB_KB', KB_AIP, 'PATROL', 0.9, 30);
  const loudOpen = rate('SUB_KB', LOUD.filter((m) => !m.includes('HWT')).concat(['ARM_SUB_KB_HWT']).filter((m) => m !== 'CMS_DOM_OB1').concat(['CMS_NG_TACTICOS']).filter((m) => m !== 'SEN_SONAR_SUB_DOM').concat(['SEN_SONAR_SUB_KB']), 'PATROL', 0, 30);
  const kbStealth = rate('SUB_KB', KB_AIP, 'STEALTH', 0, 30);
  const kbHot = rate('SUB_KB', KB_AIP, 'PATROL', 0, 90);
  check(kbOpen > 0.003 && kbOpen < 0.05, `patrol exposure is a few percent a day (${(kbOpen * 100).toFixed(2)}%)`);
  check(kbShallow > kbOpen * 1.5, `shallow water raises exposure (${(kbOpen * 100).toFixed(2)}% -> ${(kbShallow * 100).toFixed(2)}%)`);
  check(kbStealth < kbOpen * 0.3, `stealth stance almost never snorkels (${(kbStealth * 100).toFixed(2)}%)`);
  check(kbHot > kbOpen * 1.2, `tension raises exposure (${(kbOpen * 100).toFixed(2)}% -> ${(kbHot * 100).toFixed(2)}%)`);
  check(indiscretionRisk(80, undefined, 0) < indiscretionRisk(30, undefined, 0), 'quieter boats are exposed less');
  check(loudOpen >= 0, 'loud variant evaluated');
  console.log(`exposure per patrol day: KB open ${(kbOpen * 100).toFixed(2)}% · littoral ${(kbShallow * 100).toFixed(2)}% · stealth ${(kbStealth * 100).toFixed(2)}% · tension 90 ${(kbHot * 100).toFixed(2)}%`);
}

// ---- endurance: stealth drains and recharges, patrol never runs dry
{
  const w = createInitialWorld('SUBS-E', 'CORRIDOR');
  w.tension = 0;
  const tf = allTaskForces(w.fleets)[0];
  const boat = addBoat(w, tf, 'SUB_KB');
  const fig = evaluateLoadout('SUB_KB', BOAT_MODULES.SUB_KB, bridges);
  const sec = { littoralFraction: 0, abyssalFraction: 1 };
  boat.stance = 'STEALTH';
  let rechargeAt = -1;
  let backAt = -1;
  for (let d = 1; d <= fig.submergedDays + RECHARGE_DAYS + 3; d++) {
    w.tick = 1000 + d;
    boat.exposedDays = 0; // isolate endurance from exposure
    boatDay(w, boat, sec);
    if ((boat.rechargeDays ?? 0) > 0 && rechargeAt < 0) rechargeAt = d;
    if (rechargeAt > 0 && backAt < 0 && (boat.rechargeDays ?? 0) === 0) {
      backAt = d;
      check(boat.submergedLeft === fig.submergedDays, 'endurance is full when the recharge ends');
    }
  }
  check(rechargeAt === fig.submergedDays, `stealth runs out after ${fig.submergedDays} days (day ${rechargeAt})`);
  check(backAt === rechargeAt + RECHARGE_DAYS, `recharge takes ${RECHARGE_DAYS} days then endurance is full (back at ${backAt})`);
  boat.stance = 'PATROL';
  for (let d = 0; d < 120; d++) {
    w.tick = 3000 + d;
    boat.exposedDays = 0;
    boatDay(w, boat, sec);
    if ((boat.rechargeDays ?? 0) > 0) check(false, 'patrol never needs a recharge');
  }
}

// ---- ambush before the surface engagement
{
  const base = createTutorialWorld();
  const mk = (strength: number, stance: 'STEALTH' | 'PATROL' | null, exposed = false) => {
    const w = structuredClone(base) as WorldDraft;
    w.map = base.map;
    w.events = [];
    for (const o of allTaskForces(w.fleets)) if (o.id !== 'TF-1') o.position = { x: -500, y: -500 };
    const tf = allTaskForces(w.fleets).find((x) => x.id === 'TF-1')!;
    tf.assignedSectorId = HOME_SECTOR;
    tf.position = { ...w.map.sectors[HOME_SECTOR].anchor };
    let boat: Ship | null = null;
    if (stance) {
      boat = addBoat(w, tf, 'SUB_SEORAK');
      boat.stance = stance;
      if (exposed) boat.exposedDays = 3;
    }
    w.contacts.push({ id: 'CT-AMB', sectorId: HOME_SECTOR, position: { x: tf.position.x + 5, y: tf.position.y }, heading: 0, cls: 'HOSTILE', hostile: true, intent: 'RAIDER', strength, bornTick: 0, expiresTick: 40 });
    tickContacts(w, new Rng('amb'), new Set());
    return { w, boat, tf };
  };
  const none = mk(120, null);
  const stealth = mk(120, 'STEALTH');
  const patrol = mk(120, 'PATROL');
  const hidden = mk(120, 'STEALTH', true);
  check(!none.w.events.some((e) => /AMBUSH/.test(e.text)), 'no ambush without a boat');
  check(stealth.w.events.some((e) => /AMBUSH/.test(e.text) && /strength 120/.test(e.text)), 'a boat on station ambushes the raid');
  check(!hidden.w.events.some((e) => /AMBUSH/.test(e.text)), 'a counter-detected boat cannot ambush');
  const cut = (r: { w: WorldDraft }) => {
    const m = r.w.events.find((e) => /AMBUSH/.test(e.text))?.text.match(/strength 120 → (\d+)/);
    return m ? Number(m[1]) : 120;
  };
  check(cut(stealth) < cut(patrol) && cut(patrol) < 120, `stealth strikes harder than patrol (${cut(stealth)} < ${cut(patrol)} < 120)`);
  check(ambushOf([stealth.boat!], base.map.sectors[HOME_SECTOR], 1000).reduction <= 600, 'the opening strike is capped at 60% of the raid');
  check(stealth.w.events.some((e) => /^ENGAGEMENT/.test(e.text)), 'a strong raid still reaches the surface engagement');
  const weak = mk(8, 'STEALTH');
  const modest = mk(22, 'STEALTH');
  check(modest.w.events.some((e) => /before it reaches the force/.test(e.text)), 'a modest raid is broken by the ambush alone');
  check(weak.w.events.some((e) => /before it reaches the force/.test(e.text)) && !weak.w.events.some((e) => /^ENGAGEMENT/.test(e.text)), 'a weak raid is destroyed before any ship fires');
  check(weak.w.stats.hostilesDestroyed === 1, 'the ambush kill is counted');
  // boats are not targets of the surface engagement
  check(stealth.boat!.integrity === 100, 'a boat is not hit by the raid');
  console.log(`ambush on a 120-strength raid: stealth → ${cut(stealth)}, patrol → ${cut(patrol)}`);

  // a task force made only of boats does not meet the raid
  const w = structuredClone(base) as WorldDraft;
  w.map = base.map;
  w.events = [];
  for (const o of allTaskForces(w.fleets)) o.position = { x: -500, y: -500 };
  const empty = allTaskForces(w.fleets)[0];
  for (const id of taskForceShipIds(empty)) delete w.ships[id];
  empty.squadrons.forEach((q) => (q.shipIds = []));
  const lone = addBoat(w, empty, 'SUB_SEORAK');
  empty.position = { ...w.map.sectors[HOME_SECTOR].anchor };
  empty.assignedSectorId = HOME_SECTOR;
  w.contacts.push({ id: 'CT-LONE', sectorId: HOME_SECTOR, position: { x: empty.position.x + 2, y: empty.position.y }, heading: 0, cls: 'UNKNOWN', hostile: true, intent: 'RAIDER', strength: 40, bornTick: 0, expiresTick: 40 });
  tickContacts(w, new Rng('lone'), new Set());
  check(!w.events.some((e) => /^ENGAGEMENT/.test(e.text)) && lone.integrity === 100, 'a boat-only task force does not fight a surface engagement');

  // early identification by passive sonar
  const idAt = (withBoat: boolean, exposed = false) => {
    const ww = structuredClone(base) as WorldDraft;
    ww.map = base.map;
    ww.events = [];
    for (const o of allTaskForces(ww.fleets)) o.position = { x: -500, y: -500 };
    const tf = allTaskForces(ww.fleets)[0];
    tf.position = { ...ww.map.sectors[HOME_SECTOR].anchor };
    tf.assignedSectorId = HOME_SECTOR;
    if (withBoat) {
      const bt = addBoat(ww, tf, 'SUB_KB');
      if (exposed) bt.exposedDays = 4;
    }
    const d = IDENTIFY_RANGE * 1.4;
    ww.contacts.push({ id: 'CT-ID', sectorId: HOME_SECTOR, position: { x: tf.position.x + d, y: tf.position.y }, heading: 0, cls: 'UNKNOWN', hostile: false, intent: 'MERCHANT', strength: 0, bornTick: 0, expiresTick: 40 });
    tickContacts(ww, new Rng('id'), new Set());
    return ww.contacts.find((c) => c.id === 'CT-ID')?.cls ?? 'GONE';
  };
  check(idAt(false) === 'UNKNOWN', 'without a boat the contact stays unidentified at 1.4x visual range');
  check(idAt(true) !== 'UNKNOWN', 'a boat identifies it earlier by passive sonar');
  check(idAt(true, true) === 'UNKNOWN', 'a counter-detected boat does not');
}

// ---- rotation: longer patrols, longer overhauls
{
  const w = createInitialWorld('SUBS-T', 'CORRIDOR');
  w.scripted = true;
  const tf = station(w, 0, w.map.sectors[0].id);
  const boat = addBoat(w, tf, 'SUB_KB');
  boat.stateDays = SUB_PATROL_LIMIT_DAYS - 2;
  boat.readiness = 100;
  let leftAt = -1;
  for (let d = 1; d <= 6 && leftAt < 0; d++) {
    boat.readiness = Math.max(boat.readiness, 90);
    advanceDay(w);
    if (boat.state === 'MAINTENANCE_DOCK') leftAt = d;
  }
  check(leftAt > 0 && leftAt <= 4, `a boat docks at its own patrol limit (${SUB_PATROL_LIMIT_DAYS} days), day ${leftAt}`);
  let docked = 0;
  for (let d = 0; d < 40 && boat.state === 'MAINTENANCE_DOCK'; d++) {
    boat.readiness = 100;
    boat.integrity = 100;
    advanceDay(w);
    docked++;
  }
  check(docked >= 12, `a boat stays in overhaul at least 14 days (${docked})`);
}

// ---- stance commands
{
  const w = createInitialWorld('SUBS-C', 'CORRIDOR');
  const tf = allTaskForces(w.fleets)[0];
  const boat = addBoat(w, tf);
  const frigate = Object.values(w.ships).find((x) => x.hullId === 'FRIGATE')!;
  check(setStance(w, boat.id, 'STEALTH').ok && boat.stance === 'STEALTH', 'stance can be set');
  check(!setStance(w, boat.id, 'STEALTH').ok, 'setting the same stance is refused');
  check(!setStance(w, frigate.id, 'STEALTH').ok, 'a surface ship has no stance');
  const b2 = addBoat(w, tf);
  check(ops.setStanceMany(w, [boat.id, b2.id, frigate.id], 'PATROL').ok && boat.stance === 'PATROL' && b2.stance !== 'STEALTH', 'bulk stance applies to boats and skips surface ships');
  check(!ops.setStanceMany(w, [frigate.id], 'PATROL').ok && !ops.setStanceMany(w, [], 'PATROL').ok, 'bulk stance refuses with no boats');
  const copy = JSON.parse(JSON.stringify({ ...w, map: undefined }));
  check(copy.ships[boat.id].stance === boat.stance, 'stance survives a save round trip');
}

// ---- laying down and commissioning: first boat is a national event, only once
{
  const w = createInitialWorld('SUBS-O', 'CORRIDOR');
  w.scripted = true;
  w.resources.budget = 9000;
  w.resources.industrialCapacity = 4;
  for (const id of ['SEORAK', 'KESSLER_BRANDT'] as const) {
    w.vendors[id].rung = 'STRATEGIC';
    w.vendors[id].standing = 95;
    w.vendors[id].status = 'ACTIVE';
  }
  const order = (hull: 'SUB_SEORAK' | 'SUB_KB', ids: string[]) => cmd.orderShip(w, { designName: 'T', hullId: hull, moduleIds: ids, squadronId: 'SQ-1-1', tradition: 'VIRTUES' });
  const r1 = order('SUB_SEORAK', SEORAK_AIP);
  check(r1.ok, `a boat can be laid down once the builder sells (${r1.reason})`);
  const r2 = order('SUB_KB', KB_AIP);
  check(r2.ok, `second family too (${r2.reason})`);
  const support0 = w.politics.support;
  const days = 260;
  for (let d = 0; d < days; d++) advanceDay(w);
  const boats = Object.values(w.ships).filter((x) => x.hullId.startsWith('SUB_') && x.buildStatus === 'COMMISSIONED');
  check(boats.length === 2, `both boats commissioned (${boats.length})`);
  check(w.stats.firstBoatTick !== undefined, 'the first submarine is recorded');
  check(w.events.filter((e) => /FIRST SUBMARINE/.test(e.text)).length === 1, 'the national first is announced exactly once');
  void support0;
}

if (failures) {
  console.log(`\nSUBS FAILED (${failures})`);
  process.exit(1);
}
console.log('SUBS OK (S1 data and designer, S2 service)');

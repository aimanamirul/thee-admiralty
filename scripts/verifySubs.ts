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
check(SUBS.length === 3 && SUBS.every((h) => h.vendorId && h.stealth !== undefined && h.enduranceDays !== undefined), 'three vendor submarine hulls with stealth and endurance');
check(SUBS.map((h) => h.vendorId).sort().join() === 'DAHAI,KESSLER_BRANDT,SEORAK', 'families: Seorak, Kessler-Brandt and Dahai');
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


// =========================================================================================================== S3: enemy submarines and ASW
import { afterAttack, aswCoverAt, aswPowerNear, datumRadius, DATUM_MAX, killChance, maybeSpawnSub, reachOf, sonarPlatforms, SUB_FIRST_TICK, SUB_WARNING_TICK, trackStep, TRACK_DATUM, TRACK_HELD, visibilityOf, visibleContacts, type Platform } from '../lib/sim/asw';
import { actionBlocked, sopAction } from '../lib/sim/contactEngine';
import { tickShipping } from '../lib/sim/shipping';
import type { Contact } from '../lib/types/world';

const ASW_FRIGATE = ['PP_DOM_D12', 'CMS_NG_TACTICOS', 'SEN_NG_SMARTS', 'SEN_SONAR_TOWED', 'ARM_NG_SYLVER8', 'ARM_DOM_TORP'];
const copyOf = (w: WorldDraft) => ({ ...structuredClone({ ...w, map: undefined }), map: w.map }) as WorldDraft;
function subContact(w: WorldDraft, over: Partial<Contact> = {}): Contact {
  const a = w.map.sectors[0].anchor;
  return { id: `CT-S3-${uid++}`, sectorId: 0, position: { x: a.x + 2, y: a.y }, heading: 0, cls: 'UNKNOWN', hostile: true, intent: 'SUBMARINE', strength: 70, bornTick: w.tick, expiresTick: 1e9, submerged: true, track: 0, stealth: 55, attacks: 0, nextAttackTick: w.tick, ...over };
}
const S3_BASE = createInitialWorld('S3-BASE', 'CORRIDOR');
function s3world(_seed: string, sonar = false) {
  const w = copyOf(S3_BASE);
  w.contacts = [];
  w.tension = 40;
  const tf = allTaskForces(w.fleets)[0];
  tf.position = { ...w.map.sectors[0].anchor };
  tf.assignedSectorId = 0;
  for (const id of taskForceShipIds(tf)) w.ships[id].state = 'ACTIVE_PATROL';
  if (sonar) {
    const ship = createShip({ id: `ASW-${uid++}`, name: 'Listener', pennant: 'F99', hullId: 'FRIGATE', designName: 'T', moduleIds: ASW_FRIGATE, constructing: false, state: 'ACTIVE_PATROL', readiness: 100, tick: w.tick });
    w.ships[ship.id] = ship;
    tf.squadrons[0].shipIds.push(ship.id);
  }
  return { w, tf };
}

// ---- visibility bands and the datum
{
  const c = subContact(copyOf(S3_BASE));
  const v = (t: number) => { c.track = t; return visibilityOf(c); };
  check(v(0) === 'HIDDEN' && v(TRACK_DATUM - 1) === 'HIDDEN' && v(TRACK_DATUM) === 'DATUM' && v(TRACK_HELD - 1) === 'DATUM' && v(TRACK_HELD) === 'HELD', 'visibility bands: hidden, datum, held');
  c.track = TRACK_DATUM;
  const r0 = datumRadius(c);
  c.track = TRACK_HELD - 1;
  const r1 = datumRadius(c);
  check(Math.abs(r0 - DATUM_MAX) < 1e-9 && r1 < r0 && r1 >= 1.5, `the datum shrinks as sonar holds (${r0.toFixed(1)} -> ${r1.toFixed(1)} tiles)`);
  const w = copyOf(S3_BASE);
  const hidden = subContact(w, { track: 5 });
  const held = subContact(w, { track: 90 });
  const surface: Contact = { ...held, id: 'CT-SURF', submerged: false, intent: 'RAIDER' };
  check(visibleContacts([hidden, held, surface]).map((x) => x.id).join() === `${held.id},CT-SURF`, 'only held submarines and surface contacts are listed on the plot');
}

// ---- sonar platforms and tracking
{
  const { w, tf } = s3world('S3-T');
  check(sonarPlatforms(w).length === 0, 'the starter fleet has no sonar: it cannot find a submarine');
  const { w: sw, tf: stf } = s3world('S3-T', true);
  const plats = sonarPlatforms(sw);
  check(plats.length === 1 && plats[0].tfId === stf.id && !plats[0].boat && plats[0].sonarKm === 45, 'a towed-array frigate is a sonar platform');
  const listener = Object.values(sw.ships).find((x) => x.name === 'Listener')!;
  listener.state = 'MAINTENANCE_DOCK';
  check(sonarPlatforms(sw).length === 0, 'a docked ship does not listen');
  listener.state = 'ACTIVE_PATROL';
  const boat = addBoat(sw, stf, 'SUB_KB');
  check(sonarPlatforms(sw).filter((p) => p.boat).length === 1, 'a patrolling boat is a sonar platform');
  boat.exposedDays = 3;
  check(sonarPlatforms(sw).filter((p) => p.boat).length === 0, 'a counter-detected boat is not');
  void tf;
  const p: Platform = { tfId: 'x', x: sw.map.sectors[0].anchor.x, y: sw.map.sectors[0].anchor.y, sonarKm: 45, quality: 1, boat: false };
  const c = subContact(sw, { position: { x: p.x + 3, y: p.y } });
  const quiet = subContact(sw, { stealth: 75 });
  const loud = subContact(sw, { stealth: 45 });
  check(reachOf(sw, p, loud) > reachOf(sw, p, quiet), 'a quieter submarine is held at shorter range');
  let days = 0;
  while (visibilityOf(c) !== 'HELD' && days++ < 10) trackStep(sw, c, [p]);
  check(days <= 4, `a platform in reach holds the contact within four days (${days})`);
  let decay = 0;
  while (visibilityOf(c) !== 'HIDDEN' && decay++ < 30) trackStep(sw, c, []);
  check(decay >= 3 && decay <= 12, `with nobody listening the track fades (${decay} days)`);
  const far = subContact(sw, { position: { x: p.x + 60, y: p.y } });
  for (let d = 0; d < 10; d++) trackStep(sw, far, [p]);
  check(visibilityOf(far) === 'HIDDEN', 'out of reach nothing is heard');
  check(aswCoverAt([p], p.x, p.y) > 0.5 && aswCoverAt([], p.x, p.y) === 0 && aswCoverAt([p, { ...p }], p.x, p.y) > aswCoverAt([p], p.x, p.y), 'sonar cover grows with platforms and is zero without any');
  check(aswPowerNear(sw, p.x, p.y).power >= 60, 'the frigate carries ASW torpedoes');
}

// ---- spawning: gated by time, tension and scripting; listening discourages it
{
  const base = S3_BASE;
  const count = (tick: number, tension: number, scripted = false, listening = false) => {
    const w = copyOf(base);
    w.contacts = [];
    w.scripted = scripted;
    w.tension = tension;
    for (const s of Object.values(w.sectors)) s.threat = 55;
    const platforms = listening ? w.map.sectors.map((sec) => ({ tfId: 'x', x: sec.anchor.x, y: sec.anchor.y, sonarKm: 40, quality: 1, boat: false })) : [];
    let n = 0;
    for (let d = 0; d < 1500; d++) {
      w.tick = tick + d;
      for (const sec of w.map.sectors) {
        w.contacts = [];
        if (maybeSpawnSub(w, sec.id, platforms)) n++;
      }
    }
    return n;
  };
  check(count(0, 40) === 0 || SUB_FIRST_TICK <= 0 ? true : count(SUB_FIRST_TICK - 1600, 40) === 0, 'no enemy submarines before the first year');
  check(count(SUB_FIRST_TICK, 10) === 0, 'none while tension is low');
  check(count(SUB_FIRST_TICK, 40, true) === 0, 'none in scripted worlds (the briefing)');
  const open = count(SUB_FIRST_TICK, 40);
  const listening = count(SUB_FIRST_TICK, 40, false, true);
  check(open > 20, `they do appear later in the game (${open} in 1500 days x sectors)`);
  check(listening < open * 0.8, `sonar on station discourages them (${open} -> ${listening})`);
  const w = copyOf(base);
  w.tick = 0;
  w.contacts = [];
  const seen: string[] = [];
  const w2 = createInitialWorld('S3-W', 'CORRIDOR');
  w2.scripted = false;
  for (let d = 0; d < SUB_WARNING_TICK + 3; d++) {
    advanceDay(w2);
    for (const e of w2.events) seen.push(e.text);
    w2.events = [];
  }
  check(seen.filter((t) => /UNUSUAL ACOUSTIC ACTIVITY/.test(t)).length === 1, 'the acoustic advisory is issued once, before any submarine can appear');
  check(!w2.contacts.some((c) => c.submerged), 'no submarine before the advisory');
}

// ---- an undetected hostile boat strikes warships; sonar cover protects; held and shadowed boats are cautious
{
  const trial = (sonar: boolean, mode: 'UNHELD' | 'HELD' | 'SHADOW', seed: number) => {
    const { w } = s3world(`S3-A${seed}`, sonar);
    w.scripted = true;
    const c = subContact(w, mode === 'UNHELD' ? {} : { track: 95 });
    if (mode === 'SHADOW') c.order = 'SHADOW';
    w.contacts.push(c);
    let first = -1;
    for (let d = 0; d < 25 && first < 0; d++) {
      w.tick = 400 + d;
      c.nextAttackTick = 0;
      if (mode !== 'UNHELD') c.track = 95;
      const before = w.events.length;
      tickContacts(w, new Rng(`sa${seed}:${d}`), new Set());
      if (w.events.slice(before).some((e) => /^TORPEDO/.test(e.text))) first = d;
      if (!w.contacts.some((x) => x.id === c.id)) break;
    }
    return { struck: first >= 0, w, c };
  };
  const N = 80;
  const rate = (sonar: boolean, mode: 'UNHELD' | 'HELD' | 'SHADOW') => Array.from({ length: N }, (_, i) => trial(sonar, mode, i)).filter((r) => r.struck).length / N;
  const bold = rate(false, 'UNHELD');
  const covered = rate(true, 'UNHELD');
  const held = rate(false, 'HELD');
  const shadowed = rate(false, 'SHADOW');
  check(bold > 0.8, `an unheard boat among warships strikes within weeks (${(bold * 100).toFixed(0)}%)`);
  check(covered < bold - 0.05 || covered < 0.9, `sonar cover foils launches (${(bold * 100).toFixed(0)}% -> ${(covered * 100).toFixed(0)}%)`);
  check(held < bold * 0.8, `a held boat is cautious (${(held * 100).toFixed(0)}% vs ${(bold * 100).toFixed(0)}%)`);
  check(shadowed < bold * 0.8, `a shadowed boat is cautious (${(shadowed * 100).toFixed(0)}%)`);
  console.log(`warship strike within 25 days: unheard ${(bold * 100).toFixed(0)}% · sonar cover ${(covered * 100).toFixed(0)}% · held ${(held * 100).toFixed(0)}% · shadowed ${(shadowed * 100).toFixed(0)}%`);
  const r = trial(false, 'UNHELD', 3);
  if (r.struck) {
    const c = r.w.contacts.find((x) => x.id === r.c.id);
    check(!c || (c.cls === 'HOSTILE' && (c.track ?? 0) >= 60 && (c.attacks ?? 0) >= 1), 'the launch reveals the boat: identified hostile on a fresh datum');
    check(r.w.stats.shipsLost + Object.values(r.w.ships).filter((x) => x.integrity < 100).length >= 1, 'a ship was hit');
  }
  // two attacks and it breaks off
  const { w } = s3world('S3-B');
  w.scripted = true;
  const c = subContact(w);
  w.contacts.push(c);
  afterAttack(w, c);
  check(c.nextAttackTick === w.tick + 7 && c.cls === 'HOSTILE', 'cooldown after a launch');
  afterAttack(w, c);
  check(c.expiresTick <= w.tick + 2, 'after its second attack it breaks off');
}

// ---- lane ships: torpedoed, or saved by sonar cover
{
  const shipBase = createInitialWorld('S3-SHIP', 'CORRIDOR');
  shipBase.scripted = false;
  for (let d = 0; d < 60 && shipBase.shipping.ships.length < 3; d++) advanceDay(shipBase);
  const trial = (cover: boolean, seed: number) => {
    const w = copyOf(shipBase);
    w.contacts = [];
    if (w.shipping.ships.length === 0) return null;
    const m = w.shipping.ships[seed % w.shipping.ships.length];
    const tf = allTaskForces(w.fleets)[0];
    tf.position = { x: -400, y: -400 };
    if (cover) {
      const ship = createShip({ id: `COV-${uid++}`, name: 'Cover', pennant: 'F98', hullId: 'FRIGATE', designName: 'T', moduleIds: ASW_FRIGATE, constructing: false, state: 'ACTIVE_PATROL', readiness: 100, tick: w.tick });
      w.ships[ship.id] = ship;
      tf.squadrons[0].shipIds.push(ship.id);
      tf.position = { x: m.position.x + 2, y: m.position.y };
    }
    const c = subContact(w, { position: { x: m.position.x + 1, y: m.position.y }, sectorId: w.map.sectorGrid[Math.round(m.position.y) * w.map.width + Math.round(m.position.x)] });
    w.contacts.push(c);
    w.events = [];
    tickShipping(w, new Rng(`ms${seed}`));
    const hit = w.events.some((e) => /torpedoed/.test(e.text));
    const foiled = w.events.some((e) => /torpedo launch/.test(e.text));
    return { hit, foiled, attacks: c.attacks ?? 0, revealed: c.cls === 'HOSTILE', risk: w.shipping.lanes.reduce((a, l) => a + l.risk, 0) };
  };
  const rs = Array.from({ length: 40 }, (_, i) => trial(false, i)).filter((x) => x);
  const cs = Array.from({ length: 40 }, (_, i) => trial(true, i)).filter((x) => x);
  check(rs.length > 20, `merchant ships exist to attack (${rs.length} trials)`);
  check(rs.every((r) => r!.hit && r!.attacks === 1 && r!.revealed), 'with no cover every launch lands and reveals the boat');
  const foiled = cs.filter((r) => r!.foiled).length / Math.max(1, cs.length);
  check(foiled > 0.3, `sonar cover foils a good share of launches (${(foiled * 100).toFixed(0)}%)`);
  check(cs.every((r) => r!.foiled || r!.hit), 'every launch is either foiled or lands');
}

// ---- the ladder against a held submarine
{
  const mk = (over: Partial<Contact> = {}, roe: 'RETURN_FIRE' | 'WEAPONS_FREE' = 'RETURN_FIRE', sonar = true) => {
    const { w, tf } = s3world('S3-L', sonar);
    w.scripted = true;
    w.sectors[0].roe = roe;
    const c = subContact(w, { track: 95, position: { x: tf.position.x + 2, y: tf.position.y }, ...over });
    w.contacts.push(c);
    return { w, c, tf };
  };
  const { w, c } = mk();
  check(!!actionBlocked(c, 'WEAPONS_FREE', 'HAIL') && !!actionBlocked(c, 'WEAPONS_FREE', 'BOARD'), 'a submerged contact cannot be hailed or boarded');
  check(actionBlocked(c, 'WEAPONS_FREE', 'WARN') === null && actionBlocked(c, 'WEAPONS_FREE', 'SHADOW') === null, 'it can be pinged and shadowed');
  check(!!actionBlocked(c, 'RETURN_FIRE', 'ENGAGE') && actionBlocked(c, 'WEAPONS_FREE', 'ENGAGE') === null, 'an unidentified boat cannot be engaged under RETURN FIRE, only at WEAPONS FREE');
  c.cls = 'HOSTILE';
  check(actionBlocked(c, 'RETURN_FIRE', 'ENGAGE') === null, 'a boat that has attacked can be engaged at RETURN FIRE');
  const datum = subContact(w, { track: 50 });
  check(!!actionBlocked(datum, 'WEAPONS_FREE', 'WARN'), 'a datum is not a target');
  check(sopAction(subContact(w, { track: 95 }), 'CHALLENGE', 10) === 'WARN' && sopAction(subContact(w, { track: 95 }), 'OBSERVE', 10) === null && sopAction(subContact(w, { track: 95 }), 'CHALLENGE', 30) === null, 'CHALLENGE pings a held submarine in range; OBSERVE never; never hail');
  check(!cmd.orderContact(mk({}, 'WEAPONS_FREE', false).w, 'x', 'ENGAGE').ok, 'orders against a missing contact fail');

  // order validation needs ASW weapons in reach
  const none = copyOf(S3_BASE);
  none.contacts = [];
  const lone = subContact(none, { track: 95, cls: 'HOSTILE', position: { x: -300, y: -300 } });
  none.contacts.push(lone);
  none.sectors[0].roe = 'WEAPONS_FREE';
  check(!cmd.orderContact(none, lone.id, 'ENGAGE').ok, 'ENGAGE is refused with no ASW weapon in reach');

  // outcomes over many trials
  const run = (hostile: boolean, order: 'WARN' | 'ENGAGE', boat: boolean, seed: number) => {
    const { w, c, tf } = mk({ hostile, cls: hostile ? 'HOSTILE' : 'UNKNOWN', strength: 70, stealth: 55 }, 'WEAPONS_FREE', !boat);
    if (boat) addBoat(w, tf, 'SUB_SEORAK'); // the surface force carries out the order; the boat adds its torpedoes
    c.order = order;
    w.tick = 500;
    const incidents0 = w.stats.incidents;
    tickContacts(w, new Rng(`ld${seed}`), new Set());
    return { gone: !w.contacts.some((x) => x.id === c.id), killed: (w.stats.subsSunk ?? 0) > 0, incident: w.stats.incidents > incidents0, w };
  };
  const frac = (f: (i: number) => boolean) => Array.from({ length: 200 }, (_, i) => f(i)).filter(Boolean).length / 200;
  const warnHostile = frac((i) => run(true, 'WARN', false, i).gone);
  const warnForeign = frac((i) => run(false, 'WARN', false, i).gone);
  check(warnHostile > 0.5 && warnHostile < 0.8, `most hostile boats leave when pinged (${(warnHostile * 100).toFixed(0)}%)`);
  check(warnForeign > 0.8, `foreign boats nearly always leave (${(warnForeign * 100).toFixed(0)}%)`);
  const killSurface = frac((i) => run(true, 'ENGAGE', false, i).killed);
  const killBoat = frac((i) => run(true, 'ENGAGE', true, i).killed);
  check(killBoat > killSurface + 0.1, `a boat's heavyweight torpedoes on top of the ships' tubes raise the kill rate (${(killBoat * 100).toFixed(0)}% vs ${(killSurface * 100).toFixed(0)}%)`);
  check(Math.abs(killChance(60, 70).kill - 60 / (60 + 280)) < 1e-9 && killChance(1e6, 70).kill <= 0.85 && killChance(0.1, 70).kill >= 0.05, 'kill chance is bounded');
  check(frac((i) => run(false, 'ENGAGE', false, i).incident) === 1, 'torpedoing a foreign submarine is always an incident');
  console.log(`ladder: ping hostile ${(warnHostile * 100).toFixed(0)}% · ping foreign ${(warnForeign * 100).toFixed(0)}% · kill with the ships' tubes ${(killSurface * 100).toFixed(0)}% · with a boat ${(killBoat * 100).toFixed(0)}%`);
}

// ---- a boat is a sonar platform: the first reason to field them
{
  const { w, tf } = s3world('S3-Q');
  for (const id of taskForceShipIds(tf)) delete w.ships[id];
  tf.squadrons.forEach((q) => (q.shipIds = []));
  addBoat(w, tf, 'SUB_KB');
  const c = subContact(w, { position: { x: tf.position.x + 4, y: tf.position.y } });
  let d = 0;
  while (visibilityOf(c) !== 'HELD' && d++ < 12) trackStep(w, c, sonarPlatforms(w));
  check(d <= 8, `a quiet boat's sonar holds a contact (${d} days)`);
  const copy = JSON.parse(JSON.stringify(c));
  check(copy.submerged === true && copy.track === c.track && copy.stealth === c.stealth, 'submarine contacts survive a save round trip');
}

// =========================================================================================================== S4: packages, training, licences, S26T
import { SUB_PACKAGES } from '../lib/data/catalog';
import { diligenceBlocked, embeddedInFleet, fleetExposure, hullOriginView } from '../lib/sim/supplyChain';
import { LICENSED_DAYS_RATE, LICENSED_HULL_RATE, LICENCE_MONEY, TRAINING_DAYS, TRAINING_RATE, isLicensed, licenceBlocked, negotiateLicence, orderTerms } from '../lib/sim/licences';

const DOM_BOAT = ['PP_SUB_DOM_DE', 'CMS_DOM_OB1', 'SEN_SONAR_SUB_DOM', 'ARM_SUB_DOM_HWT'];
const S4_BASE = createInitialWorld('S4-BASE', 'CORRIDOR');
const s4 = () => {
  const w = copyOf(S4_BASE);
  w.scripted = true;
  w.resources.budget = 9000;
  w.resources.politicalCapital = 50;
  w.resources.industrialCapacity = 6;
  for (const id of ['SEORAK', 'KESSLER_BRANDT', 'DAHAI'] as const) {
    w.vendors[id].rung = 'STRATEGIC';
    w.vendors[id].standing = 95;
    w.vendors[id].status = 'ACTIVE';
    w.vendors[id].closed = false;
  }
  return w;
};
const order = (w: WorldDraft, hull: HullClassId, ids: string[]) => cmd.orderShip(w, { designName: 'T', hullId: hull, moduleIds: ids, squadronId: 'SQ-1-1', tradition: 'VIRTUES' });
const lastShip = (w: WorldDraft) => Object.values(w.ships).filter((x) => x.contract).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })).pop()!;

// ---- vendor packages are valid designs from the builder
for (const d of SUB_PACKAGES) {
  const e = ev(d.hullId, d.moduleIds);
  check(e.valid && e.powerMarginMW >= 0, `package ${d.name} is valid (${e.errors.join('; ')})`);
  check(e.sonarKm > 0 && e.stealth > 30, `package ${d.name} has sonar and some stealth`);
  const builder = HULLS[d.hullId].vendorId;
  check(d.moduleIds.filter((m) => MODULES.find((x) => x.id === m)!.vendorId === builder).length >= 3, `package ${d.name} is mostly the builder's kit`);
}
check(SUB_PACKAGES.length === 3 && new Set(SUB_PACKAGES.map((d) => d.hullId)).size === 3, 'one package per family');

// ---- first-of-class crew training
{
  const w = s4();
  const base = ev('SUB_KB', KB_AIP).cost;
  const t1 = orderTerms(w, 'SUB_KB', base);
  check(Math.abs(t1.trainingCost - base * TRAINING_RATE) < 1e-6 && t1.trainingDays === TRAINING_DAYS && t1.days === HULLS.SUB_KB.buildDays + TRAINING_DAYS && !t1.licensed, 'the first boat of a family carries a training package');
  const b0 = w.resources.budget;
  const r = order(w, 'SUB_KB', KB_AIP);
  check(r.ok, `first KB boat laid down (${r.reason})`);
  const s = lastShip(w);
  check(Math.abs((s.contract?.price ?? 0) - t1.price) < 1e-6 && s.buildTotalDays === t1.days, 'the contract carries the training cost and days');
  check(Math.abs(b0 - w.resources.budget - t1.price * 0.3) < 1e-6, 'the deposit is on the full price');
  check(w.stats.boatFamilies?.includes('SUB_KB') === true, 'the family is recorded');
  const t2 = orderTerms(w, 'SUB_KB', base);
  check(t2.trainingDays === 0 && t2.price === base && t2.days === HULLS.SUB_KB.buildDays, 'later boats of the family skip training');
  check(order(w, 'SUB_KB', KB_AIP).ok && lastShip(w).buildTotalDays === HULLS.SUB_KB.buildDays, 'a second boat is built in the normal time');
  check(orderTerms(w, 'SUB_SEORAK', 400).trainingDays === TRAINING_DAYS, 'another family still needs its own training');
  check(orderTerms(w, 'FRIGATE', 300).trainingDays === 0 && orderTerms(w, 'FRIGATE', 300).price === 300, 'surface ships have no training package');
  const p = pv.previewOrderShip(w, { hullId: 'SUB_SEORAK', moduleIds: SEORAK_AIP, squadronId: 'SQ-1-1' });
  check(/first of class/.test(p), 'the preview names the training package');
}

// ---- licensed production
{
  const w = s4();
  w.vendors.SEORAK.rung = 'SIGNED';
  check(/STRATEGIC/.test(licenceBlocked(w, 'SEORAK', 'SUB_SEORAK') ?? ''), 'only a strategic partner licenses a hull');
  w.vendors.SEORAK.rung = 'STRATEGIC';
  check(!!licenceBlocked(w, 'KESSLER_BRANDT', 'SUB_SEORAK'), 'a vendor licenses only its own hulls');
  w.resources.politicalCapital = 1;
  check(/POLITICAL CAPITAL/.test(licenceBlocked(w, 'SEORAK', 'SUB_SEORAK') ?? ''), 'a licence costs political capital');
  w.resources.politicalCapital = 50;
  w.resources.budget = LICENCE_MONEY - 1;
  check(/M/.test(licenceBlocked(w, 'SEORAK', 'SUB_SEORAK') ?? ''), 'and money');
  w.resources.budget = 9000;
  w.vendors.SEORAK.status = 'FROZEN';
  check(!!licenceBlocked(w, 'SEORAK', 'SUB_SEORAK'), 'no licence while the vendor is sanctioned');
  w.vendors.SEORAK.status = 'ACTIVE';
  const pc0 = w.resources.politicalCapital;
  check(negotiateLicence(w, 'SEORAK', 'SUB_SEORAK').ok && isLicensed(w, 'SUB_SEORAK') && w.resources.politicalCapital < pc0 && w.resources.budget === 9000 - LICENCE_MONEY, 'a licence is signed and paid for');
  check(licenceBlocked(w, 'SEORAK', 'SUB_SEORAK') === 'ALREADY LICENSED', 'once');
  const base = ev('SUB_SEORAK', SEORAK_AIP).cost;
  const t = orderTerms(w, 'SUB_SEORAK', base);
  check(t.licensed && Math.abs(t.hullSaving - HULLS.SUB_SEORAK.cost * (1 - LICENSED_HULL_RATE)) < 1e-6 && t.price < base * (1 + TRAINING_RATE), 'a licensed hull is cheaper');
  check(t.days === Math.round(HULLS.SUB_SEORAK.buildDays * LICENSED_DAYS_RATE) + TRAINING_DAYS, 'and slower');
  const shares = contractShares('SUB_SEORAK', DOM_BOAT, true);
  check((shares.DOMESTIC_YARDS ?? 0) > 0.8 && !shares.SEORAK, 'the domestic yards are paid for a licensed hull');

  // the vendor going cold does not stop the licensed order; the unlicensed one is stopped
  w.vendors.SEORAK.rung = 'CONTACT';
  const lic = order(w, 'SUB_SEORAK', DOM_BOAT);
  check(lic.ok, `a licensed hull can be ordered with all-domestic kit even after the relationship cools (${lic.reason})`);
  const ship = lastShip(w);
  check(ship.licensed === true && ship.buildTotalDays === t.days, 'the ship is marked licensed and takes the licensed build time');

  // freeze immunity: the vendor's export freeze does not stall a licensed hull, a revocation does
  w.vendors.SEORAK.status = 'FROZEN';
  w.sanctions.push({ id: 'S4', vendorId: 'SEORAK', kind: 'EXPORT_FREEZE', startTick: w.tick, endTick: w.tick + 90 });
  syncConstructionFreezes(w);
  check(ship.frozenBy === null, 'a licensed hull is immune to its vendor\'s export freeze');
  w.vendors.SEORAK.status = 'REVOKED';
  syncConstructionFreezes(w);
  check(ship.frozenBy === 'SEORAK', 'but not to a revoked licence');
  const wu = s4();
  order(wu, 'SUB_SEORAK', DOM_BOAT);
  const unl = lastShip(wu);
  wu.vendors.SEORAK.status = 'FROZEN';
  wu.sanctions.push({ id: 'S4u', vendorId: 'SEORAK', kind: 'EXPORT_FREEZE', startTick: wu.tick, endTick: wu.tick + 90 });
  syncConstructionFreezes(wu);
  check(unl.frozenBy === 'SEORAK' && !unl.licensed, 'an unlicensed boat is stalled by the same freeze');
}

// ---- the S26T case: a cheap hull with a hidden engine supplier
{
  const w = s4();
  const DH = SUB_PACKAGES.find((d) => d.hullId === 'SUB_DAHAI')!.moduleIds;
  check(hullOriginView(w, 'SUB_DAHAI').known.length === 0 && !hullOriginView(w, 'SUB_DAHAI').verified, 'the Dahai hull shows no hidden supplier before due diligence');
  const r = order(w, 'SUB_DAHAI', DH);
  check(r.ok, `a Dahai boat can be bought (${r.reason})`);
  const ship = lastShip(w);
  check(embeddedInFleet(w, 'KESSLER_BRANDT'), 'Kessler-Brandt is embedded in the fleet through the Dahai hull and engine');
  syncConstructionFreezes(w);
  check(ship.frozenBy === null, 'no stall while Kessler-Brandt is active');
  w.vendors.KESSLER_BRANDT.status = 'FROZEN';
  w.sanctions.push({ id: 'S26', vendorId: 'KESSLER_BRANDT', kind: 'EXPORT_FREEZE', startTick: w.tick, endTick: w.tick + 120 });
  syncConstructionFreezes(w);
  check(ship.frozenBy === 'KESSLER_BRANDT', 'a sanction on Kessler-Brandt stalls the Dahai-built boat (S26T)');
  const t = cancellationTerms(w, ship);
  check(t.lines.some((l) => l.vendorId === 'DAHAI' && l.basis === 'FAULT'), 'the builder refunds as the party that cannot deliver');
  check(!!hullBlockedFor(w), 'a new unlicensed Dahai order is refused while the engine supplier is frozen');
  // the licence shields only the builder, not its engine supplier
  w.vendors.DAHAI.licences = ['SUB_DAHAI'];
  check(/COMPONENT/.test(hullBlocked('SUB_DAHAI', w.vendors, new Set(w.research.completed), true) ?? ''), 'a licensed Dahai hull is still stopped by the engine supplier');
  // diligence reveals the hidden supplier
  const w2 = s4();
  w2.vendors.DAHAI.diligence = { startTick: 0, readyTick: 1, done: true };
  const hv = hullOriginView(w2, 'SUB_DAHAI');
  check(hv.verified && hv.known.join() === 'KESSLER_BRANDT', 'due diligence on the builder reveals the hidden engine supplier');
  w2.ships.X = createShip({ id: 'X', name: 'X', pennant: 'S1', hullId: 'SUB_DAHAI', designName: 'T', moduleIds: DH, constructing: false, tick: 0 });
  check((fleetExposure(w2).byVendor.KESSLER_BRANDT?.via ?? 0) >= 1, 'fleet exposure counts the hidden dependency once it is known');
  void diligenceBlocked;
}
function hullBlockedFor(w: WorldDraft) {
  return hullBlocked('SUB_DAHAI', w.vendors, new Set(w.research.completed), false);
}

// =========================================================================================================== S5: no invisible soft-locks
{
  const w = copyOf(S3_BASE);
  w.scripted = false;
  w.tension = 45;
  for (const st of Object.values(w.sectors)) st.threat = 60;
  w.contacts = [];
  let maxLive = 0;
  let maxAge = 0;
  let seenIds = new Set<string>();
  for (let d = 0; d < 2500; d++) {
    w.tick = 300 + d;
    tickContacts(w, new Rng(`soft${d}`), new Set());
    const subs = w.contacts.filter((c) => c.submerged);
    maxLive = Math.max(maxLive, subs.length);
    for (const c of subs) {
      seenIds.add(c.id);
      maxAge = Math.max(maxAge, w.tick - c.bornTick);
    }
    if (w.contacts.length > 20) w.contacts = w.contacts.filter((c) => c.submerged);
  }
  check(seenIds.size > 30, `submarines keep appearing in a long game (${seenIds.size} in 2500 days)`);
  check(maxLive <= 2, `never more than two at once (${maxLive})`);
  check(maxAge <= 47, `every submarine leaves on its own: none outlives its patrol (oldest ${maxAge} days)`);
  console.log(`soft-lock soak: ${seenIds.size} boats over 2500 days, at most ${maxLive} at once, oldest ${maxAge} days`);
  // an attacking boat is bounded too: two launches and gone
  const { w: aw } = s3world('S3-END');
  aw.scripted = true;
  const c = subContact(aw, { expiresTick: aw.tick + 30 });
  aw.contacts.push(c);
  for (let d = 0; d < 40; d++) {
    aw.tick += 1;
    tickContacts(aw, new Rng(`end${d}`), new Set());
  }
  check(!aw.contacts.some((x) => x.id === c.id), 'a hidden submarine with nothing to attack simply expires');
}

if (failures) {
  console.log(`\nSUBS FAILED (${failures})`);
  process.exit(1);
}
console.log('SUBS OK (S1 data and designer, S2 service, S3 enemy submarines and ASW, S4 packages, training, licences, S5 soft-lock soak)');

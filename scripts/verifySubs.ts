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
  check(!SUBMARINE_SERVICE ? !r.ok : true, 'no boats can be laid down before S2');
  for (const m of MODULES.filter((x) => modulePlatform(x) === 'SUBSURFACE')) check(typeof procurability(m, w.vendors, done).ok === 'boolean', `${m.id} has a procurability verdict`);
}

if (failures) {
  console.log(`\nSUBS FAILED (${failures})`);
  process.exit(1);
}
console.log('SUBS OK (S1: data and designer)');

/**
 * Contractors phase 2: hidden sub-suppliers, due diligence, sanctions reaching through components. Usage: npm run verify:supply
 */
import { MODULE_BY_ID, MODULES } from '../lib/data/catalog';
import * as cmd from '../lib/sim/commands';
import { procurability } from '../lib/sim/designEngine';
import { moduleSpareUseBlocked, syncConstructionFreezes } from '../lib/sim/diplomacyEngine';
import { takeSpare } from '../lib/sim/fleetEngine';
import { createInitialWorld } from '../lib/sim/scenario';
import { DILIGENCE_COST, DILIGENCE_DAYS, fleetExposure, originView } from '../lib/sim/supplyChain';
import { advanceDay } from '../lib/sim/worldEngine';
import type { WorldDraft } from '../lib/types/world';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};
const world = (seed: string, scripted = true): WorldDraft => {
  const w = createInitialWorld(seed, 'CORRIDOR');
  w.scripted = scripted;
  w.resources.politicalCapital = 60;
  w.resources.budget = 5000;
  return w;
};
const days = (w: WorldDraft, n: number) => {
  for (let i = 0; i < n; i++) advanceDay(w);
};
const done = new Set<string>();
const log = (w: WorldDraft) => w.events.map((e) => e.text).join('\n');
/** A corvette whose only foreign part is the Seorak turbine pack (which hides Kessler-Brandt gear). */
const ST30_CORVETTE = ['PP_SK_ST30', 'CMS_DOM_OB1', 'SEN_DOM_DSR2', 'ARM_DOM_GUN76'];
function layDown(w: WorldDraft, moduleIds = ST30_CORVETTE) {
  w.vendors.SEORAK.rung = 'SIGNED';
  w.vendors.SEORAK.standing = 60;
  const before = new Set(Object.keys(w.ships));
  const r = cmd.orderShip(w, { designName: 'X', hullId: 'CORVETTE', moduleIds, squadronId: 'SQ-1-1', tradition: 'VIRTUES' });
  check(r.ok, `lay down: ${r.reason}`);
  return Object.values(w.ships).find((s) => !before.has(s.id))!;
}

// ---- data: origins are real foreign vendors, never the prime, never domestic kit, never hinted in blurbs
for (const m of MODULES) {
  for (const o of m.origins ?? []) {
    check(o !== m.vendorId, `${m.id}: origin is its own prime`);
    check(o !== 'DOMESTIC_YARDS', `${m.id}: domestic origin`);
    check(!m.blurb.includes(`:${o}}`), `${m.id}: blurb names its hidden origin`);
  }
  if (m.vendorId === 'DOMESTIC_YARDS') check(!m.origins?.length, `${m.id}: domestic kit must have no hidden origins`);
}
check(MODULES.filter((m) => m.origins?.length).length >= 4, 'at least four hidden sub-supplier links');

// ---- no leak by absence: unverified modules look identical whether or not they hide something
{
  const w = world('leak');
  const hides = originView(w, MODULE_BY_ID.SEN_ASEL_SPEAR);
  const clean = originView(w, MODULE_BY_ID.CMS_NG_TACTICOS);
  check(JSON.stringify(hides) === JSON.stringify(clean) && !hides.verified && hides.known.length === 0, 'unverified views are indistinguishable');
  check(originView(w, MODULE_BY_ID.PP_DOM_D12).verified, 'domestic kit is verified');
}

// ---- due diligence
{
  const w = world('diligence');
  check(!cmd.dueDiligenceCmd(w, 'DOMESTIC_YARDS').ok, 'no diligence on domestic yards');
  check(!cmd.dueDiligenceCmd(w, 'KESSLER_BRANDT').ok, 'no diligence on an unknown supplier');
  const b0 = w.resources.budget;
  check(cmd.dueDiligenceCmd(w, 'SEORAK').ok, 'diligence on a contact vendor starts');
  check(Math.abs(w.resources.budget - (b0 - DILIGENCE_COST)) < 1e-6, `diligence costs ${DILIGENCE_COST}M`);
  check(!cmd.dueDiligenceCmd(w, 'SEORAK').ok, 'one audit at a time');
  days(w, DILIGENCE_DAYS - 1);
  check(!w.vendors.SEORAK.diligence?.done && originView(w, MODULE_BY_ID.PP_SK_ST30).known.length === 0, 'nothing revealed before the report');
  days(w, 1);
  check(!!w.vendors.SEORAK.diligence?.done, 'report lands after the audit period');
  check(originView(w, MODULE_BY_ID.PP_SK_ST30).known.join() === 'KESSLER_BRANDT', 'reveals the hidden engine supplier');
  check(originView(w, MODULE_BY_ID.CMS_SK_SHIELD).verified && originView(w, MODULE_BY_ID.CMS_SK_SHIELD).known.length === 0, 'clean products verified clean');
  check(w.vendors.KESSLER_BRANDT.rung === 'CONTACT', 'an unknown sub-supplier becomes a contact');
  check(/DUE DILIGENCE: \{v:SEORAK\}.*\{m:PP_SK_ST30\} contains \{v:KESSLER_BRANDT\}/.test(log(w)), 'report names the product and its sub-supplier');
  check(!cmd.dueDiligenceCmd(w, 'SEORAK').ok, 'no second audit');

  check(cmd.dueDiligenceCmd(w, 'NORDVIK').ok, 'audit Nordvik');
  days(w, DILIGENCE_DAYS);
  check(originView(w, MODULE_BY_ID.ARM_NV_RB15).known.join() === 'NAVAL_GROUP_THALES', 'Nordvik missile contains Meridian parts');
}

// ---- sanctions reach through components
{
  const w = world('freeze');
  const ship = layDown(w);
  check(ship.buildStatus === 'CONSTRUCTING' && !ship.frozenBy, 'corvette under construction');
  const kb = w.vendors.KESSLER_BRANDT;
  kb.status = 'FROZEN';
  kb.statusUntilTick = w.tick + 60;
  w.sanctions.push({ id: 'SAN-T', vendorId: 'KESSLER_BRANDT', kind: 'EXPORT_FREEZE', startTick: w.tick, endTick: w.tick + 60 });
  syncConstructionFreezes(w);
  check(ship.frozenBy === 'KESSLER_BRANDT', 'a sub-supplier freeze stalls construction');
  const p = procurability(MODULE_BY_ID.PP_SK_ST30, w.vendors, done);
  check(!p.ok && /COMPONENT FREEZE/.test(p.reason ?? ''), `new orders blocked by the component freeze (${p.reason})`);
  check(procurability(MODULE_BY_ID.CMS_SK_SHIELD, w.vendors, done).ok, 'the prime’s other products are unaffected');
  days(w, 1);
  check(!!kb.chainExposed && originView(w, MODULE_BY_ID.PP_SK_ST30).known.includes('KESSLER_BRANDT'), 'a sanction makes the component link public');
  const idx = ship.modules.findIndex((m) => m.moduleId === 'PP_SK_ST30');
  check(cmd.substituteModule(w, ship.id, idx, 'PP_DOM_D12').ok && !ship.frozenBy, 'substituting the part un-stalls the hull');
}
{
  const w = world('embargo');
  w.spares.PP_SK_ST30 = 2;
  w.vendors.KESSLER_BRANDT.status = 'FROZEN';
  w.sanctions.push({ id: 'SAN-E', vendorId: 'KESSLER_BRANDT', kind: 'PARTS_EMBARGO', startTick: w.tick, endTick: w.tick + 60 });
  check(moduleSpareUseBlocked(w, 'PP_SK_ST30') && !moduleSpareUseBlocked(w, 'CMS_SK_SHIELD'), 'a sub-supplier parts embargo blocks fitting stock');
  w.policy.autoSpares = false;
  check(takeSpare(w, 'PP_SK_ST30') === null && w.spares.PP_SK_ST30 === 2, 'embargoed stock stays on the shelf');
}

// ---- an unknown sub-supplier inside our hulls can sanction us, but always warns first and exposes the link
{
  let warned = 0;
  let foreshadowed = 0;
  for (let s = 0; s < 12; s++) {
    const w = world(`embedded-${s}`, false);
    layDown(w);
    const kb = w.vendors.KESSLER_BRANDT;
    kb.standing = 0;
    for (let d = 0; d < 1500 && kb.status === 'ACTIVE'; d++) {
      w.tension = 100;
      advanceDay(w);
    }
    if (kb.status !== 'WARNING') continue;
    warned++;
    const leak = originView(w, MODULE_BY_ID.PP_SK_ST30).known.includes('KESSLER_BRANDT');
    if (kb.chainExposed && kb.rung === 'CONTACT' && leak && (kb.statusUntilTick ?? 0) - w.tick >= 19) foreshadowed++;
    check(/SUPPLY CHAIN: \{v:KESSLER_BRANDT\} components sit inside .*\{m:PP_SK_ST30\}/.test(log(w)), 'warning names the affected products');
    check(cmd.lobbyVendorCmd(w, 'KESSLER_BRANDT', 'MIN_FOREIGN').ok || w.politics.support < 25, 'the exposed sub-supplier can be lobbied');
  }
  console.log(`embedded sub-supplier: ${warned}/12 theatres warned, ${foreshadowed} foreshadowed`);
  check(warned >= 8, `embedded sub-supplier signals sanctions at high tension (${warned}/12)`);
  check(foreshadowed === warned, `every warning exposed the link with the full notice period (${foreshadowed}/${warned})`);

  // Not embedded: an unknown vendor never acts.
  const w = world('not-embedded', false);
  for (let d = 0; d < 600; d++) {
    w.tension = 100;
    advanceDay(w);
  }
  check(w.vendors.KESSLER_BRANDT.status === 'ACTIVE' && w.vendors.KESSLER_BRANDT.rung === 'UNKNOWN', 'an unknown vendor with no parts in the fleet never sanctions');
}

// ---- exposure summary
{
  const w = world('exposure');
  layDown(w);
  const e0 = fleetExposure(w);
  check(e0.unverifiedShips >= 1 && e0.unverifiedModules.includes('PP_SK_ST30') && !e0.byVendor.KESSLER_BRANDT, 'hidden link counted as unverified only');
  cmd.dueDiligenceCmd(w, 'SEORAK');
  days(w, DILIGENCE_DAYS);
  const e1 = fleetExposure(w);
  check((e1.byVendor.KESSLER_BRANDT?.via ?? 0) >= 1 && !e1.unverifiedModules.includes('PP_SK_ST30'), 'after diligence the link shows as exposure via components');
}

console.log(failures === 0 ? '\nSUPPLY OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

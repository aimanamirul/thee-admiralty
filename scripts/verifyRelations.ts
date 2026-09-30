/**
 * Contractors phase 1: relationship ladder, regimes, bloc affinity, open-architecture CMS. Usage: npm run verify:relations
 */
import { MODULE_BY_ID } from '../lib/data/catalog';
import * as cmd from '../lib/sim/commands';
import { evaluateLoadout, procurability } from '../lib/sim/designEngine';
import { advanceBlocked, REGIMES, rollSanctionKind, sanctionRiskPerDay, sellableTier, tickRelations } from '../lib/sim/relationsEngine';
import { createInitialWorld } from '../lib/sim/scenario';
import { advanceDay } from '../lib/sim/worldEngine';
import type { VendorId } from '../lib/types/diplomacy';
import type { WorldDraft } from '../lib/types/world';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};
const quiet = (seed: string): WorldDraft => {
  const w = createInitialWorld(seed, 'CORRIDOR');
  w.scripted = true;
  w.resources.politicalCapital = 60;
  w.resources.budget = 5000;
  return w;
};
const days = (w: WorldDraft, n: number) => {
  for (let i = 0; i < n; i++) advanceDay(w);
};
const done = new Set<string>();
const buyable = (w: WorldDraft, id: string) => procurability(MODULE_BY_ID[id], w.vendors, done).ok;

// ---- starting rungs and gating
{
  const w = quiet('rungs');
  check(w.vendors.KESSLER_BRANDT.rung === 'UNKNOWN' && w.vendors.NORDVIK.rung === 'CONTACT' && w.vendors.RAYTHEON.rung === 'FRAMEWORK', 'starting rungs');
  check(!buyable(w, 'CMS_NV_OPEN9'), 'CONTACT: nothing purchasable');
  check(!buyable(w, 'PP_KB_20V'), 'UNKNOWN: nothing purchasable');
  check(!cmd.lobbyVendorCmd(w, 'KESSLER_BRANDT', 'MIN_DEFENCE').ok, 'cannot lobby an unknown supplier');
  w.vendors.RAYTHEON.standing = 90;
  check(sellableTier(w.vendors.RAYTHEON) === 0 && !buyable(w, 'ARM_RTX_MK41'), 'FRAMEWORK sells tier 0 only, whatever the standing');
  check(buyable(w, 'SEN_NG_SMARTS'), 'SIGNED vendor sells by standing tier');
}

// ---- climbing the ladder
{
  const w = quiet('climb');
  const pc0 = w.resources.politicalCapital;
  check(cmd.advanceRelationshipCmd(w, 'NORDVIK').ok, 'contact -> trade mission starts');
  check(w.resources.politicalCapital === pc0 - 8, 'trade mission costs 8 PC');
  check(!!advanceBlocked(w, 'NORDVIK'), 'one step at a time');
  days(w, 15);
  check(w.vendors.NORDVIK.rung === 'TRADE_MISSION', 'trade mission concludes after 15 days');
  w.vendors.NORDVIK.standing = 20;
  check(/NEEDS STANDING 30/.test(advanceBlocked(w, 'NORDVIK') ?? ''), 'framework needs standing 30');
  w.vendors.NORDVIK.standing = 55;
  const b0 = w.resources.budget;
  check(cmd.advanceRelationshipCmd(w, 'NORDVIK').ok, 'framework negotiation starts');
  check(Math.abs(w.resources.budget - (b0 - 40)) < 1e-6, 'framework costs 40M');
  days(w, 25);
  check(w.vendors.NORDVIK.rung === 'FRAMEWORK', 'framework concluded');
  check(!buyable(w, 'CMS_NV_OPEN9'), 'NV-9 is tier 1: not under a framework');
  check(cmd.advanceRelationshipCmd(w, 'NORDVIK').ok, 'signing starts at standing 50+');
  days(w, 30);
  check((w.vendors.NORDVIK.rung as string) === 'SIGNED' && buyable(w, 'CMS_NV_OPEN9'), 'signed: tier-1 lines purchasable at standing 55');
}

// ---- scouting, bloc politics, regimes
{
  const w = quiet('scout');
  check(cmd.scoutSuppliersCmd(w).ok && w.vendors.KESSLER_BRANDT.rung === 'CONTACT', 'scouting reveals the unknown supplier');
  check(!cmd.scoutSuppliersCmd(w).ok, 'nothing left to scout');

  const e = quiet('bloc');
  e.vendors.ZVEZDA_NORD.rung = 'FRAMEWORK';
  const before = { ...Object.fromEntries(Object.values(e.vendors).map((v) => [v.id, v.standing])) } as Record<VendorId, number>;
  check(cmd.advanceRelationshipCmd(e, 'ZVEZDA_NORD').ok, 'eastern signing starts');
  days(e, 30);
  check((e.vendors.ZVEZDA_NORD.rung as string) === 'SIGNED', 'eastern signing concluded');
  check(e.vendors.RAYTHEON.standing <= before.RAYTHEON - 4 + 1e-9 && e.vendors.NAVAL_GROUP_THALES.standing <= before.NAVAL_GROUP_THALES - 4 + 1e-9, 'courting the East costs western standing');
  check(e.vendors.SEORAK.standing === before.SEORAK, 'non-aligned vendors unaffected by bloc politics');

  const v = quiet('incident');
  const s0 = v.vendors.NORDVIK.standing;
  const h0 = v.vendors.NAVAL_GROUP_THALES.standing;
  const incidentsBefore = v.stats.incidents;
  v.stats.incidents += 1; // an incident happened today
  tickRelations(v, incidentsBefore);
  check(v.vendors.NORDVIK.standing === s0 - REGIMES.VINTERLAND.incidentPenalty, `Vinterland regime punishes incidents (${s0} -> ${v.vendors.NORDVIK.standing})`);
  check(v.vendors.NAVAL_GROUP_THALES.standing === h0, 'Aurelle does not care about incidents');

  // Regime mixes: an eastern embargo is common, a Seoryeong revocation rare.
  const count = (id: VendorId, kind: string) => {
    let k = 0;
    for (let i = 0; i < 1000; i++) if (rollSanctionKind(w.vendors[id], i / 1000) === kind) k++;
    return k / 1000;
  };
  check(count('ZVEZDA_NORD', 'PARTS_EMBARGO') > 0.4 && count('SEORAK', 'LICENSE_REVOKED') < 0.1, 'sanction kinds follow the regime mix');
  const r = { tension: 80 };
  const signed = { ...w.vendors.RAYTHEON, rung: 'SIGNED' as const };
  const strategic = { ...signed, rung: 'STRATEGIC' as const };
  check(Math.abs(sanctionRiskPerDay(r, strategic) - sanctionRiskPerDay(r, signed) / 2) < 1e-12, 'strategic partners halve sanction risk');
}

// ---- no sanctions from vendors without a contract (long high-tension soak)
{
  const w = createInitialWorld('no-contract', 'RIMLAND');
  for (let d = 0; d < 1500; d++) {
    w.tension = 95;
    advanceDay(w);
    w.events = [];
  }
  const bad = w.sanctions.filter((s) => ['NORDVIK', 'SEORAK', 'KESSLER_BRANDT'].includes(s.vendorId));
  check(bad.length === 0, `CONTACT/UNKNOWN vendors never sanction (${bad.length})`);
  check(w.sanctions.length > 0, 'contracted vendors do sanction under high tension');
}

// ---- open-architecture CMS
{
  const base = ['PP_DOM_D12', 'SEN_NG_SMARTS', 'ARM_NG_SYLVER8'];
  const closed = evaluateLoadout('FRIGATE', ['CMS_RTX_AEGISLINK', ...base], new Set());
  const open = evaluateLoadout('FRIGATE', ['CMS_NV_OPEN9', ...base], new Set());
  check(Math.abs(open.frictionIndex - closed.frictionIndex / 2) < 1e-9 && open.frictionIndex > 0, `open-architecture CMS halves friction (${closed.frictionIndex} -> ${open.frictionIndex})`);
}

console.log(failures === 0 ? 'RELATIONS OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

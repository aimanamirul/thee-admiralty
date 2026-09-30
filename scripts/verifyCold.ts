/**
 * Contractors phase 5: cold vendors — policy shift (C1), bloc introduction (C2), JV export drive (C3). Usage: npm run verify:cold
 */
import { MODULE_BY_ID } from '../lib/data/catalog';
import { resolveText } from '../lib/data/names';
import * as cmd from '../lib/sim/commands';
import { DAHAI_INTRO_STANDING, EXPORT_DRIVE_NOTICE, exportDriveDay, marketWatch, POLICY_DEBATE_DAYS, policyDebateChance } from '../lib/sim/coldVendors';
import { procurability } from '../lib/sim/designEngine';
import { blocFallout, knownModules, scoutable } from '../lib/sim/relationsEngine';
import { createInitialWorld } from '../lib/sim/scenario';
import { originView } from '../lib/sim/supplyChain';
import { advanceDay } from '../lib/sim/worldEngine';
import type { WorldDraft } from '../lib/types/world';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};
const COLD = ['MITSURUGI', 'DAHAI', 'VAYU_SARATH'] as const;
const world = (seed: string, scripted = false): WorldDraft => {
  const w = createInitialWorld(seed, 'CORRIDOR');
  w.scripted = scripted;
  w.resources.politicalCapital = 60;
  w.resources.budget = 5000;
  return w;
};
const log = (w: WorldDraft) => w.events.map((e) => e.text).join('\n');
const until = (w: WorldDraft, cond: () => boolean, max: number) => {
  for (let d = 0; d < max && !cond(); d++) advanceDay(w);
  return cond();
};

// ---- hidden at start: not scoutable, not counted, not in the designer, never named in the market watch
{
  const w = world('start');
  for (const id of COLD) check(w.vendors[id].closed === true && w.vendors[id].rung === 'UNKNOWN', `${id} starts closed`);
  check(Object.values(w.vendors).filter(scoutable).map((v) => v.id).join() === 'KESSLER_BRANDT', 'only Kessler-Brandt is scoutable at start');
  check(cmd.scoutSuppliersCmd(w).ok && w.vendors.KESSLER_BRANDT.rung === 'CONTACT', 'scout finds Kessler-Brandt');
  check(!cmd.scoutSuppliersCmd(w).ok, 'nothing left to scout while cold vendors are closed');
  check(!knownModules(w).some((m) => (COLD as readonly string[]).includes(m.vendorId)), 'designer hides cold vendors');
  for (const l of marketWatch(w)) for (const id of COLD) check(!l.includes(`{v:${id}}`), `market watch names hidden ${id}`);
}

// ---- C1: policy shift, foreshadowed; an incident during the debate sinks the vote
{
  const w = world('akitsu');
  const mh = w.vendors.MITSURUGI;
  check(until(w, () => !!mh.opening, 3000), 'a debate is eventually announced');
  const vote = mh.opening!.tick;
  check(vote - w.tick === POLICY_DEBATE_DAYS && new RegExp(`vote on day ${vote}`).test(log(w)), 'debate announced with its vote day');
  check(marketWatch(w).some((l) => l.includes(`day ${vote}`)), 'market watch shows the vote');
  const clean = structuredClone({ ...w, map: undefined }) as unknown as WorldDraft;
  clean.map = w.map;
  // incident branch
  w.stats.incidents++;
  w.stats.lastIncidentTick = w.tick;
  until(w, () => w.tick >= vote, POLICY_DEBATE_DAYS + 1);
  check(mh.closed === true && !mh.opening && /reform voted down/.test(log(w)), 'an incident before the vote sinks it');
  // clean branch (same world, no incident)
  until(clean, () => clean.tick >= vote, POLICY_DEBATE_DAYS + 1);
  check(clean.vendors.MITSURUGI.closed === false && clean.vendors.MITSURUGI.rung === 'CONTACT', 'a clean record passes the vote: Mitsurugi becomes a contact');
  const base = policyDebateChance({ ...clean, stats: { ...clean.stats, lastIncidentTick: undefined } });
  const recent = policyDebateChance({ ...clean, stats: { ...clean.stats, lastIncidentTick: clean.tick } });
  check(recent < base / 2, 'a recent incident makes a debate much less likely');
  const fresh = world('akitsu-fresh');
  fresh.vendors.MITSURUGI.closed = false;
  fresh.vendors.MITSURUGI.rung = 'CONTACT';
  check(originView(fresh, MODULE_BY_ID.ARM_MH_VLS16).known.length === 0, 'Mitsurugi launcher hides its Halberd parts until due diligence');
}

// ---- C2: introduction through the Eastern bloc
{
  const w = world('dahai');
  const zv = w.vendors.ZVEZDA_NORD;
  zv.standing = DAHAI_INTRO_STANDING - 1;
  advanceDay(w);
  check(w.vendors.DAHAI.closed === true, 'no introduction below the standing threshold');
  zv.standing = 90;
  zv.rung = 'FRAMEWORK';
  advanceDay(w);
  check(w.vendors.DAHAI.closed === true, 'no introduction below a Signed relationship');
  zv.rung = 'SIGNED';
  advanceDay(w);
  check(w.vendors.DAHAI.rung === 'CONTACT' && /introduces \{v:DAHAI\}/.test(log(w)), 'Zvezda-Nord introduces Dahai');
  const fallout = blocFallout(w, w.vendors.DAHAI);
  check(fallout.some((f) => f.id === 'RAYTHEON') && fallout.every((f) => f.loss > 0), 'courting Dahai costs western standing');
  // lobbying Zvezda is the player's lever
  const w2 = world('dahai-lobby');
  w2.vendors.ZVEZDA_NORD.standing = 60;
  for (let i = 0; i < 3 && w2.vendors.ZVEZDA_NORD.standing < DAHAI_INTRO_STANDING; i++) cmd.lobbyVendorCmd(w2, 'ZVEZDA_NORD', 'MIN_FOREIGN');
  advanceDay(w2);
  check(w2.vendors.DAHAI.rung === 'CONTACT', 'lobbying Zvezda-Nord opens the introduction');
}

// ---- C3: export drive, announced; JV exposure is public
{
  const w = world('vayu');
  const day = exportDriveDay(w.seed);
  check(day >= 200 && day < 400, `export drive day in range (${day})`);
  cmd.scoutSuppliersCmd(w); // Kessler-Brandt
  until(w, () => w.tick >= day - EXPORT_DRIVE_NOTICE, 500);
  advanceDay(w);
  check(!!w.vendors.VAYU_SARATH.opening && /export drive from day/.test(log(w)), 'export drive announced in advance');
  check(!cmd.scoutSuppliersCmd(w).ok, 'not scoutable before the drive opens');
  until(w, () => !w.vendors.VAYU_SARATH.closed, EXPORT_DRIVE_NOTICE + 2);
  check(w.vendors.VAYU_SARATH.closed === false && w.vendors.VAYU_SARATH.rung === 'UNKNOWN', 'drive opens: scoutable, not yet known');
  w.resources.politicalCapital = 60;
  check(cmd.scoutSuppliersCmd(w).ok && w.vendors.VAYU_SARATH.rung === 'CONTACT', 'scouting then finds the JV');
  check(originView(w, MODULE_BY_ID.ARM_VS_SEAWIND).known.join() === 'ZVEZDA_NORD', 'JV parent visible without due diligence');
  w.vendors.VAYU_SARATH.rung = 'SIGNED';
  w.vendors.VAYU_SARATH.standing = 60;
  check(procurability(MODULE_BY_ID.ARM_VS_SEAWIND, w.vendors, new Set()).ok, 'JV missile purchasable when signed');
  w.vendors.ZVEZDA_NORD.status = 'FROZEN';
  const p = procurability(MODULE_BY_ID.ARM_VS_SEAWIND, w.vendors, new Set());
  check(!p.ok && /COMPONENT FREEZE/.test(p.reason ?? ''), 'an Eastern-parent sanction stops JV deliveries');
  check(resolveText('{v:VAYU_SARATH}', 'REAL') === 'BrahMos Aerospace' && resolveText('{v:VAYU_SARATH}', 'FICTIONAL') === 'Vayu-Sarath Aerospace', 'name skins');
}

// ---- scripted worlds (the tutorial) never open cold vendors
{
  const w = world('scripted', true);
  w.vendors.ZVEZDA_NORD.standing = 95;
  for (let d = 0; d < 500; d++) advanceDay(w);
  for (const id of COLD) check(w.vendors[id].closed === true, `scripted: ${id} stays closed`);
}

// ---- free-play soak: every gate opens in a normal run
{
  let mh = 0;
  let vs = 0;
  const N = 10;
  for (let s = 0; s < N; s++) {
    const w = world(`soak-${s}`);
    for (let d = 0; d < 900; d++) advanceDay(w);
    if (!w.vendors.MITSURUGI.closed) mh++;
    if (!w.vendors.VAYU_SARATH.closed) vs++;
  }
  console.log(`soak (900 days, ${N} theatres): Akitsu reform passed in ${mh}, JV export drive open in ${vs}`);
  check(vs === N, 'the export drive always opens by day 400');
  check(mh >= N / 2, 'Akitsu reform passes in most runs');
}

console.log(failures === 0 ? '\nCOLD OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

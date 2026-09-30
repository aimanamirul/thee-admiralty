/**
 * Action previews must agree with the commands they describe: a preview says BLOCKED exactly when the command would refuse,
 * never shows NaN / undefined, resolves all name tokens, and never leaks real names in the fictional skin.
 * Usage: npm run verify:preview
 */
import { MINISTRIES, MODULES, RESEARCH_PROJECTS } from '../lib/data/catalog';
import { realNameLiterals, resolveText } from '../lib/data/names';
import * as cmd from '../lib/sim/commands';
import { designateHulk } from '../lib/sim/fleetEngine';
import * as pv from '../lib/sim/preview';
import { createInitialWorld } from '../lib/sim/scenario';
import { createTutorialWorld } from '../lib/sim/tutorialScenario';
import { advanceDay } from '../lib/sim/worldEngine';
import { LESSONS } from '../lib/tutorial/lessons';
import type { VendorId } from '../lib/types/diplomacy';
import type { WorldDraft } from '../lib/types/world';

/** Whole-word match, so a short code like "DOM" does not match inside "DOMESTIC". */
const wordIn = (text: string, word: string) => new RegExp(`(^|[^A-Za-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9])`).test(text);

let failures = 0;
let checked = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    if (failures < 40) console.log(`  FAIL: ${msg}`);
  }
};
const banned = realNameLiterals();
const copy = (w: WorldDraft) => ({ ...structuredClone({ ...w, map: undefined }), map: w.map }) as WorldDraft;

function text(label: string, s: string) {
  checked++;
  check(s.length > 0, `${label}: empty preview`);
  check(!/NaN|undefined|Infinity|\[object/.test(s), `${label}: bad value in "${s}"`);
  const f = resolveText(s, 'FICTIONAL');
  check(!/\{[a-z]+:[A-Z0-9_]+\}/.test(f) && !/\{[a-z]+:[A-Z0-9_]+\}/.test(resolveText(s, 'REAL')), `${label}: unresolved token`);
  for (const b of banned) check(!wordIn(f, b), `${label}: real name "${b}" in fictional skin`);
}
/** BLOCKED iff the command refuses on a copy. */
function agree(label: string, w: WorldDraft, preview: string, run: (c: WorldDraft) => { ok: boolean }) {
  text(label, preview);
  const ok = run(copy(w)).ok;
  check(preview.startsWith('BLOCKED') === !ok, `${label}: preview ${preview.startsWith('BLOCKED') ? 'BLOCKED' : 'allowed'} but command ${ok ? 'succeeded' : 'refused'}`);
}

function sweep(tag: string, w: WorldDraft) {
  for (const v of Object.keys(w.vendors) as VendorId[]) {
    for (const m of MINISTRIES) agree(`${tag} lobby ${v}/${m.id}`, w, pv.previewLobby(w, v, m.id), (c) => cmd.lobbyVendorCmd(c, v, m.id));
    agree(`${tag} diligence ${v}`, w, pv.previewDiligence(w, v), (c) => cmd.dueDiligenceCmd(c, v));
    agree(`${tag} advance ${v}`, w, pv.previewAdvance(w, v), (c) => cmd.advanceRelationshipCmd(c, v));
  }
  agree(`${tag} scout`, w, pv.previewScout(w), (c) => cmd.scoutSuppliersCmd(c));
  for (const s of w.map.sectors) for (const roe of ['HOLD_FIRE', 'RETURN_FIRE', 'WEAPONS_FREE'] as const) text(`${tag} roe`, pv.previewRoe(w, s.id, roe));
  for (const tf of w.fleets.flatMap((f) => f.taskForces)) {
    text(`${tag} recall ${tf.id}`, pv.previewAssign(w, tf.id, null));
    for (const s of w.map.sectors) text(`${tag} assign ${tf.id}->${s.id}`, pv.previewAssign(w, tf.id, s.id));
    text(`${tag} surge`, pv.previewTempo(w, tf.id, 'SURGE'));
    text(`${tag} rotate`, pv.previewTempo(w, tf.id, 'ROTATE_THIRDS'));
  }
  for (const s of Object.values(w.ships)) {
    text(`${tag} hold ${s.id}`, pv.previewHold(w, s.id));
    if (s.buildStatus === 'CONSTRUCTING') {
      agree(`${tag} cancel ${s.id}`, w, pv.previewCancel(w, s.id), (c) => cmd.cancelContractCmd(c, s.id));
      agree(`${tag} resell ${s.id}`, w, pv.previewResell(w, s.id), (c) => cmd.resellHullCmd(c, s.id));
    }
    if (s.buildStatus === 'COMMISSIONED' && !s.isPartsHulk) agree(`${tag} hulk ${s.id}`, w, pv.previewHulk(w, s.id), (c) => designateHulk(c, s.id));
    if (s.isPartsHulk) {
      text(`${tag} strip ${s.id}`, pv.previewStrip(w, s.id));
      text(`${tag} restore ${s.id}`, pv.previewRestore(w, s.id));
    }
  }
  for (const m of MODULES) agree(`${tag} spare ${m.id}`, w, pv.previewBuySpare(w, m.id), (c) => cmd.buySpares(c, m.id, 1));
  for (const p of RESEARCH_PROJECTS) {
    if (w.research.active.includes(p.id)) text(`${tag} pause ${p.id}`, pv.previewStopResearch(w, p.id));
    else agree(`${tag} research ${p.id}`, w, pv.previewStartResearch(w, p.id), (c) => cmd.startResearch(c, p.id));
  }
  agree(`${tag} fund`, w, pv.previewFundBureau(w), (c) => cmd.fundBureau(c));
  for (const s of w.map.sectors) for (const sop of ['OBSERVE', 'CHALLENGE', 'ASSERTIVE'] as const) text(`${tag} sop`, pv.previewSop(w, s.id, sop));
  for (const c of w.contacts) {
    for (const a of ['SHADOW', 'HAIL', 'WARN', 'BOARD', 'ENGAGE'] as const) agree(`${tag} contact ${c.intent} ${a}`, w, pv.previewContactOrder(w, c.id, a), (x) => cmd.orderContact(x, c.id, a));
    text(`${tag} contact auto`, pv.previewContactOrder(w, c.id, 'AUTO'));
  }
  for (const tf of w.fleets.flatMap((f) => f.taskForces)) {
    agree(`${tag} release escort ${tf.id}`, w, pv.previewCancelEscort(w, tf.id), (c) => cmd.cancelEscortCmd(c, tf.id));
    for (const m of w.shipping.ships.slice(0, 4)) {
      agree(`${tag} escort ${tf.id}/${m.id}`, w, pv.previewEscort(w, tf.id, m.id), (c) => cmd.escortMerchantCmd(c, tf.id, m.id));
      text(`${tag} ship status ${m.id}`, pv.merchantStatusLine(w, m.id));
    }
  }
  agree(`${tag} hearing`, w, pv.previewHearing(w), (c) => cmd.holdBudgetHearing(c));
  agree(`${tag} industry`, w, pv.previewExpandIndustry(w), (c) => cmd.expandIndustry(c));
  const design = { hullId: 'CORVETTE' as const, moduleIds: ['PP_DOM_D12', 'CMS_NG_TACTICOS', 'SEN_ASEL_SPEAR', 'ARM_NG_SYLVER8'], squadronId: 'SQ-1-1' };
  agree(`${tag} order`, w, pv.previewOrderShip(w, design), (c) => cmd.orderShip(c, { ...design, designName: 'X', tradition: 'VIRTUES' }));
  const broke = { ...design, moduleIds: ['PP_DOM_D6', ...design.moduleIds.slice(1)] };
  agree(`${tag} order overload`, w, pv.previewOrderShip(w, broke), (c) => cmd.orderShip(c, { ...broke, designName: 'X', tradition: 'VIRTUES' }));
}

// Tutorial world at every lesson, and free-play worlds over time (sanctions, damage, hulks appear).
const tw = createTutorialWorld();
for (const l of LESSONS) {
  l.onEnter?.(tw);
  tw.events = [];
  sweep(`tutorial/${l.id}`, tw);
  for (let d = 0; d < 5; d++) advanceDay(tw);
}
for (const arch of ['CHOKEPOINT', 'CORRIDOR', 'RIMLAND'] as const) {
  const w = createInitialWorld('preview-check', arch);
  for (let d = 0; d <= 400; d++) {
    if (d % 100 === 0) {
      w.tension = 95;
      sweep(`${arch}/day${w.tick}`, w);
    }
    // hulls under construction at each sweep (cancel / resell previews), some old enough to be sold
    if (d % 100 === 30 || d % 100 === 95) cmd.orderShip(w, { designName: 'X', hullId: 'CORVETTE', moduleIds: ['PP_DOM_D12', 'CMS_NG_TACTICOS', 'SEN_NG_SMARTS', 'ARM_DOM_GUN76'], squadronId: 'SQ-1-1', tradition: 'VIRTUES' });
    if (d === 250 && w.shipping.ships[0]) cmd.escortMerchantCmd(w, w.fleets[0].taskForces[0].id, w.shipping.ships[0].id); // a live escort: exercises the release preview
    if (d === 150) for (const s of Object.values(w.ships)) if (s.state === 'MAINTENANCE_DOCK') designateHulk(w, s.id);
    if (d === 50) w.resources.politicalCapital = 0; // exercise blocked lobbying
    if (d === 250) w.politics.support = 20; // exercise refused lobbying / hearings
    if (d === 350) w.politics.support = 35; // exercise the strained cost multiplier
    advanceDay(w);
    w.events = [];
  }
}
console.log(`checked ${checked} previews`);
console.log(failures === 0 ? '\nPREVIEWS OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

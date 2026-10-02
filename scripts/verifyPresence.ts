/**
 * Presence-scaled deterrence: hull class decides how much a force on station deters. Usage: npm run verify:presence
 */
import { HULLS, STARTER_DESIGNS } from '../lib/data/catalog';
import { Rng } from '../lib/generator/prng';
import { tickContacts } from '../lib/sim/contactEngine';
import { allTaskForces, createShip } from '../lib/sim/fleetEngine';
import {
  DETER_STRENGTH_PER_PRESENCE, DETERRENCE_PER_DAY, presenceFrom, presenceLabel, PRESENCE_CAP, sectorPresence, shipPower, taskForcePower, taskForcePresence,
} from '../lib/sim/presence';
import { previewAssign } from '../lib/sim/preview';
import { createInitialWorld } from '../lib/sim/scenario';
import { coverChance } from '../lib/sim/shipping';
import { advanceDay } from '../lib/sim/worldEngine';
import type { HullClassId } from '../lib/types/hull';
import type { Merchant } from '../lib/types/shipping';
import type { WorldDraft } from '../lib/types/world';
import { pointAt } from '../lib/sim/shipping';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};
const near = (a: number, b: number, eps = 0.02) => Math.abs(a - b) < eps;

const DESIGNS: Record<string, { hull: HullClassId; ids: string[] }> = {
  FAC: { hull: 'FAC', ids: STARTER_DESIGNS[0].moduleIds },
  CORVETTE: { hull: 'CORVETTE', ids: STARTER_DESIGNS[1].moduleIds },
  FRIGATE: { hull: 'FRIGATE', ids: STARTER_DESIGNS[2].moduleIds },
  DESTROYER: { hull: 'DESTROYER', ids: ['PP_NG_GT25', 'CMS_RTX_AEGISLINK', 'SEN_RTX_SPY6', 'SEN_NG_APAR', 'ARM_RTX_MK41', 'ARM_RTX_MK41', 'ARM_RTX_HARPOON', 'ARM_NG_MM40', 'ARM_DOM_GUN76'] },
  CARRIER: { hull: 'CARRIER', ids: ['PP_RTX_IEP40', 'PP_RTX_IEP40', 'CMS_RTX_AEGISLINK', 'SEN_RTX_SPY6', 'SEN_NG_APAR', 'ARM_RTX_MK41', 'ARM_DOM_DSAM32', 'ARM_RTX_HARPOON', 'ARM_DOM_GUN76'] },
};
const mk = (kind: keyof typeof DESIGNS, id = 'X', readiness = 100) => {
  const d = DESIGNS[kind];
  return createShip({ id, name: id, pennant: id, hullId: d.hull, designName: 'x', moduleIds: d.ids, constructing: false, tick: 0, readiness, state: 'ACTIVE_PATROL' });
};

// ---- ship power: ordered by hull class, frigate = 1.0, condition counts
{
  const p = Object.fromEntries(Object.keys(DESIGNS).map((k) => [k, shipPower(mk(k))]));
  check(p.FAC < p.CORVETTE && p.CORVETTE < p.FRIGATE && p.FRIGATE < p.DESTROYER && p.DESTROYER < p.CARRIER, `power orders by hull class ${JSON.stringify(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, +v.toFixed(2)])))}`);
  check(near(p.FRIGATE, 1, 0.05), `the reference frigate is 1.0 (${p.FRIGATE.toFixed(2)})`);
  check(p.FAC > 0.3 && p.FAC < 0.5 && p.CARRIER > 4, 'a FAC is ~0.4, a carrier ~5 frigates');
  const hurt = mk('FRIGATE');
  hurt.integrity = 40;
  const tired = mk('FRIGATE', 'T', 30);
  check(shipPower(hurt) < p.FRIGATE * 0.7 && shipPower(tired) < p.FRIGATE * 0.8, 'damage and low readiness reduce power');
  const broken = mk('FRIGATE');
  broken.modules.forEach((m) => (m.failed = true));
  check(shipPower(broken) < p.FRIGATE * 0.65, 'failed modules reduce power');
  check(HULLS.FAC.structuralHP < HULLS.CARRIER.structuralHP, 'sanity: hull data');
}
// ---- presence curve
{
  check(presenceFrom(0) === 0 && near(presenceFrom(1), 1) && presenceFrom(2) > 1.5 && presenceFrom(2) < 1.7 && presenceFrom(50) <= PRESENCE_CAP, 'presence curve: 1 -> 1.0, 2 -> ~1.6, capped');
  check(presenceFrom(0.4) > 0.4 && presenceFrom(0.4) < 0.55 && presenceLabel(0.46) === 'token' && presenceLabel(0.84) === 'light' && presenceLabel(1) === 'solid' && presenceLabel(1.6) === 'strong' && presenceLabel(2.3) === 'dominant', 'labels');
  let prev = 0;
  for (let x = 0; x <= 10; x += 0.5) {
    check(presenceFrom(x) >= prev, 'monotonic');
    prev = presenceFrom(x);
  }
}

/** A world where task force 1 is the only force: stationed in `sector` with exactly these hulls on patrol. */
/** Largest sector of a map: roomy enough to hold a raider 18 tiles from a task force (contacts cannot leave their sector). */
const secOf = (w: WorldDraft) => w.map.sectors.reduce((a, b) => (b.areaTiles > a.areaTiles ? b : a)).id;
function forceWorld(seed: string, kinds: (keyof typeof DESIGNS)[], sectorArg?: number): WorldDraft {
  const w = createInitialWorld(seed, 'CORRIDOR');
  const sector = sectorArg ?? secOf(w);
  w.contacts = [];
  w.shipping.lanes = [];
  const [tf1, ...rest] = allTaskForces(w.fleets);
  for (const t of [tf1, ...rest]) for (const sq of t.squadrons) sq.shipIds = [];
  for (const id of Object.keys(w.ships)) delete w.ships[id];
  kinds.forEach((k, i) => {
    const s = mk(k, `T${i}`);
    s.stateDays = 0;
    w.ships[s.id] = s;
    tf1.squadrons[0].shipIds.push(s.id);
  });
  tf1.assignedSectorId = sector;
  tf1.position = { ...w.map.sectors[sector].anchor };
  tf1.destination = { ...w.map.sectors[sector].anchor };
  for (const t of rest) t.position = { x: -900, y: -900 };
  return w;
}
const hold = (w: WorldDraft) => {
  for (const s of Object.values(w.ships)) {
    s.state = 'ACTIVE_PATROL';
    s.readiness = 90;
    s.integrity = 100;
    s.holdStation = true;
    s.stateDays = 0;
  }
};

// ---- sector presence: only forces on station on patrol count
{
  const w = forceWorld('station', ['FRIGATE']);
  const tf = allTaskForces(w.fleets)[0];
  check(sectorPresence(w, secOf(w)).presence > 0.8, 'a frigate on station gives presence');
  tf.position = { x: tf.position.x + 20, y: tf.position.y };
  check(sectorPresence(w, secOf(w)).presence === 0, 'a force off station gives none');
  tf.position = { ...w.map.sectors[secOf(w)].anchor };
  tf.escort = 'MV-X';
  check(sectorPresence(w, secOf(w)).presence === 0, 'a force on escort duty holds nothing');
  tf.escort = null;
  for (const s of Object.values(w.ships)) s.state = 'TRANSIT_WORKUP';
  check(sectorPresence(w, secOf(w)).presence === 0, 'ships not on patrol give none');
  const two = forceWorld('station2', ['FRIGATE', 'FRIGATE']);
  check(sectorPresence(two, secOf(two)).presence > (() => { const f = forceWorld('station1', ['FRIGATE']); return sectorPresence(f, secOf(f)); })().presence, 'more hulls, more presence');
  check(taskForcePresence(two, allTaskForces(two.fleets)[0]) === sectorPresence(two, secOf(two)).presence, 'task force and sector presence agree for one force');
}

// ---- threat reduction scales with the force
const MEAN = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const forces: [string, (keyof typeof DESIGNS)[]][] = [
  ['none', []],
  ['FAC pair', ['FAC', 'FAC']],
  ['frigate', ['FRIGATE']],
  ['destroyer', ['DESTROYER']],
  ['carrier group', ['CARRIER', 'DESTROYER']],
];
const threats: Record<string, number> = {};
const raiders: Record<string, number> = {};
for (const [name, kinds] of forces) {
  const th: number[] = [];
  for (let sd = 0; sd < 8; sd++) {
    const w = forceWorld(`deter-${sd}`, kinds);
    w.tension = 55;
    w.sectors[secOf(w)].threat = 60;
    for (let d = 0; d < 150; d++) {
      hold(w);
      advanceDay(w);
      w.events = [];
    }
    th.push(w.sectors[secOf(w)].threat);
  }
  threats[name] = MEAN(th);
  // Spawn deterrence in isolation: the sector's threat is pinned, so any difference is the raiders that never appeared.
  const ra: number[] = [];
  for (let sd = 0; sd < 24; sd++) {
    const w = forceWorld(`spawn-${sd}`, kinds);
    w.tension = 55;
    const seen = new Set<string>();
    for (let d = 0; d < 200; d++) {
      hold(w);
      w.sectors[secOf(w)].threat = 60;
      advanceDay(w);
      for (const c of w.contacts) if (c.hostile && c.sectorId === secOf(w)) seen.add(c.id);
      w.events = [];
    }
    ra.push(seen.size);
  }
  raiders[name] = MEAN(ra);
}
console.log('mean sector threat after 150 days (start 60):', Object.entries(threats).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' · '));
console.log('raiders appearing in the sector per 200 days at pinned threat 60:', Object.entries(raiders).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' · '));
check(threats.none > threats['FAC pair'] + 3, `a FAC pair reduces threat (${threats.none.toFixed(0)} -> ${threats['FAC pair'].toFixed(0)})`);
check(threats['FAC pair'] > threats.frigate + 3, `a frigate deters more than a FAC pair (${threats['FAC pair'].toFixed(0)} vs ${threats.frigate.toFixed(0)})`);
check(threats.frigate > threats.destroyer + 1, `a destroyer deters more than a frigate (${threats.frigate.toFixed(0)} vs ${threats.destroyer.toFixed(0)})`);
check(threats.destroyer >= threats['carrier group'] - 0.5 && threats['carrier group'] < threats.frigate - 3, `a carrier group is the strongest (${threats['carrier group'].toFixed(0)})`);
check(raiders.none > raiders['carrier group'] * 1.8 && raiders['FAC pair'] > raiders['carrier group'] && raiders.frigate > raiders['carrier group'], `stronger forces see fewer raiders (${Object.entries(raiders).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')})`);
check(DETERRENCE_PER_DAY === 0.5, 'a frigate-equivalent on patrol still takes 0.5 threat per day, as before presence existed');

// ---- raiders turn away from forces that outclass them, and hunt forces that do not
function raidTest(kind: (keyof typeof DESIGNS)[], strength: number) {
  const w = forceWorld('raid-behaviour', kind);
  hold(w);
  const tf = allTaskForces(w.fleets)[0];
  // a water cell of the same sector about 18 tiles from the task force (contacts cannot leave their sector)
  let start = { x: 0, y: 0 };
  let err = Infinity;
  for (let i = 0; i < w.map.sectorGrid.length; i++) {
    if (w.map.sectorGrid[i] !== secOf(w)) continue;
    const x = i % w.map.width;
    const y = Math.floor(i / w.map.width);
    const e = Math.abs(Math.hypot(x - tf.position.x, y - tf.position.y) - 18);
    if (e < err) {
      err = e;
      start = { x, y };
    }
  }
  w.contacts.push({ id: 'CT-R', sectorId: secOf(w), position: { ...start }, heading: Math.PI, cls: 'UNKNOWN', hostile: true, intent: 'RAIDER', strength, bornTick: 0, expiresTick: 20 });
  const d0 = Math.hypot(start.x - tf.position.x, start.y - tf.position.y);
  tickContacts(w, new Rng('rb'), new Set());
  const c = w.contacts.find((x) => x.id === 'CT-R');
  const d1 = c ? Math.hypot(c.position.x - tf.position.x, c.position.y - tf.position.y) : NaN;
  return { w, c, closing: d1 < d0, deterred: !!c?.deterred };
}
{
  const one = raidTest(['FAC'], 20);
  const fac = raidTest(['FAC', 'FAC'], 35);
  const frigWeak = raidTest(['FRIGATE'], 20);
  const frigMid = raidTest(['FRIGATE'], 35);
  const frigVsHeavy = raidTest(['FRIGATE'], 70);
  const carrierVsHeavy = raidTest(['CARRIER', 'DESTROYER'], 70);
  check(!one.deterred && one.closing, 'a single FAC deters nothing: even a weak raider keeps closing');
  check(!fac.deterred && fac.closing, 'a FAC pair does not deter a mid-strength raid (35)');
  check(frigWeak.deterred && !frigWeak.closing, 'a frigate group turns a weak raider away');
  check(!frigMid.deterred && frigMid.closing, 'a frigate group does not deter a mid-strength raid (35): it hunts');
  check(!frigVsHeavy.deterred && frigVsHeavy.closing, 'a frigate group does not deter a heavy raid (strength 70)');
  check(carrierVsHeavy.deterred && !carrierVsHeavy.closing, 'a carrier group turns even a heavy raid away');
  check(DETER_STRENGTH_PER_PRESENCE * PRESENCE_CAP >= 70, 'sanity: a dominant force can deter the heaviest realistic raids');
  check(taskForcePresence(forceWorld('x', ['FAC']), allTaskForces(forceWorld('x', ['FAC']).fleets)[0], false) * DETER_STRENGTH_PER_PRESENCE < 15, 'sanity: one FAC is below the weakest possible raid');
  // a deterred raider that expires is a small win, not an unopposed probe
  const e = raidTest(['FRIGATE'], 20);
  const c = e.c!;
  c.expiresTick = e.w.tick;
  const th0 = e.w.sectors[secOf(e.w)].threat;
  const sup0 = e.w.politics.support;
  e.w.tick += 1;
  tickContacts(e.w, new Rng('exp'), new Set());
  const txt = e.w.events.map((x) => x.text).join('\n');
  check(/RAIDER DETERRED/.test(txt) && !/UNOPPOSED/.test(txt), 'a deterred raider that expires is logged as deterred, not unopposed');
  check(e.w.sectors[secOf(e.w)].threat < th0 && e.w.politics.support > sup0, 'and it lowers threat and raises support slightly');
}

// ---- shipping cover is graded by presence
{
  const w = forceWorld('cover', ['FAC', 'FAC']);
  w.shipping = { ...w.shipping };
  const lane = createInitialWorld('cover', 'CORRIDOR').shipping.lanes[0];
  w.shipping.lanes = [lane];
  const at = pointAt(lane.path, 100).pos;
  const m: Merchant = {
    id: 'MV-C', name: 'Test', kind: 'TANKER', flag: 'OPEN_REGISTRY', laneId: lane.id, dist: 100, dir: 1, position: at, heading: 0, cargo: 50, bornTick: 0,
    status: 'UNDERWAY', distressUntil: null, escort: null, contraband: false, tip: false, checked: false, turnedBack: false, inspecting: null,
  };
  w.shipping.ships = [m];
  const tf = allTaskForces(w.fleets)[0];
  const chanceWith = (kinds: (keyof typeof DESIGNS)[]) => {
    for (const id of Object.keys(w.ships)) delete w.ships[id];
    tf.squadrons[0].shipIds = [];
    kinds.forEach((k, i) => {
      const s = mk(k, `C${i}`);
      w.ships[s.id] = s;
      tf.squadrons[0].shipIds.push(s.id);
    });
    tf.assignedSectorId = null;
    tf.position = { x: at.x + 5, y: at.y };
    return coverChance(w, m);
  };
  const none = chanceWith([]);
  const fac = chanceWith(['FAC', 'FAC']);
  const frig = chanceWith(['FRIGATE']);
  const carrier = chanceWith(['CARRIER', 'DESTROYER']);
  console.log(`cover chance: none ${none.toFixed(2)} · FAC pair ${fac.toFixed(2)} · frigate ${frig.toFixed(2)} · carrier group ${carrier.toFixed(2)}`);
  check(none === 0, 'no force, no cover');
  check(fac > 0.45 && fac < 0.8 && fac < frig && frig < carrier && carrier <= 0.97, 'cover is graded: FAC pair < frigate < carrier group, never certain');
  tf.escort = m.id;
  tf.escortMode = 'ESCORT';
  m.escort = tf.id;
  chanceWith(['FAC', 'FAC']);
  tf.escort = m.id;
  check(coverChance(w, m) === 0.97, 'an escort alongside makes it 97% whatever the hull');
  tf.escortMode = 'INSPECT';
  check(coverChance(w, m) < 0.97, 'a task force searching a ship is not escorting it');
  // a counted-once check: nearby and holding the sector must not double count
  const w2 = forceWorld('once', ['FRIGATE']);
  const lane2 = createInitialWorld('once', 'CORRIDOR').shipping.lanes[0];
  w2.shipping.lanes = [lane2];
  const sec = secOf(w2);
  const anchor = w2.map.sectors[sec].anchor;
  const m2: Merchant = { ...m, id: 'MV-D', laneId: lane2.id, position: { ...anchor } };
  w2.shipping.ships = [m2];
  const holding = coverChance(w2, m2);
  const expected = Math.min(0.97, 0.25 + 0.6 * presenceFrom(taskForcePower(w2, allTaskForces(w2.fleets)[0], false)));
  check(near(holding, expected, 1e-9), `a force both nearby and holding the sector counts once (${holding.toFixed(3)} vs ${expected.toFixed(3)})`);
}

// ---- previews and text
{
  const w = forceWorld('preview', ['FAC', 'FAC']);
  const tf = allTaskForces(w.fleets)[0];
  tf.assignedSectorId = null;
  tf.position = { ...w.map.homePort };
  const txt = previewAssign(w, tf.id, secOf(w));
  check(/naval presence 0\.\d \(light\)/.test(txt) && /threat −0\.\d\d\/day/.test(txt), `Assign preview states presence (${txt.slice(0, 160)})`);
  const w2 = forceWorld('preview2', ['CARRIER', 'DESTROYER']);
  const tf2 = allTaskForces(w2.fleets)[0];
  tf2.assignedSectorId = null;
  tf2.position = { ...w2.map.homePort };
  check(/\(dominant\)/.test(previewAssign(w2, tf2.id, secOf(w2))), 'a carrier group is described as dominant');
}

console.log(failures === 0 ? '\nPRESENCE OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

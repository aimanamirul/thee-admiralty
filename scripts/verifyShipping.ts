/**
 * Civilian shipping, phases T1-T3: lanes and traffic, raiders / protection / distress / escort, war-risk, rerouting and the trade
 * index feeding the budget forecast and domestic support. Usage: npm run verify:shipping
 */
import { realNameLiterals, resolveText } from '../lib/data/names';
import { Rng } from '../lib/generator/prng';
import * as cmd from '../lib/sim/commands';
import { tickContacts } from '../lib/sim/contactEngine';
import { allTaskForces } from '../lib/sim/fleetEngine';
import { isWater } from '../lib/sim/navigation';
import { forecast } from '../lib/sim/politicsEngine';
import { createInitialWorld } from '../lib/sim/scenario';
import {
  ATTACK_RANGE, COVER_RADIUS, DISTRESS_DAYS, generateLanes, isCovered, laneOf, MAX_MERCHANTS, MERCHANT_SPEED, pointAt, sectorHeld, premiumPct, REROUTE_DAYS,
  RISK_REROUTE, targetIndex, tickShipping, tradeFactor, trafficAt,
} from '../lib/sim/shipping';
import { createTutorialWorld } from '../lib/sim/tutorialScenario';
import { advanceDay } from '../lib/sim/worldEngine';
import type { MapArchetype, Vec2 } from '../lib/types/map';
import type { Merchant } from '../lib/types/shipping';
import type { WorldDraft } from '../lib/types/world';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    if (failures < 40) console.log(`  FAIL: ${msg}`);
  }
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const ARCHS: MapArchetype[] = ['CHOKEPOINT', 'CORRIDOR', 'RIMLAND'];
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const world = (seed: string, arch: MapArchetype = 'CORRIDOR'): WorldDraft => {
  const w = createInitialWorld(seed, arch);
  w.contacts = [];
  return w;
};
const distToPath = (path: Vec2[], p: Vec2) => {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
    best = Math.min(best, dist(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
  }
  return best;
};
/** A merchant placed on a lane by hand. */
function place(w: WorldDraft, laneIdx: number, d: number, id = 'MV-T', dir: 1 | -1 = 1): Merchant {
  const lane = w.shipping.lanes[laneIdx];
  const { pos, heading } = pointAt(lane.path, d);
  const m: Merchant = {
    id, name: 'Test Heron', kind: 'TANKER', flag: 'OPEN_REGISTRY', laneId: lane.id, dist: d, dir, position: pos, heading, cargo: 50,
    bornTick: w.tick, status: 'UNDERWAY', distressUntil: null, escort: null,
  };
  w.shipping.ships.push(m);
  return m;
}
const sectorAtPos = (w: WorldDraft, p: Vec2) => w.map.sectorGrid[Math.round(p.y) * w.map.width + Math.round(p.x)];
const farAway = (w: WorldDraft) => allTaskForces(w.fleets).forEach((tf) => (tf.position = { x: -900, y: -900 }));
const rng = (s: string) => new Rng(s);
const text = (w: WorldDraft) => w.events.map((e) => e.text).join('\n');
/** Where a ship on lane `laneIdx` will be after this tick's move. */
const after = (w: WorldDraft, m: Merchant): Vec2 => pointAt(w.shipping.lanes.find((l) => l.id === m.laneId)!.path, m.dist + m.dir * MERCHANT_SPEED).pos;
/** Raider hostile contact just beside the ship's next position (in attack range once the ship has moved). */
const raiderNear = (w: WorldDraft, m: Merchant, id = 'CT-R') => {
  const p = after(w, m);
  w.contacts.push({ id, sectorId: sectorAtPos(w, p), position: { x: p.x + 1, y: p.y }, heading: 0, cls: 'HOSTILE', hostile: true, intent: 'RAIDER', strength: 30, bornTick: w.tick, expiresTick: w.tick + 20 });
};

// ---- T1: lanes are valid, deterministic, and use the theatre's water
for (const arch of ARCHS) {
  for (let s = 0; s < 6; s++) {
    const w = world(`lanes-${s}`, arch);
    const lanes = w.shipping.lanes;
    const tag = `${arch}/lanes-${s}`;
    check(lanes.length >= 1 && lanes.length <= 3, `${tag}: ${lanes.length} lanes`);
    check(JSON.stringify(generateLanes(w.map, w.seed)) === JSON.stringify(lanes), `${tag}: lane generation is deterministic`);
    for (const l of lanes) {
      const a = l.path[0];
      const b = l.path[l.path.length - 1];
      const edge = (p: Vec2) => Math.min(p.x, p.y, w.map.width - 1 - p.x, w.map.height - 1 - p.y);
      check(edge(a) <= 3 && edge(b) <= 3, `${tag}/${l.id}: gates on the map edge`);
      check(l.length >= Math.hypot(w.map.width, w.map.height) * 0.45, `${tag}/${l.id}: lane too short (${l.length.toFixed(0)})`);
      let dry = 0;
      for (let d = 0; d <= l.length; d += 0.5) {
        const p = pointAt(l.path, d).pos;
        if (!isWater(w.map, Math.round(p.x), Math.round(p.y))) dry++;
      }
      check(dry === 0, `${tag}/${l.id}: ${dry} land cells on the lane`);
      check(l.sectors.length >= 1 && l.sectors.every((x) => x >= 0 && x < w.map.sectors.length), `${tag}/${l.id}: sectors crossed`);
      check(l.risk === 0 && l.traffic === 1 && l.reroutedUntil === null, `${tag}/${l.id}: starts calm`);
    }
    if (w.map.chokepoints.length > 0) {
      check(lanes.some((l) => w.map.chokepoints.some((c) => distToPath(l.path, c.position) < 8)), `${tag}: no lane crosses any of the theatre's chokepoints`);
    }
  }
}
check(createTutorialWorld().shipping.lanes.length === 0, 'the tutorial has no lanes');

// ---- T1: traffic soak — cap, staying on the lane, completing passages, unique names, scripted worlds silent
for (const arch of ARCHS) {
  const w = world('traffic', arch);
  let peak = 0;
  let offLane = 0;
  let dupes = 0;
  const seen = new Set<string>();
  for (let d = 0; d < 500; d++) {
    advanceDay(w);
    peak = Math.max(peak, w.shipping.ships.length);
    const names = w.shipping.ships.map((m) => m.name);
    if (new Set(names).size !== names.length) dupes++;
    for (const m of w.shipping.ships) {
      seen.add(m.id);
      const lane = laneOf(w.shipping, m.laneId)!;
      if (distToPath(lane.path, m.position) > 1.5) offLane++;
    }
    w.events = [];
  }
  check(peak <= MAX_MERCHANTS && peak >= 4, `${arch}: peak traffic ${peak}`);
  check(offLane === 0, `${arch}: ${offLane} ship-days off the lane`);
  check(dupes === 0, `${arch}: duplicate ship names underway`);
  check(w.shipping.stats.transited >= 20, `${arch}: only ${w.shipping.stats.transited} passages in 500 days`);
  check(new Set(w.shipping.ships.map((m) => m.id)).size === w.shipping.ships.length, `${arch}: duplicate ship ids`);
  check(w.shipping.seq >= seen.size && w.shipping.seq === w.shipping.stats.transited + w.shipping.stats.lost + w.shipping.ships.length, `${arch}: every ship is accounted for (${w.shipping.seq} spawned = ${w.shipping.stats.transited} arrived + ${w.shipping.stats.lost} lost + ${w.shipping.ships.length} underway)`);
}
{
  const w = world('scripted');
  w.scripted = true;
  for (let d = 0; d < 300; d++) advanceDay(w);
  check(w.shipping.ships.length === 0 && w.shipping.stats.transited === 0, 'scripted worlds spawn no shipping');
}

// ---- T2: an unprotected ship next to a raider is attacked; a covered one is not
{
  const counts = { SUNK: 0, SEIZED: 0, DAMAGED: 0 };
  const N = 400;
  const w = world('attack');
  for (let t = 0; t < N; t++) {
    w.tick = t;
    w.shipping.ships = [];
    w.events = [];
    const m = place(w, 0, 90);
    farAway(w);
    raiderNear(w, m, `CT-R${t}`);
    tickShipping(w, rng(`a${t}`));
    const ship = w.shipping.ships.find((x) => x.id === 'MV-T');
    const raiderGone = !w.contacts.some((c) => c.id === `CT-R${t}`);
    check(raiderGone, `attack ${t}: the raid is expended`);
    // The ship moved before the attack check; the raider starts 2 tiles off its old position so it is in range of the new one.
    if (!ship) counts[/seized/.test(text(w)) ? 'SEIZED' : 'SUNK']++;
    else if (ship.status === 'DISTRESS') counts.DAMAGED++;
    else check(false, `attack ${t}: ship untouched although unprotected and in range`);
  }
  const share = (k: keyof typeof counts) => counts[k] / N;
  check(share('SUNK') > 0.22 && share('SUNK') < 0.38, `sunk share ${share('SUNK').toFixed(2)}`);
  check(share('SEIZED') > 0.13 && share('SEIZED') < 0.27, `seized share ${share('SEIZED').toFixed(2)}`);
  check(share('DAMAGED') > 0.42 && share('DAMAGED') < 0.58, `damaged share ${share('DAMAGED').toFixed(2)}`);
}
{
  let hit = 0;
  const w = world('covered');
  const tf = allTaskForces(w.fleets)[0];
  for (let t = 0; t < 60; t++) {
    w.tick = t;
    w.shipping.ships = [];
    w.contacts = [];
    farAway(w);
    const m = place(w, 0, 90);
    tf.position = { x: after(w, m).x + 6, y: after(w, m).y };
    raiderNear(w, m, `CT-C${t}`);
    check(isCovered(w, m), 'a task force within the cover radius covers the ship');
    tickShipping(w, rng(`c${t}`));
    if (w.shipping.ships[0]?.status === 'DISTRESS' || w.shipping.stats.lost > 0) hit++;
    if (w.contacts.length !== 1) hit++;
  }
  check(hit === 0, `a covered ship is never attacked; the raider holds off (${hit} incidents)`);
  // cover radius edge
  const w2 = world('edge');
  const m2 = place(w2, 0, 90);
  allTaskForces(w2.fleets)[0].position = { x: m2.position.x + COVER_RADIUS - 1, y: m2.position.y };
  check(isCovered(w2, m2), 'just inside the radius');
  allTaskForces(w2.fleets)[0].position = { x: m2.position.x + COVER_RADIUS + 3, y: m2.position.y };
  check(!isCovered(w2, m2), 'just outside the radius');
}
{
  // Sector presence: a task force on station in the ship's sector protects it wherever in the sector it is.
  let tested = false;
  for (const arch of ARCHS) {
    for (let sd = 0; sd < 6 && !tested; sd++) {
      const w = world(`held-${sd}`, arch);
      const tf = allTaskForces(w.fleets)[0];
      farAway(w);
      for (let li = 0; li < w.shipping.lanes.length && !tested; li++) {
        const lane = w.shipping.lanes[li];
        for (const sec of lane.sectors) {
          tf.assignedSectorId = sec;
          tf.position = { ...w.map.sectors[sec].anchor };
          let d = 0;
          for (; d < lane.length - MERCHANT_SPEED; d += 1) {
            const p = pointAt(lane.path, d).pos;
            const n = pointAt(lane.path, d + MERCHANT_SPEED).pos;
            if (sectorAtPos(w, p) === sec && sectorAtPos(w, n) === sec && dist(p, tf.position) > COVER_RADIUS + 6 && dist(n, tf.position) > COVER_RADIUS + 6) break;
          }
          if (d >= lane.length - MERCHANT_SPEED) continue;
          tested = true;
          check(sectorHeld(w, sec), `${arch}: a task force on its anchor holds the sector`);
          const m = place(w, li, d);
          check(isCovered(w, m), `${arch}: a ship far from the task force but in its held sector is protected`);
          let attacked = 0;
          for (let t = 0; t < 30; t++) {
            w.tick = t;
            w.shipping.ships = [];
            w.contacts = [];
            const q = place(w, li, d);
            raiderNear(w, q, `CT-H${t}`);
            tickShipping(w, rng(`h${t}`));
            if (w.contacts.length === 0) attacked++;
          }
          check(attacked === 0, `${arch}: no attacks inside a held sector (${attacked})`);
          const probe = place(w, li, d, 'MV-P');
          tf.position = { x: -900, y: -900 };
          check(!sectorHeld(w, sec) && !isCovered(w, probe), `${arch}: when the task force leaves, protection ends`);
          tf.position = { ...w.map.sectors[sec].anchor };
          tf.assignedSectorId = null;
          check(!sectorHeld(w, sec), `${arch}: an unassigned task force holds nothing`);
          break;
        }
      }
    }
  }
  check(tested, 'found a lane point inside a sector far from its anchor to test sector presence');
}
{
  // Out-of-range raiders leave shipping alone; raiders hunt lane traffic in range.
  const w = world('range');
  const m = place(w, 0, 90);
  farAway(w);
  w.contacts.push({ id: 'CT-FAR', sectorId: sectorAtPos(w, m.position), position: { x: m.position.x + ATTACK_RANGE + 12, y: m.position.y }, heading: 0, cls: 'HOSTILE', hostile: true, intent: 'RAIDER', strength: 30, bornTick: 0, expiresTick: 50 });
  tickShipping(w, rng('far'));
  check(w.shipping.ships[0]?.status === 'UNDERWAY' && w.contacts.length === 1, 'a raider out of range does nothing');
}
{
  // Raiders steer at lane ships (contact engine): distance shrinks in most trials.
  let closer = 0;
  let trials = 0;
  for (let s = 0; s < 40; s++) {
    const w = world(`hunt-${s}`);
    const lane = w.shipping.lanes[0];
    const m = place(w, 0, lane.length / 2);
    const sec = sectorAtPos(w, m.position);
    const off = pointAt(lane.path, lane.length / 2 - 14).pos;
    if (sectorAtPos(w, off) !== sec) continue;
    farAway(w);
    w.contacts.push({ id: 'CT-H', sectorId: sec, position: { ...off }, heading: Math.PI, cls: 'UNKNOWN', hostile: true, intent: 'RAIDER', strength: 30, bornTick: 0, expiresTick: 60 });
    const before = dist(off, m.position);
    tickContacts(w, rng(`h${s}`), new Set());
    trials++;
    if (w.contacts[0] && dist(w.contacts[0].position, m.position) < before - 0.5) closer++;
  }
  check(trials >= 15 && closer >= trials * 0.8, `raiders hunt shipping (${closer}/${trials} closed the distance)`);
}

// ---- T2: distress — founders, is rescued by cover, or is reached by an ordered task force
{
  const w = world('distress-lost');
  farAway(w);
  const m = place(w, 0, 100);
  m.status = 'DISTRESS';
  m.distressUntil = w.tick + DISTRESS_DAYS;
  const sup0 = w.politics.support;
  for (let d = 0; d < DISTRESS_DAYS; d++) {
    w.tick++;
    tickShipping(w, rng(`d${d}`));
  }
  check(!w.shipping.ships.some((x) => x.id === 'MV-T') && w.shipping.stats.lost === 1, 'a ship with no help founders after the deadline');
  check(w.politics.support < sup0 && /foundered/.test(text(w)), 'foundering costs support and is logged');
}
{
  const w = world('distress-rescue');
  farAway(w);
  const m = place(w, 0, 100);
  m.status = 'DISTRESS';
  m.distressUntil = w.tick + DISTRESS_DAYS;
  allTaskForces(w.fleets)[0].position = { x: m.position.x + 5, y: m.position.y };
  const sup0 = w.politics.support;
  w.tick++;
  tickShipping(w, rng('r'));
  check(w.shipping.ships[0]?.status === 'UNDERWAY' && w.shipping.stats.rescued === 1 && /RESCUE/.test(text(w)), 'cover in range rescues a ship in distress');
  check(near(w.politics.support - sup0, 1), 'rescue is worth support +1');
}
{
  // Answering the call: a task force ordered to a distressed ship far away arrives in time (9 tiles/day vs 6 days).
  const w = world('distress-aid');
  const m = place(w, 0, 100);
  m.status = 'DISTRESS';
  m.distressUntil = w.tick + DISTRESS_DAYS;
  const tf = allTaskForces(w.fleets)[0];
  tf.position = { x: m.position.x + 45, y: m.position.y };
  farAway(w);
  tf.position = { x: m.position.x + 45, y: m.position.y };
  check(cmd.escortMerchantCmd(w, tf.id, m.id).ok, 'aid order accepted');
  let rescued = false;
  for (let d = 0; d < DISTRESS_DAYS && !rescued; d++) {
    advanceDay(w);
    w.contacts = [];
    rescued = w.shipping.stats.rescued > 0;
  }
  check(rescued, 'an ordered task force reaches the ship before it founders');
}

// ---- T2: escort orders
{
  const w = world('escort');
  const tf = allTaskForces(w.fleets)[0];
  const other = allTaskForces(w.fleets)[1];
  const m = place(w, 0, 40);
  check(!cmd.escortMerchantCmd(w, 'TF-NOPE', m.id).ok && !cmd.escortMerchantCmd(w, tf.id, 'MV-NOPE').ok, 'unknown ids are refused');
  check(cmd.escortMerchantCmd(w, tf.id, m.id).ok && tf.escort === m.id && m.escort === tf.id, 'escort order sets both sides');
  check(!cmd.escortMerchantCmd(w, tf.id, m.id).ok, 'already escorting');
  check(!cmd.escortMerchantCmd(w, other.id, m.id).ok, 'one escort per ship');
  check(cmd.cancelEscortCmd(w, tf.id).ok && !tf.escort && !m.escort, 'release clears both sides');
  check(!cmd.cancelEscortCmd(w, tf.id).ok, 'nothing to release');
  // a task force with every ship in dock cannot be sent
  const dockw = world('escort-dock');
  const tfd = allTaskForces(dockw.fleets)[1];
  for (const id of tfd.squadrons.flatMap((s) => s.shipIds)) dockw.ships[id].state = 'MAINTENANCE_DOCK';
  const md = place(dockw, 0, 40);
  check(!cmd.escortMerchantCmd(dockw, tfd.id, md.id).ok, 'a task force with all hulls in dock cannot escort');
}
{
  // Full passage under escort: the task force follows, the ship is protected, and arrival pays support.
  const w = world('convoy');
  const tf = allTaskForces(w.fleets)[0];
  const home = tf.assignedSectorId;
  const m = place(w, 0, 20);
  tf.position = pointAt(w.shipping.lanes[0].path, 60).pos;
  cmd.escortMerchantCmd(w, tf.id, m.id);
  const sup0 = w.politics.support;
  let coveredDays = 0;
  let days = 0;
  while (w.shipping.ships.some((x) => x.id === 'MV-T') && days++ < 120) {
    advanceDay(w);
    w.contacts = [];
    const cur = w.shipping.ships.find((x) => x.id === 'MV-T');
    if (cur && isCovered(w, cur)) coveredDays++;
  }
  check(w.shipping.stats.escorted === 1 && /SAFE PASSAGE/.test(text(w)), 'safe passage recorded');
  check(!tf.escort && tf.assignedSectorId === home, 'the escort ends at port and the task force keeps its station');
  check(coveredDays >= days * 0.7, `the escort keeps its ship covered (${coveredDays}/${days} days)`);
  check(days < 120 && days > 5, `the escorted passage completes (${days} days)`);
  check(w.politics.support - sup0 > -2, 'escort does not wreck support');
}
{
  // Losing an escorted ship releases the escort.
  const w = world('escort-lost');
  const tf = allTaskForces(w.fleets)[0];
  const m = place(w, 0, 90);
  cmd.escortMerchantCmd(w, tf.id, m.id);
  m.status = 'DISTRESS';
  m.distressUntil = w.tick;
  tf.position = { x: -900, y: -900 };
  farAway(w);
  w.tick++;
  tickShipping(w, rng('el'));
  check(!tf.escort && /ESCORT FAILED/.test(text(w)), 'a lost ship frees its escort and the ledger says so');
}

// ---- T3: war-risk follows sector threat; premium cuts traffic; reroute and return
{
  check(trafficAt(0) === 1 && trafficAt(15) === 1 && trafficAt(50) < 0.6 && trafficAt(100) === 0, 'traffic curve');
  check(premiumPct(0) === 0 && premiumPct(50) > premiumPct(20), 'premium rises with risk');
  const w = world('risk');
  w.scripted = false;
  for (const l of w.shipping.lanes) for (const s of l.sectors) w.sectors[s].threat = 100;
  for (let d = 0; d < 120; d++) {
    for (const l of w.shipping.lanes) for (const s of l.sectors) w.sectors[s].threat = 100;
    w.contacts = [];
    tickShipping(w, rng(`risk${d}`));
  }
  const r = w.shipping.lanes[0].risk;
  check(r > 25 && r < 40, `risk settles near 0.35 x threat (${r.toFixed(1)})`);
  check(near(w.shipping.lanes[0].traffic, trafficAt(r)), 'traffic follows risk');
  check(w.shipping.index < 100 && w.shipping.index > 60, `trade index reflects thinned traffic (${w.shipping.index.toFixed(1)})`);
}
{
  const w = world('reroute');
  const lane = w.shipping.lanes[0];
  lane.risk = RISK_REROUTE + 10;
  for (const l of w.shipping.lanes) for (const s of l.sectors) w.sectors[s].threat = 0;
  const bornBefore = w.shipping.seq;
  w.tick = 10;
  tickShipping(w, rng('rr'));
  check(lane.reroutedUntil === 10 + REROUTE_DAYS && /REROUTES/.test(text(w)), 'high risk reroutes the lane, announced in the ledger');
  let spawnedOnLane = 0;
  for (let d = 0; d < REROUTE_DAYS - 2; d++) {
    w.tick++;
    tickShipping(w, rng(`rr${d}`));
    // ships already on the lane keep sailing; none may join
    spawnedOnLane += w.shipping.ships.filter((m) => m.laneId === lane.id && m.bornTick === w.tick).length;
  }
  check(spawnedOnLane === 0, 'no ships join a rerouted lane');
  check(lane.reroutedUntil !== null, 'still rerouted before the minimum period ends');
  for (let d = 0; d < 6; d++) {
    w.tick++;
    tickShipping(w, rng(`rj${d}`));
  }
  check(lane.reroutedUntil === null && /returns to the lane/.test(text(w)), 'shipping returns once the period has passed and risk has fallen');
  check(w.shipping.seq >= bornBefore, 'sequence monotonic');
}
{
  // A sinking raises the lane's risk sharply and thins its traffic.
  const w = world('sinking');
  const lane = w.shipping.lanes[0];
  for (const l of w.shipping.lanes) for (const s of l.sectors) w.sectors[s].threat = 0;
  const m = place(w, 0, 90);
  m.status = 'DISTRESS';
  m.distressUntil = w.tick;
  farAway(w);
  w.tick++;
  const r0 = lane.risk;
  tickShipping(w, rng('sink'));
  check(lane.risk > r0 + 5, `a loss raises war-risk (${r0.toFixed(1)} -> ${lane.risk.toFixed(1)})`);
}

// ---- T3: trade index -> forecast and support
{
  check(tradeFactor(100) === 1 && near(tradeFactor(0), 0.85) && tradeFactor(50) < 1 && tradeFactor(50) > tradeFactor(0), 'trade factor curve');
  const w = world('forecast');
  const f100 = forecast(w);
  w.shipping.index = 50;
  const f50 = forecast(w);
  check(near(f50.mid / f100.mid, tradeFactor(50) / f100.factors.trade), 'forecast scales with the trade index');
  check(f100.factors.trade === 1 && near(f50.factors.trade, tradeFactor(50)), 'trade factor reported');
  check(near(forecast({ politics: w.politics, resources: w.resources, tick: w.tick, tension: w.tension }).factors.trade, 1), 'forecast works without shipping (defaults to normal)');
  // Support drift differs by exactly the index term over one day.
  const a = world('drift');
  const b = world('drift');
  a.shipping.lanes = [];
  b.shipping.lanes = [];
  a.shipping.index = 100;
  b.shipping.index = 50;
  advanceDay(a);
  advanceDay(b);
  check(near(a.politics.support - b.politics.support, 50 * 0.002, 1e-9), `support drains with a low trade index (${(a.politics.support - b.politics.support).toFixed(4)})`);
  check(near(targetIndex({ lanes: [] }), 100), 'no lanes: normal index');
}

// ---- soak: index stays in range, attacks happen when uncovered, nothing goes NaN, names never leak
{
  const banned = realNameLiterals();
  for (const arch of ARCHS) {
    const w = world('soak', arch);
    let bad = 0;
    let unresolved = 0;
    let leaks = 0;
    for (let d = 0; d < 720; d++) {
      advanceDay(w);
      if (![w.shipping.index, ...w.shipping.lanes.map((l) => l.risk), ...w.shipping.ships.map((m) => m.position.x)].every(Number.isFinite)) bad++;
      if (w.shipping.index < 0 || w.shipping.index > 100) bad++;
      for (const e of w.events) {
        const f = resolveText(e.text, 'FICTIONAL');
        if (/\{[a-z]+:[A-Z0-9_]+\}/.test(f) || /\{[a-z]+:[A-Z0-9_]+\}/.test(resolveText(e.text, 'REAL'))) unresolved++;
        for (const n of banned) if (new RegExp(`(^|[^A-Za-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9])`).test(f)) leaks++;
      }
      w.events = [];
    }
    check(bad === 0, `${arch}: ${bad} bad shipping values`);
    check(unresolved === 0 && leaks === 0, `${arch}: name tokens (${unresolved} unresolved, ${leaks} real-name leaks)`);
    console.log(`${arch.padEnd(10)} 720 days: ${JSON.stringify(w.shipping.stats)} index ${w.shipping.index.toFixed(0)} support ${w.politics.support.toFixed(0)}`);
  }
  // Coverage matters, in proportion: no task force at sea, the starting fleet (one held sector), and two task forces holding the two
  // busiest lane sectors. Totals over every theatre and seed.
  const docked = (w: WorldDraft) => {
    for (const tf of allTaskForces(w.fleets)) for (const sq of tf.squadrons) for (const id of sq.shipIds) if (w.ships[id]) w.ships[id].state = 'MAINTENANCE_DOCK';
  };
  const loss = { none: 0, start: 0, heavy: 0 };
  for (const arch of ARCHS) {
    for (let s = 0; s < 5; s++) {
      for (const mode of ['none', 'start', 'heavy'] as const) {
        const w = world(`cover-${s}`, arch);
        if (mode === 'heavy') {
          const load: Record<number, number> = {};
          for (const l of w.shipping.lanes) for (const sec of l.sectors) load[sec] = (load[sec] ?? 0) + 1;
          const top = Object.entries(load).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k]) => Number(k));
          allTaskForces(w.fleets).forEach((tf, i) => top[i] !== undefined && cmd.assignTaskForce(w, tf.id, top[i]));
        }
        for (let d = 0; d < 400; d++) {
          if (mode === 'none') docked(w);
          advanceDay(w);
          w.events = [];
        }
        loss[mode] += w.shipping.stats.lost;
      }
    }
  }
  console.log(`shipping losses (3 theatres x 5 seeds x 400 days): no fleet at sea ${loss.none}, starting fleet ${loss.start}, two task forces on the busiest lane sectors ${loss.heavy}`);
  check(loss.none >= 40, `unprotected shipping does get attacked (${loss.none})`);
  check(loss.heavy <= loss.none * 0.75, `a navy holding the busy sectors protects shipping (${loss.none} vs ${loss.heavy} losses)`);
  check(loss.heavy < loss.start, `more cover, fewer losses (${loss.start} vs ${loss.heavy})`);
}

console.log(failures === 0 ? '\nSHIPPING OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

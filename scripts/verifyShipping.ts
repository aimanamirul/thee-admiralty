/**
 * Civilian shipping, phases T1-T3: lanes and traffic, raiders / protection / distress / escort, war-risk, rerouting and the trade
 * index feeding the budget forecast and domestic support. Usage: npm run verify:shipping
 */
import { realNameLiterals, resolveText } from '../lib/data/names';
import { Rng } from '../lib/generator/prng';
import * as cmd from '../lib/sim/commands';
import { tickContacts } from '../lib/sim/contactEngine';
import {
  CREW, FIND_TIPPED, FIND_UNTIPPED, FORCE_RANGE, INSPECT_DAYS, INSPECT_RANGE, NOTICE_DAYS, SEIZURE_SHARE, strikeLegal, tickInterdiction, ZONE_PC,
} from '../lib/sim/interdiction';
import { allTaskForces } from '../lib/sim/fleetEngine';
import { isWater } from '../lib/sim/navigation';
import { forecast, lobbyCost, polarizationDrift } from '../lib/sim/politicsEngine';
import { createInitialWorld } from '../lib/sim/scenario';
import {
  ATTACK_RANGE, COVER_RADIUS, DISTRESS_DAYS, generateLanes, isCovered, laneOf, MAX_MERCHANTS, MERCHANT_SPEED, pointAt, sectorHeld, premiumPct, REROUTE_DAYS,
  RISK_REROUTE, targetIndex, tickShipping, tradeFactor, trafficAt,
} from '../lib/sim/shipping';
import { createTutorialWorld } from '../lib/sim/tutorialScenario';
import { advanceDay } from '../lib/sim/worldEngine';
import type { MapArchetype, Vec2 } from '../lib/types/map';
import type { FlagFilter, Merchant } from '../lib/types/shipping';
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
function place(w: WorldDraft, laneIdx: number, d: number, id = 'MV-T', dir: 1 | -1 = 1, over: Partial<Merchant> = {}): Merchant {
  const lane = w.shipping.lanes[laneIdx];
  const { pos, heading } = pointAt(lane.path, d);
  const m: Merchant = {
    id, name: 'Test Heron', kind: 'TANKER', flag: 'OPEN_REGISTRY', laneId: lane.id, dist: d, dir, position: pos, heading, cargo: 50,
    bornTick: w.tick, status: 'UNDERWAY', distressUntil: null, escort: null, contraband: false, tip: false, checked: false, turnedBack: false, inspecting: null, ...over,
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
  check(w.shipping.seq >= seen.size && w.shipping.seq === w.shipping.stats.transited + w.shipping.stats.lost + w.shipping.stats.struck + w.shipping.stats.seized + w.shipping.stats.returned + w.shipping.ships.length, `${arch}: every ship is accounted for (${w.shipping.seq} spawned = ${w.shipping.stats.transited} arrived + ${w.shipping.stats.lost} lost + ${w.shipping.ships.length} underway)`);
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
    if (w.contacts.length !== 1) hit++; // the raid was expended: the raider attacked despite the cover
  }
  check(hit <= 60 * 0.15, `a strongly covered ship is rarely attacked (${hit}/60 incidents; graded cover is a probability, see verify:presence)`);
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
          check(attacked <= 30 * 0.45, `${arch}: attacks inside a held sector are the exception, not the rule (${attacked}/30; unprotected is 30/30)`);
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
  check(near(targetIndex({ lanes: [], zones: [] }), 100), 'no lanes: normal index');
}


// ================================================================================================= T4: inspections
/** One day of the two shipping engines with the clock advanced (no ship movement beyond what those ticks do). */
const day = (w: WorldDraft, label: string) => {
  w.tick++;
  tickShipping(w, rng(`${label}${w.tick}`));
  tickInterdiction(w, rng(`i${label}${w.tick}`));
};
/** A fresh single-ship stage: the first task force sits next to the ship, everything else far away. */
function stage(w: WorldDraft, over: Partial<Merchant>, gap = 2) {
  const sh = w.shipping;
  sh.ships = [];
  w.contacts = [];
  w.events = [];
  farAway(w);
  const tf = allTaskForces(w.fleets)[0];
  tf.escort = null;
  tf.escortMode = undefined;
  const m = place(w, 0, 100, 'MV-T', 1, over);
  tf.position = { x: m.position.x + gap, y: m.position.y };
  return { m, tf };
}

// ---- contraband odds by flag, tips: mostly right, sometimes wrong, ferries clean
{
  const seen = new Map<string, Merchant>();
  for (const arch of ARCHS) {
    for (let sd = 0; sd < 4; sd++) {
      const w = world(`odds-${sd}`, arch);
      for (let d = 0; d < 900; d++) {
        advanceDay(w);
        for (const m of w.shipping.ships) if (!seen.has(`${arch}${sd}${m.id}`)) seen.set(`${arch}${sd}${m.id}`, structuredClone(m));
        w.events = [];
      }
    }
  }
  const all = [...seen.values()];
  const rate = (f: (m: Merchant) => boolean) => {
    const g = all.filter(f);
    return { n: g.length, p: g.filter((m) => m.contraband).length / Math.max(1, g.length) };
  };
  const risky = rate((m) => (m.flag === 'OPEN_REGISTRY' || m.flag === 'ZVEZDA_NORD') && m.kind !== 'FERRY');
  const home = rate((m) => m.flag === 'DOMESTIC_YARDS' && m.kind !== 'FERRY');
  const ferry = rate((m) => m.kind === 'FERRY');
  check(all.length > 1000, `enough ships sampled (${all.length})`);
  check(risky.p > 0.06 && risky.p < 0.2, `open-registry and Eastern-flag ships carry contraband ~12% (${(risky.p * 100).toFixed(1)}% of ${risky.n})`);
  check(home.p < 0.06, `home-flag ships rarely do (${(home.p * 100).toFixed(1)}%)`);
  check(ferry.p === 0, 'ferries never carry contraband');
  const tipRight = all.filter((m) => m.contraband);
  const tipWrong = all.filter((m) => !m.contraband);
  const tipShare = tipRight.filter((m) => m.tip).length / Math.max(1, tipRight.length);
  check(tipRight.length > 40 && tipShare > 0.2 && tipShare < 0.5, `about a third of contraband ships are tipped (${(tipShare * 100).toFixed(0)}% of ${tipRight.length})`);
  check(tipWrong.filter((m) => m.tip).length / tipWrong.length < 0.08 && tipWrong.some((m) => m.tip), 'tips are sometimes wrong, but rarely');
  console.log(`sampled ${all.length} ships: contraband ${(risky.p * 100).toFixed(0)}% under open/Eastern flags, ${(home.p * 100).toFixed(0)}% home, ferries ${(ferry.p * 100).toFixed(0)}%`);
}

// ---- an ordered search: the task force goes to the ship, holds it two days, then the verdict
{
  const w = world('search-order');
  w.resources.politicalCapital = 60;
  const { m, tf } = stage(w, { flag: 'NAVAL_GROUP_THALES', contraband: false });
  check(cmd.inspectMerchantCmd(w, tf.id, m.id).ok && tf.escortMode === 'INSPECT' && m.escort === tf.id, 'search order accepted');
  check(!cmd.inspectMerchantCmd(w, tf.id, m.id).ok, 'already ordered');
  const st0 = w.vendors.NAVAL_GROUP_THALES.standing;
  const sup0 = w.politics.support;
  const ten0 = w.tension;
  day(w, 's');
  check(!!m.inspecting && m.inspecting.doneTick === w.tick + INSPECT_DAYS - 0 && /SEARCH: .* boards/.test(text(w)), 'the search begins once the task force is alongside');
  const held = m.dist;
  check(!cmd.inspectMerchantCmd(w, tf.id, m.id).ok, 'no second order while a search is under way');
  day(w, 's');
  check(m.dist === held && !!m.inspecting, 'the ship is held (it does not sail) while searched');
  for (let d = 0; d < INSPECT_DAYS; d++) day(w, 's');
  check(!m.inspecting && m.checked && !tf.escort && !m.escort, 'the search ends and the task force is released');
  check(w.shipping.stats.inspections === 1 && w.shipping.stats.seized === 0, 'a clean search is counted, nothing seized');
  check(near(st0 - w.vendors.NAVAL_GROUP_THALES.standing, 3), 'a clean search costs the flag state 3 standing');
  check(near(sup0 - w.politics.support, 1) && near(w.tension - ten0, 1), 'a clean search costs support 1 and tension +1');
  check(/SEARCH CLEAN/.test(text(w)), 'the ledger says the search found nothing');
  check(!cmd.inspectMerchantCmd(w, tf.id, m.id).ok, 'a searched ship is not searched again');
  // other flags: the cost differs
  for (const [flag, loss] of [['OPEN_REGISTRY', 0.5], ['DOMESTIC_YARDS', 0.5]] as const) {
    const w2 = world(`search-${flag}`);
    const { m: m2, tf: tf2 } = stage(w2, { flag, contraband: false });
    cmd.inspectMerchantCmd(w2, tf2.id, m2.id);
    const s0 = w2.politics.support;
    const v0 = JSON.stringify(Object.values(w2.vendors).map((v) => v.standing));
    for (let d = 0; d < INSPECT_DAYS + 1; d++) day(w2, 'f');
    check(near(s0 - w2.politics.support, loss), `${flag}: a clean search costs support ${loss}`);
    check(JSON.stringify(Object.values(w2.vendors).map((v) => v.standing)) === v0, `${flag}: no vendor state to offend`);
  }
  // a ship in distress must be helped first; ferries can be searched
  const wd = world('search-blocked');
  const { m: md, tf: tfd } = stage(wd, {});
  md.status = 'DISTRESS';
  check(!cmd.inspectMerchantCmd(wd, tfd.id, md.id).ok, 'a ship in distress is not searched');
  md.status = 'UNDERWAY';
  md.kind = 'FERRY';
  check(cmd.inspectMerchantCmd(wd, tfd.id, md.id).ok, 'a ferry may be searched (and is always clean)');
}

// ---- find rates: tipped vs untipped, and what a seizure pays
{
  const w = world('search-rates');
  w.resources.politicalCapital = 60;
  const found = { tipped: 0, untipped: 0, clean: 0 };
  const N = 400;
  for (const [key, over] of [['tipped', { contraband: true, tip: true }], ['untipped', { contraband: true, tip: false }], ['clean', { contraband: false, tip: true }]] as const) {
    for (let t = 0; t < N; t++) {
      w.tick = t * 5;
      const seized0 = w.shipping.stats.seized;
      const { m, tf } = stage(w, { flag: 'OPEN_REGISTRY', id: `MV-${key}-${t}`, cargo: 60, ...over });
      cmd.inspectMerchantCmd(w, tf.id, m.id);
      w.politics.support = 50;
      const b0 = w.resources.budget;
      const s0 = w.politics.support;
      for (let d = 0; d < INSPECT_DAYS + 2; d++) day(w, key);
      if (w.shipping.stats.seized > seized0) {
        found[key]++;
        if (t === 0 || found[key] === 1) {
          check(near(w.resources.budget - b0, Math.round(60 * SEIZURE_SHARE), 1e-9), `seizure pays ${SEIZURE_SHARE * 100}% of the cargo`);
          check(w.politics.support > s0 + 1.5, 'a seizure is worth support');
          check(!w.shipping.ships.some((x) => x.id === m.id), 'the seized ship leaves the plot');
        }
      }
    }
  }
  check(found.tipped / N > FIND_TIPPED - 0.07 && found.tipped / N < FIND_TIPPED + 0.06, `tipped contraband found ${(found.tipped / N).toFixed(2)} (~${FIND_TIPPED})`);
  check(found.untipped / N > FIND_UNTIPPED - 0.08 && found.untipped / N < FIND_UNTIPPED + 0.08, `untipped contraband found ${(found.untipped / N).toFixed(2)} (~${FIND_UNTIPPED})`);
  check(found.clean === 0, 'a wrong tip never produces a seizure');
}

// ---- sector standing order: searches matching ships that pass a task force
{
  const w = world('standing');
  farAway(w);
  const tf = allTaskForces(w.fleets)[0];
  const lane = w.shipping.lanes[0];
  const m = place(w, 0, 90, 'MV-A', 1, { flag: 'OPEN_REGISTRY' });
  const other = place(w, 0, 92, 'MV-B', 1, { flag: 'RAYTHEON' });
  const ferry = place(w, 0, 94, 'MV-C', 1, { flag: 'OPEN_REGISTRY', kind: 'FERRY' });
  const sec = sectorAtPos(w, m.position);
  tf.position = { x: m.position.x + 3, y: m.position.y };
  check(!cmd.setSectorInspectCmd(w, sec, 'DOMESTIC_YARDS' as unknown as FlagFilter).ok, 'the home flag cannot be named');
  check(cmd.setSectorInspectCmd(w, sec, 'OPEN_REGISTRY').ok && w.sectors[sec].inspect === 'OPEN_REGISTRY', 'standing order set');
  check(!cmd.setSectorInspectCmd(w, sec, 'OPEN_REGISTRY').ok, 'unchanged order refused');
  w.tick++;
  tickInterdiction(w, rng('st'));
  check(!!m.inspecting, 'a matching ship near a task force is searched');
  check(!other.inspecting && !ferry.inspecting, 'other flags and ferries are left alone');
  check(cmd.setSectorInspectCmd(w, sec, null).ok && w.sectors[sec].inspect === null, 'order cancelled');
  void lane;
}
{
  // no task force nearby: nothing happens
  const w = world('standing-none');
  farAway(w);
  const m = place(w, 0, 90, 'MV-A', 1, { flag: 'OPEN_REGISTRY' });
  const sec = sectorAtPos(w, m.position);
  cmd.setSectorInspectCmd(w, sec, 'ALL');
  for (let d = 0; d < 5; d++) day(w, 'n');
  check(!m.inspecting && !m.checked, 'a standing order does nothing without a task force close by');
}

// ================================================================================================= T5: exclusion orders
{
  // declaring: refusals, then the announced costs
  const w = world('zone-declare');
  w.resources.politicalCapital = 60;
  const secs = w.shipping.lanes[0].sectors.slice(0, 2);
  check(!cmd.declareZoneCmd(w, 'DOMESTIC_YARDS' as unknown as FlagFilter, secs, 'TURN_BACK').ok, 'the home flag cannot be barred');
  check(!cmd.declareZoneCmd(w, 'RAYTHEON', [], 'TURN_BACK').ok, 'needs a sector');
  const offLane = w.map.sectors.map((s) => s.id).filter((id) => !w.shipping.lanes.some((l) => l.sectors.includes(id)));
  if (offLane.length) check(!cmd.declareZoneCmd(w, 'RAYTHEON', [offLane[0]], 'TURN_BACK').ok, 'every sector must lie on a lane');
  w.resources.politicalCapital = 3;
  check(!cmd.declareZoneCmd(w, 'RAYTHEON', secs, 'TURN_BACK').ok, 'needs political capital');
  w.resources.politicalCapital = 60;
  w.politics.support = 20;
  check(!cmd.declareZoneCmd(w, 'RAYTHEON', secs, 'TURN_BACK').ok, 'ministries refuse below support 25');
  w.politics.support = 55;

  const pc0 = w.resources.politicalCapital;
  const st = (id: 'RAYTHEON' | 'ASELSAN') => w.vendors[id].standing;
  const [r0, a0] = [st('RAYTHEON'), st('ASELSAN')];
  const ten0 = w.tension;
  const sup0 = w.politics.support;
  const risk0 = w.shipping.lanes.map((l) => l.risk);
  const idx0 = targetIndex(w.shipping);
  w.tick = 10;
  check(cmd.declareZoneCmd(w, 'RAYTHEON', secs, 'TURN_BACK').ok, 'order declared');
  const z = w.shipping.zones[0];
  check(z.effectiveTick === 10 + NOTICE_DAYS && z.policy === 'TURN_BACK' && z.id === 'EZ-1', `notice period is ${NOTICE_DAYS} days`);
  check(near(pc0 - w.resources.politicalCapital, lobbyCost(w, ZONE_PC)), 'declaring costs political capital');
  check(near(r0 - st('RAYTHEON'), 4) && near(a0 - st('ASELSAN'), 2), 'the flag state loses 4 standing and its bloc 2');
  check(near(w.tension - ten0, 4) && near(w.politics.support - sup0, 1.5) && near(w.politics.polarization ?? 0, 6), 'tension +4, a rally of +1.5 support, polarization +6');
  check(w.shipping.lanes.some((l, i) => l.risk > risk0[i] + 7), 'lanes through the zone gain war-risk');
  check(/NOTICE 14 days, no force before day 24/.test(text(w)), 'the ledger states the notice');
  check(targetIndex(w.shipping) < idx0, 'the order lowers the trade index at once');
  check(!cmd.declareZoneCmd(w, 'RAYTHEON', secs, 'INSPECT_ALL').ok, 'a duplicate order is refused');
  check(cmd.declareZoneCmd(w, 'ZVEZDA_NORD', secs, 'INSPECT_ALL').ok && !cmd.declareZoneCmd(w, 'OPEN_REGISTRY', secs, 'INSPECT_ALL').ok, 'at most two orders at once');
  check(cmd.setZonePolicyCmd(w, 'EZ-1', 'UNRESTRICTED').ok && !cmd.setZonePolicyCmd(w, 'EZ-1', 'UNRESTRICTED').ok, 'policy can be raised, once');
  check(cmd.liftZoneCmd(w, 'EZ-2').ok && w.shipping.zones.length === 1 && !cmd.liftZoneCmd(w, 'EZ-2').ok, 'orders can be lifted');
}

// ---- no force before notice ends; policies afterwards
/** A zone stage: one ship of `flag` inside the zone with a task force alongside. */
function zoneStage(policy: 'INSPECT_ALL' | 'TURN_BACK' | 'UNRESTRICTED', over: Partial<Merchant> = {}, roe: 'WEAPONS_FREE' | 'RETURN_FIRE' = 'WEAPONS_FREE') {
  const w = world(`zone-${policy}`);
  w.resources.politicalCapital = 60;
  farAway(w);
  const tf = allTaskForces(w.fleets)[0];
  const m = place(w, 0, 100, 'MV-Z', 1, { flag: 'ZVEZDA_NORD', ...over });
  const sec = sectorAtPos(w, m.position);
  tf.position = { x: m.position.x + 3, y: m.position.y };
  w.sectors[sec].roe = roe;
  w.tick = 0;
  check(cmd.declareZoneCmd(w, 'ZVEZDA_NORD', [sec], policy).ok, `${policy}: declared`);
  return { w, m, tf, sec };
}
{
  const { w, m } = zoneStage('UNRESTRICTED');
  let acted = 0;
  for (let t = 1; t < NOTICE_DAYS; t++) {
    w.tick = t;
    tickInterdiction(w, rng(`n${t}`));
    if (m.inspecting || w.shipping.stats.struck || !w.shipping.ships.includes(m)) acted++;
  }
  check(acted === 0, 'no force is used before the notice ends');
  check(!strikeLegal(w, m), 'a strike during notice is not lawful');
  w.tick = NOTICE_DAYS;
  check(strikeLegal(w, m), 'lawful once the notice has run and the sector is at WEAPONS FREE');
  const sup0 = w.politics.support;
  const ten0 = w.tension;
  const pc0 = w.resources.politicalCapital;
  const zv0 = w.vendors.ZVEZDA_NORD.standing;
  const pol0 = w.politics.polarization ?? 0;
  const inc0 = w.stats.incidents;
  tickInterdiction(w, rng('go'));
  check(w.shipping.stats.struck === 1 && !w.shipping.ships.includes(m), 'UNRESTRICTED strikes the ship on sight after notice');
  check(w.shipping.stats.toll === CREW.TANKER && /crew casualties/.test(text(w)) && /INTERDICTION/.test(text(w)), 'the civilian toll is counted and logged');
  check(near(w.tension - ten0, 4) && near(pc0 - w.resources.politicalCapital, 3) && near(zv0 - w.vendors.ZVEZDA_NORD.standing, 10), 'tension +4, PC −3, flag-state standing −10');
  check(near(w.politics.support - sup0, 1.5) && (w.politics.polarization ?? 0) > pol0 + 3, 'a rally now, polarization up');
  check(w.stats.incidents === inc0 + 1 && w.shipping.stats.gravest === 0, 'counted as an incident, not the gravest');
}
{
  const { w, m } = zoneStage('UNRESTRICTED', {}, 'RETURN_FIRE');
  w.tick = NOTICE_DAYS;
  check(!strikeLegal(w, m), 'below WEAPONS FREE a strike is not lawful');
  tickInterdiction(w, rng('rf'));
  check(w.shipping.stats.struck === 0 && (!!m.inspecting || m.turnedBack), 'below WEAPONS FREE the order only searches and turns back');
}
{
  const { w, m } = zoneStage('INSPECT_ALL', { contraband: false });
  w.tick = NOTICE_DAYS;
  tickInterdiction(w, rng('a'));
  check(!!m.inspecting && !m.inspecting.turnAfter, 'search-and-release starts a search that releases');
  for (let d = 0; d < INSPECT_DAYS; d++) {
    w.tick++;
    tickInterdiction(w, rng(`b${d}`));
  }
  check(m.checked && !m.turnedBack && w.shipping.ships.includes(m), 'an innocent ship is released, not turned back');
}
{
  const { w, m } = zoneStage('TURN_BACK', { contraband: false });
  w.tick = NOTICE_DAYS;
  tickInterdiction(w, rng('a'));
  check(!!m.inspecting?.turnAfter, 'turn-back searches first');
  const dir0 = m.dir;
  for (let d = 0; d < INSPECT_DAYS; d++) {
    w.tick++;
    tickInterdiction(w, rng(`b${d}`));
  }
  check(m.turnedBack && m.dir === -dir0 && w.shipping.stats.turnedBack === 1, 'an innocent ship is turned back');
  // it sails home and leaves the plot without counting as a passage
  const transited0 = w.shipping.stats.transited;
  let guard = 0;
  while (w.shipping.ships.includes(m) && guard++ < 100) {
    w.tick++;
    tickShipping(w, rng(`h${guard}`));
  }
  check(w.shipping.stats.returned === 1 && w.shipping.stats.transited === transited0, 'a turned-back ship leaves without counting as a passage');
}
{
  const { w, m } = zoneStage('TURN_BACK', { contraband: true, tip: true });
  let seized = false;
  for (let t = NOTICE_DAYS; t < NOTICE_DAYS + 30 && !seized; t++) {
    w.tick = t;
    m.checked = false;
    m.inspecting = null;
    tickInterdiction(w, rng(`s${t}`));
    for (let d = 0; d < INSPECT_DAYS; d++) {
      w.tick++;
      tickInterdiction(w, rng(`s${t}${d}`));
    }
    seized = w.shipping.stats.seized > 0;
    if (!seized) {
      m.turnedBack = false;
      if (!w.shipping.ships.includes(m)) w.shipping.ships.push(m);
    }
  }
  check(seized, 'contraband found under a turn-back order is seized, not just turned back');
}
{
  // exemptions and limits: ferries, other flags, outside the zone, no task force near
  const { w, m } = zoneStage('UNRESTRICTED');
  w.tick = NOTICE_DAYS;
  const ferry = place(w, 0, 101, 'MV-F', 1, { flag: 'ZVEZDA_NORD', kind: 'FERRY' });
  const other = place(w, 0, 102, 'MV-O', 1, { flag: 'RAYTHEON' });
  const home = place(w, 0, 103, 'MV-H', 1, { flag: 'DOMESTIC_YARDS' });
  const outside = place(w, 1, 60, 'MV-X', 1, { flag: 'ZVEZDA_NORD' });
  const tf = allTaskForces(w.fleets)[0];
  tickInterdiction(w, rng('ex'));
  check(!w.shipping.ships.includes(m) && w.shipping.stats.struck === 1, 'the target is struck');
  check(w.shipping.ships.includes(ferry) && !ferry.inspecting && !ferry.checked, 'passenger ferries are exempt');
  check(w.shipping.ships.includes(other) && !other.inspecting, 'other flags are left alone');
  check(w.shipping.ships.includes(home) && !home.inspecting, 'the home flag is never targeted');
  check(w.shipping.ships.includes(outside), 'ships outside the zone sectors are left alone');
  const w2 = zoneStage('UNRESTRICTED');
  farAway(w2.w);
  w2.w.tick = NOTICE_DAYS;
  tickInterdiction(w2.w, rng('far'));
  check(w2.w.shipping.stats.struck === 0 && w2.w.shipping.ships.includes(w2.m), 'without a task force within range nothing happens');
  void tf;
}

// ---- deliberate engagement: lawful only under an order; otherwise the gravest incident
{
  const { w, m, tf } = zoneStage('UNRESTRICTED');
  check(!cmd.engageMerchantCmd(w, 'TF-NOPE', m.id).ok && !cmd.engageMerchantCmd(w, tf.id, 'MV-NOPE').ok, 'unknown ids refused');
  const ferry = place(w, 0, 101, 'MV-F', 1, { kind: 'FERRY' });
  check(!cmd.engageMerchantCmd(w, tf.id, ferry.id).ok, 'passenger ferries cannot be engaged');
  tf.position = { x: m.position.x + FORCE_RANGE + 5, y: m.position.y };
  check(!cmd.engageMerchantCmd(w, tf.id, m.id).ok, 'out of range');
  tf.position = { x: m.position.x + 3, y: m.position.y };
  // during notice: gravest
  const sup0 = w.politics.support;
  const ten0 = w.tension;
  const pc0 = w.resources.politicalCapital;
  const zv0 = w.vendors.ZVEZDA_NORD.standing;
  w.tick = 5;
  check(!strikeLegal(w, m), 'before notice ends an attack is not lawful');
  check(cmd.engageMerchantCmd(w, tf.id, m.id).ok, 'the order is carried out');
  check(w.shipping.stats.gravest === 1 && w.shipping.stats.struck === 1, 'counted as the gravest incident');
  check(near(w.tension - ten0, 20) && near(pc0 - w.resources.politicalCapital, 15) && near(sup0 - w.politics.support, 12) && near(zv0 - w.vendors.ZVEZDA_NORD.standing, 20), 'tension +20, PC −15, support −12, flag-state standing −20');
  check(/GRAVEST INCIDENT/.test(text(w)) && w.shipping.stats.toll === CREW.TANKER, 'logged, and the toll counted');
}
{
  const { w, m, tf } = zoneStage('UNRESTRICTED');
  w.tick = NOTICE_DAYS;
  const sup0 = w.politics.support;
  check(cmd.engageMerchantCmd(w, tf.id, m.id).ok && w.shipping.stats.gravest === 0, 'an ordered strike inside a lawful zone is not the gravest incident');
  check(w.politics.support > sup0, 'and rallies support at first');
}

// ---- polarization: rally now, drain later; eases only without orders in force
{
  check(polarizationDrift(0) === 0 && polarizationDrift(20) === 0 && polarizationDrift(60) > polarizationDrift(30), 'polarization drain curve');
  const a = world('pol');
  const b = world('pol');
  a.shipping.lanes = [];
  b.shipping.lanes = [];
  a.politics.polarization = 0;
  b.politics.polarization = 60;
  advanceDay(a);
  advanceDay(b);
  check(near(a.politics.support - b.politics.support, polarizationDrift(60), 1e-9), `support drains with polarization (${(a.politics.support - b.politics.support).toFixed(4)})`);
  // decay only while no order is in force
  const c = world('pol-decay');
  c.politics.polarization = 40;
  for (let d = 0; d < 10; d++) day(c, 'p');
  check((c.politics.polarization ?? 0) < 40 && (c.politics.polarization ?? 0) > 38, 'polarization eases slowly with no orders');
  c.resources.politicalCapital = 60;
  cmd.declareZoneCmd(c, 'RAYTHEON', c.shipping.lanes[0].sectors.slice(0, 1), 'INSPECT_ALL');
  const p0 = c.politics.polarization ?? 0;
  for (let d = 0; d < NOTICE_DAYS - 1; d++) day(c, 'q');
  check((c.politics.polarization ?? 0) < p0 + 0.01 && (c.politics.polarization ?? 0) >= p0 - 1.2, 'polarization decays during notice only until the order is in force');
  const before = c.politics.polarization ?? 0;
  for (let d = 0; d < 10; d++) day(c, 'r');
  check(near(c.politics.polarization ?? 0, before), 'while an order is in force it does not ease');
}

// ---- self-harm: an order against many flags thins traffic, the index, the forecast and the budget
{
  const a = world('selfharm');
  const b = world('selfharm');
  b.resources.politicalCapital = 60;
  cmd.declareZoneCmd(b, 'ALL', laneSectorsOf(b), 'INSPECT_ALL');
  for (let d = 0; d < 200; d++) {
    for (const w of [a, b]) {
      w.contacts = [];
      w.tick++;
      tickShipping(w, rng(`sh${w.tick}`));
    }
  }
  check(b.shipping.seq < a.shipping.seq * 0.7, `an order against all foreign flags cuts traffic (${b.shipping.seq} vs ${a.shipping.seq} ships)`);
  check(b.shipping.index < a.shipping.index - 20 && forecast(b).factors.trade < forecast(a).factors.trade, `the trade index and the budget forecast fall (${b.shipping.index.toFixed(0)} vs ${a.shipping.index.toFixed(0)})`);
  check(forecast(b).mid < forecast(a).mid, 'next year\'s appropriation is lower');
  cmd.liftZoneCmd(b, 'EZ-1');
  for (let d = 0; d < 200; d++) {
    b.contacts = [];
    b.tick++;
    tickShipping(b, rng(`sh2${b.tick}`));
  }
  check(b.shipping.index > 85, `lifting the order lets trade recover (${b.shipping.index.toFixed(0)})`);
}
function laneSectorsOf(w: WorldDraft): number[] {
  return [...new Set(w.shipping.lanes.flatMap((l) => l.sectors))];
}

// ---- yearly report
{
  const w = world('report');
  for (let d = 0; d < 361; d++) {
    advanceDay(w);
  }
  check(!!w.shipping.lastReport && /SHIPPING REPORT FY1: \d+ passages/.test(w.shipping.lastReport ?? ''), `year-end report written (${w.shipping.lastReport})`);
  check(w.shipping.year.counts.transited < w.shipping.stats.transited && w.shipping.year.days <= 2, 'year counters reset at year end');
  check(w.shipping.stats.transited > 0, 'running totals persist');
}

// ---- lawful interdiction soak: force never precedes notice; the toll is counted; nothing leaks or goes NaN
{
  const banned = realNameLiterals();
  let firstStrike = -1;
  let earlyForce = 0;
  let leaks = 0;
  const w = world('interdict-soak', 'CHOKEPOINT');
  w.resources.politicalCapital = 60;
  const load: Record<number, number> = {};
  for (const l of w.shipping.lanes) for (const sec of l.sectors) load[sec] = (load[sec] ?? 0) + 1;
  const top = Object.entries(load).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k]) => Number(k));
  allTaskForces(w.fleets).forEach((tf, i) => top[i] !== undefined && cmd.assignTaskForce(w, tf.id, top[i]));
  for (const sec of top) w.sectors[sec].roe = 'WEAPONS_FREE';
  let declared = -1;
  for (let d = 0; d < 260; d++) {
    if (d === 20) {
      const r = cmd.declareZoneCmd(w, 'ALL', top, 'UNRESTRICTED');
      check(r.ok, `soak: declared (${r.reason})`);
      declared = w.tick;
    }
    const force = () => w.shipping.stats.struck + w.shipping.stats.turnedBack + w.shipping.stats.inspections;
    const force0 = force();
    advanceDay(w);
    if (w.shipping.stats.struck > 0 && firstStrike < 0) firstStrike = w.tick;
    if (declared >= 0 && w.tick < declared + NOTICE_DAYS && force() > force0) earlyForce++;
    for (const e of w.events) {
      const f = resolveText(e.text, 'FICTIONAL');
      if (/\{[a-z]+:[A-Z0-9_]+\}/.test(f)) leaks++;
      for (const n of banned) if (new RegExp(`(^|[^A-Za-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9])`).test(f)) leaks++;
    }
    w.events = [];
    if (![w.politics.support, w.tension, w.politics.polarization ?? 0, w.shipping.index].every(Number.isFinite)) check(false, 'soak: NaN');
  }
  check(earlyForce === 0, `force during the notice period (${earlyForce} days)`);
  check(firstStrike === -1 || firstStrike >= declared + NOTICE_DAYS, `first strike on day ${firstStrike}, notice ended day ${declared + NOTICE_DAYS}`);
  check(w.shipping.stats.gravest === 0, 'an ordered lawful policy never produces the gravest incident by itself');
  check(w.shipping.stats.struck >= 1, 'the order was enforced: ships were struck');
  check(w.shipping.stats.toll >= w.shipping.stats.struck * 20 && w.shipping.stats.toll <= w.shipping.stats.struck * 24, `the toll is counted per ship (${w.shipping.stats.toll} for ${w.shipping.stats.struck} ships)`);
  check(leaks === 0, `${leaks} unresolved tokens or real names in interdiction text`);
  console.log(`interdiction soak: first strike day ${firstStrike} (order day ${declared}, notice ends ${declared + NOTICE_DAYS}); struck ${w.shipping.stats.struck}, toll ${w.shipping.stats.toll}, turned back ${w.shipping.stats.turnedBack}, polarization ${(w.politics.polarization ?? 0).toFixed(0)}, support ${w.politics.support.toFixed(0)}, index ${w.shipping.index.toFixed(0)}`);
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

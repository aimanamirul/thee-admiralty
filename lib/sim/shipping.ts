/**
 * Civilian shipping (docs/PLAN-shipping.md, phases T1-T3).
 *
 * - T1: lanes between map-edge gates, routed over water through the theatre's chokepoints; identified merchant ships follow them.
 * - T2: raiders prefer lane ships in uncovered waters. An active task force within COVER_RADIUS of a ship protects it; a damaged ship
 *   sends a distress call; a task force can be ordered to escort a ship (or to answer its call).
 * - T3: each lane carries a war-risk that follows sector threat and attacks. Risk cuts the lane's traffic (the insurance premium) and,
 *   past a limit, reroutes shipping away for a month. The trade index (100 = normal) feeds next year's appropriation forecast and
 *   domestic support, so protecting shipping is visible in the budget.
 *
 * Scripted (tutorial) worlds have no lanes and spawn nothing.
 */
import { ct } from '../data/tokens';
import { Rng } from '../generator/prng';
import type { TaskForce } from '../types/fleet';
import type { MapData, Vec2 } from '../types/map';
import { KIND_LABEL, KIND_TAG, type Flag, type FlagFilter, type Lane, type Merchant, type ShipKind, type ShippingState, type ShippingStats } from '../types/shipping';
import type { WorldDraft } from '../types/world';
import { allTaskForces, taskForceShipIds } from './fleetEngine';
import { findRoute, isWater, snapToWater } from './navigation';
import { adjustSupport } from './politicsEngine';

export const MERCHANT_SPEED = 4;
export const MAX_MERCHANTS = 20;
/** An active task force this close to a merchant ship protects it. */
export const COVER_RADIUS = 14;
/** A raider this close to an unprotected merchant ship attacks it. */
export const ATTACK_RANGE = 5;
export const DISTRESS_DAYS = 6;
/** Raiders steer towards lane ships within this distance when no task force is near. */
export const PREY_RANGE = 22;
/** Below this war-risk the premium costs nothing. */
export const RISK_FREE = 15;
export const RISK_REROUTE = 70;
export const RISK_REJOIN = 40;
export const REROUTE_DAYS = 30;
const RISK_SLOPE = 70;
const RISK_FOLLOWS_THREAT = 0.35;
const RISK_DRIFT = 0.04;

const clamp = (v: number, lo = 0, hi = 100) => (v < lo ? lo : v > hi ? hi : v);
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

// ------------------------------------------------------------------------------------------ names & flags

const ADJ = ['Amber', 'Coral', 'Iron', 'Silver', 'Grey', 'Bright', 'Pale', 'Tidal', 'Cobalt', 'Saffron', 'Onyx', 'Juniper', 'Northern', 'Quiet', 'Lucky', 'Steady'];
const NOUN = ['Heron', 'Trader', 'Carrier', 'Pilgrim', 'Anchor', 'Lantern', 'Venture', 'Crest', 'Harvest', 'Drifter', 'Gannet', 'Tern', 'Provider', 'Wayfarer', 'Kestrel', 'Star'];
const FLAGS: [Flag, number][] = [
  ['DOMESTIC_YARDS', 3], ['OPEN_REGISTRY', 3], ['NAVAL_GROUP_THALES', 1], ['RAYTHEON', 1], ['ASELSAN', 1], ['ZVEZDA_NORD', 1], ['NORDVIK', 1], ['SEORAK', 1],
];
const KINDS: [ShipKind, number][] = [['TANKER', 30], ['CONTAINER', 35], ['BULK', 25], ['FERRY', 10]];
const CARGO: Record<ShipKind, [number, number]> = { TANKER: [40, 90], CONTAINER: [60, 140], BULK: [20, 50], FERRY: [5, 15] };

function weighted<T>(rng: Rng, table: [T, number][]): T {
  let r = rng.range(0, table.reduce((s, [, w]) => s + w, 0));
  for (const [v, w] of table) if ((r -= w) <= 0) return v;
  return table[0][0];
}

/** Flag as display text (name token, so the skin applies). */
export function flagText(flag: FlagFilter): string {
  return flag === 'ALL' ? 'ALL FOREIGN FLAGS' : flag === 'OPEN_REGISTRY' ? 'OPEN REGISTRY' : flag === 'DOMESTIC_YARDS' ? 'HOME' : ct(flag);
}

const FLAG_TOTAL = FLAGS.reduce((a, [, w]) => a + w, 0);
/** Share of traffic sailing under a flag (foreign flags for 'ALL'). */
export function flagShare(f: FlagFilter): number {
  if (f === 'ALL') return FLAGS.filter(([x]) => x !== 'DOMESTIC_YARDS').reduce((a, [, w]) => a + w, 0) / FLAG_TOTAL;
  return (FLAGS.find(([x]) => x === f)?.[1] ?? 0) / FLAG_TOTAL;
}

export const flagMatches = (filter: FlagFilter, flag: Flag) => (filter === 'ALL' ? flag !== 'DOMESTIC_YARDS' : filter === flag);

/** Chance a ship carries contraband, by flag (ferries carry passengers, never contraband). */
function contrabandOdds(kind: ShipKind, flag: Flag): number {
  if (kind === 'FERRY') return 0;
  return flag === 'DOMESTIC_YARDS' ? 0.02 : flag === 'OPEN_REGISTRY' || flag === 'ZVEZDA_NORD' ? 0.12 : 0.05;
}

/** Add to a running total and to this fiscal year's report. */
export function count(sh: ShippingState, key: keyof ShippingStats, n = 1): void {
  sh.stats[key] += n;
  sh.year.counts[key] += n;
}

// ------------------------------------------------------------------------------------------ lanes (T1)

function pathLength(path: Vec2[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += dist(path[i - 1], path[i]);
  return len;
}

/** Position `d` tiles along the path, plus the local heading. */
export function pointAt(path: Vec2[], d: number): { pos: Vec2; heading: number } {
  let left = Math.max(0, d);
  for (let i = 1; i < path.length; i++) {
    const seg = dist(path[i - 1], path[i]);
    if (left <= seg || i === path.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, left / seg);
      return {
        pos: { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t },
        heading: Math.atan2(path[i].y - path[i - 1].y, path[i].x - path[i - 1].x),
      };
    }
    left -= seg;
  }
  return { pos: path[0], heading: 0 };
}

/** Any sample along the lane (half-tile steps) that rounds onto land. */
function clipsLand(map: MapData, path: Vec2[], length: number): boolean {
  for (let d = 0; d <= length; d += 0.5) {
    const { pos } = pointAt(path, d);
    if (!isWater(map, Math.round(pos.x), Math.round(pos.y))) return true;
  }
  return false;
}

function sectorsAlong(map: MapData, path: Vec2[], length: number): number[] {
  const out: number[] = [];
  for (let d = 0; d <= length; d += 1) {
    const { pos } = pointAt(path, d);
    const s = map.sectorGrid[Math.round(pos.y) * map.width + Math.round(pos.x)];
    if (s >= 0 && out[out.length - 1] !== s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Deterministic lanes for a theatre: up to three routes between distant map-edge gates. */
export function generateLanes(map: MapData, seed: string): Lane[] {
  const gates: Vec2[] = [];
  const edge = 2;
  const add = (x: number, y: number) => {
    if (!isWater(map, x, y) || map.clearance[y * map.width + x] < 1.5) return;
    if (gates.some((g) => dist(g, { x, y }) < 12)) return;
    gates.push({ x, y });
  };
  for (let x = 0; x < map.width; x += 3) {
    for (let e = 0; e < edge; e++) {
      add(x, e);
      add(x, map.height - 1 - e);
    }
  }
  for (let y = 0; y < map.height; y += 3) {
    for (let e = 0; e < edge; e++) {
      add(e, y);
      add(map.width - 1 - e, y);
    }
  }
  if (gates.length < 2) return [];

  const diag = Math.hypot(map.width, map.height);
  // The first lane crosses a chokepoint when the theatre has one (a strait is where traffic bunches up); fall back if none can.
  const build = (viaChoke: boolean): Lane[] => {
    const rng = new Rng(`${seed}::shipping`);
    const lanes: Lane[] = [];
    const used: Vec2[] = [];
    for (let attempt = 0; attempt < 120 && lanes.length < 3; attempt++) {
      const a = gates[rng.int(0, gates.length - 1)];
      const b = gates[rng.int(0, gates.length - 1)];
      if (dist(a, b) < diag * 0.45) continue;
      if (used.some((u) => dist(u, a) < 14 || dist(u, b) < 14)) continue;
      const route = findRoute(map, a, b, true);
      const path = [snapToWater(map, a), ...route];
      const length = pathLength(path);
      if (route.length === 0 || dist(path[path.length - 1], b) > 3 || length < dist(a, b) * 0.95) continue;
      if (viaChoke && lanes.length === 0 && !map.chokepoints.some((c) => distToPolyline(path, c.position) < 8)) continue;
      const sectors = sectorsAlong(map, path, length);
      if (sectors.length === 0 || clipsLand(map, path, length)) continue;
      used.push(a, b);
      const first = map.sectors[sectors[0]].label;
      const last = map.sectors[sectors[sectors.length - 1]].label;
      lanes.push({
        id: `LN-${lanes.length + 1}`,
        name: sectors.length > 1 ? `LANE ${lanes.length + 1}: ${first} – ${last}` : `LANE ${lanes.length + 1}: ${first}`,
        path,
        length,
        sectors,
        base: clamp(0.02 + length / 4500, 0.05, 0.09),
        risk: 0,
        traffic: 1,
        reroutedUntil: null,
      });
    }
    return lanes;
  };
  const strict = map.chokepoints.length > 0 ? build(true) : [];
  return strict.length > 0 ? strict : build(false);
}

/** Shortest distance from a point to a polyline. */
export function distToPolyline(path: Vec2[], p: Vec2): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
    best = Math.min(best, dist(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
  }
  return best;
}

// ------------------------------------------------------------------------------------------ war-risk & traffic (T3)

/** Share of normal traffic at a war-risk level (the insurance premium's effect). */
export function trafficAt(risk: number): number {
  return clamp(1 - Math.max(0, risk - RISK_FREE) / RISK_SLOPE, 0, 1);
}

/** War-risk premium shown to the player, as a percentage surcharge. */
export const premiumPct = (risk: number) => Math.round(risk * 0.8);

/** Trade index the lanes currently imply (100 = every lane at full traffic); exclusion orders divert part of it. */
export function targetIndex(s: Pick<ShippingState, 'lanes'> & Partial<Pick<ShippingState, 'zones'>>): number {
  const total = s.lanes.reduce((a, l) => a + l.base, 0);
  if (total === 0) return 100;
  const zones = s.zones ?? [];
  return (100 * s.lanes.reduce((a, l) => a + l.base * (l.reroutedUntil !== null ? 0 : l.traffic * (1 - laneAvoid({ zones }, l))), 0)) / total;
}

export { tradeFactor, TRADE_BUDGET_SHARE, TRADE_SUPPORT_DRAIN } from '../types/shipping';

export const laneOf = (s: Pick<ShippingState, 'lanes'>, id: string) => s.lanes.find((l) => l.id === id);

// ------------------------------------------------------------------------------------------ protection (T2)

export function shipsAtSea(w: WorldDraft, tf: TaskForce) {
  return taskForceShipIds(tf)
    .map((id) => w.ships[id])
    .filter((s) => !!s && s.buildStatus === 'COMMISSIONED' && !s.isPartsHulk && s.state !== 'MAINTENANCE_DOCK');
}

/** Nearest task force with a ship at sea, and its distance to `p`. */
export function nearestCover(w: WorldDraft, p: Vec2): { tf: TaskForce; d: number } | null {
  let best: { tf: TaskForce; d: number } | null = null;
  for (const tf of allTaskForces(w.fleets)) {
    const d = dist(tf.position, p);
    if ((!best || d < best.d) && shipsAtSea(w, tf).length > 0) best = { tf, d };
  }
  return best;
}

/** A task force on station this close to its sector anchor holds the sector. */
export const STATION_HOLD = 8;

/** Sector presence: a task force assigned here, on station and with a ship at sea, watches the whole sector's water. */
export function sectorHeld(w: WorldDraft, sectorId: number): boolean {
  const anchor = w.map.sectors[sectorId]?.anchor;
  if (!anchor) return false;
  return allTaskForces(w.fleets).some((tf) => tf.assignedSectorId === sectorId && dist(tf.position, anchor) <= STATION_HOLD && shipsAtSea(w, tf).length > 0);
}

/** Protected by a task force within COVER_RADIUS, or by one holding the sector the ship is in. */
export const isCovered = (w: WorldDraft, m: Merchant) => {
  const c = nearestCover(w, m.position);
  if (c && c.d <= COVER_RADIUS) return true;
  const sec = w.map.sectorGrid[Math.round(m.position.y) * w.map.width + Math.round(m.position.x)];
  return sec >= 0 && sectorHeld(w, sec);
};

/** Nearest lane ship to a point, for raiders choosing prey. */
export function nearestMerchant(s: Pick<ShippingState, 'ships'>, p: Vec2, range: number): Merchant | null {
  let best: Merchant | null = null;
  let bd = range;
  for (const m of s.ships) {
    const d = dist(m.position, p);
    if (d <= bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

/** A point on a lane inside the sector, for raiders that lie in wait on the shipping route. */
export function laneAmbush(w: Pick<WorldDraft, 'shipping' | 'map'>, sectorId: number, rng: Rng): Vec2 | null {
  const cells: Vec2[] = [];
  for (const l of w.shipping.lanes) {
    if (!l.sectors.includes(sectorId)) continue;
    for (let d = 0; d <= l.length; d += 2) {
      const { pos } = pointAt(l.path, d);
      if (w.map.sectorGrid[Math.round(pos.y) * w.map.width + Math.round(pos.x)] === sectorId) cells.push(pos);
    }
  }
  if (!cells.length) return null;
  const c = cells[rng.int(0, cells.length - 1)];
  return { x: c.x + rng.range(-2, 2), y: c.y + rng.range(-2, 2) };
}

// ------------------------------------------------------------------------------------------ escort orders (T2)

export function escortBlocked(w: WorldDraft, tfId: string, merchantId: string): string | null {
  const tf = allTaskForces(w.fleets).find((t) => t.id === tfId);
  if (!tf) return 'NO SUCH TASK FORCE';
  const m = w.shipping.ships.find((x) => x.id === merchantId);
  if (!m) return 'THAT SHIP HAS LEFT THE PLOT';
  if (shipsAtSea(w, tf).length === 0) return 'NO SHIP OF THIS TASK FORCE IS AVAILABLE AT SEA (IN DOCK OR NOT COMMISSIONED)';
  if (tf.escort === merchantId) return 'ALREADY ESCORTING THIS SHIP';
  if (m.escort && m.escort !== tfId) return `ALREADY ESCORTED BY ${allTaskForces(w.fleets).find((t) => t.id === m.escort)?.name ?? 'ANOTHER TASK FORCE'}`;
  return null;
}

export function releaseEscort(w: WorldDraft, tf: TaskForce) {
  if (!tf.escort) return;
  const m = w.shipping.ships.find((x) => x.id === tf.escort);
  if (m && m.escort === tf.id) m.escort = null;
  tf.escort = null;
}

export function orderEscort(w: WorldDraft, tfId: string, merchantId: string): { ok: boolean; reason?: string } {
  const b = escortBlocked(w, tfId, merchantId);
  if (b) return { ok: false, reason: b };
  const tf = allTaskForces(w.fleets).find((t) => t.id === tfId)!;
  const m = w.shipping.ships.find((x) => x.id === merchantId)!;
  releaseEscort(w, tf);
  tf.escort = m.id;
  tf.escortMode = 'ESCORT';
  m.escort = tf.id;
  const left = tf.assignedSectorId !== null ? ` — ${w.map.sectors[tf.assignedSectorId].label} left uncovered` : '';
  w.events.push({ severity: 'INFO', text: `ESCORT: ${tf.name} ordered to ${m.status === 'DISTRESS' ? 'the aid of' : 'escort'} ${KIND_TAG[m.kind]} ${m.name.toUpperCase()} (${flagText(m.flag)})${left}` });
  return { ok: true };
}

export function cancelEscortBlocked(w: WorldDraft, tfId: string): string | null {
  const tf = allTaskForces(w.fleets).find((t) => t.id === tfId);
  if (!tf) return 'NO SUCH TASK FORCE';
  return tf.escort ? null : 'NOT ESCORTING';
}

export function cancelEscort(w: WorldDraft, tfId: string): { ok: boolean; reason?: string } {
  const b = cancelEscortBlocked(w, tfId);
  if (b) return { ok: false, reason: b };
  const tf = allTaskForces(w.fleets).find((t) => t.id === tfId)!;
  const m = w.shipping.ships.find((x) => x.id === tf.escort);
  releaseEscort(w, tf);
  w.events.push({ severity: 'INFO', text: `ESCORT: ${tf.name} released${m ? ` from ${m.name.toUpperCase()}` : ''}; returns to its station` });
  return { ok: true };
}

// ------------------------------------------------------------------------------------------ daily tick

export function sectorOf(w: WorldDraft, m: Merchant, lane: Lane): number {
  const s = w.map.sectorGrid[Math.round(m.position.y) * w.map.width + Math.round(m.position.x)];
  return s >= 0 ? s : lane.sectors[0];
}

function spawnMerchant(w: WorldDraft, lane: Lane, rng: Rng): Merchant {
  const sh = w.shipping;
  const kind = weighted(rng, KINDS);
  const dir: 1 | -1 = rng.chance(0.5) ? 1 : -1;
  const dist0 = dir === 1 ? 0 : lane.length;
  const { pos, heading } = pointAt(lane.path, dist0);
  const [lo, hi] = CARGO[kind];
  const used = new Set(sh.ships.map((s) => s.name));
  let name = '';
  for (let i = 0; i < 12; i++) {
    name = `${rng.pick(ADJ)} ${rng.pick(NOUN)}`;
    if (!used.has(name)) break;
  }
  sh.seq++;
  const flag = weighted(rng, FLAGS);
  const contraband = rng.chance(contrabandOdds(kind, flag));
  return {
    id: `MV-${sh.seq}`,
    name,
    kind,
    flag,
    laneId: lane.id,
    dist: dist0,
    dir,
    position: pos,
    heading: dir === 1 ? heading : heading + Math.PI,
    cargo: Math.round(rng.range(lo, hi)),
    bornTick: w.tick,
    status: 'UNDERWAY',
    distressUntil: null,
    escort: null,
    contraband,
    tip: kind !== 'FERRY' && rng.chance(contraband ? 0.35 : 0.02),
    checked: false,
    turnedBack: false,
    inspecting: null,
  };
}

/** Do exclusion orders make ships of this flag avoid the lane (they still notice the notice period)? */
export function laneAvoided(sh: Pick<ShippingState, 'zones'>, lane: Lane, flag: Flag): boolean {
  return (sh.zones ?? []).some((z) => flagMatches(z.flag, flag) && z.sectors.some((s) => lane.sectors.includes(s)));
}

/** Share of a lane's traffic diverted by exclusion orders (flag share, 80% of which reroutes). */
export function laneAvoid(sh: Pick<ShippingState, 'zones'>, lane: Lane): number {
  const zones = (sh.zones ?? []).filter((z) => z.sectors.some((s) => lane.sectors.includes(s)));
  return Math.min(0.9, zones.reduce((a, z) => a + flagShare(z.flag) * 0.8, 0));
}

export function removeMerchant(w: WorldDraft, m: Merchant) {
  for (const tf of allTaskForces(w.fleets)) if (tf.escort === m.id) tf.escort = null;
  w.shipping.ships = w.shipping.ships.filter((x) => x.id !== m.id);
}

export const merchantTag = (m: Merchant) => `${KIND_TAG[m.kind]} ${m.name.toUpperCase()} (${flagText(m.flag)})`;

/** A ship is lost: sunk, taken or foundered. Everyone sees the cost. */
function loss(w: WorldDraft, m: Merchant, lane: Lane, how: 'SUNK' | 'SEIZED' | 'FOUNDERED', sectorId: number) {
  const where = w.map.sectors[sectorId].label;
  const sh = w.shipping;
  count(sh, 'lost');
  count(sh, 'cargoLost', m.cargo);
  sh.year.lossBySector[sectorId] = (sh.year.lossBySector[sectorId] ?? 0) + 1;
  lane.risk = clamp(lane.risk + (how === 'SUNK' ? 30 : how === 'SEIZED' ? 25 : 10));
  const home = m.flag === 'DOMESTIC_YARDS';
  adjustSupport(w, -(home ? 2 : 1) - (how === 'SEIZED' ? 0.5 : 0));
  w.tension = clamp(w.tension + 1);
  const verb = how === 'SUNK' ? 'sunk by a raider' : how === 'SEIZED' ? 'seized by a raider' : 'foundered before help arrived';
  w.events.push({ severity: 'CRITICAL', text: `SHIPPING LOSS: ${merchantTag(m)} ${verb} in ${where} — ${m.cargo} M cargo lost, support −${home ? 2 : 1}` });
  const escorts = allTaskForces(w.fleets).filter((t) => t.escort === m.id);
  for (const tf of escorts) w.events.push({ severity: 'WARNING', text: `ESCORT FAILED: ${tf.name} lost the ship it was assigned to` });
  removeMerchant(w, m);
}

export function tickShipping(w: WorldDraft, rng: Rng): void {
  const sh = w.shipping;
  if (sh.lanes.length === 0) return;
  // Scripted (tutorial) worlds keep hand-placed ships sailing, attacked, rescued and searched, but nothing random: no new traffic,
  // no war-risk drift, no rerouting, and the trade index stays at 100.
  const scripted = w.scripted;

  // ---- war-risk, traffic, rerouting
  for (const lane of scripted ? [] : sh.lanes) {
    const threat = lane.sectors.reduce((a, s) => a + (w.sectors[s]?.threat ?? 0), 0) / lane.sectors.length;
    lane.risk = clamp(lane.risk + (RISK_FOLLOWS_THREAT * threat - lane.risk) * RISK_DRIFT);
    lane.traffic = trafficAt(lane.risk);
    if (lane.reroutedUntil === null && lane.risk >= RISK_REROUTE) {
      lane.reroutedUntil = w.tick + REROUTE_DAYS;
      w.events.push({ severity: 'CRITICAL', text: `${lane.name}: war-risk premium +${premiumPct(lane.risk)}% — shipping REROUTES away from the lane for at least ${REROUTE_DAYS} days` });
    } else if (lane.reroutedUntil !== null && w.tick >= lane.reroutedUntil && lane.risk < RISK_REJOIN) {
      lane.reroutedUntil = null;
      w.events.push({ severity: 'ADVISORY', text: `${lane.name}: risk has fallen — shipping returns to the lane` });
    }
  }

  // ---- traffic
  for (const lane of scripted ? [] : sh.lanes) {
    if (lane.reroutedUntil !== null || sh.ships.length >= MAX_MERCHANTS) continue;
    if (!rng.chance(lane.base * lane.traffic)) continue;
    const m = spawnMerchant(w, lane, rng);
    if (laneAvoided(sh, lane, m.flag) && rng.chance(0.8)) sh.seq--; // this ship reroutes around the exclusion zone
    else sh.ships.push(m);
  }

  // ---- movement and arrival
  for (const m of [...sh.ships]) {
    const lane = laneOf(sh, m.laneId);
    if (!lane) {
      removeMerchant(w, m);
      continue;
    }
    if (m.status === 'UNDERWAY' && !m.inspecting) {
      m.dist += m.dir * MERCHANT_SPEED;
      if (m.dist <= 0 || m.dist >= lane.length) {
        if (m.turnedBack) {
          count(sh, 'returned');
          removeMerchant(w, m);
          continue;
        }
        count(sh, 'transited');
        const guards = allTaskForces(w.fleets).filter((t) => t.escort === m.id && t.escortMode !== 'INSPECT');
        if (guards.length) {
          count(sh, 'escorted');
          adjustSupport(w, 0.5);
          w.events.push({ severity: 'ADVISORY', text: `SAFE PASSAGE: ${merchantTag(m)} reaches port under ${guards[0].name}'s escort (support +0.5)` });
        }
        removeMerchant(w, m);
        continue;
      }
      const at = pointAt(lane.path, m.dist);
      m.position = at.pos;
      m.heading = m.dir === 1 ? at.heading : at.heading + Math.PI;
    }
  }

  // ---- raider attacks on unprotected lane ships
  const raiders = w.contacts.filter((c) => c.hostile);
  const attacked = new Set<string>();
  for (const c of raiders) {
    const prey = [...sh.ships].sort((a, b) => dist(a.position, c.position) - dist(b.position, c.position))[0];
    if (!prey || dist(prey.position, c.position) > ATTACK_RANGE || attacked.has(prey.id)) continue;
    if (isCovered(w, prey)) continue; // a task force nearby: the raider holds off
    attacked.add(prey.id);
    const lane = laneOf(sh, prey.laneId)!;
    const r = new Rng(`${w.seed}:merchant-attack:${w.tick}:${prey.id}`).next();
    const secId = sectorOf(w, prey, lane);
    const where = w.map.sectors[secId].label;
    w.sectors[c.sectorId].threat = clamp(w.sectors[c.sectorId].threat + 2);
    w.contacts = w.contacts.filter((x) => x.id !== c.id); // the raid is expended
    if (prey.status === 'DISTRESS' || r < 0.3) loss(w, prey, lane, 'SUNK', secId);
    else if (r < 0.5) loss(w, prey, lane, 'SEIZED', secId);
    else {
      prey.status = 'DISTRESS';
      prey.distressUntil = w.tick + DISTRESS_DAYS;
      lane.risk = clamp(lane.risk + 15);
      adjustSupport(w, -0.3);
      w.events.push({ severity: 'CRITICAL', text: `DISTRESS CALL: ${merchantTag(prey)} damaged by a raider in ${where} — help needed within ${DISTRESS_DAYS} days` });
    }
  }

  // ---- distress: rescued by a task force in range, or the ship founders
  for (const m of [...sh.ships]) {
    if (m.status !== 'DISTRESS') continue;
    const lane = laneOf(sh, m.laneId)!;
    const cover = nearestCover(w, m.position);
    if (cover && cover.d <= COVER_RADIUS) {
      m.status = 'UNDERWAY';
      m.distressUntil = null;
      count(sh, 'rescued');
      adjustSupport(w, 1);
      lane.risk = clamp(lane.risk - 5);
      w.events.push({ severity: 'ADVISORY', text: `RESCUE: ${cover.tf.name} reaches ${merchantTag(m)}; the ship resumes its passage (support +1)` });
    } else if (m.distressUntil !== null && w.tick >= m.distressUntil) {
      loss(w, m, lane, 'FOUNDERED', sectorOf(w, m, lane));
    }
  }

  // ---- trade index
  if (scripted) return;
  sh.index = clamp(sh.index + (targetIndex(sh) - sh.index) * 0.1);
  sh.year.indexSum += sh.index;
  sh.year.days++;
}

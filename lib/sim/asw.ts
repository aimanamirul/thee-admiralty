/**
 * Anti-submarine warfare (docs/PLAN-submarines.md S3). An enemy submarine is invisible until sonar finds it:
 *
 * - Sonar platforms (surface ships with hull sonar or a towed array, friendly boats on patrol) raise the contact's `track` while it is inside
 *   their reach; track decays when nobody is listening. Below TRACK_DATUM it is hidden, above it the plot shows a "possible submarine" circle that
 *   shrinks as track rises, above TRACK_HELD it is a held contact the ladder can act on.
 * - A held contact is cautious; an undetected one attacks lane ships and warships. Sonar cover near a merchant ship can foil a launch.
 * - Prosecution needs ASW weapons (torpedoes) within reach: surface ships' tubes or a friendly boat.
 *
 * Pure helpers over the world; the daily behaviour of a submarine lives in contactEngine.tickSubmarine.
 */
import { MODULE_BY_ID } from '../data/catalog';
import { Rng } from '../generator/prng';
import type { Contact, WorldDraft } from '../types/world';
import { evaluateLoadout } from './designEngine';
import { allTaskForces, taskForceShipIds } from './fleetEngine';
import { depthMultiplier, isBoat, isExposed } from './submarines';

export const SUB_WARNING_TICK = 90;
export const SUB_FIRST_TICK = 270;
export const SUB_MIN_TENSION = 20;
export const MAX_SUBS = 2;
export const SONAR_TILES_PER_KM = 0.5;
export const TRACK_DATUM = 30;
export const TRACK_HELD = 75;
export const DATUM_MAX = 12;
export const ASW_COVER_RADIUS = 14;
export const ASW_RANGE = 12;
export const STRIKE_RANGE = 9;
export const ATTACK_COOLDOWN = 7;
export const MAX_ATTACKS = 2;

export type Visibility = 'HIDDEN' | 'DATUM' | 'HELD';

export interface Platform {
  tfId: string;
  x: number;
  y: number;
  sonarKm: number;
  quality: number;
  boat: boolean;
}

export const isSub = (c: Contact) => !!c.submerged;
export const visibilityOf = (c: Contact): Visibility => {
  if (!c.submerged) return 'HELD';
  const t = c.track ?? 0;
  return t >= TRACK_HELD ? 'HELD' : t >= TRACK_DATUM ? 'DATUM' : 'HIDDEN';
};
/** Contacts the plot and lists show (hidden and datum-only submarines are not contacts). */
export const visibleContacts = (cs: readonly Contact[]) => cs.filter((c) => visibilityOf(c) === 'HELD');
export const datumContacts = (cs: readonly Contact[]) => cs.filter((c) => visibilityOf(c) === 'DATUM');
/** Radius in tiles of the "possible submarine" circle: shrinks from DATUM_MAX to 1.5 as track rises through the datum band. */
export const datumRadius = (c: Contact) => Math.max(1.5, (DATUM_MAX * (TRACK_HELD - (c.track ?? 0))) / (TRACK_HELD - TRACK_DATUM));

/** Every sonar-equipped ship or boat at sea, with where it is and how good its sonar is (friction with its combat system lowers quality). */
export function sonarPlatforms(w: WorldDraft): Platform[] {
  const out: Platform[] = [];
  for (const tf of allTaskForces(w.fleets)) {
    for (const id of taskForceShipIds(tf)) {
      const s = w.ships[id];
      if (!s || s.buildStatus !== 'COMMISSIONED' || s.isPartsHulk || s.state === 'MAINTENANCE_DOCK') continue;
      const boat = isBoat(s);
      if (boat && (s.state !== 'ACTIVE_PATROL' || isExposed(s))) continue;
      const ev = evaluateLoadout(s.hullId, s.modules.filter((m) => !m.failed).map((m) => m.moduleId), new Set());
      if (ev.sonarKm <= 0) continue;
      out.push({ tfId: tf.id, x: tf.position.x, y: tf.position.y, sonarKm: ev.sonarKm, quality: 1 / (1 + 0.6 * ev.frictionIndex), boat });
    }
  }
  return out;
}

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/** Effective reach in tiles of one platform against this contact: its sonar, the target's stealth, and how deep the water is. */
export function reachOf(w: WorldDraft, p: Platform, c: Contact): number {
  const sec = w.map.sectors[c.sectorId];
  const depth = sec ? depthMultiplier(sec) : 1;
  return p.sonarKm * SONAR_TILES_PER_KM * (1.3 - (c.stealth ?? 55) / 100) * (0.7 + 0.3 * depth) * (p.boat ? 0.9 : 1);
}

/** One day of sonar hold on a submarine contact. Returns the new visibility. */
export function trackStep(w: WorldDraft, c: Contact, platforms: Platform[]): Visibility {
  const before = visibilityOf(c);
  let gain = 0;
  for (const p of platforms) {
    const reach = reachOf(w, p, c);
    const d = dist(p.x, p.y, c.position.x, c.position.y);
    if (d <= reach) gain += 28 * (1 - 0.5 * (d / reach)) * p.quality;
  }
  c.track = Math.max(0, Math.min(100, (c.track ?? 0) + (gain > 0 ? Math.min(60, gain) : -12)));
  return before === visibilityOf(c) ? before : visibilityOf(c);
}

/** Chance that sonar cover near a point foils a submarine's launch: independent platforms, each 0.15 + sonar km / 100 (max 0.6). */
export function aswCoverAt(platforms: Platform[], x: number, y: number): number {
  let miss = 1;
  for (const p of platforms) {
    if (dist(p.x, p.y, x, y) > ASW_COVER_RADIUS) continue;
    miss *= 1 - Math.min(0.6, 0.15 + p.sonarKm / 100) * (p.boat ? 0.8 : 1) * p.quality;
  }
  return Math.min(0.9, 1 - miss);
}

/** Torpedo power within reach of a point: ASW-role weapons on working modules of ships and boats at sea, with the ships that carry them. */
export function aswPowerNear(w: WorldDraft, x: number, y: number): { power: number; shooters: string[] } {
  let power = 0;
  const shooters: string[] = [];
  for (const tf of allTaskForces(w.fleets)) {
    if (dist(tf.position.x, tf.position.y, x, y) > ASW_RANGE) continue;
    for (const id of taskForceShipIds(tf)) {
      const s = w.ships[id];
      if (!s || s.buildStatus !== 'COMMISSIONED' || s.isPartsHulk || s.state === 'MAINTENANCE_DOCK') continue;
      if (isBoat(s) && s.state !== 'ACTIVE_PATROL') continue;
      let p = 0;
      for (const m of s.modules) {
        if (m.failed) continue;
        p += evalModuleAsw(m.moduleId);
      }
      if (p > 0) {
        power += p;
        shooters.push(id);
      }
    }
  }
  return { power, shooters };
}

function evalModuleAsw(moduleId: string): number {
  const m = MODULE_BY_ID[moduleId];
  return m && m.stats.kind === 'ARMAMENT' && m.stats.role === 'ASW' ? m.stats.damage * m.stats.rounds : 0;
}

/** Kill and damage chances of one prosecution against a submarine of `strength`: ASW power against four times its strength. */
export function killChance(power: number, strength: number): { kill: number; damage: number } {
  const kill = Math.max(0.05, Math.min(0.85, power / (power + strength * 4)));
  return { kill, damage: Math.min(0.3, 1 - kill) };
}

/** Does sonar cover near a sector make a submarine think twice about appearing there? (any platform holding the sector) */
export function sectorListening(w: WorldDraft, platforms: Platform[], sectorId: number): boolean {
  const a = w.map.sectors[sectorId].anchor;
  return platforms.some((p) => dist(p.x, p.y, a.x, a.y) <= 12);
}

/** A new enemy submarine in a sector, or null (not the right time or place). Own random stream: other spawns are untouched. */
export function maybeSpawnSub(w: WorldDraft, sectorId: number, platforms: Platform[]): Contact | null {
  if (w.scripted || w.tick < SUB_FIRST_TICK || w.tension < SUB_MIN_TENSION) return null;
  if (w.contacts.filter((c) => c.submerged).length >= MAX_SUBS) return null;
  const sec = w.map.sectors[sectorId];
  const st = w.sectors[sectorId];
  const water = 1 - sec.littoralFraction;
  if (water < 0.3) return null;
  const rng = new Rng(`${w.seed}:subspawn:${w.tick}:${sectorId}`);
  let p = (0.0015 + 0.004 * (st.threat / 100)) * (1 + w.tension / 100) * water;
  if (sectorListening(w, platforms, sectorId)) p *= 0.5;
  if (!rng.chance(p)) return null;
  for (let tries = 0; tries < 60; tries++) {
    const i = rng.int(0, w.map.width * w.map.height - 1);
    if (w.map.sectorGrid[i] !== sectorId) continue;
    return {
      id: `CT-${w.tick}-${sectorId}-U`,
      sectorId,
      position: { x: i % w.map.width, y: Math.floor(i / w.map.width) },
      heading: rng.range(0, Math.PI * 2),
      cls: 'UNKNOWN',
      hostile: rng.chance(0.75),
      intent: 'SUBMARINE',
      strength: Math.round(40 + st.threat * 0.6 + rng.range(0, 20)),
      bornTick: w.tick,
      expiresTick: w.tick + rng.int(25, 45),
      submerged: true,
      track: 0,
      stealth: Math.round(45 + rng.range(0, 30)),
      attacks: 0,
      nextAttackTick: w.tick + 3,
    };
  }
  return null;
}

/** The launch reveals the boat: identified hostile, a fresh datum, a cooldown; after its second attack it breaks off. */
export function afterAttack(w: WorldDraft, c: Contact) {
  c.cls = 'HOSTILE';
  c.track = Math.max(c.track ?? 0, 60);
  c.attacks = (c.attacks ?? 0) + 1;
  c.nextAttackTick = w.tick + ATTACK_COOLDOWN;
  if (c.attacks >= MAX_ATTACKS) c.expiresTick = Math.min(c.expiresTick, w.tick + 2);
}

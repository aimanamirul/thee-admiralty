/**
 * Asynchronous engagement maths. A hostile raid is resolved as a timed defensive problem:
 * the detection window (radar horizon / missile speed) is eaten by CMS reaction time and sensor
 * tracking lag — both inflated by unbridged protocol friction — before interceptors can fly.
 */
import type { DesignEvaluation } from '../types/hull';
import type { Roe } from '../types/world';
import type { Rng } from '../generator/prng';
import { SKIMMER_HORIZON_KM } from './designEngine';

export interface Combatant {
  id: string;
  label: string;
  eval: DesignEvaluation;
  /** 0-100 */
  readiness: number;
  /** 0-100 */
  veterancy: number;
  /** 0-100 */
  integrity: number;
  structuralHP: number;
}

export interface HostileGroup {
  /** 15-100 threat scalar. */
  strength: number;
}

export interface EngagementContext {
  roe: Roe;
  /** Attacker opened fire from ambush (HOLD_FIRE sensors-cold posture). */
  surprise: boolean;
  littoralFraction: number;
}

export type Outcome = 'DESTROYED' | 'REPELLED' | 'DEFEAT';

export interface EngagementResult {
  outcome: Outcome;
  incoming: number;
  intercepted: number;
  leakers: number;
  /** Integrity % lost per ship id. */
  damage: Record<string, number>;
  hostileDamageFraction: number;
  /** Average seconds of engagement window lost to protocol friction. */
  frictionCostSec: number;
  /** Who fired how much (for the battle report). */
  shooters: { id: string; shots: number; kills: number; windowSec: number }[];
  /** Missiles that struck each ship. */
  hits: Record<string, number>;
  /** Longest detection range among the defenders, km (0 = no warning at all). */
  warningKm: number;
  log: string[];
}

/** A hull hit hard is crippled, not deleted: one engagement leaves at least this much integrity unless the raid overkilled it badly. */
export const CRIPPLED_FLOOR = 5;
/** A survivor below this integrity breaks off at once and returns to dock for repair. */
export const WITHDRAW_BELOW = 35;

/**
 * Chance a ship is lost, given its integrity going in and the damage the raid dealt it (both in % of the hull). Surviving needs no
 * roll. Overkill is wasted on a hull that is already crippled: it is sunk only if the raid hit it several times over (damage
 * 3.5x its remaining integrity is a 71% loss; 2.5x is 43%; 1.5x is 14%; 1.1x is 3%).
 */
export function sinkChance(integrityBefore: number, damage: number): number {
  const over = damage / Math.max(1, integrityBefore) - 1;
  return Math.max(0, Math.min(0.9, over / 3.5));
}

const SKIMMER_KM_PER_SEC = 0.28;
const CYCLE_SEC = 6;

/** Hostile raid parameters derived from strength. */
export function raidProfile(h: HostileGroup) {
  return {
    missiles: Math.round(4 + h.strength / 6),
    missileDamage: 30 + h.strength * 0.4,
    hp: 80 + h.strength * 6,
  };
}

function powerFactor(e: DesignEvaluation): number {
  return e.powerDrawMW <= 0 ? 1 : Math.max(0.3, Math.min(1, e.powerGenerationMW / e.powerDrawMW));
}

export function resolveEngagement(
  rng: Rng,
  defenders: Combatant[],
  hostile: HostileGroup,
  ctx: EngagementContext,
): EngagementResult {
  const raid = raidProfile(hostile);
  const log: string[] = [];
  const damage: Record<string, number> = Object.fromEntries(defenders.map((d) => [d.id, 0]));
  let intercepted = 0;
  let frictionLost = 0;
  let frictionSamples = 0;
  const shooters: EngagementResult['shooters'] = [];
  let warningKm = 0;

  const windowBase = (ctx.surprise ? 0.5 : 1) * (ctx.roe === 'WEAPONS_FREE' ? 1.25 : 1);

  // ---- defence: pooled area air defence limited by each ship's window and track capacity
  for (const d of defenders) {
    const e = d.eval;
    const pf = powerFactor(e);
    const effRange = Math.min(SKIMMER_HORIZON_KM, e.detectionKm * pf);
    const window = (effRange / SKIMMER_KM_PER_SEC) * windowBase;
    warningKm = Math.max(warningKm, effRange);
    const noFriction = e.reactionSec / e.reactionMultiplier;
    const lost = e.reactionSec - noFriction + e.trackingLagSec;
    frictionLost += lost;
    frictionSamples++;
    const usable = window - e.reactionSec - e.trackingLagSec;
    if (usable <= 0 || e.interceptors <= 0) {
      shooters.push({ id: d.id, shots: 0, kills: 0, windowSec: Math.max(0, usable) });
      log.push(`${d.label}: NO ENGAGEMENT WINDOW (${window.toFixed(0)}s − ${(e.reactionSec + e.trackingLagSec).toFixed(1)}s reaction/lag)`);
      continue;
    }
    const volleys = Math.floor(usable / CYCLE_SEC);
    const trackLimit = Math.max(1, e.trackCapacity);
    const shots = Math.min(Math.floor(e.interceptors * pf), Math.max(0, e.channels) * volleys, trackLimit, 64);
    const pk = 0.55 * (0.4 + 0.6 * d.readiness / 100) * (0.85 + 0.3 * d.veterancy / 100) * (0.6 + 0.4 * d.integrity / 100);
    let kills = 0;
    for (let s = 0; s < shots; s++) if (rng.chance(Math.min(0.9, pk))) kills++;
    intercepted += kills;
    shooters.push({ id: d.id, shots, kills, windowSec: usable });
    log.push(`${d.label}: ${shots} interceptors fired, ${kills} kills (window ${usable.toFixed(0)}s${lost > 0.5 ? `, friction cost ${lost.toFixed(1)}s` : ''})`);
  }
  intercepted = Math.min(intercepted, raid.missiles);
  const leakers = raid.missiles - intercepted;

  // ---- leakers hit random ships
  const hits: Record<string, number> = {};
  for (let i = 0; i < leakers; i++) {
    const target = rng.pick(defenders);
    hits[target.id] = (hits[target.id] ?? 0) + 1;
    const dmg = raid.missileDamage * rng.range(0.7, 1.3);
    damage[target.id] += (dmg / target.structuralHP) * 100;
  }
  for (const d of defenders) {
    if (damage[d.id] > 0) log.push(`${d.label}: HIT — integrity −${Math.min(100, damage[d.id]).toFixed(0)}%${damage[d.id] > 100 ? ' (overwhelmed)' : ''}`);
  }

  // ---- offence: SSM salvos and guns against the hostile group
  let dealt = 0;
  for (const d of defenders) {
    const e = d.eval;
    const survive = Math.max(0, 1 - damage[d.id] / Math.max(1, d.integrity)); // crippled ships shoot less
    const delay = 1 / (1 + 0.4 * e.frictionIndex);
    dealt += e.firepower * powerFactor(e) * (d.readiness / 100) * delay * survive * (0.85 + 0.3 * d.veterancy / 100) * rng.range(0.45, 0.85);
  }
  if (ctx.surprise) dealt *= 0.7;
  const hostileDamageFraction = Math.min(1, dealt / raid.hp);

  const sunk = defenders.some((d) => d.integrity - damage[d.id] <= 0);
  let outcome: Outcome;
  if (sunk && hostileDamageFraction < 1) outcome = 'DEFEAT';
  else if (hostileDamageFraction >= 1) outcome = 'DESTROYED';
  else if (hostileDamageFraction >= 0.45 || leakers <= 1) outcome = 'REPELLED';
  else outcome = 'DEFEAT';

  log.unshift(`RAID: ${raid.missiles} inbound — ${intercepted} intercepted, ${leakers} leakers; hostile group ${(hostileDamageFraction * 100).toFixed(0)}% degraded`);
  return {
    outcome,
    incoming: raid.missiles,
    intercepted,
    leakers,
    damage,
    hostileDamageFraction,
    frictionCostSec: frictionSamples ? frictionLost / frictionSamples : 0,
    shooters,
    hits,
    warningKm,
    log,
  };
}

/**
 * Submarine service (docs/PLAN-submarines.md S2). A boat deters by uncertainty, not by being seen:
 *
 * - Stance (per boat): PATROL snorkels on schedule: full deterrence, a weaker ambush, a daily chance of being counter-detected.
 *   STEALTH stays submerged: 40% of the deterrence, the full ambush, almost no exposure, but it drains its submerged endurance and
 *   must then spend a few days recharging (snorkelling) before it is quiet again.
 * - Depth: abyssal water is ideal (1.0), shelf 0.7, littoral 0.3; everything a boat does is scaled by the sector's mix.
 * - Indiscretion: a counter-detected boat (exposed for EXPOSED_DAYS) deters nothing and cannot ambush. Quiet hulls, AIP and Li-ion
 *   lower the daily risk; littoral water and high tension raise it.
 * - Ambush: the first strike on a raid in a sector the boat holds, before the surface engagement.
 *
 * Pure helpers; the daily state change is `boatDay`, called from the fleet engine.
 */
import { hullPlatform, HULLS } from '../data/catalog';
import { Rng } from '../generator/prng';
import type { Ship } from '../types/fleet';
import type { WorldDraft } from '../types/world';
import { evaluateLoadout } from './designEngine';

export type Stance = 'STEALTH' | 'PATROL';

export const SUB_PATROL_LIMIT_DAYS = 45;
export const SUB_DOCK_DAYS = 14;
export const RECHARGE_DAYS = 4;
export const EXPOSED_DAYS = 6;
/** Share of a surface force's deterrence by stance, before depth. */
export const STANCE_DETERRENCE: Record<Stance, number> = { STEALTH: 0.4, PATROL: 1 };
/** Strength of the opening strike by stance. */
export const STANCE_AMBUSH: Record<Stance, number> = { STEALTH: 1, PATROL: 0.6 };
/** Raid strength removed per point of torpedo / missile firepower (before depth and stance), capped at AMBUSH_CAP of the raid. */
export const AMBUSH_PER_FIREPOWER = 0.04;
export const AMBUSH_CAP = 0.6;
/** A raiding group reduced below this strength is no longer a force: it is destroyed before reaching the surface ships. */
export const AMBUSH_ROUT = 10;
const BASE_RISK = 0.02;

export const isBoat = (ship: Ship) => hullPlatform(HULLS[ship.hullId]) === 'SUBSURFACE';
export const stanceOf = (ship: Ship): Stance => ship.stance ?? 'PATROL';
export const patrolLimit = (ship: Ship) => (isBoat(ship) ? SUB_PATROL_LIMIT_DAYS : 30);
export const dockDays = (ship: Ship, surfaceDays: number) => (isBoat(ship) ? SUB_DOCK_DAYS : surfaceDays);

interface Sector {
  littoralFraction: number;
  abyssalFraction: number;
}

/** Abyssal 1.0, shelf 0.7, littoral 0.3, by the sector's tile mix. */
export function depthMultiplier(sec: Sector): number {
  const shelf = Math.max(0, 1 - sec.abyssalFraction - sec.littoralFraction);
  return sec.abyssalFraction * 1 + shelf * 0.7 + sec.littoralFraction * 0.3;
}

/** Working-module figures of a boat. */
export function boatFigures(ship: Ship) {
  const working = ship.modules.filter((m) => !m.failed).map((m) => m.moduleId);
  const ev = evaluateLoadout(ship.hullId, working, new Set());
  return { stealth: ev.stealth, submergedDays: ev.submergedDays, sonarKm: ev.sonarKm, firepower: ev.firepower };
}

export const isExposed = (ship: Ship) => (ship.exposedDays ?? 0) > 0;
export const isRecharging = (ship: Ship) => (ship.rechargeDays ?? 0) > 0;

/** Deterrence factor for presence: stance, zero while counter-detected, halved while snorkelling to recharge. */
export function deterrenceFactor(ship: Ship): number {
  if (isExposed(ship)) return 0;
  return STANCE_DETERRENCE[stanceOf(ship)] * (isRecharging(ship) ? 0.5 : 1);
}

/** Opening-strike factor: zero while counter-detected or recharging. */
export function ambushFactor(ship: Ship): number {
  if (isExposed(ship) || isRecharging(ship) || ship.state !== 'ACTIVE_PATROL') return 0;
  return STANCE_AMBUSH[stanceOf(ship)];
}

/** Daily chance of being counter-detected on patrol (before the stance multiplier). */
export function indiscretionRisk(stealth: number, sec: Sector | undefined, tension: number): number {
  const quiet = 1.7 - (stealth / 100) * 1.4;
  return BASE_RISK * quiet * (1 + 1.5 * (sec?.littoralFraction ?? 0)) * (1 + tension / 100);
}

/** Risk today for this boat in this stance (STEALTH almost never snorkels; recharging snorkels more than usual). */
export function dailyRisk(ship: Ship, sec: Sector | undefined, tension: number): number {
  const base = indiscretionRisk(boatFigures(ship).stealth, sec, tension);
  if (isRecharging(ship)) return base * 1.6;
  return stanceOf(ship) === 'STEALTH' ? base * 0.1 : base;
}

/** One day on patrol for a boat: endurance, recharge, exposure. */
export function boatDay(world: WorldDraft, ship: Ship, sec: Sector | undefined): void {
  const fig = boatFigures(ship);
  const label = `${ship.pennant} ${ship.name.toUpperCase()}`;
  if (ship.submergedLeft === undefined) ship.submergedLeft = fig.submergedDays;
  if (isExposed(ship)) ship.exposedDays = (ship.exposedDays ?? 0) - 1;
  const risk = dailyRisk(ship, sec, world.tension);

  if (isRecharging(ship)) {
    ship.rechargeDays = (ship.rechargeDays ?? 0) - 1;
    if (!isRecharging(ship)) {
      ship.submergedLeft = fig.submergedDays;
      world.events.push({ severity: 'INFO', text: `${label}: batteries recharged — quiet again (${fig.submergedDays} days submerged)` });
    }
  } else if (stanceOf(ship) === 'STEALTH') {
    ship.submergedLeft = Math.max(0, ship.submergedLeft - 1);
    if (ship.submergedLeft === 0) {
      ship.rechargeDays = RECHARGE_DAYS;
      world.events.push({ severity: 'WARNING', text: `${label}: submerged endurance spent — snorkelling to recharge for ${RECHARGE_DAYS} days, no ambush until quiet` });
    }
  } else {
    ship.submergedLeft = Math.min(fig.submergedDays, ship.submergedLeft + 1);
  }

  if (!isExposed(ship) && new Rng(`${world.seed}:indiscretion:${world.tick}:${ship.id}`).chance(risk)) {
    ship.exposedDays = EXPOSED_DAYS;
    world.events.push({ severity: 'WARNING', text: `${label}: COUNTER-DETECTED while snorkelling — no deterrence or ambush for ${EXPOSED_DAYS} days` });
  }
}

/** Raid strength a set of boats removes before the surface engagement, and who struck. */
export function ambushOf(boats: Ship[], sec: Sector, strength: number): { reduction: number; strikers: Ship[] } {
  const depth = depthMultiplier(sec);
  let power = 0;
  const strikers: Ship[] = [];
  for (const b of boats) {
    const f = ambushFactor(b);
    if (f <= 0) continue;
    power += boatFigures(b).firepower * AMBUSH_PER_FIREPOWER * depth * f;
    strikers.push(b);
  }
  return { reduction: Math.min(strength * AMBUSH_CAP, power), strikers };
}

export const ambushLine = (strikers: Ship[], from: number, to: number) =>
  `AMBUSH: ${strikers.map((s) => `${s.pennant} ${s.name.toUpperCase()}`).join(', ')} strike${strikers.length === 1 ? 's' : ''} the raiding group from beneath — raid strength ${from.toFixed(0)} → ${to.toFixed(0)}`;

export const stanceBlocked = (world: WorldDraft, shipId: string, stance: Stance): string | null => {
  const s = world.ships[shipId];
  if (!s || s.buildStatus !== 'COMMISSIONED' || s.isPartsHulk) return 'ONLY A COMMISSIONED SUBMARINE HAS A STANCE';
  if (!isBoat(s)) return 'SURFACE SHIPS HAVE NO STANCE';
  if (stanceOf(s) === stance) return `ALREADY ON ${stance}`;
  return null;
};

export function setStance(world: WorldDraft, shipId: string, stance: Stance): { ok: boolean; reason?: string; message?: string } {
  const why = stanceBlocked(world, shipId, stance);
  if (why) return { ok: false, reason: why };
  const s = world.ships[shipId];
  s.stance = stance;
  world.events.push({ severity: 'INFO', text: `${s.pennant} ${s.name.toUpperCase()}: stance ${stance}` });
  return { ok: true, message: `Stance ${stance}` };
}


/**
 * Civil-military politics and the navy's money (docs/PLAN-command-and-economy.md §2).
 *
 * - Money arrives as an annual APPROPRIATION paid in four quarterly tranches; it leaves as RUNNING COSTS (crew wages even in dock,
 *   fuel and yard fees by state, base overhead, ageing) plus purchases. At year end up to 15% carries over and the rest returns to
 *   the Treasury, so hoarding is impossible.
 * - Next year's appropriation is a FORECAST RANGE that moves with domestic support, tension, the spending pace and budget hearings,
 *   and locks 30 days before year end.
 * - DOMESTIC SUPPORT (0-100) integrates the navy's record; low support makes lobbying dearer, then refused, drains political
 *   capital, and below 10 triggers a parliamentary inquiry.
 */
import { type ShippingState, tradeFactor, TRADE_SUPPORT_DRAIN } from '../types/shipping';
import { HULLS } from '../data/catalog';
import { Rng } from '../generator/prng';
import type { Ship } from '../types/fleet';
import type { HullClassId } from '../types/hull';
import type { PoliticsState, WorldDraft } from '../types/world';

export const FISCAL_YEAR_DAYS = 360;
export const TRANCHES_PER_YEAR = 4;
export const TRANCHE_DAYS = FISCAL_YEAR_DAYS / TRANCHES_PER_YEAR;
export const FORECAST_LOCK_DAY = 330;
export const CARRYOVER_SHARE = 0.15;
export const UNDERSPEND_PACE = 0.7;
export const BASE_APPROPRIATION = 3000;
export const HEARING_PC = 10;
export const HEARING_COOLDOWN_DAYS = 60;
export const HEARING_BOOST = 0.06;
export const HEARING_BOOST_CAP = 0.2;
export const ELECTION_EVERY_DAYS = 720;
export const INQUIRY_DAYS = 30;
/** Scales the per-hull upkeep figures in the catalogue into daily money. */
export const UPKEEP_SCALE = 2.5;

/** Graduated support thresholds (decided): each is shown to the player in advance. */
export const SUPPORT_STRAINED = 40;
export const SUPPORT_HOSTILE = 25;
export const SUPPORT_INQUIRY = 10;

const clamp = (v: number, lo = 0, hi = 100) => (v < lo ? lo : v > hi ? hi : v);

// ------------------------------------------------------------------------------------------ running costs

export interface RunningCosts {
  wages: number;
  operations: number;
  overhead: number;
  total: number;
}

/** Daily cost of one hull in a given state (wages + fuel / yard fees), before ageing. */
export function hullDailyCost(hullId: HullClassId, state: Ship['state'] | 'HULK'): number {
  const base = HULLS[hullId].upkeepPerDay * UPKEEP_SCALE;
  if (state === 'HULK') return base * 0.05;
  const ops = state === 'ACTIVE_PATROL' ? 0.5 : state === 'TRANSIT_WORKUP' ? 0.25 : 0.15;
  return base * (0.6 + ops);
}

export function runningCosts(ships: Iterable<Ship>, tick: number): RunningCosts {
  let wages = 0;
  let operations = 0;
  let hulls = 0;
  for (const s of ships) {
    if (s.buildStatus !== 'COMMISSIONED') continue;
    const base = HULLS[s.hullId].upkeepPerDay * UPKEEP_SCALE;
    const age = 1 + 0.03 * Math.max(0, tick - (s.commissionedTick ?? 0)) / FISCAL_YEAR_DAYS;
    if (s.isPartsHulk) {
      operations += base * 0.05;
      continue;
    }
    hulls++;
    wages += base * 0.6 * age;
    operations += (hullDailyCost(s.hullId, s.state) - base * 0.6) * age;
  }
  const overhead = 1 + 0.1 * hulls;
  return { wages, operations, overhead, total: wages + operations + overhead };
}

// ------------------------------------------------------------------------------------------ fiscal year

export const dayOfYear = (tick: number) => tick % FISCAL_YEAR_DAYS;
export const trancheAmount = (p: PoliticsState) => p.fiscal.appropriation / TRANCHES_PER_YEAR;
export const daysToNextTranche = (tick: number) => TRANCHE_DAYS - (dayOfYear(tick) % TRANCHE_DAYS);

/** Money spent this fiscal year (purchases + running costs), derived from balances so no spend site needs a hook. */
export function spentThisYear(w: Pick<WorldDraft, 'politics' | 'resources'>): number {
  const f = w.politics.fiscal;
  return f.openingBalance + f.tranchesPaid * (f.appropriation / TRANCHES_PER_YEAR) - w.resources.budget;
}

export interface Forecast {
  low: number;
  mid: number;
  high: number;
  locked: boolean;
  /** Share of the year's money spent relative to time elapsed (1 = on pace). */
  pace: number;
  factors: { support: number; tension: number; underspend: number; hearing: number; inquiry: number; trade: number };
}

export function forecast(w: Pick<WorldDraft, 'politics' | 'resources' | 'tick' | 'tension'> & { shipping?: Pick<ShippingState, 'index'> }): Forecast {
  const p = w.politics;
  const doy = dayOfYear(w.tick);
  const elapsed = Math.max(60, doy) / FISCAL_YEAR_DAYS;
  const pace = spentThisYear(w) / Math.max(1, p.fiscal.appropriation * elapsed);
  const factors = {
    support: 0.6 + (0.8 * p.support) / 100,
    tension: 1 + 0.4 * Math.max(-0.5, Math.min(1, (w.tension - 30) / 70)),
    underspend: pace >= UNDERSPEND_PACE ? 1 : 0.7 + (0.3 * Math.max(0, pace)) / UNDERSPEND_PACE,
    hearing: 1 + p.fiscal.hearingBoost,
    inquiry: p.fiscal.inquiryPenalty ? 0.8 : 1,
    trade: tradeFactor(w.shipping?.index ?? 100),
  };
  if (p.fiscal.lockedForecast !== null) {
    const v = p.fiscal.lockedForecast;
    return { low: v, mid: v, high: v, locked: true, pace, factors };
  }
  const mid = BASE_APPROPRIATION * factors.support * factors.tension * factors.underspend * factors.hearing * factors.inquiry * factors.trade;
  const u = 0.1 * Math.max(0, 1 - doy / FORECAST_LOCK_DAY);
  return { low: mid * (1 - u), mid, high: mid * (1 + u), locked: false, pace, factors };
}

export function initialPolitics(opts: { support: number; appropriation: number; openingBalance: number; scripted: boolean }): PoliticsState {
  return {
    support: opts.support,
    fiscal: {
      year: 1,
      appropriation: opts.appropriation,
      tranchesPaid: 1,
      openingBalance: opts.openingBalance,
      hearingBoost: 0,
      lockedForecast: null,
      inquiryPenalty: false,
    },
    hearingReadyTick: 0,
    inquiryUntil: null,
    nextElectionTick: opts.scripted ? Number.MAX_SAFE_INTEGER : ELECTION_EVERY_DAYS,
  };
}

// ------------------------------------------------------------------------------------------ support

export function adjustSupport(w: WorldDraft, delta: number): void {
  w.politics.support = clamp(w.politics.support + delta);
}

/** Political-capital price of a lobbying round at the current support level. */
export function lobbyCost(w: Pick<WorldDraft, 'politics'>, base: number): number {
  return w.politics.support < SUPPORT_STRAINED ? Math.ceil(base * 1.5) : base;
}

/** Reason ministries refuse to engage, or null. */
export function ministriesRefuse(w: Pick<WorldDraft, 'politics'>): string | null {
  const s = w.politics.support;
  return s < SUPPORT_HOSTILE ? `MINISTRIES REFUSE CONTACT — DOMESTIC SUPPORT ${s.toFixed(0)} < ${SUPPORT_HOSTILE}` : null;
}

export function procurementFrozen(w: Pick<WorldDraft, 'politics' | 'tick'>): string | null {
  const until = w.politics.inquiryUntil;
  return until !== null && w.tick < until ? `PARLIAMENTARY INQUIRY — PROCUREMENT FROZEN UNTIL DAY ${until}` : null;
}

export function pcRegenPerDay(w: Pick<WorldDraft, 'politics'>): number {
  const s = w.politics.support;
  return s < SUPPORT_HOSTILE ? -0.2 : s < SUPPORT_STRAINED ? 0.175 : 0.35;
}

// ------------------------------------------------------------------------------------------ budget hearing

export function hearingChance(w: Pick<WorldDraft, 'politics'>): number {
  return 0.25 + (0.6 * w.politics.support) / 100;
}

export function hearingBlocked(w: Pick<WorldDraft, 'politics' | 'tick' | 'resources'>): string | null {
  const refuse = ministriesRefuse(w);
  if (refuse) return refuse;
  if (w.politics.fiscal.lockedForecast !== null) return 'APPROPRIATION ALREADY SET FOR NEXT YEAR';
  if (w.tick < w.politics.hearingReadyTick) return `NEXT HEARING POSSIBLE ON DAY ${w.politics.hearingReadyTick}`;
  if (w.politics.fiscal.hearingBoost >= HEARING_BOOST_CAP - 1e-9) return 'HEARING GAINS AT THE CAP FOR THIS YEAR';
  const cost = lobbyCost(w, HEARING_PC);
  if (w.resources.politicalCapital < cost) return `NEEDS ${cost} POLITICAL CAPITAL`;
  return null;
}

/** Demand a larger appropriation before the finance committee. Outcome is rolled; the chance is shown in advance. */
export function budgetHearing(w: WorldDraft): { ok: boolean; reason?: string } {
  const blocked = hearingBlocked(w);
  if (blocked) return { ok: false, reason: blocked };
  const cost = lobbyCost(w, HEARING_PC);
  w.resources.politicalCapital -= cost;
  w.politics.hearingReadyTick = w.tick + HEARING_COOLDOWN_DAYS;
  const rng = new Rng(`${w.seed}:hearing:${w.tick}:${w.politics.fiscal.year}`);
  if (rng.chance(hearingChance(w))) {
    w.politics.fiscal.hearingBoost = Math.min(HEARING_BOOST_CAP, w.politics.fiscal.hearingBoost + HEARING_BOOST);
    w.events.push({ severity: 'ADVISORY', text: `BUDGET HEARING: committee persuaded — next year's appropriation +${Math.round(HEARING_BOOST * 100)}% (−${cost} PC)` });
  } else {
    adjustSupport(w, -4);
    w.events.push({ severity: 'WARNING', text: `BUDGET HEARING: demand rejected as excessive — domestic support −4 (−${cost} PC)` });
  }
  return { ok: true };
}

// ------------------------------------------------------------------------------------------ daily tick

const M = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(2)}B` : `${n.toFixed(0)}M`);

export function tickPolitics(w: WorldDraft, rng: Rng): void {
  const p = w.politics;
  const f = p.fiscal;
  const doy = dayOfYear(w.tick);

  // ---- year end / new year (tick 360, 720, ...)
  if (doy === 0 && w.tick > 0) {
    const locked = f.lockedForecast ?? forecast(w).mid;
    const b = w.resources.budget;
    if (b > 0) {
      const carry = Math.min(b, CARRYOVER_SHARE * f.appropriation);
      w.resources.budget = carry;
      w.events.push({
        severity: b - carry > 1 ? 'WARNING' : 'INFO',
        text: `FISCAL YEAR ${f.year} CLOSED: ${M(carry)} carried over, ${M(b - carry)} returned to the Treasury`,
      });
    } else {
      adjustSupport(w, -5);
      w.events.push({ severity: 'CRITICAL', text: `FISCAL YEAR ${f.year} CLOSED IN DEFICIT (${M(b)}) — debt carried forward, domestic support −5` });
    }
    p.fiscal = {
      year: f.year + 1,
      appropriation: locked,
      tranchesPaid: 1,
      openingBalance: w.resources.budget,
      hearingBoost: 0,
      lockedForecast: null,
      inquiryPenalty: false,
    };
    w.resources.budget += locked / TRANCHES_PER_YEAR;
    w.events.push({ severity: 'ADVISORY', text: `FISCAL YEAR ${f.year + 1}: appropriation ${M(locked)} — first tranche ${M(locked / TRANCHES_PER_YEAR)} received` });
  } else if (doy % TRANCHE_DAYS === 0 && doy > 0 && f.tranchesPaid < TRANCHES_PER_YEAR) {
    f.tranchesPaid++;
    w.resources.budget += trancheAmount(p);
    w.events.push({ severity: 'INFO', text: `TREASURY: quarter ${f.tranchesPaid} tranche received (${M(trancheAmount(p))})` });
  }

  // ---- running costs
  const costs = runningCosts(Object.values(w.ships), w.tick);
  w.resources.budget -= costs.total;

  // ---- lock next year's appropriation
  if (doy === FORECAST_LOCK_DAY && p.fiscal.lockedForecast === null) {
    p.fiscal.lockedForecast = forecast(w).mid;
    w.events.push({ severity: 'ADVISORY', text: `APPROPRIATION SET: fiscal year ${p.fiscal.year + 1} budget will be ${M(p.fiscal.lockedForecast)}` });
  }

  // ---- support drift: reversion to 50, rally under tension, strain from deficits, frozen builds and exposed sectors
  const frozen = Object.values(w.ships).filter((s) => s.buildStatus === 'CONSTRUCTING' && s.frozenBy).length;
  const exposed = w.map.sectors.filter((s) => {
    const st = w.sectors[s.id];
    if (!st || st.threat <= 60) return false;
    return !w.fleets.some((fl) => fl.taskForces.some((tf) => tf.assignedSectorId === s.id));
  }).length;
  let drift = (50 - p.support) * 0.004 + (w.tension - 40) * 0.003 - 0.05 * frozen - 0.015 * exposed + (w.shipping.index - 100) * TRADE_SUPPORT_DRAIN;
  if (w.resources.budget < 0) {
    drift -= 0.3;
    if (w.tick % 10 === 0) w.events.push({ severity: 'WARNING', text: `NAVY OVERSPENT (${M(w.resources.budget)}) — domestic support eroding` });
  }
  adjustSupport(w, drift);

  // ---- political capital follows support
  w.resources.politicalCapital = clamp(w.resources.politicalCapital + pcRegenPerDay(w), 0, 60);

  // ---- parliamentary inquiry
  if (p.support < SUPPORT_INQUIRY && !p.fiscal.inquiryPenalty) {
    p.fiscal.inquiryPenalty = true;
    p.inquiryUntil = w.tick + INQUIRY_DAYS;
    w.events.push({
      severity: 'CRITICAL',
      text: `PARLIAMENTARY INQUIRY into the navy: procurement frozen ${INQUIRY_DAYS} days, next appropriation cut 20%`,
    });
  }

  // ---- elections
  if (w.tick >= p.nextElectionTick) {
    const before = p.support;
    p.support = clamp(50 + (before - 50) * 0.5 + rng.range(-10, 10));
    p.nextElectionTick = w.tick + ELECTION_EVERY_DAYS;
    w.events.push({ severity: 'ADVISORY', text: `ELECTION: a new government takes office — domestic support ${before.toFixed(0)} → ${p.support.toFixed(0)}` });
  }
}

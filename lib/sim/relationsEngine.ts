/**
 * Vendor relations (docs/PLAN-foreign-contractors.md §2-3, phase 1): the relationship ladder and export-regime profiles.
 *
 * - Ladder: UNKNOWN (hidden) → CONTACT → TRADE MISSION → FRAMEWORK → SIGNED → STRATEGIC. Each step costs political capital
 *   (and money from FRAMEWORK on), needs standing, and takes days. Scouting reveals unknown suppliers.
 * - Regimes replace the old single "volatility" number: each vendor state has its own sanction hazard, notice period,
 *   freeze length and mix of sanction kinds, plus quirks (Vinterland punishes incidents; Sarnia and Seoryeong respond to lobbying).
 * - Soft bloc affinity (decided): courting the Eastern bloc costs standing with western vendors and vice versa; never a lockout.
 */
import { MODULES } from '../data/catalog';
import { vt } from '../data/tokens';
import type { Bloc, RegimeId, Rung, SanctionKind, Vendor, VendorId } from '../types/diplomacy';
import { rungIndex } from '../types/diplomacy';
import type { WorldDraft } from '../types/world';
import { adjustSupport, lobbyCost, ministriesRefuse } from './politicsEngine';

export interface Regime {
  label: string;
  /** Daily sanction hazard scale at full tension (the old per-vendor volatility). */
  hazard: number;
  /** Days of notice between the warning and the sanction landing. */
  warningDays: number;
  freezeDays: [number, number];
  /** Probability mix when a sanction is rolled: [freeze, embargo, revocation]. */
  mix: [number, number, number];
  /** Multiplier on standing gained from lobbying. */
  lobbyEffect: number;
  /** Standing lost per incident caused anywhere by the navy (restrictive export regimes). */
  incidentPenalty: number;
  blurb: string;
}

export const REGIMES: Record<RegimeId, Regime> = {
  HOME: { label: 'DOMESTIC', hazard: 0, warningDays: 0, freezeDays: [0, 0], mix: [1, 0, 0], lobbyEffect: 1, incidentPenalty: 0, blurb: 'Your own industry: never sanctioned.' },
  AURELLE: { label: 'POLITICALLY STEERED', hazard: 0.35, warningDays: 12, freezeDays: [45, 90], mix: [0.7, 0.2, 0.1], lobbyEffect: 1, incidentPenalty: 0, blurb: 'Decisions are taken at head-of-state level: long freezes, revocations rare.' },
  HALCYON: { label: 'STRICT EXPORT CONTROL', hazard: 0.6, warningDays: 8, freezeDays: [60, 120], mix: [0.45, 0.2, 0.35], lobbyEffect: 0.8, incidentPenalty: 1, blurb: 'Deepest catalogue, strictest licences: short notice and frequent revocations.' },
  SARNIA: { label: 'TRANSACTIONAL', hazard: 0.45, warningDays: 12, freezeDays: [20, 45], mix: [0.6, 0.3, 0.1], lobbyEffect: 1.3, incidentPenalty: 0, blurb: 'Eager for customers: short freezes, and lobbying goes further.' },
  EASTERN: { label: 'STATE MONOPOLY', hazard: 0.8, warningDays: 10, freezeDays: [30, 90], mix: [0.4, 0.45, 0.15], lobbyEffect: 1, incidentPenalty: 0, blurb: 'One counterparty, cheap hardware; spares embargoes are its favourite lever.' },
  VINTERLAND: { label: 'RESTRICTIVE', hazard: 0.25, warningDays: 14, freezeDays: [60, 120], mix: [0.6, 0.1, 0.3], lobbyEffect: 1, incidentPenalty: 6, blurb: 'Stable in peacetime, but every incident your navy causes costs standing.' },
  SEORYEONG: { label: 'BUSINESS-FRIENDLY', hazard: 0.2, warningDays: 14, freezeDays: [20, 40], mix: [0.7, 0.25, 0.05], lobbyEffect: 1.2, incidentPenalty: 0, blurb: 'Consortium sales, quick deliveries, rarely political.' },
  RHEINMARK: { label: 'COMMITTEE-DRIVEN', hazard: 0.3, warningDays: 20, freezeDays: [60, 120], mix: [0.6, 0.3, 0.1], lobbyEffect: 0.9, incidentPenalty: 2, blurb: 'Slow approvals and long notice; component licences reach into other vendors’ products.' },
};

export const BLOC_LABEL: Record<Bloc, string> = { HOME: 'HOME', WEST: 'WESTERN', EURO: 'EUROPEAN', NORDIC: 'NORDIC', EAST: 'EASTERN BLOC', ASIA_PAC: 'ASIA-PACIFIC' };
const WESTERN: Bloc[] = ['WEST', 'EURO', 'NORDIC'];

// ------------------------------------------------------------------------------------------ sanction hazard

/** Daily probability that an ACTIVE vendor signals a sanction. */
export function sanctionRiskPerDay(w: Pick<WorldDraft, 'tension'>, v: Vendor): number {
  const r = REGIMES[v.regime];
  const strategic = v.rung === 'STRATEGIC' ? 0.5 : 1;
  return (w.tension / 100) ** 2 * r.hazard * 0.03 * (1 - v.standing / 130) * strategic;
}

export function rollSanctionKind(v: Vendor, roll: number): SanctionKind {
  const [f, e] = REGIMES[v.regime].mix;
  return roll < f ? 'EXPORT_FREEZE' : roll < f + e ? 'PARTS_EMBARGO' : 'LICENSE_REVOKED';
}

// ------------------------------------------------------------------------------------------ the ladder

export interface Step {
  target: Rung;
  pc: number;
  money: number;
  days: number;
  minStanding: number;
}

/** Cost of the next rung above `from` (null at the top). */
export function nextStep(from: Rung): Step | null {
  switch (from) {
    case 'CONTACT':
      return { target: 'TRADE_MISSION', pc: 8, money: 0, days: 15, minStanding: 0 };
    case 'TRADE_MISSION':
      return { target: 'FRAMEWORK', pc: 10, money: 40, days: 25, minStanding: 30 };
    case 'FRAMEWORK':
      return { target: 'SIGNED', pc: 15, money: 60, days: 30, minStanding: 50 };
    case 'SIGNED':
      return { target: 'STRATEGIC', pc: 20, money: 120, days: 45, minStanding: 80 };
    default:
      return null;
  }
}

export const RUNG_LABEL: Record<Rung, string> = {
  UNKNOWN: 'UNKNOWN',
  CONTACT: 'CONTACT',
  TRADE_MISSION: 'TRADE MISSION',
  FRAMEWORK: 'FRAMEWORK AGREEMENT',
  SIGNED: 'SIGNED',
  STRATEGIC: 'STRATEGIC PARTNER',
};

/** What a rung lets the player buy. */
export function rungAccess(r: Rung): string {
  switch (r) {
    case 'UNKNOWN':
      return 'not yet known';
    case 'CONTACT':
    case 'TRADE_MISSION':
      return 'catalogue visible, nothing purchasable';
    case 'FRAMEWORK':
      return 'tier-0 lines purchasable';
    case 'SIGNED':
      return 'all tiers by standing';
    case 'STRATEGIC':
      return 'all tiers; sanction risk halved; lobbying +25%';
  }
}

/** Highest catalogue tier a vendor will sell at its rung and standing (-1 = nothing). */
export function sellableTier(v: Vendor): number {
  if (rungIndex(v.rung) < rungIndex('FRAMEWORK')) return -1;
  if (v.rung === 'FRAMEWORK') return 0;
  return Math.max(0, Math.min(3, Math.floor(v.standing / 25)));
}

export const SCOUT_PC = 6;

export function scoutBlocked(w: WorldDraft): string | null {
  const refuse = ministriesRefuse(w);
  if (refuse) return refuse;
  if (!Object.values(w.vendors).some((v) => v.rung === 'UNKNOWN')) return 'NO UNKNOWN SUPPLIERS LEFT TO SCOUT';
  const cost = lobbyCost(w, SCOUT_PC);
  if (w.resources.politicalCapital < cost) return `NEEDS ${cost} POLITICAL CAPITAL`;
  return null;
}

/** Trade attachés survey the market: the next unknown supplier becomes a CONTACT. */
export function scoutSuppliers(w: WorldDraft): { ok: boolean; reason?: string; vendorId?: VendorId } {
  const b = scoutBlocked(w);
  if (b) return { ok: false, reason: b };
  const v = Object.values(w.vendors).find((x) => x.rung === 'UNKNOWN')!;
  w.resources.politicalCapital -= lobbyCost(w, SCOUT_PC);
  v.rung = 'CONTACT';
  w.events.push({ severity: 'ADVISORY', text: `TRADE ATTACHÉS: new supplier identified — ${vt(v.id)} (${REGIMES[v.regime].label}); catalogue now visible` });
  return { ok: true, vendorId: v.id };
}

export function advanceBlocked(w: WorldDraft, vendorId: VendorId): string | null {
  const v = w.vendors[vendorId];
  if (!v) return 'UNKNOWN VENDOR';
  if (v.rung === 'UNKNOWN') return 'SUPPLIER NOT YET KNOWN — SCOUT FIRST';
  if (v.rungProgress) return `${RUNG_LABEL[v.rungProgress.target]} IN PROGRESS — DAY ${v.rungProgress.readyTick}`;
  const step = nextStep(v.rung);
  if (!step) return 'ALREADY AT THE TOP OF THE LADDER';
  if (v.status === 'FROZEN' || v.status === 'REVOKED') return 'VENDOR STATE HAS SANCTIONS IN FORCE';
  const refuse = ministriesRefuse(w);
  if (refuse) return refuse;
  if (v.standing < step.minStanding) return `NEEDS STANDING ${step.minStanding} (HAVE ${v.standing.toFixed(0)})`;
  const pc = lobbyCost(w, step.pc);
  if (w.resources.politicalCapital < pc) return `NEEDS ${pc} POLITICAL CAPITAL`;
  if (w.resources.budget < step.money) return `NEEDS ${step.money}M`;
  return null;
}

/** Vendors whose standing a new relationship with `v` would dent (soft bloc affinity) and by how much. */
export function blocFallout(w: Pick<WorldDraft, 'vendors'>, v: Vendor): { id: VendorId; loss: number }[] {
  const out: { id: VendorId; loss: number }[] = [];
  for (const o of Object.values(w.vendors)) {
    if (o.id === v.id || o.rung === 'UNKNOWN') continue;
    if (v.bloc === 'EAST' && WESTERN.includes(o.bloc)) out.push({ id: o.id, loss: 4 });
    else if (WESTERN.includes(v.bloc) && o.bloc === 'EAST') out.push({ id: o.id, loss: 2 });
  }
  return out;
}

export function advanceRelationship(w: WorldDraft, vendorId: VendorId): { ok: boolean; reason?: string } {
  const b = advanceBlocked(w, vendorId);
  if (b) return { ok: false, reason: b };
  const v = w.vendors[vendorId];
  const step = nextStep(v.rung)!;
  w.resources.politicalCapital -= lobbyCost(w, step.pc);
  w.resources.budget -= step.money;
  v.rungProgress = { target: step.target, startTick: w.tick, readyTick: w.tick + step.days };
  w.events.push({ severity: 'INFO', text: `${vt(v.id)}: ${RUNG_LABEL[step.target].toLowerCase()} opened — concludes day ${w.tick + step.days}` });
  return { ok: true };
}

/** Daily: conclude relationship steps; restrictive regimes react to incidents. */
export function tickRelations(w: WorldDraft, incidentsBefore: number): void {
  for (const v of Object.values(w.vendors)) {
    if (!v.rungProgress || w.tick < v.rungProgress.readyTick) continue;
    // A sanction landing mid-negotiation stalls it until lifted.
    if (v.status === 'FROZEN' || v.status === 'REVOKED') continue;
    v.rung = v.rungProgress.target;
    v.rungProgress = null;
    w.events.push({ severity: 'ADVISORY', text: `${vt(v.id)}: ${RUNG_LABEL[v.rung]} concluded — ${rungAccess(v.rung)}` });
    for (const f of blocFallout(w, v)) {
      w.vendors[f.id].standing = Math.max(0, w.vendors[f.id].standing - f.loss);
    }
    const fallout = blocFallout(w, v);
    if (fallout.length) w.events.push({ severity: 'WARNING', text: `Bloc politics: ${fallout.map((f) => `${vt(f.id)} −${f.loss}`).join(', ')} standing` });
    if (v.rung === 'SIGNED' || v.rung === 'STRATEGIC') adjustSupport(w, 0.5);
  }
  const newIncidents = w.stats.incidents - incidentsBefore;
  if (newIncidents > 0) {
    for (const v of Object.values(w.vendors)) {
      const pen = REGIMES[v.regime].incidentPenalty * newIncidents;
      if (!pen || v.rung === 'UNKNOWN') continue;
      v.standing = Math.max(0, v.standing - pen);
      w.events.push({ severity: 'WARNING', text: `${vt(v.id)}: export regime reviews the incident — standing −${pen}` });
    }
  }
}

/** Modules of vendors the player knows about (UNKNOWN vendors stay hidden from the designer). */
export function knownModules(w: Pick<WorldDraft, 'vendors'>) {
  return MODULES.filter((m) => w.vendors[m.vendorId]?.rung !== 'UNKNOWN');
}



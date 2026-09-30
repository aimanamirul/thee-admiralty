/**
 * Build contracts (docs/PLAN-foreign-contractors.md §10 phase 3).
 *
 * - Lay-down pays a deposit; the balance is paid daily while the hull builds. A hull that cannot pay today's instalment waits on
 *   its slipway; a hull frozen by a sanction pays nothing.
 * - Cancelling refunds each vendor's share by who broke the deal: a vendor that cannot deliver (its state, or a sub-supplier's,
 *   sanctions the hull's kit) refunds at its regime's rate; walking away from a vendor that could deliver refunds little and costs
 *   standing; the domestic yards salvage half of the hull work.
 * - Resale (the Mistral case): a third-party navy takes over a well-advanced hull for part of what has been paid, unless a
 *   state involved has revoked its licence (re-export not approved).
 */
import { HULLS, MODULE_BY_ID } from '../data/catalog';
import { vt } from '../data/tokens';
import type { VendorId } from '../types/diplomacy';
import type { HullClassId } from '../types/hull';
import type { BuildContract, Ship } from '../types/fleet';
import type { WorldDraft } from '../types/world';
import { adjustSupport } from './politicsEngine';
import { REGIMES } from './relationsEngine';
import { exposure } from './supplyChain';

export const DEPOSIT_RATE = 0.3;
/** Share of hull work the domestic yards recover when a contract is cancelled. */
export const DOMESTIC_SALVAGE = 0.5;
/** Refund when the player walks away from a vendor that could still deliver. */
export const BREACH_REFUND = 0.4;
export const BREACH_STANDING = 6;
export const RESALE_RATE = 0.7;
export const RESALE_MIN_PROGRESS = 0.4;

/** Each vendor's share of the price: modules by their prime vendor, the hull by the domestic yards. */
export function contractShares(hullId: HullClassId, moduleIds: readonly string[]): Partial<Record<VendorId, number>> {
  const raw: Partial<Record<VendorId, number>> = { DOMESTIC_YARDS: HULLS[hullId].cost };
  for (const id of moduleIds) {
    const m = MODULE_BY_ID[id];
    if (m) raw[m.vendorId] = (raw[m.vendorId] ?? 0) + m.cost;
  }
  const total = Object.values(raw).reduce((a, b) => a + (b ?? 0), 0) || 1;
  for (const k of Object.keys(raw) as VendorId[]) raw[k] = raw[k]! / total;
  return raw;
}

export function newContract(hullId: HullClassId, moduleIds: readonly string[], price: number): BuildContract {
  const deposit = price * DEPOSIT_RATE;
  const paidByVendor: Partial<Record<VendorId, number>> = {};
  for (const [v, share] of Object.entries(contractShares(hullId, moduleIds))) paidByVendor[v as VendorId] = deposit * (share ?? 0);
  return { price, paid: deposit, paidByVendor, awaitingFunds: false };
}

/** Today's instalment for a hull (0 once paid up). */
export function instalment(s: Ship): number {
  const c = s.contract;
  if (!c) return 0;
  const days = Math.max(1, s.buildTotalDays - s.buildProgressDays);
  return Math.max(0, (c.price - c.paid) / days);
}

/** Pay today's instalment; false = the budget cannot cover it and the hull waits. */
export function payInstalment(w: WorldDraft, s: Ship): boolean {
  const c = s.contract;
  if (!c) return true;
  const due = instalment(s);
  if (due <= 0) return true;
  if (w.resources.budget < due) {
    if (!c.awaitingFunds) w.events.push({ severity: 'WARNING', text: `${s.pennant} ${s.name.toUpperCase()}: construction AWAITING FUNDS — ${due.toFixed(1)} M/day instalment` });
    c.awaitingFunds = true;
    return false;
  }
  if (c.awaitingFunds) w.events.push({ severity: 'INFO', text: `${s.pennant} ${s.name.toUpperCase()}: instalments resumed` });
  c.awaitingFunds = false;
  w.resources.budget -= due;
  c.paid += due;
  const shares = contractShares(s.hullId, s.modules.map((m) => m.moduleId));
  for (const [v, share] of Object.entries(shares)) c.paidByVendor[v as VendorId] = (c.paidByVendor[v as VendorId] ?? 0) + due * (share ?? 0);
  return true;
}

/** A vendor cannot deliver its part of this hull: some product of theirs on it is hit by a sanction (theirs or a sub-supplier's). */
export function cannotDeliver(w: WorldDraft, s: Ship, vendorId: VendorId): boolean {
  if (vendorId === 'DOMESTIC_YARDS') return false;
  return s.modules.some((im) => {
    const m = MODULE_BY_ID[im.moduleId];
    return m?.vendorId === vendorId && exposure(m).some((x) => w.vendors[x].status === 'FROZEN' || w.vendors[x].status === 'REVOKED');
  });
}

export interface RefundLine {
  vendorId: VendorId;
  paid: number;
  refund: number;
  /** DOMESTIC = yard salvage, FAULT = vendor cannot deliver (regime refund), BREACH = we walk away. */
  basis: 'DOMESTIC' | 'FAULT' | 'BREACH';
}

export interface CancellationTerms {
  lines: RefundLine[];
  refund: number;
  paid: number;
  /** Vendors we breach against, with the standing each would lose. */
  breaches: VendorId[];
  /** Domestic support cost: a voluntary cancellation looks like waste; a forced one does not. */
  supportLoss: number;
}

export function cancelBlocked(w: WorldDraft, shipId: string): string | null {
  const s = w.ships[shipId];
  if (!s) return 'NO SUCH SHIP';
  if (s.buildStatus !== 'CONSTRUCTING') return 'ONLY HULLS UNDER CONSTRUCTION HAVE A BUILD CONTRACT';
  return null;
}

export function cancellationTerms(w: WorldDraft, s: Ship): CancellationTerms {
  const paidBy = s.contract?.paidByVendor ?? {};
  const lines: RefundLine[] = [];
  for (const [v, paid] of Object.entries(paidBy) as [VendorId, number][]) {
    if (!paid) continue;
    if (v === 'DOMESTIC_YARDS') lines.push({ vendorId: v, paid, refund: paid * DOMESTIC_SALVAGE, basis: 'DOMESTIC' });
    else if (cannotDeliver(w, s, v) || w.vendors[v].status === 'REVOKED') lines.push({ vendorId: v, paid, refund: paid * REGIMES[w.vendors[v].regime].refundRate, basis: 'FAULT' });
    else lines.push({ vendorId: v, paid, refund: paid * BREACH_REFUND, basis: 'BREACH' });
  }
  const breaches = lines.filter((l) => l.basis === 'BREACH').map((l) => l.vendorId);
  const forced = lines.some((l) => l.basis === 'FAULT');
  return {
    lines,
    refund: lines.reduce((a, l) => a + l.refund, 0),
    paid: lines.reduce((a, l) => a + l.paid, 0),
    breaches,
    supportLoss: forced ? 0 : 1,
  };
}

function removeShip(w: WorldDraft, shipId: string) {
  for (const f of w.fleets) for (const tf of f.taskForces) for (const sq of tf.squadrons) sq.shipIds = sq.shipIds.filter((id) => id !== shipId);
  delete w.ships[shipId];
}

export function cancelContract(w: WorldDraft, shipId: string): { ok: boolean; reason?: string } {
  const b = cancelBlocked(w, shipId);
  if (b) return { ok: false, reason: b };
  const s = w.ships[shipId];
  const t = cancellationTerms(w, s);
  w.resources.budget += t.refund;
  for (const v of t.breaches) w.vendors[v].standing = Math.max(0, w.vendors[v].standing - BREACH_STANDING);
  if (t.supportLoss) adjustSupport(w, -t.supportLoss);
  removeShip(w, shipId);
  const fault = t.lines.filter((l) => l.basis === 'FAULT').map((l) => vt(l.vendorId));
  w.events.push({
    severity: 'WARNING',
    text:
      `CONTRACT CANCELLED: ${s.pennant} ${s.name.toUpperCase()} — ${t.refund.toFixed(0)} M of ${t.paid.toFixed(0)} M paid recovered` +
      (fault.length ? ` (refunds owed by ${fault.join(', ')})` : '') +
      (t.breaches.length ? `; breach of contract: ${t.breaches.map(vt).join(', ')} standing −${BREACH_STANDING}` : ''),
  });
  return { ok: true };
}

export function resaleBlocked(w: WorldDraft, shipId: string): string | null {
  const b = cancelBlocked(w, shipId);
  if (b) return b;
  const s = w.ships[shipId];
  if (s.buildProgressDays / s.buildTotalDays < RESALE_MIN_PROGRESS) return `NO BUYER BEFORE ${Math.round(RESALE_MIN_PROGRESS * 100)}% BUILT`;
  for (const im of s.modules) {
    const m = MODULE_BY_ID[im.moduleId];
    const revoked = m && exposure(m).find((x) => w.vendors[x].status === 'REVOKED');
    if (revoked) return `RE-EXPORT NOT APPROVED ({vs:${revoked}} LICENCE REVOKED)`;
  }
  return null;
}

export function resaleProceeds(s: Ship): number {
  return (s.contract?.paid ?? 0) * RESALE_RATE;
}

export function resellHull(w: WorldDraft, shipId: string): { ok: boolean; reason?: string } {
  const b = resaleBlocked(w, shipId);
  if (b) return { ok: false, reason: b };
  const s = w.ships[shipId];
  const proceeds = resaleProceeds(s);
  w.resources.budget += proceeds;
  removeShip(w, shipId);
  w.events.push({ severity: 'ADVISORY', text: `HULL SOLD: ${s.pennant} ${s.name.toUpperCase()} taken over by a third-party navy — ${proceeds.toFixed(0)} M recovered` });
  return { ok: true };
}

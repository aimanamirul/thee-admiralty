/**
 * Contractors phase 3: build contracts — deposit, instalments, cancellation refunds by fault, resale. Usage: npm run verify:contracts
 */
import * as cmd from '../lib/sim/commands';
import { instalment, BREACH_REFUND, BREACH_STANDING, cancellationTerms, DEPOSIT_RATE, DOMESTIC_SALVAGE, RESALE_MIN_PROGRESS, RESALE_RATE } from '../lib/sim/contracts';
import { evaluateLoadout } from '../lib/sim/designEngine';
import { syncConstructionFreezes } from '../lib/sim/diplomacyEngine';
import { REGIMES } from '../lib/sim/relationsEngine';
import { createInitialWorld } from '../lib/sim/scenario';
import { advanceDay } from '../lib/sim/worldEngine';
import type { Ship } from '../lib/types/fleet';
import type { WorldDraft } from '../lib/types/world';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const world = (seed: string): WorldDraft => {
  const w = createInitialWorld(seed, 'CORRIDOR');
  w.scripted = true;
  w.resources.budget = 5000;
  w.resources.industrialCapacity = 4;
  return w;
};
const days = (w: WorldDraft, n: number) => {
  for (let i = 0; i < n; i++) advanceDay(w);
};
/** Domestic hull + Meridian (Aurelle) sensor + domestic kit. */
const FRIGATE = ['PP_DOM_D12', 'CMS_DOM_OB1', 'SEN_NG_SMARTS', 'ARM_DOM_GUN76'];
const price = (ids: string[]) => evaluateLoadout('CORVETTE', ids, new Set()).cost;
function layDown(w: WorldDraft, ids = FRIGATE): Ship {
  const before = new Set(Object.keys(w.ships));
  const r = cmd.orderShip(w, { designName: 'X', hullId: 'CORVETTE', moduleIds: ids, squadronId: 'SQ-1-1', tradition: 'VIRTUES' });
  check(r.ok, `lay down: ${r.reason}`);
  return Object.values(w.ships).find((s) => !before.has(s.id))!;
}
const inSquadron = (w: WorldDraft, id: string) => w.fleets.some((f) => f.taskForces.some((t) => t.squadrons.some((s) => s.shipIds.includes(id))));

// ---- deposit and instalments
{
  const w = world('pay');
  const p = price(FRIGATE);
  const b0 = w.resources.budget;
  const s = layDown(w);
  check(near(b0 - w.resources.budget, p * DEPOSIT_RATE), `deposit is ${DEPOSIT_RATE * 100}% (${(b0 - w.resources.budget).toFixed(1)} of ${p})`);
  check(!!s.contract && near(s.contract.paid, p * DEPOSIT_RATE) && near(s.contract.price, p), 'contract recorded');
  const cheap = world('cheap');
  cheap.resources.budget = p * DEPOSIT_RATE - 0.01;
  check(!cmd.orderShip(cheap, { designName: 'X', hullId: 'CORVETTE', moduleIds: FRIGATE, squadronId: 'SQ-1-1', tradition: 'VIRTUES' }).ok, 'needs the deposit');
  cheap.resources.budget = p * DEPOSIT_RATE + 0.01;
  check(cmd.orderShip(cheap, { designName: 'X', hullId: 'CORVETTE', moduleIds: FRIGATE, squadronId: 'SQ-1-1', tradition: 'VIRTUES' }).ok, 'the deposit alone is enough to lay down');

  // Isolate construction spending from running costs by comparing paid totals.
  let guard = 0;
  while (s.buildStatus === 'CONSTRUCTING' && guard++ < 1000) advanceDay(w);
  check(s.buildStatus === 'COMMISSIONED' && !s.contract, 'commissions and closes the contract');
  const ledger = w.events.map((e) => e.text).join('\n');
  check(/LAID DOWN: .*deposit, balance paid over/.test(ledger), 'lay-down log explains the payment plan');
}
{
  const w = world('pay-total');
  const s = layDown(w);
  const p = s.contract!.price;
  let total = s.contract!.paid;
  let guard = 0;
  while (s.buildStatus === 'CONSTRUCTING' && guard++ < 1000) {
    const due = instalment(s);
    advanceDay(w);
    total += due;
  }
  check(near(total, p, 1e-6), `deposit + instalments = price (${total.toFixed(3)} vs ${p})`);
  check(guard === s.buildTotalDays, `commissions on schedule when funded (${guard} days)`);
}

// ---- awaiting funds and frozen hulls pay nothing
{
  const w = world('funds');
  const s = layDown(w);
  w.resources.budget = 0;
  const d0 = s.buildProgressDays;
  const paid0 = s.contract!.paid;
  w.politics.fiscal.appropriation = 0; // no tranche rescues the budget during the test
  days(w, 5);
  check(s.buildProgressDays === d0 && s.contract!.awaitingFunds && near(s.contract!.paid, paid0), 'no money: the slipway waits and nothing is paid');
  check(w.events.filter((e) => /AWAITING FUNDS/.test(e.text)).length === 1, 'awaiting-funds warning logged once');
  w.resources.budget = 5000;
  days(w, 1);
  check(s.buildProgressDays === d0 + 1 && !s.contract!.awaitingFunds, 'resumes when money arrives');
}
{
  const w = world('frozen');
  const s = layDown(w);
  w.vendors.NAVAL_GROUP_THALES.status = 'FROZEN';
  w.sanctions.push({ id: 'S', vendorId: 'NAVAL_GROUP_THALES', kind: 'EXPORT_FREEZE', startTick: w.tick, endTick: w.tick + 90 });
  w.vendors.NAVAL_GROUP_THALES.statusUntilTick = w.tick + 90;
  syncConstructionFreezes(w);
  const paid0 = s.contract!.paid;
  days(w, 5);
  check(s.frozenBy === 'NAVAL_GROUP_THALES' && near(s.contract!.paid, paid0), 'a frozen hull pays no instalments');
}

// ---- cancellation: refunds by fault
{
  const w = world('cancel-voluntary');
  const s = layDown(w);
  days(w, 10);
  const t = cancellationTerms(w, s);
  const ng = t.lines.find((l) => l.vendorId === 'NAVAL_GROUP_THALES')!;
  const dom = t.lines.find((l) => l.vendorId === 'DOMESTIC_YARDS')!;
  check(ng.basis === 'BREACH' && near(ng.refund, ng.paid * BREACH_REFUND), 'walking away from a deliverable vendor refunds 40%');
  check(dom.basis === 'DOMESTIC' && near(dom.refund, dom.paid * DOMESTIC_SALVAGE), 'yards salvage half the hull work');
  check(near(t.paid, s.contract!.paid, 1e-6), 'terms account for every payment');
  const st0 = w.vendors.NAVAL_GROUP_THALES.standing;
  const sup0 = w.politics.support;
  const b0 = w.resources.budget;
  check(cmd.cancelContractCmd(w, s.id).ok, 'cancel');
  check(near(w.resources.budget - b0, t.refund), 'refund credited');
  check(near(st0 - w.vendors.NAVAL_GROUP_THALES.standing, BREACH_STANDING), 'breach costs standing');
  check(w.politics.support < sup0, 'voluntary cancellation costs support');
  check(!w.ships[s.id] && !inSquadron(w, s.id), 'hull scrapped and removed from its squadron');
}
{
  const w = world('cancel-forced');
  const s = layDown(w);
  days(w, 10);
  w.vendors.NAVAL_GROUP_THALES.status = 'FROZEN';
  w.sanctions.push({ id: 'S', vendorId: 'NAVAL_GROUP_THALES', kind: 'EXPORT_FREEZE', startTick: w.tick, endTick: w.tick + 90 });
  const t = cancellationTerms(w, s);
  const ng = t.lines.find((l) => l.vendorId === 'NAVAL_GROUP_THALES')!;
  check(ng.basis === 'FAULT' && near(ng.refund, ng.paid * REGIMES.AURELLE.refundRate), 'a sanctioning vendor owes a refund at its regime rate');
  const st0 = w.vendors.NAVAL_GROUP_THALES.standing;
  const sup0 = w.politics.support;
  cmd.cancelContractCmd(w, s.id);
  check(w.vendors.NAVAL_GROUP_THALES.standing === st0 && w.politics.support === sup0, 'forced cancellation: no standing or support cost');
}
{
  // A sub-supplier's sanction makes the prime unable to deliver (Seorak turbine with Kessler-Brandt gear).
  const w = world('cancel-origin');
  w.vendors.SEORAK.rung = 'SIGNED';
  w.vendors.SEORAK.standing = 60;
  const s = layDown(w, ['PP_SK_ST30', 'CMS_DOM_OB1', 'SEN_DOM_DSR2', 'ARM_DOM_GUN76']);
  w.vendors.KESSLER_BRANDT.status = 'FROZEN';
  const sk = cancellationTerms(w, s).lines.find((l) => l.vendorId === 'SEORAK')!;
  check(sk.basis === 'FAULT' && near(sk.refund, sk.paid * REGIMES.SEORYEONG.refundRate), 'prime refunds when a sub-supplier blocks delivery');
}
{
  // Refund rates differ by regime: Aurelle owes most, the Eastern bloc least.
  check(REGIMES.AURELLE.refundRate > REGIMES.HALCYON.refundRate && REGIMES.EASTERN.refundRate < 0.5, 'regime refund ordering');
}

// ---- resale
{
  const w = world('resale');
  const s = layDown(w);
  check(!cmd.resellHullCmd(w, s.id).ok, 'no buyer for a fresh hull');
  while (s.buildProgressDays / s.buildTotalDays < RESALE_MIN_PROGRESS) advanceDay(w);
  const paid = s.contract!.paid;
  const b0 = w.resources.budget;
  const st0 = w.vendors.NAVAL_GROUP_THALES.standing;
  check(cmd.resellHullCmd(w, s.id).ok, `resale from ${RESALE_MIN_PROGRESS * 100}% built`);
  check(near(w.resources.budget - b0, paid * RESALE_RATE), 'resale recovers 70% of payments');
  check(w.vendors.NAVAL_GROUP_THALES.standing === st0 && !w.ships[s.id], 'resale: no standing cost, hull gone');
}
{
  const w = world('resale-revoked');
  const s = layDown(w);
  while (s.buildProgressDays / s.buildTotalDays < RESALE_MIN_PROGRESS) advanceDay(w);
  w.vendors.NAVAL_GROUP_THALES.status = 'REVOKED';
  const r = cmd.resellHullCmd(w, s.id);
  check(!r.ok && /RE-EXPORT NOT APPROVED/.test(r.reason ?? ''), 'revoked licence blocks re-export');
  check(cmd.cancelContractCmd(w, s.id).ok, 'but the contract can still be cancelled');
}
{
  const w = world('commissioned');
  const id = Object.values(w.ships).find((s) => s.buildStatus === 'COMMISSIONED')!.id;
  check(!cmd.cancelContractCmd(w, id).ok && !cmd.resellHullCmd(w, id).ok, 'commissioned ships have no contract to cancel or sell');
}

console.log(failures === 0 ? '\nCONTRACTS OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

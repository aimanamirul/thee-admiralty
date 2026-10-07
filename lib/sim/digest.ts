/**
 * "While you were away": a plain account of a stretch of simulated days. Built from a before/after snapshot plus the ledger entries
 * written in between, so it can only report what the ledger and the numbers can prove.
 */
import { HULLS } from '../data/catalog';
import type { GameEvent, WorldDraft } from '../types/world';
import { runningCosts } from './politicsEngine';

export interface DigestSnapshot {
  tick: number;
  budget: number;
  support: number;
  tension: number;
  politicalCapital: number;
  ships: Record<string, { name: string; pennant: string; hull: string; integrity: number }>;
  hostilesDestroyed: number;
  shipsLost: number;
  incidents: number;
  seizures: number;
  shipsTransited: number;
  shippingLost: number;
  tradeIndex: number;
  threat: Record<number, number>;
}

export function snapshotOf(w: WorldDraft): DigestSnapshot {
  return {
    tick: w.tick,
    budget: w.resources.budget,
    support: w.politics.support,
    tension: w.tension,
    politicalCapital: w.resources.politicalCapital,
    ships: Object.fromEntries(Object.values(w.ships).map((s) => [s.id, { name: s.name, pennant: s.pennant, hull: HULLS[s.hullId].name, integrity: s.integrity }])),
    hostilesDestroyed: w.stats.hostilesDestroyed,
    shipsLost: w.stats.shipsLost,
    incidents: w.stats.incidents,
    seizures: w.stats.seizures,
    shipsTransited: w.shipping.stats.transited,
    shippingLost: w.shipping.stats.lost,
    tradeIndex: w.shipping.index,
    threat: Object.fromEntries(Object.entries(w.sectors).map(([k, v]) => [Number(k), v.threat])),
  };
}

export interface Digest {
  days: number;
  fromTick: number;
  toTick: number;
  /** One-line facts: gained, lost, changed. */
  summary: string[];
  /** Ships lost, in the order it happened. */
  losses: string[];
  /** The ledger entries worth reading (critical and warning, most recent last), capped. */
  highlights: string[];
  /** What is holding the navy back right now, with the reason. */
  bottlenecks: string[];
}

const M = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(2)}B` : `${n.toFixed(0)}M`);

export function buildDigest(before: DigestSnapshot, after: WorldDraft, entries: GameEvent[]): Digest {
  const now = snapshotOf(after);
  const summary: string[] = [];
  summary.push(`${now.tick - before.tick} days passed (day ${before.tick} → ${now.tick})`);
  summary.push(`Budget ${M(before.budget)} → ${M(now.budget)} (${now.budget >= before.budget ? '+' : '−'}${M(Math.abs(now.budget - before.budget))})`);
  summary.push(`Domestic support ${before.support.toFixed(0)} → ${now.support.toFixed(0)}; tension ${before.tension.toFixed(0)} → ${now.tension.toFixed(0)}`);
  const kills = now.hostilesDestroyed - before.hostilesDestroyed;
  if (kills) summary.push(`${kills} hostile raid${kills > 1 ? 's' : ''} destroyed`);
  const seized = now.seizures - before.seizures;
  if (seized) summary.push(`${seized} seizure${seized > 1 ? 's' : ''} of contraband`);
  const inc = now.incidents - before.incidents;
  if (inc) summary.push(`${inc} diplomatic incident${inc > 1 ? 's' : ''}`);
  const passed = now.shipsTransited - before.shipsTransited;
  const lostShips = now.shippingLost - before.shippingLost;
  summary.push(`Shipping: ${passed} passages completed, ${lostShips} merchant ship${lostShips === 1 ? '' : 's'} lost; trade index ${before.tradeIndex.toFixed(0)} → ${now.tradeIndex.toFixed(0)}`);
  const worse = Object.entries(now.threat)
    .map(([k, v]) => [Number(k), v - (before.threat[Number(k)] ?? v)] as const)
    .sort((a, b) => b[1] - a[1])[0];
  if (worse && worse[1] >= 5) summary.push(`Threat rose most in ${after.map.sectors[worse[0]].label} (+${worse[1].toFixed(0)})`);

  const losses: string[] = [];
  for (const [id, s] of Object.entries(before.ships)) {
    if (after.ships[id]) continue;
    const e = entries.find((x) => /LOST:|CONTRACT CANCELLED|HULL SOLD|stripped/.test(x.text) && x.text.toUpperCase().includes(s.name.toUpperCase()));
    if (e) losses.push(`Day ${e.tick}: ${s.pennant} ${s.name.toUpperCase()} (${s.hull}) — ${e.text.replace(/^LOST: /, '').replace(/^.*?— /, '')}`);
  }
  const rank = (e: GameEvent) => (e.severity === 'CRITICAL' ? 0 : e.severity === 'WARNING' ? 1 : e.severity === 'COMBAT' ? 3 : 2);
  const noteworthy = entries.filter((e) => (e.severity === 'CRITICAL' || e.severity === 'WARNING' || /ENGAGEMENT|SEIZURE|DETERRED|RESCUE|SAFE PASSAGE|ELECTION|APPROPRIATION|COMMISSIONED|SANCTION|EMBARGO/.test(e.text)) && !e.text.startsWith('  '));
  const highlights = noteworthy
    .sort((a, b) => rank(a) - rank(b) || a.id - b.id)
    .slice(0, 10)
    .sort((a, b) => a.id - b.id)
    .map((e) => `Day ${e.tick}: ${e.text}`);

  return { days: now.tick - before.tick, fromTick: before.tick, toTick: now.tick, summary, losses, highlights, bottlenecks: bottlenecksOf(after) };
}

/** What is stalling the navy now, from the world itself. */
export function bottlenecksOf(w: WorldDraft): string[] {
  const out: string[] = [];
  const costs = runningCosts(Object.values(w.ships), w.tick).total;
  if (w.resources.budget < costs * 30) out.push(`Budget ${M(w.resources.budget)} covers under 30 days of running costs (${costs.toFixed(1)}M/day)`);
  const waiting = Object.values(w.ships).filter((s) => s.buildStatus === 'CONSTRUCTING' && s.contract?.awaitingFunds);
  if (waiting.length) out.push(`${waiting.length} hull${waiting.length > 1 ? 's' : ''} under construction awaiting funds`);
  const frozen = Object.values(w.ships).filter((s) => s.buildStatus === 'CONSTRUCTING' && s.frozenBy);
  if (frozen.length) out.push(`${frozen.length} hull${frozen.length > 1 ? 's' : ''} stalled by a vendor sanction`);
  const stalled = Object.values(w.ships).filter((s) => s.state === 'MAINTENANCE_DOCK' && s.modules.some((m) => m.failed));
  if (stalled.length) out.push(`${stalled.length} ship${stalled.length > 1 ? 's' : ''} in dock waiting for a spare part`);
  const uncovered = w.map.sectors.filter((s) => w.sectors[s.id].threat > 60 && !w.fleets.some((f) => f.taskForces.some((t) => t.assignedSectorId === s.id)));
  if (uncovered.length) out.push(`High threat and no task force assigned: ${uncovered.map((s) => s.label).join(', ')}`);
  const limited = Object.values(w.vendors).filter((v) => v.status === 'FROZEN' || v.status === 'REVOKED');
  if (limited.length) out.push(`${limited.length} vendor${limited.length > 1 ? 's' : ''} under sanction`);
  if (w.politics.support < 40) out.push(`Domestic support ${w.politics.support.toFixed(0)}: lobbying costs more and political capital recovers slowly`);
  const dockedShare = Object.values(w.ships).filter((s) => s.buildStatus === 'COMMISSIONED' && s.state === 'MAINTENANCE_DOCK').length;
  if (dockedShare >= 3) out.push(`${dockedShare} hulls in dock at once`);
  return out;
}

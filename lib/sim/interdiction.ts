/**
 * Inspections and deliberate trade interdiction (docs/PLAN-shipping.md, phases T4-T6).
 *
 * - T4 inspections: identified merchant ships may carry contraband (hidden; intelligence tips are mostly right, sometimes wrong). A task
 *   force sent to a ship, or a sector standing order for one flag, stops and searches it for two days. Contraband found is seized
 *   (money, support); a clean search costs standing with the flag state and support, because the ship was innocent.
 * - T5 interdiction: a maritime exclusion order names a flag (or every foreign flag) and some lane sectors. It is announced with a
 *   14-day notice: shipping starts to avoid the zone, the flag state and its bloc react, insurers react, and the home front polarizes.
 *   Only after notice do task forces on the spot apply the policy: search and release; search, seize and turn back; or strike on sight
 *   (only where the sector is at WEAPONS FREE; elsewhere it falls back to turning back). Passenger ferries are never targets. A strike
 *   is counted in the civilian toll. Force against a ship outside a legal order, or before notice ends, is the gravest incident.
 * - T6: a yearly shipping report, and the trade index, polarization and toll on the home front.
 *
 * It is a strategy-game abstraction: the cost is always shown before the act, the toll is always counted and reported, and no
 * outcome is presented as a win.
 */
import { Rng } from '../generator/prng';
import type { VendorId } from '../types/diplomacy';
import type { TaskForce } from '../types/fleet';
import { emptyStats, POLICY_LABEL, type ExclusionZone, type Flag, type FlagFilter, type InterdictionPolicy, type Merchant, type ShipKind } from '../types/shipping';
import type { WorldDraft } from '../types/world';
import { allTaskForces } from './fleetEngine';
import { adjustPolarization, adjustSupport, dayOfYear, lobbyCost, ministriesRefuse, polarizationOf } from './politicsEngine';
import {
  count, escortBlocked, flagMatches, flagText, laneOf, merchantTag, nearestCover, releaseEscort, removeMerchant, sectorOf, shipsAtSea,
} from './shipping';

export const NOTICE_DAYS = 14;
export const ZONE_PC = 10;
export const MAX_ZONES = 2;
/** A task force this close to an ordered ship starts the search. */
export const INSPECT_RANGE = 6;
export const INSPECT_DAYS = 2;
/** A task force this close to a ship applies a standing order or exclusion policy. */
export const FORCE_RANGE = 10;
export const SEIZURE_SHARE = 0.15;
export const FIND_TIPPED = 0.9;
export const FIND_UNTIPPED = 0.55;
/** Civilian crew aboard, for the toll. */
export const CREW: Record<ShipKind, number> = { TANKER: 24, CONTAINER: 22, BULK: 20, FERRY: 0 };
const POLARIZATION_DECAY = 0.08;

const clamp = (v: number, lo = 0, hi = 100) => (v < lo ? lo : v > hi ? hi : v);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Flags the player can name in an order (never the home flag). */
export const INTERDICTION_FLAGS: FlagFilter[] = ['ALL', 'OPEN_REGISTRY', 'NAVAL_GROUP_THALES', 'RAYTHEON', 'ASELSAN', 'ZVEZDA_NORD', 'NORDVIK', 'SEORAK'];
const FOREIGN_VENDORS: VendorId[] = ['NAVAL_GROUP_THALES', 'RAYTHEON', 'ASELSAN', 'ZVEZDA_NORD', 'NORDVIK', 'SEORAK'];

/** Vendor states behind a flag. */
function flagVendors(flag: FlagFilter): VendorId[] {
  if (flag === 'OPEN_REGISTRY' || flag === 'DOMESTIC_YARDS') return [];
  return flag === 'ALL' ? FOREIGN_VENDORS : [flag];
}

/** The flag state (and its bloc) resents what was done to its ship: standing falls; a lower standing also raises its sanction hazard. */
export function flagReaction(w: WorldDraft, flag: Flag, standing: number, bloc = 0): void {
  for (const id of flagVendors(flag)) w.vendors[id].standing = Math.max(0, w.vendors[id].standing - standing);
  const first = flagVendors(flag)[0];
  if (bloc > 0 && first) {
    const b = w.vendors[first].bloc;
    for (const o of Object.values(w.vendors)) {
      if (o.id !== first && o.bloc === b && b !== 'HOME' && o.rung !== 'UNKNOWN' && !o.closed) o.standing = Math.max(0, o.standing - bloc);
    }
  }
}

const tfOf = (w: WorldDraft, id: string): TaskForce | undefined => allTaskForces(w.fleets).find((t) => t.id === id);

// ------------------------------------------------------------------------------------------ T4: inspections

export function inspectBlocked(w: WorldDraft, tfId: string, merchantId: string): string | null {
  const b = escortBlocked(w, tfId, merchantId);
  if (b) return b;
  const m = w.shipping.ships.find((x) => x.id === merchantId)!;
  if (m.checked) return 'ALREADY SEARCHED';
  if (m.inspecting) return 'SEARCH ALREADY UNDER WAY';
  if (m.turnedBack) return 'ALREADY TURNED BACK';
  if (m.status === 'DISTRESS') return 'SHIP IN DISTRESS — SEND AID FIRST';
  return null;
}

export function orderInspect(w: WorldDraft, tfId: string, merchantId: string): { ok: boolean; reason?: string } {
  const b = inspectBlocked(w, tfId, merchantId);
  if (b) return { ok: false, reason: b };
  const tf = tfOf(w, tfId)!;
  const m = w.shipping.ships.find((x) => x.id === merchantId)!;
  releaseEscort(w, tf);
  tf.escort = m.id;
  tf.escortMode = 'INSPECT';
  m.escort = tf.id;
  const left = tf.assignedSectorId !== null ? ` — ${w.map.sectors[tf.assignedSectorId].label} left uncovered` : '';
  w.events.push({ severity: 'INFO', text: `INSPECTION ORDER: ${tf.name} to stop and search ${merchantTag(m)}${left}` });
  return { ok: true };
}

export function sectorInspectBlocked(w: WorldDraft, sectorId: number, flag: FlagFilter | null): string | null {
  if (!w.map.sectors[sectorId]) return 'NO SUCH SECTOR';
  if (w.shipping.lanes.length === 0) return 'NO SHIPPING LANES IN THIS THEATRE';
  if (flag === 'DOMESTIC_YARDS') return 'THE HOME FLAG IS NOT INSPECTED';
  if ((w.sectors[sectorId].inspect ?? null) === flag) return 'ALREADY THE STANDING ORDER';
  return null;
}

export function setSectorInspect(w: WorldDraft, sectorId: number, flag: FlagFilter | null): { ok: boolean; reason?: string } {
  const b = sectorInspectBlocked(w, sectorId, flag);
  if (b) return { ok: false, reason: b };
  w.sectors[sectorId].inspect = flag;
  w.events.push({
    severity: 'INFO',
    text: flag ? `STANDING ORDER: ${w.map.sectors[sectorId].label} — task forces at sea search ${flagText(flag)} merchant ships that pass close by` : `STANDING ORDER: ${w.map.sectors[sectorId].label} — merchant searches cancelled`,
  });
  return { ok: true };
}

function beginSearch(w: WorldDraft, m: Merchant, tf: TaskForce, turnAfter: boolean) {
  m.inspecting = { tfId: tf.id, doneTick: w.tick + INSPECT_DAYS, turnAfter };
  w.events.push({ severity: 'INFO', text: `SEARCH: ${tf.name} boards ${merchantTag(m)} — held ${INSPECT_DAYS} days` });
}

/** A search ends: contraband is seized, or an innocent ship is released (or turned back under an exclusion order). */
function finishSearch(w: WorldDraft, m: Merchant) {
  const sh = w.shipping;
  const job = m.inspecting!;
  const tf = tfOf(w, job.tfId);
  const name = tf?.name ?? 'The boarding party';
  m.inspecting = null;
  m.checked = true;
  if (tf && tf.escort === m.id && tf.escortMode === 'INSPECT') releaseEscort(w, tf);
  m.escort = null;
  count(sh, 'inspections');
  const found = m.contraband && new Rng(`${w.seed}:search:${w.tick}:${m.id}`).chance(m.tip ? FIND_TIPPED : FIND_UNTIPPED);
  if (found) {
    const money = Math.round(m.cargo * SEIZURE_SHARE);
    w.resources.budget += money;
    adjustSupport(w, 2);
    w.tension = clamp(w.tension + 0.5);
    w.stats.seizures++;
    count(sh, 'seized');
    w.events.push({ severity: 'ADVISORY', text: `SEIZURE: ${name} finds contraband aboard ${merchantTag(m)} — cargo confiscated (+${money} M, support +2)` });
    removeMerchant(w, m);
    return;
  }
  const home = m.flag === 'DOMESTIC_YARDS';
  const open = m.flag === 'OPEN_REGISTRY';
  const supportLoss = home || open ? 0.5 : 1;
  adjustSupport(w, -supportLoss);
  w.tension = clamp(w.tension + 1);
  adjustPolarization(w, 0.5);
  flagReaction(w, m.flag, 3);
  w.events.push({
    severity: 'WARNING',
    text: `SEARCH CLEAN: ${name} finds nothing aboard ${merchantTag(m)} — ${home ? 'owners protest' : `${flagText(m.flag)} protests`} (support −${supportLoss}, tension +1${flagVendors(m.flag).length ? ', flag-state standing −3' : ''})${m.tip ? ' — the tip-off was wrong' : ''}`,
  });
  if (job.turnAfter) turnBack(w, m);
}

function turnBack(w: WorldDraft, m: Merchant) {
  m.turnedBack = true;
  m.dir = (m.dir === 1 ? -1 : 1) as 1 | -1;
  count(w.shipping, 'turnedBack');
  adjustPolarization(w, 0.5);
  w.tension = clamp(w.tension + 0.5);
  flagReaction(w, m.flag, 1);
  w.events.push({ severity: 'WARNING', text: `TURNED BACK: ${merchantTag(m)} ordered out of the exclusion zone` });
}

// ------------------------------------------------------------------------------------------ T5: exclusion orders

export const zoneInForce = (z: ExclusionZone, tick: number) => tick >= z.effectiveTick;

/** Sectors that lie on at least one lane (the only ones an order can name). */
export function laneSectors(w: Pick<WorldDraft, 'shipping'>): number[] {
  return [...new Set(w.shipping.lanes.flatMap((l) => l.sectors))].sort((a, b) => a - b);
}

export function zoneBlocked(w: WorldDraft, flag: FlagFilter, sectors: number[]): string | null {
  if (w.shipping.lanes.length === 0) return 'NO SHIPPING LANES IN THIS THEATRE';
  if (flag === 'DOMESTIC_YARDS' || !INTERDICTION_FLAGS.includes(flag)) return 'THE HOME FLAG CANNOT BE NAMED';
  if (sectors.length === 0) return 'CHOOSE AT LEAST ONE SECTOR';
  const on = laneSectors(w);
  if (sectors.some((s) => !on.includes(s))) return 'EVERY SECTOR MUST LIE ON A SHIPPING LANE';
  const refuse = ministriesRefuse(w);
  if (refuse) return refuse;
  if (w.shipping.zones.length >= MAX_ZONES) return `AT MOST ${MAX_ZONES} EXCLUSION ORDERS AT ONCE`;
  const key = [...sectors].sort((a, b) => a - b).join();
  if (w.shipping.zones.some((z) => z.flag === flag && [...z.sectors].sort((a, b) => a - b).join() === key)) return 'THIS ORDER ALREADY EXISTS';
  const pc = lobbyCost(w, ZONE_PC);
  if (w.resources.politicalCapital < pc) return `NEEDS ${pc} POLITICAL CAPITAL`;
  return null;
}

export function declareZone(w: WorldDraft, flag: FlagFilter, sectors: number[], policy: InterdictionPolicy): { ok: boolean; reason?: string } {
  const b = zoneBlocked(w, flag, sectors);
  if (b) return { ok: false, reason: b };
  const sh = w.shipping;
  w.resources.politicalCapital -= lobbyCost(w, ZONE_PC);
  sh.zoneSeq++;
  const zone: ExclusionZone = { id: `EZ-${sh.zoneSeq}`, flag, sectors: [...sectors].sort((a, b) => a - b), declaredTick: w.tick, effectiveTick: w.tick + NOTICE_DAYS, policy };
  sh.zones.push(zone);
  // Announcement: the flag state and its bloc react at once, insurers price the lanes, the home front splits.
  const scale = flag === 'ALL' ? 0.5 : 1;
  for (const id of flagVendors(flag)) w.vendors[id].standing = Math.max(0, w.vendors[id].standing - 4 * scale);
  if (flag !== 'ALL') flagReaction(w, flag as Flag, 0, 2);
  w.tension = clamp(w.tension + 4);
  adjustSupport(w, 1.5);
  adjustPolarization(w, 6);
  for (const lane of sh.lanes) if (lane.sectors.some((s) => zone.sectors.includes(s))) lane.risk = clamp(lane.risk + 8);
  const where = zone.sectors.map((s) => w.map.sectors[s].label).join(', ');
  w.events.push({
    severity: 'WARNING',
    text: `EXCLUSION ORDER ${zone.id}: ${flagText(flag)} shipping barred from ${where} — NOTICE ${NOTICE_DAYS} days, no force before day ${zone.effectiveTick} (policy: ${POLICY_LABEL[policy]}); shipping already reroutes, tension +4`,
  });
  return { ok: true };
}

export function liftBlocked(w: WorldDraft, zoneId: string): string | null {
  return w.shipping.zones.some((z) => z.id === zoneId) ? null : 'NO SUCH EXCLUSION ORDER';
}

export function liftZone(w: WorldDraft, zoneId: string): { ok: boolean; reason?: string } {
  const b = liftBlocked(w, zoneId);
  if (b) return { ok: false, reason: b };
  const z = w.shipping.zones.find((x) => x.id === zoneId)!;
  w.shipping.zones = w.shipping.zones.filter((x) => x.id !== zoneId);
  w.tension = clamp(w.tension - 2);
  adjustPolarization(w, -2);
  for (const id of flagVendors(z.flag)) w.vendors[id].standing = Math.min(100, w.vendors[id].standing + 2);
  w.events.push({ severity: 'ADVISORY', text: `EXCLUSION ORDER ${z.id} LIFTED: ${flagText(z.flag)} shipping may return (tension −2)` });
  return { ok: true };
}

export function zonePolicyBlocked(w: WorldDraft, zoneId: string, policy: InterdictionPolicy): string | null {
  const z = w.shipping.zones.find((x) => x.id === zoneId);
  if (!z) return 'NO SUCH EXCLUSION ORDER';
  return z.policy === policy ? 'ALREADY THIS POLICY' : null;
}

export function setZonePolicy(w: WorldDraft, zoneId: string, policy: InterdictionPolicy): { ok: boolean; reason?: string } {
  const b = zonePolicyBlocked(w, zoneId, policy);
  if (b) return { ok: false, reason: b };
  const z = w.shipping.zones.find((x) => x.id === zoneId)!;
  const harsher = ['INSPECT_ALL', 'TURN_BACK', 'UNRESTRICTED'].indexOf(policy) > ['INSPECT_ALL', 'TURN_BACK', 'UNRESTRICTED'].indexOf(z.policy);
  z.policy = policy;
  if (harsher) adjustPolarization(w, 2);
  w.events.push({ severity: 'WARNING', text: `EXCLUSION ORDER ${z.id}: policy now ${POLICY_LABEL[policy]}${zoneInForce(z, w.tick) ? '' : ` (in force from day ${z.effectiveTick})`}` });
  return { ok: true };
}

/** The zone that lets us use force on this ship now, if any. */
export function zoneFor(w: WorldDraft, m: Merchant, sectorId: number): ExclusionZone | undefined {
  if (m.kind === 'FERRY') return undefined;
  return w.shipping.zones.find((z) => zoneInForce(z, w.tick) && flagMatches(z.flag, m.flag) && z.sectors.includes(sectorId));
}

/** A strike on this ship is lawful: an UNRESTRICTED order in force covers it and the sector is at WEAPONS FREE. */
export function strikeLegal(w: WorldDraft, m: Merchant): boolean {
  const lane = laneOf(w.shipping, m.laneId);
  if (!lane) return false;
  const sec = sectorOf(w, m, lane);
  const z = zoneFor(w, m, sec);
  return !!z && z.policy === 'UNRESTRICTED' && w.sectors[sec].roe === 'WEAPONS_FREE';
}

export function engageBlocked(w: WorldDraft, tfId: string, merchantId: string): string | null {
  const tf = tfOf(w, tfId);
  if (!tf) return 'NO SUCH TASK FORCE';
  const m = w.shipping.ships.find((x) => x.id === merchantId);
  if (!m) return 'THAT SHIP HAS LEFT THE PLOT';
  if (m.kind === 'FERRY') return 'PASSENGER FERRIES CANNOT BE ENGAGED';
  if (shipsAtSea(w, tf).length === 0) return 'NO SHIP OF THIS TASK FORCE IS AVAILABLE AT SEA';
  if (dist(tf.position, m.position) > FORCE_RANGE) return `OUT OF RANGE — THE TASK FORCE MUST BE WITHIN ${FORCE_RANGE} TILES`;
  return null;
}

/** Deliberate use of force against a merchant ship. Lawful under an UNRESTRICTED order in force; otherwise the gravest incident. */
export function engageMerchant(w: WorldDraft, tfId: string, merchantId: string): { ok: boolean; reason?: string } {
  const b = engageBlocked(w, tfId, merchantId);
  if (b) return { ok: false, reason: b };
  const tf = tfOf(w, tfId)!;
  const m = w.shipping.ships.find((x) => x.id === merchantId)!;
  strike(w, m, tf.name, strikeLegal(w, m));
  return { ok: true };
}

/** A ship is struck by our forces. `legal` = under an order in force; otherwise it is the gravest incident. */
function strike(w: WorldDraft, m: Merchant, by: string, legal: boolean) {
  const sh = w.shipping;
  const lane = laneOf(sh, m.laneId)!;
  const sec = sectorOf(w, m, lane);
  const crew = CREW[m.kind];
  count(sh, 'struck');
  count(sh, 'toll', crew);
  count(sh, 'cargoLostByUs', m.cargo);
  w.stats.incidents++;
  w.stats.lastIncidentTick = w.tick;
  if (legal) {
    w.tension = clamp(w.tension + 4);
    w.resources.politicalCapital = clamp(w.resources.politicalCapital - 3, 0, 60);
    adjustSupport(w, 1.5);
    adjustPolarization(w, 3 + crew / 20);
    flagReaction(w, m.flag, 10, 3);
    lane.risk = clamp(lane.risk + 10);
    w.events.push({
      severity: 'CRITICAL',
      text: `INTERDICTION: ${by} strikes ${merchantTag(m)} under the exclusion order in ${w.map.sectors[sec].label} — ship lost, ${crew} crew casualties (civilian toll ${sh.stats.toll}); tension +4, flag-state standing −10`,
    });
  } else {
    count(sh, 'gravest');
    w.tension = clamp(w.tension + 20);
    w.resources.politicalCapital = clamp(w.resources.politicalCapital - 15, 0, 60);
    adjustSupport(w, -12);
    adjustPolarization(w, 10 + crew / 10);
    flagReaction(w, m.flag, 20, 6);
    lane.risk = clamp(lane.risk + 25);
    w.events.push({
      severity: 'CRITICAL',
      text: `GRAVEST INCIDENT: ${by} attacks ${merchantTag(m)} with no exclusion order in force in ${w.map.sectors[sec].label} — ship lost, ${crew} crew casualties (civilian toll ${sh.stats.toll}); tension +20, support −12, flag-state standing −20`,
    });
  }
  removeMerchant(w, m);
}

// ------------------------------------------------------------------------------------------ daily tick

/** Text of last fiscal year's shipping report, from the year counters. */
export function shippingReport(w: WorldDraft, fiscalYear: number): string {
  const y = w.shipping.year;
  const c = y.counts;
  const avg = y.days ? y.indexSum / y.days : 100;
  const worst = Object.entries(y.lossBySector).sort((a, b) => b[1] - a[1])[0];
  const parts = [
    `${c.transited} passages`,
    `${c.lost} lost to raiders${worst ? ` (most in ${w.map.sectors[Number(worst[0])].label}: ${worst[1]})` : ''}`,
    `${c.inspections} searches, ${c.seized} seizures`,
    ...(c.turnedBack ? [`${c.turnedBack} turned back`] : []),
    ...(c.struck ? [`${c.struck} ships struck by our forces, ${c.toll} civilian crew casualties`] : []),
    `trade index averaged ${avg.toFixed(0)}`,
  ];
  return `SHIPPING REPORT FY${fiscalYear}: ${parts.join(' · ')}`;
}

export function tickInterdiction(w: WorldDraft, _rng: Rng): void {
  const sh = w.shipping;
  if (w.scripted || sh.lanes.length === 0) return;

  // ---- orders coming into force; polarization eases only while no force is authorised
  for (const z of sh.zones) if (w.tick === z.effectiveTick) w.events.push({ severity: 'WARNING', text: `EXCLUSION ORDER ${z.id} IN FORCE: ${POLICY_LABEL[z.policy]} — ${flagText(z.flag)} shipping in ${z.sectors.map((s) => w.map.sectors[s].label).join(', ')}` });
  if (!sh.zones.some((z) => zoneInForce(z, w.tick))) adjustPolarization(w, -Math.min(POLARIZATION_DECAY, polarizationOf(w)));

  // ---- searches to begin: ordered > exclusion order > sector standing order
  for (const tf of allTaskForces(w.fleets)) {
    if (tf.escortMode !== 'INSPECT' || !tf.escort) continue;
    const m = sh.ships.find((x) => x.id === tf.escort);
    if (!m) {
      releaseEscort(w, tf);
      continue;
    }
    if (!m.inspecting && dist(tf.position, m.position) <= INSPECT_RANGE) beginSearch(w, m, tf, false);
  }
  for (const m of sh.ships) {
    if (m.inspecting || m.checked || m.turnedBack || m.status !== 'UNDERWAY' || m.kind === 'FERRY') continue;
    const lane = laneOf(sh, m.laneId);
    if (!lane) continue;
    const sec = sectorOf(w, m, lane);
    const cover = nearestCover(w, m.position);
    if (!cover || cover.d > FORCE_RANGE) continue;
    const z = zoneFor(w, m, sec);
    if (z) {
      if (z.policy === 'UNRESTRICTED' && w.sectors[sec].roe === 'WEAPONS_FREE') {
        strike(w, m, cover.tf.name, true);
        continue;
      }
      beginSearch(w, m, cover.tf, z.policy !== 'INSPECT_ALL'); // turn-back and unrestricted-below-weapons-free both turn back the innocent
      continue;
    }
    const order = w.sectors[sec]?.inspect;
    if (order && flagMatches(order, m.flag) && !m.escort) beginSearch(w, m, cover.tf, false);
  }

  // ---- searches that finish today
  for (const m of [...sh.ships]) if (m.inspecting && w.tick >= m.inspecting.doneTick) finishSearch(w, m);

  // ---- fiscal-year report
  if (dayOfYear(w.tick) === 0 && w.tick > 0) {
    const text = shippingReport(w, w.politics.fiscal.year - 1);
    sh.lastReport = text;
    w.events.push({ severity: 'ADVISORY', text });
    sh.year = { counts: emptyStats(), indexSum: 0, days: 0, lossBySector: {} };
  }
}

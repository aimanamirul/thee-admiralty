/** Vendors, lobbying, geopolitical tension and export-sanction hazards. */
import { MINISTRIES, MODULE_BY_ID } from '../data/catalog';
import { vt } from '../data/tokens';
import { adjustSupport, lobbyCost, ministriesRefuse } from './politicsEngine';
import { REGIMES, rollSanctionKind, sanctionRiskPerDay } from './relationsEngine';
import { embeddedInFleet, exposeChain, exposure } from './supplyChain';
import { rungIndex } from '../types/diplomacy';
import type { Rng } from '../generator/prng';
import type { SanctionKind, Vendor, VendorId } from '../types/diplomacy';
import type { EquipmentModule } from '../types/equipment';
import type { WorldDraft } from '../types/world';

export const WARNING_DAYS = 12;
export const AVERT_STANDING = 65;
export const REINSTATE_STANDING = 40;

const HEADLINES = [
  'Border incident inflames regional tensions',
  'Arms-control talks collapse in committee',
  'Allied parliament debates export embargo motion',
  'Naval standoff reported in contested waters',
  'Sanctions package proposed against neighbouring state',
];

export function activeSanction(world: WorldDraft, vendorId: VendorId, kind?: SanctionKind) {
  return world.sanctions.find(
    (s) => s.vendorId === vendorId && (s.endTick === null || s.endTick > world.tick) && (!kind || s.kind === kind),
  );
}

/** New orders and spare-parts *purchases* are blocked while a hard sanction is in force. */
export function vendorBlocksOrders(v: Vendor): boolean {
  return v.status === 'FROZEN' || v.status === 'REVOKED';
}

/** Support contract terminated: even stockpiled spares of this vendor cannot be fitted by the yards. */
export function vendorBlocksSpareUse(world: WorldDraft, vendorId: VendorId): boolean {
  return world.vendors[vendorId].status === 'REVOKED' || !!activeSanction(world, vendorId, 'PARTS_EMBARGO');
}

/** The first vendor (prime or sub-supplier) whose sanction blocks orders of this module, or null. */
export function moduleOrdersBlocked(world: WorldDraft, m: EquipmentModule): VendorId | null {
  return exposure(m).find((id) => world.vendors[id] && vendorBlocksOrders(world.vendors[id])) ?? null;
}

/** Stockpiled spares of this module cannot be fitted while any vendor in its supply chain embargoes parts or has revoked. */
export function moduleSpareUseBlocked(world: WorldDraft, moduleId: string): boolean {
  const m = MODULE_BY_ID[moduleId];
  return !!m && exposure(m).some((id) => world.vendors[id] && vendorBlocksSpareUse(world, id));
}

/** Standing a lobbying round actually buys: regime responsiveness, +25% for strategic partners. */
export function lobbyGain(v: Vendor, base: number): number {
  return Math.round(base * REGIMES[v.regime].lobbyEffect * (v.rung === 'STRATEGIC' ? 1.25 : 1));
}

export function lobbyVendor(world: WorldDraft, vendorId: VendorId, ministryId: string): { ok: boolean; reason?: string } {
  const v = world.vendors[vendorId];
  const m = MINISTRIES.find((x) => x.id === ministryId);
  if (!v || !m) return { ok: false, reason: 'UNKNOWN TARGET' };
  if (vendorId === 'DOMESTIC_YARDS') return { ok: false, reason: 'DOMESTIC YARDS NEED NO LOBBYING' };
  if (v.rung === 'UNKNOWN') return { ok: false, reason: 'SUPPLIER NOT YET KNOWN — SCOUT FIRST' };
  const refuse = ministriesRefuse(world);
  if (refuse) return { ok: false, reason: refuse };
  const cost = lobbyCost(world, m.cost);
  if (world.resources.politicalCapital < cost) return { ok: false, reason: `NEEDS ${cost} POLITICAL CAPITAL` };
  world.resources.politicalCapital -= cost;
  const gain = lobbyGain(v, m.standingGain);
  v.standing = Math.min(100, v.standing + gain);
  world.events.push({ severity: 'INFO', text: `LOBBY: ${m.name} → ${vt(v.id)} standing +${gain} (now ${v.standing.toFixed(0)})` });

  if (v.status === 'FROZEN' && v.statusUntilTick !== null) {
    v.statusUntilTick = Math.max(world.tick + 1, v.statusUntilTick - 10);
    const s = activeSanction(world, vendorId);
    if (s) s.endTick = v.statusUntilTick;
    world.events.push({ severity: 'INFO', text: `${vt(v.id)} sanction shortened — lifts day ${v.statusUntilTick}` });
  }
  if (v.status === 'REVOKED' && v.standing >= REINSTATE_STANDING) {
    v.status = 'ACTIVE';
    v.statusUntilTick = null;
    for (const s of world.sanctions) if (s.vendorId === vendorId && s.endTick === null) s.endTick = world.tick;
    world.events.push({ severity: 'ADVISORY', text: `${vt(v.id)} licence REINSTATED after ministerial intervention` });
  }
  return { ok: true };
}

/** Daily tension walk, standing drift and sanction state machine. */
export function tickDiplomacy(world: WorldDraft, rng: Rng): void {
  // Tension: mean-reverting walk with rare spikes.
  if (!world.scripted) world.tension += rng.gaussian() * 0.9 + 0.02 * (35 - world.tension);
  if (!world.scripted && rng.chance(0.012)) {
    const spike = rng.range(12, 28);
    world.tension += spike;
    world.events.push({ severity: 'WARNING', text: `GEOPOLITICAL: ${rng.pick(HEADLINES)} (tension +${spike.toFixed(0)})` });
  }
  world.tension = Math.max(0, Math.min(100, world.tension));

  for (const v of Object.values(world.vendors)) {
    if (v.id === 'DOMESTIC_YARDS') continue;
    // A sub-supplier inside hulls we operate can sanction us even if we never dealt with it directly (or never heard of it).
    const embedded = embeddedInFleet(world, v.id);
    if (v.rung === 'UNKNOWN' && !embedded) continue;
    if (!world.scripted && v.rung !== 'UNKNOWN') v.standing = Math.max(10, v.standing - 0.03); // goodwill decays without upkeep

    if (v.status === 'ACTIVE') {
      if (world.scripted) continue; // scripted worlds inject sanctions by hand
      // Only vendors we buy from, directly or through components in our hulls, can sanction us.
      if (rungIndex(v.rung) < rungIndex('FRAMEWORK') && !embedded) continue;
      if (rng.chance(sanctionRiskPerDay(world, v))) {
        v.pendingSanction = rollSanctionKind(v, rng.next());
        v.status = 'WARNING';
        const notice = REGIMES[v.regime].warningDays || WARNING_DAYS;
        v.statusUntilTick = world.tick + notice;
        world.events.push({
          severity: 'WARNING',
          text: `EXPORT RISK: ${vt(v.id)} signals ${v.pendingSanction.replace('_', ' ')} in ${notice} days — lobby to avert`,
        });
        exposeChain(world, v);
      }
    } else if (v.status === 'WARNING' && v.statusUntilTick !== null && world.tick >= v.statusUntilTick) {
      const kind = v.pendingSanction ?? 'EXPORT_FREEZE';
      if (v.standing >= AVERT_STANDING) {
        v.status = 'ACTIVE';
        v.statusUntilTick = null;
        v.pendingSanction = null;
        v.standing -= 5;
        world.events.push({ severity: 'ADVISORY', text: `${vt(v.id)} sanction AVERTED — ministerial assurances held` });
        adjustSupport(world, 1.5);
      } else if (kind === 'LICENSE_REVOKED') {
        v.status = 'REVOKED';
        v.statusUntilTick = null;
        v.pendingSanction = null;
        v.standing = Math.min(v.standing, 8);
        world.sanctions.push({ id: `SAN-${world.tick}-${v.id}`, vendorId: v.id, kind, startTick: world.tick, endTick: null });
        adjustSupport(world, -3);
        world.events.push({ severity: 'CRITICAL', text: `${vt(v.id)}: EXPORT LICENCE REVOKED — orders frozen, support contracts terminated` });
      } else {
        const [lo, hi] = REGIMES[v.regime].freezeDays;
        const days = rng.int(lo || 30, hi || 90);
        v.status = 'FROZEN';
        v.statusUntilTick = world.tick + days;
        v.pendingSanction = null;
        world.sanctions.push({ id: `SAN-${world.tick}-${v.id}`, vendorId: v.id, kind, startTick: world.tick, endTick: world.tick + days });
        adjustSupport(world, -1.5);
        world.events.push({
          severity: 'CRITICAL',
          text:
            kind === 'EXPORT_FREEZE'
              ? `${vt(v.id)}: EXPORT FREEZE for ${days} days — construction using their hardware stalled`
              : `${vt(v.id)}: PARTS EMBARGO for ${days} days — their spares cannot be fitted (cannibalise hulks!)`,
        });
      }
    } else if (v.status === 'FROZEN' && v.statusUntilTick !== null && world.tick >= v.statusUntilTick) {
      v.status = 'ACTIVE';
      v.statusUntilTick = null;
      world.events.push({ severity: 'ADVISORY', text: `${vt(v.id)}: sanctions lifted — deliveries resume` });
    }
  }
  syncConstructionFreezes(world);
}

/** Mark ships under construction as stalled by whichever vendor's export freeze / revocation hits their kit. */
export function syncConstructionFreezes(world: WorldDraft): void {
  for (const ship of Object.values(world.ships)) {
    if (ship.buildStatus !== 'CONSTRUCTING') continue;
    let culprit: VendorId | null = null;
    outer: for (const m of ship.modules) {
      const def = MODULE_BY_ID[m.moduleId];
      if (!def) continue;
      for (const vid of exposure(def)) {
        const v = world.vendors[vid];
        const hard = v.status === 'REVOKED' || (v.status === 'FROZEN' && !!activeSanction(world, vid, 'EXPORT_FREEZE'));
        if (hard) {
          culprit = vid;
          break outer;
        }
      }
    }
    if (culprit && ship.frozenBy !== culprit) {
      world.events.push({ severity: 'WARNING', text: `${ship.pennant} ${ship.name.toUpperCase()}: construction FROZEN — ${vt(culprit)} sanction` });
    }
    ship.frozenBy = culprit;
  }
}

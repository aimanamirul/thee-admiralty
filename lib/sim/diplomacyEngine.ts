/** Vendors, lobbying, geopolitical tension and export-sanction hazards. */
import { MINISTRIES, MODULE_BY_ID } from '../data/catalog';
import type { Rng } from '../generator/prng';
import type { SanctionKind, Vendor, VendorId } from '../types/diplomacy';
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

export function lobbyVendor(world: WorldDraft, vendorId: VendorId, ministryId: string): { ok: boolean; reason?: string } {
  const v = world.vendors[vendorId];
  const m = MINISTRIES.find((x) => x.id === ministryId);
  if (!v || !m) return { ok: false, reason: 'UNKNOWN TARGET' };
  if (vendorId === 'DOMESTIC_YARDS') return { ok: false, reason: 'DOMESTIC YARDS NEED NO LOBBYING' };
  if (world.resources.politicalCapital < m.cost) return { ok: false, reason: `NEEDS ${m.cost} POLITICAL CAPITAL` };
  world.resources.politicalCapital -= m.cost;
  v.standing = Math.min(100, v.standing + m.standingGain);
  world.events.push({ severity: 'INFO', text: `LOBBY: ${m.name} → ${v.name} standing +${m.standingGain} (now ${v.standing.toFixed(0)})` });

  if (v.status === 'FROZEN' && v.statusUntilTick !== null) {
    v.statusUntilTick = Math.max(world.tick + 1, v.statusUntilTick - 10);
    const s = activeSanction(world, vendorId);
    if (s) s.endTick = v.statusUntilTick;
    world.events.push({ severity: 'INFO', text: `${v.name} sanction shortened — lifts day ${v.statusUntilTick}` });
  }
  if (v.status === 'REVOKED' && v.standing >= REINSTATE_STANDING) {
    v.status = 'ACTIVE';
    v.statusUntilTick = null;
    for (const s of world.sanctions) if (s.vendorId === vendorId && s.endTick === null) s.endTick = world.tick;
    world.events.push({ severity: 'ADVISORY', text: `${v.name} licence REINSTATED after ministerial intervention` });
  }
  return { ok: true };
}

/** Daily tension walk, standing drift and sanction state machine. */
export function tickDiplomacy(world: WorldDraft, rng: Rng): void {
  // Tension: mean-reverting walk with rare spikes.
  world.tension += rng.gaussian() * 0.9 + 0.02 * (35 - world.tension);
  if (rng.chance(0.012)) {
    const spike = rng.range(12, 28);
    world.tension += spike;
    world.events.push({ severity: 'WARNING', text: `GEOPOLITICAL: ${rng.pick(HEADLINES)} (tension +${spike.toFixed(0)})` });
  }
  world.tension = Math.max(0, Math.min(100, world.tension));

  for (const v of Object.values(world.vendors)) {
    if (v.id === 'DOMESTIC_YARDS') continue;
    v.standing = Math.max(10, v.standing - 0.03); // goodwill decays without upkeep

    if (v.status === 'ACTIVE') {
      const p = (world.tension / 100) ** 2 * v.volatility * 0.03 * (1 - v.standing / 130);
      if (rng.chance(p)) {
        const roll = rng.next();
        v.pendingSanction = roll < 0.55 ? 'EXPORT_FREEZE' : roll < 0.8 ? 'PARTS_EMBARGO' : 'LICENSE_REVOKED';
        v.status = 'WARNING';
        v.statusUntilTick = world.tick + WARNING_DAYS;
        world.events.push({
          severity: 'WARNING',
          text: `EXPORT RISK: ${v.name} signals ${v.pendingSanction.replace('_', ' ')} in ${WARNING_DAYS} days — lobby to avert`,
        });
      }
    } else if (v.status === 'WARNING' && v.statusUntilTick !== null && world.tick >= v.statusUntilTick) {
      const kind = v.pendingSanction ?? 'EXPORT_FREEZE';
      if (v.standing >= AVERT_STANDING) {
        v.status = 'ACTIVE';
        v.statusUntilTick = null;
        v.pendingSanction = null;
        v.standing -= 5;
        world.events.push({ severity: 'ADVISORY', text: `${v.name} sanction AVERTED — ministerial assurances held` });
      } else if (kind === 'LICENSE_REVOKED') {
        v.status = 'REVOKED';
        v.statusUntilTick = null;
        v.pendingSanction = null;
        v.standing = Math.min(v.standing, 8);
        world.sanctions.push({ id: `SAN-${world.tick}-${v.id}`, vendorId: v.id, kind, startTick: world.tick, endTick: null });
        world.events.push({ severity: 'CRITICAL', text: `${v.name}: EXPORT LICENCE REVOKED — orders frozen, support contracts terminated` });
      } else {
        const days = rng.int(30, 90);
        v.status = 'FROZEN';
        v.statusUntilTick = world.tick + days;
        v.pendingSanction = null;
        world.sanctions.push({ id: `SAN-${world.tick}-${v.id}`, vendorId: v.id, kind, startTick: world.tick, endTick: world.tick + days });
        world.events.push({
          severity: 'CRITICAL',
          text:
            kind === 'EXPORT_FREEZE'
              ? `${v.name}: EXPORT FREEZE for ${days} days — construction using their hardware stalled`
              : `${v.name}: PARTS EMBARGO for ${days} days — their spares cannot be fitted (cannibalise hulks!)`,
        });
      }
    } else if (v.status === 'FROZEN' && v.statusUntilTick !== null && world.tick >= v.statusUntilTick) {
      v.status = 'ACTIVE';
      v.statusUntilTick = null;
      world.events.push({ severity: 'ADVISORY', text: `${v.name}: sanctions lifted — deliveries resume` });
    }
  }
  syncConstructionFreezes(world);
}

/** Mark ships under construction as stalled by whichever vendor's export freeze / revocation hits their kit. */
export function syncConstructionFreezes(world: WorldDraft): void {
  for (const ship of Object.values(world.ships)) {
    if (ship.buildStatus !== 'CONSTRUCTING') continue;
    let culprit: VendorId | null = null;
    for (const m of ship.modules) {
      const vid = MODULE_BY_ID[m.moduleId]?.vendorId;
      if (!vid) continue;
      const v = world.vendors[vid];
      const hard = v.status === 'REVOKED' || (v.status === 'FROZEN' && !!activeSanction(world, vid, 'EXPORT_FREEZE'));
      if (hard) {
        culprit = vid;
        break;
      }
    }
    if (culprit && ship.frozenBy !== culprit) {
      world.events.push({ severity: 'WARNING', text: `${ship.pennant} ${ship.name.toUpperCase()}: construction FROZEN — ${world.vendors[culprit].name} sanction` });
    }
    ship.frozenBy = culprit;
  }
}

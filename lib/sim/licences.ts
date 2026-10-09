/**
 * How a submarine is bought (docs/PLAN-submarines.md S4).
 *
 * - First of class: the first boat of each hull family needs a crew-training package from the builder: extra cost and extra build days.
 *   Later boats of the family do not. (There is no separate crew resource.)
 * - Licensed production: a vendor at STRATEGIC will license a submarine family to the domestic yards. A licensed hull is cheaper and slower,
 *   is built (and paid for) by the domestic yards, and is immune to the vendor's own export freeze on the hull. It stays exposed to the vendor's
 *   licence being REVOKED, to the hull's hidden sub-suppliers, and its modules and spares are still bought from vendors.
 */
import { hullPlatform, HULLS } from '../data/catalog';
import { vt } from '../data/tokens';
import type { VendorId } from '../types/diplomacy';
import type { HullClassId } from '../types/hull';
import type { WorldDraft } from '../types/world';
import { lobbyCost } from './politicsEngine';

export const TRAINING_DAYS = 40;
export const TRAINING_RATE = 0.15;
export const LICENCE_PC = 14;
export const LICENCE_MONEY = 180;
export const LICENSED_HULL_RATE = 0.75;
export const LICENSED_DAYS_RATE = 1.3;

export const isBoatHull = (hullId: HullClassId) => hullPlatform(HULLS[hullId]) === 'SUBSURFACE';

/** Has the navy already ordered a boat of this family (so no training package is needed)? */
export const familyBuilt = (w: Pick<WorldDraft, 'stats'>, hullId: HullClassId) => !!w.stats.boatFamilies?.includes(hullId);

export const isLicensed = (w: Pick<WorldDraft, 'vendors'>, hullId: HullClassId): boolean => {
  const v = HULLS[hullId].vendorId;
  return !!v && !!w.vendors[v]?.licences?.includes(hullId);
};

export interface OrderTerms {
  /** Total contract price (millions) and days to build. */
  price: number;
  days: number;
  trainingCost: number;
  trainingDays: number;
  licensed: boolean;
  /** Saving on the hull from licensed production. */
  hullSaving: number;
}

/** What a hull order costs and takes, given the loadout price `loadoutCost` (hull + modules at list). */
export function orderTerms(w: Pick<WorldDraft, 'stats' | 'vendors'>, hullId: HullClassId, loadoutCost: number): OrderTerms {
  const hull = HULLS[hullId];
  const licensed = isBoatHull(hullId) && isLicensed(w, hullId);
  const hullSaving = licensed ? hull.cost * (1 - LICENSED_HULL_RATE) : 0;
  const training = isBoatHull(hullId) && !familyBuilt(w, hullId);
  const base = loadoutCost - hullSaving;
  const trainingCost = training ? base * TRAINING_RATE : 0;
  const trainingDays = training ? TRAINING_DAYS : 0;
  const days = Math.round(hull.buildDays * (licensed ? LICENSED_DAYS_RATE : 1)) + trainingDays;
  return { price: base + trainingCost, days, trainingCost, trainingDays, licensed, hullSaving };
}

/** Which hull families a vendor could license (its own submarine hulls). */
export const licensableHulls = (vendorId: VendorId): HullClassId[] => (Object.values(HULLS) as typeof HULLS[HullClassId][]).filter((h) => h.vendorId === vendorId && hullPlatform(h) === 'SUBSURFACE').map((h) => h.id);

export function licenceBlocked(w: WorldDraft, vendorId: VendorId, hullId: HullClassId): string | null {
  const v = w.vendors[vendorId];
  const hull = HULLS[hullId];
  if (!v || hull.vendorId !== vendorId || !isBoatHull(hullId)) return 'THE VENDOR DOES NOT BUILD THAT HULL';
  if (v.licences?.includes(hullId)) return 'ALREADY LICENSED';
  if (v.status !== 'ACTIVE') return `${v.status} — NO LICENCE WHILE THE VENDOR IS UNDER SANCTION`;
  if (v.rung !== 'STRATEGIC') return 'ONLY A STRATEGIC PARTNER LICENSES A HULL';
  const pc = lobbyCost(w, LICENCE_PC);
  if (w.resources.politicalCapital < pc) return `NEEDS ${pc} POLITICAL CAPITAL`;
  if (w.resources.budget < LICENCE_MONEY) return `NEEDS ${LICENCE_MONEY} M`;
  return null;
}

export function negotiateLicence(w: WorldDraft, vendorId: VendorId, hullId: HullClassId): { ok: boolean; reason?: string; message?: string } {
  const why = licenceBlocked(w, vendorId, hullId);
  if (why) return { ok: false, reason: why };
  const pc = lobbyCost(w, LICENCE_PC);
  w.resources.politicalCapital -= pc;
  w.resources.budget -= LICENCE_MONEY;
  const v = w.vendors[vendorId];
  v.licences = [...(v.licences ?? []), hullId];
  w.events.push({ severity: 'ADVISORY', text: `LICENCE: ${vt(vendorId)} licenses the ${HULLS[hullId].name} to the domestic yards (−${pc} PC, −${LICENCE_MONEY} M) — hulls are built at home, cheaper and slower; the vendor's kit, spares and licence status still matter` });
  return { ok: true, message: 'Licence signed' };
}

/**
 * Supply chains (docs/PLAN-foreign-contractors.md §10 phase 2): hidden sub-suppliers inside foreign products.
 *
 * - A module's `origins` are vendors whose components sit inside it. A sanction by any of them hits the module like one of
 *   their own products: frozen orders, stalled construction, embargoed spares.
 * - Fairness (decided): every hazard is avoidable with information. Due diligence on a prime vendor reveals every sub-supplier
 *   in its catalogue before purchase; and when an origin state signals a sanction, its reach into other products becomes public
 *   during the warning period, before anything lands.
 * - No leak by absence: an unverified module looks the same whether or not it hides anything.
 */
import { MODULE_BY_ID, MODULES } from '../data/catalog';
import { mt, vt } from '../data/tokens';
import type { Vendor, VendorId } from '../types/diplomacy';
import type { EquipmentModule } from '../types/equipment';
import type { WorldDraft } from '../types/world';

export const DILIGENCE_COST = 12;
export const DILIGENCE_DAYS = 10;

/** Every vendor whose export licence the module depends on: the prime and its sub-suppliers. */
export function exposure(m: EquipmentModule): VendorId[] {
  return [m.vendorId, ...(m.origins ?? [])];
}

export interface OriginView {
  /** The prime vendor's catalogue has been through due diligence (domestic kit always counts as verified). */
  verified: boolean;
  /** Sub-suppliers the player knows about. */
  known: VendorId[];
}

/** What the player knows about a module's sub-suppliers. */
export function originView(w: Pick<WorldDraft, 'vendors'>, m: EquipmentModule): OriginView {
  if (m.vendorId === 'DOMESTIC_YARDS') return { verified: true, known: [] };
  const verified = !!w.vendors[m.vendorId]?.diligence?.done;
  // Joint-venture partners are public knowledge: no due diligence needed to see them.
  const jv = w.vendors[m.vendorId]?.jvPartners ?? [];
  return { verified, known: (m.origins ?? []).filter((o) => verified || jv.includes(o) || !!w.vendors[o]?.chainExposed) };
}

/** Modules whose products carry this vendor's components (not counting its own catalogue). */
export function embeddingModules(vendorId: VendorId): EquipmentModule[] {
  return MODULES.filter((m) => m.origins?.includes(vendorId));
}

/** Does any hull in the navy (built or building) carry this vendor's components inside another vendor's product? */
export function embeddedInFleet(w: WorldDraft, vendorId: VendorId): boolean {
  for (const s of Object.values(w.ships)) {
    for (const im of s.modules) if (MODULE_BY_ID[im.moduleId]?.origins?.includes(vendorId)) return true;
  }
  return false;
}

/** Ships that depend on each vendor, as far as the player knows, plus ships carrying unverified foreign kit. */
export function fleetExposure(w: Pick<WorldDraft, 'ships' | 'vendors'>): { byVendor: Partial<Record<VendorId, { direct: number; via: number }>>; unverifiedShips: number; unverifiedModules: string[] } {
  const byVendor: Partial<Record<VendorId, { direct: number; via: number }>> = {};
  let unverifiedShips = 0;
  const unverifiedModules = new Set<string>();
  for (const s of Object.values(w.ships)) {
    const direct = new Set<VendorId>();
    const via = new Set<VendorId>();
    let unverified = false;
    for (const im of s.modules) {
      const m = MODULE_BY_ID[im.moduleId];
      if (!m) continue;
      direct.add(m.vendorId);
      const o = originView(w, m);
      for (const k of o.known) via.add(k);
      if (!o.verified) {
        unverified = true;
        unverifiedModules.add(m.id);
      }
    }
    for (const v of direct) (byVendor[v] ??= { direct: 0, via: 0 }).direct++;
    for (const v of via) if (!direct.has(v)) (byVendor[v] ??= { direct: 0, via: 0 }).via++;
    if (unverified) unverifiedShips++;
  }
  delete byVendor.DOMESTIC_YARDS;
  return { byVendor, unverifiedShips, unverifiedModules: [...unverifiedModules] };
}

// ------------------------------------------------------------------------------------------ due diligence

export function diligenceBlocked(w: WorldDraft, vendorId: VendorId): string | null {
  const v = w.vendors[vendorId];
  if (!v) return 'UNKNOWN VENDOR';
  if (vendorId === 'DOMESTIC_YARDS') return 'DOMESTIC SUPPLY CHAIN IS ALREADY KNOWN';
  if (v.rung === 'UNKNOWN') return 'SUPPLIER NOT YET KNOWN — SCOUT FIRST';
  if (v.diligence?.done) return 'DUE DILIGENCE ALREADY COMPLETE';
  if (v.diligence) return `DUE DILIGENCE IN PROGRESS — DAY ${v.diligence.readyTick}`;
  if (w.resources.budget < DILIGENCE_COST) return `NEEDS ${DILIGENCE_COST}M`;
  return null;
}

export function startDiligence(w: WorldDraft, vendorId: VendorId): { ok: boolean; reason?: string } {
  const b = diligenceBlocked(w, vendorId);
  if (b) return { ok: false, reason: b };
  const v = w.vendors[vendorId];
  w.resources.budget -= DILIGENCE_COST;
  v.diligence = { startTick: w.tick, readyTick: w.tick + DILIGENCE_DAYS, done: false };
  w.events.push({ severity: 'INFO', text: `DUE DILIGENCE: auditors sent to ${vt(v.id)} — report due day ${v.diligence.readyTick}` });
  return { ok: true };
}

/** A sub-supplier nobody had heard of becomes a known contact. */
function identify(w: WorldDraft, v: Vendor, how: string) {
  if (v.rung !== 'UNKNOWN') return;
  v.rung = 'CONTACT';
  w.events.push({ severity: 'ADVISORY', text: `NEW SUPPLIER identified ${how}: ${vt(v.id)}; catalogue now visible` });
}

/** Daily: finish audits; a state that has signalled or imposed a sanction has its component reach made public. */
export function tickSupplyChain(w: WorldDraft): void {
  for (const v of Object.values(w.vendors)) {
    if (v.diligence && !v.diligence.done && w.tick >= v.diligence.readyTick) {
      v.diligence.done = true;
      const found = MODULES.filter((m) => m.vendorId === v.id && m.origins?.length);
      if (!found.length) {
        w.events.push({ severity: 'ADVISORY', text: `DUE DILIGENCE: ${vt(v.id)} — no foreign sub-suppliers in its catalogue` });
      } else {
        w.events.push({
          severity: 'ADVISORY',
          text: `DUE DILIGENCE: ${vt(v.id)} — ${found.map((m) => `${mt(m.id)} contains ${m.origins!.map(vt).join(', ')} components`).join('; ')}. A sanction by that state would hit these products too`,
        });
        for (const m of found) for (const o of m.origins!) identify(w, w.vendors[o], 'by due diligence');
      }
    }
    if (v.status !== 'ACTIVE' && !v.chainExposed && embeddingModules(v.id).length) exposeChain(w, v);
  }
}

/** The origin state's move makes its reach into other products public (warning stage: before anything lands). */
export function exposeChain(w: WorldDraft, v: Vendor): void {
  const hit = embeddingModules(v.id);
  if (v.chainExposed || !hit.length) return;
  v.chainExposed = true;
  identify(w, v, 'through its export notice');
  w.events.push({
    severity: 'WARNING',
    text: `SUPPLY CHAIN: ${vt(v.id)} components sit inside ${hit.map((m) => mt(m.id)).join(', ')} — its sanctions reach these products`,
  });
}

/** Vendors, standing, export sanctions, lobbying. */

export type VendorId =
  | 'DOMESTIC_YARDS'
  | 'NAVAL_GROUP_THALES'
  | 'RAYTHEON'
  | 'ASELSAN'
  | 'ZVEZDA_NORD'
  | 'NORDVIK'
  | 'SEORAK'
  | 'KESSLER_BRANDT'
  | 'MITSURUGI'
  | 'DAHAI'
  | 'VAYU_SARATH';

/**
 * Relationship ladder. UNKNOWN vendors are hidden; CONTACT and TRADE_MISSION show the catalogue read-only; FRAMEWORK buys tier-0
 * lines only; SIGNED unlocks tiers by standing; STRATEGIC halves sanction risk and boosts lobbying.
 */
export type Rung = 'UNKNOWN' | 'CONTACT' | 'TRADE_MISSION' | 'FRAMEWORK' | 'SIGNED' | 'STRATEGIC';
export const RUNGS: Rung[] = ['UNKNOWN', 'CONTACT', 'TRADE_MISSION', 'FRAMEWORK', 'SIGNED', 'STRATEGIC'];
export const rungIndex = (r: Rung) => RUNGS.indexOf(r);

/** Export-control regime of the vendor's home state: drives how sanctions behave. */
export type RegimeId = 'HOME' | 'AURELLE' | 'HALCYON' | 'SARNIA' | 'EASTERN' | 'VINTERLAND' | 'SEORYEONG' | 'RHEINMARK' | 'AKITSU' | 'DAHAI' | 'BHARATVAR';
export type Bloc = 'HOME' | 'WEST' | 'EURO' | 'NORDIC' | 'EAST' | 'ASIA_PAC' | 'NON_ALIGNED';

export type LicenseStatus = 'ACTIVE' | 'WARNING' | 'FROZEN' | 'REVOKED';

export interface Vendor {
  id: VendorId;
  name: string;
  country: string;
  /** 0-100 diplomatic / commercial standing. Tier = floor(standing / 25) capped at 3. */
  standing: number;
  regime: RegimeId;
  bloc: Bloc;
  rung: Rung;
  /** Relationship step in progress: completes on `readyTick`. */
  rungProgress: { target: Rung; startTick: number; readyTick: number } | null;
  status: LicenseStatus;
  /** Tick on which a pending sanction lands (WARNING) or an active freeze lifts (FROZEN). */
  statusUntilTick: number | null;
  pendingSanction: SanctionKind | null;
  /** Due diligence on this vendor's catalogue: when done, every sub-supplier inside its products is known. */
  diligence?: { startTick: number; readyTick: number; done: boolean } | null;
  /** This vendor's components inside other vendors' products are public (its state signalled or imposed a sanction). */
  chainExposed?: boolean;
  /**
   * Cold vendor (phase 5): hidden from scouting until its gate opens (policy shift, introduction, export drive). See coldVendors.ts.
   */
  closed?: boolean;
  /** Foreshadowed opening: the day a pending policy vote / export drive lands (and the day it was announced). */
  opening?: { announcedTick: number; tick: number; incidentsAtAnnounce: number } | null;
  /** Joint-venture partners: public co-owners whose state's sanctions reach this vendor's products. */
  jvPartners?: VendorId[];
}

export interface Ministry {
  id: string;
  name: string;
  /** Political capital price per lobbying round. */
  cost: number;
  standingGain: number;
  /** Also drains a portion of vendor volatility for this many ticks. */
  description: string;
}

export type SanctionKind = 'EXPORT_FREEZE' | 'LICENSE_REVOKED' | 'PARTS_EMBARGO';

export interface SanctionEvent {
  id: string;
  vendorId: VendorId;
  kind: SanctionKind;
  startTick: number;
  endTick: number | null;
}

export function standingTier(standing: number): 0 | 1 | 2 | 3 {
  return Math.max(0, Math.min(3, Math.floor(standing / 25))) as 0 | 1 | 2 | 3;
}

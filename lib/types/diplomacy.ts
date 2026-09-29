/** Vendors, standing, export sanctions, lobbying. */

export type VendorId =
  | 'DOMESTIC_YARDS'
  | 'NAVAL_GROUP_THALES'
  | 'RAYTHEON'
  | 'ASELSAN'
  | 'ZVEZDA_NORD';

export type LicenseStatus = 'ACTIVE' | 'WARNING' | 'FROZEN' | 'REVOKED';

export interface Vendor {
  id: VendorId;
  name: string;
  country: string;
  /** 0-100 diplomatic / commercial standing. Tier = floor(standing / 25) capped at 3. */
  standing: number;
  /** Baseline geopolitical volatility of this supplier (0-1). */
  volatility: number;
  status: LicenseStatus;
  /** Tick on which a pending sanction lands (WARNING) or an active freeze lifts (FROZEN). */
  statusUntilTick: number | null;
  pendingSanction: SanctionKind | null;
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

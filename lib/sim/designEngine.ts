/** Equipment designer: power grid, payload, draft, protocol integration friction and combat figures. */
import { HULLS, MODULE_BY_ID } from '../data/catalog';
import type { Vendor } from '../types/diplomacy';
import { RUNG_LABEL, sellableTier } from './relationsEngine';
import type { BridgeKey, EquipmentModule, ModuleSlot, Protocol } from '../types/equipment';
import { bridgeKey, SLOT_ORDER } from '../types/equipment';
import type { Draft, DesignEvaluation, HullClassId, IntegrationFriction } from '../types/hull';

/** Severity of a protocol mismatch before any R&D bridge exists (0 = compatible). */
const SEVERITY: Record<BridgeKey, number> = {
  [bridgeKey('DOMESTIC_OPEN', 'NATO_LINK16')]: 0.12,
  [bridgeKey('DOMESTIC_OPEN', 'TACTICOS_ETHERNET')]: 0.12,
  [bridgeKey('DOMESTIC_OPEN', 'EASTERN_ANALOG')]: 0.4,
  [bridgeKey('NATO_LINK16', 'TACTICOS_ETHERNET')]: 0.35,
  [bridgeKey('EASTERN_ANALOG', 'NATO_LINK16')]: 0.7,
  [bridgeKey('EASTERN_ANALOG', 'TACTICOS_ETHERNET')]: 0.65,
};

export function frictionSeverity(a: Protocol, b: Protocol): number {
  return a === b ? 0 : SEVERITY[bridgeKey(a, b)] ?? 0.5;
}

export function draftClass(draftM: number): Draft {
  return draftM < 4.2 ? 'Shallow' : draftM < 6.8 ? 'Medium' : 'Deep';
}

/** Inbound raids (sea-skimmers) are only visible out to the radar horizon. */
export const SKIMMER_HORIZON_KM = 40;

export function evaluateLoadout(
  hullId: HullClassId,
  moduleIds: readonly string[],
  bridges: ReadonlySet<BridgeKey>,
): DesignEvaluation {
  const hull = HULLS[hullId];
  const mods = moduleIds.map((id) => MODULE_BY_ID[id]).filter((m): m is EquipmentModule => !!m);
  const errors: string[] = [];
  const warnings: string[] = [];

  // Sockets
  for (const slot of SLOT_ORDER) {
    const used = mods.filter((m) => m.slot === slot).length;
    if (used > hull.sockets[slot]) errors.push(`${slot}: ${used}/${hull.sockets[slot]} sockets`);
  }
  const plants = mods.filter((m) => m.slot === 'POWERPLANT');
  const cmsList = mods.filter((m) => m.slot === 'CMS');
  const sensors = mods.filter((m) => m.slot === 'SENSOR');
  const arms = mods.filter((m) => m.slot === 'ARMAMENT');
  if (plants.length === 0) errors.push('NO POWER PLANT FITTED');
  if (cmsList.length === 0) errors.push('NO COMBAT MANAGEMENT SYSTEM');
  const cms = cmsList[0];

  // Power grid
  const powerGenerationMW = hull.baseGenerationMW + plants.reduce((s, m) => s + m.powerGenerationMW, 0);
  const powerDrawMW = hull.hotelLoadMW + mods.reduce((s, m) => s + m.powerDrawMW, 0);
  const powerMarginMW = powerGenerationMW - powerDrawMW;
  if (powerMarginMW < 0) errors.push(`POWER GRID OVERLOAD: ${powerDrawMW.toFixed(1)} MW DRAW > ${powerGenerationMW.toFixed(1)} MW`);
  else if (powerMarginMW < powerGenerationMW * 0.1) warnings.push('POWER MARGIN < 10% — brownout risk under combat load');

  // Payload / displacement / draft
  const payloadUsedT = mods.reduce((s, m) => s + m.weightT, 0);
  if (payloadUsedT > hull.payloadT) errors.push(`PAYLOAD EXCEEDED: ${payloadUsedT} t > ${hull.payloadT} t`);
  const displacementT = hull.displacementT + payloadUsedT;
  const draftM = hull.draftM * Math.cbrt(displacementT / hull.displacementT);
  const draft = draftClass(draftM);
  if (draft === 'Deep') warnings.push('DEEP DRAFT — grounding hazard in littoral sectors');

  // Protocol friction
  const frictions: IntegrationFriction[] = [];
  if (cms) {
    for (const m of [...sensors, ...arms]) {
      // An open-architecture CMS scales down friction with every foreign module.
      const openness = cms.stats.kind === 'CMS' ? cms.stats.integration ?? 1 : 1;
      const severity = frictionSeverity(m.protocol, cms.protocol) * openness;
      if (severity <= 0) continue;
      const key = bridgeKey(m.protocol, cms.protocol);
      frictions.push({
        moduleId: m.id,
        moduleName: m.name,
        moduleProtocol: m.protocol,
        cmsProtocol: cms.protocol,
        severity,
        bridged: bridges.has(key),
        bridgeKey: key,
      });
    }
  }
  const open = frictions.filter((f) => !f.bridged);
  const frictionIndex = open.reduce((s, f) => s + f.severity, 0);
  const reactionMultiplier = 1 + 0.9 * frictionIndex;
  const sensorFriction = open.filter((f) => MODULE_BY_ID[f.moduleId].slot === 'SENSOR').reduce((s, f) => s + f.severity, 0);
  const trackingLagSec = 4 * sensorFriction;
  if (frictionIndex > 0.6) warnings.push(`INTEGRATION FRICTION ${frictionIndex.toFixed(2)} — reaction x${reactionMultiplier.toFixed(2)}`);

  if (sensors.length === 0) warnings.push('NO SENSOR — ship is blind');
  if (arms.length === 0) warnings.push('NO ARMAMENT');

  // Combat figures
  const reactionSec = cms && cms.stats.kind === 'CMS' ? cms.stats.reactionSec * reactionMultiplier : 99;
  const channels = cms && cms.stats.kind === 'CMS' ? cms.stats.channels : 0;
  let detectionKm = 0;
  let tracks = 0;
  for (const s of sensors) {
    if (s.stats.kind !== 'SENSOR') continue;
    detectionKm = Math.max(detectionKm, s.stats.rangeKm);
    tracks += s.stats.tracks;
  }
  const trackCapacity = Math.min(tracks, channels * 12);
  let firepower = 0;
  let interceptors = 0;
  for (const a of arms) {
    if (a.stats.kind !== 'ARMAMENT') continue;
    if (a.stats.role === 'SAM') interceptors += a.stats.rounds;
    else {
      firepower += a.stats.damage * a.stats.rounds;
      if (a.stats.role === 'GUN') interceptors += a.stats.rounds * 2; // CIWS / gun point defence
    }
  }
  const combatRating = Math.round(
    (firepower * 0.15 + interceptors * 3 + hull.structuralHP * 0.1 + hull.strikeRating * 2) *
      Math.pow(Math.max(20, detectionKm) / 100, 0.3) *
      Math.sqrt(5 / Math.max(2, reactionSec)),
  );

  const cost = hull.cost + mods.reduce((s, m) => s + m.cost, 0);
  const vendors = [...new Set(mods.map((m) => m.vendorId))];

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    powerGenerationMW,
    powerDrawMW,
    powerMarginMW,
    displacementT,
    payloadUsedT,
    payloadT: hull.payloadT,
    draftM,
    draft,
    structuralHP: hull.structuralHP,
    cost,
    frictions,
    frictionIndex,
    reactionMultiplier,
    trackingLagSec,
    reactionSec,
    detectionKm,
    trackCapacity,
    channels,
    firepower,
    interceptors,
    combatRating,
    upkeepPerDay: hull.upkeepPerDay * (1 + 0.02 * mods.length),
    vendors,
  };
}

export interface Procurability {
  ok: boolean;
  reason?: string;
}

/** Can this module currently be procured given R&D unlocks and the vendor's standing / licence status? */
export function procurability(m: EquipmentModule, vendors: Record<string, Vendor>, done: ReadonlySet<string>): Procurability {
  if (m.unlockedBy && !done.has(m.unlockedBy)) return { ok: false, reason: 'REQUIRES R&D' };
  const v = vendors[m.vendorId];
  if (!v) return { ok: true };
  if (v.status === 'FROZEN') return { ok: false, reason: 'EXPORT FREEZE' };
  if (v.status === 'REVOKED') return { ok: false, reason: 'LICENCE REVOKED' };
  const tier = sellableTier(v);
  if (tier < 0) return { ok: false, reason: v.rung === 'UNKNOWN' ? 'SUPPLIER UNKNOWN' : `NO CONTRACT (${RUNG_LABEL[v.rung]})` };
  if (tier < m.requiredTier) return { ok: false, reason: v.rung === 'FRAMEWORK' ? `FRAMEWORK: TIER 0 ONLY (NEEDS SIGNED + T${m.requiredTier})` : `NEEDS STANDING T${m.requiredTier}` };
  // Sub-suppliers: their state's sanction reaches this product. By the time one lands, the warning has made the link public.
  for (const o of m.origins ?? []) {
    const ov = vendors[o];
    if (ov?.status === 'FROZEN') return { ok: false, reason: `COMPONENT FREEZE ({vs:${o}})` };
    if (ov?.status === 'REVOKED') return { ok: false, reason: `COMPONENT LICENCE REVOKED ({vs:${o}})` };
  }
  return { ok: true };
}

export const SLOT_LABEL: Record<ModuleSlot, string> = {
  POWERPLANT: 'POWER PLANT',
  CMS: 'COMBAT MGMT SYSTEM',
  SENSOR: 'SENSOR / RADAR',
  ARMAMENT: 'ARMAMENT',
};

/** Static game data: vendors, hulls, equipment modules, ministries, R&D projects, starter designs. */
import type { Bloc, Ministry, RegimeId, Rung, Vendor, VendorId } from '../types/diplomacy';
import type { EquipmentModule, ModulePlatform, Protocol } from '../types/equipment';
import type { HullBase, HullClassId, ShipDesign } from '../types/hull';

// ------------------------------------------------------------------------------- vendors

function v(id: VendorId, name: string, country: string, standing: number, regime: RegimeId, bloc: Bloc, rung: Rung): Vendor {
  return { id, name, country, standing, regime, bloc, rung, rungProgress: null, status: 'ACTIVE', statusUntilTick: null, pendingSanction: null, diligence: null, chainExposed: false };
}

export const INITIAL_VENDORS: Vendor[] = [
  v('DOMESTIC_YARDS', 'Arsenal Yards', 'HOME', 100, 'HOME', 'HOME', 'STRATEGIC'),
  v('NAVAL_GROUP_THALES', 'Meridian Navale', 'REPUBLIC OF AURELLE', 45, 'AURELLE', 'EURO', 'SIGNED'),
  v('RAYTHEON', 'Halberd Dynamics', 'FEDERATED STATES OF HALCYON', 35, 'HALCYON', 'WEST', 'FRAMEWORK'),
  v('ASELSAN', 'Sarnic Defence', 'REPUBLIC OF SARNIA', 50, 'SARNIA', 'WEST', 'SIGNED'),
  v('ZVEZDA_NORD', 'Zvezda-Nord Export', 'EASTERN BLOC', 55, 'EASTERN', 'EAST', 'SIGNED'),
  v('NORDVIK', 'Nordvik Systems', 'KINGDOM OF VINTERLAND', 30, 'VINTERLAND', 'NORDIC', 'CONTACT'),
  v('SEORAK', 'Seorak Consortium', 'REPUBLIC OF SEORYEONG', 30, 'SEORYEONG', 'ASIA_PAC', 'CONTACT'),
  v('KESSLER_BRANDT', 'Kessler-Brandt Antriebe', 'FEDERAL REPUBLIC OF RHEINMARK', 25, 'RHEINMARK', 'EURO', 'UNKNOWN'),
  // Cold vendors (phase 5): hidden until their gate opens (coldVendors.ts).
  { ...v('MITSURUGI', 'Mitsurugi Heavy Industries', 'AKITSU FEDERATION', 35, 'AKITSU', 'ASIA_PAC', 'UNKNOWN'), closed: true, opening: null },
  { ...v('DAHAI', 'Dahai Marine Group', 'DAHAI REPUBLIC', 30, 'DAHAI', 'EAST', 'UNKNOWN'), closed: true, opening: null },
  { ...v('VAYU_SARATH', 'Vayu-Sarath Aerospace', 'BHARATVAR / EASTERN BLOC', 30, 'BHARATVAR', 'NON_ALIGNED', 'UNKNOWN'), closed: true, opening: null, jvPartners: ['ZVEZDA_NORD'] },
];

export const VENDOR_SHORT: Record<VendorId, string> = {
  DOMESTIC_YARDS: 'ARS',
  NAVAL_GROUP_THALES: 'MERID',
  RAYTHEON: 'HALB',
  ASELSAN: 'SARN',
  ZVEZDA_NORD: 'ZVEZDA',
  NORDVIK: 'NORDV',
  SEORAK: 'SEORAK',
  KESSLER_BRANDT: 'K-B',
  MITSURUGI: 'MITSU',
  DAHAI: 'DAHAI',
  VAYU_SARATH: 'VAYU',
};

export const MINISTRIES: Ministry[] = [
  { id: 'MIN_DEFENCE', name: 'Ministry of Defence — Procurement Directorate', cost: 4, standingGain: 6, description: 'Routine attaché lobbying. Cheap, modest gain.' },
  { id: 'MIN_FOREIGN', name: 'Foreign Ministry — Trade & Export Desk', cost: 9, standingGain: 14, description: 'Formal démarche to the vendor state. Strong gain.' },
  { id: 'MIN_TREASURY', name: 'Treasury — Offset & Industrial Participation', cost: 14, standingGain: 22, description: 'Offer offset contracts. Expensive, decisive.' },
];

// --------------------------------------------------------------------------------- hulls

export const HULLS: Record<HullClassId, HullBase> = {
  FAC: {
    id: 'FAC', name: 'Fast Attack Craft', pennantPrefix: 'P', displacementT: 480, draftM: 2.6, structuralHP: 120,
    baseGenerationMW: 1, hotelLoadMW: 0.4, payloadT: 200, sockets: { POWERPLANT: 1, CMS: 1, SENSOR: 1, ARMAMENT: 2 },
    cost: 35, buildDays: 40, upkeepPerDay: 0.12, strikeRating: 0,
  },
  CORVETTE: {
    id: 'CORVETTE', name: 'Corvette', pennantPrefix: 'K', displacementT: 1400, draftM: 3.7, structuralHP: 260,
    baseGenerationMW: 2, hotelLoadMW: 1, payloadT: 480, sockets: { POWERPLANT: 1, CMS: 1, SENSOR: 1, ARMAMENT: 3 },
    cost: 90, buildDays: 70, upkeepPerDay: 0.25, strikeRating: 0,
  },
  FRIGATE: {
    id: 'FRIGATE', name: 'Frigate', pennantPrefix: 'F', displacementT: 4200, draftM: 5.6, structuralHP: 520,
    baseGenerationMW: 4, hotelLoadMW: 2, payloadT: 1200, sockets: { POWERPLANT: 1, CMS: 1, SENSOR: 2, ARMAMENT: 4 },
    cost: 240, buildDays: 120, upkeepPerDay: 0.55, strikeRating: 0,
  },
  DESTROYER: {
    id: 'DESTROYER', name: 'Destroyer', pennantPrefix: 'D', displacementT: 7800, draftM: 7.4, structuralHP: 900,
    baseGenerationMW: 6, hotelLoadMW: 3.5, payloadT: 2400, sockets: { POWERPLANT: 1, CMS: 1, SENSOR: 2, ARMAMENT: 6 },
    cost: 520, buildDays: 190, upkeepPerDay: 1.1, strikeRating: 0,
  },
  CARRIER: {
    id: 'CARRIER', name: 'Light Carrier', pennantPrefix: 'R', displacementT: 24000, draftM: 9.6, structuralHP: 2400,
    baseGenerationMW: 10, hotelLoadMW: 9, payloadT: 6500, sockets: { POWERPLANT: 2, CMS: 1, SENSOR: 2, ARMAMENT: 4 },
    cost: 1500, buildDays: 320, upkeepPerDay: 3.2, strikeRating: 90,
  },
  // Conventional submarines (see docs/PLAN-submarines.md). Vendor hulls: the price goes to the builder and its sanctions stall construction.
  SUB_SEORAK: {
    id: 'SUB_SEORAK', name: 'Patrol Submarine (large)', pennantPrefix: 'S', displacementT: 3000, draftM: 5.5, structuralHP: 380,
    baseGenerationMW: 1.5, hotelLoadMW: 1.2, payloadT: 700, sockets: { POWERPLANT: 2, CMS: 1, SENSOR: 2, ARMAMENT: 4 },
    cost: 300, buildDays: 130, upkeepPerDay: 0.8, strikeRating: 0,
    platform: 'SUBSURFACE', vendorId: 'SEORAK', requiredTier: 1, stealth: 50, enduranceDays: 5,
  },
  SUB_KB: {
    id: 'SUB_KB', name: 'Coastal Submarine (quiet)', pennantPrefix: 'S', displacementT: 1800, draftM: 5.2, structuralHP: 280,
    baseGenerationMW: 1.2, hotelLoadMW: 0.9, payloadT: 480, sockets: { POWERPLANT: 2, CMS: 1, SENSOR: 2, ARMAMENT: 3 },
    cost: 330, buildDays: 200, upkeepPerDay: 0.7, strikeRating: 0,
    platform: 'SUBSURFACE', vendorId: 'KESSLER_BRANDT', requiredTier: 2, stealth: 70, enduranceDays: 3,
  },
};

export const hullPlatform = (h: HullBase) => h.platform ?? 'SURFACE';
export const hullVendor = (id: HullClassId): VendorId => HULLS[id].vendorId ?? 'DOMESTIC_YARDS';

export const HULL_LIST: HullBase[] = Object.values(HULLS);

// ------------------------------------------------------------------------------ modules

type ModuleSeed = Omit<EquipmentModule, 'powerGenerationMW'> & { powerGenerationMW?: number };
/** Combat systems fit anywhere; every other module is surface-only unless it says otherwise. */
const defaultPlatform = (m: ModuleSeed): ModulePlatform => (m.slot === 'CMS' ? 'ANY' : 'SURFACE');
const mod = (m: ModuleSeed): EquipmentModule => ({ powerGenerationMW: 0, ...m, platform: m.platform ?? defaultPlatform(m) });
export const modulePlatform = (m: EquipmentModule): ModulePlatform => m.platform ?? defaultPlatform(m);

const powerplant = (
  id: string, name: string, vendorId: VendorId, gen: number, weightT: number, cost: number,
  requiredTier: 0 | 1 | 2 | 3, reliability: number, blurb: string, unlockedBy?: string,
): EquipmentModule =>
  mod({
    id, name, slot: 'POWERPLANT', vendorId, protocol: 'DOMESTIC_OPEN', powerDrawMW: 0, powerGenerationMW: gen,
    weightT, cost, requiredTier, reliability, unlockedBy, stats: { kind: 'POWER' }, blurb,
  });

const cms = (
  id: string, name: string, vendorId: VendorId, protocol: Protocol, draw: number, weightT: number, cost: number,
  requiredTier: 0 | 1 | 2 | 3, reliability: number, reactionSec: number, channels: number, blurb: string, unlockedBy?: string,
  integration = 1,
): EquipmentModule =>
  mod({
    id, name, slot: 'CMS', vendorId, protocol, powerDrawMW: draw, weightT, cost, requiredTier, reliability,
    unlockedBy, stats: { kind: 'CMS', reactionSec, channels, integration }, blurb,
  });

const sensor = (
  id: string, name: string, vendorId: VendorId, protocol: Protocol, draw: number, weightT: number, cost: number,
  requiredTier: 0 | 1 | 2 | 3, reliability: number, rangeKm: number, tracks: number, blurb: string, unlockedBy?: string,
): EquipmentModule =>
  mod({
    id, name, slot: 'SENSOR', vendorId, protocol, powerDrawMW: draw, weightT, cost, requiredTier, reliability,
    unlockedBy, stats: { kind: 'SENSOR', rangeKm, tracks }, blurb,
  });

const arm = (
  id: string, name: string, vendorId: VendorId, protocol: Protocol, draw: number, weightT: number, cost: number,
  requiredTier: 0 | 1 | 2 | 3, reliability: number, role: 'SAM' | 'SSM' | 'GUN' | 'ASW', rounds: number,
  damage: number, rangeKm: number, blurb: string, unlockedBy?: string,
): EquipmentModule =>
  mod({
    id, name, slot: 'ARMAMENT', vendorId, protocol, powerDrawMW: draw, weightT, cost, requiredTier, reliability,
    unlockedBy, stats: { kind: 'ARMAMENT', role, rounds, damage, rangeKm }, blurb,
  });

const subPlant = (
  id: string, name: string, vendorId: VendorId, gen: number, weightT: number, cost: number,
  requiredTier: 0 | 1 | 2 | 3, reliability: number, stealth: number, enduranceDays: number, blurb: string,
): EquipmentModule => ({
  ...powerplant(id, name, vendorId, gen, weightT, cost, requiredTier, reliability, blurb),
  platform: 'SUBSURFACE',
  stats: { kind: 'POWER', stealth, enduranceDays },
});

const sonar = (
  id: string, name: string, vendorId: VendorId, protocol: Protocol, draw: number, weightT: number, cost: number,
  requiredTier: 0 | 1 | 2 | 3, reliability: number, rangeKm: number, tracks: number, platform: ModulePlatform, blurb: string,
): EquipmentModule => ({
  ...sensor(id, name, vendorId, protocol, draw, weightT, cost, requiredTier, reliability, rangeKm, tracks, blurb),
  platform,
  stats: { kind: 'SENSOR', rangeKm, tracks, domain: 'SONAR' },
});

const subArm = (
  id: string, name: string, vendorId: VendorId, protocol: Protocol, draw: number, weightT: number, cost: number,
  requiredTier: 0 | 1 | 2 | 3, reliability: number, role: 'SSM' | 'ASW', rounds: number, damage: number, rangeKm: number, blurb: string,
): EquipmentModule => ({ ...arm(id, name, vendorId, protocol, draw, weightT, cost, requiredTier, reliability, role, rounds, damage, rangeKm, blurb), platform: 'SUBSURFACE' });

export const MODULES: EquipmentModule[] = [
  // Power plants
  powerplant('PP_DOM_D6', 'D-6 Diesel Genset', 'DOMESTIC_YARDS', 6, 90, 6, 0, 0.93, 'Licence-built marine diesel. Cheap, dependable.'),
  powerplant('PP_DOM_D12', 'CODAD-12 Diesel Pack', 'DOMESTIC_YARDS', 12, 170, 12, 1, 0.9, 'Twin-shaft diesel pack for corvettes and frigates.'),
  powerplant('PP_NG_GT25', 'GT-25 Gas Turbine Set', 'NAVAL_GROUP_THALES', 25, 230, 26, 2, 0.88, 'High-output aero-derivative turbine.'),
  powerplant('PP_RTX_IEP40', 'IEP-40 Integrated Electric Plant', 'RAYTHEON', 40, 340, 55, 3, 0.9, 'Full electric propulsion; feeds high-draw AESA arrays.'),
  powerplant('PP_ZV_BT18', 'ZN-18 Boiler-Turbine', 'ZVEZDA_NORD', 18, 300, 14, 1, 0.75, 'Rugged but temperamental steam plant.'),
  powerplant('PP_DOM_GT20', 'Domestic GT-20 Turbine', 'DOMESTIC_YARDS', 20, 210, 22, 0, 0.86, 'Indigenous turbine — fruit of domestic substitution.', 'PRJ_DOM_GT'),

  // Combat management systems
  cms('CMS_DOM_OB1', 'Open Bus CMS-D1', 'DOMESTIC_YARDS', 'DOMESTIC_OPEN', 1.5, 8, 6, 0, 0.9, 9, 4, 'Indigenous open-architecture bus. Slow but easy to bridge.'),
  cms('CMS_DOM_OB2', 'Open Bus CMS-D2', 'DOMESTIC_YARDS', 'DOMESTIC_OPEN', 2.2, 10, 14, 0, 0.9, 6.5, 8, 'Second-generation domestic CMS.', 'PRJ_DOM_CMS'),
  cms('CMS_NG_TACTICOS', 'Meridian TACTIS', 'NAVAL_GROUP_THALES', 'TACTICOS_ETHERNET', 2.5, 12, 22, 1, 0.92, 5, 12, 'Ethernet-based CMS. Market benchmark for mid-size warships.'),
  cms('CMS_RTX_AEGISLINK', 'Bulwark Link C&D', 'RAYTHEON', 'NATO_LINK16', 4, 20, 48, 3, 0.9, 3.5, 24, 'Cooperative engagement grade combat system.'),
  cms('CMS_ZV_SIGMA', 'Sigma-M CMS', 'ZVEZDA_NORD', 'EASTERN_ANALOG', 2, 15, 9, 0, 0.78, 7, 6, 'Analog tote-board CMS. Inexpensive, very slow to integrate.'),

  // Sensors
  sensor('SEN_DOM_DSR2', 'DSR-2D Surface Search', 'DOMESTIC_YARDS', 'DOMESTIC_OPEN', 0.8, 6, 3, 0, 0.94, 45, 20, 'X-band navigation and surface search.'),
  sensor('SEN_DOM_DAR3', 'DAR-3D AESA', 'DOMESTIC_YARDS', 'DOMESTIC_OPEN', 4, 20, 26, 0, 0.88, 140, 90, 'Indigenous S-band AESA.', 'PRJ_DOM_RADAR'),
  sensor('SEN_NG_SMARTS', 'SENTA-S 3D S-band', 'NAVAL_GROUP_THALES', 'TACTICOS_ETHERNET', 3, 14, 20, 1, 0.9, 150, 60, 'Proven medium-range 3D radar.'),
  sensor('SEN_NG_APAR', 'APEX-class AESA', 'NAVAL_GROUP_THALES', 'TACTICOS_ETHERNET', 8, 34, 48, 3, 0.86, 200, 200, 'Multi-function active phased array.'),
  sensor('SEN_ASEL_SPEAR', 'Sarnic SPEAR 3D AESA', 'ASELSAN', 'NATO_LINK16', 6, 26, 30, 2, 0.87, 180, 140, 'AESA from {v:ASELSAN} with an {x:NATO_LINK16} data link.'),
  sensor('SEN_RTX_SPY6', 'HALO-6-class AESA', 'RAYTHEON', 'NATO_LINK16', 14, 60, 90, 3, 0.9, 400, 500, 'Ballistic-missile-defence grade radar.'),
  sensor('SEN_ZV_SIGMAAIR', 'Sigma Air Search', 'ZVEZDA_NORD', 'EASTERN_ANALOG', 3, 18, 10, 0, 0.8, 120, 40, 'Analog air-search radar.'),

  // Armament
  arm('ARM_DOM_GUN76', '76mm Naval Gun', 'DOMESTIC_YARDS', 'DOMESTIC_OPEN', 0.6, 22, 5, 0, 0.95, 'GUN', 1, 16, 16, 'Rapid-fire dual-purpose gun.'),
  arm('ARM_DOM_TORP', '324mm Torpedo Tubes', 'DOMESTIC_YARDS', 'DOMESTIC_OPEN', 0.2, 10, 4, 0, 0.95, 'ASW', 2, 30, 12, 'Lightweight ASW torpedoes.'),
  arm('ARM_DOM_DSAM8', 'DSAM 8-Cell VLS', 'DOMESTIC_YARDS', 'DOMESTIC_OPEN', 0.4, 28, 9, 0, 0.9, 'SAM', 8, 22, 30, 'Short-range domestic SAM.'),
  arm('ARM_DOM_DSAM32', 'DSAM-ER 32-Cell VLS', 'DOMESTIC_YARDS', 'DOMESTIC_OPEN', 1, 90, 30, 0, 0.88, 'SAM', 32, 26, 60, 'Extended-range domestic area defence.', 'PRJ_DOM_VLS'),
  arm('ARM_DOM_SEASTRIKE', 'Sea-Strike SSM Quad', 'DOMESTIC_YARDS', 'DOMESTIC_OPEN', 0.3, 22, 12, 0, 0.9, 'SSM', 4, 70, 160, 'Indigenous anti-ship missile.', 'PRJ_DOM_SSM'),
  arm('ARM_NG_SYLVER8', 'Sylvane V43 8-Cell', 'NAVAL_GROUP_THALES', 'TACTICOS_ETHERNET', 0.5, 32, 16, 1, 0.92, 'SAM', 8, 30, 45, 'Vertical launcher, medium-range SAM.'),
  arm('ARM_NG_MM40', 'MX40 Block3 SSM Quad', 'NAVAL_GROUP_THALES', 'TACTICOS_ETHERNET', 0.3, 24, 18, 1, 0.9, 'SSM', 4, 85, 180, 'Sea-skimming anti-ship missile.'),
  arm('ARM_RTX_MK41', 'VL-41 VLS + SPX-16 (16)', 'RAYTHEON', 'NATO_LINK16', 1.2, 70, 42, 2, 0.93, 'SAM', 16, 34, 50, 'Universal launcher loaded with quad-packed medium-range SAMs.'),
  arm('ARM_RTX_HARPOON', 'Lancer-class SSM Quad', 'RAYTHEON', 'NATO_LINK16', 0.3, 26, 15, 2, 0.92, 'SSM', 4, 80, 140, 'Ubiquitous anti-ship missile.'),
  arm('ARM_ASEL_SEALANCE', 'Sea Lance SSM Quad', 'ASELSAN', 'NATO_LINK16', 0.3, 22, 11, 1, 0.9, 'SSM', 4, 75, 150, 'Anti-ship missile with {x:NATO_LINK16} compatibility.'),
  arm('ARM_ZV_KH8', 'P-Kh SSM x8', 'ZVEZDA_NORD', 'EASTERN_ANALOG', 0.5, 60, 14, 0, 0.82, 'SSM', 8, 90, 200, 'Heavy analog-guided salvo missile.'),
  arm('ARM_ZV_CIWS30', 'AK-30 CIWS', 'ZVEZDA_NORD', 'EASTERN_ANALOG', 0.4, 14, 3, 0, 0.88, 'GUN', 1, 12, 5, 'Twin 30mm close-in weapon.'),

  // Nordvik Systems (Vinterland): open-architecture integrator — its CMS halves integration friction with foreign kit.
  cms('CMS_NV_OPEN9', 'Nordvik NV-9 Open CMS', 'NORDVIK', 'NATO_LINK16', 2.2, 11, 26, 1, 0.93, 4.5, 12, 'Open-architecture CMS: integrates third-party sensors and weapons with half the usual friction.', undefined, 0.5),
  sensor('SEN_NV_SKY4', 'Nordvik SKY-4 AESA', 'NORDVIK', 'NATO_LINK16', 3.5, 16, 24, 1, 0.92, 180, 120, 'Compact rotating AESA for corvettes and frigates.'),
  arm('ARM_NV_RB15', 'Nordvik RB-15 SSM Quad', 'NORDVIK', 'NATO_LINK16', 0.3, 24, 16, 1, 0.93, 'SSM', 4, 85, 200, 'Long-range sea-skimming anti-ship missile.'),
  // Seorak Consortium (Seoryeong): fast, price-competitive power and domestic-bus systems.
  powerplant('PP_SK_ST30', 'Seorak ST-30 Turbine Pack', 'SEORAK', 30, 250, 24, 1, 0.9, 'Compact 30 MW turbine pack; quick delivery.'),
  cms('CMS_SK_SHIELD', 'Seorak Naval Shield CMS', 'SEORAK', 'DOMESTIC_OPEN', 2.4, 13, 18, 1, 0.91, 5.5, 10, 'Open-bus CMS: plugs into domestic sensors and weapons without friction.'),
  arm('ARM_SK_KVLS16', 'Seorak SV-16 Launcher', 'SEORAK', 'DOMESTIC_OPEN', 0.8, 70, 28, 1, 0.9, 'SAM', 16, 28, 50, 'Sixteen-cell vertical launcher with medium-range SAMs.'),
  // Kessler-Brandt Antriebe (Rheinmark): engines and radars; slow licences.
  powerplant('PP_KB_20V', 'Kessler-Brandt KB-20V Diesel', 'KESSLER_BRANDT', 16, 150, 16, 1, 0.97, 'Very reliable high-power diesel; the engine inside many foreign hulls.'),
  sensor('SEN_KB_TRS4', 'Kessler-Brandt TRS-4 AESA', 'KESSLER_BRANDT', 'TACTICOS_ETHERNET', 4.5, 22, 34, 2, 0.9, 170, 150, 'Four-face fixed AESA.'),
  // Mitsurugi Heavy Industries (Akitsu): closed until a policy shift; premium and very reliable.
  powerplant('PP_MH_CX34', 'Mitsurugi CX-34 Combined Plant', 'MITSURUGI', 34, 260, 34, 1, 0.97, 'Combined diesel/turbine plant built for long, quiet patrols.'),
  sensor('SEN_MH_OPX2', 'Mitsurugi OPX-2 AESA', 'MITSURUGI', 'NATO_LINK16', 5, 24, 38, 1, 0.95, 210, 160, 'Integrated mast AESA with very low failure rates.'),
  arm('ARM_MH_VLS16', 'Mitsurugi 16-Cell VLS', 'MITSURUGI', 'NATO_LINK16', 1, 70, 40, 2, 0.95, 'SAM', 16, 34, 55, 'Sixteen-cell launcher with medium-range SAMs.'),
  // Dahai Marine Group (Dahai Republic): volume builder, cheap, few references; introduced through the Eastern bloc.
  powerplant('PP_DH_D24', 'Dahai 24-Cyl Diesel Pack', 'DAHAI', 24, 220, 12, 0, 0.82, 'High-output diesel pack at a very low price.'),
  cms('CMS_DH_H11', 'Dahai H-11 CMS', 'DAHAI', 'EASTERN_ANALOG', 2, 12, 12, 0, 0.84, 5, 12, 'Digital-core CMS on an analog-compatible bus.'),
  sensor('SEN_DH_346', 'Dahai DH-460 AESA', 'DAHAI', 'EASTERN_ANALOG', 7, 30, 22, 1, 0.82, 190, 150, 'Large four-face AESA; cheap, but few navies have tested it.'),
  arm('ARM_DH_VLS32', 'Dahai 32-Cell VLS', 'DAHAI', 'EASTERN_ANALOG', 1, 95, 26, 1, 0.83, 'SAM', 32, 26, 50, 'Thirty-two medium-range SAMs for the price of sixteen.'),
  // Vayu-Sarath Aerospace (JV): supersonic anti-ship missiles; either parent state can stop deliveries.
  arm('ARM_VS_SEAWIND', 'Vayu-Sarath Seawind SSM Quad', 'VAYU_SARATH', 'DOMESTIC_OPEN', 0.4, 30, 30, 1, 0.9, 'SSM', 4, 110, 290, 'Supersonic sea-skimmer; plugs into open-bus combat systems.'),
  arm('ARM_VS_SEAWIND8', 'Vayu-Sarath Seawind VL x8', 'VAYU_SARATH', 'DOMESTIC_OPEN', 0.8, 64, 56, 2, 0.9, 'SSM', 8, 110, 290, 'Eight-cell vertical Seawind launcher.'),
  // ---- Underwater warfare (submarine plants, sonar, torpedoes). Hull sonar and towed arrays also fit surface ships for ASW.
  subPlant('PP_SUB_DOM_DE', 'D-4S Submarine Diesel Set', 'DOMESTIC_YARDS', 4, 80, 8, 0, 0.9, -8, 0, 'Cheap and loud: the boat must snorkel often.'),
  subPlant('PP_SUB_SK_DE', 'Seorak SD-5 Diesel Generator', 'SEORAK', 5, 85, 12, 1, 0.92, -2, 0, 'Large-battery diesel-electric plant for long transits.'),
  subPlant('PP_SUB_KB_DE', 'Kessler-Brandt KD-4 Quiet Diesel', 'KESSLER_BRANDT', 4, 80, 14, 2, 0.96, 6, 0, 'Raft-mounted diesel; the quietest set on the market.'),
  subPlant('PP_SUB_SK_AIP', 'Seorak Closed-Cycle AIP Module', 'SEORAK', 1.5, 70, 20, 1, 0.9, 6, 9, 'Air-independent plant: weeks without snorkelling.'),
  subPlant('PP_SUB_KB_AIP', 'Kessler-Brandt Fuel-Cell AIP', 'KESSLER_BRANDT', 2, 75, 28, 2, 0.94, 10, 12, 'Fuel-cell AIP: silent, long submerged endurance.'),
  subPlant('PP_SUB_SK_LI', 'Seorak Li-ion Battery Bank', 'SEORAK', 0.5, 60, 34, 3, 0.9, 8, 7, 'Lithium-ion batteries: long sprints and quiet running; premium price.'),

  sonar('SEN_SONAR_HULL', 'Hull-Mounted Sonar', 'DOMESTIC_YARDS', 'DOMESTIC_OPEN', 1, 12, 6, 0, 0.92, 18, 8, 'SURFACE', 'Bow sonar for surface ships.'),
  sonar('SEN_SONAR_TOWED', 'Towed Array Sonar', 'NAVAL_GROUP_THALES', 'TACTICOS_ETHERNET', 1.5, 30, 20, 1, 0.9, 45, 14, 'SURFACE', 'Long towed array: the surface ship\'s answer to quiet submarines.'),
  sonar('SEN_SONAR_SUB_DOM', 'DS-1 Flank and Bow Array', 'DOMESTIC_YARDS', 'DOMESTIC_OPEN', 0.8, 10, 8, 0, 0.9, 22, 8, 'SUBSURFACE', 'Basic passive array for a submarine.'),
  sonar('SEN_SONAR_SUB_SK', 'Seorak SA-3 Sonar Suite', 'SEORAK', 'DOMESTIC_OPEN', 1, 14, 14, 1, 0.92, 28, 10, 'SUBSURFACE', 'Bow, flank and towed arrays on an open bus.'),
  sonar('SEN_SONAR_SUB_KB', 'Kessler-Brandt CSU Sonar', 'KESSLER_BRANDT', 'TACTICOS_ETHERNET', 1.2, 16, 24, 2, 0.94, 38, 12, 'SUBSURFACE', 'Integrated sonar suite with long-range passive detection.'),

  subArm('ARM_SUB_DOM_HWT', '533mm Heavyweight Tubes', 'DOMESTIC_YARDS', 'DOMESTIC_OPEN', 0.4, 40, 14, 0, 0.92, 'ASW', 6, 55, 30, 'Wire-guided heavyweight torpedoes.'),
  subArm('ARM_SUB_KB_HWT', 'Kessler-Brandt DM-class Torpedo Tubes', 'KESSLER_BRANDT', 'TACTICOS_ETHERNET', 0.4, 42, 26, 2, 0.95, 'ASW', 6, 70, 38, 'Heavyweight torpedoes with a fibre-optic guidance link.'),
  subArm('ARM_SUB_SK_TASM', 'Seorak Tube-Launched SSM', 'SEORAK', 'DOMESTIC_OPEN', 0.4, 26, 22, 1, 0.9, 'SSM', 4, 70, 120, 'Capsule-launched anti-ship missiles fired from the torpedo tubes.'),
];

/**
 * Hidden sub-suppliers (contractors phase 2). Never mention these in blurbs: the player learns them through due diligence or when the
 * origin state signals a sanction.
 */
const ORIGINS: Record<string, VendorId[]> = {
  PP_NG_GT25: ['RAYTHEON'], // turbine core built under a Halcyon licence
  SEN_ASEL_SPEAR: ['RAYTHEON'], // transmit/receive modules
  PP_SK_ST30: ['KESSLER_BRANDT'], // reduction gear and engine controls
  ARM_NV_RB15: ['NAVAL_GROUP_THALES'], // missile turbojet
  ARM_MH_VLS16: ['RAYTHEON'], // launcher built under a Halcyon licence
  // Joint venture: the Eastern parent's components are in every Seawind (public, see Vendor.jvPartners).
  ARM_VS_SEAWIND: ['ZVEZDA_NORD'],
  ARM_VS_SEAWIND8: ['ZVEZDA_NORD'],
};
for (const m of MODULES) if (ORIGINS[m.id]) m.origins = ORIGINS[m.id];

export const MODULE_BY_ID: Record<string, EquipmentModule> = Object.fromEntries(MODULES.map((m) => [m.id, m]));

// ------------------------------------------------------------------------ R&D projects

export type ResearchKind = 'PROTOCOL_BRIDGE' | 'DOMESTIC_SUBSTITUTE';

export interface ResearchProject {
  id: string;
  name: string;
  kind: ResearchKind;
  costRP: number;
  requires: string[];
  blurb: string;
  /** PROTOCOL_BRIDGE: the protocol pair that becomes friction-free fleet-wide. */
  bridge?: [Protocol, Protocol];
}

export const RESEARCH_PROJECTS: ResearchProject[] = [
  { id: 'BR_L16_TAC', name: 'VL-41 ↔ TACTIS Protocol Bridge', kind: 'PROTOCOL_BRIDGE', costRP: 120, requires: [], bridge: ['NATO_LINK16', 'TACTICOS_ETHERNET'], blurb: '{v:RAYTHEON} guidance & launcher data onto the {v:NAVAL_GROUP_THALES} {x:TACTICOS_ETHERNET} bus.' },
  { id: 'BR_L16_DOM', name: 'Alliance Link ↔ Open Bus Gateway', kind: 'PROTOCOL_BRIDGE', costRP: 80, requires: [], bridge: ['NATO_LINK16', 'DOMESTIC_OPEN'], blurb: 'Lets domestic CMS command {x:NATO_LINK16}-standard sensors and weapons.' },
  { id: 'BR_TAC_DOM', name: 'TACTIS ↔ Open Bus Gateway', kind: 'PROTOCOL_BRIDGE', costRP: 80, requires: [], bridge: ['TACTICOS_ETHERNET', 'DOMESTIC_OPEN'], blurb: 'Gateway between the {x:TACTICOS_ETHERNET} CMS and the domestic bus.' },
  { id: 'BR_EAST_DOM', name: 'Analog ↔ Open Bus Adapter', kind: 'PROTOCOL_BRIDGE', costRP: 100, requires: [], bridge: ['EASTERN_ANALOG', 'DOMESTIC_OPEN'], blurb: 'A/D conversion rack that digitises eastern analog signalling.' },
  { id: 'BR_EAST_TAC', name: 'Analog ↔ TACTIS Digitiser', kind: 'PROTOCOL_BRIDGE', costRP: 140, requires: ['BR_EAST_DOM'], bridge: ['EASTERN_ANALOG', 'TACTICOS_ETHERNET'], blurb: 'Builds on the open-bus adapter to reach {x:TACTICOS_ETHERNET}.' },
  { id: 'BR_EAST_L16', name: 'Analog ↔ Alliance Link Digitiser', kind: 'PROTOCOL_BRIDGE', costRP: 160, requires: ['BR_EAST_DOM'], bridge: ['EASTERN_ANALOG', 'NATO_LINK16'], blurb: 'Cross-block bridge. Politically awkward, technically hard.' },
  { id: 'PRJ_DOM_CMS', name: 'Domestic CMS Mk2', kind: 'DOMESTIC_SUBSTITUTE', costRP: 110, requires: [], blurb: 'Unlocks Open Bus CMS-D2 (6.5s reaction, 8 channels).' },
  { id: 'PRJ_DOM_RADAR', name: 'Domestic 3D AESA Programme', kind: 'DOMESTIC_SUBSTITUTE', costRP: 170, requires: [], blurb: 'Unlocks DAR-3D AESA — sanction-proof air surveillance.' },
  { id: 'PRJ_DOM_VLS', name: 'Domestic 32-Cell VLS & DSAM-ER', kind: 'DOMESTIC_SUBSTITUTE', costRP: 190, requires: ['PRJ_DOM_CMS'], blurb: 'Unlocks DSAM-ER area-defence VLS.' },
  { id: 'PRJ_DOM_SSM', name: 'Domestic Sea-Strike SSM', kind: 'DOMESTIC_SUBSTITUTE', costRP: 130, requires: [], blurb: 'Unlocks the Sea-Strike anti-ship missile quad.' },
  { id: 'PRJ_DOM_GT', name: 'Domestic 20 MW Gas Turbine', kind: 'DOMESTIC_SUBSTITUTE', costRP: 150, requires: [], blurb: 'Unlocks the Domestic GT-20 turbine.' },
];

export const PROJECT_BY_ID: Record<string, ResearchProject> = Object.fromEntries(RESEARCH_PROJECTS.map((p) => [p.id, p]));

// ------------------------------------------------------------------------ starter designs

export const STARTER_DESIGNS: ShipDesign[] = [
  { id: 'DES_FAC_MK1', name: 'Sabre-class FAC', hullId: 'FAC', moduleIds: ['PP_DOM_D6', 'CMS_DOM_OB1', 'SEN_DOM_DSR2', 'ARM_ZV_KH8', 'ARM_DOM_GUN76'] },
  { id: 'DES_COR_MK1', name: 'Vigil-class Corvette', hullId: 'CORVETTE', moduleIds: ['PP_DOM_D12', 'CMS_DOM_OB1', 'SEN_DOM_DSR2', 'ARM_DOM_DSAM8', 'ARM_DOM_GUN76', 'ARM_DOM_TORP'] },
  { id: 'DES_FFG_MK1', name: 'Argus-class Frigate', hullId: 'FRIGATE', moduleIds: ['PP_DOM_D12', 'CMS_NG_TACTICOS', 'SEN_NG_SMARTS', 'SEN_DOM_DSR2', 'ARM_NG_SYLVER8', 'ARM_NG_MM40', 'ARM_DOM_GUN76', 'ARM_DOM_TORP'] },
];

export function getDesignById(id: string): ShipDesign | undefined {
  return STARTER_DESIGNS.find((d) => d.id === id);
}

/**
 * Display names. The catalogue (`catalog.ts`) carries the FICTIONAL name of every vendor, module and project; this file
 * holds the REAL-name overrides and the resolver for name tokens (see tokens.ts). The default skin is fictional; the real
 * names are an optional skin. Internal ids (e.g. RAYTHEON, CMS_NG_TACTICOS) never reach the player.
 */
import type { Protocol } from '../types/equipment';
import { INITIAL_VENDORS, MODULE_BY_ID, PROJECT_BY_ID, VENDOR_SHORT } from './catalog';

export type Skin = 'FICTIONAL' | 'REAL';
export const SKINS: Skin[] = ['FICTIONAL', 'REAL'];
export const DEFAULT_SKIN: Skin = 'FICTIONAL';
export const SKIN_STORAGE_KEY = 'al.skin';

interface RealVendor {
  name: string;
  country: string;
  short: string;
}

const REAL_VENDOR: Record<string, RealVendor> = {
  DOMESTIC_YARDS: { name: 'Domestic Yards', country: 'HOME', short: 'DOM' },
  NAVAL_GROUP_THALES: { name: 'Naval Group / Thales', country: 'FRANCE', short: 'N-G/THA' },
  RAYTHEON: { name: 'Raytheon', country: 'USA', short: 'RTX' },
  ASELSAN: { name: 'Aselsan', country: 'TURKEY', short: 'ASEL' },
  NORDVIK: { name: 'Saab', country: 'SWEDEN', short: 'SAAB' },
  SEORAK: { name: 'Hanwha / HD HHI', country: 'SOUTH KOREA', short: 'K-YARDS' },
  KESSLER_BRANDT: { name: 'TKMS / MTU', country: 'GERMANY', short: 'TKMS' },
};

const REAL_MODULE: Record<string, string> = {
  CMS_NG_TACTICOS: 'Thales TACTICOS',
  CMS_RTX_AEGISLINK: 'Aegis Link C&D',
  SEN_NG_SMARTS: 'SMART-S 3D S-band',
  SEN_NG_APAR: 'APAR-class AESA',
  SEN_ASEL_SPEAR: 'Aselsan SPEAR 3D AESA',
  SEN_RTX_SPY6: 'SPY-6-class AESA',
  ARM_NG_SYLVER8: 'Sylver A43 8-Cell',
  ARM_NG_MM40: 'MM40 Block3 SSM Quad',
  ARM_RTX_MK41: 'MK41 VLS + ESSM (16)',
  ARM_RTX_HARPOON: 'Harpoon-class SSM Quad',
  CMS_NV_OPEN9: 'Saab 9LV CMS',
  SEN_NV_SKY4: 'Sea Giraffe 4A AESA',
  ARM_NV_RB15: 'RBS15 Mk3 SSM Quad',
  CMS_SK_SHIELD: 'Hanwha Naval Shield CMS',
  ARM_SK_KVLS16: 'K-VLS 16-Cell',
  PP_KB_20V: 'MTU 20V 4000 Diesel',
  SEN_KB_TRS4: 'Hensoldt TRS-4D AESA',
};

const REAL_PROJECT: Record<string, string> = {
  BR_L16_TAC: 'MK41 ↔ TACTICOS Protocol Bridge',
  BR_L16_DOM: 'Link-16 ↔ Open Bus Gateway',
  BR_TAC_DOM: 'TACTICOS ↔ Open Bus Gateway',
  BR_EAST_TAC: 'Analog ↔ TACTICOS Digitiser',
  BR_EAST_L16: 'Analog ↔ Link-16 Digitiser',
};

const PROTOCOL_NAMES: Record<Protocol, { fictional: string; real: string; shortF: string; shortR: string }> = {
  TACTICOS_ETHERNET: { fictional: 'TACTIS ETHERNET', real: 'TACTICOS ETHERNET', shortF: 'TACTIS', shortR: 'TACTICOS' },
  NATO_LINK16: { fictional: 'ALLIANCE LINK', real: 'NATO LINK-16', shortF: 'ALL-LINK', shortR: 'LINK-16' },
  EASTERN_ANALOG: { fictional: 'EASTERN ANALOG', real: 'EASTERN ANALOG', shortF: 'E.ANALOG', shortR: 'E.ANALOG' },
  DOMESTIC_OPEN: { fictional: 'DOMESTIC OPEN', real: 'DOMESTIC OPEN', shortF: 'OPEN BUS', shortR: 'OPEN BUS' },
};

const FICTIONAL_VENDOR = Object.fromEntries(INITIAL_VENDORS.map((v) => [v.id, v]));

export function vendorName(id: string, skin: Skin): string {
  return skin === 'REAL' && REAL_VENDOR[id] ? REAL_VENDOR[id].name : FICTIONAL_VENDOR[id]?.name ?? id;
}
export function vendorCountry(id: string, skin: Skin): string {
  return skin === 'REAL' && REAL_VENDOR[id] ? REAL_VENDOR[id].country : FICTIONAL_VENDOR[id]?.country ?? '';
}
export function vendorShort(id: string, skin: Skin): string {
  return skin === 'REAL' && REAL_VENDOR[id] ? REAL_VENDOR[id].short : VENDOR_SHORT[id as keyof typeof VENDOR_SHORT] ?? id;
}
export function moduleName(id: string, skin: Skin): string {
  return skin === 'REAL' && REAL_MODULE[id] ? REAL_MODULE[id] : MODULE_BY_ID[id]?.name ?? id;
}
export function projectName(id: string, skin: Skin): string {
  return skin === 'REAL' && REAL_PROJECT[id] ? REAL_PROJECT[id] : PROJECT_BY_ID[id]?.name ?? id;
}
export function protocolName(p: string, skin: Skin): string {
  const e = PROTOCOL_NAMES[p as Protocol];
  return e ? (skin === 'REAL' ? e.real : e.fictional) : p.replace(/_/g, ' ');
}
export function protocolShort(p: string, skin: Skin): string {
  const e = PROTOCOL_NAMES[p as Protocol];
  return e ? (skin === 'REAL' ? e.shortR : e.shortF) : p;
}

const TOKEN = /\{(vs|v|c|m|p|xs|x):([A-Z0-9_]+)\}/g;

/** Replace every name token in `text` with its display name for `skin`. Unknown ids fall back to the id. */
export function resolveText(text: string, skin: Skin): string {
  if (!text.includes('{')) return text;
  return text.replace(TOKEN, (_m, kind: string, id: string) => {
    switch (kind) {
      case 'v': return vendorName(id, skin);
      case 'vs': return vendorShort(id, skin);
      case 'c': return vendorCountry(id, skin);
      case 'm': return moduleName(id, skin);
      case 'p': return projectName(id, skin);
      case 'x': return protocolName(id, skin);
      default: return protocolShort(id, skin);
    }
  });
}

/**
 * Real-name strings that differ from their fictional counterpart (used by the verifier to prove the fictional skin
 * never shows them).
 */
export function realNameLiterals(): string[] {
  const out: string[] = [];
  for (const id of Object.keys(REAL_VENDOR)) {
    for (const [real, fict] of [
      [vendorName(id, 'REAL'), vendorName(id, 'FICTIONAL')],
      [vendorCountry(id, 'REAL'), vendorCountry(id, 'FICTIONAL')],
      [vendorShort(id, 'REAL'), vendorShort(id, 'FICTIONAL')],
    ]) if (real !== fict) out.push(real);
  }
  for (const id of Object.keys(REAL_MODULE)) if (moduleName(id, 'REAL') !== moduleName(id, 'FICTIONAL')) out.push(moduleName(id, 'REAL'));
  for (const id of Object.keys(REAL_PROJECT)) if (projectName(id, 'REAL') !== projectName(id, 'FICTIONAL')) out.push(projectName(id, 'REAL'));
  for (const p of Object.keys(PROTOCOL_NAMES)) {
    for (const f of [protocolName, protocolShort]) if (f(p, 'REAL') !== f(p, 'FICTIONAL')) out.push(f(p, 'REAL'));
  }
  return [...new Set(out)];
}

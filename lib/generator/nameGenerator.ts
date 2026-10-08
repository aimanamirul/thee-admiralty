/** Commissioning names, pennants, formation titles and geographic place names. */
import { Rng } from './prng';
import type { HullClassId } from '../types/hull';
import type { NamingTradition } from '../types/fleet';

const VIRTUES = [
  'Indomitable', 'Vigilant', 'Resolute', 'Intrepid', 'Steadfast', 'Valiant', 'Dauntless', 'Gallant',
  'Implacable', 'Redoubtable', 'Sentinel', 'Unyielding', 'Fearless', 'Tenacious', 'Endeavour', 'Audacious',
  'Illustrious', 'Invincible', 'Formidable', 'Relentless', 'Vanguard', 'Perseverance', 'Constant', 'Diligent',
  'Fortitude', 'Guardian', 'Temperance', 'Justice', 'Prudence', 'Courageous',
];

const RIVERS = [
  'Severn', 'Tamar', 'Thames', 'Trent', 'Humber', 'Tyne', 'Clyde', 'Danube', 'Volga', 'Rhine', 'Loire',
  'Ebro', 'Tiber', 'Neva', 'Elbe', 'Vistula', 'Dnieper', 'Garonne', 'Shannon', 'Mersey',
];
const CAPES = [
  'Cape Wrath', 'Cape Finisterre', 'Cape Agulhas', 'Cape Horn', 'Cape Trafalgar', 'Cape Matapan',
  'Cape Bon', 'Cape Verde', 'Cape Comorin', 'Cape Otway', 'Cape Race', 'Cape Spartel',
];

const CELESTIAL = [
  'Orion', 'Sirius', 'Polaris', 'Antares', 'Vega', 'Rigel', 'Canopus', 'Altair', 'Arcturus', 'Aldebaran',
  'Centaurus', 'Perseus', 'Cassiopeia', 'Andromeda', 'Draco', 'Lyra', 'Pegasus', 'Capella', 'Procyon', 'Regulus',
];

const TABLES: Record<NamingTradition, string[]> = {
  VIRTUES,
  GEOGRAPHIC: [...RIVERS, ...CAPES],
  CELESTIAL,
};

export const TRADITIONS: NamingTradition[] = ['VIRTUES', 'GEOGRAPHIC', 'CELESTIAL'];

export const TRADITION_LABEL: Record<NamingTradition, string> = {
  VIRTUES: 'VIRTUES',
  GEOGRAPHIC: 'RIVERS & CAPES',
  CELESTIAL: 'CELESTIAL',
};

const ROMAN = ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Pick an unused name from the tradition; recycles the pool with a regnal numeral when exhausted. */
export function generateShipName(rng: Rng, tradition: NamingTradition, used: ReadonlySet<string>): string {
  const pool = TABLES[tradition];
  for (let gen = 0; gen < ROMAN.length; gen++) {
    const suffix = gen === 0 ? '' : ` ${ROMAN[gen]}`;
    const free = pool.filter((n) => !used.has(n + suffix));
    if (free.length > 0) return rng.pick(free) + suffix;
  }
  return `${rng.pick(pool)} ${used.size}`;
}

const PREFIX: Record<HullClassId, string> = { FAC: 'P', CORVETTE: 'K', FRIGATE: 'F', DESTROYER: 'D', CARRIER: 'R', SUB_SEORAK: 'S', SUB_KB: 'S' };

export function generatePennant(rng: Rng, hull: HullClassId, used: ReadonlySet<string>): string {
  for (let i = 0; i < 200; i++) {
    const p = `${PREFIX[hull]}${rng.int(10, 99)}${rng.int(0, 9)}`;
    if (!used.has(p)) return p;
  }
  return `${PREFIX[hull]}${used.size + 1000}`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function taskForceName(index: number): string {
  return `TF ${10 + index + 1}`;
}

export function squadronName(index: number, hull: HullClassId | 'MIXED'): string {
  const kind: Record<HullClassId | 'MIXED', string> = {
    FAC: 'FAC', CORVETTE: 'Corvette', FRIGATE: 'Frigate', DESTROYER: 'Destroyer', CARRIER: 'Carrier', SUB_SEORAK: 'Submarine', SUB_KB: 'Submarine', MIXED: 'Escort',
  };
  return `${ordinal(index + 1)} ${kind[hull]} Squadron`;
}

const SYL_A = ['Kar', 'Ras', 'Bal', 'Tor', 'Mar', 'Sal', 'Van', 'Har', 'Zan', 'Qes', 'Lin', 'Bor', 'Sun', 'Tar', 'Mal'];
const SYL_B = ['a', 'i', 'o', 'e', 'u', 'ar', 'en', 'is', 'on'];
const SYL_C = ['an', 'ish', 'ov', 'ka', 'da', 'ur', 'ing', 'sk', 'ta', 'ma', 'rah'];

/** Fictional place-name stem, e.g. "Karenka". */
export function geoPlaceName(rng: Rng): string {
  return rng.pick(SYL_A) + rng.pick(SYL_B) + rng.pick(SYL_C);
}

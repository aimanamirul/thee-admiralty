/** Cosmetic geographic frame: maps tile coordinates to a seed-specific latitude/longitude window. */
import { hashString } from './prng';

export const DEG_PER_TILE = 0.1;

export interface GeoOrigin {
  lat0: number;
  lon0: number;
}

export function geoOrigin(seed: string): GeoOrigin {
  const h = hashString(`${seed}::geo`);
  return { lat0: 24 + (h % 300) / 10, lon0: -20 + ((h >>> 9) % 1400) / 10 };
}

export function tileToLat(o: GeoOrigin, y: number): number {
  return o.lat0 - y * DEG_PER_TILE;
}
export function tileToLon(o: GeoOrigin, x: number): number {
  return o.lon0 + x * DEG_PER_TILE;
}
export function fmtLat(deg: number, digits = 1): string {
  return `${Math.abs(deg).toFixed(digits)}°${deg >= 0 ? 'N' : 'S'}`;
}
export function fmtLon(deg: number, digits = 1): string {
  return `${Math.abs(deg).toFixed(digits)}°${deg >= 0 ? 'E' : 'W'}`;
}

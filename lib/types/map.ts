/** Map, bathymetry, sector and chokepoint types. World units == grid cells (tiles). */

export interface Vec2 {
  x: number;
  y: number;
}

export type MapArchetype = 'CHOKEPOINT' | 'CORRIDOR' | 'RIMLAND';

export const ARCHETYPE_LABEL: Record<MapArchetype, string> = {
  CHOKEPOINT: 'CHOKEPOINT / HORMUZ',
  CORRIDOR: 'CORRIDOR / MALACCA',
  RIMLAND: 'ENCLOSED RIMLAND / BALTIC',
};

export type BathyTier = 'LAND' | 'LITTORAL' | 'SHELF' | 'ABYSSAL';

/** Elevation thresholds (negative = depth). Littoral [-0.15,0], Shelf [-0.60,-0.15], Abyssal < -0.60. */
export const LITTORAL_FLOOR = -0.15;
export const SHELF_FLOOR = -0.6;

export function tierOf(elevation: number): BathyTier {
  if (elevation > 0) return 'LAND';
  if (elevation >= LITTORAL_FLOOR) return 'LITTORAL';
  if (elevation >= SHELF_FLOOR) return 'SHELF';
  return 'ABYSSAL';
}

export interface Polyline {
  points: Vec2[];
  closed: boolean;
}

export interface IsolineSet {
  level: number;
  tier: BathyTier;
  lines: Polyline[];
}

export interface Chokepoint {
  id: number;
  name: string;
  position: Vec2;
  /** Navigable width in tiles at the narrowest point. */
  widthTiles: number;
  /** Sector containing the pass itself. */
  sectorId: number;
  /** Every sector touched by the pass (the waters it connects). */
  links: number[];
}

export interface Sector {
  id: number;
  /** e.g. "SECTOR 1: NORTHERN STRAIT" */
  name: string;
  /** e.g. "NORTHERN STRAIT" */
  label: string;
  kind: 'STRAIT' | 'APPROACHES' | 'BASIN' | 'SHOALS' | 'REACH';
  centroid: Vec2;
  /** A guaranteed-navigable water cell near the centroid (patrol station). */
  anchor: Vec2;
  areaTiles: number;
  littoralFraction: number;
  shelfFraction: number;
  abyssalFraction: number;
  maxClearance: number;
  touchesEdge: boolean;
  neighbors: number[];
}

export interface MapData {
  seed: string;
  archetype: MapArchetype;
  width: number;
  height: number;
  /** Row-major (y*width+x). >0 land, <=0 water depth. */
  elevation: Float32Array;
  /** Distance (tiles) from each water cell to nearest land; 0 on land. */
  clearance: Float32Array;
  /** Sector id per cell, -1 on land. */
  sectorGrid: Int16Array;
  coastlines: Polyline[];
  isolines: IsolineSet[];
  /** Flat [x1,y1,x2,y2,...] polylines are preferred; borders are stored as polylines. */
  sectorBorders: Polyline[];
  sectors: Sector[];
  chokepoints: Chokepoint[];
  homePort: Vec2;
  stats: MapStats;
}

export interface MapStats {
  waterFraction: number;
  littoralFraction: number;
  shelfFraction: number;
  abyssalFraction: number;
  narrowestChokepointTiles: number;
  /** FNV-1a fingerprint of the elevation buffer; identical seeds => identical hash. */
  fingerprint: string;
}

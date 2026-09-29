/**
 * Sector & strait designation.
 *
 * 1. `clearance` (distance-to-land on water cells) is treated as a topographic surface.
 * 2. A persistence-based watershed floods it from the deepest open water downward. Where two
 *    *significant* basins meet is a mountain-pass saddle == a navigational bottleneck.
 * 3. Narrow saddles become STRAIT sectors; basins become operational sectors; oversize basins
 *    are bisected (2-means) and slivers are absorbed into their best neighbour.
 */
import type { Chokepoint, Polyline, Sector } from '../types/map';
import { LITTORAL_FLOOR, SHELF_FLOOR } from '../types/map';
import { chaikin, stitchSegments, type Segment } from './marchingSquares';
import { geoPlaceName } from './nameGenerator';
import type { Rng } from './prng';

export interface SectorInput {
  w: number;
  h: number;
  water: Uint8Array;
  clearance: Float32Array;
  elevation: Float32Array;
  rng: Rng;
}

export interface SectorResult {
  sectorGrid: Int16Array;
  sectors: Sector[];
  chokepoints: Chokepoint[];
  borders: Polyline[];
}

interface Saddle {
  cell: number;
  c: number;
  a: number;
  b: number;
  /** Peak clearance of the smaller of the two basins the pass joins. */
  minPeak: number;
}

const STRAIT_RADIUS = 8;
const MAX_STRAIT_WIDTH = 9;

export function designateSectors(input: SectorInput): SectorResult {
  const { w, h, water, clearance, elevation, rng } = input;
  const n = w * h;
  const nb4 = (i: number, out: number[]) => {
    out.length = 0;
    const x = i % w;
    if (x > 0) out.push(i - 1);
    if (x < w - 1) out.push(i + 1);
    if (i >= w) out.push(i - w);
    if (i < n - w) out.push(i + w);
  };

  let maxClear = 0;
  for (let i = 0; i < n; i++) if (water[i] && clearance[i] > maxClear) maxClear = clearance[i];
  const waterCount = water.reduce((s, v) => s + v, 0);

  // ---- 1. persistence watershed -------------------------------------------------------
  const persistence = Math.max(2.5, maxClear * 0.1);
  const { labels: basinLabels, saddles } = watershed(water, clearance, w, h, persistence, nb4);
  const grid = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) grid[i] = basinLabels[i];
  let nextId = 0;
  for (let i = 0; i < n; i++) if (grid[i] >= nextId) nextId = grid[i] + 1;

  // ---- 2. strait sectors around the narrowest saddles ---------------------------------
  const candidates = saddles
    // Only passes joining two *major* bodies of water count; lagoon inlets are ignored.
    .filter((s) => 2 * s.c - 1 <= MAX_STRAIT_WIDTH && s.minPeak >= Math.max(6, maxClear * 0.25))
    .sort((a, b) => a.c - b.c || a.cell - b.cell);
  const accepted: Saddle[] = [];
  for (const s of candidates) {
    const sx = s.cell % w;
    const sy = Math.floor(s.cell / w);
    const clash = accepted.some((o) => Math.hypot((o.cell % w) - sx, Math.floor(o.cell / w) - sy) < STRAIT_RADIUS * 2 + 2);
    if (!clash && accepted.length < 4) accepted.push(s);
  }
  const straitIds = new Set<number>();
  for (const s of accepted) {
    const sx = s.cell % w;
    const sy = Math.floor(s.cell / w);
    const id = nextId++;
    straitIds.add(id);
    for (let y = Math.max(0, sy - STRAIT_RADIUS); y <= Math.min(h - 1, sy + STRAIT_RADIUS); y++) {
      for (let x = Math.max(0, sx - STRAIT_RADIUS); x <= Math.min(w - 1, sx + STRAIT_RADIUS); x++) {
        const i = y * w + x;
        if (water[i] && Math.hypot(x - sx, y - sy) <= STRAIT_RADIUS) grid[i] = id;
      }
    }
  }

  fixConnectivity(grid, w, h, water, nb4);

  // ---- 3. absorb slivers ---------------------------------------------------------------
  const minCells = Math.max(30, Math.round(waterCount * 0.018));
  for (let guard = 0; guard < 200; guard++) {
    const counts = sectorCounts(grid);
    let smallest = -1;
    let smallestCount = Infinity;
    for (const [id, c] of counts) {
      const need = straitIds.has(id) ? 18 : minCells;
      if (c < need && c < smallestCount) {
        smallest = id;
        smallestCount = c;
      }
    }
    if (smallest < 0) break;
    const target = bestNeighbour(grid, w, h, smallest, nb4);
    if (target < 0) break;
    for (let i = 0; i < n; i++) if (grid[i] === smallest) grid[i] = target;
    straitIds.delete(smallest);
  }

  // ---- 4. bisect oversize basins -------------------------------------------------------
  const targetCount = rng.int(6, 8);
  for (let guard = 0; guard < 12; guard++) {
    const counts = sectorCounts(grid);
    let biggest = -1;
    let biggestCount = 0;
    for (const [id, c] of counts) {
      if (straitIds.has(id)) continue;
      if (c > biggestCount) {
        biggest = id;
        biggestCount = c;
      }
    }
    const needSplit = counts.size < targetCount || biggestCount > waterCount * 0.3;
    if (!needSplit || biggest < 0 || biggestCount < 260) break;
    bisect(grid, w, biggest, nextId++);
    fixConnectivity(grid, w, h, water, nb4);
  }

  // ---- 5. finalise: order, name, describe ----------------------------------------------
  const counts = sectorCounts(grid);
  const rawIds = [...counts.keys()];
  const stat = new Map<number, { sx: number; sy: number; c: number }>();
  for (let i = 0; i < n; i++) {
    const id = grid[i];
    if (id < 0) continue;
    const s = stat.get(id) ?? { sx: 0, sy: 0, c: 0 };
    s.sx += i % w;
    s.sy += Math.floor(i / w);
    s.c++;
    stat.set(id, s);
  }
  rawIds.sort((a, b) => {
    const sa = stat.get(a)!;
    const sb = stat.get(b)!;
    return sa.sx / sa.c - sb.sx / sb.c || sa.sy / sa.c - sb.sy / sb.c;
  });
  const remap = new Map<number, number>(rawIds.map((id, idx) => [id, idx]));
  const sectorGrid = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (grid[i] >= 0) sectorGrid[i] = remap.get(grid[i])!;

  const sectors = describeSectors({
    sectorGrid, count: rawIds.length, straitOld: rawIds.map((id) => straitIds.has(id)),
    w, h, clearance, elevation, maxClear, nb4,
  });

  const chokepoints: Chokepoint[] = accepted.map((s, i) => {
    const x = s.cell % w;
    const y = Math.floor(s.cell / w);
    const links = new Set<number>();
    for (let yy = Math.max(0, y - 10); yy <= Math.min(h - 1, y + 10); yy++) {
      for (let xx = Math.max(0, x - 10); xx <= Math.min(w - 1, x + 10); xx++) {
        const id = sectorGrid[yy * w + xx];
        if (id >= 0 && Math.hypot(xx - x, yy - y) <= 10) links.add(id);
      }
    }
    return {
      id: i,
      name: `${geoPlaceName(rng)} Strait`.toUpperCase(),
      position: { x, y },
      widthTiles: Math.max(1, Math.round(2 * s.c - 1)),
      sectorId: sectorGrid[s.cell],
      links: [...links].sort((a, b) => a - b),
    };
  });

  return { sectorGrid, sectors, chokepoints, borders: traceBorders(sectorGrid, w, h) };
}

// ---------------------------------------------------------------------------------------

function watershed(
  water: Uint8Array,
  clearance: Float32Array,
  w: number,
  h: number,
  persistence: number,
  nb4: (i: number, out: number[]) => void,
) {
  const n = w * h;
  const order: number[] = [];
  for (let i = 0; i < n; i++) if (water[i]) order.push(i);
  order.sort((a, b) => clearance[b] - clearance[a] || a - b);

  const uf = new Int32Array(n).fill(-1);
  const peak = new Float32Array(n);
  const find = (i: number) => {
    while (uf[i] !== i) {
      uf[i] = uf[uf[i]];
      i = uf[i];
    }
    return i;
  };
  const saddles: Saddle[] = [];
  const nbrs: number[] = [];
  for (const i of order) {
    nb4(i, nbrs);
    const roots: number[] = [];
    for (const nbi of nbrs) {
      if (uf[nbi] < 0) continue;
      const r = find(nbi);
      if (!roots.includes(r)) roots.push(r);
    }
    if (roots.length === 0) {
      uf[i] = i;
      peak[i] = clearance[i];
      continue;
    }
    roots.sort((a, b) => peak[b] - peak[a] || a - b);
    const primary = roots[0];
    uf[i] = primary;
    for (let k = 1; k < roots.length; k++) {
      const r = roots[k];
      if (peak[r] - clearance[i] < persistence) uf[r] = primary;
      else saddles.push({ cell: i, c: clearance[i], a: primary, b: r, minPeak: peak[r] });
    }
  }
  const ids = new Map<number, number>();
  const labels = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!water[i]) continue;
    const r = find(i);
    if (!ids.has(r)) ids.set(r, ids.size);
    labels[i] = ids.get(r)!;
  }
  return { labels, saddles };
}

function sectorCounts(grid: Int32Array): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < grid.length; i++) if (grid[i] >= 0) m.set(grid[i], (m.get(grid[i]) ?? 0) + 1);
  return m;
}

/** Neighbouring sector sharing the longest border with `id`, or -1. */
function bestNeighbour(grid: Int32Array, w: number, h: number, id: number, nb4: (i: number, o: number[]) => void): number {
  const shared = new Map<number, number>();
  const nbrs: number[] = [];
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== id) continue;
    nb4(i, nbrs);
    for (const j of nbrs) if (grid[j] >= 0 && grid[j] !== id) shared.set(grid[j], (shared.get(grid[j]) ?? 0) + 1);
  }
  let best = -1;
  let bestCount = 0;
  for (const [k, c] of [...shared].sort((a, b) => a[0] - b[0])) if (c > bestCount) { best = k; bestCount = c; }
  return best;
}

/** Keep the largest 4-connected component of every sector; graft fragments onto their best neighbour. */
function fixConnectivity(grid: Int32Array, w: number, h: number, water: Uint8Array, nb4: (i: number, o: number[]) => void) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const comps: { id: number; cells: number[] }[] = [];
  const nbrs: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!water[s] || seen[s] || grid[s] < 0) continue;
    const id = grid[s];
    const cells = [s];
    seen[s] = 1;
    for (let q = 0; q < cells.length; q++) {
      nb4(cells[q], nbrs);
      for (const j of nbrs) if (!seen[j] && grid[j] === id) { seen[j] = 1; cells.push(j); }
    }
    comps.push({ id, cells });
  }
  const largest = new Map<number, { id: number; cells: number[] }>();
  for (const c of comps) if (!largest.has(c.id) || c.cells.length > largest.get(c.id)!.cells.length) largest.set(c.id, c);
  const fragments = comps.filter((c) => largest.get(c.id) !== c).sort((a, b) => b.cells.length - a.cells.length);
  for (const f of fragments) {
    const votes = new Map<number, number>();
    for (const i of f.cells) {
      nb4(i, nbrs);
      for (const j of nbrs) if (grid[j] >= 0 && grid[j] !== f.id) votes.set(grid[j], (votes.get(grid[j]) ?? 0) + 1);
    }
    let best = -1;
    let bestV = 0;
    for (const [k, v] of [...votes].sort((a, b) => a[0] - b[0])) if (v > bestV) { best = k; bestV = v; }
    if (best >= 0) for (const i of f.cells) grid[i] = best;
  }
}

/** Split one sector in two along its principal spread using 2-means seeded from its extremes. */
function bisect(grid: Int32Array, w: number, id: number, newId: number) {
  const cells: number[] = [];
  for (let i = 0; i < grid.length; i++) if (grid[i] === id) cells.push(i);
  const px = (i: number) => i % w;
  const py = (i: number) => Math.floor(i / w);
  const dist2 = (i: number, x: number, y: number) => (px(i) - x) ** 2 + (py(i) - y) ** 2;
  const far = (x: number, y: number) => cells.reduce((b, i) => (dist2(i, x, y) > dist2(b, x, y) ? i : b), cells[0]);
  const a0 = far(px(cells[0]), py(cells[0]));
  const b0 = far(px(a0), py(a0));
  let ax = px(a0), ay = py(a0), bx = px(b0), by = py(b0);
  let side = new Uint8Array(cells.length);
  for (let it = 0; it < 8; it++) {
    let sax = 0, say = 0, na = 0, sbx = 0, sby = 0, nbn = 0;
    cells.forEach((i, k) => {
      const toA = dist2(i, ax, ay) <= dist2(i, bx, by);
      side[k] = toA ? 0 : 1;
      if (toA) { sax += px(i); say += py(i); na++; } else { sbx += px(i); sby += py(i); nbn++; }
    });
    if (na === 0 || nbn === 0) break;
    ax = sax / na; ay = say / na; bx = sbx / nbn; by = sby / nbn;
  }
  cells.forEach((i, k) => { if (side[k] === 1) grid[i] = newId; });
}

interface DescribeArgs {
  sectorGrid: Int16Array;
  count: number;
  straitOld: boolean[];
  w: number;
  h: number;
  clearance: Float32Array;
  elevation: Float32Array;
  maxClear: number;
  nb4: (i: number, o: number[]) => void;
}

const DIRS = ['EASTERN', 'SOUTHEASTERN', 'SOUTHERN', 'SOUTHWESTERN', 'WESTERN', 'NORTHWESTERN', 'NORTHERN', 'NORTHEASTERN'];
const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII'];

function describeSectors(a: DescribeArgs): Sector[] {
  const { sectorGrid, count, straitOld, w, h, clearance, elevation, maxClear, nb4 } = a;
  const acc = Array.from({ length: count }, () => ({
    sx: 0, sy: 0, c: 0, lit: 0, shelf: 0, abys: 0, maxC: 0, edge: false, nbrs: new Set<number>(),
  }));
  const nbrs: number[] = [];
  for (let i = 0; i < sectorGrid.length; i++) {
    const id = sectorGrid[i];
    if (id < 0) continue;
    const s = acc[id];
    const x = i % w;
    const y = Math.floor(i / w);
    s.sx += x; s.sy += y; s.c++;
    const e = elevation[i];
    if (e >= LITTORAL_FLOOR) s.lit++; else if (e >= SHELF_FLOOR) s.shelf++; else s.abys++;
    if (clearance[i] > s.maxC) s.maxC = clearance[i];
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) s.edge = true;
    nb4(i, nbrs);
    for (const j of nbrs) if (sectorGrid[j] >= 0 && sectorGrid[j] !== id) s.nbrs.add(sectorGrid[j]);
  }

  const labelCounts = new Map<string, number>();
  return acc.map((s, id) => {
    const cx = s.sx / s.c;
    const cy = s.sy / s.c;
    // Anchor: open-water cell nearest the centroid.
    let anchor = { x: Math.round(cx), y: Math.round(cy) };
    let bestD = Infinity;
    const wantClear = Math.min(3, s.maxC * 0.6);
    for (let i = 0; i < sectorGrid.length; i++) {
      if (sectorGrid[i] !== id || clearance[i] < wantClear) continue;
      const d = (i % w - cx) ** 2 + (Math.floor(i / w) - cy) ** 2;
      if (d < bestD) { bestD = d; anchor = { x: i % w, y: Math.floor(i / w) }; }
    }
    const dx = (cx - w / 2) / w;
    const dy = (cy - h / 2) / h;
    const central = Math.hypot(dx, dy) < 0.09;
    const dir = central ? 'CENTRAL' : DIRS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
    const litFrac = s.lit / s.c;
    let kind: Sector['kind'];
    let noun: string;
    if (straitOld[id]) { kind = 'STRAIT'; noun = 'STRAIT'; }
    else if (s.edge) { kind = 'APPROACHES'; noun = 'APPROACHES'; }
    else if (litFrac > 0.3) { kind = 'SHOALS'; noun = 'SHOALS'; }
    else if (s.maxC >= maxClear * 0.55) { kind = 'BASIN'; noun = 'BASIN'; }
    else { kind = 'REACH'; noun = 'REACH'; }
    const base = `${dir} ${noun}`;
    const seenCount = labelCounts.get(base) ?? 0;
    labelCounts.set(base, seenCount + 1);
    const label = base + ROMAN[Math.min(seenCount, ROMAN.length - 1)];
    return {
      id,
      name: `SECTOR ${id + 1}: ${label}`,
      label,
      kind,
      centroid: { x: cx, y: cy },
      anchor,
      areaTiles: s.c,
      littoralFraction: litFrac,
      shelfFraction: s.shelf / s.c,
      abyssalFraction: s.abys / s.c,
      maxClearance: s.maxC,
      touchesEdge: s.edge,
      neighbors: [...s.nbrs].sort((p, q) => p - q),
    };
  });
}

/** Sector boundaries as smoothed polylines (water/water cell interfaces only). */
function traceBorders(sectorGrid: Int16Array, w: number, h: number): Polyline[] {
  const segs: Segment[] = [];
  const corner = (i: number, j: number) => j * (w + 2) + i; // corner (i,j) sits at (i-0.5, j-0.5)
  const pt = (i: number, j: number) => ({ x: i - 0.5, y: j - 0.5 });
  const push = (i1: number, j1: number, i2: number, j2: number) =>
    segs.push({ ka: corner(i1, j1), kb: corner(i2, j2), a: pt(i1, j1), b: pt(i2, j2) });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = sectorGrid[y * w + x];
      if (id < 0) continue;
      if (x < w - 1) {
        const r = sectorGrid[y * w + x + 1];
        if (r >= 0 && r !== id) push(x + 1, y, x + 1, y + 1);
      }
      if (y < h - 1) {
        const d = sectorGrid[(y + 1) * w + x];
        if (d >= 0 && d !== id) push(x, y + 1, x + 1, y + 1);
      }
    }
  }
  return stitchSegments(segs).map((l) => chaikin(l, 2));
}

/**
 * Build sector descriptions and border polylines for a caller-supplied sector grid (ids 0..n-1, -1 on land).
 * Used by hand-authored scenarios that partition the water themselves.
 */
export function sectorsFromGrid(args: {
  sectorGrid: Int16Array;
  w: number;
  h: number;
  clearance: Float32Array;
  elevation: Float32Array;
  straits?: boolean[];
}): { sectors: Sector[]; borders: Polyline[] } {
  const { sectorGrid, w, h, clearance, elevation } = args;
  const n = w * h;
  let count = 0;
  let maxClear = 0;
  for (let i = 0; i < n; i++) {
    if (sectorGrid[i] >= count) count = sectorGrid[i] + 1;
    if (sectorGrid[i] >= 0 && clearance[i] > maxClear) maxClear = clearance[i];
  }
  const nb4 = (i: number, out: number[]) => {
    out.length = 0;
    const x = i % w;
    if (x > 0) out.push(i - 1);
    if (x < w - 1) out.push(i + 1);
    if (i >= w) out.push(i - w);
    if (i < n - w) out.push(i + w);
  };
  const sectors = describeSectors({
    sectorGrid, count, straitOld: args.straits ?? Array(count).fill(false), w, h, clearance, elevation, maxClear, nb4,
  });
  return { sectors, borders: traceBorders(sectorGrid, w, h) };
}

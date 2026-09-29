/**
 * Marching squares contour tracer. Samples sit at integer grid coordinates; contour
 * vertices are linearly interpolated on grid edges, so output is in tile units.
 */
import type { Polyline, Vec2 } from '../types/map';

export interface Segment {
  ka: number;
  kb: number;
  a: Vec2;
  b: Vec2;
}

/**
 * Join unordered segments into polylines. Vertices are matched by integer key, so
 * stitching is exact (no epsilon comparisons). Handles junctions of any degree.
 */
export function stitchSegments(segments: Segment[]): Polyline[] {
  const pos = new Map<number, Vec2>();
  const incident = new Map<number, number[]>();
  segments.forEach((s, i) => {
    pos.set(s.ka, s.a);
    pos.set(s.kb, s.b);
    (incident.get(s.ka) ?? incident.set(s.ka, []).get(s.ka)!).push(i);
    (incident.get(s.kb) ?? incident.set(s.kb, []).get(s.kb)!).push(i);
  });
  const used = new Uint8Array(segments.length);
  const lines: Polyline[] = [];

  const walk = (startKey: number, firstSeg: number): number[] => {
    const chain = [startKey];
    let cur = startKey;
    let seg = firstSeg;
    while (seg >= 0) {
      used[seg] = 1;
      const s = segments[seg];
      cur = s.ka === cur ? s.kb : s.ka;
      chain.push(cur);
      seg = (incident.get(cur) ?? []).find((j) => !used[j]) ?? -1;
    }
    return chain;
  };

  // Open chains first (start at degree-1 vertices), then remaining loops.
  const order: number[] = [];
  for (const [k, list] of incident) if (list.length !== 2) order.push(k);
  order.sort((a, b) => a - b);
  for (const k of order) {
    for (const j of incident.get(k)!) {
      if (used[j]) continue;
      const chain = walk(k, j);
      lines.push({ points: chain.map((c) => pos.get(c)!), closed: false });
    }
  }
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    const chain = walk(segments[i].ka, i);
    const closed = chain[0] === chain[chain.length - 1];
    if (closed) chain.pop();
    lines.push({ points: chain.map((c) => pos.get(c)!), closed });
  }
  return lines;
}

/** Chaikin corner cutting. */
export function chaikin(line: Polyline, iterations: number): Polyline {
  let pts = line.points;
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) break;
    const next: Vec2[] = [];
    const n = pts.length;
    const last = line.closed ? n : n - 1;
    if (!line.closed) next.push(pts[0]);
    for (let i = 0; i < last; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      next.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y });
      next.push({ x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y });
    }
    if (!line.closed) next.push(pts[n - 1]);
    pts = next;
  }
  return { points: pts, closed: line.closed };
}

/**
 * Trace the iso-contour at `level`. "Inside" means value > level (so land is inside
 * for level 0). Returns raw, unsmoothed polylines.
 */
export function marchingSquares(values: Float32Array, w: number, h: number, level: number): Polyline[] {
  const segments: Segment[] = [];
  const hKey = (x: number, y: number) => y * w + x; // edge (x,y)-(x+1,y)
  const vKey = (x: number, y: number) => w * h + y * w + x; // edge (x,y)-(x,y+1)
  const at = (x: number, y: number) => values[y * w + x];

  const hPoint = (x: number, y: number): Vec2 => {
    const a = at(x, y);
    const b = at(x + 1, y);
    const t = a === b ? 0.5 : (level - a) / (b - a);
    return { x: x + t, y };
  };
  const vPoint = (x: number, y: number): Vec2 => {
    const a = at(x, y);
    const b = at(x, y + 1);
    const t = a === b ? 0.5 : (level - a) / (b - a);
    return { x, y: y + t };
  };

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = at(x, y);
      const tr = at(x + 1, y);
      const br = at(x + 1, y + 1);
      const bl = at(x, y + 1);
      const idx = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;

      // Edge accessors for this cell.
      const top = () => ({ k: hKey(x, y), p: hPoint(x, y) });
      const bottom = () => ({ k: hKey(x, y + 1), p: hPoint(x, y + 1) });
      const left = () => ({ k: vKey(x, y), p: vPoint(x, y) });
      const right = () => ({ k: vKey(x + 1, y), p: vPoint(x + 1, y) });
      const emit = (e1: () => { k: number; p: Vec2 }, e2: () => { k: number; p: Vec2 }) => {
        const a = e1();
        const b = e2();
        segments.push({ ka: a.k, kb: b.k, a: a.p, b: b.p });
      };

      const centerInside = (tl + tr + br + bl) / 4 > level;
      switch (idx) {
        case 1: case 14: emit(left, bottom); break;
        case 2: case 13: emit(bottom, right); break;
        case 3: case 12: emit(left, right); break;
        case 4: case 11: emit(top, right); break;
        case 6: case 9: emit(top, bottom); break;
        case 7: case 8: emit(top, left); break;
        case 5: // tr & bl inside
          if (centerInside) { emit(top, left); emit(bottom, right); }
          else { emit(top, right); emit(left, bottom); }
          break;
        case 10: // tl & br inside
          if (centerInside) { emit(top, right); emit(left, bottom); }
          else { emit(top, left); emit(bottom, right); }
          break;
      }
    }
  }
  return stitchSegments(segments);
}

/** Trace + drop specks + smooth. */
export function extractContours(
  values: Float32Array,
  w: number,
  h: number,
  level: number,
  opts: { minPoints?: number; smooth?: number } = {},
): Polyline[] {
  const { minPoints = 5, smooth = 2 } = opts;
  return marchingSquares(values, w, h, level)
    .filter((l) => l.points.length >= minPoints)
    .map((l) => chaikin(l, smooth));
}

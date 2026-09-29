/**
 * Seeded procedural nautical map: macro-structural archetype -> domain-warped fractal noise ->
 * land mask -> guaranteed navigable channels -> signed-distance bathymetry -> vector contours ->
 * sectors and chokepoints. Fully deterministic for a given (seed, archetype).
 */
import type { MapArchetype, MapData, Polyline, Vec2, IsolineSet } from '../types/map';
import { LITTORAL_FLOOR, SHELF_FLOOR, tierOf } from '../types/map';
import { distanceTransform } from './distance';
import { extractContours } from './marchingSquares';
import { clamp, distToSegment, fingerprint, smoothstep } from './math';
import { Noise2D } from './noise';
import { Rng } from './prng';
import { designateSectors } from './sectors';

export const MAP_W = 192;
export const MAP_H = 120;
export const ARCHETYPES: MapArchetype[] = ['CHOKEPOINT', 'CORRIDOR', 'RIMLAND'];

interface Carve {
  pts: Vec2[];
  radius: number;
}

interface Macro {
  /** Signed tile-distance-like field; > 0 means land. Already includes noise. */
  land: Float32Array;
  /** Channels forced to remain navigable (guarantees 1-3 tile straits survive the noise). */
  carves: Carve[];
  maxDepth: number;
  depthScale: number;
  shoalCount: number;
}

interface BuildCtx {
  w: number;
  h: number;
  rng: Rng;
  noise: Noise2D;
  /** Domain-warped fBm in roughly [-1,1]. */
  wf: (x: number, y: number) => number;
}

/** Add a gaussian land bump (island) to a field. */
function addBump(field: Float32Array, w: number, h: number, cx: number, cy: number, sigma: number, amp: number) {
  const r = Math.ceil(sigma * 4);
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      field[y * w + x] += amp * Math.exp(-d2 / (2 * sigma * sigma));
    }
  }
}

function catmullRom(ctrl: Vec2[], samples: number): Vec2[] {
  const out: Vec2[] = [];
  const segs = ctrl.length - 1;
  for (let s = 0; s < samples; s++) {
    const u = (s / (samples - 1)) * segs;
    const i = Math.min(segs - 1, Math.floor(u));
    const t = u - i;
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    const f = (a: number, b: number, c: number, d: number) =>
      0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
  }
  return out;
}

// ------------------------------------------------------------------ archetype: CHOKEPOINT

/** Two landmasses pinched by a radial/distance mask down to a 1-3 tile neck (Hormuz). */
function buildChokepoint(ctx: BuildCtx): Macro {
  const { w, h, rng, wf } = ctx;
  const r = rng.fork('chokepoint');
  const cx = w * r.range(0.45, 0.55);
  const cy = h * 0.5 + r.range(-6, 6);
  const tilt = r.range(-0.06, 0.06);
  const waveAmp = r.range(2, 6);
  const phase = r.range(0, Math.PI * 2);
  const neck = r.range(0.8, 1.5);
  const open = h * 0.4;
  const funnel = w * 0.3;

  const spineY = (x: number) =>
    cy + tilt * (x - cx) + waveAmp * Math.sin(x * 0.035 + phase) * smoothstep(0, w * 0.25, Math.abs(x - cx));
  const halfWidth = (x: number) =>
    neck + (open - neck) * smoothstep(0, 1, clamp((Math.abs(x - cx) - 5) / funnel, 0, 1));
  const macro = (x: number, y: number) => {
    const sy = spineY(x);
    const hw = halfWidth(x);
    return Math.max(sy - hw - y, y - sy - hw);
  };

  const land = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Noise fades out completely at the neck so its width is a design parameter, not luck.
      const k = smoothstep(4, w * 0.22, Math.abs(x - cx));
      land[y * w + x] = macro(x, y) + 9 * k * wf(x, y);
    }
  }

  const islands = r.int(2, 5);
  for (let i = 0; i < islands; i++) {
    const side = r.chance(0.5) ? -1 : 1;
    const x = cx + side * r.range(0.14, 0.42) * w;
    const y = spineY(x) + r.range(-0.5, 0.5) * halfWidth(x);
    addBump(land, w, h, x, y, r.range(1.8, 4), -macro(x, y) + r.range(1.5, 4));
  }

  const spine: Vec2[] = [];
  for (let x = 0; x < w; x += 2) spine.push({ x, y: spineY(x) });
  spine.push({ x: w - 1, y: spineY(w - 1) });
  return {
    land,
    carves: [{ pts: spine, radius: Math.max(0.78, neck) }],
    maxDepth: 1.25,
    depthScale: 14,
    shoalCount: r.int(8, 12),
  };
}

// ------------------------------------------------------------------ archetype: CORRIDOR

/** Long spline-bounded channel between landmasses, strewn with shoals and barrier islets (Malacca). */
function buildCorridor(ctx: BuildCtx): Macro {
  const { w, h, rng, wf } = ctx;
  const r = rng.fork('corridor');
  const flip = r.chance(0.5);
  const yA = h * r.range(0.2, 0.4);
  const yB = h * r.range(0.6, 0.8);
  const ctrl: Vec2[] = [];
  const K = 6;
  for (let i = 0; i < K; i++) {
    const t = i / (K - 1);
    const off = i === 0 || i === K - 1 ? 0 : r.range(-1, 1) * h * 0.1;
    let y = yA + (yB - yA) * t + off;
    if (flip) y = h - y;
    ctrl.push({ x: -0.06 * w + 1.12 * w * t, y });
  }
  const N = 260;
  const spine = catmullRom(ctrl, N);

  const wMid = h * r.range(0.17, 0.21);
  const pinchT = r.range(0.55, 0.75);
  const pinchW = r.range(3.5, 5);
  const halfWidth = (t: number) =>
    wMid * (1 - (1 - pinchW / wMid) * Math.exp(-(((t - pinchT) / 0.06) ** 2))) +
    wMid * 1.6 * smoothstep(0.8, 1, Math.abs(2 * t - 1));

  const land = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity;
      let bestT = 0;
      for (let s = 0; s < N - 1; s++) {
        const q = distToSegment(x, y, spine[s].x, spine[s].y, spine[s + 1].x, spine[s + 1].y);
        if (q.dist < best) {
          best = q.dist;
          bestT = (s + q.t) / (N - 1);
        }
      }
      const calm = 1 - 0.7 * Math.exp(-(((bestT - pinchT) / 0.08) ** 2));
      land[y * w + x] = best - halfWidth(bestT) + 6 * calm * wf(x, y);
    }
  }

  // Barrier islets along the channel.
  const islets = r.int(10, 18);
  for (let i = 0; i < islets; i++) {
    const t = r.range(0.05, 0.95);
    const idx = Math.round(t * (N - 1));
    const p = spine[idx];
    const q = spine[Math.min(N - 1, idx + 1)];
    const tx = q.x - p.x;
    const ty = q.y - p.y;
    const len = Math.hypot(tx, ty) || 1;
    const hw = halfWidth(t);
    const off = r.range(-0.7, 0.7) * hw;
    const x = p.x + (-ty / len) * off;
    const y = p.y + (tx / len) * off;
    addBump(land, w, h, x, y, r.range(0.9, 1.7), hw - Math.abs(off) + r.range(0.4, 2));
  }

  return {
    land,
    carves: [{ pts: spine, radius: 2 }],
    maxDepth: 1.1,
    depthScale: 17,
    shoalCount: r.int(12, 18),
  };
}

// ------------------------------------------------------------------ archetype: RIMLAND

/** Inverted basin: an enclosed interior sea ringed by land, joined to the map edge by island straits (Baltic). */
function buildRimland(ctx: BuildCtx): Macro {
  const { w, h, rng, noise, wf } = ctx;
  const r = rng.fork('rimland');
  const cx = w * r.range(0.47, 0.53);
  const cy = h * r.range(0.48, 0.52);
  const rx = w * 0.34;
  const ry = h * 0.3;
  const ringBase = r.range(6.5, 9);
  const ox = r.range(0, 50);
  const oy = r.range(0, 50);

  const straitCount = r.int(2, 3);
  const a0 = Math.PI + r.range(-0.6, 0.6);
  const angles: number[] = [];
  for (let i = 0; i < straitCount; i++) angles.push(a0 + (i * 2 * Math.PI) / straitCount + r.range(-0.35, 0.35));
  const gapW = r.range(3.5, 5.5);
  const rMean = (rx + ry) / 2 + ringBase;

  const macro = (x: number, y: number) => {
    const dx = x - cx;
    const dy = y - cy;
    const rr = Math.hypot(dx / rx, dy / ry) || 1e-6;
    const grad = Math.hypot(dx / (rx * rx), dy / (ry * ry)) / rr;
    const s = (rr - 1) / Math.max(grad, 1e-6);
    const th = Math.atan2(dy, dx);
    const rh = ringBase * (1 + 0.45 * noise.noise(Math.cos(th) * 1.7 + ox, Math.sin(th) * 1.7 + oy));
    let gap = 0;
    for (const a of angles) {
      let d = Math.abs(th - a) % (2 * Math.PI);
      if (d > Math.PI) d = 2 * Math.PI - d;
      gap += Math.exp(-(((d * rMean) / gapW) ** 2));
    }
    return rh - Math.abs(s - rh) - Math.min(1, gap) * (rh + 0.5);
  };

  const land = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) land[y * w + x] = macro(x, y) + 3.2 * wf(x, y);

  // Interior-sea and offshore islands.
  const isles = r.int(5, 9);
  for (let i = 0; i < isles; i++) {
    const inner = i < isles / 2;
    const ang = r.range(0, Math.PI * 2);
    const f = inner ? r.range(0.15, 0.7) : r.range(1.55, 1.9);
    const x = cx + Math.cos(ang) * rx * f;
    const y = cy + Math.sin(ang) * ry * f;
    if (x < 6 || y < 6 || x > w - 7 || y > h - 7) continue;
    addBump(land, w, h, x, y, r.range(1.5, 3.5), -macro(x, y) + r.range(1.2, 3));
  }

  // Meandering island straits: 1-3 tiles wide, guaranteed to stay open.
  const carves: Carve[] = angles.map((a) => {
    const rho1 = 1 / Math.hypot(Math.cos(a) / rx, Math.sin(a) / ry);
    const start = rho1 * 0.55;
    const end = rho1 + ringBase * 3 + 8;
    const wiggle = r.range(1, 2.2);
    const ph = r.range(0, 6);
    const pts: Vec2[] = [];
    for (let rho = start; rho <= end; rho += 1) {
      const lat = wiggle * Math.sin(rho * 0.35 + ph) * smoothstep(rho1 - 6, rho1 + 2, rho);
      pts.push({ x: cx + Math.cos(a) * rho - Math.sin(a) * lat, y: cy + Math.sin(a) * rho + Math.cos(a) * lat });
    }
    return { pts, radius: r.range(0.8, 1.5) };
  });

  return { land, carves, maxDepth: 1.05, depthScale: 16, shoalCount: r.int(14, 22) };
}

// ------------------------------------------------------------------ pipeline

function carveWater(isLand: Uint8Array, w: number, h: number, c: Carve) {
  const mark = (px: number, py: number) => {
    const r = Math.ceil(c.radius);
    for (let y = Math.max(0, Math.floor(py) - r); y <= Math.min(h - 1, Math.floor(py) + r + 1); y++) {
      for (let x = Math.max(0, Math.floor(px) - r); x <= Math.min(w - 1, Math.floor(px) + r + 1); x++) {
        if (Math.hypot(x - px, y - py) <= c.radius) isLand[y * w + x] = 0;
      }
    }
  };
  for (let i = 0; i < c.pts.length - 1; i++) {
    const a = c.pts[i];
    const b = c.pts[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.25));
    for (let s = 0; s <= steps; s++) mark(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps);
  }
}

/** 4-connected components of cells where `mask[i] === value`. */
function components(mask: Uint8Array, w: number, h: number, value: number): number[][] {
  const seen = new Uint8Array(mask.length);
  const comps: number[][] = [];
  for (let s = 0; s < mask.length; s++) {
    if (seen[s] || mask[s] !== value) continue;
    const cells = [s];
    seen[s] = 1;
    for (let q = 0; q < cells.length; q++) {
      const i = cells[q];
      const x = i % w;
      const tryPush = (j: number) => {
        if (!seen[j] && mask[j] === value) {
          seen[j] = 1;
          cells.push(j);
        }
      };
      if (x > 0) tryPush(i - 1);
      if (x < w - 1) tryPush(i + 1);
      if (i >= w) tryPush(i - w);
      if (i < w * h - w) tryPush(i + w);
    }
    comps.push(cells);
  }
  return comps;
}

export function generateMap(seed: string, archetype?: MapArchetype): MapData {
  const w = MAP_W;
  const h = MAP_H;
  const n = w * h;
  const rng = new Rng(seed);
  const arch = archetype ?? rng.fork('archetype').pick(ARCHETYPES);

  const noise = new Noise2D(rng.fork('noise'));
  const wf = (x: number, y: number) => {
    const f = 0.035;
    const qx = noise.fbm(x * f, y * f, 3);
    const qy = noise.fbm(x * f + 5.2, y * f + 1.3, 3);
    return noise.fbm(x * f + 4 * qx, y * f + 4 * qy, 5);
  };
  const ctx: BuildCtx = { w, h, rng, noise, wf };
  const macro = arch === 'CHOKEPOINT' ? buildChokepoint(ctx) : arch === 'CORRIDOR' ? buildCorridor(ctx) : buildRimland(ctx);

  // ---- land mask ---------------------------------------------------------------------
  const isLand = new Uint8Array(n);
  for (let i = 0; i < n; i++) isLand[i] = macro.land[i] > 0 ? 1 : 0;
  for (const c of macro.carves) carveWater(isLand, w, h, c);
  for (const cells of components(isLand, w, h, 1)) if (cells.length < 3) for (const i of cells) isLand[i] = 0;
  const waterComps = components(isLand, w, h, 0).sort((a, b) => b.length - a.length || a[0] - b[0]);
  for (let k = 1; k < waterComps.length; k++) for (const i of waterComps[k]) isLand[i] = 1; // fill lakes / stranded seas

  const isWater = new Uint8Array(n);
  for (let i = 0; i < n; i++) isWater[i] = isLand[i] ? 0 : 1;

  // ---- signed-distance bathymetry ---------------------------------------------------
  const dLand = distanceTransform(isLand, w, h);
  const dWater = distanceTransform(isWater, w, h);
  const bathy = rng.fork('bathymetry');
  const ox = bathy.range(0, 100);
  const oy = bathy.range(0, 100);
  const depth = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (isLand[i]) continue;
      const base = macro.maxDepth * (1 - Math.exp(-(dLand[i] - 0.5) / macro.depthScale));
      const trench = 1 + 0.35 * noise.fbm(x * 0.02 + ox, y * 0.02 + oy, 3);
      depth[i] = base * trench + 0.02 * noise.noise(x * 0.3 + ox, y * 0.3 + oy);
    }
  }
  // Shoals: seabed swells that push deep water into the hazardous littoral band.
  const shoalRng = rng.fork('shoals');
  for (let placed = 0, tries = 0; placed < macro.shoalCount && tries < 2000; tries++) {
    const i = shoalRng.int(0, n - 1);
    if (isLand[i] || dLand[i] < 2 || dLand[i] > 18) continue;
    const cx = i % w;
    const cy = Math.floor(i / w);
    const sigma = shoalRng.range(1.8, 5);
    const amp = shoalRng.range(0.3, 0.7);
    for (let y = Math.max(0, Math.floor(cy - sigma * 3)); y <= Math.min(h - 1, Math.ceil(cy + sigma * 3)); y++) {
      for (let x = Math.max(0, Math.floor(cx - sigma * 3)); x <= Math.min(w - 1, Math.ceil(cx + sigma * 3)); x++) {
        if (!isLand[y * w + x]) depth[y * w + x] -= amp * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma));
      }
    }
    placed++;
  }
  // One masked smoothing pass (water-only so channels never merge with land signs).
  const smoothed = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (isLand[i]) continue;
      let sum = 0;
      let wt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || isLand[yy * w + xx]) continue;
          const k = dx === 0 && dy === 0 ? 2 : 1;
          sum += depth[yy * w + xx] * k;
          wt += k;
        }
      }
      smoothed[i] = sum / wt;
    }
  }
  const elevation = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    elevation[i] = isLand[i] ? 0.03 + 0.05 * Math.min(10, dWater[i] - 1) : -clamp(smoothed[i], 0.012, 1.6);
  }

  // ---- vector extraction --------------------------------------------------------------
  const coastlines = extractContours(elevation, w, h, 0, { minPoints: 4, smooth: 2 });
  const isolines: IsolineSet[] = [-0.15, -0.35, -0.6, -0.9].map((level) => ({
    level,
    tier: tierOf(level - 0.001),
    lines: extractContours(elevation, w, h, level, { minPoints: 8, smooth: 2 }),
  }));

  // ---- sectors & chokepoints ----------------------------------------------------------
  const clearance = dLand;
  const sec = designateSectors({ w, h, water: isWater, clearance, elevation, rng: rng.fork('sectors') });

  const homePort = pickHomePort(arch, sec.sectors, sec.sectorGrid, clearance, w, h);

  let water = 0;
  let lit = 0;
  let shelf = 0;
  let abys = 0;
  for (let i = 0; i < n; i++) {
    if (isLand[i]) continue;
    water++;
    if (elevation[i] >= LITTORAL_FLOOR) lit++;
    else if (elevation[i] >= SHELF_FLOOR) shelf++;
    else abys++;
  }
  const narrowest = sec.chokepoints.length ? Math.min(...sec.chokepoints.map((c) => c.widthTiles)) : 0;

  return {
    seed,
    archetype: arch,
    width: w,
    height: h,
    elevation,
    clearance,
    sectorGrid: sec.sectorGrid,
    coastlines: coastlines as Polyline[],
    isolines,
    sectorBorders: sec.borders,
    sectors: sec.sectors,
    chokepoints: sec.chokepoints,
    homePort,
    stats: {
      waterFraction: water / n,
      littoralFraction: lit / water,
      shelfFraction: shelf / water,
      abyssalFraction: abys / water,
      narrowestChokepointTiles: narrowest,
      fingerprint: fingerprint(elevation),
    },
  };
}

/** Sheltered anchorage: a coastal water cell in the home sector (west end, or the interior sea for rimlands). */
function pickHomePort(
  arch: MapArchetype,
  sectors: MapData['sectors'],
  grid: Int16Array,
  clearance: Float32Array,
  w: number,
  h: number,
): Vec2 {
  const eligible = sectors.filter((s) => s.kind !== 'STRAIT');
  const pool = eligible.length ? eligible : sectors;
  const home =
    arch === 'RIMLAND'
      ? [...pool].filter((s) => !s.touchesEdge).sort((a, b) => b.areaTiles - a.areaTiles)[0] ?? pool[0]
      : pool[0];
  let best: Vec2 = home.anchor;
  let bestD = Infinity;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== home.id || clearance[i] < 1.5 || clearance[i] > 3.5) continue;
    const d = ((i % w) - home.centroid.x) ** 2 + (Math.floor(i / w) - home.centroid.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { x: i % w, y: Math.floor(i / w) };
    }
  }
  return best;
}

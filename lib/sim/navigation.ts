/** Water-only A* with line-of-sight string pulling. */
import type { MapData, Vec2 } from '../types/map';

const SQRT2 = Math.SQRT2;

export function isWater(map: MapData, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height && map.elevation[y * map.width + x] <= 0;
}

/** Nearest navigable cell to a point (expanding square search). */
export function snapToWater(map: MapData, p: Vec2): Vec2 {
  const cx = Math.round(p.x);
  const cy = Math.round(p.y);
  if (isWater(map, cx, cy)) return { x: cx, y: cy };
  for (let r = 1; r < Math.max(map.width, map.height); r++) {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!isWater(map, cx + dx, cy + dy)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = { x: cx + dx, y: cy + dy }; }
      }
    }
    if (best) return best;
  }
  return { x: cx, y: cy };
}

/** Straight-line check that every sampled cell along a segment is water. */
function clearLine(map: MapData, a: Vec2, b: Vec2): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
  for (let s = 0; s <= steps; s++) {
    const t = steps === 0 ? 0 : s / steps;
    if (!isWater(map, Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t))) return false;
  }
  return true;
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() { return this.keys.length; }
  push(key: number, val: number) {
    let i = this.keys.length;
    this.keys.push(key);
    this.vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      [this.keys[p], this.keys[i]] = [this.keys[i], this.keys[p]];
      [this.vals[p], this.vals[i]] = [this.vals[i], this.vals[p]];
      i = p;
    }
  }
  pop(): number {
    const top = this.vals[0];
    const lk = this.keys.pop()!;
    const lv = this.vals.pop()!;
    if (this.keys.length) {
      this.keys[0] = lk;
      this.vals[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.keys.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        [this.keys[m], this.keys[i]] = [this.keys[i], this.keys[m]];
        [this.vals[m], this.vals[i]] = [this.vals[i], this.vals[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Route between two world points over water. `avoidLittoral` (deep-draft groups) makes shoals expensive;
 * every route mildly prefers open water so groups do not hug coastlines.
 */
export function findRoute(map: MapData, from: Vec2, to: Vec2, avoidLittoral: boolean): Vec2[] {
  const w = map.width;
  const h = map.height;
  const s = snapToWater(map, from);
  const g = snapToWater(map, to);
  const start = s.y * w + s.x;
  const goal = g.y * w + g.x;
  if (start === goal) return [g];

  const cost = new Float32Array(w * h).fill(Infinity);
  const prev = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const heap = new MinHeap();
  const heur = (i: number) => {
    const dx = Math.abs((i % w) - g.x);
    const dy = Math.abs(Math.floor(i / w) - g.y);
    return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
  };
  cost[start] = 0;
  heap.push(heur(start), start);

  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!isWater(map, nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (!isWater(map, cx + dx, cy) || !isWater(map, cx, cy + dy))) continue; // no corner cutting
        const ni = ny * w + nx;
        if (closed[ni]) continue;
        const e = map.elevation[ni];
        let step = dx !== 0 && dy !== 0 ? SQRT2 : 1;
        if (e >= -0.15) step += avoidLittoral ? 5 : 0.6;
        else if (map.clearance[ni] < 3) step += 0.3;
        const c = cost[cur] + step;
        if (c < cost[ni]) {
          cost[ni] = c;
          prev[ni] = cur;
          heap.push(c + heur(ni), ni);
        }
      }
    }
  }
  if (prev[goal] < 0) return [g];

  const cells: Vec2[] = [];
  for (let i = goal; i !== -1; i = prev[i]) cells.push({ x: i % w, y: Math.floor(i / w) });
  cells.reverse();

  // String pulling: skip waypoints with clear line of sight.
  const out: Vec2[] = [];
  let anchor = 0;
  while (anchor < cells.length - 1) {
    let far = anchor + 1;
    for (let k = cells.length - 1; k > anchor + 1; k--) {
      if (clearLine(map, cells[anchor], cells[k])) { far = k; break; }
    }
    out.push(cells[far]);
    anchor = far;
  }
  return out;
}

/** Deterministic string-seeded PRNG (xmur3 hash -> Mulberry32). */

export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly gen: () => number;
  constructor(public readonly seed: string) {
    this.gen = mulberry32(hashString(seed));
  }
  /** Uniform [0,1). */
  next(): number {
    return this.gen();
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.gen();
  }
  /** Inclusive integer range. */
  int(min: number, max: number): number {
    return min + Math.floor(this.gen() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.gen() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.gen() * items.length)];
  }
  gaussian(): number {
    const u = Math.max(1e-9, this.gen());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.gen());
  }
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.gen() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
  /** Independent child stream: adding a new consumer never perturbs existing streams. */
  fork(label: string): Rng {
    return new Rng(`${this.seed}::${label}`);
  }
}

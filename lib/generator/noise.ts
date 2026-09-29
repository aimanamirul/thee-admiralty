import { Rng } from './prng';

/** Seeded 2D Perlin gradient noise with fBm and domain warping helpers. */
export class Noise2D {
  private readonly perm = new Uint8Array(512);
  private static readonly GRAD = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071],
  ];

  constructor(rng: Rng) {
    const p = Array.from({ length: 256 }, (_, i) => i);
    rng.shuffle(p);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Roughly [-1, 1]. */
  noise(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    const g = (h: number, dx: number, dy: number) => {
      const v = Noise2D.GRAD[h & 7];
      return v[0] * dx + v[1] * dy;
    };
    const aa = this.perm[this.perm[X] + Y];
    const ab = this.perm[this.perm[X] + Y + 1];
    const ba = this.perm[this.perm[X + 1] + Y];
    const bb = this.perm[this.perm[X + 1] + Y + 1];
    const u = fade(xf);
    const v = fade(yf);
    const x1 = g(aa, xf, yf) * (1 - u) + g(ba, xf - 1, yf) * u;
    const x2 = g(ab, xf, yf - 1) * (1 - u) + g(bb, xf - 1, yf - 1) * u;
    return (x1 * (1 - v) + x2 * v) * 1.41;
  }

  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

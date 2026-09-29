/** Determinism + sanity checks for the procedural generator. Usage: npm run verify:map [-- --ascii] */
import { ARCHETYPES, generateMap } from '../lib/generator/seedMap';
import { tierOf } from '../lib/types/map';

const ascii = process.argv.includes('--ascii');
const seeds = ['ADMIRALTY-001', 'Trafalgar', 'kraken', 'x', '2026-09-29'];
let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};

for (const arch of ARCHETYPES) {
  for (const seed of seeds) {
    const t0 = performance.now();
    const a = generateMap(seed, arch);
    const ms = performance.now() - t0;
    const b = generateMap(seed, arch);
    const other = generateMap(seed + '!', arch);
    const { w, h } = { w: a.width, h: a.height };

    console.log(
      `${arch.padEnd(10)} ${seed.padEnd(14)} ${ms.toFixed(0).padStart(4)}ms fp=${a.stats.fingerprint} ` +
        `water=${(a.stats.waterFraction * 100).toFixed(0)}% lit=${(a.stats.littoralFraction * 100).toFixed(0)}% ` +
        `shelf=${(a.stats.shelfFraction * 100).toFixed(0)}% abys=${(a.stats.abyssalFraction * 100).toFixed(0)}% ` +
        `sectors=${a.sectors.length} choke=[${a.chokepoints.map((c) => c.widthTiles).join(',')}]`,
    );

    check(a.stats.fingerprint === b.stats.fingerprint, 'same seed must reproduce identical elevation');
    check(JSON.stringify(a.sectors) === JSON.stringify(b.sectors), 'same seed must reproduce identical sectors');
    check(a.stats.fingerprint !== other.stats.fingerprint, 'different seed must differ');

    // single connected water body (4-neighbourhood)
    let start = -1;
    let water = 0;
    for (let i = 0; i < a.elevation.length; i++) if (a.elevation[i] <= 0) { water++; if (start < 0) start = i; }
    const seen = new Uint8Array(a.elevation.length);
    const q = [start];
    seen[start] = 1;
    for (let k = 0; k < q.length; k++) {
      const i = q[k];
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * h - w ? i + w : -1]) {
        if (j >= 0 && !seen[j] && a.elevation[j] <= 0) { seen[j] = 1; q.push(j); }
      }
    }
    check(q.length === water, `water must be one connected body (${q.length}/${water})`);
    check(a.sectors.length >= 4 && a.sectors.length <= 12, `sector count ${a.sectors.length} out of range`);
    check(a.stats.littoralFraction > 0.02 && a.stats.abyssalFraction > 0.02, 'all bathymetric tiers should be represented');
    check(a.coastlines.length > 0 && a.isolines.every((s) => s.lines.length >= 0), 'vectors extracted');
    check(a.chokepoints.length >= 1, 'at least one chokepoint');
    if (arch === 'CHOKEPOINT') {
      check(a.stats.narrowestChokepointTiles >= 1 && a.stats.narrowestChokepointTiles <= 3, `neck width ${a.stats.narrowestChokepointTiles} not in 1..3`);
    }
    if (arch === 'RIMLAND') check(a.chokepoints.length >= 2, `rimland should expose >=2 island straits (${a.chokepoints.length})`);
    // every sector anchor is water inside its own sector
    for (const s of a.sectors) check(a.sectorGrid[s.anchor.y * w + s.anchor.x] === s.id, `anchor of sector ${s.id} not inside it`);
    check(a.sectorGrid[a.homePort.y * w + a.homePort.x] >= 0, 'home port must be on water');

    if (ascii && seed === seeds[0]) {
      console.log(a.sectors.map((s) => `  ${s.name} area=${s.areaTiles} lit=${(s.littoralFraction * 100).toFixed(0)}%`).join('\n'));
      const glyph = '0123456789ABCDEF';
      for (let y = 0; y < h; y += 2) {
        let row = '';
        for (let x = 0; x < w; x += 1) {
          const i = y * w + x;
          const t = tierOf(a.elevation[i]);
          row += t === 'LAND' ? '#' : a.sectorGrid[i] >= 0 ? glyph[a.sectorGrid[i] % 16] : '?';
        }
        console.log(row);
      }
    }
  }
}
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

/**
 * Save / load / catch-up: a restored game continues exactly like the original, bad saves are rejected, the tutorial's custom map
 * is restored, and the digest reports what the numbers and the ledger prove. Usage: npm run verify:save
 */
import { catchUpDaysFor, CATCH_UP_MAX_DAYS, makeSave, readSave, restoreWorld, SAVE_KEY, SAVE_VERSION, summarize, writeSave } from '../lib/save';
import * as cmd from '../lib/sim/commands';
import { bottlenecksOf, buildDigest, snapshotOf } from '../lib/sim/digest';
import { allTaskForces } from '../lib/sim/fleetEngine';
import { createInitialWorld } from '../lib/sim/scenario';
import { createTutorialWorld } from '../lib/sim/tutorialScenario';
import { advanceDay } from '../lib/sim/worldEngine';
import type { GameEvent, WorldDraft } from '../lib/types/world';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};
class Mem {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}
const strip = (w: WorldDraft) => JSON.stringify({ ...w, map: undefined, events: undefined });
const days = (w: WorldDraft, n: number) => {
  for (let i = 0; i < n; i++) {
    advanceDay(w);
    w.events = [];
  }
};

// ---- a restored game continues exactly like the original
for (const arch of ['CHOKEPOINT', 'CORRIDOR', 'RIMLAND'] as const) {
  const a = createInitialWorld('save-check', arch);
  cmd.setRoe(a, 1, 'WEAPONS_FREE');
  cmd.assignTaskForce(a, allTaskForces(a.fleets)[1].id, 1);
  days(a, 90);
  const mem = new Mem();
  check(writeSave(makeSave(a, [], 0, []), mem), `${arch}: save written`);
  const raw = mem.getItem(SAVE_KEY)!;
  const b = restoreWorld(readSave(mem)!);
  check(strip(a) === strip(b), `${arch}: a restored world is identical to the saved one`);
  check(b.map.stats.fingerprint === a.map.stats.fingerprint, `${arch}: the regenerated map matches`);
  days(a, 120);
  days(b, 120);
  check(strip(a) === strip(b), `${arch}: 120 days after restoring, the game is identical to the one that never stopped`);
  console.log(`${arch.padEnd(10)} save ${(raw.length / 1024).toFixed(0)} KB, ${Object.keys(a.ships).length} hulls, day ${a.tick}`);
  check(raw.length < 1_500_000, `${arch}: a save stays small (${(raw.length / 1024).toFixed(0)} KB)`);
}

// ---- the briefing's custom map is restored (a finished briefing becomes a free-play game)
{
  const t = createTutorialWorld();
  t.scripted = false;
  const mem = new Mem();
  writeSave(makeSave(t, [], 0, []), mem);
  const r = restoreWorld(readSave(mem)!);
  check(r.map.sectors.length === 2 && r.map.sectors[0].name === t.map.sectors[0].name, 'the two-sector briefing map is restored, not a generated one');
  check(strip(t) === strip(r), 'a continued briefing world is identical');
}

// ---- rejection and tolerance
{
  const mem = new Mem();
  check(readSave(mem) === null, 'no save: null');
  mem.setItem(SAVE_KEY, '{not json');
  check(readSave(mem) === null, 'corrupt JSON is rejected, not thrown');
  const good = makeSave(createInitialWorld('x', 'CORRIDOR'), [], 0, []);
  mem.setItem(SAVE_KEY, JSON.stringify({ ...good, version: SAVE_VERSION + 1 }));
  check(readSave(mem) === null, 'a save from another version is rejected');
  mem.setItem(SAVE_KEY, JSON.stringify({ ...good, world: { ...good.world, tick: 'x' } }));
  check(readSave(mem) === null, 'a save with a broken world is rejected');
  check(writeSave(good, { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} }) === false, 'a full or blocked storage fails quietly');
  // a save written before shipping existed still loads
  const old = makeSave(createInitialWorld('old', 'CORRIDOR'), [], 0, []);
  delete (old.world as Partial<typeof old.world>).shipping;
  const w = restoreWorld(old);
  check(!!w.shipping && w.shipping.index === 100, 'fields added since a save was written are filled in');
}

// ---- catch-up allowance
{
  const m = 60_000;
  check(catchUpDaysFor(0) === 0 && catchUpDaysFor(5 * m) === 0, 'a short absence earns no catch-up (under 3 days)');
  check(catchUpDaysFor(6 * m) === 3 && catchUpDaysFor(20 * m) === 10, 'one day per two minutes away');
  check(catchUpDaysFor(24 * 60 * m) === CATCH_UP_MAX_DAYS && catchUpDaysFor(1e12) === CATCH_UP_MAX_DAYS, `capped at ${CATCH_UP_MAX_DAYS} days`);
  const base = createInitialWorld('s', 'CORRIDOR');
  const s = summarize(makeSave(base, [], 0, [], 1000), 1000 + 20 * m);
  check(s.catchUpDays === 10 && s.ships === Object.keys(base.ships).length && s.fiscalYear === 1, 'summary reports the days a catch-up would run');
}

// ---- digest
{
  const w = createInitialWorld('digest', 'CHOKEPOINT');
  const before = snapshotOf(w);
  const log: GameEvent[] = [];
  let seq = 0;
  const victim = Object.values(w.ships)[4];
  for (let d = 0; d < 40; d++) {
    advanceDay(w);
    if (d === 20) {
      delete w.ships[victim.id];
      for (const f of w.fleets) for (const t of f.taskForces) for (const sq of t.squadrons) sq.shipIds = sq.shipIds.filter((i) => i !== victim.id);
      w.stats.shipsLost++;
      w.events.push({ severity: 'CRITICAL', text: `LOST: ${victim.pennant} ${victim.name.toUpperCase()} sunk in action` });
    }
    for (const e of w.events) log.push({ id: ++seq, tick: w.tick, severity: e.severity, text: e.text });
    w.events = [];
  }
  const dg = buildDigest(before, w, log);
  check(dg.days === 40 && dg.fromTick === 0 && dg.toTick === 40, 'digest covers the right span');
  check(dg.summary.some((l) => /Budget .* → /.test(l)) && dg.summary.some((l) => /support/i.test(l)) && dg.summary.some((l) => /Shipping:/.test(l)), 'digest states budget, support and shipping');
  check(dg.losses.length === 1 && dg.losses[0].includes(victim.name.toUpperCase()), `the lost ship is named (${dg.losses[0]})`);
  check(dg.highlights.length > 0 && dg.highlights.length <= 10 && dg.highlights.every((h) => /^Day \d+:/.test(h)), 'highlights are dated and capped');
  check(dg.highlights.some((h) => /LOST:/.test(h)), 'a loss is among the highlights');
  // bottlenecks come from the world itself
  const calm = createInitialWorld('calm', 'CORRIDOR');
  check(bottlenecksOf(calm).length === 0, `a fresh navy has no bottlenecks (${bottlenecksOf(calm).join('; ')})`);
  const bad = createInitialWorld('bad', 'CORRIDOR');
  bad.resources.budget = 5;
  bad.politics.support = 30;
  bad.vendors.RAYTHEON.status = 'FROZEN';
  for (const f of bad.fleets) for (const t of f.taskForces) t.assignedSectorId = null;
  for (const st of Object.values(bad.sectors)) st.threat = 80;
  const b = bottlenecksOf(bad).join('\n');
  check(/under 30 days/.test(b) && /under sanction/.test(b) && /support 30/.test(b) && /no task force assigned/.test(b), `bottlenecks name budget, sanctions, support and uncovered threat:\n${b}`);
}

console.log(failures === 0 ? '\nSAVE OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

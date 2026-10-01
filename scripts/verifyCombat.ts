/**
 * Raid damage: crippled, not deleted. Hulls hit hard are left afloat at a floor and break off for repair; only heavy overkill (or a hull
 * already crippled) is sunk. Usage: npm run verify:combat
 */
import { Rng } from '../lib/generator/prng';
import { CRIPPLED_FLOOR, sinkChance, WITHDRAW_BELOW } from '../lib/sim/combatSim';
import { tickContacts } from '../lib/sim/contactEngine';
import { allTaskForces, taskForceShipIds } from '../lib/sim/fleetEngine';
import { bridgeSet } from '../lib/sim/researchEngine';
import { createTutorialWorld, HOME_SECTOR } from '../lib/sim/tutorialScenario';
import { advanceDay } from '../lib/sim/worldEngine';
import type { WorldDraft } from '../lib/types/world';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

// ---- the sinking curve
check(sinkChance(100, 0) === 0 && sinkChance(100, 99) === 0 && sinkChance(100, 100) === 0, 'a ship that survives needs no roll');
check(near(sinkChance(100, 110), 0.029) && near(sinkChance(100, 150), 0.143) && near(sinkChance(100, 250), 0.429) && near(sinkChance(100, 350), 0.714), 'overkill curve: 1.1x 3%, 1.5x 14%, 2.5x 43%, 3.5x 71%');
check(sinkChance(100, 5000) === 0.9, 'never certain');
check(sinkChance(100, 200) < sinkChance(100, 300), 'monotonic');
check(sinkChance(20, 30) > sinkChance(100, 150) - 0.01 && sinkChance(20, 30) > 0, 'a crippled hull is lost to a smaller hit than a healthy one');

// ---- full engagement through the contact engine: a raider in range of a task force
const base = createTutorialWorld();
const tfId = (name: 'TF-1' | 'TF-2') => allTaskForces(base.fleets).find((t) => t.id === name)!.id;
function raid(strength: number, tf: 'TF-1' | 'TF-2', n: number, prep?: (w: WorldDraft) => void) {
  const out = { n, anySunk: 0, sunk: 0, crippled: 0, withdrew: 0, badIntegrity: 0, ships: 0, sample: null as WorldDraft | null };
  for (let t = 0; t < n; t++) {
    const w = structuredClone(base) as WorldDraft;
    w.map = base.map;
    w.events = [];
    prep?.(w);
    // Both task forces start in the same port cell: move the other one away so the raider meets the one under test.
    for (const other of allTaskForces(w.fleets)) if (other.id !== tfId(tf)) other.position = { x: -500, y: -500 };
    const group = allTaskForces(w.fleets).find((x) => x.id === tfId(tf))!;
    const before = taskForceShipIds(group).filter((id) => w.ships[id] && w.ships[id].state !== 'MAINTENANCE_DOCK');
    w.contacts.push({ id: `CT-R${t}`, sectorId: HOME_SECTOR, position: { x: group.position.x + 5, y: group.position.y }, heading: 0, cls: 'HOSTILE', hostile: true, intent: 'RAIDER', strength, bornTick: 0, expiresTick: 40 });
    tickContacts(w, new Rng(`raid${strength}${tf}${t}`), bridgeSet([]));
    const lost = before.filter((id) => !w.ships[id]).length;
    out.ships += before.length;
    out.sunk += lost;
    if (lost) out.anySunk++;
    for (const id of before) {
      const s = w.ships[id];
      if (!s) continue;
      if (s.integrity <= 0 || s.integrity > 100) out.badIntegrity++;
      if (s.integrity <= CRIPPLED_FLOOR + 1e-9) out.crippled++;
      if (s.integrity < WITHDRAW_BELOW) {
        if (s.state === 'MAINTENANCE_DOCK') out.withdrew++;
        else out.badIntegrity++; // a badly damaged ship must not stay at sea
        out.sample ??= w;
      }
    }
  }
  return out;
}
const N = 200;
const weak = raid(20, 'TF-2', N);
const mid = raid(45, 'TF-2', N);
const heavy = raid(70, 'TF-2', N);
const frig = raid(70, 'TF-1', N);
console.log(`FAC pair   str 20: ${(weak.anySunk / N * 100).toFixed(0)}% lose a hull (${(weak.sunk / N).toFixed(2)}/raid), ${weak.crippled} crippled, ${weak.withdrew} sent to repair`);
console.log(`FAC pair   str 45: ${(mid.anySunk / N * 100).toFixed(0)}% lose a hull (${(mid.sunk / N).toFixed(2)}/raid), ${mid.crippled} crippled, ${mid.withdrew} sent to repair`);
console.log(`FAC pair   str 70: ${(heavy.anySunk / N * 100).toFixed(0)}% lose a hull (${(heavy.sunk / N).toFixed(2)}/raid), ${heavy.crippled} crippled, ${heavy.withdrew} sent to repair`);
console.log(`frigates   str 70: ${(frig.anySunk / N * 100).toFixed(0)}% lose a hull, ${frig.withdrew} sent to repair`);
check(weak.anySunk / N < 0.15, `a weak raid rarely sinks a FAC (${(weak.anySunk / N * 100).toFixed(0)}%; it was 68% before)`);
check(weak.withdrew > 0 && weak.crippled > 0, 'a weak raid cripples FACs and sends them to repair');
check(mid.sunk / N < 0.8 && mid.withdrew > mid.sunk, `a mid raid mostly cripples (${mid.withdrew} to repair vs ${mid.sunk} sunk)`);
check(heavy.sunk > mid.sunk * 0.9 && heavy.anySunk / N > mid.anySunk / N - 0.02, 'a heavier raid is deadlier');
check(frig.sunk === 0, 'a frigate group with air defence loses nothing to the same raid');
check(weak.badIntegrity + mid.badIntegrity + heavy.badIntegrity + frig.badIntegrity === 0, 'no hull ends at or below 0, and no badly damaged hull stays at sea');
check(!!heavy.sample && /returns to dock for repair/.test(heavy.sample.events.map((e) => e.text).join('\n')), 'the ledger says the ship breaks off for repair');

// ---- a crippled ship recovers in dock and returns to service
{
  const w = structuredClone(base) as WorldDraft;
  w.map = base.map;
  const fac = taskForceShipIds(allTaskForces(w.fleets).find((t) => t.id === 'TF-2')!).map((id) => w.ships[id])[0];
  fac.integrity = CRIPPLED_FLOOR;
  fac.state = 'MAINTENANCE_DOCK';
  fac.stateDays = 0;
  let d = 0;
  while ((fac.state === 'MAINTENANCE_DOCK' || fac.integrity < 90) && d++ < 120) advanceDay(w);
  check(fac.integrity >= 90 && fac.state !== 'MAINTENANCE_DOCK', `repairs finish (${d} days, integrity ${fac.integrity.toFixed(0)}%)`);
  check(d > 30 && d < 90, `repair takes weeks, not days or years (${d})`);
  console.log(`crippled FAC back in service after ${d} days`);
}

// ---- a hull that is already crippled and still at sea can be lost
{
  let sunk = 0;
  const T = 200;
  for (let t = 0; t < T; t++) {
    const w = structuredClone(base) as WorldDraft;
    w.map = base.map;
    const group = allTaskForces(w.fleets).find((x) => x.id === 'TF-2')!;
    for (const other of allTaskForces(w.fleets)) if (other.id !== 'TF-2') other.position = { x: -500, y: -500 };
    const ids = taskForceShipIds(group);
    for (const id of ids) w.ships[id].integrity = 20;
    w.contacts.push({ id: `CT-C${t}`, sectorId: HOME_SECTOR, position: { x: group.position.x + 5, y: group.position.y }, heading: 0, cls: 'HOSTILE', hostile: true, intent: 'RAIDER', strength: 45, bornTick: 0, expiresTick: 40 });
    tickContacts(w, new Rng(`c${t}`), bridgeSet([]));
    sunk += ids.filter((id) => !w.ships[id]).length;
  }
  check(sunk / T > 0.5, `a ship already at 20% is lost far more readily (${(sunk / T).toFixed(2)} per raid)`);
}

console.log(failures === 0 ? '\nCOMBAT OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

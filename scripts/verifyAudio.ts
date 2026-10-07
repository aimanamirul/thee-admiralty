/**
 * Diegetic sound cues: the pure event -> cue mapping. Usage: npm run verify:audio
 */
import { CUE_PRIORITY, cueOf, cuesFor, MAX_CUES } from '../lib/audio/cues';
import { createTutorialWorld, HOME_SECTOR } from '../lib/sim/tutorialScenario';
import { tickContacts } from '../lib/sim/contactEngine';
import { allTaskForces } from '../lib/sim/fleetEngine';
import { bridgeSet } from '../lib/sim/researchEngine';
import { Rng } from '../lib/generator/prng';
import type { WorldDraft } from '../lib/types/world';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};
const ev = (severity: 'INFO' | 'ADVISORY' | 'WARNING' | 'CRITICAL' | 'COMBAT', text: string) => ({ severity, text });

check(cueOf(ev('INFO', 'TF 11 ordered to Sector 2')) === null, 'routine info is silent');
check(cueOf(ev('ADVISORY', 'FISCAL YEAR 2: appropriation')) === 'TELETYPE', 'advisory is a teletype');
check(cueOf(ev('WARNING', 'F979: heavy damage')) === 'ALERT', 'warning is an alert');
check(cueOf(ev('WARNING', 'CT-1: detected smuggler escapes the sector')) === 'SONAR', 'contact warning pings');
check(cueOf(ev('CRITICAL', 'ELECTION: collapse')) === 'ALARM', 'critical alarms');
check(cueOf(ev('CRITICAL', 'LOST: F1 X (Frigate) sunk')) === 'LOSS', 'a loss tolls');
check(cueOf(ev('COMBAT', 'ENGAGEMENT Sector 2 vs hostile str 90: DESTROYED')) === 'BATTLE', 'engagement header is a battle cue');
check(cueOf(ev('COMBAT', '  » 4 sea-skimmers are picked up')) === null, 'story lines are silent');
check(cueOf(ev('COMBAT', '  salvo 1: 3 shots')) === null, 'technical lines are silent');
check(cuesFor([]).length === 0, 'empty batch is silent');
const mixed = [ev('ADVISORY', 'a'), ev('WARNING', 'b'), ev('CRITICAL', 'c'), ev('COMBAT', 'ENGAGEMENT x'), ev('CRITICAL', 'LOST: y')];
const c = cuesFor(mixed);
check(c.length <= MAX_CUES && c[0] === 'LOSS' && c[1] === 'ALARM', `batch is capped and ordered by urgency (${c.join(',')})`);
check(cuesFor([ev('WARNING', 'a'), ev('WARNING', 'b'), ev('WARNING', 'c')]).length === 1, 'duplicates collapse');
check(new Set(CUE_PRIORITY).size === CUE_PRIORITY.length, 'priority list has no duplicates');

// real engagement through the engine produces a battle cue and nothing noisier than a loss
const base = createTutorialWorld();
const w = structuredClone(base) as WorldDraft;
w.map = base.map;
w.events = [];
for (const o of allTaskForces(w.fleets)) if (o.id !== 'TF-1') o.position = { x: -500, y: -500 };
const g = allTaskForces(w.fleets).find((x) => x.id === 'TF-1')!;
w.contacts.push({ id: 'CT-A', sectorId: HOME_SECTOR, position: { x: g.position.x + 5, y: g.position.y }, heading: 0, cls: 'HOSTILE', hostile: true, intent: 'RAIDER', strength: 90, bornTick: 0, expiresTick: 40 });
tickContacts(w, new Rng('audio'), bridgeSet([]));
const real = cuesFor(w.events);
check(real.includes('BATTLE') || real.includes('LOSS') || real.includes('ALARM'), `a real engagement is audible (${real.join(',')})`);

if (failures) {
  console.log(`\nAUDIO FAILED (${failures})`);
  process.exit(1);
}
console.log('AUDIO OK');

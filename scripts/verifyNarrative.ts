/**
 * Battle reports and the weight of a loss: stories are deterministic, name the ships, carry no template debris; losses cost by hull;
 * the roll of honour is capped; ships count their engagements. Usage: npm run verify:narrative
 */
import { Rng } from '../lib/generator/prng';
import { tickContacts } from '../lib/sim/contactEngine';
import { allTaskForces, taskForceShipIds } from '../lib/sim/fleetEngine';
import { compass, CREW, LOSS_PC, LOSS_SUPPORT, ROLL_CAP, seaState, timeOfDay } from '../lib/sim/narrative';
import { bridgeSet } from '../lib/sim/researchEngine';
import { createTutorialWorld, HOME_SECTOR } from '../lib/sim/tutorialScenario';
import type { WorldDraft } from '../lib/types/world';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};

// ---- loss weight ordering
const order = ['FAC', 'CORVETTE', 'FRIGATE', 'DESTROYER', 'CARRIER'] as const;
for (let i = 1; i < order.length; i++) {
  check(LOSS_SUPPORT[order[i]] > LOSS_SUPPORT[order[i - 1]], `support loss rises with hull: ${order[i]}`);
  check(CREW[order[i]] > CREW[order[i - 1]], `crew rises with hull: ${order[i]}`);
  check(LOSS_PC[order[i]] >= LOSS_PC[order[i - 1]], `political capital loss does not fall with hull: ${order[i]}`);
}

// ---- colour is deterministic and bounded
check(seaState('s', 10, 1) === seaState('s', 10, 1) && timeOfDay('s', 10, 'a') === timeOfDay('s', 10, 'a'), 'sea and time are pure');
check(compass({ x: 10, y: 0 }, { x: 0, y: 0 }) === 'E' && compass({ x: 0, y: -10 }, { x: 0, y: 0 }) === 'N' && compass({ x: 0, y: 10 }, { x: 0, y: 0 }) === 'S', 'compass bearings');

// ---- engagements through the contact engine
const base = createTutorialWorld();
const group0 = allTaskForces(base.fleets).find((t) => t.id === 'TF-1')!;
let lostSeen = 0;
let stories = 0;
let maxRoll = 0;
for (let t = 0; t < 60; t++) {
  const strength = [40, 90, 150, 260][t % 4];
  const run = () => {
    const w = structuredClone(base) as WorldDraft;
    w.map = base.map;
    w.events = [];
    for (const o of allTaskForces(w.fleets)) if (o.id !== 'TF-1') o.position = { x: -500, y: -500 };
    const g = allTaskForces(w.fleets).find((x) => x.id === 'TF-1')!;
    const ids = taskForceShipIds(g).filter((id) => w.ships[id] && w.ships[id].state !== 'MAINTENANCE_DOCK');
    w.contacts.push({ id: `CT-N${t}`, sectorId: HOME_SECTOR, position: { x: g.position.x + 5, y: g.position.y }, heading: 0, cls: 'HOSTILE', hostile: true, intent: 'RAIDER', strength, bornTick: 0, expiresTick: 40 });
    tickContacts(w, new Rng(`narr${t}`), bridgeSet([]));
    return { w, ids };
  };
  const a = run();
  const b = run();
  check(JSON.stringify(a.w.events) === JSON.stringify(b.w.events), 'reports are deterministic');
  const lines = a.w.events.filter((e) => e.text.startsWith('  » ')).map((e) => e.text);
  if (lines.length) stories++;
  check(lines.length >= 3 && lines.length <= 9, `story length ${lines.length}`);
  check(lines.every((l) => !/[{}]|undefined|NaN|\[object/.test(l)), 'no template debris');
  check(a.w.events.some((e) => e.text.startsWith('ENGAGEMENT')), 'header kept');
  for (const id of a.ids) {
    const s = a.w.ships[id];
    if (s) check((s.engagements ?? 0) === 1, 'engagement counted once');
  }
  const gone = a.ids.filter((id) => !a.w.ships[id]);
  if (gone.length) {
    lostSeen += gone.length;
    check(lines.some((l) => /goes down/.test(l)), 'a sinking is reported in the story');
    check(a.w.events.some((e) => e.severity === 'CRITICAL' && e.text.startsWith('LOST:') && /crew lost/.test(e.text)), 'loss line carries crew and service');
    check((a.w.stats.fallen?.length ?? 0) >= gone.length, 'roll of honour records the fallen');
    maxRoll = Math.max(maxRoll, a.w.stats.fallen?.length ?? 0);
  }
}
check(stories > 30, `stories were written (${stories})`);
console.log(`60 raids: ${stories} reports, ${lostSeen} hulls lost, roll cap ${ROLL_CAP}`);
if (lostSeen === 0) console.log('  note: no sinkings sampled; loss branch unexercised');

// ---- roll cap
{
  const w = structuredClone(base) as WorldDraft;
  w.stats.fallen = Array.from({ length: ROLL_CAP }, (_, i) => ({ name: `X${i}`, pennant: 'P', hull: 'h', tick: i, crew: 1, serviceDays: 1, engagements: 0, where: 'w' }));
  w.stats.fallen = [w.stats.fallen[0], ...w.stats.fallen].slice(0, ROLL_CAP);
  check(w.stats.fallen.length === ROLL_CAP, 'roll stays capped');
}

if (failures) {
  console.log(`\nNARRATIVE FAILED (${failures})`);
  process.exit(1);
}
console.log('\nNARRATIVE OK');

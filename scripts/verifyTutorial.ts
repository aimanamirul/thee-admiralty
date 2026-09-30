/**
 * Headless walk-through of the Admiral's Briefing: for each lesson apply onEnter, perform the intended action with the
 * real commands, advance days until the gate opens. Fails on soft-locks, gates that open early, lost ships, etc.
 */
import { LESSONS, PRESET_FIX_PLANT, TUTORIAL_PRESET, type TutorialView } from '../lib/tutorial/lessons';
import * as cmd from '../lib/sim/commands';
import { evaluateLoadout } from '../lib/sim/designEngine';
import { designateHulk, stateCounts } from '../lib/sim/fleetEngine';
import { bridgeSet } from '../lib/sim/researchEngine';
import { createTutorialMap, createTutorialWorld, waterConnected, HOME_SECTOR, BEYOND_SECTOR } from '../lib/sim/tutorialScenario';
import { advanceDay } from '../lib/sim/worldEngine';
import type { GameEvent } from '../lib/types/world';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};

// ---- map checks
const map = createTutorialMap();
check(map.sectors.length === 2, 'tutorial map must have exactly 2 sectors');
check(map.chokepoints.length === 1 && map.chokepoints[0].name === 'THE NARROWS', 'single chokepoint THE NARROWS');
check(waterConnected(map, map.homePort, map.sectors[1].anchor), 'route from port to sector 2');
check(map.sectorGrid[map.homePort.y * map.width + map.homePort.x] === HOME_SECTOR, 'home port inside sector 1');

// ---- play through
const w = createTutorialWorld();
const log: GameEvent[] = [];
let seq = 0;
const flush = () => {
  for (const e of w.events) log.push({ id: ++seq, tick: w.tick, severity: e.severity, text: e.text });
  w.events = [];
};
flush();
let selectedSectorId: number | null = null;
let startSeq = 0;
const view = (): TutorialView => ({
  tick: w.tick, map: w.map, selectedSectorId, sectors: w.sectors, fleets: w.fleets, ships: w.ships, vendors: w.vendors,
  research: w.research, resources: w.resources, spares: w.spares, running: true, log, startSeq,
});
const ok = (r: { ok: boolean; reason?: string }, what: string) => check(r.ok, `${what}: ${r.reason ?? ''}`);

const actions: Record<string, () => void> = {
  plot: () => { selectedSectorId = 0; },
  sectors: () => ok(cmd.setRoe(w, HOME_SECTOR, 'RETURN_FIRE'), 'setRoe'),
  station: () => ok(cmd.assignTaskForce(w, 'TF-1', HOME_SECTOR), 'assign TF-1'),
  command: () => ok(cmd.renameNode(w, 'TASKFORCE', 'TF-1', 'Anvil Force'), 'rename'),
  thirds: () => {},
  contact: () => {
    // Every ROE choice must be survivable: later lessons need all six hulls.
    for (const roe of ['HOLD_FIRE', 'RETURN_FIRE', 'WEAPONS_FREE'] as const) {
      const c = structuredClone(w);
      c.events = [];
      cmd.setRoe(c, HOME_SECTOR, roe);
      let outcome = '';
      for (let d = 0; d < 60 && !outcome; d++) {
        advanceDay(c);
        outcome = c.events.find((e) => e.text.startsWith('ENGAGEMENT'))?.text ?? '';
        if (outcome && process.env.DEBUG_RAID) for (const e of c.events.filter((x) => x.severity === 'COMBAT')) console.log(`     ${roe}: ${e.text.trim()}`);
        c.events = [];
      }
      check(!!outcome, `[contact/${roe}] no engagement within 60 days`);
      check(c.stats.shipsLost === 0, `[contact/${roe}] lost ${c.stats.shipsLost} ship(s)`);
      // The merchant teaches the WEAPONS FREE trade-off: exactly that ROE produces the incident.
      check(c.stats.incidents === (roe === 'WEAPONS_FREE' ? 1 : 0), `[contact/${roe}] incidents ${c.stats.incidents}`);
      console.log(`  contact under ${roe.padEnd(12)} -> ${outcome.replace(/^.*: /, '')}, incidents ${c.stats.incidents}, PC ${c.resources.politicalCapital.toFixed(1)}`);
    }
    ok(cmd.setRoe(w, HOME_SECTOR, 'RETURN_FIRE'), 'choose ROE');
  },
  spares: () => ok(cmd.buySpares(w, 'SEN_DOM_DSR2', 1), 'buy spare'),
  design: () => {
    const bad = evaluateLoadout(TUTORIAL_PRESET.hullId, TUTORIAL_PRESET.moduleIds, bridgeSet([]));
    check(!bad.valid && bad.errors.some((e) => e.includes('POWER')), 'preset must fail on the power grid');
    const fixed = TUTORIAL_PRESET.moduleIds.map((m) => (m === 'PP_DOM_D6' ? PRESET_FIX_PLANT : m));
    const good = evaluateLoadout(TUTORIAL_PRESET.hullId, fixed, bridgeSet([]));
    check(good.valid, `fixed preset must be valid: ${good.errors.join(';')}`);
    check(good.frictionIndex > 0, 'fixed preset must show integration friction');
    ok(cmd.orderShip(w, { designName: TUTORIAL_PRESET.name, hullId: 'CORVETTE', moduleIds: fixed, squadronId: 'SQ-1-2', tradition: 'VIRTUES' }), 'order ship');
  },
  friction: () => {
    ok(cmd.startResearch(w, 'BR_L16_TAC'), 'start bridge');
  },
  sanctions: () => ok(cmd.lobbyVendorCmd(w, 'ASELSAN', 'MIN_FOREIGN'), 'lobby'),
  embargo: () => ok(designateHulk(w, 'SHP-6'), 'designate hulk'),
  graduation: () => {
    check(!w.scripted, 'graduation must turn scripted off');
    ok(cmd.assignTaskForce(w, 'TF-2', BEYOND_SECTOR), 'assign TF-2');
  },
};

for (const lesson of LESSONS) {
  lesson.onEnter?.(w);
  flush();
  startSeq = seq;
  check(!lesson.gate(view()), `[${lesson.id}] gate must be closed on entry`);
  actions[lesson.id]?.();
  flush();
  let days = 0;
  while (!lesson.gate(view()) && days < 400) {
    advanceDay(w);
    flush();
    days++;
  }
  check(lesson.gate(view()), `[${lesson.id}] gate never opened (soft-lock) after ${days} days`);
  if (lesson.id === 'thirds') {
    const c = stateCounts(Object.values(w.ships));
    check(c.ACTIVE_PATROL === 2 && c.TRANSIT_WORKUP === 2 && c.MAINTENANCE_DOCK === 2, `thirds lesson should end 2/2/2, got ${JSON.stringify(c)}`);
  }
  if (lesson.id === 'contact') check(w.stats.hostilesDestroyed + w.stats.shipsLost >= 0 && Object.keys(w.ships).length === 6, 'no ships lost in the raid');
  console.log(`lesson ${lesson.id.padEnd(10)} done in ${String(days).padStart(3)} days (day ${w.tick})`);
}

check(w.stats.shipsLost === 0, `no ships may be lost (lost ${w.stats.shipsLost})`);
check(w.stats.hostilesDestroyed >= 0, 'stats');
for (let d = 0; d < 120; d++) {
  advanceDay(w);
  flush();
}
check(Object.keys(w.ships).length >= 6, 'fleet intact after graduation');
console.log(`post-graduation 120 days: ${Object.keys(w.ships).length} ships, ${w.contacts.length} contacts, tension ${w.tension.toFixed(0)}`);
console.log(failures === 0 ? '\nTUTORIAL OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

/**
 * Headless walk-through of the Admiral's Briefing: for each lesson apply onEnter, perform the intended action with the
 * real commands, advance days until the gate opens. Fails on soft-locks, gates that open early, lost ships, etc.
 */
import { LESSONS, PRESET_FIX_PLANT, TUTORIAL_PRESET, type TutorialView } from '../lib/tutorial/lessons';
import * as cmd from '../lib/sim/commands';
import { visibilityOf } from '../lib/sim/asw';
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
  research: w.research, resources: w.resources, spares: w.spares, contacts: w.contacts, shipping: w.shipping, running: true, log, startSeq,
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
    // TUTORIAL_ROE=WEAPONS_FREE plays the costliest path (incident: −8 PC) through every later lesson.
    ok(cmd.setRoe(w, HOME_SECTOR, (process.env.TUTORIAL_ROE as 'HOLD_FIRE' | 'RETURN_FIRE' | 'WEAPONS_FREE') ?? 'RETURN_FIRE'), 'choose ROE');
  },
  challenge: () => {
    ok(cmd.orderContact(w, 'CT-TUT-SMUG', 'HAIL'), 'order hail');
    for (let d = 0; d < 20 && !w.contacts.find((c) => c.id === 'CT-TUT-SMUG')?.hailed; d++) {
      advanceDay(w);
      flush();
    }
    const c = w.contacts.find((x) => x.id === 'CT-TUT-SMUG');
    check(!!c?.suspicious, 'challenge: the smuggler stays silent when hailed');
    ok(cmd.orderContact(w, 'CT-TUT-SMUG', 'BOARD'), 'order board');
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
  suppliers: () => ok(cmd.advanceRelationshipCmd(w, 'NORDVIK'), 'trade mission'),
  homefront: () => ok(cmd.holdBudgetHearing(w), 'budget hearing'),
  escort: () => {
    // Unescorted, the tanker meets the raider and is lost (every choice must end the lesson, none may soft-lock).
    const c = structuredClone(w);
    c.events = [];
    let d0 = 0;
    while (c.shipping.ships.some((m) => m.id === 'MV-TUT-1') && d0++ < 120) advanceDay(c);
    check(c.shipping.stats.lost === 1 && c.shipping.stats.transited === 0, `[escort/unescorted] the tanker should be lost (lost ${c.shipping.stats.lost}, arrived ${c.shipping.stats.transited})`);
    check(c.stats.shipsLost === 0, '[escort/unescorted] no warship lost');
    console.log(`  escort, unescorted -> tanker lost on day ${c.tick} (support ${c.politics.support.toFixed(1)})`);
    // Escorted by TF 11 the same lane is safe.
    ok(cmd.escortMerchantCmd(w, 'TF-1', 'MV-TUT-1'), 'escort the tanker');
  },
  search: () => {
    // The unlucky 10%: the search finds nothing. The lesson must still end, and the cost must be the one the preview promised.
    const c = structuredClone(w);
    c.events = [];
    c.shipping.ships[0].contraband = false;
    const sup0 = c.politics.support;
    ok(cmd.inspectMerchantCmd(c, 'TF-1', 'MV-TUT-2'), '[search/clean] order');
    let d0 = 0;
    while (d0++ < 40) {
      advanceDay(c);
      const m = c.shipping.ships.find((x) => x.id === 'MV-TUT-2');
      if (!m || (m.checked && !m.inspecting)) break;
    }
    const m = c.shipping.ships.find((x) => x.id === 'MV-TUT-2');
    check(!m || (m.checked && !m.inspecting), '[search/clean] the lesson ends on a clean search');
    check(c.shipping.stats.inspections === 1 && c.shipping.stats.seized === 0, '[search/clean] one search, nothing seized');
    check(c.politics.support < sup0 + 0.4, `[search/clean] a clean search costs support (${sup0.toFixed(2)} -> ${c.politics.support.toFixed(2)})`);
    console.log(`  search, clean path -> gate opens after ${d0} days`);
    ok(cmd.inspectMerchantCmd(w, 'TF-1', 'MV-TUT-2'), 'search the suspect ship');
  },
  embargo: () => ok(designateHulk(w, 'SHP-6'), 'designate hulk'),
  sonar: () => {
    const sub = () => w.contacts.find((c) => c.id === 'CT-TUT-SUB')!;
    check(visibilityOf(sub()) === 'DATUM', 'the submarine starts as a datum, not a contact');
    let d = 0;
    while (visibilityOf(sub()) !== 'HELD' && d++ < 12) {
      advanceDay(w);
      flush();
    }
    check(visibilityOf(sub()) === 'HELD', `sonar holds the contact within ${d} days`);
    ok(cmd.orderContact(w, 'CT-TUT-SUB', 'WARN'), 'ping the submarine');
  },
  graduation: () => {
    check(!w.scripted, 'graduation must turn scripted off');
    // The briefing warns the FACs cannot defend themselves there: send the frigate group.
    ok(cmd.assignTaskForce(w, 'TF-1', BEYOND_SECTOR), 'assign TF-1');
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
  if (lesson.id === 'escort') {
    check(w.shipping.stats.lost === 0 && w.shipping.stats.transited === 1 && w.shipping.stats.escorted === 1, `[escort] escorted passage: lost ${w.shipping.stats.lost}, arrived ${w.shipping.stats.transited}, escorted ${w.shipping.stats.escorted}`);
    check(w.stats.shipsLost === 0 && Object.keys(w.ships).length >= 6, '[escort] no warship lost escorting');
    check(!w.fleets.flatMap((f) => f.taskForces).some((t) => t.escort), '[escort] the escort is released at port');
  }
  if (lesson.id === 'search') {
    check(w.shipping.stats.inspections === 1, `[search] one search (${w.shipping.stats.inspections})`);
    check(w.shipping.stats.seized === 1 || /SEARCH CLEAN/.test(log.map((e) => e.text).join('\n')), '[search] either a seizure or a clean search is logged');
    console.log(`  search -> ${w.shipping.stats.seized ? 'contraband seized' : 'clean search'}`);
  }
  if (lesson.id === 'contact') check(w.stats.hostilesDestroyed + w.stats.shipsLost >= 0 && Object.keys(w.ships).length === 6, 'no ships lost in the raid');
  console.log(`lesson ${lesson.id.padEnd(10)} PC ${w.resources.politicalCapital.toFixed(1).padStart(5)} done in ${String(days).padStart(3)} days (day ${w.tick})`);
}

check(w.stats.shipsLost === 0, `no ships may be lost (lost ${w.stats.shipsLost})`);
{
  // every ship sits in exactly one squadron, and every squadron entry is a real ship
  const listed = w.fleets.flatMap((f) => f.taskForces.flatMap((t) => t.squadrons.flatMap((q) => q.shipIds)));
  const dup = listed.filter((id, i) => listed.indexOf(id) !== i);
  check(dup.length === 0, `no ship is listed twice in the order of battle (${dup.join(',')})`);
  check(listed.every((id) => !!w.ships[id]) && Object.keys(w.ships).every((id) => listed.includes(id)), 'order of battle and ship registry agree');
}
check(w.stats.hostilesDestroyed >= 0, 'stats');
for (let d = 0; d < 120; d++) {
  advanceDay(w);
  if (process.env.DEBUG_POST) for (const e of w.events) if (/LOST|ENGAGEMENT|RAID|INCIDENT|seized|AMBUSH|scrap|stripped/.test(e.text)) console.log(`  d${w.tick} ${e.text.slice(0, 140)}`);
  flush();
}
check(Object.keys(w.ships).length >= 6, 'fleet intact after graduation');
console.log(`post-graduation 120 days: ${Object.keys(w.ships).length} ships, ${w.contacts.length} contacts, tension ${w.tension.toFixed(0)}`);
console.log(failures === 0 ? '\nTUTORIAL OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

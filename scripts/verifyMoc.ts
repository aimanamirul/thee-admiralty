/**
 * Maritime Operations Centre (docs/PLAN-maritime-ops.md, M1): stations, coverage, fog of war for surface contacts, advisories that never
 * reveal intent, distress relay, costs, saves. Usage: npm run verify:moc
 */
import { STARTER_DESIGNS } from '../lib/data/catalog';
import { Rng } from '../lib/generator/prng';
import { makeSave, restoreWorld } from '../lib/save';
import * as cmd from '../lib/sim/commands';
import { INTENT_LABEL } from '../lib/sim/contactEngine';
import { allTaskForces } from '../lib/sim/fleetEngine';
import {
  contactShown, coveringStation, homeStation, inCoverage, mocOnly, radarReaches, RELAY_DAYS, STATION_SPEC, stationRadius, stationSites,
  stationUpkeep, tickMoc,
} from '../lib/sim/moc';
import { DISTRESS_DAYS, tickShipping } from '../lib/sim/shipping';
import { createInitialWorld } from '../lib/sim/scenario';
import { createTutorialWorld } from '../lib/sim/tutorialScenario';
import { advanceDay } from '../lib/sim/worldEngine';
import type { Contact, WorldDraft } from '../lib/types/world';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};
const copyOf = (w: WorldDraft) => ({ ...structuredClone({ ...w, map: undefined }), map: w.map }) as WorldDraft;
const BASE = createInitialWorld('MOC-BASE', 'CORRIDOR');
let uid = 0;
const contact = (w: WorldDraft, x: number, y: number, over: Partial<Contact> = {}): Contact => ({
  id: `CT-M-${uid++}`, sectorId: w.map.sectorGrid[Math.round(y) * w.map.width + Math.round(x)] >= 0 ? w.map.sectorGrid[Math.round(y) * w.map.width + Math.round(x)] : 0,
  position: { x, y }, heading: 0, cls: 'UNKNOWN', hostile: true, intent: 'RAIDER', strength: 40, bornTick: w.tick, expiresTick: w.tick + 30, ...over,
});

// ---- starting stations
check(BASE.stations.length === 1 && BASE.stations[0].site === 'HOME' && BASE.stations[0].kind === 'COASTAL_RADAR', 'a new theatre starts with the home-port radar');
const tut = createTutorialWorld();
check(tut.stations.length === 2 && tut.stations.some((s) => s.kind === 'CHOKEPOINT_WATCH'), 'the briefing adds a watch on THE NARROWS');
check(stationSites(BASE).length === 1 + BASE.map.sectors.length + BASE.map.chokepoints.length, 'one site per sector and chokepoint, plus the home port');

// ---- coverage geometry
{
  const s = BASE.stations[0];
  const r = stationRadius(s);
  check(inCoverage(BASE, s.position) && inCoverage(BASE, { x: s.position.x + r - 0.5, y: s.position.y }), 'inside the radius is covered');
  check(!inCoverage(BASE, { x: s.position.x + r + 1, y: s.position.y }), 'outside the radius is not');
  const w = copyOf(BASE);
  w.resources.budget = 1000;
  check(cmd.upgradeStationCmd(w, 'STN-HOME').ok && stationRadius(w.stations[0]) === STATION_SPEC.COASTAL_RADAR.radius[1] && stationRadius(w.stations[0]) > r, 'an upgrade widens coverage');
}

// ---- fog of war for surface contacts
{
  const w = copyOf(BASE);
  w.contacts = [];
  for (const tf of allTaskForces(w.fleets)) tf.position = { x: -900, y: -900 }; // no radar anywhere near
  const home = w.stations[0].position;
  const near = contact(w, home.x + 5, home.y);
  const far = contact(w, home.x + 80, home.y);
  const farKnown = contact(w, home.x + 82, home.y, { cls: 'HOSTILE' });
  const placed = contact(w, home.x + 84, home.y);
  w.contacts.push(near, far, farKnown);
  tickMoc(w);
  w.contacts.push(placed);
  check(near.tracked === true && !near.inRadar && contactShown(near) && mocOnly(near), 'a contact inside coverage is tracked and shown as a faint MOC track');
  check(far.tracked === false && far.inRadar === false && !contactShown(far), 'outside coverage and radar an unidentified contact is not on the plot');
  check(contactShown(farKnown), 'an identified contact stays on the plot');
  check(contactShown(placed), 'a contact never assessed (placed by hand) is shown');
  check(near.cls === 'UNKNOWN' && near.intent === 'RAIDER', 'tracking never identifies');
  // radar reach of a task force
  const tf = allTaskForces(w.fleets)[0];
  tf.position = { x: far.position.x - 6, y: far.position.y };
  tickMoc(w);
  check(far.inRadar === true && contactShown(far) && !mocOnly(far), 'a task force at sea sees contacts inside its radar reach');
  check(radarReaches(w).every((r) => r.reach >= 14), 'radar reach is never less than the visual floor');
  const sub = contact(w, home.x + 3, home.y, { intent: 'SUBMARINE', submerged: true, track: 0 });
  w.contacts.push(sub);
  tickMoc(w);
  check(!contactShown(sub) && sub.tracked === undefined, 'shore radar does not see submerged boats');
}

// ---- advisories: at most one a day, never the intent
{
  const w = copyOf(BASE);
  w.resources.budget = 5000;
  for (const site of stationSites(w)) cmd.buildStationCmd(w, site.site);
  let advisories = 0;
  let worstDay = 0;
  const texts: string[] = [];
  for (let d = 0; d < 400; d++) {
    w.events = [];
    advanceDay(w);
    const moc = w.events.filter((e) => e.text.startsWith('MOC:') && /track/.test(e.text));
    advisories += moc.length;
    worstDay = Math.max(worstDay, moc.length);
    texts.push(...moc.map((e) => e.text));
  }
  check(advisories > 5, `the MOC reports tracks in a long game (${advisories} in 400 days)`);
  check(worstDay <= 1, `never more than one heads-up a day (${worstDay})`);
  const labels = Object.values(INTENT_LABEL).filter((l) => l !== 'MERCHANT VESSEL');
  const leaks = texts.filter((t) => labels.some((l) => t.toUpperCase().includes(l)) || /HOSTILE|NEUTRAL/.test(t));
  check(leaks.length === 0, `advisories never name the intent (${leaks[0] ?? ''})`);
  console.log(`advisories in 400 days with every station built: ${advisories}; e.g. "${texts[0] ?? ''}"`);
}

// ---- orders and costs
{
  const w = copyOf(BASE);
  w.resources.budget = 1000;
  const site = `S${w.map.sectors[1].id}`;
  const b0 = w.resources.budget;
  check(cmd.buildStationCmd(w, site).ok && w.resources.budget === b0 - STATION_SPEC.COASTAL_RADAR.build, 'building costs the listed price');
  check(!cmd.buildStationCmd(w, site).ok, 'one station per site');
  check(!cmd.removeStationCmd(w, 'STN-HOME').ok, 'the home-port radar cannot be closed');
  check(cmd.removeStationCmd(w, `STN-${site}`).ok && !w.stations.some((s) => s.site === site), 'a station can be closed');
  w.resources.budget = 1;
  check(!cmd.buildStationCmd(w, `C${w.map.chokepoints[0]?.id ?? 0}`).ok, 'no money, no station');
  check(Math.abs(stationUpkeep([homeStation(w)]) - STATION_SPEC.COASTAL_RADAR.upkeep[0]) < 1e-9, 'upkeep per station');
  // daily upkeep comes out of the budget
  const a = copyOf(BASE);
  const b = copyOf(BASE);
  b.resources.budget = a.resources.budget = 2000;
  cmd.buildStationCmd(b, site);
  b.resources.budget = a.resources.budget;
  advanceDay(a);
  advanceDay(b);
  check(Math.abs(a.resources.budget - b.resources.budget - STATION_SPEC.COASTAL_RADAR.upkeep[0]) < 1e-6, `upkeep is charged daily (${(a.resources.budget - b.resources.budget).toFixed(3)} M)`);
}

// ---- distress relay
{
  const shipBase = createInitialWorld('MOC-SHIP', 'CORRIDOR');
  for (let d = 0; d < 60 && shipBase.shipping.ships.length < 3; d++) advanceDay(shipBase);
  const windowFor = (covered: boolean) => {
    for (let seed = 0; seed < 200; seed++) {
      const w = copyOf(shipBase);
      w.tick += seed;
      w.contacts = [];
      for (const tf of allTaskForces(w.fleets)) tf.position = { x: -900, y: -900 };
      const m = w.shipping.ships[seed % w.shipping.ships.length];
      w.stations = covered ? [{ id: 'STN-T', kind: 'COASTAL_RADAR', tier: 1, site: 'T', position: { ...m.position }, builtTick: 0 }] : [];
      w.contacts.push(contact(w, m.position.x + 1, m.position.y, { hostile: true }));
      w.events = [];
      tickShipping(w, new Rng(`relay${seed}`));
      const ship = w.shipping.ships.find((x) => x.id === m.id);
      if (ship?.status === 'DISTRESS') return { days: (ship.distressUntil ?? 0) - w.tick, text: w.events.find((e) => /DISTRESS/.test(e.text))?.text ?? '' };
    }
    return null;
  };
  const open = windowFor(false);
  const relayed = windowFor(true);
  check(!!open && open.days === DISTRESS_DAYS, `outside coverage the distress window is ${DISTRESS_DAYS} days (${open?.days})`);
  check(!!relayed && relayed.days === DISTRESS_DAYS + RELAY_DAYS && /relayed/.test(relayed.text), `inside coverage it is ${DISTRESS_DAYS + RELAY_DAYS} days and says so (${relayed?.days})`);
}

// ---- saves
{
  const w = copyOf(BASE);
  w.resources.budget = 1000;
  cmd.buildStationCmd(w, `S${w.map.sectors[2].id}`);
  const back = restoreWorld(makeSave(w, [], 0, STARTER_DESIGNS));
  check(JSON.stringify(back.stations) === JSON.stringify(w.stations), 'stations survive a save round trip');
  const old = makeSave(w, [], 0, STARTER_DESIGNS);
  delete (old.world as Partial<WorldDraft>).stations;
  const restored = restoreWorld(old);
  check(restored.stations.length === 1 && restored.stations[0].site === 'HOME', 'an old save gains the home-port radar');
  check(coveringStation(restored, restored.map.homePort)?.site === 'HOME', 'and it covers the home port');
}

if (failures) {
  console.log(`\nMOC FAILED (${failures})`);
  process.exit(1);
}
console.log('MOC OK (M1: stations, coverage, fog, advisories, relay, costs, saves)');

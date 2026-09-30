/** Headless soak test: run the world engine for N days and report. Usage: tsx scripts/verifySim.ts [days] [seed] [ARCH] */
import { createInitialWorld } from '../lib/sim/scenario';
import { advanceDay } from '../lib/sim/worldEngine';
import { forecast, runningCosts } from '../lib/sim/politicsEngine';
import { stateCounts } from '../lib/sim/fleetEngine';
import { assignTaskForce, setTempo, orderShip, startResearch, buySpares } from '../lib/sim/commands';
import type { MapArchetype } from '../lib/types/map';

const days = Number(process.argv[2] ?? 365);
const seed = process.argv[3] ?? 'ADMIRALTY-001';
const arch = process.argv[4] as MapArchetype | undefined;
const surge = process.argv.includes('--surge');
const world = createInitialWorld(seed, arch);
console.log(`theatre ${world.map.archetype}, ${world.map.sectors.length} sectors, home ${JSON.stringify(world.map.homePort)}`);
world.events.length = 0;

// give the second task force a station too
const far = [...world.map.sectors].sort((a, b) => b.areaTiles - a.areaTiles)[0];
console.log(assignTaskForce(world, 'TF-2', far.id).message, '->', far.name);
console.log(startResearch(world, 'BR_L16_TAC').message);
console.log(orderShip(world, { designName: 'Vigil', hullId: 'CORVETTE', moduleIds: ['PP_DOM_D12', 'CMS_DOM_OB1', 'SEN_DOM_DSR2', 'ARM_DOM_DSAM8'], squadronId: 'SQ-1-2', tradition: 'VIRTUES' }));
console.log(buySpares(world, 'SEN_DOM_DSR2', 2).message);
if (surge) setTempo(world, 'TF-1', 'SURGE');

const counts: Record<string, number> = {};
const t0 = performance.now();
for (let d = 0; d < days; d++) {
  advanceDay(world);
  for (const e of world.events) counts[e.severity] = (counts[e.severity] ?? 0) + 1;
  if (d % 60 === 59 || d < 0) {
    const c = stateCounts(Object.values(world.ships));
    console.log(`day ${world.tick}: budget ${world.resources.budget.toFixed(0)} RP ${world.resources.researchPoints.toFixed(0)} PC ${world.resources.politicalCapital.toFixed(0)} tension ${world.tension.toFixed(0)} ships ${Object.keys(world.ships).length} states ${JSON.stringify(c)}`);
  }
  for (const e of world.events) if (e.severity === 'CRITICAL' || e.severity === 'COMBAT' && e.text.startsWith('ENGAGEMENT')) console.log(`  [d${world.tick}] ${e.severity}: ${e.text}`);
  world.events.length = 0;
}
console.log(`\n${days} days in ${(performance.now() - t0).toFixed(0)}ms`, counts, world.stats, { costsPerDay: +runningCosts(Object.values(world.ships), world.tick).total.toFixed(2), support: +world.politics.support.toFixed(1), fy: world.politics.fiscal.year, forecast: Math.round(forecast(world).mid) });
for (const v of Object.values(world.vendors)) console.log(`  ${v.name.padEnd(22)} ${v.status} standing ${v.standing.toFixed(0)}`);

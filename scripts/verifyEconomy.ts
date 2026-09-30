/**
 * Economy & domestic politics soak. Two strategies over three fiscal years in three theatres:
 *  - DUCK: never buys anything, keeps the starting deployment.
 *  - ACTIVE: covers the most threatened sectors and lays down a corvette whenever it can afford one.
 * Checks: hoarding is bounded by the carryover rule; tranches and year closes happen on schedule; the forecast moves;
 * no NaN; the active navy ends with more hulls without going bankrupt. Usage: npm run verify:economy
 */
import * as cmd from '../lib/sim/commands';
import { CARRYOVER_SHARE, daysToNextTranche, FISCAL_YEAR_DAYS, forecast, hullDailyCost, runningCosts } from '../lib/sim/politicsEngine';
import { createInitialWorld } from '../lib/sim/scenario';
import { advanceDay } from '../lib/sim/worldEngine';
import type { MapArchetype } from '../lib/types/map';
import type { WorldDraft } from '../lib/types/world';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};
const YEARS = 3;
const CORVETTE = ['PP_DOM_D12', 'CMS_DOM_OB1', 'SEN_DOM_DSR2', 'ARM_DOM_DSAM8', 'ARM_DOM_GUN76'];

function run(arch: MapArchetype, strategy: 'DUCK' | 'ACTIVE', seed: string) {
  const w: WorldDraft = createInitialWorld(seed, arch);
  let maxBudget = w.resources.budget;
  let yearCloses = 0;
  let tranches = 0;
  const forecasts = new Set<number>();
  for (let d = 0; d < YEARS * FISCAL_YEAR_DAYS + 1; d++) {
    if (strategy === 'ACTIVE' && d % 30 === 0) {
      // cover the most threatened sectors with the task forces we have
      const tfs = w.fleets.flatMap((f) => f.taskForces);
      const worst = [...w.map.sectors].sort((a, b) => w.sectors[b.id].threat - w.sectors[a.id].threat);
      tfs.forEach((tf, i) => worst[i] && tf.assignedSectorId !== worst[i].id && cmd.assignTaskForce(w, tf.id, worst[i].id));
      // Prudent procurement: keep a reserve to the next tranche and keep projected running costs within 85% of the appropriation.
      const costs = runningCosts(Object.values(w.ships), w.tick).total;
      const building = Object.values(w.ships).filter((x) => x.buildStatus === 'CONSTRUCTING').length;
      const projected = costs + (building + 1) * hullDailyCost('CORVETTE', 'ACTIVE_PATROL');
      const reserve = costs * daysToNextTranche(w.tick) + 150;
      if (w.resources.budget - 160 > reserve && projected * FISCAL_YEAR_DAYS < 0.85 * w.politics.fiscal.appropriation) {
        cmd.orderShip(w, { designName: 'Vigil', hullId: 'CORVETTE', moduleIds: CORVETTE, squadronId: 'SQ-1-2', tradition: 'VIRTUES' });
      }
    }
    const yearBefore = w.politics.fiscal.year;
    const tranchesBefore = w.politics.fiscal.tranchesPaid;
    advanceDay(w);
    if (w.politics.fiscal.year !== yearBefore) {
      yearCloses++;
      // the new year's opening balance is what survived the close: never more than the carryover cap
      check(w.politics.fiscal.openingBalance <= CARRYOVER_SHARE * Math.max(3000, w.politics.fiscal.appropriation) * 1.5 + 1, `${arch}/${strategy}: carryover ${w.politics.fiscal.openingBalance.toFixed(0)} exceeds cap`);
      check(w.politics.fiscal.tranchesPaid === 1, 'new year starts with its first tranche');
    } else if (w.politics.fiscal.tranchesPaid !== tranchesBefore) tranches++;
    for (const v of [w.resources.budget, w.politics.support, forecast(w).mid]) check(Number.isFinite(v), `${arch}/${strategy}: non-finite value on day ${w.tick}`);
    maxBudget = Math.max(maxBudget, w.resources.budget);
    forecasts.add(Math.round(forecast(w).mid));
    w.events = [];
  }
  return { w, maxBudget, yearCloses, tranches, forecastsSeen: forecasts.size };
}

// One seed is a coin flip (a raider's dice can flip a single comparison), so each theatre runs three seeds and the comparison between
// strategies is made on the totals, which is what the design claim is about.
const SEEDS = ['economy-check', 'economy-check-2', 'economy-check-3'];
for (const arch of ['CHOKEPOINT', 'CORRIDOR', 'RIMLAND'] as MapArchetype[]) {
  const tot = { duck: { ships: 0, support: 0, appropriation: 0 }, active: { ships: 0, support: 0, appropriation: 0 } };
  for (const seed of SEEDS) {
    const duck = run(arch, 'DUCK', seed);
    const active = run(arch, 'ACTIVE', seed);
    for (const [name, r] of [['DUCK', duck], ['ACTIVE', active]] as const) {
      console.log(
        `${arch.padEnd(10)} ${SEEDS.indexOf(seed) + 1} ${name.padEnd(6)} FY${r.w.politics.fiscal.year} budget ${r.w.resources.budget.toFixed(0).padStart(6)} max ${r.maxBudget.toFixed(0).padStart(5)} ` +
          `support ${r.w.politics.support.toFixed(0).padStart(3)} appropriation ${r.w.politics.fiscal.appropriation.toFixed(0)} hulls ${Object.keys(r.w.ships).length} ` +
          `lost ${r.w.stats.shipsLost} kills ${r.w.stats.hostilesDestroyed}`,
      );
      check(r.yearCloses === YEARS, `${arch}/${name}: expected ${YEARS} year closes, got ${r.yearCloses}`);
      check(r.tranches === YEARS * 3, `${arch}/${name}: expected ${YEARS * 3} mid-year tranches, got ${r.tranches}`);
      check(r.forecastsSeen > 20, `${arch}/${name}: forecast never moved`);
    }
    // Hoarding is bounded: a navy that never buys cannot bank more than about one quarter plus the carryover.
    const cap = duck.w.politics.fiscal.appropriation * (0.25 + CARRYOVER_SHARE) + 1500;
    check(duck.maxBudget < cap, `${arch}/${seed}: duck hoarded ${duck.maxBudget.toFixed(0)} (cap ${cap.toFixed(0)})`);
    check(active.w.resources.budget > -500, `${arch}/${seed}: active navy went bankrupt (${active.w.resources.budget.toFixed(0)})`);
    tot.duck.ships += Object.keys(duck.w.ships).length;
    tot.active.ships += Object.keys(active.w.ships).length;
    tot.duck.support += duck.w.politics.support;
    tot.active.support += active.w.politics.support;
    tot.duck.appropriation += duck.w.politics.fiscal.appropriation;
    tot.active.appropriation += active.w.politics.fiscal.appropriation;
  }
  check(tot.active.ships > tot.duck.ships, `${arch}: active navy should end larger than the duck's (${tot.active.ships} vs ${tot.duck.ships} hulls over ${SEEDS.length} seeds)`);
  // Doing the job must pay better politically than sitting still.
  check(tot.active.support > tot.duck.support, `${arch}: active support should beat the duck's (${tot.active.support.toFixed(0)} vs ${tot.duck.support.toFixed(0)})`);
  check(tot.active.appropriation > tot.duck.appropriation, `${arch}: active appropriation should beat the duck's (${tot.active.appropriation.toFixed(0)} vs ${tot.duck.appropriation.toFixed(0)})`);
}
console.log(failures === 0 ? '\nECONOMY OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

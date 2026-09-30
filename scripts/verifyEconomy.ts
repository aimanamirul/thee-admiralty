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

function run(arch: MapArchetype, strategy: 'DUCK' | 'ACTIVE') {
  const w: WorldDraft = createInitialWorld('economy-check', arch);
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

for (const arch of ['CHOKEPOINT', 'CORRIDOR', 'RIMLAND'] as MapArchetype[]) {
  const duck = run(arch, 'DUCK');
  const active = run(arch, 'ACTIVE');
  for (const [name, r] of [['DUCK', duck], ['ACTIVE', active]] as const) {
    console.log(
      `${arch.padEnd(10)} ${name.padEnd(6)} FY${r.w.politics.fiscal.year} budget ${r.w.resources.budget.toFixed(0).padStart(6)} max ${r.maxBudget.toFixed(0).padStart(5)} ` +
        `support ${r.w.politics.support.toFixed(0).padStart(3)} appropriation ${r.w.politics.fiscal.appropriation.toFixed(0)} hulls ${Object.keys(r.w.ships).length} ` +
        `lost ${r.w.stats.shipsLost} kills ${r.w.stats.hostilesDestroyed}`,
    );
    check(r.yearCloses === YEARS, `${arch}/${name}: expected ${YEARS} year closes, got ${r.yearCloses}`);
    check(r.tranches === YEARS * 3, `${arch}/${name}: expected ${YEARS * 3} mid-year tranches, got ${r.tranches}`);
    check(r.forecastsSeen > 20, `${arch}/${name}: forecast never moved`);
  }
  // Hoarding is bounded: a navy that never buys cannot bank more than about one quarter plus the carryover.
  const cap = duck.w.politics.fiscal.appropriation * (0.25 + CARRYOVER_SHARE) + 1500;
  check(duck.maxBudget < cap, `${arch}: duck hoarded ${duck.maxBudget.toFixed(0)} (cap ${cap.toFixed(0)})`);
  check(Object.keys(active.w.ships).length > Object.keys(duck.w.ships).length, `${arch}: active navy should end larger than the duck's`);
  check(active.w.resources.budget > -500, `${arch}: active navy went bankrupt (${active.w.resources.budget.toFixed(0)})`);
  // Doing the job must pay better politically than sitting still.
  check(active.w.politics.support > duck.w.politics.support, `${arch}: active support should beat the duck's`);
  check(active.w.politics.fiscal.appropriation > duck.w.politics.fiscal.appropriation, `${arch}: active appropriation should beat the duck's`);
}
console.log(failures === 0 ? '\nECONOMY OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

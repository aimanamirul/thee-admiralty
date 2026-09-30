/**
 * One simulated day = one tick. Orchestrates economy, sanctions, construction, R&D, sector threat,
 * hostile contacts and the fleet Rule of Thirds. Pure with respect to `WorldDraft` (mutates only it).
 */
import { HULLS } from '../data/catalog';
import { Rng } from '../generator/prng';
import type { WorldDraft } from '../types/world';
import { tickContacts } from './contactEngine';
import { tickDiplomacy } from './diplomacyEngine';
import { advanceFleets, allTaskForces, taskForceShipIds } from './fleetEngine';
import { tickPolitics } from './politicsEngine';
import { tickRelations } from './relationsEngine';
import { tickSupplyChain } from './supplyChain';
import { payInstalment } from './contracts';
import { tickColdVendors } from './coldVendors';
import { bridgeSet, BASE_RP_INCOME, tickResearch } from './researchEngine';

export { ENGAGE_RANGE, IDENTIFY_RANGE } from './contactEngine';

const clamp = (v: number, lo = 0, hi = 100) => (v < lo ? lo : v > hi ? hi : v);
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

export function advanceDay(world: WorldDraft): void {
  world.tick += 1;
  const incidentsBefore = world.stats.incidents;
  const rng = new Rng(`${world.seed}:day:${world.tick}`);
  const bridges = bridgeSet(world.research.completed);

  // Economy & domestic politics: appropriation tranches, running costs, support, political capital.
  tickPolitics(world, rng.fork('politics'));
  world.resources.researchPoints = clamp(world.resources.researchPoints + BASE_RP_INCOME, 0, 999);

  tickDiplomacy(world, rng.fork('diplomacy'));
  progressConstruction(world);
  tickResearch(world);
  updateSectors(world, rng.fork('sectors'));
  advanceFleets(world, rng.fork('fleets'));
  tickContacts(world, rng.fork('contacts'), bridges);
  tickRelations(world, incidentsBefore);
  tickSupplyChain(world);
  tickColdVendors(world, rng.fork('cold'));
}

function progressConstruction(world: WorldDraft): void {
  const building = Object.values(world.ships)
    .filter((s) => s.buildStatus === 'CONSTRUCTING' && !s.frozenBy)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .slice(0, world.resources.industrialCapacity);
  for (const s of building) {
    if (!payInstalment(world, s)) continue; // the slipway waits for money
    s.buildProgressDays += 1;
    if (s.buildProgressDays >= s.buildTotalDays) {
      s.buildStatus = 'COMMISSIONED';
      s.contract = null;
      s.state = 'TRANSIT_WORKUP';
      s.stateDays = 0;
      s.readiness = 55;
      s.commissionedTick = world.tick;
      world.events.push({ severity: 'ADVISORY', text: `COMMISSIONED: ${s.pennant} ${s.name.toUpperCase()} (${HULLS[s.hullId].name}, ${s.designName}) joins the fleet` });
    }
  }
}

function updateSectors(world: WorldDraft, rng: Rng): void {
  if (world.scripted) return;
  const map = world.map;
  const diag = Math.hypot(map.width, map.height);
  const covered = new Set<number>();
  for (const tf of allTaskForces(world.fleets)) {
    if (tf.assignedSectorId === null) continue;
    const sec = map.sectors[tf.assignedSectorId];
    if (!sec || dist(tf.position.x, tf.position.y, sec.anchor.x, sec.anchor.y) > 3) continue;
    if (taskForceShipIds(tf).some((id) => world.ships[id]?.state === 'ACTIVE_PATROL')) covered.add(sec.id);
  }
  for (const sec of map.sectors) {
    const st = world.sectors[sec.id];
    const far = Math.hypot(sec.anchor.x - map.homePort.x, sec.anchor.y - map.homePort.y) / diag;
    const baseline = 10 + world.tension * 0.45 + far * 30;
    st.threat += (baseline - st.threat) * 0.03 + rng.gaussian() * 1.1 - (covered.has(sec.id) ? 0.5 : 0);
    st.threat = clamp(st.threat);
  }
}

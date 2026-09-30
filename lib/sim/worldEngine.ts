/**
 * One simulated day = one tick. Orchestrates economy, sanctions, construction, R&D, sector threat,
 * hostile contacts and the fleet Rule of Thirds. Pure with respect to `WorldDraft` (mutates only it).
 */
import { HULLS } from '../data/catalog';
import { Rng } from '../generator/prng';
import type { Ship } from '../types/fleet';
import type { Bridges, Contact, WorldDraft } from '../types/world';
import { resolveEngagement } from './combatSim';
import { tickDiplomacy } from './diplomacyEngine';
import { advanceFleets, allTaskForces, combatantOf, removeShip, taskForceShipIds } from './fleetEngine';
import { adjustSupport, tickPolitics } from './politicsEngine';
import { bridgeSet, BASE_RP_INCOME, tickResearch } from './researchEngine';

export const IDENTIFY_RANGE = 10;
export const ENGAGE_RANGE = 12;

const clamp = (v: number, lo = 0, hi = 100) => (v < lo ? lo : v > hi ? hi : v);
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

export function advanceDay(world: WorldDraft): void {
  world.tick += 1;
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
}

function progressConstruction(world: WorldDraft): void {
  const building = Object.values(world.ships)
    .filter((s) => s.buildStatus === 'CONSTRUCTING' && !s.frozenBy)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .slice(0, world.resources.industrialCapacity);
  for (const s of building) {
    s.buildProgressDays += 1;
    if (s.buildProgressDays >= s.buildTotalDays) {
      s.buildStatus = 'COMMISSIONED';
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

function spawnContact(world: WorldDraft, rng: Rng, sectorId: number): Contact | null {
  const map = world.map;
  const st = world.sectors[sectorId];
  for (let tries = 0; tries < 60; tries++) {
    const i = rng.int(0, map.width * map.height - 1);
    if (map.sectorGrid[i] !== sectorId) continue;
    const hostile = rng.chance(clamp(0.15 + (st.threat / 100) * 0.75, 0, 0.95) * 1);
    return {
      id: `CT-${world.tick}-${sectorId}-${tries}`,
      sectorId,
      position: { x: i % map.width, y: Math.floor(i / map.width) },
      heading: rng.range(0, Math.PI * 2),
      cls: 'UNKNOWN',
      hostile,
      strength: clamp(15 + st.threat * 0.7 + rng.range(0, 10), 15, 100),
      bornTick: world.tick,
      expiresTick: world.tick + rng.int(8, 16),
    };
  }
  return null;
}

function tickContacts(world: WorldDraft, rng: Rng, bridges: Bridges): void {
  const map = world.map;
  const w = map.width;

  // Spawn
  for (const sec of map.sectors) {
    const st = world.sectors[sec.id];
    const p = 0.004 + 0.05 * (st.threat / 100) ** 2;
    if (!world.scripted && world.contacts.length < 14 && rng.chance(p)) {
      const c = spawnContact(world, rng, sec.id);
      if (c) world.contacts.push(c);
    }
  }

  const tfs = allTaskForces(world.fleets);
  const activeShips = (tfId: string) => {
    const tf = tfs.find((t) => t.id === tfId)!;
    return taskForceShipIds(tf)
      .map((id) => world.ships[id])
      .filter((s): s is Ship => !!s && s.buildStatus === 'COMMISSIONED' && !s.isPartsHulk && s.state !== 'MAINTENANCE_DOCK');
  };
  const nearestTf = (x: number, y: number, range: number) => {
    let best: { id: string; d: number } | null = null;
    for (const tf of tfs) {
      const d = dist(tf.position.x, tf.position.y, x, y);
      if (d <= range && (!best || d < best.d) && activeShips(tf.id).length > 0) best = { id: tf.id, d };
    }
    return best;
  };

  const survivors: Contact[] = [];
  for (const c of world.contacts) {
    // Drift within the sector (scripted contacts head straight for their target).
    const chased = c.pursue ? tfs.find((t) => t.id === c.pursue) : undefined;
    if (chased) c.heading = Math.atan2(chased.position.y - c.position.y, chased.position.x - c.position.x);
    else c.heading += rng.gaussian() * 0.25;
    const step = chased ? 2 : 1.5;
    const nx = c.position.x + Math.cos(c.heading) * step;
    const ny = c.position.y + Math.sin(c.heading) * step;
    const cell = Math.round(ny) * w + Math.round(nx);
    if (nx >= 0 && ny >= 0 && nx < w && ny < map.height && map.sectorGrid[cell] === c.sectorId) c.position = { x: nx, y: ny };
    else c.heading = rng.range(0, Math.PI * 2);

    const st = world.sectors[c.sectorId];
    const near = nearestTf(c.position.x, c.position.y, ENGAGE_RANGE);

    // Identification
    if (c.cls === 'UNKNOWN' && nearestTf(c.position.x, c.position.y, IDENTIFY_RANGE)) {
      c.cls = c.hostile ? 'HOSTILE' : 'NEUTRAL';
      if (!c.hostile) c.pursue = undefined; // identified merchants resume their own course
      world.events.push({
        severity: c.hostile ? 'WARNING' : 'INFO',
        text: `CONTACT ${c.id.slice(3, 9)} in ${map.sectors[c.sectorId].name}: identified ${c.cls}`,
      });
    }

    // Engagement rules
    let engage = false;
    let surprise = false;
    if (near) {
      if (c.hostile) {
        engage = true;
        surprise = st.roe === 'HOLD_FIRE';
      } else if (st.roe === 'WEAPONS_FREE' && c.cls === 'UNKNOWN') {
        // Weapons-free fires on unidentified tracks — which turned out to be civilians.
        world.events.push({ severity: 'CRITICAL', text: `INCIDENT: weapons-free fire on neutral vessel in ${map.sectors[c.sectorId].label} — diplomatic fallout` });
        world.resources.politicalCapital = clamp(world.resources.politicalCapital - 8, 0, 60);
        world.tension = clamp(world.tension + 5);
        adjustSupport(world, -6);
        world.stats.incidents++;
        continue;
      }
    }

    if (engage && near) {
      const defenders = activeShips(near.id).map((s) => combatantOf(s, bridges));
      const res = resolveEngagement(rng.fork(c.id), defenders, { strength: c.strength }, { roe: st.roe, surprise, littoralFraction: map.sectors[c.sectorId].littoralFraction });
      const tf = tfs.find((t) => t.id === near.id)!;
      world.events.push({
        severity: 'COMBAT',
        text: `ENGAGEMENT ${map.sectors[c.sectorId].name} vs hostile str ${c.strength.toFixed(0)} [${tf.name}, ROE ${st.roe.replace('_', ' ')}${surprise ? ', SURPRISED' : ''}]: ${res.outcome}`,
      });
      for (const line of res.log) world.events.push({ severity: 'COMBAT', text: `  ${line}` });
      for (const d of defenders) {
        const ship = world.ships[d.id];
        const lost = res.damage[d.id] ?? 0;
        ship.integrity -= lost;
        ship.readiness = clamp(ship.readiness - 4);
        if (res.outcome !== 'DEFEAT') ship.veterancy = clamp(ship.veterancy + 3);
        if (ship.integrity <= 0) {
          world.events.push({ severity: 'CRITICAL', text: `LOST: ${ship.pennant} ${ship.name.toUpperCase()} sunk in action` });
          removeShip(world, ship.id);
          world.stats.shipsLost++;
          adjustSupport(world, -8);
        }
      }
      if (res.outcome === 'DESTROYED') {
        st.threat = clamp(st.threat - 8);
        world.stats.hostilesDestroyed++;
        adjustSupport(world, 2);
        world.resources.politicalCapital = clamp(world.resources.politicalCapital + 1.5, 0, 60);
      } else if (res.outcome === 'REPELLED') st.threat = clamp(st.threat - 3);
      else st.threat = clamp(st.threat + 6);
      continue; // raid expended
    }

    if (world.tick >= c.expiresTick) {
      if (c.hostile) {
        st.threat = clamp(st.threat + 8);
        world.resources.politicalCapital = clamp(world.resources.politicalCapital - 3, 0, 60);
        world.tension = clamp(world.tension + 2);
        adjustSupport(world, -1.5);
        world.events.push({ severity: 'CRITICAL', text: `HOSTILE PROBE UNOPPOSED in ${map.sectors[c.sectorId].name} — no forces on station` });
      }
      continue;
    }
    survivors.push(c);
  }
  world.contacts = survivors;
}

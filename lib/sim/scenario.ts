/** Initial world construction: procedural map, starting fleet, vendors, sector threat. */
import { HULLS, INITIAL_VENDORS, STARTER_DESIGNS } from '../data/catalog';
import { generateMap } from '../generator/seedMap';
import { generatePennant, generateShipName, squadronName, taskForceName } from '../generator/nameGenerator';
import { Rng } from '../generator/prng';
import type { VendorId } from '../types/diplomacy';
import type { Fleet, NamingTradition, OpState, Ship, TaskForce } from '../types/fleet';
import type { HullClassId } from '../types/hull';
import type { MapArchetype } from '../types/map';
import type { SectorState, WorldDraft } from '../types/world';
import { createShip } from './fleetEngine';
import { initialResearch } from './researchEngine';

export const START_RESOURCES = { budget: 1800, industrialCapacity: 3, researchPoints: 60, politicalCapital: 20 };

export function initialSectorStates(world: Pick<WorldDraft, 'map'>, rng: Rng): Record<number, SectorState> {
  const map = world.map;
  const diag = Math.hypot(map.width, map.height);
  const out: Record<number, SectorState> = {};
  for (const s of map.sectors) {
    const far = Math.hypot(s.anchor.x - map.homePort.x, s.anchor.y - map.homePort.y) / diag;
    out[s.id] = { threat: Math.round(15 + far * 45 + rng.range(-6, 8)), roe: 'RETURN_FIRE' };
  }
  return out;
}

interface Seed {
  hull: HullClassId;
  design: string;
  tradition: NamingTradition;
  state: OpState;
  stateDays: number;
  readiness: number;
  vet: number;
  integrity?: number;
}

export function createInitialWorld(seed: string, archetype?: MapArchetype): WorldDraft {
  const map = generateMap(seed, archetype);
  const rng = new Rng(`${seed}:scenario`);
  const used = new Set<string>();
  const pennants = new Set<string>();
  const ships: Record<string, Ship> = {};
  let counter = 0;

  const build = (s: Seed): string => {
    const design = STARTER_DESIGNS.find((d) => d.id === s.design)!;
    const id = `SHP-${++counter}`;
    const name = generateShipName(rng.fork(`name:${counter}`), s.tradition, used);
    used.add(name);
    const pennant = generatePennant(rng.fork(`pen:${counter}`), s.hull, pennants);
    pennants.add(pennant);
    const ship = createShip({
      id, name, pennant, hullId: s.hull, designName: design.name, moduleIds: design.moduleIds, constructing: false,
      state: s.state, stateDays: s.stateDays, readiness: s.readiness, veterancy: s.vet, tick: 0,
    });
    if (s.integrity !== undefined) ship.integrity = s.integrity;
    ships[id] = ship;
    return id;
  };

  const ffg = (state: OpState, d: number, r: number, v: number, integrity?: number): Seed => ({ hull: 'FRIGATE', design: 'DES_FFG_MK1', tradition: 'VIRTUES', state, stateDays: d, readiness: r, vet: v, integrity });
  const cor = (state: OpState, d: number, r: number, v: number, integrity?: number): Seed => ({ hull: 'CORVETTE', design: 'DES_COR_MK1', tradition: 'GEOGRAPHIC', state, stateDays: d, readiness: r, vet: v, integrity });
  const fac = (state: OpState, d: number, r: number, v: number): Seed => ({ hull: 'FAC', design: 'DES_FAC_MK1', tradition: 'CELESTIAL', state, stateDays: d, readiness: r, vet: v });

  // Home sector and the first patrol station (a neighbouring strait if available).
  const homeSector = map.sectors.find((s) => map.sectorGrid[map.homePort.y * map.width + map.homePort.x] === s.id) ?? map.sectors[0];
  const neighbours = homeSector.neighbors.map((id) => map.sectors[id]);
  const station = neighbours.find((s) => s.kind === 'STRAIT') ?? neighbours[0] ?? homeSector;

  const mkTf = (index: number, sectorId: number | null, position: { x: number; y: number }, squadrons: { hull: HullClassId | 'MIXED'; ids: string[] }[]): TaskForce => ({
    id: `TF-${index + 1}`,
    name: taskForceName(index),
    squadrons: squadrons.map((sq, i) => ({ id: `SQ-${index + 1}-${i + 1}`, name: squadronName(i, sq.hull), shipIds: sq.ids })),
    assignedSectorId: sectorId,
    position: { ...position },
    heading: 0,
    speedTilesPerDay: 9,
    route: [],
    destination: null,
    tempo: 'ROTATE_THIRDS',
  });

  const tf1 = mkTf(0, station.id, station.anchor, [
    { hull: 'FRIGATE', ids: [build(ffg('ACTIVE_PATROL', 12, 82, 24)), build(ffg('TRANSIT_WORKUP', 6, 58, 18))] },
    { hull: 'CORVETTE', ids: [build(cor('MAINTENANCE_DOCK', 10, 68, 12, 78)), build(cor('ACTIVE_PATROL', 25, 66, 20))] },
  ]);
  const tf2 = mkTf(1, null, map.homePort, [
    { hull: 'FAC', ids: [build(fac('TRANSIT_WORKUP', 3, 60, 6)), build(fac('TRANSIT_WORKUP', 8, 62, 8)), build(fac('MAINTENANCE_DOCK', 4, 55, 5))] },
  ]);

  const fleets: Fleet[] = [{ id: 'FLT-1', name: 'First Fleet', taskForces: [tf1, tf2] }];

  const vendors = Object.fromEntries(INITIAL_VENDORS.map((v) => [v.id, { ...v }])) as WorldDraft['vendors'];
  const spares: Record<string, number> = {
    SEN_DOM_DSR2: 2, ARM_DOM_GUN76: 2, PP_DOM_D12: 1, CMS_NG_TACTICOS: 1, ARM_NG_SYLVER8: 1, ARM_DOM_DSAM8: 1, PP_DOM_D6: 1, ARM_ZV_KH8: 1,
  };

  const world: WorldDraft = {
    seed, tick: 0, map,
    resources: { ...START_RESOURCES },
    ships, fleets, spares,
    sectors: {},
    vendors: vendors as Record<VendorId, WorldDraft['vendors'][VendorId]>,
    sanctions: [], research: initialResearch(), contacts: [], tension: 30, events: [],
    policy: { autoSpares: true },
    stats: { hostilesDestroyed: 0, shipsLost: 0, incidents: 0 },
  };
  world.sectors = initialSectorStates(world, rng.fork('threat'));
  world.events.push({ severity: 'INFO', text: `ADMIRALTY LEDGER OPENED — theatre ${map.archetype}, seed "${seed}", ${map.sectors.length} sectors, ${map.chokepoints.length} chokepoints` });
  return world;
}

export { HULLS };

/**
 * The "Admiral's Briefing" scenario: a fixed CHOKEPOINT map (seed BRIEFING-01) whose water is split at the
 * strait into two hand-named sectors, plus a small, hand-tuned fleet. Random events are disabled (`scripted`)
 * so every lesson's setup is deterministic; lessons inject their own events.
 */
import { INITIAL_VENDORS, STARTER_DESIGNS } from '../data/catalog';
import { generateShipName, generatePennant, squadronName } from '../generator/nameGenerator';
import { Rng } from '../generator/prng';
import { generateMap } from '../generator/seedMap';
import { sectorsFromGrid } from '../generator/sectors';
import type { Fleet, NamingTradition, OpState, Ship, TaskForce } from '../types/fleet';
import type { HullClassId } from '../types/hull';
import type { MapData } from '../types/map';
import type { WorldDraft } from '../types/world';
import { createShip } from './fleetEngine';
import { initialPolitics } from './politicsEngine';
import { initialResearch } from './researchEngine';

export const TUTORIAL_SEED = 'BRIEFING-01';
export const TUTORIAL_TF1_NAME = 'TF 11';
export const HOME_SECTOR = 0;
export const BEYOND_SECTOR = 1;

/** 4-connected components of cells carrying `label` in `grid`. */
function componentsOf(grid: Int16Array, w: number, h: number, label: number): number[][] {
  const seen = new Uint8Array(grid.length);
  const out: number[][] = [];
  for (let s = 0; s < grid.length; s++) {
    if (seen[s] || grid[s] !== label) continue;
    const cells = [s];
    seen[s] = 1;
    for (let q = 0; q < cells.length; q++) {
      const i = cells[q];
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * h - w ? i + w : -1]) {
        if (j >= 0 && !seen[j] && grid[j] === label) {
          seen[j] = 1;
          cells.push(j);
        }
      }
    }
    out.push(cells);
  }
  return out;
}

/** True if there is a water path (8-neighbour, no corner cutting) between two cells. */
export function waterConnected(map: MapData, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const { width: w, height: h } = map;
  const water = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && map.elevation[y * w + x] <= 0;
  const start = a.y * w + a.x;
  const goal = b.y * w + b.x;
  const seen = new Uint8Array(w * h);
  const q = [start];
  seen[start] = 1;
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    if (i === goal) return true;
    const x = i % w;
    const y = Math.floor(i / w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || !water(x + dx, y + dy)) continue;
        if (dx && dy && (!water(x + dx, y) || !water(x, y + dy))) continue;
        const j = (y + dy) * w + x + dx;
        if (!seen[j]) {
          seen[j] = 1;
          q.push(j);
        }
      }
    }
  }
  return false;
}

/** The fixed two-sector tutorial map. Throws if the partition is not two connected, mutually reachable sectors. */
export function createTutorialMap(): MapData {
  const base = generateMap(TUTORIAL_SEED, 'CHOKEPOINT');
  const { width: w, height: h } = base;
  const neck = [...base.chokepoints].sort((a, b) => a.widthTiles - b.widthTiles || a.id - b.id)[0];
  if (!neck) throw new Error('tutorial map has no chokepoint');
  const splitX = Math.round(neck.position.x);

  const grid = new Int16Array(w * h).fill(-1);
  for (let i = 0; i < grid.length; i++) if (base.elevation[i] <= 0) grid[i] = i % w < splitX ? 0 : 1;

  // Graft any stranded fragment onto the other side so each sector is one connected body of water.
  for (let pass = 0; pass < 3; pass++) {
    for (const label of [0, 1]) {
      const comps = componentsOf(grid, w, h, label).sort((a, b) => b.length - a.length);
      for (const frag of comps.slice(1)) for (const i of frag) grid[i] = 1 - label;
    }
  }
  for (const label of [0, 1]) {
    if (componentsOf(grid, w, h, label).length !== 1) throw new Error(`tutorial sector ${label} is not connected`);
  }

  const { sectors, borders } = sectorsFromGrid({ sectorGrid: grid, w, h, clearance: base.clearance, elevation: base.elevation });
  const names = ['HOME APPROACHES', 'BEYOND THE STRAIT'];
  sectors.forEach((s, i) => {
    s.label = names[i];
    s.name = `SECTOR ${i + 1}: ${names[i]}`;
    s.kind = i === 0 ? 'BASIN' : 'APPROACHES';
  });

  // Home port: sheltered coastal water inside sector 0.
  const home = sectors[0];
  let port = home.anchor;
  let best = Infinity;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== 0 || base.clearance[i] < 1.5 || base.clearance[i] > 3.5) continue;
    const d = ((i % w) - home.centroid.x) ** 2 + (Math.floor(i / w) - home.centroid.y) ** 2;
    if (d < best) {
      best = d;
      port = { x: i % w, y: Math.floor(i / w) };
    }
  }

  const map: MapData = {
    ...base,
    sectorGrid: grid,
    sectors,
    sectorBorders: borders,
    chokepoints: [{ id: 0, name: 'THE NARROWS', position: neck.position, widthTiles: neck.widthTiles, sectorId: grid[Math.round(neck.position.y) * w + Math.round(neck.position.x)], links: [0, 1] }],
    homePort: port,
  };
  if (!waterConnected(map, port, sectors[1].anchor)) throw new Error('no water route from the tutorial port to sector 2');
  return map;
}

interface ShipSeed {
  hull: HullClassId;
  design: string;
  tradition: NamingTradition;
  state: OpState;
  stateDays: number;
  readiness: number;
  vet: number;
}

export function createTutorialWorld(): WorldDraft {
  const map = createTutorialMap();
  const rng = new Rng(`${TUTORIAL_SEED}:scenario`);
  const used = new Set<string>();
  const pennants = new Set<string>();
  const ships: Record<string, Ship> = {};
  let n = 0;
  const build = (s: ShipSeed): string => {
    const design = STARTER_DESIGNS.find((d) => d.id === s.design)!;
    const id = `SHP-${++n}`;
    const name = generateShipName(rng.fork(`name:${n}`), s.tradition, used);
    used.add(name);
    const pennant = generatePennant(rng.fork(`pen:${n}`), s.hull, pennants);
    pennants.add(pennant);
    ships[id] = createShip({
      id, name, pennant, hullId: s.hull, designName: design.name, moduleIds: design.moduleIds, constructing: false,
      state: s.state, stateDays: s.stateDays, readiness: s.readiness, veterancy: s.vet, tick: 0,
    });
    return id;
  };
  const ffg = (state: OpState, stateDays: number, readiness: number, vet: number): ShipSeed => ({ hull: 'FRIGATE', design: 'DES_FFG_MK1', tradition: 'VIRTUES', state, stateDays, readiness, vet });

  const tf1Frigates = [build(ffg('ACTIVE_PATROL', 5, 82, 20)), build(ffg('TRANSIT_WORKUP', 3, 58, 12))];
  const tf1Corvette = [build({ hull: 'CORVETTE', design: 'DES_COR_MK1', tradition: 'GEOGRAPHIC', state: 'TRANSIT_WORKUP', stateDays: 6, readiness: 60, vet: 10 })];
  const facs = [1, 2].map(() => build({ hull: 'FAC', design: 'DES_FAC_MK1', tradition: 'CELESTIAL', state: 'TRANSIT_WORKUP', stateDays: 4, readiness: 60, vet: 6 }));
  // Worn reserve frigate: laid up in dock with a dead power plant and no spare. Built last so the other names stay stable.
  // It rounds the fleet to six (two per Rule-of-Thirds state) and is the obvious Parts Hulk in the embargo lesson.
  const reserve = build(ffg('MAINTENANCE_DOCK', 0, 35, 8));
  ships[reserve].integrity = 55;
  ships[reserve].modules.find((m) => m.moduleId === 'PP_DOM_D12')!.failed = true;
  ships[reserve].designName = 'Argus-class Frigate (reserve)';

  const mkTf = (index: number, name: string, squads: { hull: HullClassId; ids: string[] }[]): TaskForce => ({
    id: `TF-${index + 1}`,
    name,
    squadrons: squads.map((sq, i) => ({ id: `SQ-${index + 1}-${i + 1}`, name: squadronName(i, sq.hull), shipIds: sq.ids })),
    assignedSectorId: null,
    position: { ...map.homePort },
    heading: 0,
    speedTilesPerDay: 9,
    route: [],
    destination: null,
    tempo: 'ROTATE_THIRDS',
  });
  const fleets: Fleet[] = [
    {
      id: 'FLT-1',
      name: 'First Fleet',
      taskForces: [
        mkTf(0, TUTORIAL_TF1_NAME, [{ hull: 'FRIGATE', ids: [...tf1Frigates, reserve] }, { hull: 'CORVETTE', ids: tf1Corvette }]),
        mkTf(1, 'TF 12', [{ hull: 'FAC', ids: facs }]),
      ],
    },
  ];

  const vendors = Object.fromEntries(INITIAL_VENDORS.map((v) => [v.id, { ...v }])) as WorldDraft['vendors'];
  vendors.NAVAL_GROUP_THALES.standing = 50;
  vendors.ASELSAN.standing = 55;

  return {
    seed: TUTORIAL_SEED,
    tick: 0,
    map,
    resources: { budget: 2500, industrialCapacity: 2, researchPoints: 150, politicalCapital: 20 },
    ships,
    fleets,
    spares: {},
    sectors: { 0: { threat: 20, roe: 'HOLD_FIRE' }, 1: { threat: 55, roe: 'RETURN_FIRE' } },
    vendors,
    sanctions: [],
    research: initialResearch(),
    contacts: [],
    tension: 30,
    events: [{ severity: 'INFO', text: "ADMIRAL'S BRIEFING OPENED — theatre: two sectors joined by THE NARROWS. Await instructions." }],
    scripted: true,
    policy: { autoSpares: false },
    // Budget 2500 = opening balance + first tranche; the next tranche (day 90) falls after the briefing ends.
    politics: initialPolitics({ support: 55, appropriation: 3000, openingBalance: 2500 - 750, scripted: true }),
    stats: { hostilesDestroyed: 0, shipsLost: 0, incidents: 0 },
  };
}

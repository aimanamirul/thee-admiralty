/**
 * Admiral's Briefing lesson script. Pure data + functions: no store imports, so gates can run headlessly
 * (see scripts/verifyTutorial.ts). Events are injected in `onEnter`; purchases and orders stay real.
 */
import { mt } from '../data/tokens';
import type { SimSpeed } from '../../store/useFleetStore';
import type { Vendor } from '../types/diplomacy';
import type { Fleet, Ship } from '../types/fleet';
import type { ShipDesign } from '../types/hull';
import type { MapData } from '../types/map';
import { pointAt, generateLanes } from '../sim/shipping';
import type { Lane, Merchant, ShippingState } from '../types/shipping';
import type { Contact, GameEvent, ResearchState, Resources, SectorState, WorldDraft } from '../types/world';
import { HOME_SECTOR, BEYOND_SECTOR, TUTORIAL_TF1_NAME } from '../sim/tutorialScenario';
import { createShip } from '../sim/fleetEngine';

export type UiFlag =
  | '*'
  | 'PANEL' | 'TAB_SECTOR' | 'TAB_FLEET' | 'TAB_RND' | 'TAB_DIPLO'
  | 'DATE' | 'CLOCK' | 'TICKER'
  | 'READOUT_BUDGET' | 'READOUT_INDUSTRY' | 'READOUT_RP' | 'READOUT_PC' | 'READOUT_TENSION'
  | 'THIRDS' | 'SPARES' | 'ORGANISE' | 'DESIGN_BTN' | 'LAYERS' | 'HULK' | 'READOUT_SUPPORT'
  | 'SHIPPING' | 'INSPECT' | 'FORCE';

/** Plain subset of game state the gates read, so they also run in Node. */
export interface TutorialView {
  tick: number;
  map: MapData;
  selectedSectorId: number | null;
  sectors: Record<number, SectorState>;
  fleets: Fleet[];
  ships: Record<string, Ship>;
  vendors: Record<string, Vendor>;
  research: ResearchState;
  resources: Resources;
  spares: Record<string, number>;
  contacts: Contact[];
  shipping: ShippingState;
  running: boolean;
  log: GameEvent[];
  /** Ledger ids above this belong to the current lesson. */
  startSeq: number;
}

export interface Lesson {
  id: string;
  title: string;
  body: string[];
  /** Objective text shown with a checkbox. */
  objective: string;
  /** `data-tutorial` id to spotlight. */
  anchor?: string;
  reveals: UiFlag[];
  tab?: 'SECTOR' | 'FLEET' | 'RND' | 'DIPLO';
  /** Sector to select on entry (opens its panel). */
  select?: number;
  /** Contact to select on entry (opens its ladder panel). */
  selectContact?: string;
  /** Merchant ship to select on entry (opens its panel). */
  selectMerchant?: string;
  /** Sector that gets the pulsing objective ring on the plot. */
  target?: number;
  preset?: ShipDesign;
  /** Start the clock on entry, or once `when` becomes true. */
  run?: { speed: SimSpeed; when?: (v: TutorialView) => boolean };
  onEnter?: (w: WorldDraft) => void;
  gate: (v: TutorialView) => boolean;
}

const newLog = (v: TutorialView, re: RegExp) => v.log.some((e) => e.id > v.startSeq && re.test(e.text));
const tf = (v: { fleets: Fleet[] }, id: string) => v.fleets.flatMap((f) => f.taskForces).find((t) => t.id === id);
const shipLabel = (s: Ship) => `${s.pennant} ${s.name.toUpperCase()}`;

/** Corvette that overloads its grid: the fix is swapping PP_DOM_D6 for PP_DOM_D12. */
export const TUTORIAL_PRESET: ShipDesign = {
  id: 'DES_TUTORIAL',
  name: 'Briefing-class Corvette',
  hullId: 'CORVETTE',
  moduleIds: ['PP_DOM_D6', 'CMS_NG_TACTICOS', 'SEN_ASEL_SPEAR', 'ARM_NG_SYLVER8', 'ARM_NG_MM40', 'ARM_DOM_GUN76'],
};
export const PRESET_FIX_PLANT = 'PP_DOM_D12';

function dock(w: WorldDraft, id: string, readiness: number, failed?: string) {
  const s = w.ships[id];
  s.state = 'MAINTENANCE_DOCK';
  s.stateDays = 0;
  s.overdeployDays = 0;
  s.readiness = readiness;
  if (failed) {
    const m = s.modules.find((x) => x.moduleId === failed);
    if (m) {
      m.failed = true;
      w.events.push({ severity: 'WARNING', text: `${shipLabel(s)}: ${mt(failed)} FAILED — hull in dock` });
    }
  }
}

/** The tutorial lane: east to west, its first stretch beyond the strait. The briefing world starts with none (nothing random runs). */
function tutorialLane(w: WorldDraft): Lane {
  const all = generateLanes(w.map, w.seed);
  return all.find((l) => l.sectors[0] === BEYOND_SECTOR && l.sectors[1] === HOME_SECTOR) ?? all[0];
}

/** A hand-placed merchant ship heading for the lane's western end (the home side). */
function tutorialShip(w: WorldDraft, lane: Lane, m: Pick<Merchant, 'id' | 'name' | 'kind' | 'flag' | 'dist' | 'cargo'> & Partial<Merchant>): Merchant {
  const { pos, heading } = pointAt(lane.path, m.dist);
  return {
    laneId: lane.id, dir: 1, position: pos, heading, bornTick: w.tick, status: 'UNDERWAY', distressUntil: null, escort: null,
    contraband: false, tip: false, checked: false, turnedBack: false, inspecting: null, ...m,
  };
}

const escorting = (v: { fleets: Fleet[] }, shipId: string) => v.fleets.some((f) => f.taskForces.some((t) => t.escort === shipId));

/**
 * Pick a water cell in HOME_SECTOR about `dist` tiles from task force `tfId` whose straight approach stays clear of every
 * other task force and at least `minBearing` radians away from the bearings of `avoid` points.
 */
function spawnPursuer(w: WorldDraft, tfId: string, dist: number, avoid: { x: number; y: number }[], minBearing = 0): { x: number; y: number } {
  const all = w.fleets.flatMap((f) => f.taskForces);
  const t = all.find((x) => x.id === tfId)!;
  const others = all.filter((x) => x !== t);
  const map = w.map;
  const clearOfOthers = (x: number, y: number) =>
    others.every((o) => {
      for (let k = 0; k <= 20; k++) {
        const px = x + ((t.position.x - x) * k) / 20;
        const py = y + ((t.position.y - y) * k) / 20;
        // Only the approach matters: once inside TF 11's engagement radius the contact is dealt with there.
        if (Math.hypot(px - t.position.x, py - t.position.y) < 12) continue;
        if (Math.hypot(px - o.position.x, py - o.position.y) < 15) return false;
      }
      return true;
    });
  const bearing = (x: number, y: number) => Math.atan2(y - t.position.y, x - t.position.x);
  const apart = (x: number, y: number) =>
    avoid.every((a) => {
      let d = Math.abs(bearing(x, y) - bearing(a.x, a.y)) % (2 * Math.PI);
      if (d > Math.PI) d = 2 * Math.PI - d;
      return d >= minBearing;
    });
  let best = -1;
  let bestErr = Infinity;
  for (let i = 0; i < map.sectorGrid.length; i++) {
    if (map.sectorGrid[i] !== HOME_SECTOR) continue;
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    const err = Math.abs(Math.hypot(x - t.position.x, y - t.position.y) - dist);
    if (err < bestErr && clearOfOthers(x, y) && apart(x, y)) {
      bestErr = err;
      best = i;
    }
  }
  if (best < 0) throw new Error('tutorial: no clear spawn point for a scripted contact');
  return { x: best % map.width, y: Math.floor(best / map.width) };
}

export const LESSONS: Lesson[] = [
  {
    id: 'plot',
    title: 'Reading the plot',
    body: [
      'Cyan line: coastline. Navy dashes: depth contours. Amber haze: shallow littoral water. Red tint: threat. Amber diamond: unidentified contact.',
      'The water is divided into sectors. They are what you defend.',
    ],
    objective: 'Left-click a sector on the plot.',
    reveals: ['PANEL', 'TAB_SECTOR', 'DATE'],
    tab: 'SECTOR',
    target: HOME_SECTOR,
    gate: (v) => v.selectedSectorId !== null,
  },
  {
    id: 'sectors',
    title: 'Sectors, threat, ROE',
    body: [
      'Threat is how hard the enemy probes a sector. Rules of engagement (ROE) decide when your ships open fire.',
      'HOME APPROACHES is on HOLD FIRE: a hostile raid would get the first salvo.',
      'Hover any button before you press it: the strip under the ticker predicts its effect (costs, timings, risks, and why an action is blocked).',
    ],
    objective: 'Select HOME APPROACHES and set its ROE to RETURN FIRE.',
    anchor: 'roe',
    reveals: [],
    tab: 'SECTOR',
    target: HOME_SECTOR,
    gate: (v) => v.sectors[HOME_SECTOR].roe === 'RETURN_FIRE',
  },
  {
    id: 'station',
    title: 'Put ships on station',
    body: [
      `${TUTORIAL_TF1_NAME} is in port. Select it in the Order of Battle, then right-click HOME APPROACHES on the plot (or use Assign in the sector panel).`,
      'Press play and watch the task force sail its route.',
    ],
    objective: `Send ${TUTORIAL_TF1_NAME} to HOME APPROACHES and let it arrive.`,
    anchor: 'tab-fleet',
    reveals: ['TAB_FLEET', 'CLOCK', 'TICKER', 'READOUT_BUDGET'],
    tab: 'FLEET',
    target: HOME_SECTOR,
    gate: (v) => {
      const t = tf(v, 'TF-1');
      const a = v.map.sectors[HOME_SECTOR].anchor;
      return !!t && t.assignedSectorId === HOME_SECTOR && Math.hypot(t.position.x - a.x, t.position.y - a.y) <= 3;
    },
  },
  {
    id: 'command',
    title: 'Chain of command',
    body: [
      'Fleet, Task Force, Squadron, Hull. Every formation and every hull can carry your own name.',
      'Click the pencil beside a name to rename it.',
    ],
    objective: `Rename ${TUTORIAL_TF1_NAME}.`,
    anchor: 'tf-TF-1',
    reveals: ['ORGANISE'],
    tab: 'FLEET',
    gate: (v) => tf(v, 'TF-1')?.name !== TUTORIAL_TF1_NAME,
  },
  {
    id: 'thirds',
    title: 'Rule of thirds',
    body: [
      'Hulls wear out on patrol. Each cycles Patrol, Transit/Workup, Overhaul; aim for a third in each state.',
      'The clock now runs at 16x. Watch the frigate on patrol go to dock as its relief finishes workup and takes the station. Surge tempo would suspend rotation and buy presence at the price of breakdowns.',
    ],
    objective: 'Watch a hull rotate into the dock.',
    anchor: 'thirds',
    reveals: ['THIRDS'],
    tab: 'FLEET',
    run: { speed: 16 },
    onEnter: (w) => {
      const s = w.ships['SHP-1'];
      s.state = 'ACTIVE_PATROL';
      s.stateDays = 26;
      s.readiness = Math.max(s.readiness, 75);
      // Stage the reliefs so they finish workup as the frigate rotates out: the gauge ends at two per state.
      for (const id of ['SHP-2', 'SHP-3']) {
        const r = w.ships[id];
        r.state = 'TRANSIT_WORKUP';
        r.stateDays = 11;
        r.readiness = Math.max(r.readiness, 60);
      }
    },
    gate: (v) => newLog(v, /rotating to MAINTENANCE/),
  },
  {
    id: 'contact',
    title: 'Contact and engagement',
    body: [
      'Two unidentified tracks are closing on TF 11. One is a raider; the other may not be. Decide how your ships may fire in HOME APPROACHES.',
      'HOLD FIRE: the raider fires first and halves your engagement window. RETURN FIRE: engage tracks once identified hostile. WEAPONS FREE: the longest window, but anything unidentified in range is engaged, civilians included (an incident costs political capital and raises tension).',
      'The clock starts once you choose. Compare the "window" seconds in the ticker to see what your ROE bought.',
    ],
    objective: 'Set the ROE for HOME APPROACHES (any option), then watch the engagement.',
    anchor: 'roe',
    reveals: [],
    tab: 'SECTOR',
    select: HOME_SECTOR,
    target: HOME_SECTOR,
    run: { speed: 4, when: (v) => newLog(v, /^ROE SECTOR 1:/) },
    onEnter: (w) => {
      // Hostile raider ~28 tiles out, plus a neutral merchant ~24 tiles out on another bearing: under WEAPONS FREE the
      // merchant is fired on while still unidentified (an incident); under the other ROEs it is identified and ignored.
      const raider = spawnPursuer(w, 'TF-1', 28, []);
      w.contacts.push(
        { id: 'CT-TUT-RAID', sectorId: HOME_SECTOR, position: raider, heading: 0, cls: 'UNKNOWN', hostile: true, intent: 'RAIDER', strength: 20, bornTick: w.tick, expiresTick: w.tick + 40, pursue: 'TF-1' },
      );
      const merchant = spawnPursuer(w, 'TF-1', 24, [raider], 0.9);
      w.contacts.push(
        { id: 'CT-TUT-MERCH', sectorId: HOME_SECTOR, position: merchant, heading: 0, cls: 'UNKNOWN', hostile: false, intent: 'MERCHANT', strength: 0, bornTick: w.tick, expiresTick: w.tick + 40, pursue: 'TF-1' },
      );
      w.events.push({ severity: 'WARNING', text: 'NEW CONTACTS: two unidentified tracks in HOME APPROACHES, closing on TF 11' });
    },
    gate: (v) => newLog(v, /ENGAGEMENT/),
  },
  {
    id: 'challenge',
    title: 'Challenge the unknown',
    body: [
      'A second track is closing on TF 11 and it does not transmit. ROE only decides when to shoot; before that you can work a contact up the ladder: shadow, hail, warn, board, engage.',
      'Its panel is open. Hover each step to see its range and what each kind of vessel does in response, then order a HAIL. If it stays silent, BOARD it. The clock starts when you give an order.',
      'The sector procedure (SOP) CHALLENGE does this on its own: hail, warn the silent, board runners. You are on OBSERVE for now.',
    ],
    objective: 'Hail the silent contact, then board it.',
    anchor: 'contact-panel',
    reveals: [],
    tab: 'SECTOR',
    select: HOME_SECTOR,
    selectContact: 'CT-TUT-SMUG',
    target: HOME_SECTOR,
    run: { speed: 1, when: (v) => v.contacts.some((c) => c.id === 'CT-TUT-SMUG' && (!!c.order || !!c.hailed)) },
    onEnter: (w) => {
      // Clear left-overs from the raid lesson (e.g. the merchant) so the plot shows one track.
      w.contacts = w.contacts.filter((c) => c.id !== 'CT-TUT-MERCH');
      const at = spawnPursuer(w, 'TF-1', 24, []);
      w.contacts.push({
        id: 'CT-TUT-SMUG', sectorId: HOME_SECTOR, position: at, heading: 0, cls: 'UNKNOWN', hostile: false, intent: 'SMUGGLER',
        strength: 0, bornTick: w.tick, expiresTick: w.tick + 60, pursue: 'TF-1', order: null,
      });
      w.events.push({ severity: 'WARNING', text: 'NEW CONTACT: silent track in HOME APPROACHES, closing on TF 11' });
    },
    // Seized, escaped or otherwise gone: every outcome teaches the ladder.
    gate: (v) => !v.contacts.some((c) => c.id === 'CT-TUT-SMUG'),
  },
  {
    id: 'spares',
    title: 'Breakdowns and spares',
    body: [
      'The corvette in dock has a failed surface radar and there is no spare in stock.',
      'Open the Spares yard and buy one (+1), then run the clock: docks repair from stock. With no stock, a docked hull can be stripped as a Parts Hulk.',
    ],
    objective: 'Buy a {m:SEN_DOM_DSR2} spare and let the corvette finish repairs.',
    anchor: 'spares',
    reveals: ['SPARES'],
    tab: 'FLEET',
    run: { speed: 4, when: (v) => (v.spares['SEN_DOM_DSR2'] ?? 0) > 0 },
    onEnter: (w) => {
      dock(w, 'SHP-3', 40, 'SEN_DOM_DSR2');
      w.ships['SHP-3'].integrity = 85;
      w.spares['SEN_DOM_DSR2'] = 0;
    },
    gate: (v) => !!v.ships['SHP-3'] && v.ships['SHP-3'].modules.every((m) => !m.failed),
  },
  {
    id: 'design',
    title: 'Design bureau',
    body: [
      'Open the Design Bureau. The preset corvette draws more power than its plant generates, so it cannot be laid down.',
      `Change its power plant to the {m:PP_DOM_D12}, keep the {v:ASELSAN} radar and the {v:NAVAL_GROUP_THALES} CMS, and lay the hull down.`,
      'A hull is bought on contract: a 30% deposit now, the balance paid daily while it builds. A hull under construction can still be cancelled (refunds depend on who broke the deal) or sold.',
    ],
    objective: 'Lay down a valid corvette with the {m:SEN_ASEL_SPEAR} and the {m:CMS_NG_TACTICOS}.',
    anchor: 'design-btn',
    reveals: ['DESIGN_BTN', 'READOUT_INDUSTRY'],
    tab: 'FLEET',
    preset: TUTORIAL_PRESET,
    gate: (v) =>
      Object.values(v.ships).some(
        (s) => s.buildStatus === 'CONSTRUCTING' && s.modules.some((m) => m.moduleId === 'SEN_ASEL_SPEAR') && s.modules.some((m) => m.moduleId === 'CMS_NG_TACTICOS'),
      ),
  },
  {
    id: 'friction',
    title: 'Integration friction and R&D',
    body: [
      'The {v:ASELSAN} radar speaks {x:NATO_LINK16} and the {v:NAVAL_GROUP_THALES} CMS speaks {x:TACTICOS_ETHERNET}. Mismatched protocols add friction: slower reaction and tracking lag.',
      'Open R&D and start the {p:BR_L16_TAC}. Once complete it removes the penalty fleet-wide, permanently.',
    ],
    objective: 'Complete the {p:BR_L16_TAC}.',
    anchor: 'tab-rnd',
    reveals: ['TAB_RND', 'READOUT_RP'],
    tab: 'RND',
    run: { speed: 16, when: (v) => v.research.active.includes('BR_L16_TAC') },
    gate: (v) => v.research.completed.includes('BR_L16_TAC'),
  },
  {
    id: 'sanctions',
    title: 'Sanctions and lobbying',
    body: [
      "The government behind {v:ASELSAN} signals an export freeze in 12 days. A frozen vendor stalls construction and blocks spares.",
      'Open Diplomacy and lobby to raise {v:ASELSAN} standing to 65 before the deadline. Political capital pays for it.',
    ],
    objective: 'Raise {v:ASELSAN} standing to 65.',
    anchor: 'vendor-ASELSAN',
    reveals: ['TAB_DIPLO', 'READOUT_PC', 'READOUT_TENSION'],
    tab: 'DIPLO',
    onEnter: (w) => {
      const v = w.vendors.ASELSAN;
      v.status = 'WARNING';
      v.pendingSanction = 'EXPORT_FREEZE';
      v.statusUntilTick = w.tick + 12;
      v.standing = 52;
      w.events.push({ severity: 'WARNING', text: 'EXPORT RISK: {v:ASELSAN} signals EXPORT FREEZE in 12 days — lobby to avert' });
    },
    gate: (v) => v.vendors.ASELSAN.standing >= 65,
  },
  {
    id: 'suppliers',
    title: 'Opening a supplier',
    body: [
      'Foreign vendors climb a ladder: contact, trade mission, framework agreement (tier-0 lines only), signed (tiers by standing), strategic partner. Each step costs political capital, later money, and takes days.',
      'Each vendor state has its own export regime: {v:NORDVIK} is stable but punishes every incident your navy causes. Deals with the Eastern bloc cost standing in the West. Scout for suppliers to find ones you do not know yet.',
      'A product can hide another state\'s components, and that state\'s sanctions reach it too. Due diligence on a vendor reveals what is inside before you buy.',
    ],
    objective: 'Open a trade mission with {v:NORDVIK}.',
    anchor: 'vendor-NORDVIK',
    reveals: [],
    tab: 'DIPLO',
    gate: (v) => v.vendors.NORDVIK.rung !== 'CONTACT' || v.vendors.NORDVIK.rungProgress !== null,
  },
  {
    id: 'homefront',
    title: 'The home front',
    body: [
      'The civilian government funds the navy: an annual appropriation paid in four quarterly tranches, spent on running costs (crews are paid even in dock) and purchases. At year end only 15% carries over; the rest returns to the Treasury, and spending too slowly shrinks next year\'s budget.',
      'Domestic support sets that budget and your political-capital income. Incidents, losses and unopposed raids cost support. Below 40 lobbying costs more; below 25 ministries stop taking your calls. A budget hearing can win more money; the strip shows the odds.',
    ],
    objective: 'Hold a budget hearing (Home front, at the top of Diplomacy).',
    anchor: 'home-front',
    reveals: ['READOUT_SUPPORT'],
    tab: 'DIPLO',
    gate: (v) => newLog(v, /BUDGET HEARING/),
  },
  {
    id: 'escort',
    title: 'Shipping under threat',
    body: [
      'Civilian ships sail identified along shipping lanes (dotted). Raiders hunt them wherever nothing is watching: a ship is protected by a task force within 14 tiles, or by one holding its sector. Losses cost support and, through the war-risk premium, the trade index that feeds next year\'s budget.',
      'A tanker under the {c:ASELSAN} flag is running the lane from BEYOND THE STRAIT, and an unidentified track lies in wait at the strait mouth. Its panel is open. Hover Escort on your frigate group (the first task force listed): it leaves the home sector uncovered while it is away. Order it; the clock starts when you do.',
    ],
    objective: 'Escort the tanker through the strait to port.',
    anchor: 'merchant-panel',
    reveals: ['SHIPPING'],
    tab: 'SECTOR',
    target: BEYOND_SECTOR,
    selectMerchant: 'MV-TUT-1',
    run: { speed: 4, when: (v) => escorting(v, 'MV-TUT-1') },
    onEnter: (w) => {
      w.contacts = w.contacts.filter((c) => !c.id.startsWith('CT-TUT'));
      const lane = tutorialLane(w);
      w.shipping.lanes = [lane];
      w.shipping.seq = 1;
      w.shipping.ships = [tutorialShip(w, lane, { id: 'MV-TUT-1', name: 'Amber Wayfarer', kind: 'TANKER', flag: 'ASELSAN', dist: 30, cargo: 70 })];
      // The raider lies in wait on the lane at the strait mouth, still in the uncovered outer sector.
      const at = pointAt(lane.path, 84).pos;
      w.contacts.push({
        id: 'CT-TUT-PIRATE', sectorId: BEYOND_SECTOR, position: at, heading: Math.PI, cls: 'UNKNOWN', hostile: true, intent: 'RAIDER',
        strength: 20, bornTick: w.tick, expiresTick: w.tick + 150,
      });
      w.events.push({ severity: 'WARNING', text: 'SHIPPING ADVISORY: TKR AMBER WAYFARER inbound from BEYOND THE STRAIT; an unidentified track is reported near the strait mouth' });
    },
    // Any outcome ends the lesson (arrived, lost or foundered): each teaches what cover is worth.
    gate: (v) => !v.shipping.ships.some((m) => m.id === 'MV-TUT-1'),
  },
  {
    id: 'search',
    title: 'Searching a suspect ship',
    body: [
      'Some ships carry contraband. Intelligence has tipped off a container ship on the lane (the TIP-OFF chip). Tips are mostly right and sometimes wrong, and searching an innocent ship costs support and standing with its flag state.',
      'Order your frigate group to search it: it goes alongside, holds the ship for two days, then either seizes the cargo (money, support) or lets it go. Hover Search to read both outcomes first. Exclusion orders, the heavy version of this, come later and always give notice.',
    ],
    objective: 'Search the tipped container ship.',
    anchor: 'merchant-panel',
    reveals: ['INSPECT'],
    tab: 'SECTOR',
    selectMerchant: 'MV-TUT-2',
    run: { speed: 4, when: (v) => escorting(v, 'MV-TUT-2') },
    onEnter: (w) => {
      w.contacts = w.contacts.filter((c) => !c.id.startsWith('CT-TUT'));
      const lane = w.shipping.lanes[0] ?? tutorialLane(w);
      w.shipping.lanes = [lane];
      const t1 = w.fleets.flatMap((f) => f.taskForces).find((t) => t.id === 'TF-1')!;
      // A lane point in the home sector about 22 tiles from TF 11, with plenty of lane left to sail.
      let best = 100;
      let bestErr = Infinity;
      for (let d = 90; d <= 160; d++) {
        const p = pointAt(lane.path, d).pos;
        const err = Math.abs(Math.hypot(p.x - t1.position.x, p.y - t1.position.y) - 22);
        if (err < bestErr) {
          bestErr = err;
          best = d;
        }
      }
      w.shipping.seq = Math.max(w.shipping.seq, 2);
      w.shipping.ships = [tutorialShip(w, lane, { id: 'MV-TUT-2', name: 'Grey Tern', kind: 'CONTAINER', flag: 'OPEN_REGISTRY', dist: best, cargo: 80, contraband: true, tip: true })];
      w.events.push({ severity: 'ADVISORY', text: 'INTELLIGENCE: a tip-off names CON GREY TERN (open registry) as carrying contraband' });
    },
    gate: (v) => {
      const m = v.shipping.ships.find((x) => x.id === 'MV-TUT-2');
      return !m || (m.checked && !m.inspecting);
    },
  },
  {
    id: 'embargo',
    title: 'Parts embargo and cannibalisation',
    body: [
      "The government behind {v:NAVAL_GROUP_THALES} has embargoed spares: stock cannot be bought or fitted. The frigate in dock needs a new CMS.",
      'The worn reserve frigate in dock has a dead power plant but a working CMS. Press the skull on its row to designate it a Parts Hulk; its CMS is cannibalised for the repair. A hulk can be restored to service later, once parts flow again.',
    ],
    objective: 'Repair the frigate by cannibalising a Parts Hulk.',
    anchor: 'hulk-SHP-6',
    reveals: ['HULK'],
    tab: 'FLEET',
    run: { speed: 4, when: (v) => Object.values(v.ships).some((s) => s.isPartsHulk) },
    onEnter: (w) => {
      const ng = w.vendors.NAVAL_GROUP_THALES;
      ng.status = 'FROZEN';
      ng.statusUntilTick = w.tick + 60;
      ng.pendingSanction = null;
      w.sanctions.push({ id: `SAN-TUT-${w.tick}`, vendorId: 'NAVAL_GROUP_THALES', kind: 'PARTS_EMBARGO', startTick: w.tick, endTick: w.tick + 60 });
      dock(w, 'SHP-1', 45, 'CMS_NG_TACTICOS');
      w.ships['SHP-1'].isPartsHulk = false;
      // The reserve frigate stays laid up even if the player bought it a power plant earlier.
      const reserve = w.ships['SHP-6'];
      if (reserve && !reserve.isPartsHulk && reserve.state !== 'MAINTENANCE_DOCK') dock(w, 'SHP-6', 40);
      if (reserve && !reserve.modules.some((m) => m.failed)) reserve.modules.find((m) => m.slot === 'POWERPLANT')!.failed = true;
      w.spares['CMS_NG_TACTICOS'] = 0;
      w.events.push({ severity: 'CRITICAL', text: '{v:NAVAL_GROUP_THALES}: PARTS EMBARGO for 60 days — their spares cannot be fitted (cannibalise hulks!)' });
    },
    gate: (v) => !!v.ships['SHP-1'] && v.ships['SHP-1'].modules.every((m) => !m.failed) && Object.values(v.ships).some((s) => s.isPartsHulk),
  },
  {
    id: 'sonar',
    title: 'Under the surface',
    body: [
      'Enemy submarines cannot be seen: only sonar finds them. The listening posts report unusual acoustic activity, and the frigate Hearken (hull sonar, torpedo tubes) has joined TF 11 off the home port. The dashed circle on the plot is a possible submarine, a datum.',
      'Let the clock run: as the sonar holds the contact the circle shrinks and the track becomes a contact (SUB?). Select it in the sector panel, then hover Warn: active pinging makes most intruders leave. Engage needs torpedoes in reach and, against a boat that has not attacked, WEAPONS FREE; a foreign boat is an incident. Without sonar none of this is possible.',
    ],
    objective: 'Hold the submarine on sonar and ping it (Warn).',
    anchor: 'contact-panel',
    reveals: [],
    tab: 'SECTOR',
    select: HOME_SECTOR,
    target: HOME_SECTOR,
    run: { speed: 1 },
    onEnter: (w) => {
      const sec = w.map.sectors[HOME_SECTOR];
      const task = w.fleets.flatMap((f) => f.taskForces).find((t) => t.id === 'TF-1')!;
      task.position = { ...sec.anchor };
      task.assignedSectorId = HOME_SECTOR;
      task.route = [];
      const listener = createShip({ id: 'SHP-7', name: 'Hearken', pennant: 'F707', hullId: 'FRIGATE', designName: 'Briefing-class ASW Frigate', moduleIds: ['PP_DOM_D12', 'CMS_DOM_OB1', 'SEN_DOM_DSR2', 'SEN_SONAR_HULL', 'ARM_DOM_DSAM8', 'ARM_DOM_TORP'], constructing: false, state: 'ACTIVE_PATROL', readiness: 100, tick: w.tick });
      w.ships[listener.id] = listener;
      task.squadrons[0].shipIds.push(listener.id);
      w.sectors[HOME_SECTOR].sop = 'OBSERVE';
      w.contacts = w.contacts.filter((c) => c.hostile === false && c.cls !== 'HOSTILE');
      w.contacts.push({
        id: 'CT-TUT-SUB', sectorId: HOME_SECTOR, position: { x: sec.anchor.x + 3, y: sec.anchor.y }, heading: 0, cls: 'UNKNOWN', hostile: true, intent: 'SUBMARINE', strength: 60,
        bornTick: w.tick, expiresTick: w.tick + 400, submerged: true, track: 45, stealth: 50, attacks: 0, nextAttackTick: w.tick + 999,
      });
      w.events.push({ severity: 'ADVISORY', text: 'UNUSUAL ACOUSTIC ACTIVITY off the home port — a possible submarine datum is plotted' });
    },
    gate: (v) => newLog(v, /pings a submerged contact|HOSTILE SUBMARINE, still closing|SUBMARINE KILLED/),
  },
  {
    id: 'graduation',
    title: 'Graduation',
    body: [
      'Briefing complete. Every panel is open, random events are live, and your task forces now hail, warn and board unknown contacts on their own (sector SOP: CHALLENGE).',
      'BEYOND THE STRAIT (threat 70) is uncovered. TF 12\'s fast attack craft carry almost no air defence: against a raid there they would be crippled and sent back for weeks of repair (or sunk outright if the raid is heavy). Hover Assign to compare, then decide which force goes and what is left at home. Coverage is your scarcest resource.',
      'Shipping is live on every lane, and so are the heavy levers in the Sector overview: standing search orders and maritime exclusion orders. Exclusion orders give notice, cost standing, trade and support at home, and count every casualty; read the strip before you commit.',
    ],
    objective: 'Assign a task force to BEYOND THE STRAIT.',
    reveals: ['*'],
    tab: 'SECTOR',
    target: BEYOND_SECTOR,
    onEnter: (w) => {
      w.scripted = false;
      w.policy.autoSpares = true;
      // Hand over the free-play default: task forces now hail, warn and board unknown contacts on their own.
      for (const st of Object.values(w.sectors)) st.sop = 'CHALLENGE';
      w.sectors[BEYOND_SECTOR].threat = 70;
      // Every lane opens (the briefing used one); ships already sailing keep their lane.
      w.shipping.lanes = generateLanes(w.map, w.seed).map((l) => w.shipping.lanes.find((x) => x.id === l.id) ?? l);
      w.events.push({ severity: 'ADVISORY', text: 'BRIEFING COMPLETE — random events live, standing orders restored' });
    },
    gate: (v) => v.fleets.some((f) => f.taskForces.some((t) => t.assignedSectorId === BEYOND_SECTOR)),
  },
];


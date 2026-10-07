/**
 * Battle reports and the weight of a loss. The engagement maths in combatSim stays the same; this turns its facts (who fired, who was
 * hit, what leaked, how it ended) into a short account in the staff's voice, and prices losses by what the ship was.
 *
 * Sea state and time of day are colour only: they do not change the engagement.
 */
import { HULLS } from '../data/catalog';
import { Rng } from '../generator/prng';
import type { Ship } from '../types/fleet';
import type { HullClassId } from '../types/hull';
import type { Vec2 } from '../types/map';
import type { FallenShip } from '../types/world';
import type { EngagementResult, Outcome } from './combatSim';

// ------------------------------------------------------------------------------------------ what a loss means

/** Domestic support lost with a warship, by class: a FAC is a tragedy, a carrier is a national disaster. */
export const LOSS_SUPPORT: Record<HullClassId, number> = { FAC: 3, CORVETTE: 5, FRIGATE: 8, DESTROYER: 13, CARRIER: 22 };
/** Political capital lost with a capital ship (the cabinet wants answers). */
export const LOSS_PC: Record<HullClassId, number> = { FAC: 0, CORVETTE: 0, FRIGATE: 0, DESTROYER: 4, CARRIER: 10 };
/** Crew aboard, for the casualty figure. */
export const CREW: Record<HullClassId, number> = { FAC: 30, CORVETTE: 90, FRIGATE: 190, DESTROYER: 300, CARRIER: 1400 };
export const ROLL_CAP = 30;
export const isCapital = (h: HullClassId) => h === 'DESTROYER' || h === 'CARRIER';

export function fallenRecord(ship: Ship, tick: number, where: string): FallenShip {
  return {
    name: ship.name,
    pennant: ship.pennant,
    hull: HULLS[ship.hullId].name,
    tick,
    crew: CREW[ship.hullId],
    serviceDays: ship.commissionedTick === null ? 0 : tick - ship.commissionedTick,
    engagements: ship.engagements ?? 0,
    where,
  };
}

export function lossText(f: FallenShip, hullId: HullClassId, veterancy: number): string {
  const vet = veterancy >= 60 ? 'a veteran crew' : veterancy >= 30 ? 'a seasoned crew' : 'a green crew';
  const service = f.serviceDays > 0 ? `${f.serviceDays} days in commission, ${f.engagements} engagement${f.engagements === 1 ? '' : 's'}, ${vet}` : 'never completed workup';
  const capital = isCapital(hullId) ? ` — A CAPITAL SHIP: the cabinet demands answers (support −${LOSS_SUPPORT[hullId]}, political capital −${LOSS_PC[hullId]})` : ` (support −${LOSS_SUPPORT[hullId]})`;
  return `LOST: ${f.pennant} ${f.name.toUpperCase()} (${f.hull}) sunk in ${f.where} — ${f.crew} crew lost; ${service}${capital}`;
}

// ------------------------------------------------------------------------------------------ sea and time

export type TimeOfDay = 'DAWN' | 'DAY' | 'DUSK' | 'NIGHT';
export type SeaState = 'CALM' | 'MODERATE' | 'ROUGH' | 'HEAVY';
const SEA: SeaState[] = ['CALM', 'MODERATE', 'ROUGH', 'HEAVY'];
const TIMES: TimeOfDay[] = ['DAWN', 'DAY', 'DUSK', 'NIGHT'];

/** Sea state of a sector: drifts slowly (changes every ~4 days), deterministic. Colour only. */
export function seaState(seed: string, tick: number, sectorId: number): SeaState {
  const r = new Rng(`${seed}:sea:${sectorId}:${Math.floor(tick / 4)}`).next();
  return SEA[r < 0.35 ? 0 : r < 0.75 ? 1 : r < 0.93 ? 2 : 3];
}
export function timeOfDay(seed: string, tick: number, key: string): TimeOfDay {
  return TIMES[Math.floor(new Rng(`${seed}:tod:${tick}:${key}`).next() * 4)];
}
export const conditionsText = (seed: string, tick: number, sectorId: number) => `${seaState(seed, tick, sectorId)} SEAS`;

/** 8-point compass bearing from `from` to `to` (map y grows southward). */
export function compass(from: Vec2, to: Vec2): string {
  const a = (Math.atan2(from.x - to.x, -(from.y - to.y)) * 180) / Math.PI; // bearing of `from` as seen from `to`
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((a % 360) + 360) % 360) / 45) % 8];
}

// ------------------------------------------------------------------------------------------ the report

export interface StoryShip {
  id: string;
  name: string;
  hull: HullClassId;
  /** Integrity before the raid, and after (0 = lost). */
  before: number;
  after: number;
  lost: boolean;
  crippled: boolean;
}

export interface StoryContext {
  seed: string;
  tick: number;
  contactId: string;
  sectorLabel: string;
  sectorId: number;
  strength: number;
  missiles: number;
  /** Where the raid came from relative to the force. */
  bearing: string;
  surprise: boolean;
  outcome: Outcome;
  result: EngagementResult;
  ships: StoryShip[];
}

const pick = <T,>(rng: Rng, xs: T[]) => xs[rng.int(0, xs.length - 1)];
const CLASS: Record<HullClassId, string> = { FAC: 'fast attack craft', CORVETTE: 'corvette', FRIGATE: 'frigate', DESTROYER: 'destroyer', CARRIER: 'carrier' };

/** Three to six lines, each short enough for the ticker. Pure and deterministic given the context. */
export function battleStory(c: StoryContext): string[] {
  const rng = new Rng(`${c.seed}:story:${c.contactId}:${c.tick}`);
  const r = c.result;
  const out: string[] = [];
  const time = timeOfDay(c.seed, c.tick, c.contactId);
  const sea = seaState(c.seed, c.tick, c.sectorId);
  const by = (id: string) => c.ships.find((s) => s.id === id)!;
  const nm = (s: StoryShip) => `${CLASS[s.hull]} ${s.name.toUpperCase()}`;

  // 1. Detection
  const where = `from the ${c.bearing} in ${c.sectorLabel}`;
  const setting = `${time}, ${sea.toLowerCase()} seas`;
  if (c.surprise) out.push(`${setting}: the raid breaks cover ${where} with the force's sensors cold. ${r.incoming} missiles are already in the air.`);
  else if (r.warningKm <= 0) out.push(`${setting}: no radar warning at all. ${r.incoming} sea-skimmers arrive ${where} out of the clutter.`);
  else out.push(pick(rng, [
    `${setting}: ${r.incoming} sea-skimmers are picked up ${where} at about ${r.warningKm.toFixed(0)} km.`,
    `${setting}: radar reports a raid of ${r.incoming} missiles inbound ${where}, ${r.warningKm.toFixed(0)} km out.`,
  ]));

  // 2. The defence
  const shooters = [...r.shooters].sort((a, b) => b.kills - a.kills);
  const best = shooters[0];
  if (!best || r.shooters.every((s) => s.shots === 0)) out.push('No ship has a firing window: the defence never opens.');
  else {
    const who = by(best.id);
    const friction = r.frictionCostSec > 0.5 ? ` Mismatched data links cost the force ${r.frictionCostSec.toFixed(1)} s it did not have.` : '';
    if (r.leakers === 0) out.push(`${nm(who)} leads the defence: ${best.shots} interceptors, ${best.kills} kills, and not one missile reaches the force.${friction}`);
    else out.push(`${nm(who)} leads the defence with ${best.kills} kills from ${best.shots} interceptors; ${r.intercepted} of ${r.incoming} are stopped.${friction}`);
  }

  // 3. What got through
  if (r.leakers > 0) {
    const hit = c.ships.filter((s) => (r.hits[s.id] ?? 0) > 0).sort((a, b) => (r.hits[b.id] ?? 0) - (r.hits[a.id] ?? 0));
    out.push(`${r.leakers} missile${r.leakers === 1 ? '' : 's'} leak through.`);
    for (const s of hit.slice(0, 3)) {
      const n = r.hits[s.id];
      const strikes = n === 1 ? 'struck once' : `struck ${n} times`;
      if (s.lost) out.push(`${nm(s)} is ${strikes} and goes down${isCapital(s.hull) ? ' as the force looks on' : ''}.`);
      else if (s.crippled) out.push(`${nm(s)} is ${strikes}, burning and dead in the water at ${s.after.toFixed(0)}% — she breaks off for the yard.`);
      else out.push(`${nm(s)} is ${strikes}: integrity ${s.before.toFixed(0)}% → ${s.after.toFixed(0)}%.`);
    }
  }

  // 4. How it ended
  const closing: Record<Outcome, string[]> = {
    DESTROYED: ['The return salvos finish the raiding group; nothing is left to follow up.', 'Return fire destroys the raiders before they can turn for home.'],
    REPELLED: ['The raiders break off, mauled, and withdraw beyond the horizon.', 'Hurt by the return fire, the raiders turn away and are gone.'],
    DEFEAT: ['The raid presses home and the force is left to count its damage; the raiders slip away.', 'The attackers are not stopped, and the force is in no state to pursue.'],
  };
  out.push(pick(rng, closing[c.outcome]));
  if (c.ships.some((s) => s.lost)) out.push(c.ships.filter((s) => s.lost).length > 1 ? 'The ledger records the names of the lost.' : 'The ledger records her name.');
  return out;
}

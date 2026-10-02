/**
 * Contacts and the escalation ladder (docs/PLAN-command-and-economy.md §3).
 *
 * Every contact has a hidden intent. Task forces work it up the ladder — SHADOW → HAIL → WARN → BOARD → ENGAGE — either
 * automatically, per the sector's standing operating procedure (SOP), or by the player's per-contact order. ROE is the ceiling
 * on ENGAGE. Each intent answers each step differently, so every step both reveals information and carries a risk.
 */
import { Rng } from '../generator/prng';
import type { Ship } from '../types/fleet';
import type { Bridges, Contact, ContactIntent, LadderAction, Roe, Sop, WorldDraft } from '../types/world';
import { CRIPPLED_FLOOR, resolveEngagement, sinkChance, WITHDRAW_BELOW } from './combatSim';
import { allTaskForces, combatantOf, removeShip, sendToRepair, taskForceShipIds } from './fleetEngine';
import { adjustSupport } from './politicsEngine';
import { laneAmbush, nearestMerchant, PREY_RANGE } from './shipping';
import { DETER_STRENGTH_PER_PRESENCE, SPAWN_DETERRENCE, SPAWN_DETERRENCE_CAP, sectorPresence, taskForcePresence } from './presence';

export const IDENTIFY_RANGE = 10;
export const ENGAGE_RANGE = 12;
/** Maximum distance (tiles from the nearest active task force) at which each step can be carried out. */
export const ACTION_RANGE: Record<LadderAction, number> = { SHADOW: 30, HAIL: 26, WARN: 20, BOARD: 16, ENGAGE: ENGAGE_RANGE };
/** Automatic SOP trigger distances. */
export const SOP_RANGES: Record<Sop, { hail: number; warn: number; board: number }> = {
  OBSERVE: { hail: 0, warn: 0, board: 0 },
  CHALLENGE: { hail: 20, warn: 14, board: 16 },
  ASSERTIVE: { hail: 26, warn: 14, board: 16 },
};
export const SMUGGLER_SEIZURE = 25;
const BOARD_P_STEADY = 0.95;
const BOARD_P_FLEEING = 0.55;

export const INTENT_LABEL: Record<ContactIntent, string> = {
  MERCHANT: 'MERCHANT VESSEL',
  FISHING: 'FISHING FLEET',
  SMUGGLER: 'SMUGGLER',
  SHADOWER: 'SURVEILLANCE SHADOWER',
  WARSHIP: 'FOREIGN WARSHIP',
  RAIDER: 'RAIDER',
};
/** Intents that answer a hail. */
export const ANSWERS_HAIL: Record<ContactIntent, boolean> = { MERCHANT: true, FISHING: true, WARSHIP: true, SMUGGLER: false, SHADOWER: false, RAIDER: false };

const clamp = (v: number, lo = 0, hi = 100) => (v < lo ? lo : v > hi ? hi : v);
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/** What the player may know about a contact (never the hidden intent unless revealed). */
export function contactStatus(c: Contact): string {
  if (c.cls !== 'UNKNOWN') return INTENT_LABEL[c.intent];
  if (c.fleeing) return 'RUNNING';
  if (c.suspicious) return 'NO RESPONSE';
  return 'UNIDENTIFIED';
}

/** Label for the plot: short. */
export function contactTag(c: Contact): string {
  if (c.cls === 'HOSTILE') return `HOSTILE ${c.strength.toFixed(0)}`;
  if (c.cls === 'NEUTRAL') return { MERCHANT: 'MERCH', FISHING: 'FISH', WARSHIP: 'WARSHIP', SMUGGLER: 'SMUG', SHADOWER: 'SHADOW', RAIDER: 'RAIDER' }[c.intent];
  if (c.fleeing) return 'RUNNING';
  if (c.suspicious) return 'NO RESP';
  return 'UNK';
}

// ------------------------------------------------------------------------------------------ task-force helpers

export function activeShipsOf(w: WorldDraft, tfId: string): Ship[] {
  const tf = allTaskForces(w.fleets).find((t) => t.id === tfId);
  if (!tf) return [];
  return taskForceShipIds(tf)
    .map((id) => w.ships[id])
    .filter((s): s is Ship => !!s && s.buildStatus === 'COMMISSIONED' && !s.isPartsHulk && s.state !== 'MAINTENANCE_DOCK');
}

/** Nearest task force with at least one ship at sea, at any range. */
export function nearestActiveTf(w: WorldDraft, x: number, y: number): { id: string; d: number } | null {
  let best: { id: string; d: number } | null = null;
  for (const tf of allTaskForces(w.fleets)) {
    const d = dist(tf.position.x, tf.position.y, x, y);
    if ((!best || d < best.d) && activeShipsOf(w, tf.id).length > 0) best = { id: tf.id, d };
  }
  return best;
}

// ------------------------------------------------------------------------------------------ rules

/** Why an action may not be taken against this contact under this ROE (null = allowed). Range is checked separately. */
export function actionBlocked(c: Contact, roe: Roe, action: LadderAction): string | null {
  switch (action) {
    case 'SHADOW':
      return null;
    case 'HAIL':
      return c.hailed || c.cls !== 'UNKNOWN' ? 'ALREADY IDENTIFIED OR HAILED' : null;
    case 'WARN':
      return c.warned ? 'ALREADY WARNED' : null;
    case 'BOARD':
      return c.cls === 'NEUTRAL' && c.intent === 'WARSHIP' ? 'SOVEREIGN IMMUNITY — A FOREIGN WARSHIP CANNOT BE BOARDED' : null;
    case 'ENGAGE':
      if (roe === 'HOLD_FIRE') return 'ROE HOLD FIRE — ENGAGEMENT ONLY IN SELF-DEFENCE';
      if (roe === 'RETURN_FIRE' && c.cls !== 'HOSTILE') return 'ROE RETURN FIRE — ONLY IDENTIFIED HOSTILES MAY BE ENGAGED';
      return null;
  }
}

/** The step the sector SOP would take today at distance `d`, or null. */
export function sopAction(c: Contact, sop: Sop, d: number): LadderAction | null {
  const r = SOP_RANGES[sop];
  if (sop === 'OBSERVE' || c.cls === 'HOSTILE') return null;
  if (!c.hailed && c.cls === 'UNKNOWN' && d <= r.hail) return 'HAIL';
  if (sop === 'CHALLENGE') {
    if (c.suspicious && !c.warned && d <= r.warn) return 'WARN';
    if (c.fleeing && d <= r.board) return 'BOARD';
  } else {
    // ASSERTIVE: board silent contacts before they can run; warn foreign warships off.
    if (c.suspicious && !c.warned && !c.fleeing && d <= r.board) return 'BOARD';
    if (c.fleeing && d <= r.board) return 'BOARD';
    if (c.cls === 'NEUTRAL' && c.intent === 'WARSHIP' && !c.warned && d <= r.warn) return 'WARN';
  }
  return null;
}

/** What a step does to each intent — shown in previews so the stakes are known before acting (the intent itself stays hidden). */
export const OUTCOMES: Record<Exclude<LadderAction, 'SHADOW'>, string> = {
  HAIL: 'merchants, fishers and warships answer and are identified; smugglers, shadowers and raiders stay silent (NO RESPONSE)',
  WARN: 'a shadower breaks off; a smuggler runs; a raider drops its cover (it may attack at once, but without surprise); warning a lawful vessel is harassment (support −1), a warship protests (tension +3)',
  BOARD: `a smuggler is seized (+${SMUGGLER_SEIZURE}M, support +2; 55% if running); boarding a shadower is a sovereignty protest (tension +6); a clean merchant protests (support −2); an unidentified warship is an incident; a disguised raider AMBUSHES the boarding party`,
  ENGAGE: 'a raider is destroyed or repelled; a smuggler sunk is excessive force (support −2); firing on a merchant, fisher, shadower or warship is an INCIDENT (PC, tension, support; worst for warships)',
};

// ------------------------------------------------------------------------------------------ consequences

function label(w: WorldDraft, c: Contact) {
  return `CONTACT ${c.id.slice(3, 11)} (${w.map.sectors[c.sectorId].label})`;
}

function identify(c: Contact) {
  c.cls = c.hostile ? 'HOSTILE' : 'NEUTRAL';
  if (!c.hostile) c.pursue = undefined; // identified neutrals resume their own course
}

function incident(w: WorldDraft, c: Contact, text: string, severity: { pc: number; tension: number; support: number }) {
  w.events.push({ severity: 'CRITICAL', text: `INCIDENT: ${text} in ${w.map.sectors[c.sectorId].label} — diplomatic fallout` });
  w.resources.politicalCapital = clamp(w.resources.politicalCapital - severity.pc, 0, 60);
  w.tension = clamp(w.tension + severity.tension);
  adjustSupport(w, -severity.support);
  w.stats.incidents++;
  w.stats.lastIncidentTick = w.tick;
}

type StepResult = 'KEEP' | 'REMOVE' | { engage: string; surprise: boolean };

function execute(w: WorldDraft, c: Contact, action: LadderAction, tfId: string, rng: Rng): StepResult {
  const st = w.sectors[c.sectorId];
  const L = label(w, c);
  switch (action) {
    case 'SHADOW':
      return 'KEEP';
    case 'HAIL':
      c.hailed = true;
      if (ANSWERS_HAIL[c.intent]) {
        identify(c);
        w.events.push({ severity: 'INFO', text: `${L} answers the hail: ${INTENT_LABEL[c.intent]}` });
      } else {
        c.suspicious = true;
        w.events.push({ severity: 'WARNING', text: `${L}: NO RESPONSE to hail` });
      }
      return 'KEEP';
    case 'WARN':
      c.warned = true;
      switch (c.intent) {
        case 'SHADOWER':
          identify(c);
          st.threat = clamp(st.threat - 2);
          adjustSupport(w, 0.5);
          w.events.push({ severity: 'ADVISORY', text: `${L} warned off: surveillance shadower breaks contact and withdraws` });
          return 'REMOVE';
        case 'SMUGGLER':
          c.fleeing = true;
          w.events.push({ severity: 'WARNING', text: `${L} ignores the warning and runs at speed` });
          return 'KEEP';
        case 'RAIDER':
          identify(c);
          w.events.push({ severity: 'WARNING', text: `${L} drops its cover: HOSTILE RAIDER` });
          return rng.chance(0.5) ? { engage: tfId, surprise: false } : 'KEEP';
        case 'WARSHIP':
          w.tension = clamp(w.tension + 3);
          w.events.push({ severity: 'WARNING', text: `${L}: foreign warship protests the warning (tension +3)` });
          return 'KEEP';
        default:
          adjustSupport(w, -1);
          w.events.push({ severity: 'INFO', text: `${L}: lawful ${INTENT_LABEL[c.intent].toLowerCase()} warned — harassment complaint (support −1)` });
          return 'KEEP';
      }
    case 'BOARD': {
      c.boardAttempts = (c.boardAttempts ?? 0) + 1;
      switch (c.intent) {
        case 'RAIDER':
          identify(c);
          w.events.push({ severity: 'CRITICAL', text: `${L}: boarding party fired upon — AMBUSH by a disguised raider` });
          return { engage: tfId, surprise: true };
        case 'SMUGGLER':
          if (rng.chance(c.fleeing ? BOARD_P_FLEEING : BOARD_P_STEADY)) {
            w.resources.budget += SMUGGLER_SEIZURE;
            adjustSupport(w, 2);
            st.threat = clamp(st.threat - 2);
            w.stats.seizures++;
            w.events.push({ severity: 'ADVISORY', text: `${L} boarded: SMUGGLER seized, contraband confiscated (+${SMUGGLER_SEIZURE}M, support +2)` });
            return 'REMOVE';
          }
          w.events.push({ severity: 'WARNING', text: `${L} slips away from the boarding party` });
          if (c.boardAttempts >= 3) {
            adjustSupport(w, -1);
            w.events.push({ severity: 'WARNING', text: `${L}: smuggler escapes (support −1)` });
            return 'REMOVE';
          }
          return 'KEEP';
        case 'SHADOWER':
          identify(c);
          w.tension = clamp(w.tension + 6);
          adjustSupport(w, -2);
          st.threat = clamp(st.threat - 3);
          w.events.push({ severity: 'WARNING', text: `${L}: state surveillance vessel boarded — sovereignty protest (tension +6), its run is aborted` });
          return 'REMOVE';
        case 'WARSHIP':
          identify(c);
          incident(w, c, 'boarding party sent to a foreign warship', { pc: 8, tension: 10, support: 6 });
          return 'KEEP';
        default:
          identify(c);
          adjustSupport(w, -2);
          w.tension = clamp(w.tension + 1);
          w.events.push({ severity: 'INFO', text: `${L} boarded: ${INTENT_LABEL[c.intent].toLowerCase()}, clean — owners protest (support −2)` });
          return 'KEEP';
      }
    }
    case 'ENGAGE':
      switch (c.intent) {
        case 'RAIDER':
          identify(c);
          return { engage: tfId, surprise: false };
        case 'SMUGGLER':
          adjustSupport(w, -2);
          w.events.push({ severity: 'WARNING', text: `${L}: smuggler sunk — excessive force questioned (support −2)` });
          return 'REMOVE';
        case 'WARSHIP':
          incident(w, c, 'fire opened on a foreign warship', { pc: 12, tension: 15, support: 10 });
          return 'REMOVE';
        case 'SHADOWER':
          incident(w, c, 'fire opened on a state surveillance vessel', { pc: 8, tension: 10, support: 6 });
          return 'REMOVE';
        default:
          incident(w, c, `fire opened on a ${INTENT_LABEL[c.intent].toLowerCase()}`, { pc: 8, tension: 5, support: 6 });
          return 'REMOVE';
      }
  }
}

function engagement(w: WorldDraft, c: Contact, tfId: string, surprise: boolean, rng: Rng, bridges: Bridges) {
  const map = w.map;
  const st = w.sectors[c.sectorId];
  const tf = allTaskForces(w.fleets).find((t) => t.id === tfId)!;
  const defenders = activeShipsOf(w, tfId).map((s) => combatantOf(s, bridges));
  const res = resolveEngagement(rng.fork(c.id), defenders, { strength: c.strength }, { roe: st.roe, surprise, littoralFraction: map.sectors[c.sectorId].littoralFraction });
  w.events.push({
    severity: 'COMBAT',
    text: `ENGAGEMENT ${map.sectors[c.sectorId].name} vs hostile str ${c.strength.toFixed(0)} [${tf.name}, ROE ${st.roe.replace('_', ' ')}${surprise ? ', SURPRISED' : ''}]: ${res.outcome}`,
  });
  for (const line of res.log) w.events.push({ severity: 'COMBAT', text: `  ${line}` });
  for (const d of defenders) {
    const ship = w.ships[d.id];
    const hit = res.damage[d.id] ?? 0;
    ship.readiness = clamp(ship.readiness - 4);
    if (res.outcome !== 'DEFEAT') ship.veterancy = clamp(ship.veterancy + 3);
    // Overkill is wasted on a crippled hull: it is lost only if the raid hit it several times over; otherwise it limps away.
    if (hit >= ship.integrity && rng.fork(`${c.id}:sink:${ship.id}`).chance(sinkChance(ship.integrity, hit))) {
      w.events.push({ severity: 'CRITICAL', text: `LOST: ${ship.pennant} ${ship.name.toUpperCase()} sunk in action` });
      removeShip(w, ship.id);
      w.stats.shipsLost++;
      adjustSupport(w, -8);
      continue;
    }
    ship.integrity = hit >= ship.integrity ? CRIPPLED_FLOOR : ship.integrity - hit;
    if (ship.integrity < WITHDRAW_BELOW) sendToRepair(w, ship, ship.integrity <= CRIPPLED_FLOOR ? 'CRIPPLED in action' : 'heavy damage');
  }
  if (res.outcome === 'DESTROYED') {
    st.threat = clamp(st.threat - 8);
    w.stats.hostilesDestroyed++;
    adjustSupport(w, 2);
    w.resources.politicalCapital = clamp(w.resources.politicalCapital + 1.5, 0, 60);
  } else if (res.outcome === 'REPELLED') st.threat = clamp(st.threat - 3);
  else st.threat = clamp(st.threat + 6);
}

// ------------------------------------------------------------------------------------------ spawning & movement

function pickIntent(rng: Rng, threat: number, allowRaider = true): ContactIntent {
  if (allowRaider && rng.chance(clamp(0.15 + (threat / 100) * 0.75, 0, 0.95))) return 'RAIDER';
  const weights: [ContactIntent, number][] = [
    ['MERCHANT', 45],
    ['FISHING', 20],
    ['SMUGGLER', 10 + threat * 0.1],
    ['SHADOWER', 5 + threat * 0.12],
    ['WARSHIP', 8],
  ];
  let r = rng.range(0, weights.reduce((s, [, v]) => s + v, 0));
  for (const [k, v] of weights) if ((r -= v) <= 0) return k;
  return 'MERCHANT';
}

function spawnContact(w: WorldDraft, rng: Rng, sectorId: number): Contact | null {
  const map = w.map;
  const st = w.sectors[sectorId];
  for (let tries = 0; tries < 60; tries++) {
    const i = rng.int(0, map.width * map.height - 1);
    if (map.sectorGrid[i] !== sectorId) continue;
    let intent = pickIntent(rng, st.threat);
    if (intent === 'RAIDER') {
      // Presence deters: a strong force on station keeps raiders at home (own stream, so other spawn rolls are untouched).
      const pres = sectorPresence(w, sectorId).presence;
      const d = new Rng(`${w.seed}:deter:${w.tick}:${sectorId}`);
      if (pres > 0 && d.chance(Math.min(SPAWN_DETERRENCE_CAP, SPAWN_DETERRENCE * pres))) intent = pickIntent(d, st.threat, false);
    }
    let position = { x: i % map.width, y: Math.floor(i / map.width) };
    if (intent === 'RAIDER') {
      // Raiders often lie in wait on the shipping lane (own stream: existing spawn rolls are untouched).
      const lane = new Rng(`${w.seed}:ambush:${w.tick}:${sectorId}`);
      const at = lane.chance(0.6) ? laneAmbush(w, sectorId, lane) : null;
      if (at && map.sectorGrid[Math.round(at.y) * map.width + Math.round(at.x)] === sectorId) position = at;
    }
    return {
      id: `CT-${w.tick}-${sectorId}-${tries}`,
      sectorId,
      position,
      heading: rng.range(0, Math.PI * 2),
      cls: 'UNKNOWN',
      hostile: intent === 'RAIDER',
      intent,
      strength: intent === 'RAIDER' ? clamp(15 + st.threat * 0.7 + rng.range(0, 10), 15, 100) : 0,
      bornTick: w.tick,
      expiresTick: w.tick + rng.int(8, 16),
    };
  }
  return null;
}

function move(w: WorldDraft, c: Contact, rng: Rng) {
  const map = w.map;
  const tfs = allTaskForces(w.fleets);
  const chased = c.pursue ? tfs.find((t) => t.id === c.pursue) : undefined;
  const near = nearestActiveTf(w, c.position.x, c.position.y);
  const toward = (p: { x: number; y: number }) => Math.atan2(p.y - c.position.y, p.x - c.position.x);
  let step = 1.5;
  if (c.fleeing && near) {
    c.heading = toward(tfs.find((t) => t.id === near.id)!.position) + Math.PI;
    step = 2;
  } else if (chased) {
    c.heading = toward(chased.position);
    step = 2;
  } else if (c.intent === 'RAIDER' && near && near.d <= 24) {
    const tfNear = tfs.find((t) => t.id === near.id)!;
    // A raid weaker than the force's presence turns away instead of closing; a stronger one hunts.
    if (taskForcePresence(w, tfNear, false) * DETER_STRENGTH_PER_PRESENCE > c.strength) {
      c.deterred = true;
      c.heading = toward(tfNear.position) + Math.PI;
    } else c.heading = toward(tfNear.position); // hunting
    step = 2;
  } else if (c.intent === 'RAIDER' && nearestMerchant(w.shipping, c.position, PREY_RANGE)) {
    c.heading = toward(nearestMerchant(w.shipping, c.position, PREY_RANGE)!.position); // hunting shipping
    step = 2;
  } else if (c.intent === 'SHADOWER' && near && near.d <= 30) {
    // Keep station on the task force, outside visual identification range.
    const tfPos = tfs.find((t) => t.id === near.id)!.position;
    c.heading = near.d < 14 ? toward(tfPos) + Math.PI : near.d > 18 ? toward(tfPos) : c.heading + Math.PI / 2;
  } else c.heading += rng.gaussian() * 0.25;
  const nx = c.position.x + Math.cos(c.heading) * step;
  const ny = c.position.y + Math.sin(c.heading) * step;
  const cell = Math.round(ny) * map.width + Math.round(nx);
  if (nx >= 0 && ny >= 0 && nx < map.width && ny < map.height && map.sectorGrid[cell] === c.sectorId) c.position = { x: nx, y: ny };
  else c.heading = rng.range(0, Math.PI * 2);
}

// ------------------------------------------------------------------------------------------ daily tick

export function tickContacts(w: WorldDraft, rng: Rng, bridges: Bridges): void {
  const map = w.map;
  for (const sec of map.sectors) {
    const st = w.sectors[sec.id];
    const p = 0.004 + 0.05 * (st.threat / 100) ** 2;
    if (!w.scripted && w.contacts.length < 14 && rng.chance(p)) {
      const c = spawnContact(w, rng, sec.id);
      if (c) w.contacts.push(c);
    }
  }

  const survivors: Contact[] = [];
  for (const c of w.contacts) {
    move(w, c, rng);
    const st = w.sectors[c.sectorId];
    const near = nearestActiveTf(w, c.position.x, c.position.y);

    // Visual identification at close range.
    if (c.cls === 'UNKNOWN' && near && near.d <= IDENTIFY_RANGE) {
      identify(c);
      w.events.push({ severity: c.hostile ? 'WARNING' : 'INFO', text: `${label(w, c)}: identified ${INTENT_LABEL[c.intent]}` });
    }

    // One ladder step per day: the player's order, else the sector SOP, else (weapons free) engage unidentified tracks in range.
    let result: StepResult = 'KEEP';
    if (near) {
      let action: LadderAction | null = null;
      if (c.order) {
        if (c.order !== 'SHADOW' && near.d <= ACTION_RANGE[c.order] && !actionBlocked(c, st.roe, c.order)) {
          action = c.order;
          c.order = null;
        }
      } else {
        action = sopAction(c, st.sop, near.d);
        if (!action && st.roe === 'WEAPONS_FREE' && c.cls === 'UNKNOWN' && near.d <= ENGAGE_RANGE) action = 'ENGAGE';
      }
      if (action) result = execute(w, c, action, near.id, rng.fork(`${c.id}:${w.tick}`));
    }
    if (result === 'REMOVE') continue;
    if (typeof result === 'object') {
      engagement(w, c, result.engage, result.surprise, rng, bridges);
      continue; // raid expended
    }

    // Raiders press home their attack inside engagement range.
    if (c.hostile && near && near.d <= ENGAGE_RANGE) {
      const surprise = st.roe === 'HOLD_FIRE' && !c.warned && c.cls !== 'HOSTILE';
      engagement(w, c, near.id, surprise, rng, bridges);
      continue;
    }

    if (w.tick >= c.expiresTick) {
      if (c.hostile && c.deterred) {
        st.threat = clamp(st.threat - 2);
        adjustSupport(w, 0.3);
        w.events.push({ severity: 'ADVISORY', text: `${label(w, c)}: RAIDER DETERRED — it broke off rather than close on the task force (threat −2, support +0.3)` });
      } else if (c.hostile) {
        st.threat = clamp(st.threat + 8);
        w.resources.politicalCapital = clamp(w.resources.politicalCapital - 3, 0, 60);
        w.tension = clamp(w.tension + 2);
        adjustSupport(w, -1.5);
        w.events.push({ severity: 'CRITICAL', text: `HOSTILE PROBE UNOPPOSED in ${map.sectors[c.sectorId].name} — no forces on station` });
      } else if (c.intent === 'SMUGGLER' && (c.suspicious || c.fleeing)) {
        adjustSupport(w, -1);
        w.events.push({ severity: 'WARNING', text: `${label(w, c)}: detected smuggler escapes the sector (support −1)` });
      } else if (c.intent === 'SHADOWER' && !c.warned) {
        st.threat = clamp(st.threat + 2);
        w.events.push({ severity: 'WARNING', text: `${label(w, c)}: unchallenged surveillance run completed (threat +2)` });
      }
      continue;
    }
    survivors.push(c);
  }
  w.contacts = survivors;
}


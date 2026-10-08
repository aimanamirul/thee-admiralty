/**
 * Action previews: the predicted consequence of an action, shown in the strip under the tactical ticker while it is hovered.
 * Pure functions over a world snapshot (never the live world); several dry-run the real command on a copy and describe the
 * difference, so previews cannot drift from what the command actually does. Text uses name tokens (see lib/data/tokens.ts).
 */
import { HULLS, MINISTRIES, MODULE_BY_ID, PROJECT_BY_ID } from '../data/catalog';
import { mt, pt, vt } from '../data/tokens';
import { type VendorId } from '../types/diplomacy';
import { bridgeKey } from '../types/equipment';
import type { Tempo } from '../types/fleet';
import type { HullClassId } from '../types/hull';
import type { Roe, WorldDraft } from '../types/world';
import * as cmd from './commands';
import { evaluateLoadout, hullBlocked, procurability } from './designEngine';
import { AVERT_STANDING, REINSTATE_STANDING } from './diplomacyEngine';
import { allTaskForces, DEEP_DRAFT_M, PATROL_LIMIT_DAYS, taskForceShipIds } from './fleetEngine';
import { findRoute } from './navigation';
import { forecast, hearingBlocked, hearingChance, hullDailyCost, HEARING_BOOST, HEARING_COOLDOWN_DAYS, HEARING_PC, lobbyCost, procurementFrozen } from './politicsEngine';
import { bridgeSet, BASE_RP_INCOME, canStart, FUND_BUREAU_COST, FUND_BUREAU_RP, RP_THROUGHPUT_PER_PROJECT } from './researchEngine';
import { ENGAGE_RANGE } from './worldEngine';
import { raidProfile } from './combatSim';
import { DETER_STRENGTH_PER_PRESENCE, DETERRENCE_PER_DAY, presenceFrom, presenceLabel, taskForcePower } from './presence';
import { cancelBlocked, cancellationTerms, DEPOSIT_RATE, RESALE_RATE, resaleBlocked, resaleProceeds, BREACH_STANDING } from './contracts';
import { cancelEscortBlocked, COVER_RADIUS, escortBlocked, flagText, laneOf, MERCHANT_SPEED, nearestCover, isCovered, premiumPct, coverChance } from './shipping';
import { KIND_TAG, POLICY_LABEL, type ExclusionZone, type FlagFilter, type InterdictionPolicy } from '../types/shipping';
import {
  engageBlocked, FIND_TIPPED, FIND_UNTIPPED, FORCE_RANGE, INSPECT_DAYS, inspectBlocked, liftBlocked, NOTICE_DAYS, sectorInspectBlocked,
  SEIZURE_SHARE, strikeLegal, zoneBlocked, zoneInForce, zonePolicyBlocked, ZONE_PC, CREW,
} from './interdiction';
import { targetIndex } from './shipping';
import { DILIGENCE_COST, DILIGENCE_DAYS, diligenceBlocked, originView } from './supplyChain';
import { advanceBlocked, blocFallout, nextStep, REGIMES, RUNG_LABEL, rungAccess, scoutable, scoutBlocked, SCOUT_PC, sellableTier } from './relationsEngine';
import { ACTION_RANGE, actionBlocked, contactStatus, nearestActiveTf, OUTCOMES, SOP_RANGES } from './contactEngine';
import type { LadderAction, Sop } from '../types/world';
import { boatFigures, depthMultiplier, indiscretionRisk, isBoat, RECHARGE_DAYS, STANCE_AMBUSH, STANCE_DETERRENCE, stanceBlocked, type Stance } from './submarines';
import { mergeBlocked, REFIT_DAYS, refitBlocked, refitCandidates, refitCost, splitBlocked } from './fleetOps';
import type { ModuleSlot } from '../types/equipment';

/** Warn when a task force's interceptors fall short of the raids to expect at the sector's current threat. */
function airDefence(w: WorldDraft, tfId: string, sectorId: number): string | null {
  const tf = tfById(w, tfId)!;
  const bridges = bridgeSet(w.research.completed);
  let interceptors = 0;
  for (const id of taskForceShipIds(tf)) {
    const s = w.ships[id];
    if (!s || s.buildStatus !== 'COMMISSIONED' || s.isPartsHulk || s.state === 'MAINTENANCE_DOCK') continue;
    interceptors += evaluateLoadout(s.hullId, s.modules.filter((m) => !m.failed).map((m) => m.moduleId), bridges).interceptors;
  }
  const threat = w.sectors[sectorId].threat;
  const missiles = raidProfile({ strength: 15 + threat * 0.7 + 5 }).missiles;
  // Interceptors kill roughly one missile in three (readiness and friction permitting); below ~3 per inbound missile, raids get through.
  if (interceptors >= missiles * 3) return null;
  return `AIR DEFENCE WEAK: ${interceptors} interceptors at sea vs raids of ~${missiles} missiles at threat ${threat.toFixed(0)} — ${interceptors < missiles ? 'crippling damage likely (ships break off for repair; heavy overkill can still sink them)' : 'leakers likely'}`;
}

export type Preview = string;

const M = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(2)}B` : `${n.toFixed(0)}M`);
const tfById = (w: WorldDraft, id: string) => allTaskForces(w.fleets).find((t) => t.id === id);
const shipLabel = (w: WorldDraft, id: string) => {
  const s = w.ships[id];
  return s ? `${s.pennant} ${s.name}` : id;
};
const blocked = (reason: string) => `BLOCKED — ${reason}`;
/** Run a command on a deep copy; the map is shared (read-only). */
function dryRun(w: WorldDraft, fn: (c: WorldDraft) => cmd.CommandResult) {
  const c = { ...structuredClone({ ...w, map: undefined }), map: w.map } as WorldDraft;
  c.events = [];
  const res = fn(c);
  return { res, c };
}

// ------------------------------------------------------------------------------------------ diplomacy

export function previewLobby(w: WorldDraft, vendorId: VendorId, ministryId: string): Preview {
  const v = w.vendors[vendorId];
  const m = MINISTRIES.find((x) => x.id === ministryId)!;
  const { res, c } = dryRun(w, (x) => cmd.lobbyVendorCmd(x, vendorId, ministryId));
  if (!res.ok) return blocked(`${res.reason} (have ${w.resources.politicalCapital.toFixed(1)} PC)`);
  const after = c.vendors[vendorId];
  const parts = [`−${lobbyCost(w, m.cost)} PC`, `${vt(vendorId)} standing ${v.standing.toFixed(0)} → ${after.standing.toFixed(0)}`];
  if (sellableTier(after) > sellableTier(v)) parts.push(`reaches catalogue tier T${sellableTier(after)}`);
  else if (sellableTier(v) < 0) parts.push(`no contract yet: standing counts once the relationship reaches ${RUNG_LABEL.FRAMEWORK}`);
  if (v.status === 'WARNING') {
    parts.push(
      after.standing >= AVERT_STANDING
        ? `averts the pending ${v.pendingSanction?.replace('_', ' ') ?? 'sanction'}`
        : `still ${(AVERT_STANDING - after.standing).toFixed(0)} short of ${AVERT_STANDING} needed to avert the pending sanction`,
    );
  }
  if (v.status === 'FROZEN' && after.statusUntilTick !== null) parts.push(`freeze lifts day ${after.statusUntilTick} (was ${v.statusUntilTick})`);
  if (v.status === 'REVOKED') parts.push(after.status === 'ACTIVE' ? 'licence REINSTATED' : `licence stays revoked until standing ${REINSTATE_STANDING}`);
  return parts.join(' · ');
}

// ------------------------------------------------------------------------------------------ sectors / ROE

export function previewRoe(w: WorldDraft, sectorId: number, roe: Roe): Preview {
  const st = w.sectors[sectorId];
  const unknown = w.contacts.filter((c) => c.sectorId === sectorId && c.cls === 'UNKNOWN').length;
  const tracks = unknown ? `${unknown} unidentified track${unknown > 1 ? 's' : ''} in sector now` : 'no unidentified tracks in sector now';
  const current = st.roe === roe ? 'CURRENT · ' : '';
  switch (roe) {
    case 'HOLD_FIRE':
      return `${current}Hostile raids fire first: engagement window halved, our salvo weakened · no risk of incidents · ${tracks}`;
    case 'RETURN_FIRE':
      return `${current}Engage tracks only once identified hostile (inside 10 tiles) · normal engagement window · no risk of incidents · ${tracks}`;
    case 'WEAPONS_FREE':
      return `${current}Engagement window +25% · every unidentified track within ${ENGAGE_RANGE} tiles of a task force is engaged; each civilian hit is an incident (−8 PC, +5 tension) · ${tracks}`;
  }
}

export function previewAssign(w: WorldDraft, tfId: string, sectorId: number | null): Preview {
  const tf = tfById(w, tfId);
  if (!tf) return blocked('no such task force');
  const goal = sectorId === null ? w.map.homePort : w.map.sectors[sectorId].anchor;
  const ships = taskForceShipIds(tf).map((id) => w.ships[id]).filter(Boolean);
  const deep = ships.filter((s) => HULLS[s.hullId].draftM >= DEEP_DRAFT_M).length;
  const route = findRoute(w.map, tf.position, goal, deep > 0);
  let dist = 0;
  let p = tf.position;
  for (const q of route) {
    dist += Math.hypot(q.x - p.x, q.y - p.y);
    p = q;
  }
  const days = Math.max(0, Math.ceil(dist / tf.speedTilesPerDay));
  const parts: string[] = [];
  if (sectorId !== null) {
    const air = airDefence(w, tfId, sectorId);
    if (air) parts.push(air);
  }
  if (sectorId === null) parts.push(`${tf.name} returns to port in ~${days} day${days === 1 ? '' : 's'}; hulls stay in rotation but none patrol`);
  else {
    const sec = w.map.sectors[sectorId];
    parts.push(`${tf.name} on station in ${sec.label} in ~${days} day${days === 1 ? '' : 's'} (${dist.toFixed(0)} tiles)`);
    parts.push(`sector threat ${w.sectors[sectorId].threat.toFixed(0)}, ROE ${w.sectors[sectorId].roe.replace('_', ' ')}`);
    const pw = taskForcePower(w, tf, false);
    const others = allTaskForces(w.fleets).filter((t) => t.id !== tf.id && t.assignedSectorId === sectorId && !t.escort).reduce((a, t) => a + taskForcePower(w, t, false), 0);
    const pres = presenceFrom(pw + others);
    parts.push(`naval presence ${pres.toFixed(1)}${others > 0 ? ' with the forces already there' : ''} (${presenceLabel(pres)}): threat −${(DETERRENCE_PER_DAY * pres).toFixed(2)}/day, raiders up to strength ~${Math.round(pres * DETER_STRENGTH_PER_PRESENCE)} turn away`);
    if (deep && sec.littoralFraction > 0.2) parts.push(`${deep} deep-draft hull${deep > 1 ? 's' : ''}: grounding risk (${Math.round(sec.littoralFraction * 100)}% littoral)`);
  }
  if (tf.assignedSectorId !== null && tf.assignedSectorId !== sectorId) {
    const left = w.map.sectors[tf.assignedSectorId];
    const others = allTaskForces(w.fleets).some((t) => t.id !== tfId && t.assignedSectorId === left.id);
    if (!others) parts.push(`leaves ${left.label} uncovered (threat ${w.sectors[left.id].threat.toFixed(0)})`);
  }
  if (tf.assignedSectorId === sectorId) parts.unshift('CURRENT ORDERS');
  return parts.join(' · ');
}

export function previewTempo(w: WorldDraft, tfId: string, tempo: Tempo): Preview {
  const tf = tfById(w, tfId);
  if (!tf) return blocked('no such task force');
  const ships = taskForceShipIds(tf).map((id) => w.ships[id]).filter((s) => s && s.buildStatus === 'COMMISSIONED' && !s.isPartsHulk);
  const onPatrol = ships.filter((s) => s.state === 'ACTIVE_PATROL');
  const current = tf.tempo === tempo ? 'CURRENT · ' : '';
  if (tempo === 'SURGE') {
    const due = onPatrol.filter((s) => s.stateDays >= PATROL_LIMIT_DAYS - 5).length;
    return `${current}Rotation suspended: ${onPatrol.length} hull${onPatrol.length === 1 ? '' : 's'} stay on patrol past ${PATROL_LIMIT_DAYS} days${due ? ` (${due} due for dock within 5 days)` : ''} · breakdown risk rises with every extra day · docked hulls still repair`;
  }
  return `${current}Automatic Rule of Thirds: hulls dock after ${PATROL_LIMIT_DAYS} days on patrol or below 35% readiness, work up, then return`;
}

// ------------------------------------------------------------------------------------------ ships

export function previewHold(w: WorldDraft, shipId: string): Preview {
  const s = w.ships[shipId];
  if (!s) return blocked('no such ship');
  if (s.holdStation) return `${shipLabel(w, shipId)} returns to automatic rotation`;
  return `${shipLabel(w, shipId)} stays on station regardless of rotation (${s.stateDays} days in state, readiness ${s.readiness.toFixed(0)}%) · still forced to dock below 12% readiness or 25% integrity`;
}

export function previewHulk(w: WorldDraft, shipId: string): Preview {
  const s = w.ships[shipId];
  if (!s) return blocked('no such ship');
  if (s.state !== 'MAINTENANCE_DOCK') return blocked('only a docked hull can be designated');
  const working = s.modules.filter((m) => !m.failed);
  const needed = Object.values(w.ships).flatMap((o) => (o.id !== shipId ? o.modules.filter((m) => m.failed).map((m) => m.moduleId) : []));
  const helps = [...new Set(working.map((m) => m.moduleId).filter((id) => needed.includes(id)))];
  return [
    `${shipLabel(w, shipId)} leaves service (upkeep drops to 5%)`,
    `${working.length} working module${working.length === 1 ? '' : 's'} become cannibalisable`,
    helps.length ? `would repair: ${helps.map(mt).join(', ')}` : 'no docked ship currently needs its parts',
    'reversible (Restore to service)',
  ].join(' · ');
}

export function previewStrip(w: WorldDraft, shipId: string): Preview {
  const s = w.ships[shipId];
  if (!s) return blocked('no such ship');
  const working = s.modules.filter((m) => !m.failed).length;
  return `IRREVERSIBLE: ${working} module${working === 1 ? '' : 's'} move to the spares pool and ${shipLabel(w, shipId)} is scrapped`;
}

export function previewRestore(w: WorldDraft, shipId: string): Preview {
  const s = w.ships[shipId];
  if (!s) return blocked('no such ship');
  const design = s.modules.length;
  const failed = s.modules.filter((m) => m.failed).length;
  return `${shipLabel(w, shipId)} returns to the dock and the rotation · ${design} module${design === 1 ? '' : 's'} fitted${failed ? `, ${failed} still failed (needs spares)` : ''}`;
}

// ------------------------------------------------------------------------------------------ logistics / industry

export function previewBuySpare(w: WorldDraft, moduleId: string): Preview {
  const { res } = dryRun(w, (x) => cmd.buySpares(x, moduleId, 1));
  if (!res.ok) return blocked(res.reason ?? 'refused');
  const m = MODULE_BY_ID[moduleId];
  const cost = m.cost * 0.35;
  const waiting = Object.values(w.ships).filter((s) => s.state === 'MAINTENANCE_DOCK' && s.modules.some((x) => x.failed && x.moduleId === moduleId)).length;
  return `−${M(cost)} · ${mt(moduleId)} stock ${w.spares[moduleId] ?? 0} → ${(w.spares[moduleId] ?? 0) + 1}${waiting ? ` · ${waiting} docked hull${waiting > 1 ? 's' : ''} waiting for it` : ''}`;
}

export function previewFundBureau(w: WorldDraft): Preview {
  if (w.resources.budget < FUND_BUREAU_COST) return blocked(`needs ${FUND_BUREAU_COST}M`);
  return `−${FUND_BUREAU_COST}M · +${FUND_BUREAU_RP} RP now (${w.resources.researchPoints.toFixed(0)} → ${(w.resources.researchPoints + FUND_BUREAU_RP).toFixed(0)})`;
}

export function previewExpandIndustry(w: WorldDraft): Preview {
  const ic = w.resources.industrialCapacity;
  const { res } = dryRun(w, (x) => cmd.expandIndustry(x));
  if (!res.ok) return blocked(res.reason ?? 'refused');
  const queued = Object.values(w.ships).filter((s) => s.buildStatus === 'CONSTRUCTING' && !s.frozenBy).length;
  return `−${M(150 * ic)} · slipways ${ic} → ${ic + 1}${queued > ic ? ` · ${queued - ic} queued hull${queued - ic > 1 ? 's' : ''} start building` : ''}`;
}

export function previewOrderShip(w: WorldDraft, a: { hullId: HullClassId; moduleIds: string[]; squadronId: string }): Preview {
  const frozen = procurementFrozen(w);
  if (frozen) return blocked(frozen);
  const ev = evaluateLoadout(a.hullId, a.moduleIds, bridgeSet(w.research.completed));
  if (!ev.valid) return blocked(ev.errors[0]);
  const vendors = w.vendors as unknown as Record<string, WorldDraft['vendors'][VendorId]>;
  const done = new Set(w.research.completed);
  const hullWhy = hullBlocked(a.hullId, vendors, done);
  if (hullWhy) return blocked(hullWhy);
  for (const id of a.moduleIds) {
    const p = procurability(MODULE_BY_ID[id], vendors, done);
    if (!p.ok) return blocked(`${mt(id)}: ${p.reason}`);
  }
  const deposit = ev.cost * DEPOSIT_RATE;
  if (w.resources.budget < deposit) return blocked(`deposit ${M(deposit)} needed, have ${M(w.resources.budget)}`);
  const building = Object.values(w.ships).filter((s) => s.buildStatus === 'CONSTRUCTING' && !s.frozenBy).length;
  const hull = HULLS[a.hullId];
  const wait = building >= w.resources.industrialCapacity ? ` · all ${w.resources.industrialCapacity} slipways busy: queued behind ${building - w.resources.industrialCapacity + 1}` : '';
  const foreign = [...new Set(a.moduleIds.map((id) => MODULE_BY_ID[id].vendorId))].filter((v) => v !== 'DOMESTIC_YARDS' && w.vendors[v].status !== 'ACTIVE');
  const views = a.moduleIds.map((id) => originView(w, MODULE_BY_ID[id]));
  const via = [...new Set(views.flatMap((o) => o.known))];
  const unverified = views.filter((o) => !o.verified).length;
  return [
    `${M(ev.cost)} contract: −${M(deposit)} deposit now (budget ${M(w.resources.budget)} → ${M(w.resources.budget - deposit)})`,
    `balance ${M(ev.cost - deposit)} at ${M((ev.cost - deposit) / hull.buildDays)}/day while building`,
    `commissions in ${hull.buildDays} days${wait}`,
    `running cost +${hullDailyCost(a.hullId, 'TRANSIT_WORKUP').toFixed(2)}–${hullDailyCost(a.hullId, 'ACTIVE_PATROL').toFixed(2)}M/day once commissioned`,
    ...(ev.frictionIndex > 0 ? [`integration friction ${ev.frictionIndex.toFixed(2)}`] : []),
    ...(foreign.length ? [`sanction exposure: ${foreign.map(vt).join(', ')}`] : []),
    ...(via.length ? [`sub-suppliers inside: ${via.map(vt).join(', ')}`] : []),
    ...(unverified ? [`${unverified} foreign module${unverified > 1 ? 's' : ''} unverified (no due diligence)`] : []),
  ].join(' · ');
}

export function previewSubstitute(w: WorldDraft, shipId: string, index: number, moduleId: string): Preview {
  const { res } = dryRun(w, (x) => cmd.substituteModule(x, shipId, index, moduleId));
  if (!res.ok) return blocked(res.reason ?? 'refused');
  const s = w.ships[shipId];
  const old = s.modules[index].moduleId;
  const cost = Math.max(0, MODULE_BY_ID[moduleId].cost * 1.5 - MODULE_BY_ID[old].cost * 0.5);
  return `−${M(cost)} · ${mt(old)} → ${mt(moduleId)}${s.frozenBy ? ' · construction resumes if no other frozen parts remain' : ''}`;
}

// ------------------------------------------------------------------------------------------ R&D

export function previewStartResearch(w: WorldDraft, projectId: string): Preview {
  const p = PROJECT_BY_ID[projectId];
  const can = canStart(w.research, projectId);
  if (!can.ok) return blocked(can.reason ?? 'refused');
  const remaining = p.costRP - (w.research.progress[projectId] ?? 0);
  const others = w.research.active.length;
  // Banked RP is spent first at full throughput; after that the project shares the daily income with the other active ones.
  const fromBank = Math.min(remaining, w.resources.researchPoints);
  const perDayFromIncome = Math.min(RP_THROUGHPUT_PER_PROJECT, BASE_RP_INCOME / (others + 1));
  const days = Math.ceil(fromBank / RP_THROUGHPUT_PER_PROJECT + (remaining - fromBank) / Math.max(0.1, perDayFromIncome));
  const parts = [`${remaining.toFixed(0)} RP to go · ~${days} days at current income`];
  if (p.bridge) {
    const key = bridgeKey(p.bridge[0], p.bridge[1]);
    const bridges = bridgeSet(w.research.completed);
    let affected = 0;
    for (const s of Object.values(w.ships)) {
      const ev = evaluateLoadout(s.hullId, s.modules.map((m) => m.moduleId), bridges);
      if (ev.frictions.some((f) => f.bridgeKey === key && !f.bridged)) affected++;
    }
    parts.push(affected ? `removes friction on ${affected} hull${affected > 1 ? 's' : ''} in the fleet` : 'no hull in the fleet currently suffers this mismatch');
  } else parts.push(`unlocks new domestic hardware (${pt(projectId)})`);
  return parts.join(' · ');
}

export function previewStopResearch(w: WorldDraft, projectId: string): Preview {
  const p = PROJECT_BY_ID[projectId];
  return `Pauses ${pt(projectId)}: ${(w.research.progress[projectId] ?? 0).toFixed(0)}/${p.costRP} RP kept · frees an engineering slot`;
}

// ------------------------------------------------------------------------------------------ home front

export function previewHearing(w: WorldDraft): Preview {
  const b = hearingBlocked(w);
  if (b) return blocked(b);
  const f = forecast(w);
  const cost = lobbyCost(w, HEARING_PC);
  const boosted = f.mid * (1 + w.politics.fiscal.hearingBoost + HEARING_BOOST) / (1 + w.politics.fiscal.hearingBoost);
  const chance = Math.round(hearingChance(w) * 100);
  return [
    `−${cost} PC`,
    `${chance}% chance: next year's appropriation ~${M(f.mid)} → ~${M(boosted)}`,
    `${100 - chance}% chance: rejected, domestic support −4`,
    `next hearing possible ${HEARING_COOLDOWN_DAYS} days later`,
  ].join(' · ');
}

// ------------------------------------------------------------------------------------------ contacts & SOP

const SOP_TEXT: Record<Sop, string> = {
  OBSERVE: 'shadow and identify visually only (inside 10 tiles); no hails or boardings; raiders under HOLD FIRE keep their surprise, smugglers and shadowers pass unchallenged',
  CHALLENGE: `hail at ${SOP_RANGES.CHALLENGE.hail} tiles · warn silent contacts at ${SOP_RANGES.CHALLENGE.warn} · board runners at ${SOP_RANGES.CHALLENGE.board} (55%) · warned raiders lose surprise`,
  ASSERTIVE: `hail at ${SOP_RANGES.ASSERTIVE.hail} tiles · BOARD silent contacts at ${SOP_RANGES.ASSERTIVE.board} without warning (smugglers seized before they run, but a disguised raider ambushes the boarders) · warn foreign warships off (tension)`,
};

export function previewSop(w: WorldDraft, sectorId: number, sop: Sop): Preview {
  const current = w.sectors[sectorId].sop === sop ? 'CURRENT · ' : '';
  const ceiling = w.sectors[sectorId].roe === 'WEAPONS_FREE' ? ' · WEAPONS FREE: unidentified contacts reaching 12 tiles are engaged' : '';
  return `${current}${SOP_TEXT[sop]}${ceiling}`;
}

export function previewContactOrder(w: WorldDraft, contactId: string, action: LadderAction | 'AUTO'): Preview {
  const c = w.contacts.find((x) => x.id === contactId);
  if (!c) return blocked('contact lost');
  const st = w.sectors[c.sectorId];
  if (action === 'AUTO') return `Hand ${contactStatus(c).toLowerCase()} contact back to the sector SOP (${st.sop})`;
  const b = actionBlocked(c, st.roe, action);
  if (b) return blocked(b);
  const near = nearestActiveTf(w, c.position.x, c.position.y);
  const range = ACTION_RANGE[action];
  const when = !near ? 'no task force at sea to carry it out' : near.d <= range ? 'carried out tomorrow' : `carried out once a task force is within ${range} tiles (nearest ${near.d.toFixed(0)})`;
  if (action === 'SHADOW') return `Hold: track the contact and do not escalate, overriding the ${st.sop} SOP · raiders may still attack inside 12 tiles`;
  return `${when} · ${OUTCOMES[action]}`;
}

// ------------------------------------------------------------------------------------------ vendor relations

export function previewScout(w: WorldDraft): Preview {
  const b = scoutBlocked(w);
  if (b) return blocked(b);
  const unknown = Object.values(w.vendors).filter(scoutable).length;
  return `−${lobbyCost(w, SCOUT_PC)} PC · trade attachés identify 1 of ${unknown} unknown supplier${unknown > 1 ? 's' : ''} · its catalogue becomes visible (not yet purchasable)`;
}

export function previewAdvance(w: WorldDraft, vendorId: VendorId): Preview {
  const b = advanceBlocked(w, vendorId);
  if (b) return blocked(b);
  const v = w.vendors[vendorId];
  const step = nextStep(v.rung)!;
  const fallout = blocFallout(w, v);
  return [
    `−${lobbyCost(w, step.pc)} PC${step.money ? ` · −${M(step.money)}` : ''}`,
    `${RUNG_LABEL[step.target]} concludes in ${step.days} days (day ${w.tick + step.days})`,
    `then: ${rungAccess(step.target)}`,
    ...(fallout.length ? [`bloc politics: ${fallout.map((f) => `${vt(f.id)} −${f.loss}`).join(', ')} standing`] : []),
    `stalls if ${REGIMES[v.regime].label.toLowerCase()} regime imposes sanctions`,
  ].join(' · ');
}

export function previewDiligence(w: WorldDraft, vendorId: VendorId): Preview {
  const b = diligenceBlocked(w, vendorId);
  if (b) return blocked(b);
  return `−${M(DILIGENCE_COST)} · report in ${DILIGENCE_DAYS} days (day ${w.tick + DILIGENCE_DAYS}) · reveals every foreign sub-supplier inside ${vt(vendorId)} products, and identifies unknown ones`;
}

// ------------------------------------------------------------------------------------------ build contracts

export function previewCancel(w: WorldDraft, shipId: string): Preview {
  const b = cancelBlocked(w, shipId);
  if (b) return blocked(b);
  const t = cancellationTerms(w, w.ships[shipId]);
  const basis = { DOMESTIC: 'yard salvage', FAULT: 'refund owed', BREACH: 'breach' } as const;
  return [
    `+${M(t.refund)} of ${M(t.paid)} paid`,
    ...t.lines.map((l) => `${vt(l.vendorId)} ${M(l.refund)}/${M(l.paid)} (${basis[l.basis]})`),
    ...(t.breaches.length ? [`breach of contract: ${t.breaches.map(vt).join(', ')} standing −${BREACH_STANDING}`] : []),
    ...(t.supportLoss ? [`support −${t.supportLoss} (money wasted)`] : []),
    'hull scrapped',
  ].join(' · ');
}

export function previewResell(w: WorldDraft, shipId: string): Preview {
  const b = resaleBlocked(w, shipId);
  if (b) return blocked(b);
  const s = w.ships[shipId];
  return `+${M(resaleProceeds(s))} (${Math.round(RESALE_RATE * 100)}% of ${M(s.contract?.paid ?? 0)} paid) · a third-party navy takes over the hull and its contract · no standing or support cost`;
}

// ------------------------------------------------------------------------------------------ civilian shipping

export function previewEscort(w: WorldDraft, tfId: string, merchantId: string): Preview {
  const b = escortBlocked(w, tfId, merchantId);
  if (b) return blocked(b);
  const tf = tfById(w, tfId)!;
  const m = w.shipping.ships.find((x) => x.id === merchantId)!;
  const lane = laneOf(w.shipping, m.laneId)!;
  const gap = Math.hypot(tf.position.x - m.position.x, tf.position.y - m.position.y);
  const days = Math.max(0, Math.ceil((gap - COVER_RADIUS) / tf.speedTilesPerDay));
  const remaining = m.dir === 1 ? lane.length - m.dist : m.dist;
  const parts: string[] = [];
  if (m.status === 'DISTRESS') {
    const left = (m.distressUntil ?? w.tick) - w.tick;
    parts.push(`${tf.name} reaches ${KIND_TAG[m.kind]} ${m.name.toUpperCase()} in ~${days} day${days === 1 ? '' : 's'}; it founders in ${left}${days > left ? ' — TOO LATE' : ' (rescue: support +1)'}`);
  } else {
    parts.push(`${tf.name} joins ${KIND_TAG[m.kind]} ${m.name.toUpperCase()} (${flagText(m.flag)}) in ~${days} day${days === 1 ? '' : 's'}, then keeps pace to port (~${Math.ceil(remaining / MERCHANT_SPEED)} days)`);
    parts.push('safe passage: support +0.5');
  }
  if (tf.assignedSectorId !== null) parts.push(`${w.map.sectors[tf.assignedSectorId].label} left uncovered while away`);
  parts.push('off station: readiness wears while escorting');
  return parts.join(' · ');
}

export function previewCancelEscort(w: WorldDraft, tfId: string): Preview {
  const b = cancelEscortBlocked(w, tfId);
  if (b) return blocked(b);
  const tf = tfById(w, tfId)!;
  const m = w.shipping.ships.find((x) => x.id === tf.escort);
  return `${tf.name} breaks off${m ? ` from ${m.name.toUpperCase()}` : ''} and returns to ${tf.assignedSectorId !== null ? w.map.sectors[tf.assignedSectorId].label : 'port'}${m && !isCovered(w, m) ? ' · the ship is then unprotected' : ''}`;
}

/** One-line status for a merchant ship (panel and previews). */
export function merchantStatusLine(w: WorldDraft, merchantId: string): string {
  const m = w.shipping.ships.find((x) => x.id === merchantId);
  if (!m) return 'LEFT THE PLOT';
  const lane = laneOf(w.shipping, m.laneId)!;
  const cover = nearestCover(w, m.position);
  const parts: string[] = [m.status === 'DISTRESS' ? `DISTRESS — ${Math.max(0, (m.distressUntil ?? w.tick) - w.tick)} days left` : 'UNDERWAY'];
  parts.push(isCovered(w, m) ? `COVER HOLDS RAIDERS OFF ${Math.round(coverChance(w, m) * 100)}% OF THE TIME` : cover ? `UNPROTECTED — NEAREST TASK FORCE ${cover.d.toFixed(0)} TILES` : 'UNPROTECTED — NO TASK FORCE AT SEA');
  parts.push(`lane war-risk premium +${premiumPct(lane.risk)}%`);
  return parts.join(' · ');
}

// ------------------------------------------------------------------------------------------ inspections and interdiction

export function previewInspect(w: WorldDraft, tfId: string, merchantId: string): Preview {
  const b = inspectBlocked(w, tfId, merchantId);
  if (b) return blocked(b);
  const tf = tfById(w, tfId)!;
  const m = w.shipping.ships.find((x) => x.id === merchantId)!;
  const gap = Math.hypot(tf.position.x - m.position.x, tf.position.y - m.position.y);
  const days = Math.max(0, Math.ceil(gap / tf.speedTilesPerDay));
  const home = m.flag === 'DOMESTIC_YARDS';
  const open = m.flag === 'OPEN_REGISTRY';
  const parts = [
    `${tf.name} reaches ${KIND_TAG[m.kind]} ${m.name.toUpperCase()} (${flagText(m.flag)}) in ~${days} day${days === 1 ? '' : 's'}, then searches it for ${INSPECT_DAYS} days`,
    `contraband found: seized (+${Math.round(m.cargo * SEIZURE_SHARE)}M, support +2)`,
    `nothing found: support −${home || open ? 0.5 : 1}, tension +1${home || open ? '' : `, ${flagText(m.flag)} standing −3`}`,
  ];
  if (m.tip) parts.push(`intelligence tip-off: a search finds it ${Math.round(FIND_TIPPED * 100)}% of the time if the tip is right (tips are sometimes wrong)`);
  else parts.push(`no intelligence on this ship: a search finds hidden cargo ${Math.round(FIND_UNTIPPED * 100)}% of the time, if there is any`);
  if (tf.assignedSectorId !== null) parts.push(`${w.map.sectors[tf.assignedSectorId].label} left uncovered while away`);
  return parts.join(' · ');
}

export function previewSectorInspect(w: WorldDraft, sectorId: number, flag: FlagFilter | null): Preview {
  const b = sectorInspectBlocked(w, sectorId, flag);
  if (b) return blocked(b);
  const sec = w.map.sectors[sectorId];
  if (!flag) return `${sec.label}: no standing search order; ships pass unchallenged`;
  return [
    `${sec.label}: task forces at sea search ${flagText(flag)} merchant ships passing within ${FORCE_RANGE} tiles (${INSPECT_DAYS} days each)`,
    `contraband: seized (cargo × ${Math.round(SEIZURE_SHARE * 100)}% in money, support +2)`,
    `clean search: support −1 (−0.5 for the home flag or open registry), tension +1, flag-state standing −3`,
    'needs a task force at sea nearby: nothing happens without one',
  ].join(' · ');
}

function zoneImpact(w: WorldDraft, zone: ExclusionZone): string {
  const before = targetIndex(w.shipping);
  const after = targetIndex({ lanes: w.shipping.lanes, zones: [...w.shipping.zones, zone] });
  return `trade index ${before.toFixed(0)} → ~${after.toFixed(0)} (traffic of the flag reroutes; budget forecast and support follow)`;
}

export function previewDeclareZone(w: WorldDraft, flag: FlagFilter, sectors: number[], policy: InterdictionPolicy): Preview {
  const b = zoneBlocked(w, flag, sectors);
  if (b) return blocked(b);
  const zone: ExclusionZone = { id: 'EZ-?', flag, sectors, declaredTick: w.tick, effectiveTick: w.tick + NOTICE_DAYS, policy };
  const notWF = sectors.filter((s) => w.sectors[s].roe !== 'WEAPONS_FREE').map((s) => w.map.sectors[s].label);
  const parts = [
    `−${lobbyCost(w, ZONE_PC)} PC`,
    `${flagText(flag)} shipping barred from ${sectors.map((s) => w.map.sectors[s].label).join(', ')}: NOTICE ${NOTICE_DAYS} days, no force before day ${zone.effectiveTick}`,
    `now: tension +4, flag-state standing −4 (its bloc −2), lane war-risk +8, polarization +6, support +1.5 (rally)`,
    zoneImpact(w, zone),
    `policy ${POLICY_LABEL[policy]}${policy === 'UNRESTRICTED' ? `: strikes ships on sight (civilian crew casualties are counted) only in sectors at WEAPONS FREE${notWF.length ? ` — not yet: ${notWF.join(', ')}` : ''}; elsewhere it turns ships back` : policy === 'TURN_BACK' ? ': search, seize contraband, turn the rest back' : ': search and release'}`,
    'passenger ferries are exempt; needs task forces on the spot to act; a polarized home front drains support later',
  ];
  return parts.join(' · ');
}

export function previewLiftZone(w: WorldDraft, zoneId: string): Preview {
  const b = liftBlocked(w, zoneId);
  if (b) return blocked(b);
  const z = w.shipping.zones.find((x) => x.id === zoneId)!;
  return `${z.id} lifted: ${flagText(z.flag)} shipping may return · tension −2, polarization −2, flag-state standing +2`;
}

export function previewZonePolicy(w: WorldDraft, zoneId: string, policy: InterdictionPolicy): Preview {
  const b = zonePolicyBlocked(w, zoneId, policy);
  if (b) return blocked(b);
  const z = w.shipping.zones.find((x) => x.id === zoneId)!;
  return `${z.id}: ${POLICY_LABEL[z.policy]} → ${POLICY_LABEL[policy]}${zoneInForce(z, w.tick) ? ' takes effect at once' : ` (in force from day ${z.effectiveTick})`}${policy === 'UNRESTRICTED' ? ' · strikes only where the sector is at WEAPONS FREE; civilian casualties counted' : ''}`;
}

export function previewEngage(w: WorldDraft, tfId: string, merchantId: string): Preview {
  const b = engageBlocked(w, tfId, merchantId);
  if (b) return blocked(b);
  const m = w.shipping.ships.find((x) => x.id === merchantId)!;
  const crew = CREW[m.kind];
  if (strikeLegal(w, m)) {
    return `LAWFUL under the exclusion order in force: ship lost (${m.cargo}M cargo), ${crew} crew casualties added to the civilian toll · tension +4, PC −3, flag-state standing −10 (bloc −3), polarization +${(3 + crew / 20).toFixed(1)}, support +1.5 now`;
  }
  return `GRAVEST INCIDENT — no exclusion order in force here (or not yet past notice, or the sector is not at WEAPONS FREE): ship lost (${m.cargo}M cargo), ${crew} crew casualties · tension +20, PC −15, support −12, flag-state standing −20 (bloc −6), polarization +${(10 + crew / 10).toFixed(0)}`;
}

// ------------------------------------------------------------------------------------------ refit and bulk fleet operations

function refitEffect(w: WorldDraft, shipId: string, index: number, newId: string): string {
  const s = w.ships[shipId];
  const before = evaluateLoadout(s.hullId, s.modules.filter((m) => !m.failed).map((m) => m.moduleId), bridgeSet(w.research.completed));
  const after = evaluateLoadout(s.hullId, s.modules.map((m, i) => (i === index ? newId : m.moduleId)).filter((_, i) => i === index || !s.modules[i].failed), bridgeSet(w.research.completed));
  const d = (label: string, a: number, b: number) => (Math.round(a) === Math.round(b) ? null : `${label} ${Math.round(a)} → ${Math.round(b)}`);
  const parts = [d('firepower', before.firepower, after.firepower), d('interceptors', before.interceptors, after.interceptors), d('detection km', before.detectionKm, after.detectionKm), d('combat rating', before.combatRating, after.combatRating)].filter(Boolean);
  return parts.length ? parts.join(', ') : 'no change to combat rating';
}

export function previewRefit(w: WorldDraft, shipId: string, index: number, newId: string): Preview {
  const b = refitBlocked(w, shipId, index, newId);
  if (b) return blocked(b);
  const s = w.ships[shipId];
  return `${shipLabel(w, shipId)}: ${mt(s.modules[index].moduleId)} → ${mt(newId)} · −${M(refitCost(s.modules[index].moduleId, newId))} · ${REFIT_DAYS} days in the yard (cannot sail) · ${refitEffect(w, shipId, index, newId)}`;
}

export function previewRefitMany(w: WorldDraft, shipIds: string[], slot: ModuleSlot, fromId: string, toId: string): Preview {
  const cands = refitCandidates(w, shipIds, slot, fromId);
  if (cands.length === 0) return blocked('no selected ship carries that module');
  const ready = cands.filter((c) => !refitBlocked(w, c.shipId, c.index, toId));
  if (ready.length === 0) return blocked(refitBlocked(w, cands[0].shipId, cands[0].index, toId) ?? 'no refit possible');
  const total = ready.length * refitCost(fromId, toId);
  const afford = Math.floor(w.resources.budget / refitCost(fromId, toId));
  return `${ready.length} of ${cands.length} ship${cands.length === 1 ? '' : 's'}: ${mt(fromId)} → ${mt(toId)} · −${M(total)} · ${REFIT_DAYS} days each in the yard${ready.length < cands.length ? ` · ${cands.length - ready.length} not in dock or blocked` : ''}${afford < ready.length ? ` · budget covers only ${afford}` : ''}`;
}

export function previewSplit(w: WorldDraft, shipIds: string[]): Preview {
  const b = splitBlocked(w, shipIds);
  if (b) return blocked(b);
  const tf = allTaskForces(w.fleets).find((t) => taskForceShipIds(t).includes(shipIds[0]))!;
  return `${shipIds.length} ship${shipIds.length === 1 ? '' : 's'} leave ${tf.name} as a new task force with the same station and tempo · ${tf.name} keeps ${taskForceShipIds(tf).length - shipIds.length}`;
}

export function previewMerge(w: WorldDraft, fromId: string, intoId: string): Preview {
  const b = mergeBlocked(w, fromId, intoId);
  if (b) return blocked(b);
  const from = tfById(w, fromId)!;
  const into = tfById(w, intoId)!;
  return `${from.name} (${taskForceShipIds(from).length} ships) joins ${into.name} (${taskForceShipIds(into).length}) · ${from.name} is disbanded · station and tempo follow ${into.name}`;
}

// ------------------------------------------------------------------------------------------ submarines

export function previewStance(w: WorldDraft, shipId: string, stance: Stance): Preview {
  const b = stanceBlocked(w, shipId, stance);
  if (b) return blocked(b);
  const s = w.ships[shipId];
  const tf = allTaskForces(w.fleets).find((t) => taskForceShipIds(t).includes(shipId));
  const sec = tf && tf.assignedSectorId !== null ? w.map.sectors[tf.assignedSectorId] : undefined;
  const fig = boatFigures(s);
  const risk = indiscretionRisk(fig.stealth, sec, w.tension) * (stance === 'STEALTH' ? 0.1 : 1);
  const where = sec ? `${sec.label}: depth ×${depthMultiplier(sec).toFixed(2)}` : 'no sector assigned';
  const tail = stance === 'STEALTH' ? `${s.submergedLeft ?? fig.submergedDays} days submerged, then ${RECHARGE_DAYS} days snorkelling to recharge` : 'snorkels on schedule, endurance never runs out';
  return `${shipLabel(w, shipId)} → ${stance} · deterrence ×${STANCE_DETERRENCE[stance]} · ambush ×${STANCE_AMBUSH[stance]} · counter-detection ${(risk * 100).toFixed(1)}%/day (stealth ${fig.stealth.toFixed(0)}, ${where}) · ${tail}`;
}

export function previewStanceMany(w: WorldDraft, shipIds: string[], stance: Stance): Preview {
  const boats = shipIds.filter((id) => w.ships[id] && isBoat(w.ships[id]));
  if (boats.length === 0) return blocked('no submarine selected');
  const ready = boats.filter((id) => !stanceBlocked(w, id, stance));
  if (ready.length === 0) return blocked(`all ${boats.length} selected boat${boats.length === 1 ? ' is' : 's are'} already on ${stance}`);
  return `${ready.length} of ${boats.length} boat${boats.length === 1 ? '' : 's'} → ${stance} · deterrence ×${STANCE_DETERRENCE[stance]} · ambush ×${STANCE_AMBUSH[stance]}`;
}

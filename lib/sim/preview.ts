/**
 * Action previews: the predicted consequence of an action, shown in the strip under the tactical ticker while it is hovered.
 * Pure functions over a world snapshot (never the live world); several dry-run the real command on a copy and describe the
 * difference, so previews cannot drift from what the command actually does. Text uses name tokens (see lib/data/tokens.ts).
 */
import { HULLS, MINISTRIES, MODULE_BY_ID, PROJECT_BY_ID } from '../data/catalog';
import { mt, pt, vt } from '../data/tokens';
import { standingTier, type VendorId } from '../types/diplomacy';
import { bridgeKey } from '../types/equipment';
import type { Tempo } from '../types/fleet';
import type { HullClassId } from '../types/hull';
import type { Roe, WorldDraft } from '../types/world';
import * as cmd from './commands';
import { evaluateLoadout, procurability } from './designEngine';
import { AVERT_STANDING, REINSTATE_STANDING } from './diplomacyEngine';
import { allTaskForces, DEEP_DRAFT_M, PATROL_LIMIT_DAYS, taskForceShipIds } from './fleetEngine';
import { findRoute } from './navigation';
import { forecast, hearingBlocked, hearingChance, hullDailyCost, HEARING_BOOST, HEARING_COOLDOWN_DAYS, HEARING_PC, lobbyCost, procurementFrozen } from './politicsEngine';
import { bridgeSet, BASE_RP_INCOME, canStart, FUND_BUREAU_COST, FUND_BUREAU_RP, RP_THROUGHPUT_PER_PROJECT } from './researchEngine';
import { ENGAGE_RANGE } from './worldEngine';

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
  if (standingTier(after.standing) > standingTier(v.standing)) parts.push(`reaches catalogue tier T${standingTier(after.standing)}`);
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
  if (sectorId === null) parts.push(`${tf.name} returns to port in ~${days} day${days === 1 ? '' : 's'}; hulls stay in rotation but none patrol`);
  else {
    const sec = w.map.sectors[sectorId];
    parts.push(`${tf.name} on station in ${sec.label} in ~${days} day${days === 1 ? '' : 's'} (${dist.toFixed(0)} tiles)`);
    parts.push(`sector threat ${w.sectors[sectorId].threat.toFixed(0)}, ROE ${w.sectors[sectorId].roe.replace('_', ' ')}`);
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
  for (const id of a.moduleIds) {
    const p = procurability(MODULE_BY_ID[id], vendors, done);
    if (!p.ok) return blocked(`${mt(id)}: ${p.reason}`);
  }
  if (w.resources.budget < ev.cost) return blocked(`needs ${M(ev.cost)}, have ${M(w.resources.budget)}`);
  const building = Object.values(w.ships).filter((s) => s.buildStatus === 'CONSTRUCTING' && !s.frozenBy).length;
  const hull = HULLS[a.hullId];
  const wait = building >= w.resources.industrialCapacity ? ` · all ${w.resources.industrialCapacity} slipways busy: queued behind ${building - w.resources.industrialCapacity + 1}` : '';
  const foreign = [...new Set(a.moduleIds.map((id) => MODULE_BY_ID[id].vendorId))].filter((v) => v !== 'DOMESTIC_YARDS' && w.vendors[v].status !== 'ACTIVE');
  return [
    `−${M(ev.cost)} (budget ${M(w.resources.budget)} → ${M(w.resources.budget - ev.cost)})`,
    `commissions in ${hull.buildDays} days${wait}`,
    `running cost +${hullDailyCost(a.hullId, 'TRANSIT_WORKUP').toFixed(2)}–${hullDailyCost(a.hullId, 'ACTIVE_PATROL').toFixed(2)}M/day once commissioned`,
    ...(ev.frictionIndex > 0 ? [`integration friction ${ev.frictionIndex.toFixed(2)}`] : []),
    ...(foreign.length ? [`sanction exposure: ${foreign.map(vt).join(', ')}`] : []),
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

/**
 * Maritime Operations Centre (docs/PLAN-maritime-ops.md, M1). Fixed shore stations watch the coast and the chokepoints:
 *
 * - Fog of war for surface contacts: an unidentified contact is on the plot only while a task force's radar reaches it, or a shore station
 *   covers it ("tracked"). Identified contacts stay on the plot. Contacts placed by hand that were never assessed are shown.
 * - Heads-up advisories: at most one a day, for a new track inside coverage or a track closing on a merchant ship. They describe behaviour
 *   only: the contact's hidden intent is never revealed.
 * - Distress relay: a ship hit inside coverage is reported at once and its distress window is a day longer.
 *
 * Stations cost money to build and to run, and can be upgraded once. Raids do not target them.
 */
import type { Vec2 } from '../types/map';
import type { Contact, Station, StationKind, WorldDraft } from '../types/world';
import { evaluateLoadout } from './designEngine';
import { allTaskForces, taskForceShipIds } from './fleetEngine';
import { visibilityOf } from './asw';
import { isBoat } from './submarines';

export const STATION_SPEC: Record<StationKind, { label: string; radius: [number, number]; build: number; upgrade: number; upkeep: [number, number] }> = {
  COASTAL_RADAR: { label: 'Coastal radar and AIS station', radius: [25, 32], build: 40, upgrade: 30, upkeep: [0.15, 0.2] },
  CHOKEPOINT_WATCH: { label: 'Chokepoint watch', radius: [18, 24], build: 60, upgrade: 40, upkeep: [0.2, 0.25] },
};
/** A task force's radar reach in tiles: its best working radar, never less than visual identification range plus a margin. */
export const RADAR_TILES_PER_KM = 0.12;
export const MIN_RADAR_REACH = 14;
/** Distress window extension for a ship hit inside coverage. */
export const RELAY_DAYS = 1;
const CLOSING_RANGE = 12;

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

export const stationRadius = (s: Station) => STATION_SPEC[s.kind].radius[s.tier - 1];
export const stationUpkeep = (stations: readonly Station[] | undefined) => (stations ?? []).reduce((a, s) => a + STATION_SPEC[s.kind].upkeep[s.tier - 1], 0);

export const homeStation = (w: Pick<WorldDraft, 'map'>, tick = 0): Station => ({ id: 'STN-HOME', kind: 'COASTAL_RADAR', tier: 1, site: 'HOME', position: { ...w.map.homePort }, builtTick: tick });

/** Make sure a world (old save, checkpoint) has its stations: at least the home-port radar. */
export function normalizeStations(w: WorldDraft): void {
  if (!Array.isArray(w.stations)) w.stations = [homeStation(w, w.tick)];
}

export interface Site {
  site: string;
  kind: StationKind;
  position: Vec2;
  label: string;
}

/** Where stations can stand: the home port, one coastal radar per sector (at its anchor), one watch per chokepoint. */
export function stationSites(w: Pick<WorldDraft, 'map'>): Site[] {
  return [
    { site: 'HOME', kind: 'COASTAL_RADAR', position: w.map.homePort, label: 'HOME PORT' },
    ...w.map.sectors.map((s) => ({ site: `S${s.id}`, kind: 'COASTAL_RADAR' as const, position: s.anchor, label: s.label })),
    ...w.map.chokepoints.map((c) => ({ site: `C${c.id}`, kind: 'CHOKEPOINT_WATCH' as const, position: c.position, label: c.name })),
  ];
}

/** The station covering a point, if any (the first found). */
export function coveringStation(w: Pick<WorldDraft, 'stations'>, p: Vec2): Station | null {
  for (const s of w.stations ?? []) if (dist(s.position, p) <= stationRadius(s)) return s;
  return null;
}
export const inCoverage = (w: Pick<WorldDraft, 'stations'>, p: Vec2) => coveringStation(w, p) !== null;

/** Each task force at sea with a working radar: position and reach. Boats do not count (they listen, they do not look). */
export function radarReaches(w: Pick<WorldDraft, 'fleets' | 'ships'>): { x: number; y: number; reach: number }[] {
  const out: { x: number; y: number; reach: number }[] = [];
  for (const tf of allTaskForces(w.fleets)) {
    let best = 0;
    let any = false;
    for (const id of taskForceShipIds(tf)) {
      const s = w.ships[id];
      if (!s || s.buildStatus !== 'COMMISSIONED' || s.isPartsHulk || s.state === 'MAINTENANCE_DOCK' || isBoat(s)) continue;
      any = true;
      best = Math.max(best, evaluateLoadout(s.hullId, s.modules.filter((m) => !m.failed).map((m) => m.moduleId), new Set()).detectionKm);
    }
    if (any) out.push({ x: tf.position.x, y: tf.position.y, reach: Math.max(MIN_RADAR_REACH, best * RADAR_TILES_PER_KM) });
  }
  return out;
}

/** Is a surface contact on the plot? Submarines follow the sonar rules (asw.ts). */
export function contactShown(c: Contact): boolean {
  if (c.submerged) return visibilityOf(c) === 'HELD';
  if (c.cls !== 'UNKNOWN') return true;
  if (c.inRadar === undefined && c.tracked === undefined) return true; // never assessed (placed by hand)
  return !!c.inRadar || !!c.tracked;
}
export const shownContacts = (cs: readonly Contact[]) => cs.filter(contactShown);
/** Shown only because a shore station tracks it (drawn faint). */
export const mocOnly = (c: Contact) => !c.submerged && c.cls === 'UNKNOWN' && !!c.tracked && !c.inRadar;

/** One day of the MOC: assess every surface contact and issue at most one advisory. */
export function tickMoc(w: WorldDraft): void {
  const radars = radarReaches(w);
  let best: { prio: number; text: string; c: Contact } | null = null;
  for (const c of w.contacts) {
    if (c.submerged) continue;
    const wasTracked = !!c.tracked;
    c.inRadar = radars.some((r) => Math.hypot(r.x - c.position.x, r.y - c.position.y) <= r.reach);
    const st = coveringStation(w, c.position);
    c.tracked = !!st;
    if (!st || c.cls !== 'UNKNOWN') continue;
    const where = w.map.sectors[c.sectorId]?.label ?? 'the theatre';
    const by = st.kind === 'CHOKEPOINT_WATCH' ? 'chokepoint watch' : 'coastal radar';
    // closing on a merchant ship: heading towards one within range
    const target = w.shipping.ships
      .filter((m) => dist(m.position, c.position) <= CLOSING_RANGE)
      .find((m) => {
        const d = dist(m.position, c.position) || 1;
        return (Math.cos(c.heading) * (m.position.x - c.position.x) + Math.sin(c.heading) * (m.position.y - c.position.y)) / d > 0.8;
      });
    if (target && (c.mocAlert ?? 0) < 2) {
      const cand = { prio: 2, c, text: `MOC: unidentified track in ${where} closing on ${target.name.toUpperCase()} (${dist(target.position, c.position).toFixed(0)} tiles) — ${by}` };
      if (!best || cand.prio > best.prio) best = cand;
    } else if (!wasTracked && (c.mocAlert ?? 0) < 1 && !c.inRadar) {
      const cand = { prio: 1, c, text: `MOC: new unidentified track in ${where}, outside any task force's radar — ${by}` };
      if (!best || cand.prio > best.prio) best = cand;
    }
  }
  if (best) {
    best.c.mocAlert = best.prio;
    w.events.push({ severity: best.prio === 2 ? 'WARNING' : 'ADVISORY', text: best.text });
  }
}

// ------------------------------------------------------------------------------------------ orders

export function stationBlocked(w: WorldDraft, site: string): string | null {
  const s = stationSites(w).find((x) => x.site === site);
  if (!s) return 'NO SUCH SITE';
  if ((w.stations ?? []).some((x) => x.site === site)) return 'A STATION ALREADY STANDS THERE';
  const cost = STATION_SPEC[s.kind].build;
  if (w.resources.budget < cost) return `NEEDS ${cost} M`;
  return null;
}

export function buildStation(w: WorldDraft, site: string): { ok: boolean; reason?: string; message?: string } {
  const why = stationBlocked(w, site);
  if (why) return { ok: false, reason: why };
  const s = stationSites(w).find((x) => x.site === site)!;
  const spec = STATION_SPEC[s.kind];
  w.resources.budget -= spec.build;
  normalizeStations(w);
  w.stations.push({ id: `STN-${site}`, kind: s.kind, tier: 1, site, position: { ...s.position }, builtTick: w.tick });
  w.events.push({ severity: 'INFO', text: `MOC: ${spec.label} commissioned at ${s.label} (−${spec.build} M, ${spec.radius[0]} tiles, ${spec.upkeep[0]} M/day)` });
  return { ok: true, message: 'Station built' };
}

export function upgradeBlocked(w: WorldDraft, id: string): string | null {
  const s = (w.stations ?? []).find((x) => x.id === id);
  if (!s) return 'NO SUCH STATION';
  if (s.tier >= 2) return 'ALREADY UPGRADED';
  const cost = STATION_SPEC[s.kind].upgrade;
  if (w.resources.budget < cost) return `NEEDS ${cost} M`;
  return null;
}

export function upgradeStation(w: WorldDraft, id: string): { ok: boolean; reason?: string; message?: string } {
  const why = upgradeBlocked(w, id);
  if (why) return { ok: false, reason: why };
  const s = w.stations.find((x) => x.id === id)!;
  const spec = STATION_SPEC[s.kind];
  w.resources.budget -= spec.upgrade;
  s.tier = 2;
  w.events.push({ severity: 'INFO', text: `MOC: ${spec.label} upgraded (−${spec.upgrade} M, coverage ${spec.radius[0]} → ${spec.radius[1]} tiles)` });
  return { ok: true, message: 'Station upgraded' };
}

export function removeBlocked(w: WorldDraft, id: string): string | null {
  const s = (w.stations ?? []).find((x) => x.id === id);
  if (!s) return 'NO SUCH STATION';
  if (s.site === 'HOME') return 'THE HOME-PORT RADAR IS PART OF THE FUSION CENTRE';
  return null;
}

export function removeStation(w: WorldDraft, id: string): { ok: boolean; reason?: string; message?: string } {
  const why = removeBlocked(w, id);
  if (why) return { ok: false, reason: why };
  const s = w.stations.find((x) => x.id === id)!;
  w.stations = w.stations.filter((x) => x.id !== id);
  w.events.push({ severity: 'INFO', text: `MOC: station at ${stationSites(w).find((x) => x.site === s.site)?.label ?? s.site} closed (no refund, upkeep stops)` });
  return { ok: true, message: 'Station closed' };
}

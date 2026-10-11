/**
 * The decisions waiting on the player, gathered from the world (pure). Feeds the "Action required" strip, auto-pause, the map's
 * pulsing rings and the Tab / J keys. Text uses name tokens and never reveals a contact's hidden intent.
 */
import { mt, vt } from '../data/tokens';
import type { Vec2 } from '../types/map';
import type { WorldDraft } from '../types/world';
import { allTaskForces, taskForceShipIds } from './fleetEngine';
import { visibilityOf } from './asw';
import { contactShown, stationUpkeep } from './moc';
import { runningCosts } from './politicsEngine';

export type ActionKind = 'DISTRESS' | 'SUB_HELD' | 'MOC_CLOSING' | 'SANCTION' | 'HOSTILE' | 'DOCK_STALLED' | 'FROZEN_BUILD' | 'IDLE_TF' | 'BUDGET';

export type ActionTarget =
  | { type: 'contact'; id: string }
  | { type: 'merchant'; id: string }
  | { type: 'ship'; id: string }
  | { type: 'tf'; id: string }
  | { type: 'vendor'; id: string }
  | { type: 'homefront' };

export interface ActionItem {
  /** Stable while the situation lasts: kind + what it is about. */
  id: string;
  kind: ActionKind;
  /** A decision that cannot wait (auto-pause candidates). */
  critical: boolean;
  text: string;
  target: ActionTarget;
  /** Where to look on the plot, if anywhere. */
  pos?: Vec2;
  /** Lower = more urgent (sort key). */
  urgency: number;
}

export const ACTION_LABEL: Record<ActionKind, string> = {
  DISTRESS: 'Distress call',
  SUB_HELD: 'Submarine contact held',
  MOC_CLOSING: 'Track closing on shipping',
  SANCTION: 'Sanction warning',
  HOSTILE: 'Hostile track',
  DOCK_STALLED: 'Dock stalled',
  FROZEN_BUILD: 'Construction frozen',
  IDLE_TF: 'Task force idle',
  BUDGET: 'Budget running low',
};
/** Kinds that pause the clock by default when they first appear. */
export const DEFAULT_PAUSE_KINDS: ActionKind[] = ['DISTRESS', 'SUB_HELD', 'MOC_CLOSING', 'SANCTION'];
export const CRITICAL_KINDS: ActionKind[] = DEFAULT_PAUSE_KINDS;

type View = Pick<WorldDraft, 'tick' | 'map' | 'ships' | 'fleets' | 'contacts' | 'shipping' | 'vendors' | 'spares' | 'resources' | 'stations'>;

export function actionItems(w: View): ActionItem[] {
  const out: ActionItem[] = [];
  const sector = (id: number) => w.map.sectors[id]?.label ?? 'the theatre';
  const sectorAt = (p: Vec2) => w.map.sectorGrid[Math.round(p.y) * w.map.width + Math.round(p.x)];

  for (const m of w.shipping.ships) {
    if (m.status !== 'DISTRESS') continue;
    const left = Math.max(0, (m.distressUntil ?? w.tick) - w.tick);
    out.push({ id: `DISTRESS:${m.id}`, kind: 'DISTRESS', critical: true, text: `${m.name.toUpperCase()} in distress in ${sector(sectorAt(m.position))} — ${left} d to answer`, target: { type: 'merchant', id: m.id }, pos: m.position, urgency: left });
  }
  for (const c of w.contacts) {
    if (c.submerged) {
      if (visibilityOf(c) === 'HELD' && !c.order) out.push({ id: `SUB_HELD:${c.id}`, kind: 'SUB_HELD', critical: true, text: `Submarine contact held in ${sector(c.sectorId)} — orders?`, target: { type: 'contact', id: c.id }, pos: c.position, urgency: 2 });
      continue;
    }
    if (!contactShown(c)) continue;
    if (c.cls === 'UNKNOWN' && c.mocAlert === 2 && !c.order) out.push({ id: `MOC_CLOSING:${c.id}`, kind: 'MOC_CLOSING', critical: true, text: `Unidentified track closing on shipping in ${sector(c.sectorId)}`, target: { type: 'contact', id: c.id }, pos: c.position, urgency: 3 });
    else if (c.cls === 'HOSTILE') out.push({ id: `HOSTILE:${c.id}`, kind: 'HOSTILE', critical: false, text: `Hostile track in ${sector(c.sectorId)} (strength ${c.strength.toFixed(0)})`, target: { type: 'contact', id: c.id }, pos: c.position, urgency: 10 });
  }
  for (const v of Object.values(w.vendors)) {
    if (v.status !== 'WARNING') continue;
    const left = v.statusUntilTick === null ? 0 : Math.max(0, v.statusUntilTick - w.tick);
    out.push({ id: `SANCTION:${v.id}`, kind: 'SANCTION', critical: true, text: `${vt(v.id)} sanction warning — lands in ${left} d unless averted`, target: { type: 'vendor', id: v.id }, urgency: 4 + left / 10 });
  }
  for (const s of Object.values(w.ships)) {
    if (s.buildStatus === 'CONSTRUCTING' && s.frozenBy) out.push({ id: `FROZEN_BUILD:${s.id}`, kind: 'FROZEN_BUILD', critical: false, text: `${s.pennant} ${s.name.toUpperCase()} construction frozen (${vt(s.frozenBy)} sanction)`, target: { type: 'ship', id: s.id }, urgency: 30 });
    if (s.buildStatus !== 'COMMISSIONED' || s.state !== 'MAINTENANCE_DOCK' || s.isPartsHulk) continue;
    const missing = s.modules.find((m) => m.failed && (w.spares[m.moduleId] ?? 0) <= 0);
    if (missing) out.push({ id: `DOCK_STALLED:${s.id}`, kind: 'DOCK_STALLED', critical: false, text: `${s.pennant} ${s.name.toUpperCase()} stalled in dock: no spare ${mt(missing.moduleId)}`, target: { type: 'ship', id: s.id }, urgency: 20 });
  }
  for (const tf of allTaskForces(w.fleets)) {
    if (tf.assignedSectorId !== null || tf.escort) continue;
    const ready = taskForceShipIds(tf).some((id) => {
      const s = w.ships[id];
      return !!s && s.buildStatus === 'COMMISSIONED' && !s.isPartsHulk && s.state !== 'MAINTENANCE_DOCK';
    });
    if (ready) out.push({ id: `IDLE_TF:${tf.id}`, kind: 'IDLE_TF', critical: false, text: `${tf.name} idle in port — assign a sector`, target: { type: 'tf', id: tf.id }, pos: tf.position, urgency: 25 });
  }
  const costs = runningCosts(Object.values(w.ships), w.tick).total + stationUpkeep(w.stations);
  if (w.resources.budget < costs * 30) out.push({ id: 'BUDGET', kind: 'BUDGET', critical: false, text: `Budget covers under 30 days of running costs`, target: { type: 'homefront' }, urgency: 15 });

  return out.sort((a, b) => Number(b.critical) - Number(a.critical) || a.urgency - b.urgency);
}

/** The first critical item not seen before whose kind pauses the clock, or null. */
export function freshPause(seen: ReadonlySet<string>, items: readonly ActionItem[], kinds: ReadonlySet<ActionKind>): ActionItem | null {
  return items.find((i) => i.critical && kinds.has(i.kind) && !seen.has(i.id)) ?? null;
}

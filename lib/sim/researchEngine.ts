/** R&D bureau: RP spending, protocol-bridge projects and domestic substitution. */
import { PROJECT_BY_ID } from '../data/catalog';
import { pt } from '../data/tokens';
import type { BridgeKey } from '../types/equipment';
import { bridgeKey } from '../types/equipment';
import type { ResearchState, WorldDraft } from '../types/world';

export const RESEARCH_SLOTS = 2;
/** Max RP a single project can absorb per day (engineering throughput). */
export const RP_THROUGHPUT_PER_PROJECT = 3;
export const BASE_RP_INCOME = 2.2;
export const FUND_BUREAU_COST = 25;
export const FUND_BUREAU_RP = 5;

export const initialResearch = (): ResearchState => ({ active: [], progress: {}, completed: [] });

/** All protocol pairs for which a bridge has been completed. */
export function bridgeSet(completed: readonly string[]): Set<BridgeKey> {
  const out = new Set<BridgeKey>();
  for (const id of completed) {
    const b = PROJECT_BY_ID[id]?.bridge;
    if (b) out.add(bridgeKey(b[0], b[1]));
  }
  return out;
}

export function canStart(state: ResearchState, id: string): { ok: boolean; reason?: string } {
  const p = PROJECT_BY_ID[id];
  if (!p) return { ok: false, reason: 'UNKNOWN PROJECT' };
  if (state.completed.includes(id)) return { ok: false, reason: 'COMPLETE' };
  if (state.active.includes(id)) return { ok: false, reason: 'ALREADY ACTIVE' };
  if (state.active.length >= RESEARCH_SLOTS) return { ok: false, reason: 'NO FREE ENGINEERING SLOT' };
  const missing = p.requires.filter((r) => !state.completed.includes(r));
  if (missing.length) return { ok: false, reason: `REQUIRES ${missing.map((m) => pt(m)).join(', ')}` };
  return { ok: true };
}

/** Spend banked RP on active projects for one day; emits completion events. */
export function tickResearch(world: WorldDraft): void {
  const r = world.research;
  for (const id of [...r.active]) {
    const p = PROJECT_BY_ID[id];
    if (!p) continue;
    const remaining = p.costRP - (r.progress[id] ?? 0);
    const spend = Math.min(RP_THROUGHPUT_PER_PROJECT, remaining, world.resources.researchPoints);
    if (spend <= 0) continue;
    world.resources.researchPoints -= spend;
    r.progress[id] = (r.progress[id] ?? 0) + spend;
    if (r.progress[id] >= p.costRP - 1e-6) {
      r.active = r.active.filter((a) => a !== id);
      r.completed.push(id);
      world.events.push({
        severity: 'ADVISORY',
        text:
          p.kind === 'PROTOCOL_BRIDGE'
            ? `R&D COMPLETE: ${pt(p.id)} — integration friction removed fleet-wide for this protocol pair`
            : `R&D COMPLETE: ${pt(p.id)} — new domestic hardware available to the Design Bureau`,
      });
    }
  }
}

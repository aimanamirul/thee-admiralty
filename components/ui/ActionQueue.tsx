'use client';

import { AlertTriangle, ChevronDown, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ACTION_LABEL, actionItems, type ActionItem, type ActionKind } from '@/lib/sim/actions';
import { useFleetStore } from '@/store/useFleetStore';
import { useFocusStore } from '@/store/useFocusStore';
import { useNames } from '@/store/useNames';
import { useTutorialLocked } from '@/store/useTutorialStore';
import type { WorldDraft } from '@/lib/types/world';

/** Bring an item into view: select what it is about, open its panel, and pan the plot to it. */
export function focusAction(item: ActionItem) {
  const g = useFleetStore.getState();
  const f = useFocusStore.getState();
  const t = item.target;
  if (t.type === 'contact') g.selectContact(t.id);
  else if (t.type === 'merchant') g.selectMerchant(t.id);
  else if (t.type === 'tf') g.selectTaskForce(t.id);
  else if (t.type === 'ship') {
    g.setTab('FLEET');
    g.selectShip(t.id);
  } else {
    g.setTab('DIPLO');
    const anchor = t.type === 'vendor' ? `vendor-${t.id}` : 'home-front';
    setTimeout(() => document.querySelector(`[data-tutorial="${anchor}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  }
  if (t.type === 'ship') setTimeout(() => document.querySelector(`[data-tutorial="ship-${t.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  if (item.pos) f.panTo(item.pos);
}

/** The open decisions, most urgent first, without the ones dismissed this session. Recomputed once per simulated day or order. */
export function useActionItems(): ActionItem[] {
  const tick = useFleetStore((s) => s.tick);
  const contacts = useFleetStore((s) => s.contacts);
  const shipping = useFleetStore((s) => s.shipping);
  const vendors = useFleetStore((s) => s.vendors);
  const ships = useFleetStore((s) => s.ships);
  const fleets = useFleetStore((s) => s.fleets);
  const spares = useFleetStore((s) => s.spares);
  const budget = useFleetStore((s) => s.resources.budget);
  const dismissed = useFocusStore((s) => s.dismissed);
  return useMemo(() => {
    const items = actionItems(useFleetStore.getState() as unknown as WorldDraft);
    return items.filter((i) => !dismissed.includes(i.id));
  }, [tick, contacts, shipping, vendors, ships, fleets, spares, budget, dismissed]); // eslint-disable-line react-hooks/exhaustive-deps
}

const ALL_KINDS = Object.keys(ACTION_LABEL) as ActionKind[];

/** One line under the command bar: what needs a decision now. Click an item to go to it; Tab cycles, J jumps to the most urgent. */
export default function ActionQueue() {
  const n = useNames();
  const items = useActionItems();
  const locked = useTutorialLocked();
  const pausedFor = useFocusStore((s) => s.pausedFor);
  const autoPause = useFocusStore((s) => s.autoPause);
  const pauseKinds = useFocusStore((s) => s.pauseKinds);
  const cursor = useFocusStore((s) => s.cursor);
  const { dismiss, setAutoPause, toggleKind, setCursor } = useFocusStore.getState();
  const [menu, setMenu] = useState(false);
  if (locked) return null;
  const critical = items.filter((i) => i.critical).length;

  return (
    <div data-tutorial="action-queue" className="relative flex h-8 shrink-0 items-center gap-2 border-b border-phosphor/20 bg-panel/90 px-2 text-[0.8125rem]">
      <span className={`flex shrink-0 items-center gap-1 uppercase tracking-widest ${critical ? 'text-warn' : items.length ? 'text-amber-radar' : 'text-slate-600'}`}>
        <AlertTriangle className="h-3.5 w-3.5" />
        {items.length ? `Action required (${items.length})` : 'No decisions pending'}
      </span>
      {pausedFor && (
        <span className="shrink-0 animate-pulse border border-warn/60 px-1.5 uppercase tracking-widest text-warn" title={`Clock stopped for: ${n.t(pausedFor)} — press 1 to resume`}>
          Auto-paused
        </span>
      )}
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {items.map((i, idx) => (
          <span key={i.id} className={`flex shrink-0 items-center border ${i.critical ? 'border-warn/70 text-warn' : 'border-amber-radar/50 text-amber-radar'} ${idx === cursor ? 'bg-phosphor/10' : ''}`}>
            <button
              className="px-1.5 py-0.5 hover:bg-phosphor/10"
              title={`${ACTION_LABEL[i.kind]} — click to go there`}
              onClick={() => {
                setCursor(idx);
                focusAction(i);
              }}
            >
              {n.t(i.text)}
            </button>
            <button aria-label={`Dismiss ${ACTION_LABEL[i.kind]}`} className="px-1 text-slate-500 hover:text-phosphor" onClick={() => dismiss(i.id)}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <button className={`flex shrink-0 items-center gap-1 border px-1.5 py-0.5 uppercase tracking-widest ${autoPause ? 'border-emerald-accent/60 text-emerald-accent' : 'border-navy text-slate-500'}`} onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label="Auto-pause settings">
        Auto-pause {autoPause ? 'on' : 'off'} <ChevronDown className="h-3 w-3" />
      </button>
      {menu && (
        <div className="absolute right-2 top-8 z-40 w-72 border border-phosphor/50 bg-panel p-2 shadow-glow">
          <label className="flex items-center gap-2 text-phosphor">
            <input type="checkbox" checked={autoPause} onChange={(e) => setAutoPause(e.target.checked)} /> Pause the clock when a new decision appears
          </label>
          <div className="mt-1 space-y-0.5 pl-1">
            {ALL_KINDS.map((k) => (
              <label key={k} className={`flex items-center gap-2 ${autoPause ? 'text-slate-300' : 'text-slate-600'}`}>
                <input type="checkbox" disabled={!autoPause} checked={pauseKinds.includes(k)} onChange={() => toggleKind(k)} /> {ACTION_LABEL[k]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[0.75rem] text-slate-500">Keys: Tab cycles items, J jumps to the most urgent, Esc closes the open contact or ship.</p>
        </div>
      )}
    </div>
  );
}

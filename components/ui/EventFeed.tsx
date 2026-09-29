'use client';

import { useFleetStore } from '@/store/useFleetStore';
import type { EventSeverity } from '@/lib/types/world';

const TONE: Record<EventSeverity, string> = {
  INFO: 'text-slate-400',
  ADVISORY: 'text-emerald-accent',
  WARNING: 'text-amber-radar',
  CRITICAL: 'text-warn glow-red',
  COMBAT: 'text-phosphor',
};
const TAG: Record<EventSeverity, string> = { INFO: 'INF', ADVISORY: 'ADV', WARNING: 'WRN', CRITICAL: 'CRT', COMBAT: 'CBT' };

export default function EventFeed() {
  const log = useFleetStore((s) => s.log);
  const recent = log.slice(-120).reverse();
  return (
    <div className="flex h-full flex-col border-t border-phosphor/30 bg-panel">
      <div className="flex items-center justify-between border-b border-navy px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-phosphor">
        <span>▍Tactical ticker</span>
        <span className="text-slate-500">{log.length} entries</span>
      </div>
      <ul className="flex-1 overflow-y-auto px-2 py-1 text-[11px] leading-snug" aria-live="polite">
        {recent.map((e) => (
          <li key={e.id} className={`whitespace-pre-wrap ${TONE[e.severity]}`}>
            <span className="text-slate-600">D{String(e.tick).padStart(4, '0')} </span>
            <span className="text-slate-500">[{TAG[e.severity]}] </span>
            {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

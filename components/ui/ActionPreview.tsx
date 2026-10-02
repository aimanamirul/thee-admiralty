'use client';

import { CornerDownRight } from 'lucide-react';
import { useMemo } from 'react';
import { useFleetStore } from '@/store/useFleetStore';
import { useNames } from '@/store/useNames';
import { usePreviewStore } from '@/store/usePreviewStore';

/**
 * Strip under the tactical ticker: the predicted effect of the hovered / focused action.
 *
 * It never changes the layout. The strip itself is a fixed two lines tall; a longer prediction grows upward as an overlay on the
 * ticker (anchored to the strip's bottom edge, ignoring the pointer) instead of pushing the map and ticker around.
 */
export default function ActionPreview({ inModal = false }: { inModal?: boolean }) {
  const fn = usePreviewStore((s) => s.fn);
  // Track the live world only while an action is hovered (the prediction follows the clock); otherwise nothing re-renders per tick.
  const live = useFleetStore((s) => (usePreviewStore.getState().fn ? s.tick * 1000 + s.logSeq : 0));
  const budget = useFleetStore((s) => (usePreviewStore.getState().fn ? Math.round(s.resources.budget) : 0));
  const n = useNames();
  const text = useMemo(() => {
    if (!fn) return '';
    try {
      return n.t(fn(useFleetStore.getState().snapshotWorld()));
    } catch {
      return '';
    }
    // `live` and `budget` are the triggers for recomputing against the current world.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, live, budget, n]);
  const blocked = text.startsWith('BLOCKED');
  const tone = !text ? 'text-slate-600' : blocked ? 'text-warn' : 'text-amber-radar';
  return (
    <div data-tutorial={inModal ? undefined : 'action-preview'} className="relative h-[2.75rem] shrink-0">
      <div
        data-testid="action-preview"
        aria-live="polite"
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-30 flex min-h-[2.75rem] items-center gap-2 border-t border-phosphor/30 bg-void px-2 py-1 text-[0.8125rem] leading-snug ${tone} ${
          text.length > 150 ? 'shadow-[0_-8px_16px_rgba(5,8,17,0.9)]' : ''
        }`}
      >
        <CornerDownRight className="h-3.5 w-3.5 shrink-0" />
        <span className="uppercase tracking-wider">{text || 'Hover an action to see its effect'}</span>
      </div>
    </div>
  );
}

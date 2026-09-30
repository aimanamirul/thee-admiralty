'use client';

import { CornerDownRight } from 'lucide-react';
import { useFleetStore } from '@/store/useFleetStore';
import { useNames } from '@/store/useNames';
import { usePreviewStore } from '@/store/usePreviewStore';

/** One-line strip under the tactical ticker: the predicted effect of the hovered / focused action. */
export default function ActionPreview({ inModal = false }: { inModal?: boolean }) {
  const fn = usePreviewStore((s) => s.fn);
  // Re-render on every world change so the prediction tracks the live state while the pointer rests on an action.
  useFleetStore((s) => s.tick + s.logSeq);
  useFleetStore((s) => s.resources);
  const n = useNames();
  let text = '';
  if (fn) {
    try {
      text = n.t(fn(useFleetStore.getState().snapshotWorld()));
    } catch {
      text = '';
    }
  }
  const blocked = text.startsWith('BLOCKED');
  return (
    <div
      data-tutorial={inModal ? undefined : 'action-preview'}
      data-testid="action-preview"
      aria-live="polite"
      className={`flex min-h-[2.25rem] items-center gap-2 border-t border-phosphor/30 bg-void px-2 py-1 text-[0.8125rem] leading-snug ${
        !text ? 'text-slate-600' : blocked ? 'text-warn' : 'text-amber-radar'
      }`}
    >
      <CornerDownRight className="h-3.5 w-3.5 shrink-0" />
      <span className="uppercase tracking-wider">{text || 'Hover an action to see its effect'}</span>
    </div>
  );
}

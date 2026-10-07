'use client';

import { ScrollText } from 'lucide-react';
import { useFleetStore } from '@/store/useFleetStore';
import { useNames } from '@/store/useNames';
import { Btn, Section } from './kit';

/** "While you were away": what the catch-up gained, lost and ran into, and what is holding the navy back now. */
export default function DigestModal() {
  const digest = useFleetStore((s) => s.digest);
  const n = useNames();
  if (!digest) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-void/85 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="While you were away">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-phosphor/60 bg-panel/95 p-4 shadow-glow">
        <div className="mb-2 flex items-center gap-2 text-phosphor">
          <ScrollText className="h-5 w-5" />
          <h2 className="text-lg uppercase tracking-[0.3em]">While you were away</h2>
        </div>
        <Section title="Summary" tone="cyan">
          <ul className="space-y-0.5 text-[0.875rem] text-slate-300">
            {digest.summary.map((l) => (
              <li key={l}>› {n.t(l)}</li>
            ))}
          </ul>
        </Section>
        {digest.losses.length > 0 && (
          <div className="mt-2">
            <Section title="Ships lost" tone="red">
              <ul className="space-y-0.5 text-[0.875rem] text-warn">
                {digest.losses.map((l) => (
                  <li key={l}>✖ {n.t(l)}</li>
                ))}
              </ul>
            </Section>
          </div>
        )}
        {digest.highlights.length > 0 && (
          <div className="mt-2">
            <Section title="From the ledger" tone="amber">
              <ul className="space-y-0.5 text-[0.8125rem] text-slate-400">
                {digest.highlights.map((l) => (
                  <li key={l}>{n.t(l)}</li>
                ))}
              </ul>
            </Section>
          </div>
        )}
        <div className="mt-2">
          <Section title="What is holding the navy back" tone={digest.bottlenecks.length ? 'amber' : 'emerald'}>
            {digest.bottlenecks.length === 0 ? (
              <p className="text-[0.875rem] text-emerald-accent">Nothing is stalled.</p>
            ) : (
              <ul className="space-y-0.5 text-[0.875rem] text-amber-radar">
                {digest.bottlenecks.map((l) => (
                  <li key={l}>⚠ {n.t(l)}</li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div className="mt-3 flex justify-end">
          <Btn tone="emerald" onClick={() => useFleetStore.getState().dismissDigest()}>
            Take command
          </Btn>
        </div>
      </div>
    </div>
  );
}

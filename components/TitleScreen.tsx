'use client';

import { GraduationCap, Play, Radar } from 'lucide-react';
import { useState } from 'react';
import { Btn } from '@/components/ui/kit';
import { ARCHETYPE_LABEL, type MapArchetype } from '@/lib/types/map';
import { DEFAULT_SEED, useFleetStore } from '@/store/useFleetStore';
import { useTutorialStore } from '@/store/useTutorialStore';

/** Title screen: pick the Admiral's Briefing (tutorial) or free play. */
export default function TitleScreen({ onStart }: { onStart: () => void }) {
  const status = useTutorialStore((s) => s.status);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [arch, setArch] = useState<MapArchetype | 'AUTO'>('AUTO');
  const skin = useFleetStore((s) => s.skin);

  const briefing = () => {
    useTutorialStore.getState().begin();
    onStart();
  };
  const freePlay = () => {
    const custom = seed.trim() !== DEFAULT_SEED || arch !== 'AUTO';
    if (custom) useFleetStore.getState().newTheatre(seed, arch === 'AUTO' ? undefined : arch);
    onStart();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-void/90 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Main menu">
      <div className="w-full max-w-xl border border-phosphor/60 bg-panel/95 p-6 shadow-glow">
        <div className="flex items-center gap-3">
          <Radar className="h-9 w-9 text-phosphor" />
          <div>
            <h1 className="glow-text text-3xl tracking-[0.35em] text-phosphor">ADMIRALTY LEDGER</h1>
            <div className="text-[0.8125rem] uppercase tracking-[0.3em] text-slate-500">High naval admiralty · command simulation</div>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <button
            autoFocus
            onClick={briefing}
            className="group flex w-full items-center gap-3 border border-phosphor bg-phosphor/10 px-4 py-3 text-left shadow-glow transition hover:bg-phosphor/20"
          >
            <GraduationCap className="h-6 w-6 shrink-0 text-phosphor" />
            <span className="flex-1">
              <span className="block text-lg uppercase tracking-[0.25em] text-phosphor">Begin briefing</span>
              <span className="block text-[0.875rem] text-slate-400">A guided scenario on a two-sector map: sectors, rotation, contacts, spares, design, R&amp;D and sanctions. About fifteen minutes.</span>
            </span>
            {status === 'new' && <span className="border border-emerald-accent/60 px-1 text-[0.75rem] uppercase tracking-wider text-emerald-accent">Recommended</span>}
            {status === 'done' && <span className="border border-navy px-1 text-[0.75rem] uppercase tracking-wider text-slate-500">Completed</span>}
            {status === 'skipped' && <span className="border border-navy px-1 text-[0.75rem] uppercase tracking-wider text-slate-500">Skipped</span>}
          </button>

          <div className="border border-navy px-4 py-3">
            <button onClick={freePlay} className="flex w-full items-center gap-3 text-left transition hover:text-phosphor">
              <Play className="h-6 w-6 shrink-0 text-slate-400" />
              <span className="flex-1">
                <span className="block text-lg uppercase tracking-[0.25em] text-slate-200">Free play</span>
                <span className="block text-[0.875rem] text-slate-500">Take command of a procedurally generated theatre. Everything is unlocked from the start.</span>
              </span>
            </button>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-navy pt-3 text-[0.8125rem] text-slate-500">
              <label className="flex items-center gap-1">
                Seed
                <input value={seed} onChange={(e) => setSeed(e.target.value)} className="w-32 px-1.5 py-0.5 text-[0.875rem] uppercase" aria-label="Theatre seed" />
              </label>
              <select value={arch} onChange={(e) => setArch(e.target.value as MapArchetype | 'AUTO')} className="px-1 py-0.5 text-[0.8125rem]" aria-label="Theatre archetype">
                <option value="AUTO">AUTO</option>
                {(Object.keys(ARCHETYPE_LABEL) as MapArchetype[]).map((a) => (
                  <option key={a} value={a}>
                    {ARCHETYPE_LABEL[a]}
                  </option>
                ))}
              </select>
              <Btn tone="amber" onClick={freePlay}>
                Deploy
              </Btn>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.75rem] uppercase tracking-[0.2em] text-slate-600">The briefing can be replayed at any time from the top bar.</p>
          <Btn tone="dim" title="Fictional aliases (default) or real vendor and product names" onClick={() => useFleetStore.getState().setSkin(skin === 'FICTIONAL' ? 'REAL' : 'FICTIONAL')}>
            Names: {skin === 'FICTIONAL' ? 'Fictional' : 'Real'}
          </Btn>
        </div>
      </div>
    </div>
  );
}

'use client';

import { Coins, FastForward, GraduationCap, FlaskConical, Factory, Landmark, Pause, Play, Radar, StepForward, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { computeFinance } from '@/lib/sim/worldEngine';
import { ARCHETYPE_LABEL, type MapArchetype } from '@/lib/types/map';
import { useFleetStore, type SimSpeed } from '@/store/useFleetStore';
import type { UiFlag } from '@/lib/tutorial/lessons';
import { useTutorialLocked, useTutorialStore, useUiFlag } from '@/store/useTutorialStore';
import { Term } from '@/components/tutorial/Term';
import { Btn, fmtM, Meter } from './kit';

const START = Date.UTC(2026, 0, 1);
const dateOf = (tick: number) => new Date(START + tick * 86400000).toISOString().slice(0, 10);

function Readout({ icon, label, value, sub, tone = 'text-phosphor', flag, anchor }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: string; flag: UiFlag; anchor: string }) {
  const visible = useUiFlag(flag);
  if (!visible) return null;
  return (
    <div data-tutorial={anchor} className="flex items-center gap-2 border-l border-navy px-3">
      <span className={tone}>{icon}</span>
      <div className="leading-tight">
        <div className="text-[0.75rem] uppercase tracking-[0.2em] text-slate-500">{label}</div>
        <div className={`text-sm tabular-nums ${tone}`}>{value}</div>
        {sub && <div className="text-[0.75rem] tabular-nums text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}

export default function CommandBar() {
  const tick = useFleetStore((s) => s.tick);
  const res = useFleetStore((s) => s.resources);
  const ships = useFleetStore((s) => s.ships);
  const tension = useFleetStore((s) => s.tension);
  const running = useFleetStore((s) => s.running);
  const speed = useFleetStore((s) => s.speed);
  const seed = useFleetStore((s) => s.seed);
  const archetype = useFleetStore((s) => s.map.archetype);
  const uiScale = useFleetStore((s) => s.uiScale);
  const skin = useFleetStore((s) => s.skin);
  const { setRunning, setSpeed, step, newTheatre, setDesignerOpen, setUiScale, setSkin } = useFleetStore.getState();

  const fin = useMemo(() => computeFinance(Object.values(ships)), [ships]);
  const building = useMemo(() => Object.values(ships).filter((s) => s.buildStatus === 'CONSTRUCTING' && !s.frozenBy).length, [ships]);
  const [seedInput, setSeedInput] = useState(seed);
  const [arch, setArch] = useState<MapArchetype | 'AUTO'>('AUTO');
  const showTension = useUiFlag('READOUT_TENSION');
  const showDate = useUiFlag('DATE');
  const showClock = useUiFlag('CLOCK');
  const showDesign = useUiFlag('DESIGN_BTN');
  const locked = useTutorialLocked();
  const beginTutorial = useTutorialStore((s) => s.begin);

  return (
    <header className="flex flex-wrap items-center gap-y-1 border-b border-phosphor/30 bg-panel px-2 py-1">
      <div className="mr-2 flex items-center gap-2 pr-2">
        <Radar className="h-5 w-5 text-phosphor" />
        <div className="leading-tight">
          <div className="glow-text text-lg tracking-[0.3em] text-phosphor">ADMIRALTY LEDGER</div>
          <div className="text-[0.75rem] uppercase tracking-[0.25em] text-slate-500">
            {ARCHETYPE_LABEL[archetype]}
          </div>
        </div>
      </div>

      <Readout icon={<Coins className="h-4 w-4" />} flag="READOUT_BUDGET" anchor="readout-budget" label="Budget" value={fmtM(res.budget)} sub={`${fin.net >= 0 ? '+' : ''}${fin.net.toFixed(1)}M/day`} tone={res.budget < 0 ? 'text-warn' : 'text-phosphor'} />
      <Readout icon={<Factory className="h-4 w-4" />} flag="READOUT_INDUSTRY" anchor="readout-industry" label="Industry" value={`${building}/${res.industrialCapacity}`} sub="slipways busy" />
      <Readout icon={<FlaskConical className="h-4 w-4" />} flag="READOUT_RP" anchor="readout-rp" label="Research" value={`${res.researchPoints.toFixed(0)} RP`} tone="text-emerald-accent" />
      <Readout icon={<Landmark className="h-4 w-4" />} flag="READOUT_PC" anchor="readout-pc" label="Pol. Capital" value={res.politicalCapital.toFixed(1)} tone="text-amber-radar" />
      {showTension && (
        <div data-tutorial="readout-tension" className="flex w-28 flex-col justify-center border-l border-navy px-3">
          <div className="text-[0.75rem] uppercase tracking-[0.2em] text-slate-500"><Term k="TENSION">Tension</Term></div>
          <Meter value={tension} tone={tension > 66 ? 'red' : tension > 40 ? 'amber' : 'emerald'} label={tension.toFixed(0)} />
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {showDate && (
          <div className="text-right leading-tight">
            <div className="text-[0.75rem] uppercase tracking-[0.2em] text-slate-500">DAY {tick}</div>
            <div className="text-xs tabular-nums text-phosphor">{dateOf(tick)}</div>
          </div>
        )}
        {showClock && <div data-tutorial="clock" className="flex items-center gap-1">
          <Btn onClick={() => setRunning(!running)} aria-label={running ? 'Pause' : 'Run'} tone={running ? 'amber' : 'emerald'}>
            {running ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </Btn>
          <Btn onClick={() => step(1)} aria-label="Step one day" disabled={running}>
            <StepForward className="h-3 w-3" />
          </Btn>
          {([1, 4, 16] as SimSpeed[]).map((s) => (
            <Btn key={s} tone={speed === s ? 'cyan' : 'dim'} onClick={() => setSpeed(s)}>
              {s === 16 ? <FastForward className="inline h-3 w-3" /> : null}
              {s}x
            </Btn>
          ))}
        </div>}
        <div className="flex items-center gap-1" title="UI scale">
          <Btn tone="dim" aria-label="Smaller UI" onClick={() => setUiScale(uiScale - 0.1)}>A−</Btn>
          <span className="w-9 text-center text-xs tabular-nums text-slate-500">{Math.round(uiScale * 100)}%</span>
          <Btn tone="dim" aria-label="Larger UI" onClick={() => setUiScale(uiScale + 0.1)}>A+</Btn>
        </div>
        <Btn
          tone="dim"
          aria-label="Name skin"
          title="Fictional aliases (default) or real vendor and product names. Applies everywhere, including past ledger entries."
          onClick={() => setSkin(skin === 'FICTIONAL' ? 'REAL' : 'FICTIONAL')}
        >
          Names: {skin === 'FICTIONAL' ? 'Fictional' : 'Real'}
        </Btn>
        {showDesign && (
          <Btn data-tutorial="design-btn" tone="emerald" onClick={() => setDesignerOpen(true)}>
            <Wrench className="mr-1 inline h-3 w-3" />
            Design bureau
          </Btn>
        )}
        {!locked && (
          <Btn tone="dim" title="Replay the Admiral's Briefing (replaces the current game)" onClick={() => window.confirm("Restart the Admiral's Briefing? The current game will be replaced.") && beginTutorial()}>
            <GraduationCap className="mr-1 inline h-3 w-3" />
            Briefing
          </Btn>
        )}
        {!locked && <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            newTheatre(seedInput, arch === 'AUTO' ? undefined : arch);
          }}
        >
          <input value={seedInput} onChange={(e) => setSeedInput(e.target.value)} className="w-28 px-1.5 py-0.5 text-[0.875rem] uppercase" aria-label="Map seed" />
          <select value={arch} onChange={(e) => setArch(e.target.value as MapArchetype | 'AUTO')} className="px-1 py-0.5 text-[0.8125rem]" aria-label="Theatre archetype">
            <option value="AUTO">AUTO</option>
            {(Object.keys(ARCHETYPE_LABEL) as MapArchetype[]).map((a) => (
              <option key={a} value={a}>
                {ARCHETYPE_LABEL[a]}
              </option>
            ))}
          </select>
          <Btn type="submit" tone="amber">
            Generate
          </Btn>
        </form>}
      </div>
    </header>
  );
}

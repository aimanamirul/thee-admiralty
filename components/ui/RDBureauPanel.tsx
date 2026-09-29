'use client';

import { FlaskConical } from 'lucide-react';
import { useMemo } from 'react';
import { RESEARCH_PROJECTS, type ResearchProject } from '@/lib/data/catalog';
import { frictionSeverity } from '@/lib/sim/designEngine';
import { bridgeSet, BASE_RP_INCOME, canStart, FUND_BUREAU_COST, FUND_BUREAU_RP, RESEARCH_SLOTS, RP_THROUGHPUT_PER_PROJECT } from '@/lib/sim/researchEngine';
import { bridgeKey, PROTOCOLS } from '@/lib/types/equipment';
import { useFleetStore } from '@/store/useFleetStore';
import { Term } from '@/components/tutorial/Term';
import { useNames } from '@/store/useNames';
import { Btn, Chip, Meter, Section } from './kit';


function BridgeMatrix() {
  const n = useNames();
  const completed = useFleetStore((s) => s.research.completed);
  const bridges = useMemo(() => bridgeSet(completed), [completed]);
  return (
    <div className="grid grid-cols-5 gap-px text-center text-[0.75rem]">
      <div />
      {PROTOCOLS.map((p) => (
        <div key={p} className="py-0.5 text-slate-500">{n.xs(p)}</div>
      ))}
      {PROTOCOLS.map((row) => (
        <div key={row} className="contents">
          <div className="py-1 text-right pr-1 text-slate-500">{n.xs(row)}</div>
          {PROTOCOLS.map((col) => {
            const sev = frictionSeverity(row, col);
            const bridged = bridges.has(bridgeKey(row, col));
            const cls = row === col ? 'text-emerald-accent' : bridged ? 'text-phosphor bg-phosphor/10' : sev >= 0.6 ? 'text-warn bg-warn/10' : sev >= 0.3 ? 'text-amber-radar bg-amber-radar/10' : 'text-amber-radar/70 bg-amber-radar/5';
            return (
              <div key={col} className={`border border-navy py-1 tabular-nums ${cls}`} title={row === col ? 'native' : bridged ? 'bridged' : `friction ${sev}`}>
                {row === col ? '=' : bridged ? 'BRG' : sev.toFixed(2)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function RDBureauPanel() {
  const n = useNames();
  const research = useFleetStore((s) => s.research);
  const rp = useFleetStore((s) => s.resources.researchPoints);
  const budget = useFleetStore((s) => s.resources.budget);
  const ic = useFleetStore((s) => s.resources.industrialCapacity);
  const { startResearch, stopResearch, fundBureau, expandIndustry } = useFleetStore.getState();

  const row = (p: ResearchProject) => {
    const progress = research.progress[p.id] ?? 0;
    const done = research.completed.includes(p.id);
    const active = research.active.includes(p.id);
    const can = canStart(research, p.id);
    return (
      <li key={p.id} className={`border px-2 py-1.5 ${done ? 'border-emerald-accent/40 opacity-70' : active ? 'border-emerald-accent shadow-[0_0_8px_rgba(16,185,129,0.3)]' : 'border-navy'}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[0.875rem] text-emerald-accent">{n.p(p.id)}</div>
            <div className="text-[0.8125rem] leading-snug text-slate-500">{n.t(p.blurb)}</div>
          </div>
          <div className="shrink-0 text-right">
            {done ? <Chip tone="emerald">COMPLETE</Chip> : active ? <Btn tone="amber" onClick={() => stopResearch(p.id)}>Pause</Btn> : <Btn tone="emerald" disabled={!can.ok} title={can.reason ? n.t(can.reason) : undefined} onClick={() => startResearch(p.id)}>Start</Btn>}
            <div className="mt-0.5 text-[0.75rem] text-slate-500">{p.costRP} RP</div>
          </div>
        </div>
        {!done && (progress > 0 || active) && <Meter value={progress} max={p.costRP} tone="emerald" label={`${Math.round((progress / p.costRP) * 100)}%`} />}
        {!done && !can.ok && !active && can.reason && <div className="mt-0.5 text-[0.75rem] text-amber-radar/80">{n.t(can.reason)}</div>}
      </li>
    );
  };

  const bridges = RESEARCH_PROJECTS.filter((p) => p.kind === 'PROTOCOL_BRIDGE');
  const domestic = RESEARCH_PROJECTS.filter((p) => p.kind === 'DOMESTIC_SUBSTITUTE');

  return (
    <div className="space-y-2">
      <Section title="Bureau status" tone="emerald" right={<FlaskConical className="h-3 w-3" />}>
        <div className="flex items-baseline justify-between text-[0.875rem]">
          <span className="text-slate-500">Research points banked</span>
          <span className="text-emerald-accent tabular-nums">{rp.toFixed(0)} RP (+{BASE_RP_INCOME}/day)</span>
        </div>
        <div className="text-[0.8125rem] text-slate-500">Engineering slots {research.active.length}/{RESEARCH_SLOTS} · each absorbs up to {RP_THROUGHPUT_PER_PROJECT} RP/day</div>
        <div className="mt-2 flex gap-1">
          <Btn tone="emerald" disabled={budget < FUND_BUREAU_COST} onClick={() => fundBureau()}>Fund bureau: {FUND_BUREAU_COST}M → +{FUND_BUREAU_RP} RP</Btn>
          <Btn tone="amber" disabled={ic >= 8 || budget < 150 * ic} onClick={() => expandIndustry()}>Slipway +1 ({150 * ic}M)</Btn>
        </div>
      </Section>

      <Section title={<Term k="FRICTION">Protocol friction matrix</Term>} tone="amber">
        <BridgeMatrix />
        <p className="mt-1 text-[0.8125rem] text-slate-500">Unbridged pairs add integration friction: slower CMS reaction and sensor tracking lag. A completed bridge removes it fleet-wide, permanently.</p>
      </Section>

      <Section title="Protocol bridges" tone="emerald">
        <ul className="space-y-1">{bridges.map(row)}</ul>
      </Section>
      <Section title="Domestic substitution" tone="emerald">
        <ul className="space-y-1">{domestic.map(row)}</ul>
      </Section>
    </div>
  );
}

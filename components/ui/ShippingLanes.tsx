'use client';

import { Ship } from 'lucide-react';
import { Term } from '@/components/tutorial/Term';
import { premiumPct } from '@/lib/sim/shipping';
import { useFleetStore } from '@/store/useFleetStore';
import { useNames } from '@/store/useNames';
import { useUiFlag } from '@/store/useTutorialStore';
import { Chip, fmtM, Meter, Section, Stat } from './kit';

/** Theatre view of civilian shipping: each lane's war-risk and traffic, the trade index and the running record. */
export default function ShippingLanes() {
  const sh = useFleetStore((s) => s.shipping);
  const n = useNames();
  const show = useUiFlag('SHIPPING');
  if (!show || sh.lanes.length === 0) return null;
  const s = sh.stats;
  return (
    <Section anchor="shipping-lanes" title={<Term k="SHIPPING">Shipping lanes</Term>} tone="cyan" right={<Ship className="h-3.5 w-3.5 text-phosphor" />}>
      <ul className="space-y-1.5">
        {sh.lanes.map((l) => {
          const rerouted = l.reroutedUntil !== null;
          const underway = sh.ships.filter((m) => m.laneId === l.id).length;
          return (
            <li key={l.id}>
              <div className="flex items-center justify-between gap-2 text-[0.8125rem]">
                <span className="text-slate-300">{l.name}</span>
                {rerouted ? <Chip tone="red">REROUTED · day {l.reroutedUntil}+</Chip> : <Chip tone={l.risk > 40 ? 'amber' : 'dim'}>{underway} UNDERWAY</Chip>}
              </div>
              <Meter value={l.risk} tone={rerouted || l.risk > 60 ? 'red' : l.risk > 30 ? 'amber' : 'emerald'} label={`+${premiumPct(l.risk)}%`} />
              <div className="text-[0.6875rem] text-slate-600">
                war-risk premium · traffic {Math.round(l.traffic * 100)}% of normal
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 border-t border-navy pt-1">
        <Stat k="Trade index" v={sh.index.toFixed(0)} tone={sh.index < 85 ? 'text-warn' : sh.index < 97 ? 'text-amber-radar' : 'text-emerald-accent'} />
        <Stat k="Passages completed" v={s.transited} />
        <Stat k="Ships lost" v={`${s.lost} (${fmtM(s.cargoLost)} cargo)`} tone={s.lost > 0 ? 'text-amber-radar' : undefined} />
        <Stat k="Rescued · escorted" v={`${s.rescued} · ${s.escorted}`} />
        <Stat k="Searches · seizures" v={`${s.inspections} · ${s.seized}`} />
        {(s.turnedBack > 0 || s.struck > 0) && <Stat k="Turned back · struck" v={`${s.turnedBack} · ${s.struck}`} tone="text-amber-radar" />}
        {s.toll > 0 && <Stat k="Civilian toll" v={`${s.toll} crew casualties`} tone="text-warn" />}
      </div>
      {sh.lastReport && <p className="mt-1.5 border-t border-navy pt-1 text-[0.75rem] text-slate-500">{n.t(sh.lastReport)}</p>}
    </Section>
  );
}

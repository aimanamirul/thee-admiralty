'use client';

import { stationUpkeep } from '@/lib/sim/moc';
import { Landmark } from 'lucide-react';
import { useMemo } from 'react';
import { Term } from '@/components/tutorial/Term';
import {
  CARRYOVER_SHARE,
  dayOfYear,
  daysToNextTranche,
  FISCAL_YEAR_DAYS,
  forecast,
  hearingBlocked,
  FORECAST_LOCK_DAY,
  pcRegenPerDay,
  polarizationDrift,
  runningCosts,
  spentThisYear,
  SUPPORT_HOSTILE,
  SUPPORT_INQUIRY,
  SUPPORT_STRAINED,
  UNDERSPEND_PACE,
} from '@/lib/sim/politicsEngine';
import { previewHearing } from '@/lib/sim/preview';
import { tradeFactor, TRADE_SUPPORT_DRAIN } from '@/lib/types/shipping';
import { useFleetStore } from '@/store/useFleetStore';
import { Btn, fmtM, Section, Stat } from './kit';

/** Support effects by band, shown in advance so thresholds never surprise the player. */
function supportEffect(s: number): { tone: string; text: string } {
  if (s < SUPPORT_INQUIRY) return { tone: 'text-warn', text: 'Parliamentary inquiry: procurement frozen, next appropriation −20%.' };
  if (s < SUPPORT_HOSTILE) return { tone: 'text-warn', text: 'Ministries refuse lobbying and hearings; political capital drains 0.2/day.' };
  if (s < SUPPORT_STRAINED) return { tone: 'text-amber-radar', text: 'Strained: lobbying costs +50%, political capital regenerates at half rate.' };
  return { tone: 'text-emerald-accent', text: 'Government backs the navy: normal lobbying costs and political capital income.' };
}

export default function HomeFront() {
  const politics = useFleetStore((s) => s.politics);
  const tick = useFleetStore((s) => s.tick);
  const tension = useFleetStore((s) => s.tension);
  const resources = useFleetStore((s) => s.resources);
  const ships = useFleetStore((s) => s.ships);
  const shipping = useFleetStore((s) => s.shipping);
  const { budgetHearing } = useFleetStore.getState();

  const view = { politics, resources, tick, tension, shipping };
  const fc = forecast(view);
  const spent = spentThisYear(view);
  const stations = useFleetStore((s) => s.stations);
  const costs = useMemo(() => { const c = runningCosts(Object.values(ships), tick); const shore = stationUpkeep(stations); return { ...c, shore, total: c.total + shore }; }, [ships, tick, stations]);
  const f = politics.fiscal;
  const doy = dayOfYear(tick);
  const effect = supportEffect(politics.support);
  const carryCap = CARRYOVER_SHARE * f.appropriation;
  const atRisk = Math.max(0, resources.budget + ((4 - f.tranchesPaid) * f.appropriation) / 4 - costs.total * (FISCAL_YEAR_DAYS - doy) - carryCap);

  // Forecast bar spans 0.5x - 1.5x of this year's appropriation.
  const lo = f.appropriation * 0.5;
  const hi = f.appropriation * 1.5;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;

  return (
    <Section anchor="home-front" title={<Term k="SUPPORT">Home front</Term>} tone="amber" right={<Landmark className="h-3.5 w-3.5 text-amber-radar" />}>
      <div className="mb-0.5 flex justify-between text-[0.75rem] uppercase tracking-widest text-slate-500">
        <span>Domestic support</span>
        <span className="tabular-nums text-slate-200">{politics.support.toFixed(0)}</span>
      </div>
      <div className="relative h-2 w-full bg-navy-deep">
        <div
          className={`h-full ${politics.support < SUPPORT_HOSTILE ? 'bg-warn' : politics.support < SUPPORT_STRAINED ? 'bg-amber-radar' : 'bg-emerald-accent'}`}
          style={{ width: `${politics.support}%` }}
        />
        {[SUPPORT_INQUIRY, SUPPORT_HOSTILE, SUPPORT_STRAINED].map((t) => (
          <span key={t} className="absolute -top-0.5 h-3 w-px bg-slate-300/70" style={{ left: `${t}%` }} title={`threshold ${t}`} />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[0.6875rem] text-slate-600">
        <span>{SUPPORT_INQUIRY} inquiry</span>
        <span>{SUPPORT_HOSTILE} refuse</span>
        <span>{SUPPORT_STRAINED} strained</span>
        <span>100</span>
      </div>
      <p className={`mt-1 text-[0.8125rem] ${effect.tone}`}>{effect.text}</p>
      {shipping.lanes.length > 0 && (
        <Stat
          k={<Term k="SHIPPING">Trade index</Term>}
          v={`${shipping.index.toFixed(0)}${shipping.index < 99.5 ? ` (budget ×${tradeFactor(shipping.index).toFixed(2)}, support −${((100 - shipping.index) * TRADE_SUPPORT_DRAIN).toFixed(2)}/day)` : ' — normal'}`}
          tone={shipping.index < 85 ? 'text-warn' : shipping.index < 97 ? 'text-amber-radar' : undefined}
        />
      )}
      {shipping.stats.toll > 0 && <Stat k="Civilian toll" v={`${shipping.stats.toll} crew casualties`} tone="text-warn" />}
      {(politics.polarization ?? 0) > 0.5 && (
        <div className="mt-1">
          <div className="flex justify-between text-[0.75rem] uppercase tracking-widest text-slate-500">
            <span><Term k="POLARIZATION">Polarization</Term></span>
            <span className={(politics.polarization ?? 0) > 60 ? 'text-warn' : (politics.polarization ?? 0) > 20 ? 'text-amber-radar' : 'text-slate-300'}>{(politics.polarization ?? 0).toFixed(0)}</span>
          </div>
          <div className="h-1.5 w-full bg-navy-deep">
            <div className={`h-full ${(politics.polarization ?? 0) > 60 ? 'bg-warn' : 'bg-amber-radar'}`} style={{ width: `${politics.polarization ?? 0}%` }} />
          </div>
          <p className="text-[0.6875rem] text-slate-600">
            {(politics.polarization ?? 0) > 20 ? `Support drains ${polarizationDrift(politics.polarization ?? 0).toFixed(2)}/day and elections swing harder; it eases only while no exclusion order is in force.` : 'Below 20: no lasting effect.'}
          </p>
        </div>
      )}
      <Stat k="Political capital income" v={`${pcRegenPerDay(view) >= 0 ? '+' : ''}${pcRegenPerDay(view).toFixed(2)}/day`} tone={pcRegenPerDay(view) < 0 ? 'text-warn' : undefined} />

      <div className="mt-2 border-t border-navy pt-1.5">
        <div className="flex justify-between text-[0.75rem] uppercase tracking-widest text-slate-500">
          <span>
            <Term k="FISCAL">Fiscal year {f.year}</Term>
          </span>
          <span className="tabular-nums">
            day {doy}/{FISCAL_YEAR_DAYS} · tranche {f.tranchesPaid}/4 · next in {daysToNextTranche(tick)}d
          </span>
        </div>
        <Stat k="Appropriation" v={fmtM(f.appropriation)} />
        <Stat k="Spent this year" v={`${fmtM(spent)} (pace ${(fc.pace * 100).toFixed(0)}%)`} tone={fc.pace < UNDERSPEND_PACE ? 'text-amber-radar' : undefined} />
        <Stat k="Running costs" v={`${costs.total.toFixed(1)}M/day (crew ${costs.wages.toFixed(1)} · ops ${costs.operations.toFixed(1)} · base ${costs.overhead.toFixed(1)} · shore ${costs.shore.toFixed(2)})`} />
        <Stat k="Carryover cap at year end" v={fmtM(carryCap)} />
        {atRisk > 1 && <Stat k="Projected return to Treasury" v={fmtM(atRisk)} tone="text-amber-radar" />}
      </div>

      <div className="mt-2 border-t border-navy pt-1.5">
        <div className="flex justify-between text-[0.75rem] uppercase tracking-widest text-slate-500">
          <span>Next year&apos;s appropriation</span>
          <span className={fc.locked ? 'text-emerald-accent' : 'text-amber-radar'}>
            {fc.locked ? `SET: ${fmtM(fc.mid)}` : `${fmtM(fc.low)} – ${fmtM(fc.high)} · locks day ${FORECAST_LOCK_DAY}`}
          </span>
        </div>
        <div className="relative mt-1 h-3 w-full border border-navy bg-navy-deep" aria-label="Appropriation forecast range">
          <span className="absolute inset-y-0 w-px bg-slate-500" style={{ left: pos(f.appropriation) }} title="this year" />
          <span className="absolute inset-y-0.5 bg-amber-radar/60" style={{ left: pos(fc.low), width: `calc(${pos(fc.high)} - ${pos(fc.low)} + 2px)` }} />
        </div>
        <div className="mt-0.5 text-[0.6875rem] text-slate-600">
          support ×{fc.factors.support.toFixed(2)} · tension ×{fc.factors.tension.toFixed(2)}
          {fc.factors.underspend < 1 && <span className="text-amber-radar"> · underspending ×{fc.factors.underspend.toFixed(2)}</span>}
          {fc.factors.hearing > 1 && <span className="text-emerald-accent"> · hearings ×{fc.factors.hearing.toFixed(2)}</span>}
          {fc.factors.inquiry < 1 && <span className="text-warn"> · inquiry ×0.80</span>}
          {fc.factors.trade < 0.995 && <span className="text-amber-radar"> · trade ×{fc.factors.trade.toFixed(2)}</span>}
        </div>
        <Btn className="mt-1.5 w-full" tone="amber" preview={previewHearing} disabled={!!hearingBlocked(view)} onClick={() => budgetHearing()}>
          Budget hearing: demand more
        </Btn>
      </div>
    </Section>
  );
}

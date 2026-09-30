'use client';

import { useMemo } from 'react';
import { MINISTRIES, MODULES } from '@/lib/data/catalog';
import { standingTier, type Vendor } from '@/lib/types/diplomacy';
import { useFleetStore } from '@/store/useFleetStore';
import { Term } from '@/components/tutorial/Term';
import { useNames } from '@/store/useNames';
import { Btn, Chip, Meter, Section } from './kit';
import { previewLobby } from '@/lib/sim/preview';
import { lobbyCost, ministriesRefuse } from '@/lib/sim/politicsEngine';
import HomeFront from './HomeFront';

function statusChip(v: Vendor, tick: number) {
  switch (v.status) {
    case 'ACTIVE': return <Chip tone="emerald">LICENCE ACTIVE</Chip>;
    case 'WARNING': return <Chip tone="amber">WARNING · {v.pendingSanction?.replace('_', ' ')} IN {Math.max(0, (v.statusUntilTick ?? tick) - tick)}D</Chip>;
    case 'FROZEN': return <Chip tone="red">FROZEN · {Math.max(0, (v.statusUntilTick ?? tick) - tick)}D LEFT</Chip>;
    case 'REVOKED': return <Chip tone="red">REVOKED</Chip>;
  }
}

export default function DiplomacyLedger() {
  const n = useNames();
  const politics = useFleetStore((s) => s.politics);
  const politicsView = { politics };
  const refuse = ministriesRefuse(politicsView);
  const vendors = useFleetStore((s) => s.vendors);
  const tension = useFleetStore((s) => s.tension);
  const pc = useFleetStore((s) => s.resources.politicalCapital);
  const tick = useFleetStore((s) => s.tick);
  const sanctions = useFleetStore((s) => s.sanctions);
  const { lobby } = useFleetStore.getState();
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of MODULES) c[m.vendorId] = (c[m.vendorId] ?? 0) + 1;
    return c;
  }, []);

  return (
    <div className="space-y-2">
      <HomeFront />
      <Section title={<Term k="TENSION">Geopolitical climate</Term>} tone="amber" right={<span className="text-amber-radar">PC {pc.toFixed(1)}</span>}>
        <Meter value={tension} tone={tension > 66 ? 'red' : tension > 40 ? 'amber' : 'emerald'} label={tension.toFixed(0)} />
        <p className="mt-1 text-[0.8125rem] text-slate-500">Tension raises the chance a vendor state revokes licences, freezes exports or embargoes spares. Ministerial lobbying builds standing; at 65+ a pending sanction is averted outright.</p>
      </Section>

      {Object.values(vendors).map((v) => {
        const tier = standingTier(v.standing);
        const risk = v.id === 'DOMESTIC_YARDS' ? 0 : ((tension / 100) ** 2 * v.volatility * 0.03 * (1 - v.standing / 130)) * 30 * 100;
        return (
          <Section key={v.id} anchor={`vendor-${v.id}`} title={`${n.v(v.id)} · ${n.c(v.id)}`} tone={v.status === 'FROZEN' || v.status === 'REVOKED' ? 'red' : v.status === 'WARNING' ? 'amber' : 'cyan'} right={statusChip(v, tick)}>
            <div className="flex items-center gap-2 text-[0.8125rem] text-slate-500">
              <span><Term k="STANDING">STANDING</Term></span>
              <div className="relative flex-1">
                <Meter value={v.standing} tone="cyan" label={v.standing.toFixed(0)} />
                {[25, 50, 75].map((t) => (
                  <span key={t} className="absolute top-0 h-1.5 w-px bg-slate-500/70" style={{ left: `calc((100% - 2.25rem - 0.375rem) * ${t / 100})` }} />
                ))}
              </div>
              <span className="text-phosphor">T{tier}</span>
            </div>
            <div className="mt-1 flex justify-between text-[0.8125rem] text-slate-500">
              <span>{n.vs(v.id)} · {counts[v.id] ?? 0} catalogue lines</span>
              {v.id !== 'DOMESTIC_YARDS' && <span className={risk > 8 ? 'text-warn' : risk > 3 ? 'text-amber-radar' : ''}>30-DAY SANCTION RISK ≈ {risk.toFixed(1)}%</span>}
            </div>
            {v.id !== 'DOMESTIC_YARDS' && (
              <div className="mt-1.5 grid grid-cols-3 gap-1">
                {MINISTRIES.map((m) => (
                  <Btn key={m.id} tone="amber" disabled={pc < lobbyCost(politicsView, m.cost) || !!refuse} title={`${m.name} — ${m.description}`} preview={(w) => `${m.name.split(' — ')[0]}: ${previewLobby(w, v.id, m.id)}`} onClick={() => lobby(v.id, m.id)}>
                    {m.name.split(' — ')[0].replace('Ministry of ', '')} · {lobbyCost(politicsView, m.cost)}PC
                  </Btn>
                ))}
              </div>
            )}
          </Section>
        );
      })}

      <Section title="Sanction register" tone="red">
        {sanctions.length === 0 && <p className="text-[0.875rem] text-slate-500">No sanctions on record.</p>}
        <ul className="space-y-0.5 text-[0.8125rem]">
          {[...sanctions].reverse().slice(0, 8).map((s) => {
            const live = s.endTick === null || s.endTick > tick;
            return (
              <li key={s.id} className={live ? 'text-warn' : 'text-slate-600'}>
                D{s.startTick} · {n.v(s.vendorId)} · {s.kind.replace('_', ' ')} · {live ? (s.endTick === null ? 'INDEFINITE' : `until D${s.endTick}`) : 'lifted'}
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}

'use client';

import { Scale } from 'lucide-react';
import { useState } from 'react';
import { Term } from '@/components/tutorial/Term';
import { INTERDICTION_FLAGS, laneSectors, liftBlocked, NOTICE_DAYS, zoneBlocked, zoneInForce, zonePolicyBlocked } from '@/lib/sim/interdiction';
import { previewDeclareZone, previewLiftZone, previewZonePolicy } from '@/lib/sim/preview';
import { flagText } from '@/lib/sim/shipping';
import { POLICY_LABEL, POLICY_SHORT, type FlagFilter, type InterdictionPolicy } from '@/lib/types/shipping';
import { useFleetStore } from '@/store/useFleetStore';
import { useNames } from '@/store/useNames';
import { useUiFlag } from '@/store/useTutorialStore';
import { Btn, Chip, Section } from './kit';

const POLICIES: InterdictionPolicy[] = ['INSPECT_ALL', 'TURN_BACK', 'UNRESTRICTED'];
const POLICY_TONE: Record<InterdictionPolicy, 'cyan' | 'amber' | 'red'> = { INSPECT_ALL: 'cyan', TURN_BACK: 'amber', UNRESTRICTED: 'red' };

/**
 * Maritime exclusion orders: the navy's economic-warfare lever. Always announced with a notice period, always costly (flag state, bloc,
 * trade, a polarized home front), and every casualty is counted. Nothing here is a free win.
 */
export default function InterdictionPanel() {
  const zones = useFleetStore((s) => s.shipping.zones);
  const lanes = useFleetStore((s) => s.shipping.lanes);
  const tick = useFleetStore((s) => s.tick);
  const map = useFleetStore((s) => s.map);
  const n = useNames();
  const show = useUiFlag('FORCE');
  const { declareZone, liftZone, setZonePolicy } = useFleetStore.getState();
  const [flag, setFlag] = useState<FlagFilter>('ALL');
  const [sectors, setSectors] = useState<number[]>([]);
  const [policy, setPolicy] = useState<InterdictionPolicy>('INSPECT_ALL');
  if (!show || lanes.length === 0) return null;
  const world = useFleetStore.getState().snapshotWorld();
  const options = laneSectors(world);
  const toggle = (s: number) => setSectors((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <Section anchor="interdiction" title={<Term k="INTERDICTION">Exclusion orders</Term>} tone="red" right={<Scale className="h-3.5 w-3.5 text-warn" />}>
      <p className="mb-1.5 text-[0.75rem] text-slate-500">
        Bar a flag from lane sectors. {NOTICE_DAYS} days&apos; notice before any force; shipping reroutes at once and every cost shows before you act. Passenger ferries are never targets.
      </p>
      {zones.length === 0 && <p className="text-[0.8125rem] text-slate-600">No exclusion orders in force.</p>}
      <ul className="space-y-2">
        {zones.map((z) => {
          const live = zoneInForce(z, tick);
          return (
            <li key={z.id} className="border border-navy p-1.5">
              <div className="flex flex-wrap items-center gap-1 text-[0.8125rem]">
                <span className="text-warn">{z.id}</span>
                <span className="text-slate-300">{n.t(flagText(z.flag))}</span>
                <Chip tone={live ? 'red' : 'amber'}>{live ? 'IN FORCE' : `NOTICE · FORCE FROM DAY ${z.effectiveTick}`}</Chip>
              </div>
              <div className="mt-0.5 text-[0.75rem] text-slate-500">{z.sectors.map((s) => map.sectors[s].label).join(' · ')}</div>
              <div className="mt-1 grid grid-cols-3 gap-1">
                {POLICIES.map((p) => (
                  <Btn
                    key={p}
                    tone={z.policy === p ? POLICY_TONE[p] : 'dim'}
                    disabled={!!zonePolicyBlocked(world, z.id, p)}
                    preview={(w) => `${POLICY_LABEL[p]}: ${previewZonePolicy(w, z.id, p)}`}
                    onClick={() => setZonePolicy(z.id, p)}
                  >
                    {POLICY_SHORT[p]}
                  </Btn>
                ))}
              </div>
              <Btn className="mt-1 w-full" tone="dim" disabled={!!liftBlocked(world, z.id)} preview={(w) => `Lift: ${previewLiftZone(w, z.id)}`} onClick={() => liftZone(z.id)}>
                Lift order
              </Btn>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 border-t border-navy pt-1.5">
        <div className="text-[0.75rem] uppercase tracking-widest text-slate-500">New order</div>
        <select aria-label="Exclusion flag" value={flag} onChange={(e) => setFlag(e.target.value as FlagFilter)} className="mt-1 w-full px-1.5 py-1 text-[0.875rem]">
          {INTERDICTION_FLAGS.map((f) => (
            <option key={f} value={f}>
              {n.t(flagText(f))}
            </option>
          ))}
        </select>
        <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Exclusion sectors">
          {options.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sectors.includes(s)}
              title={map.sectors[s].name}
              onClick={() => toggle(s)}
              className={`border px-1.5 py-0.5 text-[0.8125rem] ${sectors.includes(s) ? 'border-warn/70 bg-warn/10 text-warn' : 'border-navy text-slate-500 hover:border-phosphor/50'}`}
            >
              S{s + 1}
            </button>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1">
          {POLICIES.map((p) => (
            <Btn key={p} tone={policy === p ? POLICY_TONE[p] : 'dim'} onClick={() => setPolicy(p)}>
              {POLICY_SHORT[p]}
            </Btn>
          ))}
        </div>
        <Btn
          className="mt-1.5 w-full"
          tone="red"
          disabled={!!zoneBlocked(world, flag, sectors)}
          preview={(w) => `Declare: ${previewDeclareZone(w, flag, sectors, policy)}`}
          onClick={() => {
            const r = declareZone(flag, sectors, policy);
            if (r.ok) setSectors([]);
          }}
        >
          Declare exclusion order
        </Btn>
      </div>
    </Section>
  );
}

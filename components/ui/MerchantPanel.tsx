'use client';

import { Anchor, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Term } from '@/components/tutorial/Term';
import { allTaskForces } from '@/lib/sim/fleetEngine';
import { inspectBlocked, engageBlocked } from '@/lib/sim/interdiction';
import { merchantStatusLine, previewCancelEscort, previewEngage, previewEscort, previewInspect } from '@/lib/sim/preview';
import { escortBlocked, flagText, laneOf, MERCHANT_SPEED, premiumPct } from '@/lib/sim/shipping';
import { KIND_LABEL } from '@/lib/types/shipping';
import { useFleetStore } from '@/store/useFleetStore';
import { useNames } from '@/store/useNames';
import { Btn, Chip, fmtM, Section, Stat } from './kit';

/** The selected merchant ship: who it is, whether it is covered, and escort orders (also the way to answer a distress call). */
export default function MerchantPanel() {
  const id = useFleetStore((s) => s.selectedMerchantId);
  const m = useFleetStore((s) => s.shipping.ships.find((x) => x.id === s.selectedMerchantId));
  const lanes = useFleetStore((s) => s.shipping.lanes);
  const fleets = useFleetStore((s) => s.fleets);
  const n = useNames();
  const { selectMerchant, escortMerchant, cancelEscort, inspectMerchant, engageMerchant } = useFleetStore.getState();
  // A strike needs a second click; changing ship or task force disarms it.
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => setArmed(null), [id]);
  if (!id) return null;

  if (!m) {
    return (
      <Section title="Merchant ship" right={<Btn tone="dim" onClick={() => selectMerchant(null)}>Close</Btn>}>
        <p className="text-[0.8125rem] text-slate-500">Ship lost from the plot: it reached port, was lost, or foundered. See the ticker.</p>
      </Section>
    );
  }
  const world = useFleetStore.getState().snapshotWorld();
  const lane = lanes.find((l) => l.id === m.laneId) ?? laneOf({ lanes }, m.laneId);
  const distress = m.status === 'DISTRESS';
  const remaining = lane ? (m.dir === 1 ? lane.length - m.dist : m.dist) : 0;
  const tfs = allTaskForces(fleets);

  return (
    <Section
      anchor="merchant-panel"
      tone={distress ? 'amber' : 'cyan'}
      title={
        <span className="inline-flex items-center gap-1.5">
          <Anchor className="h-3.5 w-3.5" /> {m.name}
        </span>
      }
      right={
        <button aria-label="Close merchant ship" onClick={() => selectMerchant(null)} className="text-slate-500 hover:text-phosphor">
          <X className="h-3.5 w-3.5" />
        </button>
      }
    >
      <div className="mb-1 flex flex-wrap gap-1">
        <Chip tone={distress ? 'amber' : 'dim'}>{distress ? 'DISTRESS' : 'UNDERWAY'}</Chip>
        <Chip tone="dim">{KIND_LABEL[m.kind]}</Chip>
        <Chip tone="dim">{n.t(flagText(m.flag))}</Chip>
        {m.escort && (
          <Chip tone="cyan">
            {tfs.find((t) => t.id === m.escort)?.escortMode === 'INSPECT' ? 'SEARCH' : 'ESCORT'}: {tfs.find((t) => t.id === m.escort)?.name ?? m.escort}
          </Chip>
        )}
        {m.tip && <Chip tone="amber">TIP-OFF</Chip>}
        {m.inspecting && <Chip tone="cyan">SEARCH UNDER WAY · DAY {m.inspecting.doneTick}</Chip>}
        {m.checked && !m.inspecting && <Chip tone="dim">SEARCHED</Chip>}
        {m.turnedBack && <Chip tone="amber">TURNED BACK</Chip>}
      </div>
      <p className={`mb-1 text-[0.8125rem] ${distress ? 'text-amber-radar' : 'text-slate-400'}`}>{n.t(merchantStatusLine(world, m.id))}</p>
      <Stat k="Cargo" v={fmtM(m.cargo)} />
      <Stat k="Lane" v={lane ? lane.name.replace(/^LANE \d+: /, '') : '—'} />
      <Stat k="To port" v={`~${Math.ceil(remaining / MERCHANT_SPEED)} days`} />
      {lane && <Stat k={<Term k="SHIPPING">War-risk premium</Term>} v={`+${premiumPct(lane.risk)}%`} tone={lane.risk > 40 ? 'text-amber-radar' : undefined} />}

      <div className="mt-2 text-[0.75rem] uppercase tracking-widest text-slate-500">
        <Term k="ESCORT">{distress ? 'Answer the distress call' : 'Escort'}</Term>
      </div>
      <ul className="mt-1 space-y-1">
        {tfs.map((tf) => {
          const mine = tf.escort === m.id;
          const d = Math.hypot(tf.position.x - m.position.x, tf.position.y - m.position.y);
          return (
            <li key={tf.id} className="flex items-center justify-between gap-2 border border-navy px-1.5 py-0.5 text-[0.8125rem]">
              <span className="text-slate-300">
                {tf.name} <span className="text-slate-600">· {d.toFixed(0)} tiles{tf.escort && !mine ? ' · escorting' : ''}</span>
              </span>
              <span className="flex gap-1">
                {mine ? (
                  <Btn tone="dim" preview={(w) => `Release: ${previewCancelEscort(w, tf.id)}`} onClick={() => cancelEscort(tf.id)}>
                    Release
                  </Btn>
                ) : (
                  <>
                    <Btn tone="cyan" disabled={!!escortBlocked(world, tf.id, m.id)} preview={(w) => `Escort: ${previewEscort(w, tf.id, m.id)}`} onClick={() => escortMerchant(tf.id, m.id)}>
                      {distress ? 'Aid' : 'Escort'}
                    </Btn>
                    <Btn tone="amber" disabled={!!inspectBlocked(world, tf.id, m.id)} preview={(w) => `Search: ${previewInspect(w, tf.id, m.id)}`} onClick={() => inspectMerchant(tf.id, m.id)}>
                      Search
                    </Btn>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {m.kind !== 'FERRY' && (
        <>
          <div className="mt-2 text-[0.75rem] uppercase tracking-widest text-warn">
            <Term k="INTERDICTION">Use of force</Term>
          </div>
          <ul className="mt-1 space-y-1">
            {tfs.map((tf) => (
              <li key={tf.id} className="flex items-center justify-between gap-2 border border-navy px-1.5 py-0.5 text-[0.8125rem]">
                <span className="text-slate-400">{tf.name}</span>
                <Btn
                  tone="red"
                  disabled={!!engageBlocked(world, tf.id, m.id)}
                  preview={(w) => `Engage: ${previewEngage(w, tf.id, m.id)}`}
                  onClick={() => {
                    if (armed !== tf.id) return setArmed(tf.id);
                    setArmed(null);
                    engageMerchant(tf.id, m.id);
                  }}
                >
                  {armed === tf.id ? 'Confirm strike' : 'Engage'}
                </Btn>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-1 text-[0.75rem] text-slate-600">
        A task force within 14 tiles, or one holding the sector the ship is in, protects it. Raiders hunt unprotected lane traffic; a damaged ship founders after six days unless a task force reaches it.
      </p>
    </Section>
  );
}

'use client';

import { useMemo } from 'react';
import { HULLS } from '@/lib/data/catalog';
import { allTaskForces, taskForceShipIds } from '@/lib/sim/fleetEngine';
import type { Roe, Sop } from '@/lib/types/world';
import { contactStatus } from '@/lib/sim/contactEngine';
import ContactPanel from './ContactPanel';
import { DETERRENCE_PER_DAY, presenceLabel, sectorPresence } from '@/lib/sim/presence';
import MerchantPanel from './MerchantPanel';
import ShippingLanes from './ShippingLanes';
import InterdictionPanel from './InterdictionPanel';
import { INTERDICTION_FLAGS } from '@/lib/sim/interdiction';
import { flagText } from '@/lib/sim/shipping';
import type { FlagFilter } from '@/lib/types/shipping';
import { useNames } from '@/store/useNames';
import { useUiFlag } from '@/store/useTutorialStore';
import { useFleetStore } from '@/store/useFleetStore';
import { Term } from '@/components/tutorial/Term';
import { Btn, Chip, Meter, Section, Stat } from './kit';
import { previewAssign, previewRoe, previewSop } from '@/lib/sim/preview';

const ROES: { id: Roe; label: string; hint: string }[] = [
  { id: 'HOLD_FIRE', label: 'Hold fire', hint: 'Never fire first. Hostile raids get a surprise opening salvo.' },
  { id: 'RETURN_FIRE', label: 'Return fire', hint: 'Engage only hostile-identified tracks. Balanced.' },
  { id: 'WEAPONS_FREE', label: 'Weapons free', hint: 'First-strike advantage — but unidentified civilians may be engaged (incidents).' },
];

const SOPS: { id: Sop; label: string }[] = [
  { id: 'OBSERVE', label: 'Observe' },
  { id: 'CHALLENGE', label: 'Challenge' },
  { id: 'ASSERTIVE', label: 'Assertive' },
];

const threatTone = (t: number) => (t > 66 ? 'red' : t > 40 ? 'amber' : 'emerald');

export default function SectorPanel() {
  const map = useFleetStore((s) => s.map);
  const sectorStates = useFleetStore((s) => s.sectors);
  const selected = useFleetStore((s) => s.selectedSectorId);
  const fleets = useFleetStore((s) => s.fleets);
  const ships = useFleetStore((s) => s.ships);
  const contacts = useFleetStore((s) => s.contacts);
  const selectedTf = useFleetStore((s) => s.selectedTaskForceId);
  const selectedContact = useFleetStore((s) => s.selectedContactId);
  const merchants = useFleetStore((s) => s.shipping.ships);
  const hasLanes = useFleetStore((s) => s.shipping.lanes.length > 0);
  const showInspect = useUiFlag('INSPECT');
  const n = useNames();
  const selectedMerchant = useFleetStore((s) => s.selectedMerchantId);
  const { selectSector, setRoe, assignTaskForce, setSop, selectContact, selectMerchant, setSectorInspect } = useFleetStore.getState();

  const tfs = useMemo(() => allTaskForces(fleets), [fleets]);

  if (selected === null) {
    return (
      <div className="space-y-2">
        <Section title="Theatre overview">
          <p className="mb-2 text-[0.875rem] text-slate-400">Select a sector on the plot (left click) or below. Right-click a sector with a task force selected to order it on station.</p>
          <ul className="space-y-1">
            {map.sectors.map((s) => {
              const st = sectorStates[s.id];
              return (
                <li key={s.id}>
                  <button onClick={() => selectSector(s.id)} className="w-full border border-navy px-2 py-1 text-left hover:border-phosphor/60">
                    <div className="flex items-center justify-between text-[0.875rem]">
                      <span className="text-phosphor">{s.name}</span>
                      <span className="tabular-nums text-slate-500">{st.roe.replace('_', ' ')}</span>
                    </div>
                    <Meter value={st.threat} tone={threatTone(st.threat)} label={st.threat.toFixed(0)} />
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
        <Section title="Chokepoints" tone="amber">
          {map.chokepoints.length === 0 && <p className="text-[0.875rem] text-slate-500">None identified.</p>}
          {map.chokepoints.map((c) => (
            <div key={c.id} className="flex justify-between text-[0.875rem]">
              <span className="text-amber-radar">{c.name}</span>
              <span className="text-slate-400">{c.widthTiles} tile{c.widthTiles === 1 ? '' : 's'} · {c.links.map((l) => `S${l + 1}`).join('↔')}</span>
            </div>
          ))}
        </Section>
        <ShippingLanes />
        <InterdictionPanel />
      </div>
    );
  }

  const sec = map.sectors[selected];
  const st = sectorStates[selected];
  const presence = sectorPresence({ fleets, ships, map }, selected);
  const chokes = map.chokepoints.filter((c) => c.links.includes(selected));
  const here = contacts.filter((c) => c.sectorId === selected);
  const shipsHere = merchants.filter((m) => map.sectorGrid[Math.round(m.position.y) * map.width + Math.round(m.position.x)] === selected);
  const roe = ROES.find((r) => r.id === st.roe)!;
  const deepDraftRisk = Math.round(sec.littoralFraction * 100 * 2.5);

  return (
    <div className="space-y-2">
      <ContactPanel />
      <MerchantPanel />
      <Section title={sec.name} right={<Btn tone="dim" onClick={() => selectSector(null)}>Overview</Btn>}>
        <div className="mb-2 flex flex-wrap gap-1">
          <Chip tone="cyan">{sec.kind}</Chip>
          {sec.touchesEdge && <Chip tone="dim">OPEN OCEAN ACCESS</Chip>}
          {sec.abyssalFraction > 0.4 && <Chip tone="emerald">ABYSSAL — SUB / CARRIER WATERS</Chip>}
          {sec.littoralFraction > 0.25 && <Chip tone="amber"><Term k="LITTORAL">LITTORAL</Term> — MISSILE BOAT HEAVEN</Chip>}
        </div>
        <div className="mb-1 text-[0.8125rem] uppercase tracking-widest text-slate-500">
          <Term k="THREAT">Threat level</Term>
        </div>
        <Meter value={st.threat} tone={threatTone(st.threat)} label={st.threat.toFixed(0)} />
        <div className="mt-1">
          <Stat
            k={<Term k="PRESENCE">Naval presence</Term>}
            v={presence.presence > 0 ? `${presence.presence.toFixed(1)} · ${presenceLabel(presence.presence)} · threat −${(DETERRENCE_PER_DAY * presence.presence).toFixed(2)}/day` : 'none on station'}
            tone={presence.presence > 0 ? 'text-emerald-accent' : 'text-slate-500'}
          />
        </div>
        <div data-tutorial="roe">
        <div className="mt-2 text-[0.8125rem] uppercase tracking-widest text-slate-500">
          <Term k="ROE">Rules of engagement</Term>
        </div>
        <div className="mt-1 flex gap-1">
          {ROES.map((r) => (
            <Btn key={r.id} tone={st.roe === r.id ? (r.id === 'WEAPONS_FREE' ? 'red' : r.id === 'HOLD_FIRE' ? 'amber' : 'cyan') : 'dim'} preview={(w) => `${r.label}: ${previewRoe(w, selected, r.id)}`} onClick={() => setRoe(selected, r.id)} className="flex-1">
              {r.label}
            </Btn>
          ))}
        </div>
        <p className="mt-1 text-[0.8125rem] text-slate-500">{roe.hint}</p>
        </div>
        <div data-tutorial="sop">
          <div className="mt-2 text-[0.8125rem] uppercase tracking-widest text-slate-500">
            <Term k="SOP">Contact procedure (SOP)</Term>
          </div>
          <div className="mt-1 flex gap-1">
            {SOPS.map((s) => (
              <Btn key={s.id} tone={st.sop === s.id ? 'cyan' : 'dim'} preview={(w) => `${s.label}: ${previewSop(w, selected, s.id)}`} onClick={() => setSop(selected, s.id)} className="flex-1">
                {s.label}
              </Btn>
            ))}
          </div>
        </div>
        {hasLanes && showInspect && (
          <div data-tutorial="inspect-order">
            <div className="mt-2 text-[0.8125rem] uppercase tracking-widest text-slate-500">
              <Term k="INSPECTION">Merchant searches</Term>
            </div>
            <select
              aria-label="Search order flag"
              value={st.inspect ?? ''}
              onChange={(e) => setSectorInspect(selected, e.target.value ? (e.target.value as FlagFilter) : null)}
              className="mt-1 w-full px-1.5 py-1 text-[0.875rem]"
            >
              <option value="">— no standing search order —</option>
              {INTERDICTION_FLAGS.map((f) => (
                <option key={f} value={f}>
                  Search {n.t(flagText(f))} ships
                </option>
              ))}
            </select>
            <p className="mt-1 text-[0.75rem] text-slate-600">Task forces at sea search matching ships that pass close by. Contraband is seized; a clean search costs standing with the flag state.</p>
          </div>
        )}
        {shipsHere.length > 0 && (
          <div className="mt-2">
            <div className="text-[0.8125rem] uppercase tracking-widest text-slate-500">Merchant ships in sector</div>
            <ul className="mt-1 space-y-0.5">
              {shipsHere.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => selectMerchant(m.id)}
                    className={`flex w-full justify-between border px-1.5 py-0.5 text-left text-[0.8125rem] hover:border-phosphor/60 ${selectedMerchant === m.id ? 'border-phosphor/70' : 'border-navy'}`}
                  >
                    <span className={m.status === 'DISTRESS' ? 'text-amber-radar' : 'text-slate-300'}>{m.name}</span>
                    <span className="text-slate-500">{m.status === 'DISTRESS' ? 'DISTRESS' : m.kind}{m.escort ? ' · ESCORTED' : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {here.length > 0 && (
          <div className="mt-2">
            <div className="text-[0.8125rem] uppercase tracking-widest text-slate-500">Contacts in sector</div>
            <ul className="mt-1 space-y-0.5">
              {here.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => selectContact(c.id)}
                    className={`flex w-full justify-between border px-1.5 py-0.5 text-left text-[0.8125rem] hover:border-phosphor/60 ${selectedContact === c.id ? 'border-phosphor/70' : 'border-navy'}`}
                  >
                    <span className={c.cls === 'HOSTILE' ? 'text-warn' : c.cls === 'NEUTRAL' ? 'text-emerald-accent' : 'text-amber-radar'}>{contactStatus(c)}</span>
                    <span className="text-slate-500">{c.id.slice(3, 11)}{c.order ? ` · ${c.order === 'SHADOW' ? 'HOLD' : c.order}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Bathymetry & telemetry">
        <div className="mb-1 flex h-3 w-full overflow-hidden border border-navy" title="littoral / shelf / abyssal">
          <div style={{ width: `${sec.littoralFraction * 100}%` }} className="bg-amber-radar/80" />
          <div style={{ width: `${sec.shelfFraction * 100}%` }} className="bg-[#2a5c8a]" />
          <div style={{ width: `${sec.abyssalFraction * 100}%` }} className="bg-[#10233a]" />
        </div>
        <div className="mb-2 flex justify-between text-[0.75rem] text-slate-500">
          <span className="text-amber-radar">LITTORAL {(sec.littoralFraction * 100).toFixed(0)}%</span>
          <span className="text-[#5a9bd0]">SHELF {(sec.shelfFraction * 100).toFixed(0)}%</span>
          <span>ABYSSAL {(sec.abyssalFraction * 100).toFixed(0)}%</span>
        </div>
        <Stat k="Area" v={`${sec.areaTiles} tiles`} />
        <Stat k="Widest clearance" v={`${sec.maxClearance.toFixed(1)} tiles`} />
        <Stat k="Deep-draft grounding exposure" v={`${deepDraftRisk}%`} tone={deepDraftRisk > 50 ? 'text-warn' : 'text-slate-200'} />
        <Stat k="Neighbours" v={sec.neighbors.length ? sec.neighbors.map((n) => `S${n + 1}`).join(' ') : '—'} />
        <Stat k="Contacts on plot" v={here.length ? `${here.length} (${here.filter((c) => c.cls === 'HOSTILE').length} hostile)` : 'none'} tone={here.some((c) => c.cls === 'HOSTILE') ? 'text-warn' : undefined} />
        {chokes.length > 0 && (
          <div className="mt-2 border-t border-navy pt-1">
            <div className="text-[0.8125rem] uppercase tracking-widest text-amber-radar">Chokepoints</div>
            {chokes.map((c) => (
              <div key={c.id} className="flex justify-between text-[0.875rem]">
                <span className="text-amber-radar">{c.name}</span>
                <span className="text-slate-400">{c.widthTiles}T wide</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Deployment" tone="emerald">
        {tfs.map((tf) => {
          const onStation = tf.assignedSectorId === selected;
          const list = taskForceShipIds(tf).map((id) => ships[id]).filter(Boolean);
          const patrol = list.filter((s) => s.state === 'ACTIVE_PATROL').length;
          const deep = list.filter((s) => HULLS[s.hullId].draftM >= 6.8).length;
          return (
            <div key={tf.id} className={`mb-1 flex items-center justify-between border px-2 py-1 text-[0.875rem] ${onStation ? 'border-emerald-accent/60' : 'border-navy'} ${selectedTf === tf.id ? 'bg-phosphor/5' : ''}`}>
              <div>
                <span className="text-phosphor">{tf.name}</span>{' '}
                <span className="text-slate-500">
                  {list.length} hulls · {patrol} on patrol{deep ? ` · ${deep} deep-draft` : ''}
                </span>
              </div>
              {onStation ? <Btn tone="dim" preview={(w) => `Recall: ${previewAssign(w, tf.id, null)}`} onClick={() => assignTaskForce(tf.id, null)}>Recall</Btn> : <Btn tone="emerald" preview={(w) => `Assign: ${previewAssign(w, tf.id, selected)}`} onClick={() => assignTaskForce(tf.id, selected)}>Assign</Btn>}
            </div>
          );
        })}
      </Section>
    </div>
  );
}

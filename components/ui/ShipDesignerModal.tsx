'use client';

import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { HULL_LIST, HULLS, MODULE_BY_ID, MODULES, VENDOR_SHORT } from '@/lib/data/catalog';
import { TRADITIONS, TRADITION_LABEL } from '@/lib/generator/nameGenerator';
import { evaluateLoadout, procurability, SLOT_LABEL } from '@/lib/sim/designEngine';
import { bridgeSet } from '@/lib/sim/researchEngine';
import { SLOT_ORDER, type ModuleSlot } from '@/lib/types/equipment';
import type { NamingTradition } from '@/lib/types/fleet';
import type { HullClassId, ShipDesign } from '@/lib/types/hull';
import { useFleetStore } from '@/store/useFleetStore';
import { Btn, Chip, fmtM, Meter, Section, Stat } from './kit';

type Sel = Record<ModuleSlot, string[]>;

const emptySel = (hullId: HullClassId): Sel => {
  const h = HULLS[hullId];
  return { POWERPLANT: Array(h.sockets.POWERPLANT).fill(''), CMS: Array(h.sockets.CMS).fill(''), SENSOR: Array(h.sockets.SENSOR).fill(''), ARMAMENT: Array(h.sockets.ARMAMENT).fill('') };
};

function selFromDesign(d: ShipDesign): Sel {
  const sel = emptySel(d.hullId);
  const cursor: Record<ModuleSlot, number> = { POWERPLANT: 0, CMS: 0, SENSOR: 0, ARMAMENT: 0 };
  for (const id of d.moduleIds) {
    const m = MODULE_BY_ID[id];
    if (m && cursor[m.slot] < sel[m.slot].length) sel[m.slot][cursor[m.slot]++] = id;
  }
  return sel;
}

const PROTO = (p: string) => p.replace('_', ' ');

export default function ShipDesignerModal() {
  const designs = useFleetStore((s) => s.designs);
  const research = useFleetStore((s) => s.research);
  const vendors = useFleetStore((s) => s.vendors);
  const fleets = useFleetStore((s) => s.fleets);
  const budget = useFleetStore((s) => s.resources.budget);
  const { setDesignerOpen, saveDesign, deleteDesign, orderShip } = useFleetStore.getState();

  const [hullId, setHullId] = useState<HullClassId>(designs[0]?.hullId ?? 'FRIGATE');
  const [name, setName] = useState(designs[0]?.name ?? 'New design');
  const [sel, setSel] = useState<Sel>(() => (designs[0] ? selFromDesign(designs[0]) : emptySel('FRIGATE')));
  const [tradition, setTradition] = useState<NamingTradition>('VIRTUES');
  const [custom, setCustom] = useState('');
  const squadrons = useMemo(() => fleets.flatMap((f) => f.taskForces.flatMap((t) => t.squadrons.map((s) => ({ id: s.id, label: `${t.name} / ${s.name}` })))), [fleets]);
  const [squadronId, setSquadronId] = useState(squadrons[0]?.id ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const hull = HULLS[hullId];
  const bridges = useMemo(() => bridgeSet(research.completed), [research.completed]);
  const done = useMemo(() => new Set(research.completed), [research.completed]);
  const moduleIds = useMemo(() => SLOT_ORDER.flatMap((s) => sel[s]).filter(Boolean), [sel]);
  const ev = useMemo(() => evaluateLoadout(hullId, moduleIds, bridges), [hullId, moduleIds, bridges]);
  const cms = moduleIds.map((id) => MODULE_BY_ID[id]).find((m) => m.slot === 'CMS');

  const blocked = useMemo(
    () =>
      moduleIds
        .map((id) => MODULE_BY_ID[id])
        .map((m) => ({ m, p: procurability(m, vendors, done) }))
        .filter((x) => !x.p.ok),
    [moduleIds, vendors, done],
  );

  const setSlot = (slot: ModuleSlot, idx: number, id: string) => setSel((s) => ({ ...s, [slot]: s[slot].map((v, i) => (i === idx ? id : v)) }));
  const changeHull = (id: HullClassId) => {
    setHullId(id);
    setSel(emptySel(id));
    setMsg(null);
  };
  const currentDesign = (): ShipDesign => ({ id: `DES_${name.replace(/\W+/g, '_').toUpperCase()}`, name: name.trim() || 'Unnamed', hullId, moduleIds });

  const payloadPct = (ev.payloadUsedT / ev.payloadT) * 100;
  const powerPct = ev.powerGenerationMW > 0 ? (ev.powerDrawMW / ev.powerGenerationMW) * 100 : 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/85 p-2 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Ship designer">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col border border-phosphor/60 bg-panel shadow-glow">
        <header className="flex items-center justify-between border-b border-phosphor/40 px-3 py-1.5">
          <div className="glow-text text-xs uppercase tracking-[0.3em] text-phosphor">Design bureau — naval equipment designer</div>
          <button aria-label="Close designer" onClick={() => setDesignerOpen(false)} className="text-slate-400 hover:text-phosphor">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-2 overflow-y-auto p-2 lg:grid-cols-[1fr_400px]">
          <div className="space-y-2">
            <Section title="Hull base">
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-5">
                {HULL_LIST.map((h) => (
                  <button key={h.id} onClick={() => changeHull(h.id)} className={`border px-1.5 py-1 text-left text-[10px] ${hullId === h.id ? 'border-phosphor bg-phosphor/10 text-phosphor shadow-glow' : 'border-navy text-slate-400 hover:border-phosphor/50'}`}>
                    <div className="uppercase tracking-wider">{h.name}</div>
                    <div className="text-slate-500">{h.displacementT.toLocaleString()} t · {h.draftM} m</div>
                    <div className="text-slate-500">{fmtM(h.cost)} · {h.buildDays}d</div>
                  </button>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-4 sm:grid-cols-4">
                <Stat k="Structure" v={`${hull.structuralHP} HP`} />
                <Stat k="Aux gen" v={`${hull.baseGenerationMW} MW`} />
                <Stat k="Hotel load" v={`${hull.hotelLoadMW} MW`} />
                <Stat k="Payload" v={`${hull.payloadT} t`} />
              </div>
              <input value={name} onChange={(e) => setName(e.target.value)} className="mt-2 w-full px-2 py-1 text-[12px]" aria-label="Design name" placeholder="Design / class name" />
            </Section>

            {SLOT_ORDER.map((slot) => (
              <Section key={slot} title={`${SLOT_LABEL[slot]} · ${hull.sockets[slot]} socket${hull.sockets[slot] > 1 ? 's' : ''}`} tone={slot === 'POWERPLANT' ? 'amber' : slot === 'CMS' ? 'emerald' : 'cyan'}>
                <div className="space-y-1">
                  {sel[slot].map((val, idx) => (
                    <select key={idx} value={val} onChange={(e) => setSlot(slot, idx, e.target.value)} className="w-full px-1.5 py-1 text-[11px]" aria-label={`${SLOT_LABEL[slot]} socket ${idx + 1}`}>
                      <option value="">— empty —</option>
                      {MODULES.filter((m) => m.slot === slot).map((m) => {
                        const p = procurability(m, vendors, done);
                        const stat = slot === 'POWERPLANT' ? `+${m.powerGenerationMW}MW` : `${m.powerDrawMW}MW`;
                        return (
                          <option key={m.id} value={m.id} disabled={!p.ok}>
                            {m.name} · {VENDOR_SHORT[m.vendorId]} · {PROTO(m.protocol)} · {stat} · {m.weightT}t · {m.cost}M{p.ok ? '' : ` — ${p.reason}`}
                          </option>
                        );
                      })}
                    </select>
                  ))}
                </div>
              </Section>
            ))}

            <Section title="Saved designs">
              <ul className="space-y-1">
                {designs.map((d) => (
                  <li key={d.id} className="flex items-center justify-between border border-navy px-2 py-1 text-[11px]">
                    <span className="text-slate-300">{d.name} <span className="text-slate-600">· {HULLS[d.hullId].name}</span></span>
                    <span className="flex gap-1">
                      <Btn tone="cyan" onClick={() => { setHullId(d.hullId); setName(d.name); setSel(selFromDesign(d)); setMsg(null); }}>Load</Btn>
                      <Btn tone="dim" onClick={() => deleteDesign(d.id)}>Delete</Btn>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>

          <div className="space-y-2">
            <Section title="Design readout" tone={ev.valid ? 'emerald' : 'red'} right={<Chip tone={ev.valid ? 'emerald' : 'red'}>{ev.valid ? 'VALID' : 'INVALID'}</Chip>}>
              {ev.errors.map((e) => (
                <div key={e} className="text-[11px] text-warn">✖ {e}</div>
              ))}
              {ev.warnings.map((w) => (
                <div key={w} className="text-[11px] text-amber-radar">▲ {w}</div>
              ))}
              {blocked.map(({ m, p }) => (
                <div key={m.id} className="text-[11px] text-warn">✖ {m.name}: {p.reason}</div>
              ))}
              {ev.valid && ev.warnings.length === 0 && blocked.length === 0 && <div className="text-[11px] text-emerald-accent">✔ All systems nominal</div>}
            </Section>

            <Section title="Power grid & displacement">
              <div className="mb-1 flex justify-between text-[10px] text-slate-500">
                <span>POWER {ev.powerDrawMW.toFixed(1)} / {ev.powerGenerationMW.toFixed(1)} MW</span>
                <span className={ev.powerMarginMW < 0 ? 'text-warn' : ''}>MARGIN {ev.powerMarginMW.toFixed(1)}</span>
              </div>
              <Meter value={Math.min(100, powerPct)} tone={powerPct > 100 ? 'red' : powerPct > 90 ? 'amber' : 'cyan'} label={`${powerPct.toFixed(0)}%`} />
              <div className="mb-1 mt-2 flex justify-between text-[10px] text-slate-500">
                <span>PAYLOAD {ev.payloadUsedT} / {ev.payloadT} t</span>
              </div>
              <Meter value={Math.min(100, payloadPct)} tone={payloadPct > 100 ? 'red' : payloadPct > 90 ? 'amber' : 'cyan'} label={`${payloadPct.toFixed(0)}%`} />
              <div className="mt-2 grid grid-cols-2 gap-x-3">
                <Stat k="Displacement" v={`${ev.displacementT.toLocaleString()} t`} />
                <Stat k="Draft" v={`${ev.draftM.toFixed(1)} m · ${ev.draft}`} tone={ev.draft === 'Deep' ? 'text-amber-radar' : undefined} />
              </div>
            </Section>

            <Section title="Protocol compatibility" tone="amber">
              <div className="mb-1 text-[10px] text-slate-500">CMS bus: <span className="text-emerald-accent">{cms ? PROTO(cms.protocol) : 'NONE'}</span></div>
              {ev.frictions.length === 0 && <div className="text-[11px] text-emerald-accent">No mismatched modules.</div>}
              {ev.frictions.map((f) => (
                <div key={f.moduleId + f.bridgeKey} className="flex items-center justify-between text-[11px]">
                  <span className="truncate text-slate-300">{f.moduleName}</span>
                  {f.bridged ? <Chip tone="cyan">BRIDGED</Chip> : <Chip tone={f.severity >= 0.5 ? 'red' : 'amber'}>{PROTO(f.moduleProtocol)} · FRICTION {f.severity.toFixed(2)}</Chip>}
                </div>
              ))}
              {ev.frictionIndex > 0 && <div className="mt-1 text-[10px] text-amber-radar">Integration Friction Penalty: reaction ×{ev.reactionMultiplier.toFixed(2)}, tracking lag +{ev.trackingLagSec.toFixed(1)}s. Research a protocol bridge to remove it.</div>}
            </Section>

            <Section title="Combat figures">
              <div className="grid grid-cols-2 gap-x-3">
                <Stat k="CMS reaction" v={`${ev.reactionSec >= 99 ? '—' : ev.reactionSec.toFixed(1) + 's'}`} tone={ev.frictionIndex > 0 ? 'text-amber-radar' : undefined} />
                <Stat k="Tracking lag" v={`${ev.trackingLagSec.toFixed(1)}s`} />
                <Stat k="Detection" v={`${ev.detectionKm} km`} />
                <Stat k="Track capacity" v={ev.trackCapacity} />
                <Stat k="Firepower" v={ev.firepower} />
                <Stat k="Interceptors" v={ev.interceptors} />
                <Stat k="Channels" v={ev.channels} />
                <Stat k="Combat rating" v={ev.combatRating} tone="text-phosphor" />
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {ev.vendors.map((v) => (
                  <Chip key={v} tone={vendors[v as keyof typeof vendors].status === 'ACTIVE' ? 'dim' : 'red'}>{VENDOR_SHORT[v as keyof typeof VENDOR_SHORT]}{vendors[v as keyof typeof vendors].status === 'ACTIVE' ? '' : ` ${vendors[v as keyof typeof vendors].status}`}</Chip>
                ))}
              </div>
            </Section>

            <Section title="Commission" tone="emerald">
              <Stat k="Unit cost" v={fmtM(ev.cost)} tone={ev.cost > budget ? 'text-warn' : 'text-phosphor'} />
              <Stat k="Upkeep" v={`${(ev.upkeepPerDay * 2.5).toFixed(2)} M/day`} />
              <Stat k="Build time" v={`${hull.buildDays} days`} />
              <div className="mt-2 grid grid-cols-2 gap-1">
                <select value={tradition} onChange={(e) => setTradition(e.target.value as NamingTradition)} className="px-1 py-1 text-[10px]" aria-label="Naming tradition">
                  {TRADITIONS.map((t) => (
                    <option key={t} value={t}>
                      NAMES: {TRADITION_LABEL[t]}
                    </option>
                  ))}
                </select>
                <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Custom name (optional)" className="px-1 py-1 text-[11px]" aria-label="Custom ship name" />
              </div>
              <select value={squadronId} onChange={(e) => setSquadronId(e.target.value)} className="mt-1 w-full px-1 py-1 text-[10px]" aria-label="Receiving squadron">
                {squadrons.map((s) => (
                  <option key={s.id} value={s.id}>
                    ASSIGN TO {s.label}
                  </option>
                ))}
              </select>
              <div className="mt-2 flex gap-1">
                <Btn tone="cyan" className="flex-1" onClick={() => { saveDesign(currentDesign()); setMsg({ ok: true, text: `Design "${name}" saved` }); }} disabled={moduleIds.length === 0}>Save design</Btn>
                <Btn
                  tone="emerald"
                  className="flex-1"
                  disabled={!ev.valid || blocked.length > 0}
                  onClick={() => {
                    const r = orderShip({ designName: name.trim() || 'Unnamed', hullId, moduleIds, squadronId, tradition, customName: custom });
                    setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Laid down' : r.reason ?? 'Refused' });
                    if (r.ok) setCustom('');
                  }}
                >
                  Lay down hull
                </Btn>
              </div>
              {msg && <div className={`mt-1 text-[11px] ${msg.ok ? 'text-emerald-accent' : 'text-warn'}`}>{msg.ok ? '✔' : '✖'} {msg.text}</div>}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

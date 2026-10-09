'use client';

import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { hullPlatform, HULL_LIST, HULLS, MODULE_BY_ID, MODULES, modulePlatform, SUB_PACKAGES } from '@/lib/data/catalog';
import { orderTerms } from '@/lib/sim/licences';
import { hullOriginView } from '@/lib/sim/supplyChain';
import { TRADITIONS, TRADITION_LABEL } from '@/lib/generator/nameGenerator';
import { evaluateLoadout, hullBlocked, procurability, SLOT_LABEL } from '@/lib/sim/designEngine';
import { bridgeSet } from '@/lib/sim/researchEngine';
import { SLOT_ORDER, type ModuleSlot } from '@/lib/types/equipment';
import type { NamingTradition } from '@/lib/types/fleet';
import type { HullClassId, ShipDesign } from '@/lib/types/hull';
import { useFleetStore } from '@/store/useFleetStore';
import TutorialCard from '@/components/tutorial/TutorialCard';
import ActionPreview from './ActionPreview';
import { Term } from '@/components/tutorial/Term';
import { originView } from '@/lib/sim/supplyChain';
import { useNames } from '@/store/useNames';
import { Btn, Chip, fmtM, Meter, Section, Stat } from './kit';
import { previewOrderShip } from '@/lib/sim/preview';

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


export default function ShipDesignerModal() {
  const n = useNames();
  const designs = useFleetStore((s) => s.designs);
  const research = useFleetStore((s) => s.research);
  const vendors = useFleetStore((s) => s.vendors);
  const fleets = useFleetStore((s) => s.fleets);
  const budget = useFleetStore((s) => s.resources.budget);
  const { setDesignerOpen, saveDesign, deleteDesign, orderShip } = useFleetStore.getState();

  // The briefing can open the designer on a preset (e.g. one that overloads its power grid).
  const start = useFleetStore.getState().designerPreset ?? designs[0];
  const [hullId, setHullId] = useState<HullClassId>(start?.hullId ?? 'FRIGATE');
  const [name, setName] = useState(start?.name ?? 'New design');
  const [sel, setSel] = useState<Sel>(() => (start ? selFromDesign(start) : emptySel('FRIGATE')));
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
  const chain = useMemo(() => {
    const views = moduleIds.map((id) => originView({ vendors }, MODULE_BY_ID[id]));
    return { via: [...new Set(views.flatMap((o) => o.known))], unverified: views.filter((o) => !o.verified).length };
  }, [moduleIds, vendors]);

  const isSub = hullPlatform(hull) === 'SUBSURFACE';
  const stats = useFleetStore((s) => s.stats);
  const terms = useMemo(() => orderTerms({ stats, vendors }, hullId, ev.cost), [stats, vendors, hullId, ev.cost]);
  const hullWhy = useMemo(() => hullBlocked(hullId, vendors, done, terms.licensed), [hullId, vendors, done, terms.licensed]);
  const hullVia = useMemo(() => (hull.vendorId && !terms.licensed ? hullOriginView({ vendors }, hullId) : { verified: true, known: [] as string[] }), [hull.vendorId, terms.licensed, vendors, hullId]);
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
          <div className="lg:col-span-2 empty:hidden">
            <TutorialCard compact />
          </div>
          <div className="space-y-2">
            <Section title="Hull base">
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                {HULL_LIST.map((h) => (
                  <button key={h.id} onClick={() => changeHull(h.id)} className={`border px-1.5 py-1 text-left text-[0.8125rem] ${hullId === h.id ? 'border-phosphor bg-phosphor/10 text-phosphor shadow-glow' : 'border-navy text-slate-400 hover:border-phosphor/50'}`}>
                    <div className="uppercase tracking-wider">{h.name}</div>
                    <div className="text-slate-500">{h.displacementT.toLocaleString()} t · {hullPlatform(h) === 'SUBSURFACE' ? `stealth ${h.stealth}` : `${h.draftM} m`}{h.vendorId ? ` · ${n.vs(h.vendorId)}` : ''}</div>
                    <div className="text-slate-500">{fmtM(h.cost)} · {h.buildDays}d</div>
                  </button>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-4 sm:grid-cols-4">
                <Stat k="Structure" v={`${hull.structuralHP} HP`} />
                <Stat k="Aux gen" v={`${hull.baseGenerationMW} MW`} />
                <Stat k="Hotel load" v={`${hull.hotelLoadMW} MW`} />
                <Stat k="Payload" v={`${hull.payloadT} t`} />
                {hull.vendorId && <Stat k="Builder" v={n.v(hull.vendorId)} tone={hullWhy && !isSub ? 'text-warn' : undefined} />}
                {hull.vendorId && <Stat k="Hull sale" v={hullWhy ? n.t(hullWhy) : 'available'} tone={hullWhy ? 'text-warn' : 'text-emerald-accent'} />}
              </div>
              <input value={name} onChange={(e) => setName(e.target.value)} className="mt-2 w-full px-2 py-1 text-[0.9375rem]" aria-label="Design name" placeholder="Design / class name" />
            </Section>

            {SLOT_ORDER.map((slot) => (
              <Section key={slot} title={`${SLOT_LABEL[slot]} · ${hull.sockets[slot]} socket${hull.sockets[slot] > 1 ? 's' : ''}`} tone={slot === 'POWERPLANT' ? 'amber' : slot === 'CMS' ? 'emerald' : 'cyan'}>
                <div className="space-y-1">
                  {sel[slot].map((val, idx) => (
                    <select key={idx} value={val} onChange={(e) => setSlot(slot, idx, e.target.value)} className="w-full px-1.5 py-1 text-[0.875rem]" aria-label={`${SLOT_LABEL[slot]} socket ${idx + 1}`}>
                      <option value="">— empty —</option>
                      {MODULES.filter((m) => m.slot === slot && vendors[m.vendorId]?.rung !== 'UNKNOWN' && (modulePlatform(m) === 'ANY' || modulePlatform(m) === hullPlatform(hull))).map((m) => {
                        const p = procurability(m, vendors, done);
                        const stat = slot === 'POWERPLANT' ? `+${m.powerGenerationMW}MW` : `${m.powerDrawMW}MW`;
                        const sonarTag = m.stats.kind === 'SENSOR' && m.stats.domain === 'SONAR' ? `SONAR ${m.stats.rangeKm}km · ` : m.stats.kind === 'POWER' && m.platform === 'SUBSURFACE' ? `stealth ${(m.stats.stealth ?? 0) >= 0 ? '+' : ''}${m.stats.stealth ?? 0}${m.stats.enduranceDays ? ` · +${m.stats.enduranceDays}d submerged` : ''} · ` : '';
                        const o = originView({ vendors }, m);
                        const chain = o.known.length ? ` · +${o.known.map((k) => n.vs(k)).join('+')} parts` : o.verified ? '' : ' · unverified';
                        return (
                          <option key={m.id} value={m.id} disabled={!p.ok}>
                            {n.m(m.id)} · {sonarTag}{n.vs(m.vendorId)}{chain} · {n.x(m.protocol)} · {stat} · {m.weightT}t · {m.cost}M{p.ok ? '' : ` — ${n.t(p.reason ?? '')}`}
                          </option>
                        );
                      })}
                    </select>
                  ))}
                </div>
              </Section>
            ))}

            {isSub && (
              <Section title="Vendor packages">
                <ul className="space-y-1">
                  {SUB_PACKAGES.filter((d) => d.hullId === hullId).map((d) => (
                    <li key={d.id} className="flex items-center justify-between text-[0.875rem]">
                      <span className="text-slate-300">{d.name} <span className="text-slate-600">· hull + the builder&apos;s plant, sonar and tubes</span></span>
                      <Btn tone="cyan" onClick={() => { setName(d.name); setSel(selFromDesign(d)); setMsg(null); }}>Load package</Btn>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="Saved designs">
              <ul className="space-y-1">
                {designs.map((d) => (
                  <li key={d.id} className="flex items-center justify-between border border-navy px-2 py-1 text-[0.875rem]">
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
                <div key={e} className="text-[0.875rem] text-warn">✖ {n.t(e)}</div>
              ))}
              {hullWhy && <div className="text-[0.875rem] text-warn">✖ {n.t(hullWhy)}</div>}
              {ev.warnings.map((w) => (
                <div key={w} className="text-[0.875rem] text-amber-radar">▲ {w}</div>
              ))}
              {blocked.map(({ m, p }) => (
                <div key={m.id} className="text-[0.875rem] text-warn">✖ {n.m(m.id)}: {n.t(p.reason ?? "")}</div>
              ))}
              {ev.valid && ev.warnings.length === 0 && blocked.length === 0 && !hullWhy && <div className="text-[0.875rem] text-emerald-accent">✔ All systems nominal</div>}
            </Section>

            <Section title="Power grid & displacement">
              <div className="mb-1 flex justify-between text-[0.8125rem] text-slate-500">
                <span>POWER {ev.powerDrawMW.toFixed(1)} / {ev.powerGenerationMW.toFixed(1)} MW</span>
                <span className={ev.powerMarginMW < 0 ? 'text-warn' : ''}>MARGIN {ev.powerMarginMW.toFixed(1)}</span>
              </div>
              <Meter value={Math.min(100, powerPct)} tone={powerPct > 100 ? 'red' : powerPct > 90 ? 'amber' : 'cyan'} label={`${powerPct.toFixed(0)}%`} />
              <div className="mb-1 mt-2 flex justify-between text-[0.8125rem] text-slate-500">
                <span>PAYLOAD {ev.payloadUsedT} / {ev.payloadT} t</span>
              </div>
              <Meter value={Math.min(100, payloadPct)} tone={payloadPct > 100 ? 'red' : payloadPct > 90 ? 'amber' : 'cyan'} label={`${payloadPct.toFixed(0)}%`} />
              <div className="mt-2 grid grid-cols-2 gap-x-3">
                <Stat k="Displacement" v={`${ev.displacementT.toLocaleString()} t`} />
                {isSub ? (
                  <Stat k="Stealth" v={`${ev.stealth.toFixed(0)} / 100`} tone={ev.stealth >= 65 ? 'text-emerald-accent' : ev.stealth < 40 ? 'text-amber-radar' : undefined} />
                ) : (
                  <Stat k="Draft" v={`${ev.draftM.toFixed(1)} m · ${ev.draft}`} tone={ev.draft === 'Deep' ? 'text-amber-radar' : undefined} />
                )}
                {isSub && <Stat k="Submerged" v={`${ev.submergedDays} days before snorkelling`} />}
              </div>
            </Section>

            <Section title={<Term k="FRICTION">Protocol compatibility</Term>} tone="amber">
              <div className="mb-1 text-[0.8125rem] text-slate-500">CMS bus: <span className="text-emerald-accent">{cms ? n.x(cms.protocol) : 'NONE'}</span></div>
              {ev.frictions.length === 0 && <div className="text-[0.875rem] text-emerald-accent">No mismatched modules.</div>}
              {ev.frictions.map((f) => (
                <div key={f.moduleId + f.bridgeKey} className="flex items-center justify-between text-[0.875rem]">
                  <span className="truncate text-slate-300">{n.m(f.moduleId)}</span>
                  {f.bridged ? <Chip tone="cyan">BRIDGED</Chip> : <Chip tone={f.severity >= 0.5 ? 'red' : 'amber'}>{n.x(f.moduleProtocol)} · FRICTION {f.severity.toFixed(2)}</Chip>}
                </div>
              ))}
              {ev.frictionIndex > 0 && <div className="mt-1 text-[0.8125rem] text-amber-radar">Integration Friction Penalty: reaction ×{ev.reactionMultiplier.toFixed(2)}, tracking lag +{ev.trackingLagSec.toFixed(1)}s. Research a protocol bridge to remove it.</div>}
            </Section>

            <Section title="Combat figures">
              <div className="grid grid-cols-2 gap-x-3">
                <Stat k="CMS reaction" v={`${ev.reactionSec >= 99 ? '—' : ev.reactionSec.toFixed(1) + 's'}`} tone={ev.frictionIndex > 0 ? 'text-amber-radar' : undefined} />
                <Stat k="Tracking lag" v={`${ev.trackingLagSec.toFixed(1)}s`} />
                <Stat k="Detection (radar)" v={ev.detectionKm > 0 ? `${ev.detectionKm} km` : '—'} />
                <Stat k="Sonar" v={ev.sonarKm > 0 ? `${ev.sonarKm} km` : '—'} />
                <Stat k="Track capacity" v={ev.trackCapacity} />
                <Stat k="Firepower" v={ev.firepower} />
                <Stat k="Interceptors" v={ev.interceptors} />
                <Stat k="Channels" v={ev.channels} />
                <Stat k="Combat rating" v={ev.combatRating} tone="text-phosphor" />
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {ev.vendors.map((v) => (
                  <Chip key={v} tone={vendors[v as keyof typeof vendors].status === 'ACTIVE' ? 'dim' : 'red'}>{n.vs(v)}{vendors[v as keyof typeof vendors].status === 'ACTIVE' ? '' : ` ${vendors[v as keyof typeof vendors].status}`}</Chip>
                ))}
                {hullVia.known.filter((v) => !ev.vendors.includes(v)).map((v) => (
                  <Chip key={`hull-via-${v}`} tone={vendors[v as keyof typeof vendors].status === 'ACTIVE' ? 'amber' : 'red'}>+{n.vs(v)} hull parts</Chip>
                ))}
                {chain.via.filter((v) => !ev.vendors.includes(v)).map((v) => (
                  <Chip key={`via-${v}`} tone={vendors[v].status === 'ACTIVE' ? 'amber' : 'red'}>+{n.vs(v)} parts{vendors[v].status === 'ACTIVE' ? '' : ` ${vendors[v].status}`}</Chip>
                ))}
                {chain.unverified > 0 && (
                  <Chip tone="dim">
                    <Term k="DILIGENCE">{chain.unverified} UNVERIFIED</Term>
                  </Chip>
                )}
              </div>
            </Section>

            <Section title="Commission" tone="emerald">
              <Stat k="Unit cost" v={fmtM(terms.price)} tone={terms.price > budget ? 'text-warn' : 'text-phosphor'} />
              {terms.trainingDays > 0 && <Stat k={<Term k="TRAINING">First of class</Term>} v={`crew training +${fmtM(terms.trainingCost)}, +${terms.trainingDays} days`} tone="text-amber-radar" />}
              {terms.licensed && <Stat k="Licensed build" v={`domestic yards: hull −${fmtM(terms.hullSaving)}, slower; immune to the builder's freeze`} tone="text-emerald-accent" />}
              <Stat k="Upkeep" v={`${(ev.upkeepPerDay * 2.5).toFixed(2)} M/day`} />
              <Stat k="Build time" v={`${terms.days} days`} />
              <div className="mt-2 grid grid-cols-2 gap-1">
                <select value={tradition} onChange={(e) => setTradition(e.target.value as NamingTradition)} className="px-1 py-1 text-[0.8125rem]" aria-label="Naming tradition">
                  {TRADITIONS.map((t) => (
                    <option key={t} value={t}>
                      NAMES: {TRADITION_LABEL[t]}
                    </option>
                  ))}
                </select>
                <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Custom name (optional)" className="px-1 py-1 text-[0.875rem]" aria-label="Custom ship name" />
              </div>
              <select value={squadronId} onChange={(e) => setSquadronId(e.target.value)} className="mt-1 w-full px-1 py-1 text-[0.8125rem]" aria-label="Receiving squadron">
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
                  disabled={!ev.valid || blocked.length > 0 || !!hullWhy}
                  preview={(w) => `Lay down: ${previewOrderShip(w, { hullId, moduleIds, squadronId })}`}
                  onClick={() => {
                    const r = orderShip({ designName: name.trim() || 'Unnamed', hullId, moduleIds, squadronId, tradition, customName: custom });
                    setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Laid down' : r.reason ?? 'Refused' });
                    if (r.ok) setCustom('');
                  }}
                >
                  Lay down hull
                </Btn>
              </div>
              {msg && <div className={`mt-1 text-[0.875rem] ${msg.ok ? 'text-emerald-accent' : 'text-warn'}`}>{msg.ok ? '✔' : '✖'} {n.t(msg.text)}</div>}
            </Section>
          </div>
        </div>
        <ActionPreview inModal />
      </div>
    </div>
  );
}

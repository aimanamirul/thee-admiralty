'use client';

import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MINISTRIES, MODULES } from '@/lib/data/catalog';
import { procurability } from '@/lib/sim/designEngine';
import { lobbyCost, ministriesRefuse } from '@/lib/sim/politicsEngine';
import { previewAdvance, previewDiligence, previewLicence, previewLobby, previewScout } from '@/lib/sim/preview';
import { licensableHulls } from '@/lib/sim/licences';
import { HULLS } from '@/lib/data/catalog';
import { DILIGENCE_DAYS, diligenceBlocked, fleetExposure, originView } from '@/lib/sim/supplyChain';
import { advanceBlocked, BLOC_LABEL, nextStep, REGIMES, RUNG_LABEL, rungAccess, sanctionRiskPerDay, scoutable, scoutBlocked, sellableTier } from '@/lib/sim/relationsEngine';
import { marketWatch } from '@/lib/sim/coldVendors';
import { rungIndex, type Rung, type Vendor } from '@/lib/types/diplomacy';
import { useFleetStore } from '@/store/useFleetStore';
import { Term } from '@/components/tutorial/Term';
import { useNames } from '@/store/useNames';
import { Btn, Chip, Meter, Section } from './kit';
import HomeFront from './HomeFront';

function statusChip(v: Vendor, tick: number) {
  switch (v.status) {
    case 'ACTIVE': return rungIndex(v.rung) >= rungIndex('FRAMEWORK') ? <Chip tone="emerald">LICENCE ACTIVE</Chip> : <Chip tone="dim">NO CONTRACT</Chip>;
    case 'WARNING': return <Chip tone="amber">WARNING · {v.pendingSanction?.replace('_', ' ')} IN {Math.max(0, (v.statusUntilTick ?? tick) - tick)}D</Chip>;
    case 'FROZEN': return <Chip tone="red">FROZEN · {Math.max(0, (v.statusUntilTick ?? tick) - tick)}D LEFT</Chip>;
    case 'REVOKED': return <Chip tone="red">REVOKED</Chip>;
  }
}

const GROUPS: { title: string; rungs: Rung[] }[] = [
  { title: 'Contracted suppliers', rungs: ['STRATEGIC', 'SIGNED', 'FRAMEWORK'] },
  { title: 'Prospective suppliers', rungs: ['TRADE_MISSION', 'CONTACT'] },
];

/** Sub-supplier knowledge for one catalogue line: never hints at hidden origins when unverified. */
function OriginNote({ m }: { m: (typeof MODULES)[number] }) {
  const n = useNames();
  const vendors = useFleetStore((s) => s.vendors);
  if (m.vendorId === 'DOMESTIC_YARDS') return null;
  const o = originView({ vendors }, m);
  if (o.known.length) return <span className="text-amber-radar">contains {o.known.map((k) => n.vs(k)).join(', ')}</span>;
  return o.verified ? <span className="text-slate-500">no sub-suppliers</span> : <span className="text-slate-600">unverified</span>;
}

function Catalogue({ v }: { v: Vendor }) {
  const n = useNames();
  const vendors = useFleetStore((s) => s.vendors);
  const completed = useFleetStore((s) => s.research.completed);
  const done = useMemo(() => new Set(completed), [completed]);
  const lines = MODULES.filter((m) => m.vendorId === v.id);
  return (
    <ul className="mt-1 space-y-0.5 border-l border-navy pl-2">
      {lines.map((m) => {
        const p = procurability(m, vendors, done);
        return (
          <li key={m.id} className="flex justify-between gap-2 text-[0.75rem]">
            <span className={p.ok ? 'text-slate-300' : 'text-slate-500'}>
              {n.m(m.id)} <span className="text-slate-600">· T{m.requiredTier} · {n.xs(m.protocol)}</span>
            </span>
            <span className="flex shrink-0 gap-2">
              <OriginNote m={m} />
              <span className={p.ok ? 'text-emerald-accent' : 'text-slate-600'}>{p.ok ? 'AVAILABLE' : n.t(p.reason ?? '')}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function VendorCard({ v }: { v: Vendor }) {
  const n = useNames();
  const politics = useFleetStore((s) => s.politics);
  const tension = useFleetStore((s) => s.tension);
  const pc = useFleetStore((s) => s.resources.politicalCapital);
  const tick = useFleetStore((s) => s.tick);
  const { lobby, advanceRelationship, dueDiligence, negotiateLicence } = useFleetStore.getState();
  const [open, setOpen] = useState(false);
  const view = { politics };
  const refuse = ministriesRefuse(view);
  const regime = REGIMES[v.regime];
  const risk = rungIndex(v.rung) >= rungIndex('FRAMEWORK') ? (1 - (1 - sanctionRiskPerDay({ tension }, v)) ** 30) * 100 : 0;
  const tier = sellableTier(v);
  const step = nextStep(v.rung);
  const blocked = advanceBlocked(useFleetStore.getState().snapshotWorld(), v.id);
  const lines = MODULES.filter((m) => m.vendorId === v.id).length;
  const domestic = v.id === 'DOMESTIC_YARDS';

  return (
    <Section
      anchor={`vendor-${v.id}`}
      title={`${n.v(v.id)} · ${n.c(v.id)}`}
      tone={v.status === 'FROZEN' || v.status === 'REVOKED' ? 'red' : v.status === 'WARNING' ? 'amber' : 'cyan'}
      right={statusChip(v, tick)}
    >
      <div className="mb-1 flex flex-wrap gap-1">
        <Chip tone={rungIndex(v.rung) >= rungIndex('SIGNED') ? 'emerald' : rungIndex(v.rung) >= rungIndex('FRAMEWORK') ? 'cyan' : 'dim'}>{RUNG_LABEL[v.rung]}</Chip>
        {!domestic && <Chip tone="dim">{regime.label}</Chip>}
        {!domestic && <Chip tone={v.bloc === 'EAST' ? 'amber' : 'dim'}>{BLOC_LABEL[v.bloc]}</Chip>}
      </div>
      {!domestic && <p className="mb-1 text-[0.75rem] text-slate-500">{regime.blurb}</p>}
      <div className="flex items-center gap-2 text-[0.8125rem] text-slate-500">
        <span><Term k="STANDING">STANDING</Term></span>
        <div className="relative flex-1">
          <Meter value={v.standing} tone="cyan" label={v.standing.toFixed(0)} />
          {[25, 50, 75].map((t) => (
            <span key={t} className="absolute top-0 h-1.5 w-px bg-slate-500/70" style={{ left: `calc((100% - 2.25rem - 0.375rem) * ${t / 100})` }} />
          ))}
        </div>
        <span className="text-phosphor">{tier < 0 ? '—' : `T${tier}`}</span>
      </div>
      <div className="mt-1 flex justify-between text-[0.8125rem] text-slate-500">
        <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 hover:text-phosphor" aria-expanded={open}>
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {n.vs(v.id)} · {lines} catalogue lines · {rungAccess(v.rung)}
        </button>
        {!domestic && rungIndex(v.rung) >= rungIndex('FRAMEWORK') && (
          <span className={risk > 8 ? 'text-warn' : risk > 3 ? 'text-amber-radar' : ''}>30-DAY SANCTION RISK ≈ {risk.toFixed(1)}%</span>
        )}
      </div>
      {open && <Catalogue v={v} />}
      {!domestic && licensableHulls(v.id).length > 0 && (
        <div className="mt-1.5 space-y-1">
          <div className="text-[0.75rem] uppercase tracking-widest text-slate-500">Licensed production</div>
          {licensableHulls(v.id).map((h) => (
            <div key={h} className="flex items-center justify-between gap-2 text-[0.8125rem]">
              <span className="text-slate-300">{HULLS[h].name}{v.licences?.includes(h) ? <Chip tone="emerald">LICENSED</Chip> : null}</span>
              {!v.licences?.includes(h) && (
                <Btn tone="amber" preview={(w) => `Licence: ${previewLicence(w, v.id, h)}`} onClick={() => negotiateLicence(v.id, h)}>
                  Negotiate licence
                </Btn>
              )}
            </div>
          ))}
        </div>
      )}

      {v.rungProgress && (
        <div className="mt-1.5">
          <div className="flex justify-between text-[0.75rem] uppercase tracking-widest text-slate-500">
            <span>{RUNG_LABEL[v.rungProgress.target]} in progress</span>
            <span>day {v.rungProgress.readyTick}</span>
          </div>
          <Meter
            value={tick - v.rungProgress.startTick}
            max={Math.max(1, v.rungProgress.readyTick - v.rungProgress.startTick)}
            tone="emerald"
            label={`${Math.max(0, v.rungProgress.readyTick - tick)}d`}
          />
        </div>
      )}
      {!domestic && step && !v.rungProgress && (
        <Btn
          className="mt-1.5 w-full"
          tone="emerald"
          disabled={!!blocked}
          preview={(w) => `Advance to ${RUNG_LABEL[step.target]}: ${previewAdvance(w, v.id)}`}
          onClick={() => advanceRelationship(v.id)}
        >
          Advance: {RUNG_LABEL[step.target]}
        </Btn>
      )}
      {!domestic && v.diligence && !v.diligence.done && (
        <div className="mt-1.5">
          <div className="flex justify-between text-[0.75rem] uppercase tracking-widest text-slate-500">
            <span>Due diligence in progress</span>
            <span>day {v.diligence.readyTick}</span>
          </div>
          <Meter value={tick - v.diligence.startTick} max={DILIGENCE_DAYS} tone="cyan" label={`${Math.max(0, v.diligence.readyTick - tick)}d`} />
        </div>
      )}
      {!domestic && v.diligence?.done && (
        <p className="mt-1 text-[0.75rem] uppercase tracking-widest text-emerald-accent">
          <Term k="DILIGENCE">Supply chain verified</Term>
        </p>
      )}
      {!domestic && !v.diligence && (
        <Btn
          data-tutorial={`diligence-${v.id}`}
          className="mt-1.5 w-full"
          tone="cyan"
          disabled={!!diligenceBlocked(useFleetStore.getState().snapshotWorld(), v.id)}
          preview={(w) => `Due diligence: ${previewDiligence(w, v.id)}`}
          onClick={() => dueDiligence(v.id)}
        >
          Due diligence
        </Btn>
      )}
      {!domestic && (
        <div className="mt-1.5 grid grid-cols-3 gap-1">
          {MINISTRIES.map((m) => (
            <Btn
              key={m.id}
              tone="amber"
              disabled={pc < lobbyCost(view, m.cost) || !!refuse}
              title={`${m.name} — ${m.description}`}
              preview={(w) => `${m.name.split(' — ')[0]}: ${previewLobby(w, v.id, m.id)}`}
              onClick={() => lobby(v.id, m.id)}
            >
              {m.name.split(' — ')[0].replace('Ministry of ', '')} · {lobbyCost(view, m.cost)}PC
            </Btn>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Which vendors the fleet depends on, directly or through components, as far as the navy knows. */
function SupplyChain() {
  const n = useNames();
  const ships = useFleetStore((s) => s.ships);
  const vendors = useFleetStore((s) => s.vendors);
  const exp = useMemo(() => fleetExposure({ ships, vendors }), [ships, vendors]);
  const rows = (Object.entries(exp.byVendor) as [Vendor['id'], { direct: number; via: number }][]).sort((a, b) => b[1].direct + b[1].via - (a[1].direct + a[1].via));
  return (
    <Section anchor="supply-chain" title={<Term k="DILIGENCE">Supply-chain exposure</Term>} tone="cyan">
      {rows.length === 0 && <p className="text-[0.8125rem] text-slate-500">The fleet carries domestic hardware only.</p>}
      <ul className="space-y-0.5 text-[0.8125rem]">
        {rows.map(([id, c]) => (
          <li key={id} className="flex justify-between gap-2">
            <span className={vendors[id].status === 'ACTIVE' ? 'text-slate-300' : 'text-warn'}>
              {n.v(id)} {vendors[id].status !== 'ACTIVE' && `· ${vendors[id].status}`}
            </span>
            <span className="text-slate-500">
              {c.direct} hull{c.direct === 1 ? '' : 's'} direct{c.via ? <span className="text-amber-radar"> · {c.via} via components</span> : ''}
            </span>
          </li>
        ))}
      </ul>
      {exp.unverifiedShips > 0 && (
        <p className="mt-1 text-[0.75rem] text-slate-500">
          {exp.unverifiedShips} hull{exp.unverifiedShips > 1 ? 's carry' : ' carries'} unverified foreign kit ({exp.unverifiedModules.length} product
          {exp.unverifiedModules.length > 1 ? 's' : ''}): run due diligence on the vendor to see what is inside.
        </p>
      )}
    </Section>
  );
}

export default function DiplomacyLedger() {
  const n = useNames();
  const vendors = useFleetStore((s) => s.vendors);
  const tension = useFleetStore((s) => s.tension);
  const pc = useFleetStore((s) => s.resources.politicalCapital);
  const tick = useFleetStore((s) => s.tick);
  const sanctions = useFleetStore((s) => s.sanctions);
  const { scoutSuppliers } = useFleetStore.getState();
  const list = Object.values(vendors);
  const unknown = list.filter(scoutable).length;
  const watch = marketWatch(useFleetStore.getState().snapshotWorld());
  const scoutBlock = scoutBlocked(useFleetStore.getState().snapshotWorld());

  return (
    <div className="space-y-2">
      <HomeFront />
      <Section title={<Term k="TENSION">Geopolitical climate</Term>} tone="amber" right={<span className="text-amber-radar">PC {pc.toFixed(1)}</span>}>
        <Meter value={tension} tone={tension > 66 ? 'red' : tension > 40 ? 'amber' : 'emerald'} label={tension.toFixed(0)} />
        <p className="mt-1 text-[0.8125rem] text-slate-500">
          Tension raises the chance a vendor state revokes licences, freezes exports or embargoes spares; each regime reacts differently. Lobbying builds
          standing; at 65+ a pending sanction is averted outright.
        </p>
      </Section>

      <SupplyChain />

      {GROUPS.map((g) => {
        const group = list.filter((v) => g.rungs.includes(v.rung)).sort((a, b) => rungIndex(b.rung) - rungIndex(a.rung));
        if (!group.length) return null;
        return (
          <div key={g.title} className="space-y-2">
            <div className="px-1 text-[0.75rem] uppercase tracking-[0.25em] text-slate-500">
              <Term k="RELATIONS">{g.title}</Term>
            </div>
            {group.map((v) => (
              <VendorCard key={v.id} v={v} />
            ))}
          </div>
        );
      })}

      <Section anchor="scout" title="Unknown suppliers" tone="cyan" right={<Search className="h-3.5 w-3.5 text-phosphor" />}>
        <p className="text-[0.8125rem] text-slate-500">
          {unknown ? `${unknown} supplier${unknown > 1 ? 's' : ''} not yet identified.` : 'Every supplier on the market is known.'} Trade attachés can survey the
          market; a new supplier starts as a contact with its catalogue visible.
        </p>
        <Btn className="mt-1.5 w-full" tone="cyan" disabled={!!scoutBlock} preview={previewScout} onClick={() => scoutSuppliers()}>
          Scout for suppliers
        </Btn>
        {watch.length > 0 && (
          <div className="mt-1.5 border-t border-navy pt-1">
            <div className="text-[0.75rem] uppercase tracking-widest text-slate-500">Market watch</div>
            <ul className="text-[0.8125rem] text-amber-radar">
              {watch.map((l) => (
                <li key={l}>› {n.t(l)}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>

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

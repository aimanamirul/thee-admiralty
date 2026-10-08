'use client';

import { Check, ChevronDown, ChevronRight, Pencil, Skull } from 'lucide-react';
import { useMemo, useState } from 'react';
import { HULLS, MODULE_BY_ID, MODULES } from '@/lib/data/catalog';
import { evaluateLoadout, procurability } from '@/lib/sim/designEngine';
import { OP_STATE_LABEL, stateCounts, taskForceShipIds } from '@/lib/sim/fleetEngine';
import { boatFigures, isBoat, isExposed, isRecharging, patrolLimit, stanceOf } from '@/lib/sim/submarines';
import { bridgeSet } from '@/lib/sim/researchEngine';
import { exposure, originView } from '@/lib/sim/supplyChain';
import type { HierarchyKind, OpState, Ship, TaskForce } from '@/lib/types/fleet';
import { useFleetStore } from '@/store/useFleetStore';
import { Term } from '@/components/tutorial/Term';
import { useNames } from '@/store/useNames';
import { usePreviewStore } from '@/store/usePreviewStore';
import { useSelectionStore } from '@/store/useSelectionStore';
import { refitCost, REFIT_DAYS } from '@/lib/sim/fleetOps';
import type { ModuleSlot } from '@/lib/types/equipment';
import { useUiFlag } from '@/store/useTutorialStore';
import { Btn, Chip, fmtM, Meter, Section, Stat } from './kit';
import { previewBuySpare, previewCancel, previewMerge, previewRefit, previewRefitMany, previewSplit, previewStance, previewStanceMany, previewHold, previewHulk, previewResell, previewRestore, previewStrip, previewTempo } from '@/lib/sim/preview';
import { cancelBlocked, instalment, resaleBlocked } from '@/lib/sim/contracts';

const STATE_TONE: Record<OpState, 'emerald' | 'cyan' | 'amber'> = { ACTIVE_PATROL: 'emerald', TRANSIT_WORKUP: 'cyan', MAINTENANCE_DOCK: 'amber' };

function EditableName({ kind, id, value, className = '' }: { kind: HierarchyKind; id: string; value: string; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const rename = useFleetStore((s) => s.renameNode);
  if (!editing) {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        {value}
        <button
          aria-label={`Rename ${value}`}
          className="text-slate-600 hover:text-phosphor"
          onClick={(e) => {
            e.stopPropagation();
            setDraft(value);
            setEditing(true);
          }}
        >
          <Pencil className="h-3 w-3" />
        </button>
      </span>
    );
  }
  const commit = () => {
    const r = rename(kind, id, draft);
    if (r.ok) setEditing(false);
  };
  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="w-36 px-1 py-0 text-[0.875rem]"
        aria-label="New name"
      />
      <button aria-label="Confirm rename" onClick={commit} className="text-emerald-accent">
        <Check className="h-3 w-3" />
      </button>
    </span>
  );
}

function ThirdsGauge({ ships }: { ships: Ship[] }) {
  const c = stateCounts(ships);
  const total = Math.max(1, c.ACTIVE_PATROL + c.TRANSIT_WORKUP + c.MAINTENANCE_DOCK);
  const seg: { k: OpState; label: string; bg: string }[] = [
    { k: 'ACTIVE_PATROL', label: 'PATROL', bg: 'bg-emerald-accent' },
    { k: 'TRANSIT_WORKUP', label: 'TRANSIT', bg: 'bg-phosphor' },
    { k: 'MAINTENANCE_DOCK', label: 'OVERHAUL', bg: 'bg-amber-radar' },
  ];
  const patrolShare = c.ACTIVE_PATROL / total;
  return (
    <Section anchor="thirds" title={<Term k="THIRDS">Rule of thirds</Term>} right={<span className={patrolShare > 0.5 ? 'text-warn' : 'text-slate-500'}>{patrolShare > 0.5 ? 'OVER-DEPLOYED' : 'TARGET ⅓ · ⅓ · ⅓'}</span>}>
      <div className="relative flex h-4 w-full overflow-hidden border border-navy">
        {seg.map((s) => (
          <div key={s.k} className={`${s.bg} flex items-center justify-center text-[0.75rem] text-void`} style={{ width: `${(c[s.k] / total) * 100}%` }}>
            {c[s.k] > 0 ? c[s.k] : ''}
          </div>
        ))}
        <span className="absolute inset-y-0 left-1/3 w-px bg-white/60" />
        <span className="absolute inset-y-0 left-2/3 w-px bg-white/60" />
      </div>
      <div className="mt-1 flex justify-between text-[0.75rem] text-slate-500">
        {seg.map((s) => (
          <span key={s.k}>
            {s.label} {c[s.k]}
          </span>
        ))}
      </div>
    </Section>
  );
}

function BoatPanel({ ship }: { ship: Ship }) {
  const st = useFleetStore.getState();
  const stance = stanceOf(ship);
  const fig = boatFigures(ship);
  const left = ship.submergedLeft ?? fig.submergedDays;
  return (
    <div className="space-y-1 border border-navy p-1.5" data-tutorial={`boat-${ship.id}`}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[0.8125rem] uppercase tracking-widest text-slate-500">Stance</span>
        <Btn tone={stance === 'PATROL' ? 'cyan' : 'dim'} preview={(w) => previewStance(w, ship.id, 'PATROL')} onClick={() => st.setStance(ship.id, 'PATROL')}>Patrol</Btn>
        <Btn tone={stance === 'STEALTH' ? 'emerald' : 'dim'} preview={(w) => previewStance(w, ship.id, 'STEALTH')} onClick={() => st.setStance(ship.id, 'STEALTH')}>Stealth</Btn>
        {isExposed(ship) && <Chip tone="red">COUNTER-DETECTED {ship.exposedDays}d</Chip>}
        {isRecharging(ship) && <Chip tone="amber">RECHARGING {ship.rechargeDays}d</Chip>}
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        <Stat k="Stealth" v={`${fig.stealth.toFixed(0)} / 100`} />
        <Stat k="Sonar" v={fig.sonarKm > 0 ? `${fig.sonarKm} km` : '—'} tone={fig.sonarKm > 0 ? undefined : 'text-warn'} />
      </div>
      <div className="text-[0.8125rem] text-slate-500">SUBMERGED {Math.round(left)} / {fig.submergedDays} days</div>
      <Meter value={left} max={Math.max(1, fig.submergedDays)} tone={left / Math.max(1, fig.submergedDays) < 0.3 ? 'amber' : 'emerald'} label={`${Math.round(left)}d`} />
    </div>
  );
}

function ShipDetail({ ship }: { ship: Ship }) {
  const showHulk = useUiFlag('HULK');
  const n = useNames();
  const research = useFleetStore((s) => s.research);
  const vendors = useFleetStore((s) => s.vendors);
  const fleets = useFleetStore((s) => s.fleets);
  const st = useFleetStore.getState();
  const bridges = useMemo(() => bridgeSet(research.completed), [research.completed]);
  const working = ship.modules.filter((m) => !m.failed).map((m) => m.moduleId);
  const ev = useMemo(() => evaluateLoadout(ship.hullId, working, bridges), [ship.hullId, working.join(','), bridges]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = useMemo(() => new Set(research.completed), [research.completed]);
  const squadrons = fleets.flatMap((f) => f.taskForces.flatMap((t) => t.squadrons.map((s) => ({ id: s.id, label: `${t.name} / ${s.name}`, has: s.shipIds.includes(ship.id) }))));

  return (
    <div className="space-y-1.5 border-t border-navy bg-void/60 p-2 text-[0.875rem]">
      {ship.buildStatus === 'COMMISSIONED' ? (
        <>
          <div className="grid grid-cols-3 gap-2 text-[0.8125rem] text-slate-500">
            <div>READINESS<Meter value={ship.readiness} label={ship.readiness.toFixed(0)} /></div>
            <div>INTEGRITY<Meter value={ship.integrity} label={ship.integrity.toFixed(0)} /></div>
            <div>VETERANCY<Meter value={ship.veterancy} tone="emerald" label={ship.veterancy.toFixed(0)} /></div>
          </div>
        {(ship.refitDaysLeft ?? 0) > 0 && <Stat k="Refit" v={`${ship.refitDaysLeft} days left in the yard`} tone="text-cyan-radar" />}
          <Stat k="Days in state" v={`${ship.stateDays}${ship.state === 'ACTIVE_PATROL' ? ` / ${patrolLimit(ship)}` : ''}`} />
          {isBoat(ship) && <BoatPanel ship={ship} />}
          {ship.overdeployDays > 0 && <Stat k="Over-deployed" v={`${ship.overdeployDays} days — breakdown risk ×${(1 + (ship.overdeployDays / 10) ** 1.5).toFixed(1)}`} tone="text-warn" />}
        </>
      ) : (
        <div>
          <div className="text-[0.8125rem] text-slate-500">CONSTRUCTION · {ship.buildProgressDays}/{ship.buildTotalDays} days</div>
          <Meter value={ship.buildProgressDays} max={ship.buildTotalDays} tone={ship.frozenBy ? 'red' : 'cyan'} label={`${Math.round((ship.buildProgressDays / ship.buildTotalDays) * 100)}%`} />
          {ship.frozenBy && (
            <div className="mt-1 text-warn">⚠ STALLED — {n.v(ship.frozenBy)} sanction. Substitute their hardware below, or cancel / sell the hull.</div>
          )}
          {ship.contract && (
            <div className="mt-1" data-tutorial={`contract-${ship.id}`}>
              <Stat k={<Term k="CONTRACT">Contract</Term>} v={`${fmtM(ship.contract.paid)} of ${fmtM(ship.contract.price)} paid`} />
              {!ship.frozenBy && instalment(ship) > 0 && (
                <Stat k="Instalment" v={`${instalment(ship).toFixed(1)} M/day`} tone={ship.contract.awaitingFunds ? 'text-warn' : undefined} />
              )}
              {ship.contract.awaitingFunds && <div className="text-warn">⚠ AWAITING FUNDS — the slipway waits until the budget covers the instalment.</div>}
              <div className="mt-1 grid grid-cols-2 gap-1">
                <Btn tone="red" disabled={!!cancelBlocked(st.snapshotWorld(), ship.id)} preview={(w) => `Cancel contract: ${previewCancel(w, ship.id)}`} onClick={() => st.cancelContract(ship.id)}>
                  Cancel contract
                </Btn>
                <Btn tone="amber" disabled={!!resaleBlocked(st.snapshotWorld(), ship.id)} preview={(w) => `Sell hull: ${previewResell(w, ship.id)}`} onClick={() => st.resellHull(ship.id)}>
                  Sell hull
                </Btn>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="text-[0.8125rem] uppercase tracking-widest text-slate-500">Installed modules</div>
      <ul className="space-y-1">
        {ship.modules.map((m, i) => {
          const def = MODULE_BY_ID[m.moduleId];
          const frozen = ship.buildStatus === 'CONSTRUCTING' && !!ship.frozenBy && exposure(def).includes(ship.frozenBy);
          const known = originView({ vendors }, def).known;
          const refits = ship.buildStatus === 'COMMISSIONED' && !ship.isPartsHulk && ship.state === 'MAINTENANCE_DOCK' && (ship.refitDaysLeft ?? 0) === 0 ? [m] : [];
          const alternatives = frozen
            ? MODULES.filter((x) => x.slot === m.slot && x.id !== m.moduleId && procurability(x, vendors, done).ok)
            : [];
          return (
            <li key={i} className="border border-navy px-1.5 py-1">
              <div className="flex items-center justify-between gap-1">
                <span className={m.failed ? 'text-warn line-through' : 'text-slate-200'}>{n.m(def.id)}</span>
                <span className="flex items-center gap-1">
                  {m.failed && <Chip tone="red">FAILED</Chip>}
                  <Chip tone="dim">{n.vs(def.vendorId)}</Chip>
                  {known.map((o) => (
                    <Chip key={o} tone={vendors[o].status === 'ACTIVE' ? 'amber' : 'red'}>
                      <span title={`Contains ${n.v(o)} components`}>+{n.vs(o)}</span>
                    </Chip>
                  ))}
                  <Chip tone="dim">{n.x(def.protocol)}</Chip>
                </span>
              </div>
              {ship.buildStatus === 'COMMISSIONED' && <Meter value={m.condition * 100} label={`${Math.round(m.condition * 100)}`} />}
              {refits.length > 0 && !m.failed && (
                <select
                  className="mt-1 w-full px-1 py-0.5 text-[0.8125rem]"
                  defaultValue=""
                  data-testid={`refit-${i}`}
                  onChange={(e) => e.target.value && st.refitShip(ship.id, i, e.target.value)}
                  onPointerEnter={() => usePreviewStore.getState().show((w) => `Refit: pick a replacement — ${REFIT_DAYS} days in the yard, ship cannot sail; cost shown per option`, `refit-${ship.id}-${i}`)}
                  onPointerLeave={() => usePreviewStore.getState().clear(`refit-${ship.id}-${i}`)}
                  aria-label="Refit module"
                >
                  <option value="">REFIT… ({REFIT_DAYS} days in dock)</option>
                  {MODULES.filter((x) => x.slot === m.slot && x.id !== m.moduleId && procurability(x, vendors, done).ok).map((a) => (
                    <option key={a.id} value={a.id}>
                      {n.m(a.id)} [{n.vs(a.vendorId)}] {refitCost(m.moduleId, a.id).toFixed(0)}M
                    </option>
                  ))}
                </select>
              )}
              {alternatives.length > 0 && (
                <select
                  className="mt-1 w-full px-1 py-0.5 text-[0.8125rem]"
                  defaultValue=""
                  onChange={(e) => e.target.value && st.substituteModule(ship.id, i, e.target.value)}
                  aria-label="Substitute module"
                >
                  <option value="">SUBSTITUTE… (×1.5 cost)</option>
                  {alternatives.map((a) => (
                    <option key={a.id} value={a.id}>
                      {n.m(a.id)} [{n.vs(a.vendorId)}] {(a.cost * 1.5).toFixed(0)}M
                    </option>
                  ))}
                </select>
              )}
            </li>
          );
        })}
      </ul>

      {ship.buildStatus === 'COMMISSIONED' && (
        <div className="grid grid-cols-2 gap-x-3 border-t border-navy pt-1">
          <Stat k="CMS reaction" v={`${ev.reactionSec.toFixed(1)}s`} tone={ev.frictionIndex > 0 ? 'text-amber-radar' : undefined} />
          <Stat k="Friction index" v={ev.frictionIndex.toFixed(2)} tone={ev.frictionIndex > 0.5 ? 'text-warn' : undefined} />
          <Stat k="Detection" v={`${ev.detectionKm} km`} />
          <Stat k="Firepower" v={ev.firepower} />
          <Stat k="Interceptors" v={ev.interceptors} />
          <Stat k="Combat rating" v={ev.combatRating} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 border-t border-navy pt-1">
        {ship.buildStatus === 'COMMISSIONED' && !ship.isPartsHulk && (
          <Btn tone={ship.holdStation ? 'amber' : 'dim'} preview={(w) => previewHold(w, ship.id)} onClick={() => st.toggleHold(ship.id)}>
            {ship.holdStation ? 'Holding station' : 'Hold station'}
          </Btn>
        )}
        {showHulk && ship.buildStatus === 'COMMISSIONED' && !ship.isPartsHulk && (
          <Btn tone="red" disabled={ship.state !== 'MAINTENANCE_DOCK'} preview={(w) => previewHulk(w, ship.id)} onClick={() => st.designateHulk(ship.id)}>
            <Skull className="mr-1 inline h-3 w-3" />
            Designate parts hulk
          </Btn>
        )}
        {ship.isPartsHulk && (
          <>
            <Btn tone="red" preview={(w) => previewStrip(w, ship.id)} onClick={() => st.stripHulk(ship.id)}>Strip to spares & scrap</Btn>
            <Btn tone="dim" preview={(w) => previewRestore(w, ship.id)} onClick={() => st.restoreHulk(ship.id)}>Restore to service</Btn>
          </>
        )}
        <select
          className="ml-auto px-1 py-0.5 text-[0.8125rem]"
          value={squadrons.find((s) => s.has)?.id ?? ''}
          onChange={(e) => st.moveShip(ship.id, e.target.value)}
          aria-label="Transfer to squadron"
        >
          {squadrons.map((s) => (
            <option key={s.id} value={s.id}>
              → {s.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ShipRow({ ship }: { ship: Ship }) {
  const showHulk = useUiFlag('HULK');
  const selected = useFleetStore((s) => s.selectedShipId === ship.id);
  const select = useFleetStore((s) => s.selectShip);
  const picked = useSelectionStore((s) => s.ships.includes(ship.id));
  const toggle = useSelectionStore((s) => s.toggleShip);
  const hull = HULLS[ship.hullId];
  const failed = ship.modules.filter((m) => m.failed).length;
  return (
    <li data-tutorial={`ship-${ship.id}`} className={`border ${selected ? 'border-phosphor/70' : 'border-navy'} ${ship.isPartsHulk ? 'opacity-70' : ''}`}>
      <div role="button" tabIndex={0} onClick={() => select(selected ? null : ship.id)} onKeyDown={(e) => e.key === 'Enter' && select(selected ? null : ship.id)} className="flex cursor-pointer items-center gap-1.5 px-1.5 py-1 hover:bg-phosphor/5">
        {ship.buildStatus === 'COMMISSIONED' && !ship.isPartsHulk && (
          <input
            type="checkbox"
            aria-label={`Select ${ship.name}`}
            checked={picked}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggle(ship.id)}
            className="h-3 w-3 shrink-0 accent-[#35f2a0]"
          />
        )}
        {selected ? <ChevronDown className="h-3 w-3 shrink-0 text-phosphor" /> : <ChevronRight className="h-3 w-3 shrink-0 text-slate-600" />}
        <span className="w-10 shrink-0 text-[0.8125rem] text-slate-500">{ship.pennant}</span>
        <span className="min-w-0 flex-1 truncate text-[0.875rem] text-slate-200">
          {selected ? <EditableName kind="SHIP" id={ship.id} value={ship.name} /> : ship.name}
          <span className="ml-1 text-[0.75rem] text-slate-600">{hull.name}</span>
        </span>
        {failed > 0 && !ship.isPartsHulk && <Chip tone="red">{failed}× FAULT</Chip>}
        {ship.holdStation && <Chip tone="amber">HOLD</Chip>}
        {isBoat(ship) && ship.buildStatus === 'COMMISSIONED' && !ship.isPartsHulk && (
          isExposed(ship) ? <Chip tone="red">EXPOSED</Chip> : isRecharging(ship) ? <Chip tone="amber">RECHARGE</Chip> : <Chip tone={stanceOf(ship) === 'STEALTH' ? 'emerald' : 'cyan'}>{stanceOf(ship) === 'STEALTH' ? 'STL' : 'PAT'}</Chip>
        )}
        {(ship.refitDaysLeft ?? 0) > 0 && <Chip tone="cyan">REFIT {ship.refitDaysLeft}d</Chip>}
        {showHulk && ship.buildStatus === 'COMMISSIONED' && !ship.isPartsHulk && ship.state === 'MAINTENANCE_DOCK' && (
          <button
            data-tutorial={`hulk-${ship.id}`}
            aria-label={`Designate ${ship.name} as parts hulk`}
            title="Designate as Parts Hulk (reversible: Restore to service)"
            onClick={(e) => {
              e.stopPropagation();
              useFleetStore.getState().designateHulk(ship.id);
            }}
            onPointerEnter={() => usePreviewStore.getState().show((w) => previewHulk(w, ship.id), `hulk-${ship.id}`)}
            onPointerLeave={() => usePreviewStore.getState().clear(`hulk-${ship.id}`)}
            onFocus={() => usePreviewStore.getState().show((w) => previewHulk(w, ship.id), `hulk-${ship.id}`)}
            onBlur={() => usePreviewStore.getState().clear(`hulk-${ship.id}`)}
            className="border border-warn/50 p-0.5 text-warn hover:bg-warn/15"
          >
            <Skull className="h-3 w-3" />
          </button>
        )}
        {ship.isPartsHulk ? (
          <Chip tone="red">PARTS HULK</Chip>
        ) : ship.buildStatus === 'CONSTRUCTING' ? (
          <Chip tone={ship.frozenBy ? 'red' : 'dim'}>{ship.frozenBy ? 'FROZEN' : `BUILD ${Math.round((ship.buildProgressDays / ship.buildTotalDays) * 100)}%`}</Chip>
        ) : (
          <>
            <Chip tone={STATE_TONE[ship.state]}>{ship.state === 'ACTIVE_PATROL' ? 'PAT' : ship.state === 'TRANSIT_WORKUP' ? 'TRN' : 'DOC'}</Chip>
            <Meter value={ship.readiness} width="w-14" />
          </>
        )}
      </div>
      {selected && <ShipDetail ship={ship} />}
    </li>
  );
}

function TaskForceNode({ tf }: { tf: TaskForce }) {
  const map = useFleetStore((s) => s.map);
  const ships = useFleetStore((s) => s.ships);
  const selected = useFleetStore((s) => s.selectedTaskForceId === tf.id);
  const { selectTaskForce, assignTaskForce, setTempo } = useFleetStore.getState();
  const [open, setOpen] = useState(true);
  const tfPicked = useSelectionStore((s) => s.tfs.includes(tf.id));
  const toggleTf = useSelectionStore((s) => s.toggleTf);
  const list = taskForceShipIds(tf).map((id) => ships[id]).filter(Boolean);
  const counts = stateCounts(list);
  return (
    <div data-tutorial={`tf-${tf.id}`} className={`border ${selected ? 'border-phosphor shadow-glow' : 'border-navy'}`}>
      <div className="flex items-center gap-1 bg-phosphor/5 px-1.5 py-1">
        <button aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)} className="text-phosphor">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <input type="checkbox" aria-label={`Select ${tf.name}`} checked={tfPicked} onChange={() => toggleTf(tf.id)} className="h-3 w-3 shrink-0 accent-[#35f2a0]" />
        <div role="button" tabIndex={0} onClick={() => selectTaskForce(selected ? null : tf.id)} onKeyDown={(e) => e.key === 'Enter' && selectTaskForce(selected ? null : tf.id)} className="cursor-pointer text-left text-[0.875rem] uppercase tracking-wider text-phosphor">
          <EditableName kind="TASKFORCE" id={tf.id} value={tf.name} />
        </div>
        <span className="ml-auto text-[0.75rem] text-slate-500">
          {counts.ACTIVE_PATROL}P · {counts.TRANSIT_WORKUP}T · {counts.MAINTENANCE_DOCK}M
        </span>
      </div>
      {open && (
        <div className="space-y-1.5 p-1.5">
          <div className="flex flex-wrap items-center gap-1">
            <select
              className="min-w-0 flex-1 px-1 py-0.5 text-[0.8125rem]"
              value={tf.assignedSectorId ?? ''}
              onChange={(e) => assignTaskForce(tf.id, e.target.value === '' ? null : Number(e.target.value))}
              aria-label="Assigned sector"
            >
              <option value="">IN PORT</option>
              {map.sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <span className="text-[0.8125rem] uppercase tracking-widest text-slate-500"><Term k="TEMPO">Tempo</Term></span>
            <Btn tone={tf.tempo === 'ROTATE_THIRDS' ? 'cyan' : 'dim'} preview={(w) => `Rotate ⅓: ${previewTempo(w, tf.id, 'ROTATE_THIRDS')}`} onClick={() => setTempo(tf.id, 'ROTATE_THIRDS')}>Rotate ⅓</Btn>
            <Btn tone={tf.tempo === 'SURGE' ? 'red' : 'dim'} preview={(w) => `Surge: ${previewTempo(w, tf.id, 'SURGE')}`} onClick={() => setTempo(tf.id, 'SURGE')}>Surge</Btn>
          </div>
          {tf.squadrons.length === 0 && <div className="text-[0.8125rem] text-slate-600">No squadrons.</div>}
          {tf.squadrons.map((sq) => (
            <div key={sq.id} className="border-l border-emerald-accent/40 pl-1.5">
              <div className="mb-0.5 text-[0.8125rem] uppercase tracking-wider text-emerald-accent">
                <EditableName kind="SQUADRON" id={sq.id} value={sq.name} />
              </div>
              <ul className="space-y-0.5">
                {sq.shipIds.map((id) => ships[id] && <ShipRow key={id} ship={ships[id]} />)}
                {sq.shipIds.length === 0 && <li className="text-[0.8125rem] text-slate-600">Empty.</li>}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SparesYard() {
  const n = useNames();
  const spares = useFleetStore((s) => s.spares);
  const ships = useFleetStore((s) => s.ships);
  const auto = useFleetStore((s) => s.policy.autoSpares);
  const vendors = useFleetStore((s) => s.vendors);
  const research = useFleetStore((s) => s.research);
  const { buySpares, setAutoSpares } = useFleetStore.getState();
  const [open, setOpen] = useState(false);
  const relevant = useMemo(() => {
    const ids = new Set<string>(Object.keys(spares));
    for (const s of Object.values(ships)) for (const m of s.modules) ids.add(m.moduleId);
    return [...ids].map((id) => MODULE_BY_ID[id]).filter(Boolean).sort((a, b) => a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name));
  }, [spares, ships]);
  const done = useMemo(() => new Set(research.completed), [research.completed]);
  const total = Object.values(spares).reduce((a, b) => a + b, 0);
  return (
    <Section anchor="spares" title={<Term k="HULK">Spares & cannibalisation</Term>} tone="amber" right={<button onClick={() => setOpen(!open)} className="text-[0.8125rem] text-amber-radar">{open ? 'HIDE' : `SHOW · ${total} IN STOCK`}</button>}>
      <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-slate-400">
        <input type="checkbox" checked={auto} onChange={(e) => setAutoSpares(e.target.checked)} />
        Standing order: rush-buy spares for stalled docks (60% cost, blocked by sanctions)
      </label>
      {open && (
        <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto pr-1">
          {relevant.map((m) => {
            const p = procurability(m, vendors, done);
            return (
              <li key={m.id} className="flex items-center justify-between gap-1 text-[0.8125rem]">
                <span className="truncate text-slate-300">
                  {n.m(m.id)} <span className="text-slate-600">[{n.vs(m.vendorId)}]</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-5 text-right tabular-nums text-amber-radar">{spares[m.id] ?? 0}</span>
                  <Btn tone="amber" disabled={!p.ok} preview={(w) => `Buy spare: ${previewBuySpare(w, m.id)}`} onClick={() => buySpares(m.id, 1)}>+1</Btn>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-1 text-[0.8125rem] text-slate-600">When spares run out, designate a docked hull as a Parts Hulk to feed frontline repairs.</p>
    </Section>
  );
}

function Organise() {
  const fleets = useFleetStore((s) => s.fleets);
  const { createFleet, createTaskForce, createSquadron } = useFleetStore.getState();
  const [kind, setKind] = useState<'FLEET' | 'TASKFORCE' | 'SQUADRON'>('SQUADRON');
  const [parent, setParent] = useState('');
  const [name, setName] = useState('');
  const parents = kind === 'TASKFORCE' ? fleets.map((f) => ({ id: f.id, label: f.name })) : kind === 'SQUADRON' ? fleets.flatMap((f) => f.taskForces.map((t) => ({ id: t.id, label: t.name }))) : [];
  const pid = parents.find((p) => p.id === parent)?.id ?? parents[0]?.id ?? '';
  return (
    <Section anchor="organise" title="Organise & commission names">
      <form
        className="flex flex-wrap items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const r = kind === 'FLEET' ? createFleet(name) : kind === 'TASKFORCE' ? createTaskForce(pid, name) : createSquadron(pid, name);
          if (r.ok) setName('');
        }}
      >
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="px-1 py-0.5 text-[0.8125rem]" aria-label="Formation type">
          <option value="FLEET">FLEET</option>
          <option value="TASKFORCE">TASK FORCE</option>
          <option value="SQUADRON">SQUADRON</option>
        </select>
        {kind !== 'FLEET' && (
          <select value={pid} onChange={(e) => setParent(e.target.value)} className="px-1 py-0.5 text-[0.8125rem]" aria-label="Parent formation">
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                in {p.label}
              </option>
            ))}
          </select>
        )}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Custom name (optional)" className="min-w-0 flex-1 px-1 py-0.5 text-[0.875rem]" aria-label="Formation name" />
        <Btn type="submit" tone="emerald" disabled={kind !== 'FLEET' && !pid}>Create</Btn>
      </form>
      <p className="mt-1 text-[0.8125rem] text-slate-600">Rename any formation or hull with the pencil icon. Ship names are drawn from your chosen tradition when commissioning in the Design Bureau.</p>
    </Section>
  );
}

function BulkBar() {
  const shipSel = useSelectionStore((s) => s.ships);
  const tfSel = useSelectionStore((s) => s.tfs);
  const clear = useSelectionStore((s) => s.clear);
  const fleets = useFleetStore((s) => s.fleets);
  const ships = useFleetStore((s) => s.ships);
  const map = useFleetStore((s) => s.map);
  const research = useFleetStore((s) => s.research);
  const vendors = useFleetStore((s) => s.vendors);
  const n = useNames();
  const st = useFleetStore.getState();
  const [sq, setSq] = useState('');
  const [slot, setSlot] = useState<ModuleSlot | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const done = useMemo(() => new Set(research.completed), [research.completed]);
  const shipIds = shipSel.filter((id) => ships[id]);
  const tfIds = tfSel.filter((id) => fleets.some((f) => f.taskForces.some((t) => t.id === id)));
  if (shipIds.length === 0 && tfIds.length === 0) return null;
  const squadrons = fleets.flatMap((f) => f.taskForces.flatMap((t) => t.squadrons.map((q) => ({ id: q.id, label: `${t.name} / ${q.name}` }))));
  const carried = new Map<string, { slot: ModuleSlot; id: string }>();
  for (const id of shipIds) for (const m of ships[id].modules) carried.set(`${m.slot}:${m.moduleId}`, { slot: m.slot, id: m.moduleId });
  const pick = from ? carried.get(from) : undefined;
  const alts = pick ? MODULES.filter((x) => x.slot === pick.slot && x.id !== pick.id && procurability(x, vendors, done).ok) : [];
  const sqId = squadrons.find((q) => q.id === sq)?.id ?? '';
  return (
    <Section anchor="bulk" title="Bulk orders" right={<Btn tone="dim" onClick={clear}>Clear selection</Btn>}>
      <div className="space-y-1.5 text-[0.8125rem]">
        {shipIds.length > 0 && (
          <div className="space-y-1">
            <div className="uppercase tracking-widest text-slate-500">{shipIds.length} ship{shipIds.length === 1 ? '' : 's'} selected</div>
            <div className="flex flex-wrap items-center gap-1">
              <select value={sqId} onChange={(e) => setSq(e.target.value)} className="min-w-0 flex-1 px-1 py-0.5" aria-label="Bulk transfer squadron">
                <option value="">MOVE TO SQUADRON…</option>
                {squadrons.map((q) => (
                  <option key={q.id} value={q.id}>{q.label}</option>
                ))}
              </select>
              <Btn tone="cyan" disabled={!sqId} onClick={() => st.moveShips(shipIds, sqId)}>Move</Btn>
              <Btn tone="emerald" preview={(w) => previewSplit(w, shipIds)} onClick={() => { const r = st.splitTaskForce(shipIds); if (r.ok) clear(); }}>Detach as new task force</Btn>
            </div>
            {shipIds.some((id) => isBoat(ships[id])) && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="uppercase tracking-widest text-slate-500">Boats</span>
                <Btn tone="cyan" preview={(w) => previewStanceMany(w, shipIds, 'PATROL')} onClick={() => st.setStanceMany(shipIds, 'PATROL')}>All patrol</Btn>
                <Btn tone="emerald" preview={(w) => previewStanceMany(w, shipIds, 'STEALTH')} onClick={() => st.setStanceMany(shipIds, 'STEALTH')}>All stealth</Btn>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1">
              <select value={from} onChange={(e) => { setFrom(e.target.value); setTo(''); setSlot((carried.get(e.target.value)?.slot as ModuleSlot) ?? ''); }} className="min-w-0 flex-1 px-1 py-0.5" aria-label="Bulk refit from module">
                <option value="">REFIT: REPLACE…</option>
                {[...carried.entries()].map(([k, v]) => (
                  <option key={k} value={k}>{v.slot} · {n.m(v.id)}</option>
                ))}
              </select>
              <select value={to} onChange={(e) => setTo(e.target.value)} className="min-w-0 flex-1 px-1 py-0.5" aria-label="Bulk refit to module" disabled={!pick}>
                <option value="">WITH…</option>
                {alts.map((a) => (
                  <option key={a.id} value={a.id}>{n.m(a.id)} [{n.vs(a.vendorId)}] {refitCost(pick!.id, a.id).toFixed(0)}M each</option>
                ))}
              </select>
              <Btn tone="amber" disabled={!pick || !to || !slot} preview={(w) => (pick && to && slot ? previewRefitMany(w, shipIds, slot, pick.id, to) : 'Choose a module to replace and its replacement · docked ships only')} onClick={() => pick && to && st.refitMany(shipIds, pick.slot, pick.id, to)}>
                Refit all
              </Btn>
            </div>
          </div>
        )}
        {tfIds.length > 0 && (
          <div className="space-y-1">
            <div className="uppercase tracking-widest text-slate-500">{tfIds.length} task force{tfIds.length === 1 ? '' : 's'} selected</div>
            <div className="flex flex-wrap items-center gap-1">
              <select value="" onChange={(e) => e.target.value !== '' && st.assignTaskForces(tfIds, e.target.value === 'PORT' ? null : Number(e.target.value))} className="min-w-0 flex-1 px-1 py-0.5" aria-label="Bulk assign sector">
                <option value="">SEND ALL TO…</option>
                <option value="PORT">IN PORT</option>
                {map.sectors.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <Btn tone="cyan" onClick={() => st.setTempoMany(tfIds, 'ROTATE_THIRDS')}>Rotate ⅓</Btn>
              <Btn tone="red" onClick={() => st.setTempoMany(tfIds, 'SURGE')}>Surge</Btn>
              {tfIds.length >= 2 && (
                <Btn
                  tone="amber"
                  preview={(w) => previewMerge(w, tfIds[1], tfIds[0])}
                  onClick={() => {
                    for (const id of tfIds.slice(1)) st.mergeTaskForces(id, tfIds[0]);
                    clear();
                  }}
                >
                  Merge into first
                </Btn>
              )}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function RollOfHonour() {
  const fallen = useFleetStore((s) => s.stats.fallen);
  if (!fallen || fallen.length === 0) return null;
  return (
    <Section title="Roll of honour" right={<span className="text-slate-500">{fallen.length} ship{fallen.length === 1 ? '' : 's'}</span>}>
      <ul className="space-y-1 text-[0.8125rem]">
        {fallen.slice(0, 8).map((f, i) => (
          <li key={`${f.pennant}-${f.tick}-${i}`} className="text-slate-400">
            <span className="text-warn">{f.pennant} {f.name}</span> · {f.hull} · day {f.tick} · {f.where} · {f.crew} crew · {f.serviceDays} days, {f.engagements} engagement{f.engagements === 1 ? '' : 's'}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export default function OrderOfBattle() {
  const fleets = useFleetStore((s) => s.fleets);
  const ships = useFleetStore((s) => s.ships);
  const stats = useFleetStore((s) => s.stats);
  const list = useMemo(() => Object.values(ships), [ships]);
  const showThirds = useUiFlag('THIRDS');
  const showSpares = useUiFlag('SPARES');
  const showOrganise = useUiFlag('ORGANISE');
  return (
    <div className="space-y-2">
      {showThirds && <ThirdsGauge ships={list} />}
      <BulkBar />
      <Section title="Order of battle" right={<span className="text-slate-500">{list.length} hulls · {stats.hostilesDestroyed} kills · {stats.shipsLost} lost</span>}>
        <div className="space-y-2">
          {fleets.map((f) => (
            <div key={f.id}>
              <div className="mb-1 text-[0.875rem] uppercase tracking-[0.25em] text-phosphor glow-text">
                <EditableName kind="FLEET" id={f.id} value={f.name} />
              </div>
              <div className="space-y-1.5 border-l border-phosphor/30 pl-2">
                {f.taskForces.map((tf) => (
                  <TaskForceNode key={tf.id} tf={tf} />
                ))}
                {f.taskForces.length === 0 && <div className="text-[0.8125rem] text-slate-600">No task forces.</div>}
              </div>
            </div>
          ))}
        </div>
      </Section>
      <RollOfHonour />
      {showSpares && <SparesYard />}
      {showOrganise && <Organise />}
    </div>
  );
}

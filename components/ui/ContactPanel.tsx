'use client';

import { Crosshair, X } from 'lucide-react';
import { Term } from '@/components/tutorial/Term';
import { ACTION_RANGE, actionBlocked, contactStatus, nearestActiveTf } from '@/lib/sim/contactEngine';
import { previewContactOrder } from '@/lib/sim/preview';
import type { LadderAction } from '@/lib/types/world';
import { useFleetStore } from '@/store/useFleetStore';
import { Btn, Chip, Section, Stat } from './kit';

const STEPS: { id: LadderAction; label: string; tone: 'cyan' | 'amber' | 'red' | 'emerald' | 'dim' }[] = [
  { id: 'SHADOW', label: 'Shadow', tone: 'dim' },
  { id: 'HAIL', label: 'Hail', tone: 'cyan' },
  { id: 'WARN', label: 'Warn', tone: 'amber' },
  { id: 'BOARD', label: 'Board', tone: 'amber' },
  { id: 'ENGAGE', label: 'Engage', tone: 'red' },
];

/** The selected contact's escalation ladder: what is known, what has been done, and per-contact orders overriding the SOP. */
export default function ContactPanel() {
  const id = useFleetStore((s) => s.selectedContactId);
  const contact = useFleetStore((s) => s.contacts.find((c) => c.id === s.selectedContactId));
  const sectors = useFleetStore((s) => s.sectors);
  const map = useFleetStore((s) => s.map);
  const { selectContact, orderContact } = useFleetStore.getState();
  if (!id) return null;

  if (!contact) {
    return (
      <Section title="Contact" right={<Btn tone="dim" onClick={() => selectContact(null)}>Close</Btn>}>
        <p className="text-[0.8125rem] text-slate-500">Contact lost: it left the plot, was dealt with, or its track expired. See the ticker.</p>
      </Section>
    );
  }
  const st = sectors[contact.sectorId];
  const near = nearestActiveTf(useFleetStore.getState().snapshotWorld(), contact.position.x, contact.position.y);
  const status = contactStatus(contact);
  const tone = contact.cls === 'HOSTILE' ? 'red' : contact.cls === 'NEUTRAL' ? 'emerald' : contact.suspicious || contact.fleeing ? 'amber' : 'amber';
  const done: Record<LadderAction, boolean> = {
    SHADOW: !!near && near.d <= ACTION_RANGE.SHADOW,
    HAIL: !!contact.hailed || contact.cls !== 'UNKNOWN',
    WARN: !!contact.warned,
    BOARD: (contact.boardAttempts ?? 0) > 0,
    ENGAGE: false,
  };

  return (
    <Section
      anchor="contact-panel"
      tone={tone === 'red' ? 'red' : tone === 'emerald' ? 'emerald' : 'amber'}
      title={
        <span className="inline-flex items-center gap-1.5">
          <Crosshair className="h-3.5 w-3.5" /> Contact {contact.id.slice(3, 11)}
        </span>
      }
      right={
        <button aria-label="Close contact" onClick={() => selectContact(null)} className="text-slate-500 hover:text-phosphor">
          <X className="h-3.5 w-3.5" />
        </button>
      }
    >
      <div className="mb-1 flex flex-wrap items-center gap-1">
        <Chip tone={tone}>{status}</Chip>
        {contact.fleeing && <Chip tone="amber">RUNNING</Chip>}
        {contact.order && <Chip tone="cyan">ORDER: {contact.order === 'SHADOW' ? 'HOLD' : contact.order}</Chip>}
        {!contact.order && <Chip tone="dim">SOP: {st.sop}</Chip>}
      </div>
      <Stat k="Sector" v={map.sectors[contact.sectorId].label} />
      <Stat k="Nearest task force" v={near ? `${near.d.toFixed(0)} tiles` : 'none at sea'} tone={near && near.d <= 12 ? 'text-amber-radar' : undefined} />
      <Stat k="ROE ceiling" v={st.roe.replace('_', ' ')} />
      {contact.submerged && <Stat k={<Term k="SONAR">Sonar hold</Term>} v={`${Math.round(contact.track ?? 0)} / 100`} tone={(contact.track ?? 0) >= 75 ? undefined : 'text-amber-radar'} />}
      {contact.cls === 'HOSTILE' && <Stat k="Estimated strength" v={contact.strength.toFixed(0)} tone="text-warn" />}

      <div className="mt-2 text-[0.75rem] uppercase tracking-widest text-slate-500">
        <Term k="LADDER">Escalation ladder</Term>
      </div>
      <div className="mt-1 grid grid-cols-5 gap-1">
        {STEPS.map((s) => {
          const blocked = actionBlocked(contact, st.roe, s.id);
          return (
            <Btn
              key={s.id}
              tone={contact.order === s.id ? 'cyan' : s.tone}
              className={done[s.id] && s.id !== 'SHADOW' ? 'line-through decoration-1' : ''}
              disabled={!!blocked}
              preview={(w) => `${s.label}: ${previewContactOrder(w, contact.id, s.id)}`}
              onClick={() => orderContact(contact.id, s.id)}
            >
              {s.label}
            </Btn>
          );
        })}
      </div>
      <Btn
        className="mt-1 w-full"
        tone="dim"
        disabled={!contact.order}
        preview={(w) => previewContactOrder(w, contact.id, 'AUTO')}
        onClick={() => orderContact(contact.id, 'AUTO')}
      >
        Return to sector SOP
      </Btn>
      <p className="mt-1 text-[0.75rem] text-slate-600">Orders are carried out by the nearest task force once it is in range, one step per day. Hover a step for its range and possible outcomes.</p>
    </Section>
  );
}

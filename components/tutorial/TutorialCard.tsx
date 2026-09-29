'use client';

import { Check, GraduationCap } from 'lucide-react';
import { LESSONS } from '@/lib/tutorial/lessons';
import { useTutorialStore } from '@/store/useTutorialStore';
import { Btn } from '@/components/ui/kit';
import { useNames } from '@/store/useNames';

/**
 * The briefing card. Docked as a strip under the map (never over the plot); `compact` renders the same content
 * inside the designer modal, which would otherwise cover it.
 */
export default function TutorialCard({ compact = false }: { compact?: boolean }) {
  const active = useTutorialStore((s) => s.active);
  const index = useTutorialStore((s) => s.lessonIndex);
  const completing = useTutorialStore((s) => s.completing);
  const graduated = useTutorialStore((s) => s.graduated);
  const { skip, finish } = useTutorialStore.getState();
  const n = useNames();

  if (!active || index < 0) return null;
  const lesson = LESSONS[index];
  const wrap = `border border-phosphor/50 bg-panel ${compact ? 'mb-2' : 'border-x-0 border-b-0 shadow-glow'}`;

  if (graduated) {
    return (
      <section className={wrap} aria-live="polite" data-testid="tutorial-card">
        <div className="flex flex-wrap items-center gap-3 px-3 py-2">
          <GraduationCap className="h-5 w-5 shrink-0 text-emerald-accent" />
          <div className="min-w-0 flex-1">
            <div className="glow-text text-sm uppercase tracking-[0.25em] text-phosphor">Briefing complete</div>
            <p className="text-[0.875rem] text-slate-300">You have the watch, Admiral. Keep this scenario running, or open a fresh procedurally generated theatre.</p>
          </div>
          <Btn tone="emerald" onClick={() => finish(false)}>Keep this scenario</Btn>
          <Btn tone="amber" onClick={() => finish(true)}>New theatre</Btn>
        </div>
      </section>
    );
  }

  return (
    <section className={wrap} aria-live="polite" data-testid="tutorial-card">
      <div className="flex flex-wrap items-stretch gap-x-5 gap-y-2 px-3 py-2">
        <div className="min-w-[16rem] flex-[3]">
          <div className="flex items-center gap-2 text-[0.75rem] uppercase tracking-[0.25em] text-slate-500">
            <GraduationCap className="h-4 w-4 text-phosphor" />
            Admiral&apos;s briefing {index + 1}/{LESSONS.length}
            <span className="flex gap-0.5" aria-hidden>
              {LESSONS.map((l, i) => (
                <span key={l.id} className={`h-1.5 w-3 ${i < index ? 'bg-emerald-accent' : i === index ? 'bg-phosphor' : 'bg-navy'}`} />
              ))}
            </span>
          </div>
          <h2 className="glow-text mt-0.5 text-base uppercase tracking-[0.2em] text-phosphor">{n.t(lesson.title)}</h2>
          {lesson.body.map((line, i) => (
            <p key={i} className="mt-0.5 text-[0.875rem] leading-snug text-slate-300">
              {n.t(line)}
            </p>
          ))}
        </div>
        <div className="flex min-w-[14rem] flex-[2] flex-col justify-between gap-2 border-l border-navy pl-4">
          <div className={`flex items-start gap-2 text-[0.875rem] ${completing ? 'text-emerald-accent' : 'text-amber-radar'}`}>
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border ${completing ? 'border-emerald-accent bg-emerald-accent/20' : 'border-amber-radar'}`}>
              {completing && <Check className="h-3 w-3" />}
            </span>
            <span>
              <span className="block text-[0.75rem] uppercase tracking-[0.2em] opacity-70">{completing ? 'Objective complete' : 'Objective'}</span>
              {n.t(lesson.objective)}
            </span>
          </div>
          <div className="flex justify-end">
            <Btn tone="dim" onClick={() => skip()} title="Reveal everything and turn random events on">
              Skip briefing
            </Btn>
          </div>
        </div>
      </div>
    </section>
  );
}

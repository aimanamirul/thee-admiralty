'use client';
/** Tiny terminal-styled UI kit shared by the panels. */
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { previewOwner, usePreviewStore, type PreviewFn } from '@/store/usePreviewStore';

export function Section({ title, right, children, tone = 'cyan', anchor }: { title: ReactNode; right?: ReactNode; children: ReactNode; tone?: 'cyan' | 'amber' | 'red' | 'emerald'; anchor?: string }) {
  const t = { cyan: 'text-phosphor border-phosphor/40', amber: 'text-amber-radar border-amber-radar/40', red: 'text-warn border-warn/40', emerald: 'text-emerald-accent border-emerald-accent/40' }[tone];
  return (
    <section data-tutorial={anchor} className="border border-navy bg-panel/80">
      <header className={`flex items-center justify-between border-b px-2 py-1 text-[0.8125rem] uppercase tracking-[0.2em] ${t}`}>
        <span>▍{title}</span>
        {right}
      </header>
      <div className="p-2">{children}</div>
    </section>
  );
}

export function Btn({
  tone = 'cyan',
  className = '',
  preview,
  disabled,
  onClick,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'cyan' | 'amber' | 'red' | 'emerald' | 'dim'; preview?: PreviewFn }) {
  const t = {
    cyan: 'border-phosphor/60 text-phosphor hover:bg-phosphor/15',
    amber: 'border-amber-radar/60 text-amber-radar hover:bg-amber-radar/15',
    red: 'border-warn/60 text-warn hover:bg-warn/15',
    emerald: 'border-emerald-accent/60 text-emerald-accent hover:bg-emerald-accent/15',
    dim: 'border-navy text-slate-400 hover:border-phosphor/50 hover:text-phosphor',
  }[tone];
  const [owner] = useState(previewOwner);
  const base = `border px-2 py-0.5 text-[0.8125rem] uppercase tracking-widest transition ${t} ${className}`;
  if (!preview) {
    return <button {...p} disabled={disabled} onClick={onClick} className={`${base} disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent`} />;
  }
  // Browsers fire no pointer events on disabled buttons, but a blocked action is exactly when the preview (the reason) matters:
  // keep the button hoverable and focusable, mark it aria-disabled and swallow the click instead.
  const { show, clear } = usePreviewStore.getState();
  return (
    <button
      {...p}
      aria-disabled={disabled || undefined}
      onClick={disabled ? (e) => e.preventDefault() : onClick}
      onPointerEnter={() => show(preview, owner)}
      onPointerLeave={() => clear(owner)}
      onFocus={() => show(preview, owner)}
      onBlur={() => clear(owner)}
      className={`${base} ${disabled ? 'cursor-not-allowed opacity-35 hover:bg-transparent' : ''}`}
    />
  );
}

export function Meter({ value, max = 100, tone, label, width = 'w-full' }: { value: number; max?: number; tone?: 'cyan' | 'amber' | 'red' | 'emerald'; label?: string; width?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const auto = tone ?? (pct < 30 ? 'red' : pct < 60 ? 'amber' : 'cyan');
  const bar = { cyan: 'bg-phosphor', amber: 'bg-amber-radar', red: 'bg-warn', emerald: 'bg-emerald-accent' }[auto];
  return (
    <div className={`flex items-center gap-1.5 ${width}`}>
      <div className="h-1.5 flex-1 bg-navy-deep">
        <div className={`h-full ${bar}`} style={{ width: `${pct}%`, boxShadow: '0 0 6px currentColor' }} />
      </div>
      {label !== undefined && <span className="w-9 text-right text-[0.8125rem] tabular-nums text-slate-400">{label}</span>}
    </div>
  );
}

export function Chip({ children, tone = 'cyan' }: { children: ReactNode; tone?: 'cyan' | 'amber' | 'red' | 'emerald' | 'dim' }) {
  const t = {
    cyan: 'border-phosphor/50 text-phosphor',
    amber: 'border-amber-radar/50 text-amber-radar',
    red: 'border-warn/60 text-warn',
    emerald: 'border-emerald-accent/50 text-emerald-accent',
    dim: 'border-navy text-slate-500',
  }[tone];
  return <span className={`border px-1 text-[0.75rem] uppercase tracking-wider ${t}`}>{children}</span>;
}

export const fmtM = (n: number) => `${n >= 1000 ? (n / 1000).toFixed(2) + 'B' : n.toFixed(0) + 'M'}`;

export function Stat({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="flex justify-between gap-2 text-[0.875rem]">
      <span className="text-slate-500">{k}</span>
      <span className={`tabular-nums ${tone ?? 'text-slate-200'}`}>{v}</span>
    </div>
  );
}

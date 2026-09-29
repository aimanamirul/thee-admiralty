'use client';

import type { ReactNode } from 'react';
import { GLOSSARY } from '@/lib/tutorial/glossary';

/** Jargon label with a hover / focus definition. */
export function Term({ k, children }: { k: keyof typeof GLOSSARY; children: ReactNode }) {
  const text = GLOSSARY[k];
  return (
    <span className="group relative cursor-help border-b border-dotted border-slate-500 outline-none" tabIndex={0}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-[70] mt-1 hidden w-64 border border-phosphor/60 bg-void px-2 py-1.5 text-[0.8125rem] normal-case leading-snug tracking-normal text-slate-200 shadow-glow group-hover:block group-focus:block"
      >
        {text}
      </span>
    </span>
  );
}

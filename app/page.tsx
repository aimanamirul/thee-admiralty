'use client';

import dynamic from 'next/dynamic';

/**
 * The world is generated procedurally from a seed with floating-point maths, so it is built on the client only:
 * server-rendering it could disagree with the browser's engine in the last bit and cause hydration mismatches.
 */
const Cockpit = dynamic(() => import('@/components/Cockpit'), {
  ssr: false,
  loading: () => (
    <main className="flex h-screen items-center justify-center bg-void">
      <div className="glow-text animate-blink text-xs uppercase tracking-[0.4em] text-phosphor">Initialising admiralty ledger…</div>
    </main>
  ),
});

export default function Page() {
  return <Cockpit />;
}

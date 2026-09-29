'use client';

import { useEffect } from 'react';
import CRTOverlay from '@/components/map/CRTOverlay';
import TacticalMap from '@/components/map/TacticalMap';
import CommandBar from '@/components/ui/CommandBar';
import DiplomacyLedger from '@/components/ui/DiplomacyLedger';
import EventFeed from '@/components/ui/EventFeed';
import OrderOfBattle from '@/components/ui/OrderOfBattle';
import RDBureauPanel from '@/components/ui/RDBureauPanel';
import SectorPanel from '@/components/ui/SectorPanel';
import ShipDesignerModal from '@/components/ui/ShipDesignerModal';
import { useFleetStore, type PanelTab } from '@/store/useFleetStore';

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'FLEET', label: 'Order of battle' },
  { id: 'SECTOR', label: 'Sector' },
  { id: 'RND', label: 'R&D bureau' },
  { id: 'DIPLO', label: 'Diplomacy' },
];

/** Drives the simulation: one day per tick, faster at higher speeds. */
function useSimClock() {
  const running = useFleetStore((s) => s.running);
  const speed = useFleetStore((s) => s.speed);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => useFleetStore.getState().step(1), 1000 / speed);
    return () => window.clearInterval(id);
  }, [running, speed]);
}

function Toast() {
  const toast = useFleetStore((s) => s.toast);
  const dismiss = useFleetStore((s) => s.dismissToast);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(dismiss, 4500);
    return () => window.clearTimeout(t);
  }, [toast, dismiss]);
  if (!toast) return null;
  return (
    <div role="alert" onClick={dismiss} className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 cursor-pointer border border-warn bg-void/95 px-3 py-1.5 text-[11px] uppercase tracking-widest text-warn shadow-glowRed">
      ⚠ {toast.text}
    </div>
  );
}

export default function Cockpit() {
  useSimClock();
  const tab = useFleetStore((s) => s.tab);
  const setTab = useFleetStore((s) => s.setTab);
  const designerOpen = useFleetStore((s) => s.designerOpen);

  return (
    <main className="flex h-screen flex-col bg-void">
      <CommandBar />
      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative min-h-[240px] flex-1">
            <TacticalMap />
            <CRTOverlay />
          </div>
          <div className="h-40 shrink-0 lg:h-44">
            <EventFeed />
          </div>
        </div>
        <aside className="flex h-[46vh] shrink-0 flex-col border-t border-phosphor/30 bg-panel lg:h-auto lg:w-[460px] lg:border-l lg:border-t-0">
          <nav className="flex border-b border-navy" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 border-r border-navy px-1 py-1.5 text-[10px] uppercase tracking-widest transition last:border-r-0 ${
                  tab === t.id ? 'bg-phosphor/10 text-phosphor shadow-glow' : 'text-slate-500 hover:text-phosphor'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {tab === 'FLEET' && <OrderOfBattle />}
            {tab === 'SECTOR' && <SectorPanel />}
            {tab === 'RND' && <RDBureauPanel />}
            {tab === 'DIPLO' && <DiplomacyLedger />}
          </div>
        </aside>
        <Toast />
      </div>
      {designerOpen && <ShipDesignerModal />}
    </main>
  );
}

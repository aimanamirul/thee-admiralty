'use client';

import { useEffect, useState } from 'react';
import CRTOverlay from '@/components/map/CRTOverlay';
import TacticalMap from '@/components/map/TacticalMap';
import CommandBar from '@/components/ui/CommandBar';
import DiplomacyLedger from '@/components/ui/DiplomacyLedger';
import EventFeed from '@/components/ui/EventFeed';
import OrderOfBattle from '@/components/ui/OrderOfBattle';
import RDBureauPanel from '@/components/ui/RDBureauPanel';
import SectorPanel from '@/components/ui/SectorPanel';
import ShipDesignerModal from '@/components/ui/ShipDesignerModal';
import TitleScreen from '@/components/TitleScreen';
import TutorialCard from '@/components/tutorial/TutorialCard';
import TutorialSpotlight from '@/components/tutorial/TutorialSpotlight';
import type { UiFlag } from '@/lib/tutorial/lessons';
import { useFleetStore, type PanelTab } from '@/store/useFleetStore';
import { useNames } from '@/store/useNames';
import { useTutorialStore, useUiFlag } from '@/store/useTutorialStore';
import { SKIN_STORAGE_KEY } from '@/lib/data/names';

const TABS: { id: PanelTab; label: string; flag: UiFlag }[] = [
  { id: 'FLEET', label: 'Order of battle', flag: 'TAB_FLEET' },
  { id: 'SECTOR', label: 'Sector', flag: 'TAB_SECTOR' },
  { id: 'RND', label: 'R&D bureau', flag: 'TAB_RND' },
  { id: 'DIPLO', label: 'Diplomacy', flag: 'TAB_DIPLO' },
];

/** Re-checks the current lesson's objective whenever the game state changes. */
function useTutorialEvaluate() {
  useEffect(() => useFleetStore.subscribe(() => useTutorialStore.getState().evaluate()), []);
}

/** Applies the UI scale to the root font-size and remembers it between sessions. */
function useUiScale() {
  const scale = useFleetStore((s) => s.uiScale);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem('al.uiScale'));
      if (saved) useFleetStore.getState().setUiScale(saved);
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * scale}px`;
    try {
      localStorage.setItem('al.uiScale', String(scale));
    } catch {}
  }, [scale]);
}

/** Restores and remembers the name skin (fictional / real). */
function useSkinPersist() {
  const skin = useFleetStore((s) => s.skin);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SKIN_STORAGE_KEY);
      if (saved === 'REAL' || saved === 'FICTIONAL') useFleetStore.getState().setSkin(saved);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(SKIN_STORAGE_KEY, skin);
    } catch {}
  }, [skin]);
}

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
  const n = useNames();
  const toast = useFleetStore((s) => s.toast);
  const dismiss = useFleetStore((s) => s.dismissToast);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(dismiss, 4500);
    return () => window.clearTimeout(t);
  }, [toast, dismiss]);
  if (!toast) return null;
  return (
    <div role="alert" onClick={dismiss} className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 cursor-pointer border border-warn bg-void/95 px-3 py-1.5 text-[0.875rem] uppercase tracking-widest text-warn shadow-glowRed">
      ⚠ {n.t(toast.text)}
    </div>
  );
}

export default function Cockpit() {
  useSimClock();
  useUiScale();
  useSkinPersist();
  useTutorialEvaluate();
  const tab = useFleetStore((s) => s.tab);
  const setTab = useFleetStore((s) => s.setTab);
  const designerOpen = useFleetStore((s) => s.designerOpen);
  const showPanel = useUiFlag('PANEL');
  const showTicker = useUiFlag('TICKER');
  const shown: Record<PanelTab, boolean> = {
    FLEET: useUiFlag('TAB_FLEET'),
    SECTOR: useUiFlag('TAB_SECTOR'),
    RND: useUiFlag('TAB_RND'),
    DIPLO: useUiFlag('TAB_DIPLO'),
  };
  const activeTab: PanelTab | null = shown[tab] ? tab : TABS.find((t) => shown[t.id])?.id ?? null;
  const [screen, setScreen] = useState<'title' | 'game'>('title');

  return (
    <main className="flex h-screen flex-col bg-void">
      <CommandBar />
      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative min-h-[240px] flex-1">
            <TacticalMap />
            <CRTOverlay />
          </div>
          <TutorialCard />
          {showTicker && (
            <div data-tutorial="ticker" className="h-48 shrink-0 lg:h-56">
              <EventFeed />
            </div>
          )}
        </div>
        {showPanel && (
          <aside data-tutorial="panel" className="flex h-[46vh] shrink-0 flex-col border-t border-phosphor/30 bg-panel lg:h-auto lg:w-[34rem] lg:border-l lg:border-t-0">
            <nav className="flex border-b border-navy" role="tablist">
              {TABS.filter((t) => shown[t.id]).map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  data-tutorial={`tab-${t.id.toLowerCase()}`}
                  aria-selected={activeTab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 border-r border-navy px-1 py-1.5 text-[0.8125rem] uppercase tracking-widest transition last:border-r-0 ${
                    activeTab === t.id ? 'bg-phosphor/10 text-phosphor shadow-glow' : 'text-slate-500 hover:text-phosphor'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {activeTab === 'FLEET' && <OrderOfBattle />}
              {activeTab === 'SECTOR' && <SectorPanel />}
              {activeTab === 'RND' && <RDBureauPanel />}
              {activeTab === 'DIPLO' && <DiplomacyLedger />}
            </div>
          </aside>
        )}
        <Toast />
      </div>
      {designerOpen && <ShipDesignerModal />}
      <TutorialSpotlight />
      {screen === 'title' && <TitleScreen onStart={() => setScreen('game')} />}
    </main>
  );
}

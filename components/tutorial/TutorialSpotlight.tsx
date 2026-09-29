'use client';

import { useEffect, useState } from 'react';
import { LESSONS } from '@/lib/tutorial/lessons';
import { useFleetStore } from '@/store/useFleetStore';
import { useTutorialStore } from '@/store/useTutorialStore';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Dims everything except the current lesson's `data-tutorial` anchor and pulses an outline around it.
 * Never intercepts input; honours prefers-reduced-motion via Tailwind's motion-safe variant.
 */
export default function TutorialSpotlight() {
  const lesson = useTutorialStore((s) => (s.active && !s.completing && !s.graduated && s.lessonIndex >= 0 ? LESSONS[s.lessonIndex] : undefined));
  const anchor = lesson?.anchor;
  // Lessons whose action happens on the plot (a target sector) must not dim the map: outline only.
  const dim = lesson?.target === undefined;
  const designerOpen = useFleetStore((s) => s.designerOpen);
  const uiScale = useFleetStore((s) => s.uiScale);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    if (!anchor || designerOpen) {
      setBox(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector(`[data-tutorial="${anchor}"]`);
      if (!el) return setBox((b) => (b === null ? b : null));
      const r = el.getBoundingClientRect();
      setBox((b) => (b && Math.abs(b.x - r.left) < 0.5 && Math.abs(b.y - r.top) < 0.5 && Math.abs(b.w - r.width) < 0.5 && Math.abs(b.h - r.height) < 0.5 ? b : { x: r.left, y: r.top, w: r.width, h: r.height }));
    };
    measure();
    const id = window.setInterval(measure, 250);
    window.addEventListener('resize', measure);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [anchor, designerOpen, uiScale]);

  if (!box) return null;
  const pad = 4;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-[40] border-2 border-phosphor motion-safe:animate-pulse"
      style={{ left: box.x - pad, top: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2, boxShadow: `${dim ? '0 0 0 9999px rgba(5,8,17,0.35), ' : ''}0 0 14px rgba(0,240,255,0.8)` }}
    />
  );
}

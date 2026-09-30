'use client';

/**
 * Tactical map: HiDPI 2D canvas with pan/zoom, a decoupled requestAnimationFrame loop, cached Path2D
 * vector layers (one stroke call per layer so glow stays cheap) and NATO-style unit markers.
 * The loop reads the Zustand store imperatively — React never re-renders per frame.
 */
import { useEffect, useRef, useState } from 'react';
import { fmtLat, fmtLon, geoOrigin, tileToLat, tileToLon, type GeoOrigin } from '@/lib/generator/geo';
import { ENGAGE_RANGE, IDENTIFY_RANGE } from '@/lib/sim/worldEngine';
import { tierOf, type MapData, type Polyline } from '@/lib/types/map';
import { LESSONS } from '@/lib/tutorial/lessons';
import { useFleetStore } from '@/store/useFleetStore';
import { usePreviewStore } from '@/store/usePreviewStore';
import { useTutorialStore, useUiFlag } from '@/store/useTutorialStore';
import { previewAssign } from '@/lib/sim/preview';
import { contactTag } from '@/lib/sim/contactEngine';

const C = {
  void: '#050811',
  cyan: '#00f0ff',
  amber: '#ffb000',
  red: '#ff2a2a',
  navy: '#1b314b',
  navyDeep: '#0d1e33',
  emerald: '#10b981',
};

interface Layers {
  map: MapData;
  coast: Path2D;
  borders: Path2D;
  iso: { level: number; path: Path2D; color: string; dash: number[]; width: number }[];
  land: HTMLCanvasElement;
}

interface View {
  scale: number;
  tx: number;
  ty: number;
  fit: number;
}

function toPath(lines: Polyline[]): Path2D {
  const p = new Path2D();
  for (const l of lines) {
    if (l.points.length < 2) continue;
    p.moveTo(l.points[0].x, l.points[0].y);
    for (let i = 1; i < l.points.length; i++) p.lineTo(l.points[i].x, l.points[i].y);
    if (l.closed) p.closePath();
  }
  return p;
}

const ISO_STYLE: Record<string, { color: string; dash: number[]; width: number }> = {
  '-0.15': { color: 'rgba(255,176,0,0.30)', dash: [1.2, 2.2], width: 1 },
  '-0.35': { color: 'rgba(40,86,130,0.55)', dash: [3, 3], width: 1 },
  '-0.6': { color: 'rgba(60,110,160,0.60)', dash: [7, 4], width: 1 },
  '-0.9': { color: 'rgba(27,49,75,0.9)', dash: [2, 5], width: 1 },
};

/** Static, per-map layers. Built once and reused every frame. */
function buildLayers(map: MapData): Layers {
  const land = document.createElement('canvas');
  land.width = map.width;
  land.height = map.height;
  const g = land.getContext('2d')!;
  const img = g.createImageData(map.width, map.height);
  for (let i = 0; i < map.elevation.length; i++) {
    const e = map.elevation[i];
    const o = i * 4;
    if (e > 0) {
      const shade = Math.min(1, e / 0.5);
      img.data[o] = 10 + shade * 14;
      img.data[o + 1] = 34 + shade * 26;
      img.data[o + 2] = 52 + shade * 24;
      img.data[o + 3] = 170;
    } else if (tierOf(e) === 'LITTORAL') {
      img.data[o] = 255;
      img.data[o + 1] = 176;
      img.data[o + 2] = 0;
      img.data[o + 3] = 20;
    }
  }
  g.putImageData(img, 0, 0);
  return {
    map,
    coast: toPath(map.coastlines),
    borders: toPath(map.sectorBorders),
    iso: map.isolines.map((s) => ({ level: s.level, path: toPath(s.lines), ...ISO_STYLE[String(s.level)] })),
    land,
  };
}

/** Threat / selection tint painted per water cell into a map-sized bitmap. */
function paintTint(canvas: HTMLCanvasElement, map: MapData, threats: number[], selected: number | null, hover: number | null) {
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(map.width, map.height);
  for (let i = 0; i < map.sectorGrid.length; i++) {
    const s = map.sectorGrid[i];
    if (s < 0) continue;
    const o = i * 4;
    const t = threats[s] ?? 0;
    const a = Math.max(0, Math.min(1, (t - 25) / 75)) * 0.24;
    let r = 255, gg = 42, b = 42, alpha = a;
    if (s === selected) {
      r = Math.round((r * alpha + 0 * 0.12) / Math.max(0.01, alpha + 0.12));
      gg = Math.round((gg * alpha + 240 * 0.12) / Math.max(0.01, alpha + 0.12));
      b = Math.round((b * alpha + 255 * 0.12) / Math.max(0.01, alpha + 0.12));
      alpha += 0.12;
    } else if (s === hover) {
      r = 255; gg = 176; b = 0; alpha = Math.max(alpha, 0.06);
    }
    img.data[o] = r;
    img.data[o + 1] = gg;
    img.data[o + 2] = b;
    img.data[o + 3] = Math.round(alpha * 255);
  }
  g.putImageData(img, 0, 0);
}

interface Toggles {
  grid: boolean;
  bathy: boolean;
  sectors: boolean;
  threat: boolean;
}

export default function TacticalMap() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const togglesRef = useRef<Toggles>({ grid: true, bathy: true, sectors: true, threat: true });
  const [toggles, setToggles] = useState<Toggles>(togglesRef.current);
  const showLayers = useUiFlag('LAYERS');
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let dpr = 1;
    let cw = 0;
    let ch = 0;
    const view: View = { scale: 1, tx: 0, ty: 0, fit: 1 };
    let userMoved = false;
    let layers: Layers | null = null;
    let origin: GeoOrigin = { lat0: 0, lon0: 0 };
    const tint = document.createElement('canvas');
    let tintSig = '';
    // Static vector layers (grid, isolines, glowing coast, sector borders) are cached and only redrawn on view change.
    const vec = document.createElement('canvas');
    const vctx = vec.getContext('2d')!;
    let vecSig = '';
    const cursor = { x: -1, y: -1, inside: false };
    const display = new Map<string, { x: number; y: number; h: number }>();
    let raf = 0;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let ui = 1;
    let fontFamily = 'monospace';
    let frames = 0;
    let fpsStamp = performance.now();

    const fitView = () => {
      if (!layers) return;
      const { width, height } = layers.map;
      // Leave room for the (rem-sized, tutorial-gated) toolbar overlay plus the longitude labels drawn above the frame.
      const top = (overlayRef.current?.offsetHeight ?? 36) + 26;
      view.fit = Math.min(cw / (width + 6), (ch - top) / (height + 6));
      view.scale = view.fit;
      view.tx = (cw - width * view.scale) / 2;
      view.ty = top + (ch - top - height * view.scale) / 2;
      userMoved = false;
    };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cw = wrap.clientWidth;
      ch = wrap.clientHeight;
      canvas.width = Math.max(1, Math.round(cw * dpr));
      canvas.height = Math.max(1, Math.round(ch * dpr));
      if (!userMoved) fitView();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    if (overlayRef.current) ro.observe(overlayRef.current);
    resize();

    const toWorld = (sx: number, sy: number) => ({ x: (sx - view.tx) / view.scale, y: (sy - view.ty) / view.scale });
    const toScreen = (wx: number, wy: number) => ({ x: wx * view.scale + view.tx, y: wy * view.scale + view.ty });
    const sectorAt = (sx: number, sy: number): number => {
      if (!layers) return -1;
      const w = toWorld(sx, sy);
      const x = Math.round(w.x);
      const y = Math.round(w.y);
      const m = layers.map;
      return x < 0 || y < 0 || x >= m.width || y >= m.height ? -1 : m.sectorGrid[y * m.width + x];
    };

    // ------------------------------------------------------------------ interaction
    let drag: { x: number; y: number; moved: number } | null = null;
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.offsetX, y: e.offsetY, moved: 0 };
    };
    // With a task force selected, hovering a sector previews the right-click order.
    let previewKey = '';
    const mapPreview = (sector: number) => {
      const tfId = useFleetStore.getState().selectedTaskForceId;
      const key = `${tfId}|${sector}`;
      if (key === previewKey) return;
      previewKey = key;
      if (tfId && sector >= 0) usePreviewStore.getState().show((w) => `Right-click: ${previewAssign(w, tfId, sector)}`, 'map');
      else usePreviewStore.getState().clear('map');
    };
    const onMove = (e: PointerEvent) => {
      cursor.x = e.offsetX;
      cursor.y = e.offsetY;
      cursor.inside = true;
      if (!drag) mapPreview(sectorAt(e.offsetX, e.offsetY));
      if (drag) {
        const dx = e.offsetX - drag.x;
        const dy = e.offsetY - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.moved > 4) {
          view.tx += dx;
          view.ty += dy;
          userMoved = true;
        }
        drag.x = e.offsetX;
        drag.y = e.offsetY;
      }
    };
    const onUp = (e: PointerEvent) => {
      const wasClick = drag && drag.moved <= 4;
      drag = null;
      if (!wasClick) return;
      const st = useFleetStore.getState();
      // Contacts first (they sit on top of task forces when close), then task forces, then sectors.
      let contactHit: string | null = null;
      let contactBest = 12;
      for (const c of st.contacts) {
        const p = toScreen(c.position.x, c.position.y);
        const dd = Math.hypot(p.x - e.offsetX, p.y - e.offsetY);
        if (dd < contactBest) {
          contactBest = dd;
          contactHit = c.id;
        }
      }
      if (contactHit) {
        st.selectContact(contactHit);
        return;
      }
      // Task force hit-test (screen space, 14px).
      let hit: string | null = null;
      let best = 14;
      for (const tf of st.fleets.flatMap((f) => f.taskForces)) {
        const d = display.get(tf.id) ?? { x: tf.position.x, y: tf.position.y };
        const p = toScreen(d.x, d.y);
        const dist = Math.hypot(p.x - e.offsetX, p.y - e.offsetY);
        if (dist < best) {
          best = dist;
          hit = tf.id;
        }
      }
      if (hit) {
        st.selectTaskForce(hit);
        return;
      }
      const s = sectorAt(e.offsetX, e.offsetY);
      if (s >= 0) st.selectSector(s);
      else st.selectSector(null);
    };
    const onLeave = () => {
      cursor.inside = false;
      mapPreview(-1);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      const next = Math.max(view.fit * 0.8, Math.min(view.fit * 14, view.scale * factor));
      const k = next / view.scale;
      view.tx = e.offsetX - (e.offsetX - view.tx) * k;
      view.ty = e.offsetY - (e.offsetY - view.ty) * k;
      view.scale = next;
      userMoved = true;
    };
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      const st = useFleetStore.getState();
      const rect = canvas.getBoundingClientRect();
      const s = sectorAt(e.clientX - rect.left, e.clientY - rect.top);
      if (s >= 0 && st.selectedTaskForceId) st.assignTaskForce(st.selectedTaskForceId, s);
    };
    const onDbl = () => fitView();
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContext);
    canvas.addEventListener('dblclick', onDbl);

    // ------------------------------------------------------------------ drawing helpers
    const drawGrid = (g: CanvasRenderingContext2D) => {
      const m = layers!.map;
      const stepMinor = view.scale > 5 ? 5 : 10;
      g.save();
      g.transform(view.scale, 0, 0, view.scale, view.tx, view.ty);
      g.lineWidth = 1 / view.scale;
      g.strokeStyle = C.navyDeep;
      g.beginPath();
      for (let x = 0; x <= m.width; x += stepMinor) {
        if (x % 40 === 0) continue;
        g.moveTo(x, 0);
        g.lineTo(x, m.height);
      }
      for (let y = 0; y <= m.height; y += stepMinor) {
        if (y % 40 === 0) continue;
        g.moveTo(0, y);
        g.lineTo(m.width, y);
      }
      g.stroke();
      g.strokeStyle = C.navy;
      g.beginPath();
      for (let x = 0; x <= m.width; x += 40) {
        g.moveTo(x, 0);
        g.lineTo(x, m.height);
      }
      for (let y = 0; y <= m.height; y += 40) {
        g.moveTo(0, y);
        g.lineTo(m.width, y);
      }
      g.stroke();
      g.strokeStyle = 'rgba(0,240,255,0.35)';
      g.lineWidth = 1.5 / view.scale;
      g.strokeRect(0, 0, m.width, m.height);
      g.restore();

      // Latitude / longitude markings in screen space along the frame.
      g.fillStyle = 'rgba(0,240,255,0.55)';
      g.font = `${12 * ui}px ${fontFamily}`;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      const left = toScreen(0, 0);
      // Start below the top edge: the corner belongs to the longitude row.
      for (let y = 20; y <= m.height; y += 20) {
        const p = toScreen(0, y);
        g.fillText(fmtLat(tileToLat(origin, y)), Math.max(2, left.x + 3), p.y - 6);
        g.fillRect(Math.max(0, left.x - 4), p.y, 5, 1);
      }
      g.textAlign = 'center';
      g.textBaseline = 'top';
      for (let x = 0; x <= m.width; x += 40) {
        const p = toScreen(x, 0);
        g.fillText(fmtLon(tileToLon(origin, x)), p.x, Math.max(2, left.y - 12));
      }
    };

    const glowStroke = (g: CanvasRenderingContext2D, path: Path2D, color: string, width: number, blur: number, alpha = 1) => {
      g.save();
      g.transform(view.scale, 0, 0, view.scale, view.tx, view.ty);
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.globalCompositeOperation = 'lighter';
      g.shadowColor = color;
      g.shadowBlur = blur * dpr;
      g.strokeStyle = color;
      g.globalAlpha = 0.5 * alpha;
      g.lineWidth = (width * 2.2) / view.scale;
      g.stroke(path);
      g.globalAlpha = alpha;
      g.shadowBlur = blur * 0.5 * dpr;
      g.lineWidth = width / view.scale;
      g.stroke(path);
      g.restore();
    };

    const chevron = (x: number, y: number, heading: number, size: number, color: string, filled: boolean) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(heading);
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.8, -size * 0.75);
      ctx.lineTo(-size * 0.35, 0);
      ctx.lineTo(-size * 0.8, size * 0.75);
      ctx.closePath();
      ctx.shadowColor = color;
      ctx.shadowBlur = 8 * dpr;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      if (filled) {
        ctx.fillStyle = color + '55';
        ctx.fill();
      }
      ctx.stroke();
      ctx.restore();
    };

    const diamond = (x: number, y: number, r: number, color: string, cross = false) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.shadowColor = color;
      ctx.shadowBlur = 8 * dpr;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      if (cross) {
        ctx.moveTo(-r * 0.5, -r * 0.5);
        ctx.lineTo(r * 0.5, r * 0.5);
        ctx.moveTo(r * 0.5, -r * 0.5);
        ctx.lineTo(-r * 0.5, r * 0.5);
      }
      ctx.stroke();
      ctx.restore();
    };

    const label = (text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left', size = 10) => {
      ctx.font = `${Math.round(size * 1.45 * ui)}px ${fontFamily}`;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };

    // ------------------------------------------------------------------ frame
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const st = useFleetStore.getState();
      ui = st.uiScale;
      fontFamily = getComputedStyle(document.body).fontFamily || 'monospace';
      if (!layers || layers.map !== st.map) {
        layers = buildLayers(st.map);
        origin = geoOrigin(st.map.seed);
        tint.width = st.map.width;
        tint.height = st.map.height;
        tintSig = '';
        fitView();
      }
      const map = layers.map;
      const tg = togglesRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.fillStyle = C.void;
      ctx.fillRect(0, 0, cw, ch);

      // Land + littoral hazard bitmap, then threat / selection tint.
      const hover = cursor.inside && !drag ? sectorAt(cursor.x, cursor.y) : -1;
      const threats = map.sectors.map((s) => st.sectors[s.id]?.threat ?? 0);
      const sig = `${tg.threat}|${st.selectedSectorId}|${hover}|${threats.map((t) => Math.round(t / 4)).join(',')}`;
      if (sig !== tintSig) {
        paintTint(tint, map, tg.threat ? threats : threats.map(() => 0), st.selectedSectorId, hover >= 0 ? hover : null);
        tintSig = sig;
      }
      ctx.save();
      ctx.transform(view.scale, 0, 0, view.scale, view.tx, view.ty);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(layers.land, -0.5, -0.5, map.width, map.height);
      ctx.drawImage(tint, -0.5, -0.5, map.width, map.height);
      ctx.restore();

      const vsig = `${ui}|${map.stats.fingerprint}|${view.scale.toFixed(4)}|${view.tx.toFixed(1)}|${view.ty.toFixed(1)}|${cw}|${ch}|${dpr}|${tg.grid}|${tg.bathy}|${tg.sectors}`;
      if (vsig !== vecSig) {
        vecSig = vsig;
        if (vec.width !== canvas.width || vec.height !== canvas.height) {
          vec.width = canvas.width;
          vec.height = canvas.height;
        }
        vctx.setTransform(1, 0, 0, 1, 0, 0);
        vctx.clearRect(0, 0, vec.width, vec.height);
        vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (tg.grid) drawGrid(vctx);
        if (tg.bathy) {
          vctx.save();
          vctx.transform(view.scale, 0, 0, view.scale, view.tx, view.ty);
          for (const iso of layers.iso) {
            vctx.strokeStyle = iso.color;
            vctx.lineWidth = iso.width / view.scale;
            vctx.setLineDash(iso.dash.map((d) => d / view.scale));
            vctx.stroke(iso.path);
          }
          vctx.restore();
        }
        // Coastlines: glowing electric-phosphor cyan.
        glowStroke(vctx, layers.coast, C.cyan, 1.5, 6);
        if (tg.sectors) {
          vctx.save();
          vctx.transform(view.scale, 0, 0, view.scale, view.tx, view.ty);
          vctx.strokeStyle = 'rgba(0,240,255,0.42)';
          vctx.lineWidth = 1 / view.scale;
          vctx.setLineDash([5 / view.scale, 4 / view.scale]);
          vctx.stroke(layers.borders);
          vctx.restore();
        }
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(vec, 0, 0);
      ctx.restore();

      // Sector labels.
      if (tg.sectors) {
        for (const s of map.sectors) {
          const p = toScreen(s.anchor.x, s.anchor.y);
          const sel = st.selectedSectorId === s.id;
          const thr = st.sectors[s.id]?.threat ?? 0;
          const col = sel ? C.cyan : thr > 60 ? 'rgba(255,42,42,0.9)' : 'rgba(0,240,255,0.55)';
          label(`S${s.id + 1}`, p.x, p.y - 7, col, 'center', sel ? 12 : 10);
          if (view.scale > view.fit * 1.6 || sel) label(s.label, p.x, p.y + 5, col, 'center', 9);
          if (view.scale > view.fit * 1.6) label(`THR ${thr.toFixed(0)}`, p.x, p.y + 16, thr > 60 ? C.red : C.emerald, 'center', 9);
        }
      }

      // Chokepoints.
      for (const c of map.chokepoints) {
        const p = toScreen(c.position.x, c.position.y);
        const r = Math.max(6, 3 * view.scale);
        ctx.save();
        ctx.strokeStyle = C.amber;
        ctx.shadowColor = C.amber;
        ctx.shadowBlur = 6 * dpr;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(p.x - r - 3, p.y);
        ctx.lineTo(p.x - r + 4, p.y);
        ctx.moveTo(p.x + r + 3, p.y);
        ctx.lineTo(p.x + r - 4, p.y);
        ctx.moveTo(p.x, p.y - r - 3);
        ctx.lineTo(p.x, p.y - r + 4);
        ctx.moveTo(p.x, p.y + r + 3);
        ctx.lineTo(p.x, p.y + r - 4);
        ctx.stroke();
        ctx.restore();
        if (view.scale > view.fit * 1.2) label(`${c.name} · ${c.widthTiles}T`, p.x, p.y - r - 9, C.amber, 'center', 9);
      }

      // Briefing objective: pulsing ring on the target sector.
      {
        const tut = useTutorialStore.getState();
        const target = tut.active && !tut.completing && !tut.graduated && tut.lessonIndex >= 0 ? LESSONS[tut.lessonIndex].target : undefined;
        if (target !== undefined && map.sectors[target]) {
          const a = map.sectors[target].anchor;
          const p = toScreen(a.x, a.y);
          const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 300);
          ctx.save();
          ctx.strokeStyle = C.amber;
          ctx.shadowColor = C.amber;
          ctx.shadowBlur = 10 * dpr;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          const r = 24 + 8 * pulse;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
          // Upper-right of the ring: clear of the sector id / name (centred on the anchor), task-force labels (below it),
          // the home-port stack (above it) and the latitude scale on the left frame edge.
          label('OBJECTIVE', p.x + 34, p.y - 34, C.amber, 'left', 11);
        }
      }

      // Home port.
      {
        const p = toScreen(map.homePort.x, map.homePort.y);
        ctx.save();
        ctx.strokeStyle = C.cyan;
        ctx.shadowColor = C.cyan;
        ctx.shadowBlur = 6 * dpr;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x - 5, p.y - 5, 10, 10);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 3);
        ctx.lineTo(p.x, p.y + 4);
        ctx.moveTo(p.x - 3, p.y);
        ctx.lineTo(p.x + 3, p.y);
        ctx.stroke();
        ctx.restore();
        label('HOME PORT', p.x + 10, p.y, 'rgba(0,240,255,0.8)', 'left', 9);
      }

      // Contacts: amber = unidentified (blinking until hailed), red = hostile, green = identified neutral. Click to open the ladder.
      const blink = Math.floor(now / 500) % 2 === 0;
      for (const c of st.contacts) {
        const p = toScreen(c.position.x, c.position.y);
        const tag = contactTag(c);
        if (c.cls === 'UNKNOWN') {
          if (blink || c.hailed) diamond(p.x, p.y, 6, C.amber, !!c.suspicious);
          label(tag, p.x + 9, p.y - 7, C.amber, 'left', 8);
          if (c.fleeing) {
            ctx.strokeStyle = C.amber;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + Math.cos(c.heading) * 18, p.y + Math.sin(c.heading) * 18);
            ctx.stroke();
          }
        } else if (c.cls === 'HOSTILE') {
          diamond(p.x, p.y, 7, C.red, true);
          ctx.strokeStyle = C.red;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + Math.cos(c.heading) * 20, p.y + Math.sin(c.heading) * 20);
          ctx.stroke();
          label(tag, p.x + 10, p.y - 8, C.red, 'left', 8);
        } else {
          ctx.strokeStyle = 'rgba(16,185,129,0.85)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
          ctx.stroke();
          label(tag, p.x + 7, p.y - 6, 'rgba(16,185,129,0.8)', 'left', 8);
        }
        if (c.order) label(c.order === 'SHADOW' ? 'HOLD' : c.order, p.x + 9, p.y + 6, C.cyan, 'left', 8);
        if (st.selectedContactId === c.id) {
          ctx.save();
          ctx.strokeStyle = C.cyan;
          ctx.shadowColor = C.cyan;
          ctx.shadowBlur = 6 * dpr;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Task forces (eased display positions so 16x speed still reads smoothly).
      for (const tf of st.fleets.flatMap((f) => f.taskForces)) {
        let d = display.get(tf.id);
        if (!d) {
          d = { x: tf.position.x, y: tf.position.y, h: tf.heading };
          display.set(tf.id, d);
        }
        d.x += (tf.position.x - d.x) * 0.12;
        d.y += (tf.position.y - d.y) * 0.12;
        let dh = tf.heading - d.h;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        d.h += dh * 0.15;
        const p = toScreen(d.x, d.y);
        const sel = st.selectedTaskForceId === tf.id;

        // Planned route.
        if (tf.route.length) {
          ctx.save();
          ctx.strokeStyle = 'rgba(0,240,255,0.45)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          for (const wp of tf.route) {
            const q = toScreen(wp.x, wp.y);
            ctx.lineTo(q.x, q.y);
          }
          ctx.stroke();
          ctx.restore();
        }
        if (sel) {
          for (const [range, dash] of [[IDENTIFY_RANGE, [2, 4]], [ENGAGE_RANGE, [6, 4]]] as const) {
            ctx.save();
            ctx.strokeStyle = 'rgba(0,240,255,0.35)';
            ctx.setLineDash([...dash]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, range * view.scale, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
        }
        // Heading / velocity vector.
        const moving = tf.route.length > 0;
        ctx.save();
        ctx.strokeStyle = C.cyan;
        ctx.shadowColor = C.cyan;
        ctx.shadowBlur = 5 * dpr;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        const vec = moving ? 26 : 12;
        ctx.lineTo(p.x + Math.cos(d.h) * vec, p.y + Math.sin(d.h) * vec);
        ctx.stroke();
        ctx.restore();
        chevron(p.x, p.y, d.h, sel ? 10 : 8, C.cyan, sel);
        const shipCount = tf.squadrons.reduce((n, s) => n + s.shipIds.length, 0);
        label(tf.name, p.x, p.y + 17, sel ? '#ffffff' : C.cyan, 'center', 10);
        label(`${shipCount} HULLS`, p.x, p.y + 28, 'rgba(0,240,255,0.6)', 'center', 8);
        // Squadron diamonds when zoomed in.
        if (view.scale > view.fit * 3) {
          tf.squadrons.forEach((sq, i) => diamond(p.x - (tf.squadrons.length - 1) * 7 + i * 14, p.y - 20, 4, C.emerald));
        }
      }

      // Cursor readout HUD.
      if (cursor.inside) {
        const w = toWorld(cursor.x, cursor.y);
        const x = Math.round(w.x);
        const y = Math.round(w.y);
        let text = `${fmtLat(tileToLat(origin, w.y), 2)}  ${fmtLon(tileToLon(origin, w.x), 2)}`;
        if (x >= 0 && y >= 0 && x < map.width && y < map.height) {
          const e = map.elevation[y * map.width + x];
          const s = map.sectorGrid[y * map.width + x];
          text += `  ${tierOf(e)}  ${e <= 0 ? `DEPTH ${(-e * 1000).toFixed(0)}m` : 'TERRAIN'}${s >= 0 ? `  S${s + 1}` : ''}`;
        }
        label(text, 10, ch - 12, 'rgba(0,240,255,0.75)', 'left', 10);
      }

      // Scale bar.
      {
        const tiles = view.scale > view.fit * 3 ? 10 : 40;
        const px = tiles * view.scale;
        const x0 = cw - 16 - px;
        const y0 = ch - 14;
        ctx.strokeStyle = 'rgba(0,240,255,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, y0 - 4);
        ctx.lineTo(x0, y0);
        ctx.lineTo(x0 + px, y0);
        ctx.lineTo(x0 + px, y0 - 4);
        ctx.stroke();
        label(`${tiles * 6} NM`, x0 + px / 2, y0 - 10, 'rgba(0,240,255,0.7)', 'center', 9);
      }

      frames++;
      if (now - fpsStamp > 1000) {
        setFps(Math.round((frames * 1000) / (now - fpsStamp)));
        frames = 0;
        fpsStamp = now;
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('dblclick', onDbl);
    };
  }, []);

  const flip = (k: keyof Toggles) => {
    togglesRef.current = { ...togglesRef.current, [k]: !togglesRef.current[k] };
    setToggles(togglesRef.current);
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-void">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full cursor-crosshair touch-none" />
      <div ref={overlayRef} className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1 font-mono text-[0.8125rem] uppercase tracking-widest">
        {<div aria-hidden={!showLayers || undefined} className={`pointer-events-auto flex gap-1 ${showLayers ? '' : 'invisible'}`}>
          {(['grid', 'bathy', 'sectors', 'threat'] as const).map((k) => (
            <button
              key={k}
              onClick={() => flip(k)}
              className={`border px-1.5 py-0.5 ${toggles[k] ? 'border-phosphor/70 bg-phosphor/10 text-phosphor shadow-glow' : 'border-navy text-slate-500'}`}
            >
              {k}
            </button>
          ))}
        </div>}
        <div className="text-phosphor/50">{fps} FPS · WHEEL ZOOM · DRAG PAN · DBL-CLICK FIT · RMB = ORDER TF TO SECTOR</div>
      </div>
    </div>
  );
}

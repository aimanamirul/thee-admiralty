/**
 * WebAudio synthesis of the bridge's sounds: no sample files. Browser-only; every call is a no-op when audio is unavailable.
 */
import type { CueKind } from './cues';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(c: AudioContext, at: number, freq: number, dur: number, type: OscillatorType, gain: number, endFreq?: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.05);
}

function noise(c: AudioContext, at: number, dur: number, gain: number, lowpass: number) {
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(at);
}

export function playCue(kind: CueKind, volume = 0.5): void {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + 0.02;
  const v = Math.max(0, Math.min(1, volume));
  switch (kind) {
    case 'TELETYPE':
      for (let i = 0; i < 6; i++) noise(c, t + i * 0.055 + (i % 3) * 0.01, 0.025, 0.5 * v, 3000);
      break;
    case 'SONAR':
      tone(c, t, 1250, 1.1, 'sine', 0.22 * v);
      tone(c, t + 0.45, 1250, 0.9, 'sine', 0.07 * v);
      break;
    case 'ALERT':
      tone(c, t, 880, 0.12, 'square', 0.09 * v);
      tone(c, t + 0.18, 880, 0.12, 'square', 0.09 * v);
      break;
    case 'ALARM':
      for (let i = 0; i < 3; i++) {
        tone(c, t + i * 0.5, 740, 0.22, 'sawtooth', 0.12 * v);
        tone(c, t + i * 0.5 + 0.25, 520, 0.22, 'sawtooth', 0.12 * v);
      }
      break;
    case 'BATTLE':
      noise(c, t, 0.7, 0.9 * v, 400);
      tone(c, t, 70, 0.6, 'sine', 0.3 * v, 38);
      break;
    case 'LOSS':
      tone(c, t, 196, 2.2, 'sine', 0.22 * v, 130);
      tone(c, t + 0.1, 294, 2.0, 'sine', 0.1 * v, 196);
      noise(c, t, 1.0, 0.5 * v, 300);
      break;
  }
}

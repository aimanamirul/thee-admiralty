/**
 * Which diegetic sound a batch of ledger events should trigger. Pure and testable; the synth in synth.ts only plays what this returns.
 * Quiet by design: routine INFO lines make no sound, a batch yields at most two cues, and the story lines of a battle report are silent.
 */
import type { EventSeverity } from '../types/world';

export type CueKind = 'LOSS' | 'ALARM' | 'BATTLE' | 'ALERT' | 'SONAR' | 'TELETYPE';

/** Most urgent first. */
export const CUE_PRIORITY: CueKind[] = ['LOSS', 'ALARM', 'BATTLE', 'ALERT', 'SONAR', 'TELETYPE'];
export const MAX_CUES = 2;

const CONTACT_WORDS = /\b(DISTRESS|RAIDER|HOSTILE|CONTACT|DETECTED|SHADOW|SURFACED|SIGHTED)\b/;

export function cueOf(e: { severity: EventSeverity; text: string }): CueKind | null {
  if (e.text.startsWith('  ')) return null; // technical and story lines under an engagement header
  if (e.text.startsWith('LOST:')) return 'LOSS';
  if (e.severity === 'CRITICAL') return 'ALARM';
  if (e.severity === 'COMBAT') return e.text.startsWith('ENGAGEMENT') ? 'BATTLE' : null;
  if (e.severity === 'WARNING') return CONTACT_WORDS.test(e.text.toUpperCase()) ? 'SONAR' : 'ALERT';
  if (e.severity === 'ADVISORY') return CONTACT_WORDS.test(e.text.toUpperCase()) ? 'SONAR' : 'TELETYPE';
  return null;
}

export function cuesFor(events: readonly { severity: EventSeverity; text: string }[]): CueKind[] {
  const seen = new Set<CueKind>();
  for (const e of events) {
    const c = cueOf(e);
    if (c) seen.add(c);
  }
  return CUE_PRIORITY.filter((c) => seen.has(c)).slice(0, MAX_CUES);
}

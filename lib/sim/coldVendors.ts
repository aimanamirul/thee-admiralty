/**
 * Cold vendors (docs/PLAN-foreign-contractors.md §9-10 phase 5): suppliers that exist but cannot be approached until a gate opens.
 * Each gate is foreshadowed or player-driven, never a blindside:
 *
 * - C1 Mitsurugi (Akitsu): closed by law. A parliamentary debate on arms-transfer reform is announced with a vote date; an incident
 *   by the navy before the vote sinks it (the debate can come round again). Good domestic support and regional tension make a
 *   debate likelier, a recent incident much less likely. Passing makes Mitsurugi a contact.
 * - C2 Dahai: only deals with navies the Eastern bloc vouches for. Zvezda-Nord introduces it at standing 70 on a Signed or better
 *   relationship (player-driven via lobbying). Courting it then costs western standing (soft bloc affinity, relationsEngine).
 * - C3 Vayu-Sarath (JV): an export drive opens on a seeded day, announced in advance; from then scouting can find it. Its products
 *   carry the Eastern parent's components publicly (Vendor.jvPartners), so either state's sanction reaches them.
 */
import { ct, vt } from '../data/tokens';
import type { Rng } from '../generator/prng';
import { rungIndex, type Vendor } from '../types/diplomacy';
import type { WorldDraft } from '../types/world';

export const POLICY_DEBATE_DAYS = 30;
export const POLICY_BASE_CHANCE = 0.004;
export const DAHAI_INTRO_STANDING = 70;
export const EXPORT_DRIVE_NOTICE = 30;
/** An incident this recent makes Akitsu's parliament shelve reform. */
export const INCIDENT_MEMORY_DAYS = 180;

/** Seeded day Bharatvar opens its export drive (days 200-399). */
export function exportDriveDay(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return 200 + ((h >>> 0) % 200);
}

/** Daily chance that Akitsu's parliament takes up arms-transfer reform. */
export function policyDebateChance(w: Pick<WorldDraft, 'politics' | 'tension' | 'stats' | 'tick'>): number {
  const recent = w.stats.lastIncidentTick !== undefined && w.tick - w.stats.lastIncidentTick < INCIDENT_MEMORY_DAYS;
  return POLICY_BASE_CHANCE * (w.politics.support >= 50 ? 1.5 : 1) * (w.tension >= 60 ? 1.5 : 1) * (recent ? 0.25 : 1);
}

export function dahaiIntroReady(w: Pick<WorldDraft, 'vendors'>): boolean {
  const zv = w.vendors.ZVEZDA_NORD;
  return zv.standing >= DAHAI_INTRO_STANDING && rungIndex(zv.rung) >= rungIndex('SIGNED') && zv.status !== 'REVOKED';
}

function openAsContact(w: WorldDraft, v: Vendor, text: string) {
  v.closed = false;
  v.opening = null;
  v.rung = 'CONTACT';
  w.events.push({ severity: 'ADVISORY', text: `${text}; catalogue now visible` });
}

export function tickColdVendors(w: WorldDraft, rng: Rng): void {
  if (w.scripted) return;

  const mh = w.vendors.MITSURUGI;
  if (mh?.closed) {
    if (!mh.opening) {
      if (rng.chance(policyDebateChance(w))) {
        mh.opening = { announcedTick: w.tick, tick: w.tick + POLICY_DEBATE_DAYS, incidentsAtAnnounce: w.stats.incidents };
        w.events.push({
          severity: 'ADVISORY',
          text: `${ct(mh.id)}: parliament debates loosening arms-transfer rules — vote on day ${mh.opening.tick}. An incident by your navy before then would sink it`,
        });
      }
    } else if (w.tick >= mh.opening.tick) {
      if (w.stats.incidents > mh.opening.incidentsAtAnnounce) {
        mh.opening = null;
        w.events.push({ severity: 'WARNING', text: `${ct(mh.id)}: arms-transfer reform voted down after your navy's incident` });
      } else {
        openAsContact(w, mh, `${ct(mh.id)}: arms-transfer reform passed — ${vt(mh.id)} may now export to us`);
      }
    }
  }

  const dh = w.vendors.DAHAI;
  if (dh?.closed && dahaiIntroReady(w)) {
    openAsContact(w, dh, `${vt('ZVEZDA_NORD')} introduces ${vt(dh.id)} (${ct(dh.id)})`);
  }

  const vs = w.vendors.VAYU_SARATH;
  if (vs?.closed) {
    const day = exportDriveDay(w.seed);
    if (!vs.opening && w.tick >= day - EXPORT_DRIVE_NOTICE) {
      vs.opening = { announcedTick: w.tick, tick: day, incidentsAtAnnounce: w.stats.incidents };
      w.events.push({ severity: 'ADVISORY', text: `TRADE FAIR: a joint-venture missile house announces an export drive from day ${day} — scout then to find it` });
    }
    if (vs.opening && w.tick >= vs.opening.tick) {
      vs.closed = false;
      vs.opening = null;
      w.events.push({ severity: 'ADVISORY', text: 'TRADE FAIR: the joint-venture export drive is open — a new supplier can be found by scouting' });
    }
  }
}

/** What the navy can see of cold-vendor gates (for the Diplomacy market-watch line). Never names a vendor still hidden. */
export function marketWatch(w: WorldDraft): string[] {
  const out: string[] = [];
  const mh = w.vendors.MITSURUGI;
  if (mh?.closed && mh.opening) out.push(`${ct(mh.id)} arms-transfer vote on day ${mh.opening.tick}: avoid incidents until then`);
  const dh = w.vendors.DAHAI;
  if (dh?.closed) out.push(`${vt('ZVEZDA_NORD')} would introduce an Eastern shipbuilder at standing ${DAHAI_INTRO_STANDING} (now ${w.vendors.ZVEZDA_NORD.standing.toFixed(0)})`);
  const vs = w.vendors.VAYU_SARATH;
  if (vs?.closed && vs.opening) out.push(`joint-venture export drive opens day ${vs.opening.tick}`);
  return out;
}

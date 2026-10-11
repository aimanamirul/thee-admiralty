/**
 * The "Action required" queue and auto-pause (lib/sim/actions.ts): which situations become items, which are critical, ordering, no
 * intent leak, purity, and how often a long run would stop the clock. Usage: npm run verify:actions
 */
import { actionItems, CRITICAL_KINDS, DEFAULT_PAUSE_KINDS, freshPause } from '../lib/sim/actions';
import { INTENT_LABEL } from '../lib/sim/contactEngine';
import { allTaskForces } from '../lib/sim/fleetEngine';
import { createInitialWorld } from '../lib/sim/scenario';
import { advanceDay } from '../lib/sim/worldEngine';
import type { Contact, WorldDraft } from '../lib/types/world';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};
const copyOf = (w: WorldDraft) => ({ ...structuredClone({ ...w, map: undefined }), map: w.map }) as WorldDraft;
const BASE = createInitialWorld('ACT-BASE', 'CORRIDOR');
for (let d = 0; d < 20 && BASE.shipping.ships.length === 0; d++) advanceDay(BASE); // lane traffic sails from day one or two
const contact = (w: WorldDraft, over: Partial<Contact> = {}): Contact => {
  const tf = allTaskForces(w.fleets)[0];
  return { id: `CT-A-${Math.random().toString(36).slice(2, 7)}`, sectorId: 0, position: { ...tf.position }, heading: 0, cls: 'UNKNOWN', hostile: true, intent: 'RAIDER', strength: 40, bornTick: w.tick, expiresTick: 1e9, ...over };
};

// ---- purity and a quiet start
{
  const w = copyOf(BASE);
  const before = JSON.stringify({ ...w, map: undefined });
  const items = actionItems(w);
  check(JSON.stringify({ ...w, map: undefined }) === before, 'actionItems does not change the world');
  check(!items.some((i) => i.critical), 'the theatre opens with no critical decision');
  check(DEFAULT_PAUSE_KINDS.every((k) => CRITICAL_KINDS.includes(k)), 'every default pause kind is critical');
}

// ---- distress: critical, first, with the days left
{
  const w = copyOf(BASE);
  const m = w.shipping.ships[0];
  check(!!m, 'the base theatre has lane traffic');
  if (m) {
    m.status = 'DISTRESS';
    m.distressUntil = w.tick + 2;
    const items = actionItems(w);
    const d = items.find((i) => i.kind === 'DISTRESS');
    check(!!d && d.critical && d.target.type === 'merchant' && d.text.includes('2 d'), 'a distress call is a critical item on the merchant, with days left');
    check(items[0]?.kind === 'DISTRESS', 'the distress call sorts first');
  }
}

// ---- submarines: held without orders asks, with orders it does not; a datum never does
{
  const w = copyOf(BASE);
  const sub = contact(w, { submerged: true, track: 80, intent: 'SUBMARINE' as Contact['intent'] });
  const datum = contact(w, { submerged: true, track: 40, intent: 'SUBMARINE' as Contact['intent'] });
  w.contacts = [sub, datum];
  let items = actionItems(w);
  check(items.filter((i) => i.kind === 'SUB_HELD').length === 1 && items.some((i) => i.id === `SUB_HELD:${sub.id}`), 'a held submarine without orders is an item; a datum is not');
  sub.order = 'SHADOW';
  items = actionItems(w);
  check(!items.some((i) => i.kind === 'SUB_HELD'), 'giving it an order clears the item');
}

// ---- MOC closing track and hostile track; no hidden intent in any text
{
  const w = copyOf(BASE);
  const closing = contact(w, { mocAlert: 2 });
  const hostile = contact(w, { cls: 'HOSTILE' });
  w.contacts = [closing, hostile];
  const items = actionItems(w);
  check(items.some((i) => i.kind === 'MOC_CLOSING' && i.critical), 'an unidentified track closing on shipping is critical');
  check(items.some((i) => i.kind === 'HOSTILE' && !i.critical), 'a hostile track is listed, not critical');
  const labels = Object.values(INTENT_LABEL);
  check(!items.filter((i) => i.target.type === 'contact').some((i) => labels.some((l) => i.text.toUpperCase().includes(l))), 'no item text names a contact intent');
  closing.order = 'HAIL';
  check(!actionItems(w).some((i) => i.kind === 'MOC_CLOSING'), 'ordering the closing track clears it');
}

// ---- sanction warning
{
  const w = copyOf(BASE);
  const v = Object.values(w.vendors)[0];
  v.status = 'WARNING';
  v.statusUntilTick = w.tick + 12;
  const s = actionItems(w).find((i) => i.kind === 'SANCTION');
  check(!!s && s.critical && s.target.type === 'vendor' && s.text.includes('{v:'), 'a sanction warning is critical and uses a vendor token');
}

// ---- budget
{
  const w = copyOf(BASE);
  w.resources.budget = 0;
  check(actionItems(w).some((i) => i.kind === 'BUDGET'), 'an empty treasury is flagged');
}

// ---- freshPause
{
  const w = copyOf(BASE);
  w.shipping.ships[0].status = 'DISTRESS';
  w.shipping.ships[0].distressUntil = w.tick + 3;
  w.resources.budget = 0;
  const items = actionItems(w);
  const kinds = new Set(DEFAULT_PAUSE_KINDS);
  const hit = freshPause(new Set(), items, kinds);
  check(hit?.kind === 'DISTRESS', 'a new distress call pauses');
  check(freshPause(new Set([hit!.id]), items, kinds) === null, 'a seen item does not pause again (and BUDGET never does)');
  check(freshPause(new Set(), items, new Set()) === null, 'with no kinds enabled nothing pauses');
}

// ---- soak: how often would auto-pause stop a long game?
{
  let pauses = 0;
  let days = 0;
  for (const seed of ['ACT-1', 'ACT-2', 'ACT-3']) {
    const w = createInitialWorld(seed, 'CORRIDOR');
    const seen = new Set(actionItems(w).map((i) => i.id));
    for (let d = 0; d < 240; d++) {
      advanceDay(w);
      days++;
      const items = actionItems(w);
      if (freshPause(seen, items, new Set(DEFAULT_PAUSE_KINDS))) pauses++;
      items.forEach((i) => seen.add(i.id));
    }
  }
  const per100 = (pauses / days) * 100;
  console.log(`  soak: ${pauses} auto-pauses in ${days} days (${per100.toFixed(1)} per 100 days)`);
  check(per100 < 25, 'auto-pause stops the clock less than once every four days on average');
}

if (failures) {
  console.log(`verify:actions — ${failures} failure(s)`);
  process.exit(1);
}
console.log('ACTIONS OK (queue, critical kinds, no intent leak, auto-pause, soak)');

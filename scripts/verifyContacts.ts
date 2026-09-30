/**
 * Contact ladder behaviour: each intent approaches a task force under each SOP / ROE and must respond as documented.
 * Outcomes involving dice are checked as rates over many seeds. Usage: npm run verify:contacts
 */
import * as cmd from '../lib/sim/commands';
import { actionBlocked } from '../lib/sim/contactEngine';
import { allTaskForces } from '../lib/sim/fleetEngine';
import { createInitialWorld } from '../lib/sim/scenario';
import { advanceDay } from '../lib/sim/worldEngine';
import type { Contact, ContactIntent, LadderAction, Roe, Sop, WorldDraft } from '../lib/types/world';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};

interface Trial {
  w: WorldDraft;
  c: Contact;
  log: string[];
}

/** A quiet world: TF-1 on station with every hull at sea, one contact of `intent` closing from `startDist` tiles. */
function setup(seed: string, intent: ContactIntent, sop: Sop, roe: Roe, startDist = 26, order?: LadderAction): Trial {
  const w = createInitialWorld(`contacts-${seed}`, 'CHOKEPOINT');
  w.scripted = true; // no random spawns, failures or sanction rolls
  w.contacts = [];
  const tf = allTaskForces(w.fleets).find((t) => t.id === 'TF-1')!;
  // The largest sector: room for a contact to start well outside hailing range.
  const sector = [...w.map.sectors].sort((a, b) => b.areaTiles - a.areaTiles)[0];
  tf.assignedSectorId = sector.id;
  tf.position = { ...sector.anchor };
  tf.route = [];
  tf.destination = { ...sector.anchor };
  for (const id of tf.squadrons.flatMap((s) => s.shipIds)) {
    const s = w.ships[id];
    s.state = 'ACTIVE_PATROL';
    s.stateDays = 1;
    s.readiness = 90;
  }
  const st = w.sectors[sector.id];
  st.sop = sop;
  st.roe = roe;
  st.threat = 40;
  // Water cell in the same sector at ~startDist tiles.
  let best = -1;
  let err = Infinity;
  for (let i = 0; i < w.map.sectorGrid.length; i++) {
    if (w.map.sectorGrid[i] !== sector.id) continue;
    const e = Math.abs(Math.hypot((i % w.map.width) - tf.position.x, Math.floor(i / w.map.width) - tf.position.y) - startDist);
    if (e < err) {
      err = e;
      best = i;
    }
  }
  if (err > 2) throw new Error(`setup: no water ${startDist} tiles from the task force`);
  const c: Contact = {
    id: `CT-T-${seed}`, sectorId: sector.id, position: { x: best % w.map.width, y: Math.floor(best / w.map.width) }, heading: 0,
    cls: 'UNKNOWN', hostile: intent === 'RAIDER', intent, strength: intent === 'RAIDER' ? 25 : 0, bornTick: 0, expiresTick: 60,
    pursue: 'TF-1', order: order ?? null,
  };
  w.contacts.push(c);
  return { w, c, log: [] };
}

function run(t: Trial, days = 25): Trial {
  for (let d = 0; d < days && t.w.contacts.length; d++) {
    advanceDay(t.w);
    t.log.push(...t.w.events.map((e) => e.text));
    t.w.events = [];
  }
  return t;
}
const has = (t: Trial, re: RegExp) => t.log.some((l) => re.test(l));
const rate = (n: number, f: (i: number) => boolean) => {
  let k = 0;
  for (let i = 0; i < n; i++) if (f(i)) k++;
  return k / n;
};
const N = 30;

// ---- CHALLENGE / RETURN FIRE (the free-play default)
{
  const m = run(setup('m', 'MERCHANT', 'CHALLENGE', 'RETURN_FIRE'));
  check(has(m, /answers the hail: MERCHANT/), 'challenge: merchant answers the hail');
  check(m.w.stats.incidents === 0, 'challenge: no incident with a merchant');
  const s = run(setup('s', 'SMUGGLER', 'CHALLENGE', 'RETURN_FIRE'));
  check(has(s, /NO RESPONSE/) && has(s, /runs at speed/), 'challenge: smuggler stays silent, then runs when warned');
  const sh = run(setup('sh', 'SHADOWER', 'CHALLENGE', 'RETURN_FIRE'));
  check(has(sh, /breaks contact and withdraws/), 'challenge: shadower warned off');
  const r = rate(N, (i) => {
    const t = run(setup(`r${i}`, 'RAIDER', 'CHALLENGE', 'HOLD_FIRE'));
    return has(t, /drops its cover/) && !has(t, /SURPRISED/);
  });
  check(r > 0.9, `challenge: a warned raider never keeps surprise, even under HOLD FIRE (${(r * 100).toFixed(0)}%)`);
  const w = run(setup('w', 'WARSHIP', 'CHALLENGE', 'WEAPONS_FREE'));
  check(w.w.stats.incidents === 0, 'challenge + weapons free: a hailed warship is identified, not fired on');
}

// ---- OBSERVE: visual identification only
{
  const r = rate(N, (i) => has(run(setup(`o${i}`, 'RAIDER', 'OBSERVE', 'HOLD_FIRE')), /SURPRISED/));
  check(r > 0.9, `observe + hold fire: an unwarned raider attacks with surprise (${(r * 100).toFixed(0)}%)`);
  const m = run(setup('om', 'MERCHANT', 'OBSERVE', 'WEAPONS_FREE'));
  check(m.w.stats.incidents === 1, 'observe + weapons free: an unhailed merchant is fired on (incident)');
  check(!has(run(setup('os', 'SMUGGLER', 'OBSERVE', 'RETURN_FIRE')), /hail|warn|board/i), 'observe: no hails, warnings or boardings');
}

// ---- ASSERTIVE: board silent contacts without warning
{
  const seized = rate(N, (i) => run(setup(`as${i}`, 'SMUGGLER', 'ASSERTIVE', 'RETURN_FIRE')).w.stats.seizures === 1);
  const seizedChallenge = rate(N, (i) => run(setup(`cs${i}`, 'SMUGGLER', 'CHALLENGE', 'RETURN_FIRE')).w.stats.seizures === 1);
  check(seized > 0.85, `assertive: smugglers seized before they run (${(seized * 100).toFixed(0)}%)`);
  check(seizedChallenge < seized, `challenge seizes fewer smugglers than assertive (${(seizedChallenge * 100).toFixed(0)}% vs ${(seized * 100).toFixed(0)}%)`);
  const ambush = rate(N, (i) => {
    const t = run(setup(`ar${i}`, 'RAIDER', 'ASSERTIVE', 'RETURN_FIRE'));
    return has(t, /AMBUSH/) && has(t, /SURPRISED/);
  });
  check(ambush > 0.9, `assertive: boarding a disguised raider is an ambush with surprise (${(ambush * 100).toFixed(0)}%)`);
  const w = run(setup('aw', 'WARSHIP', 'ASSERTIVE', 'RETURN_FIRE'));
  check(has(w, /protests the warning/), 'assertive: foreign warships are warned off (protest)');
}

// ---- per-contact orders and the ROE ceiling
{
  const t = setup('ord', 'MERCHANT', 'CHALLENGE', 'RETURN_FIRE');
  check(!cmd.orderContact(t.w, t.c.id, 'ENGAGE').ok, 'return fire: engaging an unidentified contact is refused');
  check(cmd.orderContact(t.w, t.c.id, 'SHADOW').ok, 'shadow order accepted');
  run(t, 3);
  check(!has(t, /answers the hail/), 'a SHADOW (hold) order suppresses the SOP hail');
  check(cmd.orderContact(t.w, t.c.id, 'AUTO').ok, 'back to SOP');
  run(t, 20);
  check(has(t, /answers the hail/), 'after AUTO the SOP resumes and hails');

  const hf = setup('hf', 'RAIDER', 'CHALLENGE', 'HOLD_FIRE');
  check(!cmd.orderContact(hf.w, hf.c.id, 'ENGAGE').ok, 'hold fire: manual engage refused');
  const wf = setup('wf', 'RAIDER', 'OBSERVE', 'WEAPONS_FREE', 26, 'ENGAGE');
  run(wf);
  check(has(wf, /ENGAGEMENT/) && !has(wf, /SURPRISED/), 'weapons free: an ordered strike on a raider gets first shot');

  const war = setup('war', 'WARSHIP', 'CHALLENGE', 'RETURN_FIRE');
  run(war, 25);
  const warC = war.w.contacts[0];
  if (warC) check(!!actionBlocked(warC, 'RETURN_FIRE', 'BOARD'), 'an identified foreign warship cannot be boarded');
  const mb = setup('mb', 'MERCHANT', 'OBSERVE', 'RETURN_FIRE', 26, 'BOARD');
  run(mb);
  check(has(mb, /clean — owners protest/), 'ordered boarding of a merchant: clean, owners protest');
}

console.log(failures === 0 ? 'CONTACTS OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

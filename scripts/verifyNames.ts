/**
 * Proves the display-name layer: every id resolves in both skins, no name token is left unresolved, and the default
 * (fictional) skin never shows a real vendor / product / protocol name - in catalogue data, lesson copy, engine events
 * and static UI source. Usage: npm run verify:names
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { INITIAL_VENDORS, MINISTRIES, MODULES, RESEARCH_PROJECTS } from '../lib/data/catalog';
import { moduleName, projectName, protocolName, realNameLiterals, resolveText, vendorCountry, vendorName, vendorShort } from '../lib/data/names';
import { PROTOCOLS } from '../lib/types/equipment';
import { GLOSSARY } from '../lib/tutorial/glossary';
import { LESSONS } from '../lib/tutorial/lessons';
import * as cmd from '../lib/sim/commands';
import { createInitialWorld } from '../lib/sim/scenario';
import { createTutorialWorld } from '../lib/sim/tutorialScenario';
import { advanceDay } from '../lib/sim/worldEngine';
import type { MapArchetype } from '../lib/types/map';

/** Whole-word match, so a short code like "DOM" does not match inside "DOMESTIC". */
const wordIn = (text: string, word: string) => new RegExp(`(^|[^A-Za-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9])`).test(text);

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};

// ---- 1. tables are complete and both skins resolve
for (const v of INITIAL_VENDORS) for (const skin of ['FICTIONAL', 'REAL'] as const) {
  check(!!vendorName(v.id, skin) && !!vendorCountry(v.id, skin) && !!vendorShort(v.id, skin), `vendor ${v.id} incomplete in ${skin}`);
}
for (const m of MODULES) check(moduleName(m.id, 'REAL').length > 0 && moduleName(m.id, 'FICTIONAL') === m.name, `module ${m.id}`);
for (const p of RESEARCH_PROJECTS) check(projectName(p.id, 'REAL').length > 0 && projectName(p.id, 'FICTIONAL') === p.name, `project ${p.id}`);
for (const p of PROTOCOLS) check(protocolName(p, 'FICTIONAL').length > 0 && protocolName(p, 'REAL').length > 0, `protocol ${p}`);
check(vendorName('RAYTHEON', 'REAL') === 'Raytheon' && vendorName('RAYTHEON', 'FICTIONAL') === 'Halberd Dynamics', 'vendor skin spot-check');
check(resolveText('{m:CMS_NG_TACTICOS} / {x:NATO_LINK16}', 'REAL') === 'Thales TACTICOS / NATO LINK-16', 'real token resolution');
check(resolveText('{m:CMS_NG_TACTICOS} / {x:NATO_LINK16}', 'FICTIONAL') === 'Meridian TACTIS / ALLIANCE LINK', 'fictional token resolution');

// ---- 2. collect every player-visible string (raw, with tokens)
const strings: { where: string; text: string }[] = [];
const add = (where: string, text: string) => strings.push({ where, text });
for (const v of INITIAL_VENDORS) add(`vendor ${v.id}`, `${v.name} ${v.country}`);
for (const m of MODULES) add(`module ${m.id}`, `${m.name} ${m.blurb}`);
for (const p of RESEARCH_PROJECTS) add(`project ${p.id}`, `${p.name} ${p.blurb}`);
for (const m of MINISTRIES) add(`ministry ${m.id}`, `${m.name} ${m.description}`);
for (const [k, t] of Object.entries(GLOSSARY)) add(`glossary ${k}`, t);
for (const l of LESSONS) add(`lesson ${l.id}`, [l.title, ...l.body, l.objective].join(' '));

// events and refusals from the engines
const collect = (label: string, events: { text: string }[]) => events.forEach((e) => add(`${label} event`, e.text));
const tw = createTutorialWorld();
for (const l of LESSONS) {
  l.onEnter?.(tw);
  collect(`lesson ${l.id}`, tw.events);
  tw.events = [];
}
for (const arch of ['CHOKEPOINT', 'CORRIDOR', 'RIMLAND'] as MapArchetype[]) {
  const w = createInitialWorld('names-check', arch);
  w.tension = 90;
  for (const tf of w.fleets.flatMap((f) => f.taskForces)) cmd.setTempo(w, tf.id, 'SURGE');
  const far = w.map.sectors[w.map.sectors.length - 1].id;
  cmd.assignTaskForce(w, 'TF-1', far);
  cmd.startResearch(w, 'BR_L16_TAC');
  for (const r of [
    cmd.buySpares(w, 'SEN_DOM_DSR2', 1),
    cmd.buySpares(w, 'SEN_RTX_SPY6', 1),
    cmd.lobbyVendorCmd(w, 'RAYTHEON', 'MIN_DEFENCE'),
    cmd.startResearch(w, 'BR_EAST_TAC'),
    cmd.orderShip(w, { designName: 'X', hullId: 'CORVETTE', moduleIds: ['PP_DOM_D12', 'CMS_NG_TACTICOS', 'SEN_ASEL_SPEAR', 'ARM_NG_SYLVER8'], squadronId: 'SQ-1-2', tradition: 'VIRTUES' }),
  ]) if (r.reason) add('command refusal', r.reason);
  collect(`${arch} commands`, w.events);
  w.events = [];
  for (let d = 0; d < 700; d++) {
    // keep sanction pressure high so freeze / embargo / revocation text is exercised
    if (d % 40 === 0) w.tension = 95;
    advanceDay(w);
    collect(`${arch} day ${w.tick}`, w.events);
    w.events = [];
  }
}
const sanctionText = strings.filter((s) => /EXPORT|EMBARGO|REVOKED|sanction/i.test(s.text)).length;
check(sanctionText > 5, `expected sanction events to be exercised (saw ${sanctionText})`);

// ---- 3. fictional skin: no real names; both skins: no unresolved tokens
const banned = realNameLiterals();
let scanned = 0;
for (const { where, text } of strings) {
  scanned++;
  for (const skin of ['FICTIONAL', 'REAL'] as const) {
    const out = resolveText(text, skin);
    check(!/\{[a-z]+:[A-Z0-9_]+\}/.test(out), `[${where}] unresolved token in ${skin}: ${out.slice(0, 80)}`);
    if (skin === 'FICTIONAL') for (const b of banned) check(!wordIn(out, b), `[${where}] real name "${b}" shown in fictional skin: ${out.slice(0, 90)}`);
  }
}

// ---- 4. static UI source: no real names in non-comment lines
const REAL_WORDS = /\b(Raytheon|Thales|Aselsan|Naval Group|TACTICOS|Aegis|ESSM|Harpoon|MK41|SPY-6|SMART-S|APAR|Sylver|MM40|Link-16|NATO|Turkish|French|Saab|Hanwha|Hensoldt|TKMS|MTU|9LV|RBS15|Mitsubishi|MHI|Mogami|OPY-2|CSSC|NORINCO|HHQ-16|BrahMos)\b/;
const skipFile = (f: string) => f.endsWith('lib/data/names.ts') || f.includes('node_modules');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e) ? [p] : [];
  });
let files = 0;
for (const f of [...walk('lib'), ...walk('components'), ...walk('store'), ...walk('app')]) {
  if (skipFile(f)) continue;
  files++;
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    check(!REAL_WORDS.test(line), `${f}:${i + 1} real name in source: ${line.trim().slice(0, 100)}`);
  });
}

console.log(`checked ${scanned} strings and ${files} source files against ${banned.length} real-name literals`);
console.log(failures === 0 ? '\nNAMES OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

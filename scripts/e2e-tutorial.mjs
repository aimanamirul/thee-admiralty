/**
 * Browser walk-through of the Admiral's Briefing through the real UI (title screen -> graduation).
 * Not part of `npm test`: needs `playwright-core` (npm i --no-save playwright-core), a Chromium
 * (set CHROMIUM_PATH, default /opt/pw-browsers/chromium) and a running server:
 *   npx next build && npx next start -p 3111 &
 *   node scripts/e2e-tutorial.mjs [outDir]      # screenshots per lesson, exits non-zero on console errors
 */
import { chromium } from 'playwright-core';
const SP = process.argv[2] ?? './e2e-out';
import { mkdirSync } from 'node:fs';
mkdirSync(SP, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('http://localhost:3111', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SP}/t00-title.png` });
await page.getByRole('button', { name: /Begin briefing/i }).click();
await page.waitForTimeout(800);

const lessonNo = async () => {
  const t = await page.locator('[data-testid=tutorial-card]').innerText().catch(() => '');
  const m = t.match(/BRIEFING (\d+)\/12/i);
  return m ? Number(m[1]) : t.includes('BRIEFING COMPLETE') ? 13 : 0;
};
const waitLesson = async (n, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if ((await lessonNo()) >= n) return; await page.waitForTimeout(150); }
  throw new Error(`stuck: expected lesson ${n}, on ${await lessonNo()}`);
};
let canvas = await page.locator('canvas').boundingBox();
const at = (fx, fy) => [canvas.x + canvas.width * fx, canvas.y + canvas.height * fy];
const shot = (n) => page.screenshot({ path: `${SP}/t${n}.png` });

console.log('L1 start', await lessonNo());
await shot('01-plot');
await page.mouse.click(...at(0.25, 0.6));
await waitLesson(2); await shot('02-roe');
await page.getByRole('button', { name: 'Return fire' }).click();
await waitLesson(3); await shot('03-station');
await page.getByText('TF 11', { exact: true }).first().click();
await page.mouse.click(...at(0.25, 0.6), { button: 'right' });
await page.getByRole('button', { name: '4x' }).click();
await page.getByRole('button', { name: 'Run' }).click();
await waitLesson(4); await shot('04-command');
// reload mid-briefing: the title screen offers to resume at the same lesson with the fleet where it was
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /Resume briefing/i }).click();
await page.waitForTimeout(800);
if ((await lessonNo()) !== 4) errors.push(`resume: expected lesson 4, got ${await lessonNo()}`);
if (!/ordered to SECTOR 1/i.test(await page.locator('ul[aria-live]').innerText())) errors.push('resume: ledger history lost');
canvas = await page.locator('canvas').boundingBox();
await shot('04b-resumed');
await page.getByLabel('Rename TF 11').click();
await page.getByLabel('New name').fill('Anvil Force');
await page.getByLabel('New name').press('Enter');
await waitLesson(5); await shot('05-thirds');
await waitLesson(6, 60000); await shot('06-contact');
// lesson 6 waits for an ROE decision; weapons free also fires on the unidentified merchant (incident)
await page.getByRole('button', { name: 'Weapons free' }).click();
await waitLesson(7, 60000); await shot('07-spares');
if (!/INCIDENT: weapons-free fire on neutral/i.test(await page.locator('ul[aria-live]').innerText())) errors.push('contact: expected a weapons-free incident in the ledger');
await page.getByRole('button', { name: /SHOW/ }).click();
await page.locator('li', { hasText: 'DSR-2D Surface Search' }).getByRole('button', { name: '+1' }).click();
await waitLesson(8, 30000); await shot('08-design');
await page.getByRole('button', { name: /Design bureau/i }).click();
await page.waitForTimeout(500); await shot('08b-designer');
await page.getByLabel('POWER PLANT socket 1').selectOption({ label: /CODAD-12/ }).catch(async () => {
  const opts = await page.getByLabel('POWER PLANT socket 1').locator('option').allTextContents();
  const v = await page.getByLabel('POWER PLANT socket 1').locator('option', { hasText: 'CODAD-12' }).getAttribute('value');
  await page.getByLabel('POWER PLANT socket 1').selectOption(v);
});
await page.getByRole('button', { name: 'Lay down hull' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Close designer').click();
await waitLesson(9); await shot('09-friction');
await page.locator('li', { hasText: 'VL-41 ↔ TACTIS Protocol Bridge' }).getByRole('button', { name: 'Start' }).click();
await waitLesson(10, 60000); await shot('10-sanctions');
await page.locator('section', { hasText: 'Sarnic Defence · REPUBLIC OF SARNIA' }).getByRole('button', { name: /Foreign/ }).click();
await waitLesson(11, 20000); await shot('11-embargo');
await page.locator('[data-tutorial="hulk-SHP-6"]').click();
await waitLesson(12, 60000); await shot('12-graduation');
await page.mouse.click(...at(0.72, 0.5));
await page.locator('div', { hasText: /^TF 12 / }).filter({ has: page.getByRole('button', { name: 'Assign' }) }).last().getByRole('button', { name: 'Assign' }).click();
await waitLesson(13, 20000); await shot('13-final');
await page.getByRole('button', { name: 'Keep this scenario' }).click();
await page.waitForTimeout(500); await shot('14-free');
// name skin: fictional by default, real on toggle, applied to ledger text and panels
await page.getByRole('tab', { name: /Diplomacy/i }).click();
// innerText applies CSS text-transform (uppercase headings), so compare case-insensitively
const body = async () => (await page.locator('body').innerText()).toLowerCase();
if (!(await body()).includes('halberd dynamics') || (await body()).includes('raytheon')) errors.push('skin: expected fictional names by default');
await page.getByRole('button', { name: 'Name skin' }).click();
await page.waitForTimeout(300);
if (!(await body()).includes('raytheon') || (await body()).includes('halberd dynamics')) errors.push('skin: expected real names after toggle');
await page.getByRole('button', { name: 'Name skin' }).click();
await page.waitForTimeout(300);
if ((await body()).includes('raytheon')) errors.push('skin: expected fictional names again');
console.log('ERRORS:', JSON.stringify(errors, null, 1));
process.exitCode = errors.length ? 1 : 0;
await browser.close();

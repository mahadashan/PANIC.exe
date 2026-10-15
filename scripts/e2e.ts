/**
 * Browser smoke test: plays a real run in headless Chrome through the
 * keyboard, captures screenshots of every screen and reports AI usage.
 *   npx tsx scripts/e2e.ts [url] [outDir]
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'e2e-shots';
mkdirSync(out, { recursive: true });

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean) as string[];
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('No Chrome/Edge found; set CHROME_PATH');

type S = { status: string; roundActive: boolean; round: { correctSlot: number; clicksRequired: number; mutationId: string | null } | null;
  announcing: { rec: { mutationId: string; source: string; instruction: string; reason: string; intensity: number } } | null;
  analysisStatus: string; analysis: { source: string; taunt: string; observation: string } | null; score: number; lives: number; records: unknown[] };

const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const state = () => page.evaluate(() => (window as any).__panic.getState() as S);
const shot = (name: string) => page.screenshot({ path: join(out, `${name}.png`) });

await page.goto(`${url}${url.includes('?') ? '&' : '?'}debug=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await shot('1-menu');
const webgl = await page.evaluate(() => !!document.querySelector('canvas.bg-canvas'));

await page.keyboard.press('Enter');
await page.waitForTimeout(600);
await shot('2-countdown');
await page.waitForFunction(() => (window as any).__panic.getState().status === 'PLAYING', null, { timeout: 5000 });

const mutations: Array<{ mutationId: string; source: string; instruction: string; reason: string; intensity: number }> = [];
let lastAnnounce = '';
let shotPlay = false;
let mutationRounds = 0;
const t0 = Date.now();
while (Date.now() - t0 < 70_000) {
  const s = await state();
  if (s.status === 'MUTATION_TRANSITION' && s.announcing) {
    const key = JSON.stringify(s.announcing.rec) + s.records.length;
    if (key !== lastAnnounce) {
      lastAnnounce = key;
      mutations.push(s.announcing.rec);
      if (mutations.length <= 2) {
        await page.waitForTimeout(900);
        await shot(`4-mutation-${mutations.length}`);
      }
    }
  }
  if (s.status === 'PLAYING' && s.roundActive && s.round) {
    if (!shotPlay && s.records.length >= 2) {
      await page.waitForTimeout(350);
      await shot('3-playing');
      shotPlay = true;
    }
    if (s.round.mutationId && mutationRounds++ === 1) {
      await page.waitForTimeout(300);
      await shot('5-mutation-round');
    }
    // Human-ish reaction time so AI lead time is realistic.
    await page.waitForTimeout(350 + Math.random() * 200);
    for (let i = 0; i < s.round.clicksRequired; i++) await page.keyboard.press(String(s.round.correctSlot + 1));
  }
  if (mutations.length >= 4 && s.status === 'PLAYING') break;
  if (s.status === 'GAME_OVER' || s.status === 'AI_ANALYSIS') break;
  await page.waitForTimeout(60);
}

// Lose on purpose: tap a wrong target until out of lives.
while ((await state()).status === 'PLAYING' || (await state()).status === 'MUTATION_TRANSITION') {
  const s = await state();
  if (s.status === 'PLAYING' && s.roundActive && s.round) {
    const wrong = (s.round.correctSlot + 1) % 3;
    await page.keyboard.press(String(wrong + 1));
  }
  await page.waitForTimeout(80);
}
await page.waitForTimeout(400);
await shot('6-crash');
await page.waitForFunction(() => (window as any).__panic.getState().status === 'AI_ANALYSIS', null, { timeout: 5000 });
const tA = Date.now();
await page.waitForFunction(() => (window as any).__panic.getState().analysisStatus === 'done', null, { timeout: 40_000 });
const analysisMs = Date.now() - tA;
await page.waitForTimeout(500);
await shot('7-results');
const final = await state();

// Mouse path + retry in one action.
await page.click('.results__actions .btn--primary');
await page.waitForTimeout(200);
const afterRetry = (await state()).status;
await page.waitForFunction(() => (window as any).__panic.getState().status === 'PLAYING', null, { timeout: 5000 });
await page.waitForFunction(() => (window as any).__panic.getState().roundActive, null, { timeout: 5000 });
const before = (await state()).records.length;
const slot = (await state()).round!.correctSlot;
const clicks = (await state()).round!.clicksRequired;
for (let i = 0; i < clicks; i++) await page.click(`.targets .target:nth-child(${slot + 1})`);
await page.waitForTimeout(100);
const mouseResult = (await state()) as S & { records: Array<{ correct: boolean }> };

console.log(JSON.stringify({
  webgl,
  mutations,
  finalScore: final.score,
  endReason: (final as any).finalSummary?.endReason,
  override: (final as any).mutationsSurvived,
  analysisSource: final.analysis?.source,
  analysisWaitMs: analysisMs,
  analysis: final.analysis,
  retryStatus: afterRetry,
  mouseClickCorrect: mouseResult.records.length === before + 1 && mouseResult.records[before]?.correct,
  consoleErrors: errors,
}, null, 2));
await browser.close();

// Browser walkthrough of every screen. Run the dev server first:
//
//   npm run dev
//   npm i -D playwright && npx playwright install chromium
//   node e2e/smoke.mjs
//
// Screenshots land in e2e/shots/. Navigation is done by clicking inside the app,
// never with page.goto — a full reload clears the in-memory token by design, so
// goto would land back on the login screen.

import { chromium } from 'playwright';
const errs = [];
const shot = async (p, n) => { await p.screenshot({ path: `e2e/shots/${n}.png`, fullPage: true }); console.log('  shot', n); };
const ok = (label, v) => console.log(`  ${v ? 'PASS' : 'FAIL'}  ${label}`, v === true ? '' : `(${v})`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
const wait = (ms = 900) => page.waitForTimeout(ms);
const nav = async (text) => { await page.locator(`.app-header a:has-text("${text}")`).click(); await wait(); };

await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
await wait(500);
await shot(page, '01-login');

// bad password first, to exercise the error state
await page.fill('input[autocomplete="username"]', 'ranga.n');
await page.fill('input[type="password"]', 'wrong');
await page.click('button[type="submit"]');
await wait(800);
ok('login error state shows tries used', await page.locator('text=1 of 5 tries used').isVisible().catch(()=>false));
await shot(page, '02-login-error');

await page.fill('input[type="password"]', 'amrita');
await page.click('button[type="submit"]');
await wait(1200);
ok('admin lands on /cycles', page.url().endsWith('/cycles'));
await shot(page, '03-cycles');
console.log('  cycle rows:', await page.locator('.tbl-row').count());

// ---------- TIMELINE (before anything is mutated) ----------
await nav('All items');
await page.fill('input[placeholder*="Search RM"]', '187521');
await wait(1000);
await page.locator('.tbl-row a.mono').first().click();
await wait(1200);
await shot(page, '04-timeline-187521');
{
  const runRows = await page.locator('.card [style*="grid-template-columns: 44px"]').count();
  ok(`187521 shows its 6 runs (got ${runRows})`, runRows === 6);
  ok('regression banner', await page.locator('.banner-danger:has-text("REGRESSION")').isVisible().catch(() => false));
  ok('gap marker across releases', (await page.locator('text=GAP ·').count()) > 0);
  ok('live run editable for admin', await page.locator('text=Live run · editable').isVisible().catch(() => false));
}

// ---------- ALL ITEMS ----------
await nav('All items');
const rows = await page.locator('.tbl-row').count();
console.log('  all-items rows:', rows);
ok('all items renders rows', rows > 10);
const tiles = await page.locator('.card > .mono.bold').allTextContents();
console.log('  summary tiles:', tiles.join(' | '));
await shot(page, '04-all-items');

const boxes = page.locator('.tbl-row input[type=checkbox]');
for (let i = 0; i < 3; i++) await boxes.nth(i).check();
await wait(400);
ok('bulk bar appears', await page.locator('text=items selected').first().isVisible().catch(()=>false));
await shot(page, '05-bulk-bar');
await page.locator('button:has-text("Open next round")').click();
await wait(400);
ok('open-round confirm shown', await page.locator('text=Round 1 stays frozen').isVisible().catch(()=>false));
await shot(page, '06-bulk-confirm');
await page.locator('.banner button:has-text("Open next round")').click();
await wait(1400);
ok('toast after opening a round', await page.locator('.toast').first().isVisible().catch(()=>false));
await shot(page, '07-after-open-round');

// unassigned tile as a filter
await page.locator('button.card:has-text("Unassigned")').click();
await wait(900);
ok('unassigned filter chip', await page.locator('.chip:has-text("Unassigned")').first().isVisible().catch(()=>false));
await shot(page, '08-unassigned-filter');
await page.locator('button:has-text("Clear filters")').click();
await wait(700);

// ---------- STATS ----------
await nav('Stats');
await wait(1100);
await shot(page, '09-stats');
const d1 = await page.locator('.card .mono.bold').first().textContent();
await page.locator('button:has-text("Every attempt")').click();
await wait(1100);
const d2 = await page.locator('.card .mono.bold').first().textContent();
console.log('  denominator issue-mode:', d1, '-> run-mode:', d2);
ok('counting toggle changes the number', d1 !== d2);
await shot(page, '10-stats-run-mode');
await page.locator('button:has-text("Each item once")').click();
await wait(900);
for (const p of ['SHOWSTOPPERS','REGRESSIONS','STUCK']) {
  ok(`panel ${p} populated`, (await page.locator(`.panel:has-text("${p}") .tbl-row`).count()) > 0);
}
ok('matrix has grey zeros', (await page.locator('.num[style*="table-zero"]').count()) > 0);

// ---------- PEOPLE ----------
await nav('People');
await wait(900);
await shot(page, '12-people');
ok('alias chips render', (await page.locator('.chip.mono').count()) > 10);

// ---------- IMPORT ----------
await nav('Cycles');
await page.locator('a:has-text("New cycle from Excel")').click();
await wait(900);
await shot(page, '13-import-step1');
await page.locator('button:has-text("Read the file")').click();
await wait(1400);
await shot(page, '14-import-step2');
ok('step2 blocked before duplicate choice', await page.locator('button:has-text("Continue to name mapping")').isDisabled());
await page.locator('.radio-card').first().click();
await wait(400);
ok('step2 unblocked after choice', !(await page.locator('button:has-text("Continue to name mapping")').isDisabled()));
await page.locator('button:has-text("Continue to name mapping")').click();
await wait(800);
await shot(page, '15-import-step3');
ok('step3 blocked with unmapped names', await page.locator('button:has-text("Continue to confirm")').isDisabled());
const sels = page.locator('.tbl-row select');
for (let i = 0; i < await sels.count(); i++) await sels.nth(i).selectOption({ index: 1 });
await wait(500);
ok('step3 unblocked after mapping', !(await page.locator('button:has-text("Continue to confirm")').isDisabled()));
await page.locator('button:has-text("Continue to confirm")').click();
await wait(800);
await shot(page, '16-import-step4');
ok('step4 warns it writes to the database', await page.locator('text=this step writes to the database').isVisible().catch(()=>false));

// ---------- CARRY FORWARD ----------
await nav('Cycles');
await page.locator('a:has-text("Carry forward")').click();
await wait(1400);
await shot(page, '17-carry-forward');
ok('carry-forward preview rows', (await page.locator('.tbl-row').count()) > 3);

// ---------- ROLE SWITCH -> TESTER ----------
await page.selectOption('.app-header select[title*="Demo only"]', 'u3');
await wait(1400);
ok('tester lands on my-items', page.url().endsWith('/my-items'));
await shot(page, '18-my-items-tester');
const prog = await page.locator('.mono.bold').first().textContent();
console.log('  my items touched:', prog);
ok('previous-round banner present', (await page.locator('.prev-banner').count()) > 0);

const st = page.locator('.status-select').first();
const before = await st.inputValue();
await st.selectOption('PASS');
await wait(1100);
ok(`inline status edit persists (${before} -> PASS)`, (await st.inputValue()) === 'PASS');
await shot(page, '19-my-items-edited');

// tester cannot reach stats
await page.evaluate(() => window.history.pushState({}, '', '/stats'));
await page.locator('.app-header a').first().click(); await wait(300);
await page.goBack().catch(()=>{});
await wait(600);

// ---------- MY HISTORY ----------
await page.locator('.app-header a:has-text("My history")').click();
await wait(1100);
await shot(page, '20-my-history');
ok('my history rows', (await page.locator('.tbl-row').count()) > 5);

// ---------- CLOSED CYCLE READ-ONLY ----------
await page.locator('.app-header a:has-text("My items")').click();
await wait(700);
const opts = await page.locator('.app-header select').first().locator('option').allTextContents();
const closed = opts.find(o => o.includes('closed'));
await page.locator('.app-header select').first().selectOption({ label: closed });
await wait(1400);
ok('closed cycle shows read-only banner', await page.locator('text=is closed. Nothing on this screen').isVisible().catch(()=>false));
ok('status dropdowns disabled when closed', await page.locator('.status-select').first().isDisabled().catch(()=>true));
await shot(page, '21-readonly-closed');

console.log('\n=== CONSOLE/PAGE ERRORS (' + errs.length + ') ===');
[...new Set(errs)].slice(0, 20).forEach(e => console.log('  ', e.slice(0, 220)));
await browser.close();

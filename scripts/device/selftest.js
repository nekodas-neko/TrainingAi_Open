#!/usr/bin/env node
'use strict';
//
// `node scripts/device/selftest.js` — exercise the harness without a phone.
//
// Serves a small fixture app on localhost, starts a headless Chrome with a DevTools port, and runs
// pw.js and sweep.js against it through the same `connectOverCDP` path the phone uses. It exists
// because the harness is otherwise untestable between sittings: the first device run of the
// original harness was also its first run of any kind.
//
// What it proves: the driver's own logic (tap hit-testing, network and console recording, offline
// switching, metrics, timer counting, the sweep's five detectors). What it cannot prove: anything
// about the WebView — the Android back, the local SQLite, the real safe-area inset. Those are only
// ever settled on the phone. `CHROME_PATH` overrides the browser.

const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT_HTTP = 9391, PORT_CDP = 9392;

const FIXTURE = `<!doctype html><html><head><meta name=viewport content="width=device-width">
<title>trainingai fixture</title><style>
body{margin:0;font:14px sans-serif} nav{position:fixed;bottom:0;left:0;right:0;display:flex;padding-bottom:2px;background:#eee}
nav a{flex:1;padding:14px;text-align:center} .text-brand{color:blue}
#wide{width:200px;overflow:hidden} #wide div{width:600px} .truncate{display:flex;overflow:hidden}
#cover{position:fixed;top:0;left:0;width:200px;height:60px;background:rgba(0,0,0,.1)}
</style></head><body>
<button id=covered style="position:absolute;top:10px;left:10px">under the cover</button><div id=cover></div>
<main style="padding-top:80px"><h1 id=title>home</h1>
<button id=small style="width:20px;height:20px">x</button>
<div id=wide><div>overflowing</div></div><span class=truncate>flex truncate</span>
<a href="#" id=nested>link <button>inside</button></a>
<button id=log>Log</button></main>
<nav><a href="/" class=text-brand>Home</a><a href="/more">More</a></nav>
<script>
const render = () => {
  document.getElementById('title').textContent = location.pathname === '/' ? 'home' : 'more';
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('text-brand', a.getAttribute('href') === location.pathname));
  fetch('/api/ping?p=' + location.pathname);
};
document.querySelectorAll('nav a').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); history.pushState({}, '', a.getAttribute('href')); render();
}));
document.getElementById('log').addEventListener('click', () => { fetch('/api/write', { method: 'POST' }); fetch('/api/ping?after=write'); });
addEventListener('popstate', render);
console.warn('fixture warning 42');
fetch('/api/broken');
setInterval(() => {}, 60000);
render();
</script></body></html>`;

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const c = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const hit = c.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('No Chrome/Edge found — set CHROME_PATH');
  return hit;
}

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/broken')) { res.writeHead(500); return res.end('no'); }
    if (req.url.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(FIXTURE);
  }).listen(PORT_HTTP);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-selftest-'));
  const chrome = spawn(chromePath(), [
    '--headless=new', `--remote-debugging-port=${PORT_CDP}`, `--user-data-dir=${profile}`,
    '--window-size=384,832', '--no-first-run', `http://127.0.0.1:${PORT_HTTP}/`,
  ], { stdio: 'ignore' });

  let pass = 0, fail = 0;
  const check = (name, ok, detail = '') => {
    ok ? pass++ : fail++;
    console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detail ? `  — ${detail}` : ''}`);
  };

  try {
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT_CDP}/json/version`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    process.env.DEVICE_CDP_URL = `http://127.0.0.1:${PORT_CDP}`;
    process.env.DEVICE_PROBE_OUT = path.join(profile, 'out');
    const { attach, sleep } = require('./pw');
    const { sweepInPage } = require('./sweep');
    const dev = await attach({ match: `127.0.0.1:${PORT_HTTP}` });
    await dev.page.waitForLoadState('load');
    check('attaches over CDP, off-phone', dev.onPhone === false);

    const s0 = await dev.state();
    check('state() reads the path in the page', s0.path === '/', s0.path);

    const net = await dev.recordNetwork();
    const con = dev.recordConsole();
    await dev.tab('/more', 600);
    const s1 = await dev.state();
    check('tap on a tab navigates and the tab bar follows', s1.path === '/more' && s1.tab === '/more', `${s1.path} ${s1.tab}`);
    check('recordNetwork counts a request fired by the navigation', net.count(/^\/api\/ping$/) >= 1, `${net.count(/^\/api\/ping$/)}`);

    let refused = null;
    try { await dev.tap('#covered'); } catch (e) { refused = e.message; }
    check('tap refuses a covered control instead of touching whatever is on top', /covered by/.test(refused ?? ''), refused ?? 'it tapped');

    const w = await dev.watchAfter(() => dev.tap('#log'), { ping: /^\/api\/ping$/ }, { windowMs: 800, thenTab: ['/', '/more'] });
    check('watchAfter counts before and after the tab switch', w.beforeNavigation.ping >= 1 && w.afterTabSwitch.ping >= 1, JSON.stringify(w.beforeNavigation) + ' / ' + JSON.stringify(w.afterTabSwitch));
    check('watchAfter lists the write it saw', w.writes.some((x) => x.startsWith('POST /api/write')), w.writes.join(', '));

    await dev.offline(true);
    const tOff = net.now();
    await dev.page.evaluate(() => fetch('/api/ping?offline=1').catch(() => {}));
    await sleep(500);
    const offRow = net.entries.find((r) => r.t >= tOff && r.url.includes('offline=1'));
    check('offline(true) makes a page fetch fail', !!offRow?.failed, offRow ? `failed=${offRow.failed}` : 'no row');
    await dev.offline(false);

    await dev.page.evaluate(() => console.warn('fixture warning 43'));
    await sleep(200);
    check('recordConsole captures console output', con.msgs.some((m) => m.type === 'warning' && /43/.test(m.text)), `${con.msgs.length} msgs`);
    net.stop(); con.stop();

    const m = await dev.metrics();
    check('metrics() returns heap and listener counts', m.heapUsedMB > 0 && m.listeners > 0, JSON.stringify(m));

    await dev.instrumentTimersAndReload();
    const m2 = await dev.metrics();
    check('instrumentTimersAndReload counts live timers from document start', m2.timers?.interval >= 1, JSON.stringify(m2.timers));

    const sw = await dev.page.evaluate(sweepInPage);
    check('sweep: a bottom-anchored control is found (desktop inset is 0, so clearance itself is phone-only)', sw.bottom.length >= 1, JSON.stringify(sw.bottom[0] ?? null));
    check('sweep: horizontal overflow is found', sw.overflow.some((o) => /wide/.test(o.el)), `${sw.counts.overflow}`);
    check('sweep: a sub-44px target is found', sw.smallTargets.some((t) => /small/.test(t.el)), `${sw.counts.smallTargets}`);
    check('sweep: truncate on flex is found', sw.truncateOnFlex.length >= 1, `${sw.counts.truncateOnFlex}`);
    check('sweep: a button inside a link is found', sw.nested.some((n) => /nested/.test(n)), `${sw.counts.nested}`);

    let ro = null;
    try { await dev.localQuery('DELETE FROM food_logs'); } catch (e) { ro = e.message; }
    check('localQuery refuses a write', /read-only/.test(ro ?? ''), ro ?? 'it ran');
    const lq = await dev.localQuery('SELECT 1');
    check('localQuery off-device reports the missing plugin rather than throwing', !!lq.error, lq.error);

    await dev.close();
  } finally {
    chrome.kill();
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold a lock */ }
  }
  console.log(`\n  ${pass} passed · ${fail} failed\n`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => { console.error(`\n\x1b[31m✗\x1b[0m ${err.stack}\n`); process.exitCode = 1; });

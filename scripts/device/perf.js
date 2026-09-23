#!/usr/bin/env node
'use strict';
//
// `node scripts/device/perf.js <probe> [options]` — Part B of docs/device-agent-probe-checklist.md.
//
//   coldstart                 P11  force-stop + launch, then the navigation/paint entries and per-tab TTI
//   tti [--label x]           P11/P16  time-to-content and time-to-settled for every tab, warm
//   cycles [--n 10]           P12  visit/leave/return N times per route, the full list — never a mean
//   longtasks                 P14  long tasks and long animation frames over a tab pass and two scrolls
//   backstack                 P15  press back from a deep screen until Home, counting presses
//
// Every visit is measured the same way (`measureVisit`): from the tap to
//   content — no visible loading block (`.animate-pulse` ≥ 16 px tall) and real text on screen;
//   settled — content, and no `/api` request in flight for 400 ms.
// Alongside each visit it keeps what was in flight (P13) and what held the main thread (P14), so an
// outlier can be read as "slow network", "busy thread", both, or neither — which the checklist says are
// different findings.
//
// Every threshold in the checklist (300 ms warm, 1.5 s FCP, 50 ms task, chain depth 2) is an
// expectation to falsify, not a measured budget. This script reports numbers; it judges nothing.
//
// Safety: the only inputs are CDP taps inside the page, `am force-stop`/`am start` for a cold start, and
// the system back — which `dev.back()` refuses unless the app holds the foreground. No raw adb taps.

const { attach, saveResult, sleep } = require('./pw');
const { adb } = require('./cdp');

const TABS = ['/', '/health', '/workout', '/nutrition', '/more'];
// Pushed routes reachable from a tab, as [route, from-tab, control text].
const PUSHED = [
  ['/cardio', '/workout', 'Cardio'],
  ['/health/readiness', '/', 'Readiness'],
  ['/more/details', '/more', 'Profile details'],
  ['/program', '/more', 'Sessions, progression'],
];
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };

/** Page-side observers for long tasks and long animation frames. Idempotent; survives until reload. */
async function installObservers(dev) {
  await dev.page.evaluate(() => {
    if (window.__dvPerf) return;
    const buf = window.__dvPerf = { lt: [], loaf: [] };
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => buf.lt.push({ start: e.startTime, dur: e.duration })))
        .observe({ type: 'longtask', buffered: true });
    } catch { buf.ltUnsupported = true; }
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => buf.loaf.push({
        start: e.startTime, dur: e.duration, blocking: e.blockingDuration,
        scripts: (e.scripts || []).map((s) => ({ invoker: s.invoker, type: s.invokerType, dur: Math.round(s.duration), src: (s.sourceURL || '').split('/').pop() })),
      }))).observe({ type: 'long-animation-frame', buffered: true });
    } catch { buf.loafUnsupported = true; }
  });
}

async function takePerf(dev, fromNow) {
  return dev.page.evaluate((from) => {
    const b = window.__dvPerf || { lt: [], loaf: [] };
    return {
      longTasks: b.lt.filter((e) => e.start >= from),
      frames: b.loaf.filter((e) => e.start >= from),
      unsupported: { longtask: !!b.ltUnsupported, loaf: !!b.loafUnsupported },
    };
  }, fromNow);
}

const CONTENT_PROBE = () => {
  const shown = (e) => e.getClientRects().length && !e.closest('[hidden],[aria-hidden=true],[inert]');
  const pulses = [...document.querySelectorAll('.animate-pulse,[aria-busy=true]')]
    .filter((e) => shown(e) && e.getBoundingClientRect().height >= 16).length;
  const text = (document.body.innerText || '').replace(/\s+/g, ' ').length;
  return { pulses, text, path: location.pathname };
};

/**
 * Time one navigation. `action` does the tap. Returns ms to content and to settled, plus what was in
 * flight and what blocked the thread during it. `timeoutMs` caps a screen that never settles — that is
 * reported, never waited out silently.
 */
async function measureVisit(dev, net, action, { idleMs = 400, timeoutMs = 10_000, minText = 150 } = {}) {
  const pageT0 = await dev.page.evaluate(() => performance.now());
  const t0 = Date.now(), n0 = net.now();
  await action();
  let contentMs = null, settledMs = null, idleSince = null, last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await dev.page.evaluate(CONTENT_PROBE);
    const el = Date.now() - t0;
    if (contentMs === null && last.pulses === 0 && last.text >= minText) contentMs = el;
    if (contentMs !== null) {
      if (net.inFlight() === 0) { idleSince ??= el; if (el - idleSince >= idleMs) { settledMs = idleSince; break; } }
      else idleSince = null;
    }
    await sleep(40);
  }
  const rel = (x) => (x === null ? null : x - n0);
  const reqs = net.entries.filter((r) => r.t >= n0).map((r) => ({ ...r, t: rel(r.t), tResp: rel(r.tResp), tEnd: rel(r.tEnd) }));
  const perf = await takePerf(dev, pageT0);
  return { contentMs, settledMs, timedOut: settledMs === null, landed: last?.path, requests: reqs, ...perf };
}

/** P13 from one visit's requests: counts, bytes, duplicates, and the longest serial chain. */
function waterfall(reqs, chainGapMs = 60) {
  const api = reqs.filter((r) => /\/api\//.test(r.url));
  const path = (u) => { try { return new URL(u).pathname; } catch { return u; } };
  const seen = {};
  api.forEach((r) => { seen[path(r.url)] = (seen[path(r.url)] ?? 0) + 1; });
  // A request is "after" another when it starts within `chainGapMs` of that one's RESPONSE arriving —
  // `fetch` resolves on headers, so a chained request can start before the body has finished loading.
  // A heuristic for "started because the other answered", not proof of causation.
  const answered = (r) => r.tResp ?? r.tEnd;
  const done = api.filter((r) => answered(r) !== null).sort((a, b) => a.t - b.t);
  const depth = new Map();
  for (const r of done) {
    let d = 1;
    for (const p of done) if (p !== r && answered(p) <= r.t && r.t - answered(p) <= chainGapMs) d = Math.max(d, (depth.get(p) ?? 1) + 1);
    depth.set(r, d);
  }
  const maxDepth = Math.max(0, ...depth.values());
  const bytes = reqs.reduce((s, r) => s + (r.bytes || 0), 0);
  const largest = reqs.reduce((m, r) => ((r.bytes || 0) > (m?.bytes || 0) ? r : m), null);
  return {
    requests: reqs.length, api: api.length, totalKB: +(bytes / 1024).toFixed(1),
    largest: largest ? `${path(largest.url)} ${(largest.bytes / 1024).toFixed(1)} KB` : null,
    duplicates: Object.entries(seen).filter(([, n]) => n > 1).map(([p, n]) => `${p} ×${n}`),
    chainDepth: maxDepth,
    chain: [...depth.entries()].filter(([, d]) => d === maxDepth && maxDepth > 1).map(([r]) => `${path(r.url)} @${r.t}ms`),
  };
}

const blocked = (p) => ({
  longTasks: p.longTasks.length,
  blockedMs: Math.round(p.longTasks.reduce((s, e) => s + Math.max(0, e.dur - 50), 0)),
  longestMs: Math.round(Math.max(0, ...p.longTasks.map((e) => e.dur))),
  topScripts: Object.entries(p.frames.flatMap((f) => f.scripts).reduce((m, s) => { const k = `${s.type}:${s.invoker}`; m[k] = (m[k] ?? 0) + s.dur; return m; }, {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, ms]) => `${k} ${ms}ms`),
});

const summarise = (label, v) => ({
  label, contentMs: v.contentMs, settledMs: v.settledMs, timedOut: v.timedOut, landed: v.landed,
  ...blocked(v), waterfall: waterfall(v.requests),
});

async function ttiPass(dev, net, label) {
  const out = [];
  for (const tab of TABS) {
    // Start from a DIFFERENT tab, or tapping the tab you are on measures nothing.
    await dev.home();
    await dev.tab(tab === '/' ? '/more' : '/', 800);
    const v = await measureVisit(dev, net, () => dev.tab(tab, 0));
    const s = summarise(`${label} ${tab}`, v); out.push(s);
    console.log(`  ${s.label.padEnd(24)} content ${String(s.contentMs).padStart(5)} ms · settled ${String(s.settledMs ?? 'TIMEOUT').padStart(7)} · long tasks ${s.longTasks} (${s.blockedMs} ms blocked) · /api ${s.waterfall.api} · chain ${s.waterfall.chainDepth}`);
  }
  return out;
}

async function coldstart() {
  await adb(['shell', 'am', 'force-stop', 'com.trainingai.app']);
  await sleep(1500);
  await adb(['shell', 'am', 'start', '-n', 'com.trainingai.app/.MainActivity']);
  await sleep(9000);
  const dev = await attach();
  if (!(await dev.inForeground())) throw new Error('cold start: the app did not come to the foreground');
  const nav = await dev.page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] || {};
    const p = Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, Math.round(e.startTime)]));
    return {
      domContentLoaded: Math.round(n.domContentLoadedEventEnd || 0), loadEventEnd: Math.round(n.loadEventEnd || 0),
      responseEnd: Math.round(n.responseEnd || 0), transferKB: Math.round((n.transferSize || 0) / 1024),
      firstPaint: p['first-paint'] ?? null, firstContentfulPaint: p['first-contentful-paint'] ?? null,
      readAt: Math.round(performance.now()), path: location.pathname,
      tabBars: document.querySelectorAll('nav a[href="/"]').length,
    };
  });
  console.log('\n  P11 cold start', JSON.stringify(nav));
  await installObservers(dev);
  const net = await dev.recordNetwork();
  console.log('\n  first visit of each tab after the cold start:');
  const firstVisits = await ttiPass(dev, net, 'cold');
  net.stop();
  const file = saveResult('perf-coldstart', { takenAt: new Date().toISOString(), nav, firstVisits });
  console.log(`\n  → ${file}`);
  await dev.close();
}

async function tti() {
  const label = arg('label', 'warm');
  const dev = await attach(); await installObservers(dev);
  const net = await dev.recordNetwork();
  const metrics = await dev.metrics();
  const pass = await ttiPass(dev, net, label);
  net.stop();
  const file = saveResult(`perf-tti-${label}`, { takenAt: new Date().toISOString(), metrics, pass });
  console.log(`\n  heap ${metrics.heapUsedMB} MB · listeners ${metrics.listeners} · nodes ${metrics.nodes}\n  → ${file}`);
  await dev.close();
}

async function cycles() {
  const n = Number(arg('n', 10));
  const dev = await attach(); await installObservers(dev);
  const net = await dev.recordNetwork();
  const only = arg('routes', null)?.split(',');
  const routes = [...TABS.map((t) => [t, null, null]), ...PUSHED].filter(([r]) => !only || only.includes(r));
  const result = {};
  const stamp = Date.now();
  for (const [route, fromTab, text] of routes) {
    const rows = [];
    for (let i = 0; i < n; i++) {
      try {
        await dev.home();
        let v;
        if (!fromTab) {
          // Leave to another tab, then return by tapping this one.
          await dev.tab(route === '/more' ? '/health' : '/more', 700);
          v = await measureVisit(dev, net, () => dev.tab(route, 0));
        } else {
          await dev.tab(fromTab, 900);
          v = await measureVisit(dev, net, () => dev.tap({ text }));
        }
        rows.push(summarise(`${route} #${i + 1}`, v));
      } catch (err) {
        // A destroyed execution context means the page RELOADED — a hard navigation where the app
        // should push client-side. That is a finding, not a harness failure: record it and carry on.
        const hard = /Execution context was destroyed|navigation/i.test(err.message);
        rows.push({ label: `${route} #${i + 1}`, error: err.message.split(String.fromCharCode(10))[0], hardNavigation: hard });
        await dev.page.waitForLoadState('load').catch(() => {});
        await sleep(3000);
        await installObservers(dev);
      }
    }
    const c = rows.map((r) => (r.error ? (r.hardNavigation ? 'RELOAD' : 'ERR') : r.contentMs));
    const s = rows.map((r) => (r.error ? '-' : r.settledMs ?? 'T/O'));
    result[route] = rows;
    console.log(`  ${route.padEnd(18)} content ms: ${c.join(', ')}${String.fromCharCode(10)}  ${''.padEnd(18)} settled ms: ${s.join(', ')}`);
    saveResult(`perf-cycles-${stamp}`, { takenAt: new Date().toISOString(), n, partial: true, result });
  }
  net.stop();
  const file = saveResult('perf-cycles', { takenAt: new Date().toISOString(), n, result });
  console.log(`\n  → ${file}  (read each outlier's longTasks + waterfall before calling it)`);
  await dev.close();
}

async function longtasks() {
  const dev = await attach(); await installObservers(dev);
  const out = [];
  const run = async (label, fn) => {
    const from = await dev.page.evaluate(() => performance.now());
    await fn(); await sleep(1500);
    const s = { label, ...blocked(await takePerf(dev, from)) }; out.push(s);
    console.log(`  ${label.padEnd(26)} long tasks ${s.longTasks} · blocked ${s.blockedMs} ms · longest ${s.longestMs} ms · ${s.topScripts.join(' | ')}`);
  };
  await dev.home();
  for (const t of TABS) await run(`tab → ${t}`, () => dev.tab(t, 0));
  for (const t of [...TABS].reverse()) await run(`tab ← ${t}`, () => dev.tab(t, 0));
  for (const t of ['/', '/health']) {
    await dev.tab(t, 1000);
    await run(`scroll ${t}`, () => dev.page.evaluate(async () => {
      const s = [...document.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 200 && e.getClientRects().length && getComputedStyle(e).overflowY !== 'visible' && !e.closest('[hidden],[aria-hidden=true],[inert]'));
      if (!s) return;
      for (let i = 0; i < 12; i++) { s.scrollTop += 250; await new Promise((r) => setTimeout(r, 60)); }
      s.scrollTop = 0;
    }));
  }
  const file = saveResult('perf-longtasks', { takenAt: new Date().toISOString(), out });
  console.log(`\n  → ${file}`);
  await dev.close();
}

async function backstack() {
  const dev = await attach();
  await dev.home();
  const trail = [];
  // Go deep by tapping, recording the path the owner would take.
  await dev.tab('/more', 1000); trail.push('/more');
  await dev.tap({ text: 'Sessions, progression' }); await sleep(1500); trail.push((await dev.state()).path);
  const presses = [];
  for (let i = 0; i < 8; i++) {
    const before = await dev.state();
    if (before.path === '/') break; // one more back would minimise the app — LB-107, already verified
    await dev.back(1500);
    const after = await dev.state();
    presses.push(`${before.path} → ${after.path}`);
  }
  console.log(`  visited: ${trail.join(' → ')}\n  back presses to Home: ${presses.length}\n    ${presses.join('\n    ')}`);
  const file = saveResult('perf-backstack', { takenAt: new Date().toISOString(), trail, presses });
  console.log(`\n  → ${file}`);
  await dev.close();
}

const probes = { coldstart, tti, cycles, longtasks, backstack };
const which = process.argv[2];
if (require.main === module) {
  if (!probes[which]) { console.error(`usage: perf.js <${Object.keys(probes).join('|')}>`); process.exit(2); }
  probes[which]().catch((err) => { console.error(`\n\x1b[31m✗\x1b[0m ${err.message}\n`); process.exitCode = 1; });
}

module.exports = { measureVisit, waterfall, installObservers, takePerf, CONTENT_PROBE };

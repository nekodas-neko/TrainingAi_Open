#!/usr/bin/env node
'use strict';
//
// `node scripts/device/census.js [--rounds 2] [--dwell 25] [--idle-min 0] [--no-reload]`
// Probes P2, P7 and P10 of docs/device-agent-probe-checklist.md in one walk.
//
// Walks Home → Nutrition → Health → Workout → More, `--rounds` times, dwelling `--dwell` seconds on
// each, recording every request (with its initiator), every console message, and heap / listener /
// timer counts at the start and end. `--idle-min N` then leaves the app untouched for N minutes and
// measures again — the second half of P10.
//
// What it reports:
//   P2  per /api endpoint: how many times it was requested and on which visits. An endpoint fetched
//       on exactly one visit to a tab visited several times is a candidate never-re-runs site.
//   P7  every non-2xx and every console message, grouped and counted (the list, not a summary).
//   P10 heap, listeners, DOM nodes, live timers — start, end, and after idle.
//
// The walk makes NO writes. P2 asks for one write per tab; those are driven by hand in a sitting
// (each write type the owner has approved, deleted straight after), with `recordNetwork()` running.
//
// It reloads the app once first (unless --no-reload) so the timer counter is installed from the
// document's start. That is a cold start, and it is reported as one.

const { attach, saveResult, sleep } = require('./pw');

const TABS = ['/', '/nutrition', '/health', '/workout', '/more'];
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : dflt;
};

// `/api/workout-sessions/3f2…/rpe?x=1` → `/api/workout-sessions/:id/rpe`
const endpoint = (url) => {
  let p; try { p = new URL(url).pathname; } catch { return url; }
  return p.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id').replace(/\/\d{4}-\d{2}-\d{2}/g, '/:date').replace(/\/\d+(?=\/|$)/g, '/:n');
};
const normalise = (s) => s.replace(/\d+(\.\d+)?/g, 'N').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id').slice(0, 200);

async function main() {
  const rounds = arg('rounds', 2), dwell = arg('dwell', 25) * 1000, idleMin = arg('idle-min', 0);
  const dev = await attach();
  if (!process.argv.includes('--no-reload')) await dev.instrumentTimersAndReload();

  const net = await dev.recordNetwork();
  const con = dev.recordConsole();
  const metricsStart = await dev.metrics();
  const visits = [];

  for (let round = 1; round <= rounds; round++) {
    for (const tab of TABS) {
      for (let i = 0; i < 4 && !(await dev.page.locator('nav a[href="/"]').isVisible()); i++) await dev.back();
      const from = net.now();
      await dev.tab(tab, 0);
      await sleep(dwell);
      visits.push({ round, tab, from, to: net.now(), landed: (await dev.state()).path });
      process.stdout.write(`  round ${round} ${tab.padEnd(11)} ${net.entries.length} requests so far\n`);
    }
  }
  const metricsEnd = await dev.metrics();
  let metricsIdle = null;
  if (idleMin > 0) {
    console.log(`  idling ${idleMin} min, untouched…`);
    await sleep(idleMin * 60_000);
    metricsIdle = await dev.metrics();
  }
  net.stop(); con.stop();

  // P2 — per endpoint, which visits fetched it.
  const api = net.entries.filter((r) => /\/api\//.test(r.url));
  const table = {};
  for (const r of api) {
    const key = `${r.method} ${endpoint(r.url)}`;
    const v = visits.find((x) => r.t >= x.from && r.t < x.to);
    const row = (table[key] ??= { count: 0, visits: new Set(), tabs: new Set(), initiators: new Set() });
    row.count++;
    if (v) { row.visits.add(visits.indexOf(v)); row.tabs.add(v.tab); }
    if (r.initiator) row.initiators.add(r.initiator);
  }
  const endpoints = Object.entries(table).map(([key, row]) => {
    const ownTab = [...row.tabs][0] ?? null;
    const ownTabVisits = visits.filter((v) => v.tab === ownTab).length;
    const visitsFetched = [...row.visits].filter((i) => visits[i].tab === ownTab).length;
    return {
      endpoint: key, count: row.count, firstSeenOn: ownTab, tabVisits: ownTabVisits, visitsThatFetched: visitsFetched,
      neverReRuns: ownTabVisits > 1 && visitsFetched === 1,
      initiators: [...row.initiators].slice(0, 4),
    };
  }).sort((a, b) => b.count - a.count);

  // P7 — non-2xx and console, grouped.
  const nonOk = api.filter((r) => r.failed || (r.status && (r.status < 200 || r.status > 299)))
    .map((r) => ({ endpoint: `${r.method} ${endpoint(r.url)}`, status: r.status, failed: r.failed, t: r.t }));
  const groups = {};
  for (const m of con.msgs) { const k = `${m.type}: ${normalise(m.text)}`; groups[k] = (groups[k] ?? 0) + 1; }
  const consoleGrouped = Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ n, message: k }));

  const result = {
    takenAt: new Date().toISOString(), coldStart: !process.argv.includes('--no-reload'),
    rounds, dwellSec: dwell / 1000, idleMin, visits,
    p2: { endpoints, neverReRuns: endpoints.filter((e) => e.neverReRuns).map((e) => e.endpoint) },
    p7: { nonOk, console: consoleGrouped, totalRequests: net.entries.length },
    p10: { start: metricsStart, end: metricsEnd, idle: metricsIdle },
  };
  const file = saveResult('census', result);

  console.log(`\n  P2  ${endpoints.length} endpoints · candidate never-re-runs: ${result.p2.neverReRuns.length}`);
  result.p2.neverReRuns.forEach((e) => console.log(`        ${e}`));
  console.log(`  P7  ${nonOk.length} non-2xx/failed · ${con.msgs.length} console messages in ${consoleGrouped.length} groups`);
  const fmt = (m) => m ? `heap ${m.heapUsedMB} MB · listeners ${m.listeners} · nodes ${m.nodes} · timers ${JSON.stringify(m.timers)}` : '—';
  console.log(`  P10 start ${fmt(metricsStart)}\n      end   ${fmt(metricsEnd)}${metricsIdle ? `\n      idle  ${fmt(metricsIdle)}` : ''}`);
  console.log(`\n  → ${file}  (gitignored — quote numbers, never the file)\n`);
  await dev.close();
}

main().catch((err) => { console.error(`\n\x1b[31m✗\x1b[0m ${err.message}\n`); process.exitCode = 1; });

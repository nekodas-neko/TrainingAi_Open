#!/usr/bin/env node
'use strict';
//
// `node scripts/device/sweep.js [routes.json]` — probe P4 of docs/device-agent-probe-checklist.md.
//
// Enumerates every rendered element on each route at the phone's real viewport and reports five
// things no source grep can settle, because they depend on what the classes RESOLVE to on the device:
//
//   1. bottom-anchored clearance — every fixed/sticky element ending within 24px of the viewport
//      bottom that is or holds a control, its computed padding-bottom, against the measured inset
//   2. horizontal overflow — scrollWidth > clientWidth, with the element's overflow-x so a
//      deliberate carousel (auto/scroll) can be told from content spilling out (visible/hidden)
//   3. tap targets under 44 × 44 px
//   4. `truncate` on a flex box, where it does nothing
//   5. an interactive element inside another
//
// ⚠ Clearance is meaningless on three-button navigation (the inset is the 48px button bar and a
// broken utility passes). The script reads the mode from Android and says so in the result.
//
// Tab roots are reached by tapping the tab bar; other routes through Next's own router, since this
// probe is about layout, not reachability (that is P9).

const fs = require('node:fs');
const { attach, saveResult, sleep } = require('./pw');
const { adb } = require('./cdp');

const TABS = ['/', '/health', '/workout', '/nutrition', '/more'];
const DEFAULT_ROUTES = [
  ...TABS,
  '/cardio', '/health/day', '/health/readiness', '/more/details', '/more/settings', '/more/about',
  '/more/devices', '/program',
];

function sweepInPage() {
  const INTERACTIVE = 'a,button,[role=button],[role=tab],[role=menuitem],[role=switch],[role=checkbox],input,select,textarea';
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    if (e.closest('[hidden],[aria-hidden=true],[inert]')) return false;
    return getComputedStyle(e).visibility !== 'hidden';
  };
  const label = (e) => {
    const cls = String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className)
      .split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    const text = (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${cls ? '.' + cls : ''}${text ? ` "${text}"` : ''}`;
  };
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:-9999px;padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(probe);
  const inset = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();

  const all = [...document.querySelectorAll('body *')].filter(shown);
  const vh = innerHeight;

  const bottom = [];
  for (const e of all) {
    const cs = getComputedStyle(e);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    const r = e.getBoundingClientRect();
    if (r.bottom < vh - 24) continue;
    if (!e.matches(INTERACTIVE) && !e.querySelector(INTERACTIVE)) continue;
    const pad = parseFloat(cs.paddingBottom) || 0;
    bottom.push({ el: label(e), paddingBottomPx: pad, gapBelowPx: Math.round(vh - r.bottom), clearsInset: pad + (vh - r.bottom) >= inset - 0.5 });
  }

  const overflow = all
    .filter((e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
    .map((e) => ({ el: label(e), overflowPx: e.scrollWidth - e.clientWidth, overflowX: getComputedStyle(e).overflowX }))
    .slice(0, 60);

  const smallTargets = all
    .filter((e) => e.matches(INTERACTIVE) && !e.parentElement?.closest(INTERACTIVE))
    .map((e) => {
      // The touch box, not the ink: `.tap-target-44` / `.tap-target-dot` add an invisible
      // ::before of 44×44 / 24×44 (app/globals.css), so the drawn size understates what a thumb gets.
      const r = e.getBoundingClientRect();
      const hit = e.classList.contains('tap-target-44') ? { w: 44, h: 44 }
        : e.classList.contains('tap-target-dot') ? { w: 24, h: 44 } : { w: 0, h: 0 };
      return { e, w: Math.max(r.width, hit.w), h: Math.max(r.height, hit.h), inkW: r.width, inkH: r.height };
    })
    .filter(({ w, h }) => w < 44 || h < 44)
    .map(({ e, w, h, inkW, inkH }) => ({ el: label(e), w: Math.round(w), h: Math.round(h), ink: `${Math.round(inkW)}x${Math.round(inkH)}` }))
    .slice(0, 80);

  const truncateOnFlex = all
    .filter((e) => e.classList?.contains('truncate') && /flex/.test(getComputedStyle(e).display))
    .map(label);

  const nested = all
    .filter((e) => e.matches('a,button') && e.querySelector('a,button,[role=button]'))
    .map(label);

  return {
    route: location.pathname,
    viewport: { w: innerWidth, h: vh, dpr: devicePixelRatio },
    insetBottomPx: inset,
    counts: { elements: all.length, bottom: bottom.length, overflow: overflow.length, smallTargets: smallTargets.length, truncateOnFlex: truncateOnFlex.length, nested: nested.length },
    bottom, overflow, smallTargets, truncateOnFlex, nested,
  };
}

async function main() {
  const routes = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : DEFAULT_ROUTES;
  const dev = await attach();
  const navMode = dev.onPhone
    ? ({ 0: 'three-button', 1: 'two-button', 2: 'gesture' }[String(await adb(['shell', 'settings', 'get', 'secure', 'navigation_mode'])).trim()] ?? 'unknown')
    : 'not a phone';
  console.log(`\nnavigation: ${navMode}${navMode === 'gesture' ? '' : '  ⚠ clearance numbers are NOT valid in this mode'}\n`);

  const results = [];
  for (const route of routes) {
    try {
      if (TABS.includes(route)) {
        // A tab root is reachable only from a screen that shows the tab bar.
        await dev.home();
        await dev.tab(route, 1800);
      } else {
        await dev.go(route, 2200);
      }
      const r = await dev.page.evaluate(sweepInPage);
      results.push({ asked: route, ...r });
      const c = r.counts;
      const bad = r.bottom.filter((b) => !b.clearsInset).length;
      console.log(`  ${r.route === route ? '✓' : '~'} ${route.padEnd(20)} bottom ${c.bottom} (${bad} short of inset) · overflow ${c.overflow} · <44px ${c.smallTargets} · truncate+flex ${c.truncateOnFlex} · nested ${c.nested}` +
        (r.route !== route ? `  (landed on ${r.route})` : ''));
    } catch (err) {
      results.push({ asked: route, error: err.message });
      console.log(`  ✗ ${route} — ${err.message.split('\n')[0]}`);
    }
    await sleep(300);
  }
  const file = saveResult('sweep', { takenAt: new Date().toISOString(), navMode, results });
  console.log(`\n  → ${file}\n  (gitignored: the repo is public. Quote numbers and selectors into the backlog, never the file.)\n`);
  await dev.close();
}

if (require.main === module) {
  main().catch((err) => { console.error(`\n\x1b[31m✗\x1b[0m ${err.message}\n`); process.exitCode = 1; });
}

module.exports = { sweepInPage };

#!/usr/bin/env node
'use strict';
//
// `node scripts/device/probe.js` — the first thing to run with a phone plugged in.
//
// It answers, on the real device, the three questions every sandbox in this project answers wrong:
//
//   1. Is the local store REAL? `getLocalStore` returns null off the APK, so every offline-first
//      read takes its web fallback in the harness and the device branch is never exercised.
//   2. What does `env(safe-area-inset-bottom)` actually resolve to? The floored-utility rule exists
//      because bare `pb-safe` gives near-zero clearance on Android gesture-nav — a claim no
//      desktop Chromium can confirm or deny, since the inset is 0 there.
//   3. What does Samsung's WebView actually paint? The screenshot is the compositor's own output.
//
// It changes nothing. It is a read, and it is the proof the connection works before anything
// depends on it.
//
// ⚠ NOT RUN AGAINST A DEVICE — see the header of cdp.js. The first run is the test.

const fs = require('node:fs');
const path = require('node:path');
const { connect } = require('./cdp');

const OUT = process.env.DEVICE_PROBE_OUT || path.join(process.cwd(), 'device-probe');

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const no = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const hm = (s) => `\x1b[33m?\x1b[0m ${s}`;

async function main() {
  console.log('\nConnecting to the WebView on the device…\n');
  const { device, socket, target, session } = await connect();
  console.log(`  device  ${device}`);
  console.log(`  socket  ${socket}`);
  console.log(`  page    ${target.url}\n`);

  // 1 — the local store. `getLocalStore` is not on window; ask the page what it can see instead.
  const store = await session.evaluate(`(async () => {
    const cap = typeof window.Capacitor !== 'undefined'
      ? { native: !!window.Capacitor.isNativePlatform?.(), platform: window.Capacitor.getPlatform?.() }
      : null;
    const sqlitePlugin = !!(window.Capacitor?.Plugins?.CapacitorSQLite);
    return { cap, sqlitePlugin };
  })()`);
  if (store.cap?.native) {
    console.log(ok(`native platform: ${store.cap.platform} — this is the APK, not a browser`));
  } else {
    console.log(no('Capacitor reports NOT native. This is a browser, so the device branch is not running.'));
  }
  console.log(store.sqlitePlugin
    ? ok('CapacitorSQLite plugin present — the offline-first reads can be exercised here')
    : hm('CapacitorSQLite not visible on Capacitor.Plugins (it may register lazily; not conclusive)'));

  // 2 — the safe-area insets, measured rather than assumed.
  const insets = await session.evaluate(`(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:-9999px;' +
      'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);' +
      'padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)';
    document.body.appendChild(probe);
    const s = getComputedStyle(probe);
    const out = { top: s.paddingTop, bottom: s.paddingBottom, left: s.paddingLeft, right: s.paddingRight,
                  dpr: window.devicePixelRatio, w: innerWidth, h: innerHeight };
    probe.remove();
    return out;
  })()`);
  console.log('');
  console.log(`  viewport ${insets.w}×${insets.h} css px @ dpr ${insets.dpr}`);
  console.log(`  safe-area  top ${insets.top} · bottom ${insets.bottom} · left ${insets.left} · right ${insets.right}`);
  const bottom = parseFloat(insets.bottom) || 0;
  if (bottom === 0) {
    console.log(hm('bottom inset is 0 — either three-button navigation is on, or the WebView is not edge-to-edge.'));
    console.log('  Switch the phone to gesture navigation before judging any clearance check.');
  } else {
    console.log(ok(`bottom inset is ${insets.bottom} — this is the number the floored utilities exist to beat`));
  }

  // 3 — what the compositor paints.
  fs.mkdirSync(OUT, { recursive: true });
  const shot = path.join(OUT, `probe-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
  fs.writeFileSync(shot, await session.screenshot());
  console.log('\n' + ok(`screenshot written to ${shot}`));

  // What the page is showing, so the operator knows which screen the readings came from.
  const where = await session.evaluate(`({ path: location.pathname, title: document.title })`);
  console.log(`  taken on ${where.path}`);

  console.log('\nConnection works. What this does NOT establish:');
  console.log('  · nothing about the ring or the scale — real BLE needs the real hardware');
  console.log('  · nothing about how anything FEELS; that stays a human call');
  console.log('  · nothing about a screen you were not on — these are readings, not a sweep\n');
  session.close();
}

main().catch((err) => {
  console.error('\n' + no(err.message) + '\n');
  process.exitCode = 1;
});

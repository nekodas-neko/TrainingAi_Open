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
// ✅ Run on the S25, 2026-09-23 — connected first time. The navigation-mode read was added after it.

const fs = require('node:fs');
const path = require('node:path');
const { connect, adb } = require('./cdp');

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
  // Ask Android which navigation mode is on — never infer it from the inset. The first device run
  // (S25, 2026-09-23) read a 48px bottom inset under THREE-BUTTON navigation: the button bar is
  // 48dp, so a non-zero inset proves nothing about gesture nav, and the earlier "0 means
  // three-button" reading was wrong on this phone. 0 = three-button, 1 = two-button, 2 = gesture.
  const mode = String(await adb(['shell', 'settings', 'get', 'secure', 'navigation_mode']).catch(() => '')).trim();
  const MODE = { 0: 'three-button', 1: 'two-button', 2: 'gesture' }[mode] ?? `unknown (${mode || 'unreadable'})`;
  console.log(`  navigation ${MODE}`);
  if (mode === '2') {
    console.log(ok(`gesture navigation, bottom inset ${insets.bottom} — clearance checks mean something here`));
  } else {
    console.log(hm(`${MODE} navigation — safe-area clearance checks are NOT valid until the phone is on gesture nav.`));
    console.log('  Back checks are fine: keyevent 4 is the same KEYCODE_BACK either way.');
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
  console.log('  · nothing about how anything FEELS; that stays a human call');
  console.log('  · nothing about a screen you were not on — these are readings, not a sweep');
  console.log('  · and the limit on the ring and scale is narrower than it sounds: this IS the');
  console.log('    phone they are paired to, so every app-side BLE surface is reachable. What');
  console.log('    cannot be done is making the hardware DO something — wear the ring overnight,');
  console.log('    wake a radio that is power-gating, stand on the scale.\n');
  session.close();
}

main().catch((err) => {
  console.error('\n' + no(err.message) + '\n');
  process.exitCode = 1;
});

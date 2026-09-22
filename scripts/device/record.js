#!/usr/bin/env node
'use strict';
//
// `node scripts/device/record.js [ms] [--tap <selector>]`
//
// Records the device's own compositor frames over a window of time, and writes them with the
// milliseconds each one landed at. This is the part of `chrome://inspect`'s mirrored screen that
// matters to a check: not the picture, the **timing**.
//
// Three owed checks are timing questions a still frame cannot answer:
//
//   RV-74  the health hero's number counts up over 600 ms while its ring snaps to final position.
//          Two marks in one component — the question is whether they end together.
//   RV-75  sheets opened in 500 ms against the app's own 180-200 ms elsewhere. Shipped at 300;
//          `duration-250` was written for the close and IS NOT A TAILWIND CLASS, so it compiled to
//          nothing and left the stock 300. A typo'd class fails nothing — only a measurement finds it.
//   RV-72  progress bars animating `width`, a layout property, rather than a transform.
//
// With `--tap`, it starts recording, taps, and keeps recording — so the window covers the
// transition rather than starting after it.
//
// ⚠ NOT RUN AGAINST A DEVICE. See the header of cdp.js.

const fs = require('node:fs');
const path = require('node:path');
const { connect } = require('./cdp');

const OUT = process.env.DEVICE_PROBE_OUT || path.join(process.cwd(), 'device-probe');

function parseArgs(argv) {
  const ms = Number(argv.find((a) => /^\d+$/.test(a)) ?? 1500);
  const i = argv.indexOf('--tap');
  return { ms, tap: i >= 0 ? argv[i + 1] : null };
}

async function main() {
  const { ms, tap } = parseArgs(process.argv.slice(2));
  const { session } = await connect();

  const where = await session.evaluate(`({ path: location.pathname })`);
  console.log(`\nRecording ${ms}ms on ${where.path}${tap ? ` — tapping ${tap} once it starts` : ''}\n`);

  // The tap has to land INSIDE the window, or the recording starts after the transition it is for.
  const recording = session.record(ms);
  if (tap) {
    await new Promise((r) => setTimeout(r, 120));
    try {
      await session.tap(tap);
      console.log(`  tapped ${tap}`);
    } catch (err) {
      console.log(`  tap refused: ${err.message}`);
      console.log('  (recording continues — an untapped window is still a reading, just not the one asked for)');
    }
  }
  const frames = await recording;

  if (!frames.length) {
    console.error('\nNo frames arrived. The screencast may not have started, or the screen is fully static.\n');
    process.exitCode = 1;
    session.close();
    return;
  }

  const dir = path.join(OUT, `record-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(dir, { recursive: true });
  const index = frames.map((f, n) => {
    const name = `${String(n).padStart(4, '0')}-${f.msFromStart}ms.jpg`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(f.data, 'base64'));
    return { n, msFromStart: f.msFromStart, file: name };
  });
  fs.writeFileSync(path.join(dir, 'index.json'),
    JSON.stringify({ path: where.path, tap, requestedMs: ms, frames: index }, null, 2));

  const span = frames.at(-1).msFromStart - frames[0].msFromStart;
  const gaps = index.slice(1).map((f, i) => f.msFromStart - index[i].msFromStart);
  const worst = Math.max(...gaps, 0);
  console.log(`\n  ${frames.length} frames over ${span}ms → ${dir}`);
  console.log(`  longest gap between frames: ${worst}ms`);
  if (worst > 100) {
    console.log('  ⚠ a gap that long means dropped frames — read the timestamps, never the frame count,');
    console.log('    and do not call a transition "instant" because few frames covered it.');
  }
  console.log('\n  Compare the frames to answer the timing question. The milliseconds are the evidence;');
  console.log('  what the frames look like is how you decide which millisecond matters.\n');
  session.close();
}

main().catch((err) => {
  console.error(`\n\x1b[31m✗\x1b[0m ${err.message}\n`);
  process.exitCode = 1;
});

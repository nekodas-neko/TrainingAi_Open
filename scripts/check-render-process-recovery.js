#!/usr/bin/env node
'use strict';
//
// BF-80 — the WebView's render-process death must stay handled.
//
// Capacitor's `BridgeWebViewClient` forwards `onRenderProcessGone` to every registered
// `WebViewListener`, and `WebViewListener`'s own default returns **false**, which the platform
// reads as "kill the app". So the recovery is not a line of defensive code that merely stops
// working if it goes — its absence is the pre-existing behaviour, and the symptom (a blank page,
// nothing in `error_events`) points at anything but a missing listener. That is a bad combination
// to leave to a reviewer noticing a deleted line.
//
// Three things are checked, because losing any one of them silently restores the old behaviour:
// the listener exists, it returns `true`, and MainActivity registers it.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const LISTENER = 'android/app/src/main/java/com/trainingai/app/RenderProcessRecovery.java';
const ACTIVITY = 'android/app/src/main/java/com/trainingai/app/MainActivity.java';

const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

/** Comments say what the code is meant to do; only the code does it. Stripping them first is not
 *  tidiness — the `recreate` check below PASSED on a handler whose recovery had been replaced by an
 *  empty lambda, because the word survived in the log line and the comment above it. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const listener = read(LISTENER);
if (listener == null) {
  failures.push(`${LISTENER} is gone. Without it a dead renderer terminates the app process — that is the platform default, not a degraded fallback.`);
} else {
  if (!/extends\s+WebViewListener/.test(listener)) {
    failures.push(`${LISTENER} no longer extends WebViewListener, so Capacitor will never call it.`);
  }
  // The whole contract is the return value: a handler that returns false is the default answer
  // written out longhand, and reads as if it were doing something.
  const code = stripComments(listener);
  const body = code.slice(code.indexOf('onRenderProcessGone'));
  if (!/\breturn\s+true\s*;/.test(body)) {
    failures.push(`${LISTENER}'s onRenderProcessGone must return true — false means "unhandled", and the platform kills the process.`);
  }
  // A CALL, not the word: `recreate()` or a `::recreate` method reference.
  if (!/(\brecreate\s*\(|::\s*recreate\b)/.test(body)) {
    failures.push(`${LISTENER} handles the event but never recreates the activity. A WebView whose renderer died cannot be reused, so returning true without recovering leaves a permanently blank screen.`);
  }
}

const activity = read(ACTIVITY);
if (activity == null) {
  failures.push(`${ACTIVITY} not found.`);
} else if (!/addWebViewListener\s*\(\s*new\s+RenderProcessRecovery\s*\(/.test(activity)) {
  failures.push(`${ACTIVITY} does not register RenderProcessRecovery. The class existing is not the same as it running.`);
}

if (failures.length > 0) {
  console.error('Render-process recovery check failed:\n');
  for (const f of failures) console.error(`  • ${f}`);
  console.error('\nSee BF-80 and the class comment in RenderProcessRecovery.java.');
  process.exit(1);
}

console.log('check-render-process-recovery: OK — the renderer-death listener is present, handled and registered.');

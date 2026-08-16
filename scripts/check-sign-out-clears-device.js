#!/usr/bin/env node
// Signing out must wipe the device, not just the session.
//
// The on-device SQLite store is the source of truth for every offline-first domain, and most
// `cachedFetch` keys carry no user id (`weekly-stats`, `readiness-score`, `home-day-timeline`), so
// the next account to sign in paints from the previous one's data before any fetch returns —
// `readCacheSync` runs first, by design.
//
// Q-172 (2026-08-10): More → Profile ran the full clear while `components/chat.tsx`'s two sign-out
// buttons posted a bare `<form action={signOut}>` and ran none of it. One correct sequence copied
// to three call sites is one call site away from being wrong again, so `lib/sign-out.ts` is now the
// only way to sign out — and this check is what keeps it that way.
//
// Two failure modes, both caught here:
//   1. Importing `signOut` from `@/app/actions` outside `lib/sign-out.ts` — skips the clears.
//   2. `<form action={…signOut…}>` — a form posts straight to the server action, so no client-side
//      clear can run at all, however the handler is written. A sign-out control must be a button
//      with an onClick.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const OWNER = 'lib/sign-out.ts';          // the one file allowed to reach the raw server action
const ROOTS = ['app', 'components', 'lib'];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '__tests__', '.next', 'dist'].includes(entry.name)) continue;
      walk(full, out);
      continue;
    }
    if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const offenders = [];
let checked = 0;

for (const dir of ROOTS) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const rel = path.relative(root, file);
    if (rel === OWNER || rel === 'app/actions.ts') continue;
    const src = fs.readFileSync(file, 'utf8');
    if (!/signOut/.test(src)) continue;
    checked++;

    if (/import\s*\{[^}]*\bsignOut\b[^}]*\}\s*from\s*['"]@\/app\/actions['"]/.test(src)) {
      offenders.push({ rel, why: "imports signOut from '@/app/actions' — use signOutAndClearDevice from '@/lib/sign-out'" });
    }
    // A form posts straight to the server action; no client-side clear can run.
    const form = src.match(/<form[^>]*\baction=\{[^}]*signOut[^}]*\}/);
    if (form) {
      offenders.push({ rel, why: `<form action={…signOut…}> cannot run the clears — use a <Button onClick>` });
    }
  }
}

if (offenders.length > 0) {
  console.error('Sign-out path skips the device wipe (Q-172): the next account on this device would paint from the previous one\'s data.');
  console.error("Call `signOutAndClearDevice()` from '@/lib/sign-out' in a button onClick:");
  for (const o of offenders) console.error(`  ${o.rel}: ${o.why}`);
  process.exit(1);
}

console.log(`check-sign-out-clears-device: ${checked} file(s) mention signOut, all route through ${OWNER}.`);

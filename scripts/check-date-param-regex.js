#!/usr/bin/env node
// A date-param Zod schema must accept BOTH separators: /^\d{4}[-/]\d{2}[-/]\d{2}$/.
// The client's localDateString() (packages/shared/src/utils.ts) emits 'YYYY/MM/DD' with SLASHES,
// and handlers normalise slashes to dashes — so a dash-only schema rejects the request with a Zod
// error BEFORE the handler ever runs. That took out ai-chat's localDate for a full release
// (2026-07-19). packages/shared/src/validators/chat.ts is the reference for the fixed form.
'use strict';
const fs = require('fs');
const path = require('path');

// Dash-only schemas still on disk. Q-130 (#1148) widened seven of the original eleven; these four
// files are what remains, and none is fed from localDateString() — verified by tracing its call
// sites — so none is a live bug. `nav-timing.ts` and `fix-exercise-units` parse values the app
// itself produced rather than a client date param, so they are the least urgent of the four.
// This list may only shrink: the check fails if a listed file is fixed but left here.
const GRANDFATHERED = new Set([
  'app/api/admin/fix-exercise-units/route.ts',
  // 'app/api/injuries/[id]/route.ts' — FIXED 2026-08-19 (Lane A, Q-484). Its regex moved into
  // packages/shared/src/validation/injury.ts, shared with the create route, and now accepts both
  // separators; both handlers normalise slashes to dashes before the DATE column sees them.
  'app/api/user/profile/route.ts',
  'lib/perf/nav-timing.ts',
]);

const root = path.join(__dirname, '..');
// The anchored literal, so this catches `const DATE_RE = /^\d{4}-\d{2}-\d{2}$/` as well as an
// inline `z.string().regex(...)`. An earlier version required `regex(`/`z.string(` on the same
// line and silently missed both const-assigned copies.
const DASH_ONLY = '/^\\d{4}-\\d{2}-\\d{2}';
const offenders = new Map();

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '__tests__', '.next', 'dist'].includes(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    const rel = path.relative(root, full).split(path.sep).join('/');
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes(DASH_ONLY)) return;
      if (!offenders.has(rel)) offenders.set(rel, []);
      offenders.get(rel).push(i + 1);
    });
  }
}

for (const top of ['app', 'lib', 'packages']) {
  const dir = path.join(root, top);
  if (fs.existsSync(dir)) walk(dir);
}

const newOffenders = [...offenders.keys()].filter(f => !GRANDFATHERED.has(f));
const fixed = [...GRANDFATHERED].filter(f => !offenders.has(f));

if (newOffenders.length > 0) {
  console.error('Dash-only date regex in a Zod schema — the client\'s localDateString() emits YYYY/MM/DD with SLASHES, so this rejects every such request with a Zod error before the handler runs (CLAUDE.md: Date Arithmetic).');
  console.error('Use /^\\d{4}[-/]\\d{2}[-/]\\d{2}$/ instead:');
  for (const f of newOffenders) console.error(`  ${f}: line(s) ${offenders.get(f).join(', ')}`);
  process.exit(1);
}

if (fixed.length > 0) {
  console.error('These files no longer carry a dash-only date regex — remove them from GRANDFATHERED in this script so they stay fixed:');
  for (const f of fixed) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`check-date-param-regex: no new dash-only date schemas (${GRANDFATHERED.size} pre-existing awaiting widening).`);

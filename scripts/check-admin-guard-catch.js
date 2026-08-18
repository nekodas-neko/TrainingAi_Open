#!/usr/bin/env node
// Q-548 — `requireAdmin` must not be wrapped in a bare `catch {}`.
//
// `requireAdmin` makes a DB round-trip and throws `AdminError` for "not an admin". A bare `catch {}`
// catches *anything else* too — including a connection failure — and answers 403. That is the one
// status a caller will neither retry nor escalate, and it points the investigation at credentials:
// during the 2026-08-18 volume incident every /api/admin/db-query call returned
// {"error":"Forbidden"} while the Railway dashboard already said the service was offline, and the
// first several minutes went into checking env vars and the admin flag.
//
// "Not authorised" and "could not check" must be different answers. `adminErrorResponse(err)` /
// `adminFailureOutcome(err)` in lib/admin.ts give 403 for a real refusal and 503 otherwise.
//
// Reported once per site rather than ratcheted: the sweep that introduced this check cleared all 46,
// so the correct baseline is zero and anything above it is new.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// `catch {` or `catch (e) {}` with an empty body — both discard the distinction.
const BARE_CATCH = /await\s+requireAdmin\([^\n]*\)\s*\n\s*\}\s*catch\s*(?:\(\s*\w+\s*\)\s*)?\{/g;
const failures = [];
let scanned = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '__tests__') continue;
      walk(full);
      continue;
    }
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (rel === 'lib/admin.ts') continue;
    const src = fs.readFileSync(full, 'utf8');
    if (!src.includes('requireAdmin(')) continue;
    scanned++;
    for (const m of src.matchAll(BARE_CATCH)) {
      // A catch that binds the error AND passes it to one of the helpers is the fixed shape.
      const after = src.slice(m.index + m[0].length, m.index + m[0].length + 200);
      if (/adminErrorResponse\(|adminFailureOutcome\(|adminFailureStatus\(|isAdminRefusal\(/.test(after)) continue;
      failures.push({ rel, line: src.slice(0, m.index).split('\n').length });
    }
  }
}

for (const top of ['app', 'lib']) walk(path.join(root, top));

if (failures.length > 0) {
  console.error('requireAdmin wrapped in a catch that does not distinguish a refusal from an outage (Q-548).');
  console.error('A DB failure inside requireAdmin becomes 403, which reads as "your credential was revoked".');
  console.error("Use `catch (err) { return adminErrorResponse(err) }` (or adminFailureOutcome) from lib/admin.ts.");
  for (const f of failures) console.error(`  ${f.rel}:${f.line}`);
  process.exit(1);
}

console.log(`check-admin-guard-catch: ${scanned} file(s) call requireAdmin, none swallow the reason.`);

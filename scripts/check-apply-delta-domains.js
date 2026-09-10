#!/usr/bin/env node
// `applyDeltaBody` awaits one `runSQL` — one JS↔native bridge crossing — per row, so a pull costs
// O(total rows) SEQUENTIAL crossings. Q-28 measured that cost and deliberately deprioritised the
// batching refactor: at ~1,800 rows a full restore it was not worth touching the code path with the
// worst data-loss history in the repo.
//
// That verdict is conditional on the row count, and the entry says so in a tripwire:
//
//   > Add the HR series (or any other high-cardinality timeseries) to the delta and this item
//   > becomes urgent in the same PR.
//
// `oura_heartrate` is **111,246 rows** in production (measured 2026-09-10; Q-28 recorded 37,950 on
// 2026-08-02) and IS mirrored in the local SQLite schema — it is simply not one of the delta's
// domains, and has its own local write path. That single fact is the difference between today's
// 3,544 crossings and about 115,000: a factor of 32, and it grew while nobody was looking.
//
// **The tripwire was prose, and prose does not block.** Nothing made a PR adding a domain notice it.
// Meanwhile the list grew from twenty domains to thirty-one between 2026-08-02 and 2026-09-10, and
// the restore count went from ~1,800 to 3,544 — a 92% rise in five weeks that nobody was told
// about, because the only record of the old number was a sentence in a backlog entry.
//
// So: the domain list is frozen here. Adding one is not forbidden — it is made deliberate, and the
// failure message names the question to answer first (how many rows, at what cardinality).
//
// **Two honest limits.** The baseline is a committed file, so it can be regenerated to wave a
// domain through — same limit as every grandfather list in `scripts/`, same mitigation: the
// regeneration is an explicit line in the diff. And the scan is textual, so an access written
// `(delta as any).ouraHeartrate` is invisible to it. That shape cost a mutant during this check's
// own mutation pass, which read as a miss until the mutant was rewritten: a real domain addition
// types the delta and reads `delta.x` directly, so the gap is narrow, but it is a gap.
'use strict';
const fs = require('fs');
const path = require('path');
const { extractDomains } = require('./lib/apply-delta-domains');

const root = path.join(__dirname, '..');
const BACKEND = path.join(root, 'lib', 'local-store', 'sqlite-backend.ts');
const BASELINE = path.join(__dirname, 'apply-delta-domains.json');
const REL = 'lib/local-store/sqlite-backend.ts';

const extracted = extractDomains(fs.readFileSync(BACKEND, 'utf8'));
if (!extracted.ok) {
  console.error(
    extracted.reason === 'missing'
      ? `check-apply-delta-domains: no applyDeltaBody in ${REL}.`
      : `check-apply-delta-domains: could not find the end of applyDeltaBody in ${REL}.`,
  );
  console.error('The method was renamed or moved. Point this check at its new home rather than deleting it.');
  process.exit(1);
}
const found = extracted.domains;

const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const known = new Set(baseline.domains);

const added = found.filter((d) => !known.has(d));
const removed = baseline.domains.filter((d) => !found.includes(d));

if (added.length) {
  console.error(`applyDeltaBody gained ${added.length} delta domain(s): ${added.join(', ')}`);
  console.error(`  ${REL} issues one runSQL — one native bridge crossing — per row, sequentially.`);
  console.error('  Q-28 deprioritised batching that path on a measured row count. Adding a domain');
  console.error('  moves that count, and a high-cardinality timeseries (oura_heartrate was 111,246');
  console.error('  rows on 2026-09-10) invalidates the verdict outright.');
  console.error('  Before adding it to scripts/apply-delta-domains.json: how many rows does this');
  console.error('  domain contribute to a full restore, and is it per-day or per-sample? Record the');
  console.error("  answer on Q-28. If it is five figures, Q-28's batching is due in the same PR.");
  process.exit(1);
}

if (removed.length) {
  console.log(`check-apply-delta-domains: note — ${removed.length} baselined domain(s) no longer in applyDeltaBody (${removed.join(', ')}). Prune scripts/apply-delta-domains.json when convenient; this is not a failure.`);
}

console.log(`check-apply-delta-domains: ${found.length} delta domain(s) in applyDeltaBody, all baselined.`);

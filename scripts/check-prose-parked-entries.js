#!/usr/bin/env node
'use strict';
//
// An entry may not be parked by prose alone (TN-59).
//
// `next-item.js` parks an entry on a `Gate:`, an unmet `Needs:`, or the legacy prose marker
// `⛔ blocked: <reason>`. The first two are fields: a tool can read them, an implementer can act on
// them, and `check-backlog-pointers.js` already validates them. The third is a sentence. When it is
// the ONLY thing parking an entry, that entry is invisible — it sits in a PARKED list for a reason
// no field states, and nothing can tell whether the work is blocked or the glyph is decoration.
//
// That is not a hypothetical shape; it is what this check was written from. RV-99 sat parked in
// Lane B behind *"⛔ The blocking hazard was NOT the one the entry named"* — a CORRECTION saying the
// hazard the entry had named was the wrong one, which is the opposite of a reason not to build it.
// It had no `Gate:` and no `Needs:`, so it was startable the whole time.
//
// **This check deliberately does not guess which kind of marker it is reading** (TN-59's own
// caution, and the load-bearing part of it). Telling a real block from emphasis needs the sentence
// read, and a detector that tries teaches implementers to ignore the section it fills — the earlier
// bare-glyph rule matched 28 entries of which ~7 meant blocked, a 75% false-positive rate, and it
// parked `LA-49`, the entry describing the bug, for three weeks. So this reports the SHAPE, parked
// with nothing structured saying why, and a human picks the remedy:
//
//   - a real block  → give it a `Gate:` or `Needs:`, which is what the tools read
//   - emphasis      → reword so the glyph is not followed by "block" within 40 characters
//
// **Baselined at zero**, which is the strongest baseline a shrink-only check can have — the same
// shape as `check-aest-midnight-timezone.js`. There is no debt list to carry: any hit is new.

const fs = require('fs');
const path = require('path');
const { parseEntries, proseParkedOnly, NoQueueError } = require('./lib/backlog-entries');

const ROOT = path.resolve(__dirname, '..');
const BACKLOG = path.join(ROOT, 'docs/implementation-backlog.md');

let entries;
try {
  entries = parseEntries(fs.readFileSync(BACKLOG, 'utf8').split('\n'));
} catch (err) {
  if (err instanceof NoQueueError) {
    console.error(`check-prose-parked-entries: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const offenders = proseParkedOnly(entries);

if (offenders.length) {
  console.error(
    `check-prose-parked-entries: ${offenders.length} ${
      offenders.length === 1 ? 'entry is' : 'entries are'
    } parked by prose alone — no Gate:, no unmet Needs:\n`,
  );
  for (const e of offenders) {
    console.error(`  ${e.id}  ${e.title.slice(0, 90)}`);
    console.error(`      ${e.legacyBlocked}\n`);
  }
  console.error(
    'Each one is a real block or it is emphasis. If the work genuinely cannot proceed, give the\n' +
      'entry a `Gate: owner|device` or a `Needs: <id>` — those are what the tools read. If the glyph\n' +
      'is emphasis on a caution or a correction, reword it so the glyph is not followed by "block"\n' +
      'within 40 characters, and the entry returns to READY where it belongs.',
  );
  process.exit(1);
}

console.log(`check-prose-parked-entries: OK — ${entries.length} entries, none parked by prose alone`);

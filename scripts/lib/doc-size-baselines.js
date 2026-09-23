'use strict';
//
// Read the per-file documentation size baselines (LA-33).
//
// One file per tracked doc — `docs/doc-size/<the tracked path>.size`, holding a single number —
// rather than one shared map. The map was the repository's most frequent merge conflict by
// construction: every PR that raises a number edits the same two lines, so two open PRs conflict
// whether or not they are about the same document. Measured 2026-08-26, one PR was outrun by main
// four times in 35 minutes and every conflict was in that ledger, the backlog, or the changelog —
// never in code.
//
// The filename mirrors the tracked path so nothing is encoded or decoded and `ls -R` shows what is
// tracked. Extracted from the check script so these rules can be tested without a filesystem
// fixture per case, the same way `completion-words.js` and `entries-verdict.js` are.
const fs = require('fs');
const path = require('path');

const BASELINE_DIR = 'docs/doc-size';
const SUFFIX = '.size';

/**
 * Parse one `.size` file's contents.
 *
 * Throws rather than skipping. A baseline that silently fails to load is a ratchet that silently
 * stops ratcheting — the file would then be unbounded and nothing would say so.
 */
function parseBaseline(raw, relForMessage) {
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `${BASELINE_DIR}/${relForMessage}${SUFFIX} holds ${JSON.stringify(String(raw).trim())}; ` +
        `it must be one positive integer.`,
    );
  }
  return n;
}

/** `{ <tracked path>: <line count> }` from a `docs/doc-size` directory. */
function loadBaselines(absDir) {
  if (!fs.existsSync(absDir)) {
    throw new Error(`${BASELINE_DIR}/ is missing — the size baselines live there, one ${SUFFIX} file each.`);
  }
  const out = {};
  const walk = (dir, prefix) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, prefix ? `${prefix}/${e.name}` : e.name);
        continue;
      }
      if (!e.name.endsWith(SUFFIX)) continue;
      const rel = (prefix ? `${prefix}/` : '') + e.name.slice(0, -SUFFIX.length);
      out[rel] = parseBaseline(fs.readFileSync(full, 'utf8'), rel);
    }
  };
  walk(absDir, '');
  return out;
}

/** Where a given tracked file's baseline lives. The one place that spelling is decided. */
function baselinePathFor(trackedRelPath) {
  return `${BASELINE_DIR}/${trackedRelPath}${SUFFIX}`;
}

/**
 * How much slack is tolerated before the ratchet makes someone lower the number (RV-134).
 *
 * **The measured problem.** The slack rule failed on ANY gap, so every PR that shrank a tracked doc
 * by even one line had to edit `docs/doc-size/<path>.size` — and that is a one-line file two
 * concurrent PRs cannot both write. Measured on 2026-09-23: **23 re-merge commits across five
 * branches in one night**, nearly every one of them resolving a `.size` file where neither side was
 * wrong and the merged tree's own count was the answer. One branch paid it twelve times.
 *
 * So the conflicts were not caused by the ceiling. They were caused by SLACK DETECTION firing on
 * every PR, which made a shared one-line file part of almost every diff.
 *
 * **Why a band rather than removing the check.** Slack detection is the half that stops silent
 * regrowth: CLAUDE.md once sat **429 lines** under its number, meaning the most-read file in the
 * repo could grow by half its own length with nothing complaining. A band keeps that — 429 against
 * a ~900-line baseline is far outside any band — while a one-line shrink stops being everyone's
 * problem.
 *
 * **Why max(25, 2%) and not a flat number.** The tracked docs span 54 lines (a baton) to 27,000
 * (the backlog). A flat 25 would fail the backlog on 0.1% drift; a flat 500 would let a baton
 * double. The floor of 25 matters for the small files, the 2% for the large ones.
 *
 * Growth is unchanged and still fails at the first line over. The asymmetry is deliberate: growing
 * past the ceiling is the thing the ratchet exists to catch, and the fix there is moving prose.
 * Slack is a stale number, and a stale number that is 0.08% stale is not worth a merge conflict.
 */
const slackBand = (limit) => Math.max(25, Math.round(limit * 0.02));

module.exports = { BASELINE_DIR, SUFFIX, loadBaselines, parseBaseline, baselinePathFor, slackBand };

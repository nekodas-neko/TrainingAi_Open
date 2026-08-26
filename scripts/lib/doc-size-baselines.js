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

module.exports = { BASELINE_DIR, SUFFIX, loadBaselines, parseBaseline, baselinePathFor };

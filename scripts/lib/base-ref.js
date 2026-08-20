//
// Where a shrink-only ratchet finds "what `main` already has" (Q-424).
//
// **The defect this exists to remove.** A ratchet that compares the working tree against a committed
// number is order-dependent: two PRs can each be green against the number as it stood when their own
// job ran, and their merged result be over it. Nothing detects that — CI has deliberately no
// `push: [main]` trigger — so it surfaces later, on an unrelated branch, as an unrelated file being
// over an unrelated limit. It read as "your change was too big" when the change was eleven lines,
// and it cost four separate baseline resolutions in one session.
//
// The fix is to ask a different question. Not *"is this file over its number"* — which is a fact
// about `main` as much as about the branch — but *"did THIS BRANCH make it worse"*. A branch that did
// not grow the thing is not the branch that has to fix it, whatever `main` currently holds.
//
// On a `pull_request` run `actions/checkout` gives us the MERGE commit, so the working tree is
// already "branch merged into base" — exactly the state we want to measure. What we need alongside it
// is the base's own content, which is what this resolves.
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..', '..');

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/**
 * A ref naming the base this branch would merge into, or `null` when there is none to be had —
 * a shallow clone with no remote, a detached tree, an export. Callers degrade to baseline-only
 * behaviour rather than failing: a missing base is not a violation.
 */
function resolveBaseRef() {
  for (const ref of ['origin/main', 'FETCH_HEAD', 'main']) {
    try {
      git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      return ref;
    } catch { /* try the next one */ }
  }
  return null;
}

/**
 * The file's content at `baseRef`, or `null` when it does not exist there — which is the ordinary
 * case for a file the branch adds, and must not read as "zero lines".
 */
function fileAtBase(baseRef, relPath) {
  if (!baseRef) return null;
  try {
    return git(['show', `${baseRef}:${relPath}`]);
  } catch {
    return null;
  }
}

/** Line count as the ratchets measure it — `split('\n').length`, i.e. `wc -l` + 1. */
function lineCountAtBase(baseRef, relPath) {
  const content = fileAtBase(baseRef, relPath);
  return content === null ? null : content.split('\n').length;
}

/**
 * The rule itself, kept pure so it can be tested without a git repository (Q-424).
 *
 * `atBase` is `null` when there is no base to compare against, and the verdict then falls back to the
 * plain absolute comparison — a missing base must never turn a passing branch red.
 *
 * @returns {'ok'|'inherited'|'fail'}
 *   - `ok`        at or under the baseline
 *   - `inherited` over it, but no bigger than the base already is: real, and not this branch's doing
 *   - `fail`      over it, and this branch is what pushed it there
 */
function verdict({ count, limit, atBase }) {
  if (count <= limit) return 'ok';
  if (atBase !== null && atBase !== undefined && count <= atBase) return 'inherited';
  return 'fail';
}

module.exports = { resolveBaseRef, fileAtBase, lineCountAtBase, verdict };

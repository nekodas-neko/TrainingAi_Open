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
const fs = require('fs');
const os = require('os');
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

/**
 * A ratchet's own count, applied to the file as it stands at `baseRef` (LA-16).
 *
 * The line-count ratchets can use `lineCountAtBase`; the rest count OCCURRENCES with their own
 * matcher, and that matcher is the thing that must not be duplicated here — a base count computed by
 * a second, near-identical regex is worse than no base count at all, because it would disagree with
 * the working-tree count for reasons nobody could see. So the caller passes its own counting
 * function and it runs over the base content unchanged.
 *
 * `null` when the file does not exist at the base, which is the ordinary case for a file the branch
 * adds and must NOT read as a count of zero.
 */
function countAtBase(baseRef, relPath, countFn) {
  const content = fileAtBase(baseRef, relPath);
  return content === null ? null : countFn(content);
}

/**
 * The base branch's copy of `paths`, checked out into a temp directory — or `null` when there is no
 * base to be had (LA-16).
 *
 * **Why a whole tree rather than a file at a time.** Some ratchets are not per-file functions: the
 * memo check first scans every file to learn which components are memoised, then counts inline props
 * at their call sites. Feeding base *content* to a matcher built from the WORKING TREE's component
 * list gets one case wrong, and wrong in the unsafe direction — a branch that newly memoises a
 * component with pre-existing inline call sites would have those sites counted at the base too, and
 * so read as "inherited" when the branch is exactly what made them violations.
 *
 * Materialising the base means the same scan runs over the base's own everything, which is the only
 * way to answer honestly. One `git archive` is cheap; the caller must `cleanupBaseTree` it.
 */
function materialiseBaseTree(baseRef, paths) {
  if (!baseRef) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-base-'));
  try {
    const tar = execFileSync('git', ['archive', baseRef, ...paths], {
      cwd: root, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'],
    });
    execFileSync('tar', ['-x', '-C', dir], { input: tar, stdio: ['pipe', 'ignore', 'ignore'] });
    return dir;
  } catch {
    cleanupBaseTree(dir);
    return null;
  }
}

function cleanupBaseTree(dir) {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
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

module.exports = {
  resolveBaseRef, fileAtBase, lineCountAtBase, countAtBase,
  materialiseBaseTree, cleanupBaseTree, verdict,
};

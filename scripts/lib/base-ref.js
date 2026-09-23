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
 * git's own stderr for "that path is not in that tree" — the ordinary answer for a file the branch
 * adds. Measured against git 2.x on 2026-09-23; both wordings are live, the second when the path
 * exists in the working tree but not at the ref.
 */
const PATH_ABSENT_RE = /does not exist in|exists on disk, but not in/;

/**
 * `git show ref:path`, told apart from the failure that looks identical to it (OR-130).
 *
 * @returns {{ content: string|null, unreadable: boolean }}
 *   `content` is the file, or `null` when the path is genuinely not at that ref.
 *   `unreadable` is `true` when git failed for any OTHER reason — a bad ref, a missing object, a
 *   repack mid-run — which is *nothing known about the base*, not *absent from it*.
 *
 * **Why the distinction is load-bearing.** `verdict` maps a `null` base count to `'fail'`, so a read
 * failure became an accusation: a file byte-identical to `main` reported as this branch's new
 * violation, non-deterministically. It cost a session. This helper exists so a ratchet can no
 * longer confuse "the branch added it" with "we could not look".
 *
 * **It must not become a pass, and that is the whole of the CI question.** In CI the base comes from
 * `git fetch --depth=1 origin main || true`; when that fetch fails, `resolveBaseRef` finds no ref at
 * all and every `atBase` is `null`, which `verdict` turns into the plain absolute comparison — the
 * pre-Q-424 behaviour, and STRICTER than the base-aware one. Making an unknown base pass would
 * therefore not fix this bug; it would disable every base-aware ratchet in the repo on any fetch
 * blip. So an unreadable base keeps today's strict outcome and only stops lying about the reason.
 */
function showAtBase(baseRef, relPath) {
  try {
    // Its own spawn rather than `git()`, which pipes stderr to `ignore` — and the whole of this
    // function is reading that stderr. Capturing it there instead would change every other caller.
    const content = execFileSync('git', ['show', `${baseRef}:${relPath}`], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { content, unreadable: false };
  } catch (err) {
    const stderr = String((err && err.stderr) || '');
    if (PATH_ABSENT_RE.test(stderr)) return { content: null, unreadable: false };
    // `reason` is git's own words, or node's when the spawn itself failed. It is the whole point of
    // the warning below: the mechanism behind this failure has never been reproduced (see the note
    // on `fileAtBase`), so the next occurrence has to identify itself.
    const reason = (stderr.trim() || String((err && err.message) || 'unknown')).split('\n')[0];
    return { content: null, unreadable: true, reason };
  }
}

const warned = new Set();
function warnUnreadable(baseRef, relPath, reason) {
  const key = `${baseRef}:${relPath}`;
  if (warned.has(key)) return;
  warned.add(key);
  process.stderr.write(
    `  base-ref: could not read ${relPath} at ${baseRef} after ${ATTEMPTS} attempts.\n` +
    `            git said: ${reason}\n` +
    `            Treating it as absent, which is STRICT. If this file is unchanged from the base,\n` +
    `            that is this read failing and not your diff — quote this line rather than the\n` +
    `            ratchet's, which will name the file as if the branch had added it.\n`);
}

/**
 * A ref naming the base this branch would merge into, or `null` when there is none to be had —
 * a shallow clone with no remote, a detached tree, an export. Callers degrade to baseline-only
 * behaviour rather than failing: a missing base is not a violation.
 */
const DEFAULT_BASE_REFS = ['origin/main', 'FETCH_HEAD', 'main'];

/** `refs` is injectable so the no-base path can be tested; callers pass nothing. */
function resolveBaseRef(refs = DEFAULT_BASE_REFS) {
  for (const ref of refs) {
    try {
      git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      // OR-130: a resolvable commit is not a readable tree. A shallow or partial clone can hold the
      // commit object and not the tree behind it, and every per-file read would then fail one at a
      // time and read as a violation each time. Probe once here instead, so a base we cannot see
      // degrades to no base at all — which is the honest, and stricter, fallback.
      git(['cat-file', '-e', `${ref}^{tree}`]);
      return ref;
    } catch { /* try the next one */ }
  }
  // OR-130 left this path silent, and it is the one that actually fires (found 2026-09-23, the
  // fourth occurrence). `fileAtBase(null, …)` returns `null` without consulting git, so no
  // per-file warning can reach it — and `verdict` turns a `null` base into `'fail'`. The result is
  // a ratchet running in ABSOLUTE mode while its output still reads as a judgement about the
  // branch: `app/api/user/goals/route.ts`, byte-identical to `main`, named as this branch's new
  // violation.
  //
  // Saying so does not change any verdict. Absolute mode is stricter than the base-aware one and
  // stays exactly as it is; what changes is that a reader can tell which mode produced the answer
  // they are looking at, which is the whole of this defect.
  warnNoBase(refs);
  return null;
}

let noBaseWarned = false;
function warnNoBase(refs) {
  if (noBaseWarned) return;
  noBaseWarned = true;
  process.stderr.write(
    `  base-ref: no base branch resolved (tried ${refs.join(', ')}) — the ratchets are\n` +
    '            comparing against their BASELINE only, with no "is this the branch\'s growth?"\n' +
    '            check. That is STRICTER, not weaker: a file already over its number on main will\n' +
    '            be reported against whatever branch runs next. Re-run after `git fetch origin main`\n' +
    '            before treating any failure below as your own.\n');
}

/**
 * The file's content at `baseRef`, or `null` when it does not exist there — which is the ordinary
 * case for a file the branch adds, and must not read as "zero lines".
 */
/**
 * Retries, with a short blocking backoff between them. These scripts are synchronous by design —
 * they are `node scripts/check-x.js` in a CI step — so the sleep is `Atomics.wait`, which is the
 * only way to block a main thread without a busy loop.
 *
 * **The mechanism behind the failure this retries has NOT been reproduced.** It was seen once, in a
 * full `pnpm ci:local`, on a file byte-identical to `main`; 24 concurrent runs of the same script
 * reproduced nothing, with and without this change. So the retry is a reasonable guess and the
 * warning is the part to rely on — the next occurrence prints git's own reason, which is the
 * evidence nobody had the first time.
 */
const ATTEMPTS = 3;
const BACKOFF_MS = [40, 160];

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function fileAtBase(baseRef, relPath) {
  if (!baseRef) return null;
  let last = null;
  for (let i = 0; i < ATTEMPTS; i++) {
    if (i > 0) sleep(BACKOFF_MS[i - 1]);
    last = showAtBase(baseRef, relPath);
    if (!last.unreadable) return last.content;
  }
  warnUnreadable(baseRef, relPath, last.reason);
  return null;
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
/**
 * The file names directly inside `dirRelPath` at `baseRef`, or `null` when there is no base or the
 * directory does not exist there — which must NOT read as an empty directory, because "the base had
 * nothing" and "we cannot see the base" lead to opposite conclusions about what this branch added.
 */
function dirNamesAtBase(baseRef, dirRelPath) {
  if (!baseRef) return null;
  try {
    return git(['ls-tree', '--name-only', `${baseRef}:${dirRelPath}`])
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * `'ok'` · `'slack'` · `'inherited'` · `'fail'`.
 *
 * PS-34 added `'slack'`. The ratchet only ever pointed one way: a document under its number was
 * `'ok'`, so the difference stayed available for silent regrowth — CLAUDE.md sat **429 lines**
 * under baseline, meaning the most-read file in the repo could grow by more than half its own
 * length with nothing complaining. The shrink-only siblings (`check-hex-colors.js`,
 * `check-fetch-once-effects.js`, `check-component-size.js`) all fail on a stale-high number for
 * exactly this reason.
 *
 * **Only `check-doc-index-size.js` acts on `'slack'`.** The other eight callers branch on
 * `'inherited'` and `'fail'` alone, so it falls through to no action for them exactly as `'ok'`
 * did — and that is correct, because each of them already enforces shrink in a second loop over
 * its own baseline. Do not "finish the job" by making them handle `'slack'` too: they would then
 * report the same stale number twice.
 *
 * `'slack'` has no `inherited` escape hatch, and that asymmetry is deliberate. On the growth side
 * the fix is moving prose, so blaming a branch for `main`'s size was wrong (Q-424). On this side
 * the fix is editing one number, so "someone else shrank it" is no reason to leave the ceiling
 * wrong.
 */
function verdict({ count, limit, atBase }) {
  if (count === limit) return 'ok';
  if (count < limit) return 'slack';
  if (atBase !== null && atBase !== undefined && count <= atBase) return 'inherited';
  return 'fail';
}

module.exports = {
  DEFAULT_BASE_REFS, resolveBaseRef, fileAtBase, showAtBase, lineCountAtBase, countAtBase, dirNamesAtBase,
  materialiseBaseTree, cleanupBaseTree, verdict,
};

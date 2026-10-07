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
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/**
 * #2081. Every base read goes through ONE `git ls-tree` and ONE `git cat-file --batch`, however
 * many paths are asked for.
 *
 * It used to be one `git show <base>:<path>` per scanned file. A CPU profile of
 * `check-hex-literals.js` on the owner's Windows machine put 15,048 of 15,360 ms in `spawnSync`,
 * and every ratchet built on this file paid the same per-file spawn, in sequence, inside
 * `pnpm check:rules`. A process start is the expensive part; reading the bytes is not.
 *
 * **Why ls-tree first, and blobs by object id rather than `<ref>:<path>`.** `cat-file --batch`
 * answers `missing` for both "that path is not in that tree" and "that object is not in this
 * repository", and those are the two facts OR-130 exists to keep apart (see `showAtBase`). The tree
 * listing answers the first one alone: a path absent from it is ABSENT. Every object then asked of
 * `cat-file` is one the tree names, so a `missing` there can only mean *unreadable*. Feeding object
 * ids also keeps paths off stdin entirely, so spaces, unicode and newline-bearing names never meet
 * the line protocol, and `-z` keeps them unquoted in the listing.
 *
 * The listing is the WHOLE tree, filtered here, rather than pathspecs on the command line: Windows
 * caps a command line at 32,767 characters, and Next.js route segments such as `[id]` are glob
 * syntax to a pathspec.
 *
 * Content is byte-for-byte what `git show <ref>:<path>` printed for a blob — neither applies eol
 * conversion or filters — decoded as UTF-8 one blob at a time, which is what `encoding: 'utf8'` did
 * to the single blob `git show` returned.
 */
function runGit(args, input, maxBuffer) {
  const res = spawnSync('git', args, {
    cwd: root, input, maxBuffer, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  if (res.error) return { ok: false, reason: String(res.error.message || res.error) };
  if (res.status !== 0) {
    const stderr = String(res.stderr || '').trim();
    return { ok: false, reason: (stderr || `git ${args[0]} exited ${res.status}`).split('\n')[0] };
  }
  return { ok: true, stdout: res.stdout };
}

/** `path → { type, oid, size }` for every entry at `baseRef`, from one `git ls-tree -r -l -z`. */
function listTree(baseRef) {
  const res = runGit(['ls-tree', '-r', '-l', '-z', '--full-tree', baseRef], undefined, 256 * 1024 * 1024);
  if (!res.ok) return res;
  const entries = new Map();
  for (const record of res.stdout.toString('utf8').split('\0')) {
    if (!record) continue;
    // `<mode> SP <type> SP <oid> SP+ <size> TAB <path>`; size is `-` for a submodule.
    const tab = record.indexOf('\t');
    const [, type, oid, size] = record.slice(0, tab).trim().split(/ +/);
    entries.set(record.slice(tab + 1), { type, oid, size: Number(size) || 0 });
  }
  return { ok: true, entries };
}

/**
 * LA-132: the read's buffer has to fit the content, and node's default (1 MiB) did not —
 * `docs/implementation-backlog.md` passed 2.11 MiB, the spawn failed with ENOBUFS, and the read was
 * treated as absent. Here the sizes are known from the listing, so each `cat-file` gets a buffer
 * sized to what it will print, and the objects are split across processes at ~64 MiB so no single
 * buffer grows without bound. A repo-wide ratchet still fits in one.
 */
const CHUNK_BYTES = 64 * 1024 * 1024;

/** `oid → { content }` or `oid → { reason }`, for objects listed with their sizes. */
function readBlobs(objects) {
  const out = new Map();
  const chunks = [];
  let chunk = [];
  let bytes = 0;
  for (const o of objects) {
    if (chunk.length > 0 && bytes + o.size > CHUNK_BYTES) { chunks.push(chunk); chunk = []; bytes = 0; }
    chunk.push(o);
    bytes += o.size;
  }
  if (chunk.length > 0) chunks.push(chunk);

  for (const objs of chunks) {
    const size = objs.reduce((n, o) => n + o.size, 0);
    // Per object: a header line (oid, type, size — under 100 bytes) and a trailing newline.
    const res = runGit(['cat-file', '--batch'], objs.map((o) => o.oid).join('\n') + '\n', size + objs.length * 128 + 1024 * 1024);
    if (!res.ok) {
      for (const o of objs) out.set(o.oid, { reason: res.reason });
      continue;
    }
    const buf = res.stdout;
    let pos = 0;
    for (const o of objs) {
      const nl = buf.indexOf(0x0a, pos);
      if (nl < 0) { out.set(o.oid, { reason: `git cat-file output ended before ${o.oid}` }); continue; }
      const header = buf.toString('utf8', pos, nl);
      pos = nl + 1;
      const parts = header.split(' ');
      if (parts.length !== 3 || parts[0] !== o.oid) {
        // `<oid> missing` (or `ambiguous`): no content follows, so the stream stays in step.
        out.set(o.oid, { reason: `git cat-file: ${header}` });
        continue;
      }
      const len = Number(parts[2]);
      out.set(o.oid, { content: buf.toString('utf8', pos, pos + len) });
      pos += len + 1;
    }
  }
  return out;
}

/**
 * One read of many paths: `path → { content, unreadable, reason? }`, with the same three answers
 * `showAtBase` gives for one.
 */
function readAtBase(baseRef, relPaths) {
  const out = new Map();
  const tree = listTree(baseRef);
  if (!tree.ok) {
    for (const p of relPaths) out.set(p, { content: null, unreadable: true, reason: tree.reason });
    return out;
  }
  const wanted = new Map();
  for (const p of relPaths) {
    const e = tree.entries.get(p);
    if (!e) out.set(p, { content: null, unreadable: false });
    else if (e.type !== 'blob') out.set(p, { content: null, unreadable: true, reason: `${p} is a ${e.type} at ${baseRef}, not a file` });
    else wanted.set(e.oid, e.size);
  }
  const blobs = readBlobs([...wanted].map(([oid, size]) => ({ oid, size })));
  for (const p of relPaths) {
    if (out.has(p)) continue;
    const b = blobs.get(tree.entries.get(p).oid);
    out.set(p, b.content !== undefined
      ? { content: b.content, unreadable: false }
      : { content: null, unreadable: true, reason: b.reason });
  }
  return out;
}

/**
 * `git show ref:path`, told apart from the failure that looks identical to it (OR-130). Since #2081
 * it is `readAtBase` for one path — one read path, not two.
 *
 * @returns {{ content: string|null, unreadable: boolean, reason?: string }}
 *   `content` is the file, or `null` when the path is genuinely not at that ref.
 *   `unreadable` is `true` when git failed for any OTHER reason — a bad ref, a missing object, a
 *   repack mid-run — which is *nothing known about the base*, not *absent from it*. `reason` is
 *   git's own words, or node's when the spawn itself failed: the mechanism behind this failure has
 *   never been reproduced (see the note on `fileAtBase`), so the next occurrence has to identify
 *   itself.
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
  return readAtBase(baseRef, [relPath]).get(relPath);
}

/**
 * Both warnings go to **stdout**, and that is measured rather than stylistic (OR-134, 2026-09-23).
 *
 * `execFileSync`'s return value is **stdout only** — verified: a child writing to stderr does not
 * appear in it. The ratchet scripts are spawned that way by their own tests
 * (`strict-schema-inert.test.ts` asserts on exactly that return value), so a warning written to
 * stderr **cannot appear in anything the test sees or reports**.
 *
 * That is not a cosmetic detail. Across five occurrences of the goals-route flake, "no warning
 * fired" was taken as evidence three times — including the conclusion that the no-base path must be
 * the one firing. It was never evidence: the diagnostic was being written where the observer
 * structurally could not look. **A diagnostic in the wrong stream is worse than none, because its
 * silence reads as information.**
 */
const warned = new Set();
function warnUnreadable(baseRef, relPath, reason) {
  const key = `${baseRef}:${relPath}`;
  if (warned.has(key)) return;
  warned.add(key);
  process.stdout.write(
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
//
// #2559: `FETCH_HEAD` used to sit between these two, and in CI it was the one that answered. It
// means "whatever was fetched last", and in the Custom Rules job that was `actions/checkout`'s own
// fetch of the PR's MERGE commit — HEAD itself — because the step that fetches `origin/main` ran
// after most of the ratchets. Every base read then returned the branch's own content, `atBase`
// equalled `count` for every file, and growth past a baseline passed as "inherited". It is not a
// name for the base on any path we run, so it is gone; `isHeadItself` below refuses it anyway.
const DEFAULT_BASE_REFS = ['origin/main', 'main'];

function treeOf(ref) {
  try {
    return git(['rev-parse', '--verify', '--quiet', `${ref}^{tree}`]).trim();
  } catch {
    return null;
  }
}

/**
 * #2559, the second guard: a candidate that is HEAD under another name is not a base.
 *
 * The test is the TREE, not the commit — CI's merge commit and a candidate pointing at it share a
 * tree whatever their commit ids — and it holds for every candidate that is not a branch. So a
 * `FETCH_HEAD`, `ORIG_HEAD`, tag or raw sha whose tree is HEAD's is refused, which closes #2559
 * even if `FETCH_HEAD` ever comes back to the list.
 *
 * **A branch ref (`refs/heads/*`, `refs/remotes/*`) whose tree equals HEAD's is still accepted, and
 * that is deliberate.** It is the base genuinely having the same content as HEAD, which happens on
 * the paths we must not change:
 *   - `main` (or a fresh branch with no commits yet) checked out locally, where `origin/main` is
 *     HEAD — `pnpm check:rules` there reports an over-baseline file `main` already carries as
 *     inherited, as it always has, rather than as the developer's own violation;
 *   - a PR whose merge result is identical to `main`, which grew nothing and has nothing to fail.
 * CI never runs Custom Rules on a push to `main` (there is no `push` trigger, and the nightly
 * `schedule` skips that job); the nightly test run checks out `main`, where `origin/main` is HEAD
 * and is accepted by this same rule.
 * Refusing those would put them in strict no-base mode and fail them on `main`'s overages, which is
 * the order-dependence Q-424 removed. A branch ref cannot be the PR's merge commit: checkout writes
 * that to `refs/remotes/pull/<n>/merge`, which no default candidate names.
 */
function isHeadItself(ref) {
  let fullName = '';
  try {
    fullName = git(['rev-parse', '--symbolic-full-name', ref]).trim();
  } catch { /* a raw sha or an unknown name: not a branch */ }
  if (fullName.startsWith('refs/heads/') || fullName.startsWith('refs/remotes/')) return false;
  const head = treeOf('HEAD');
  return head !== null && treeOf(ref) === head;
}

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
      if (isHeadItself(ref)) continue;
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
  process.stdout.write(
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

/**
 * `path → content | null` for every path in `relPaths`, read in one batch (#2081). The retry covers
 * only the paths still unreadable after the previous attempt, and each one that stays unreadable
 * warns for itself, exactly as a lone `fileAtBase` did.
 */
function filesAtBase(baseRef, relPaths) {
  const out = new Map();
  let pending = [...new Set(relPaths)];
  if (!baseRef) {
    for (const p of pending) out.set(p, null);
    return out;
  }
  const reasons = new Map();
  for (let i = 0; i < ATTEMPTS && pending.length > 0; i++) {
    if (i > 0) sleep(BACKOFF_MS[i - 1]);
    const read = readAtBase(baseRef, pending);
    const next = [];
    for (const p of pending) {
      const r = read.get(p);
      if (r.unreadable) { next.push(p); reasons.set(p, r.reason); } else out.set(p, r.content);
    }
    pending = next;
  }
  for (const p of pending) {
    warnUnreadable(baseRef, p, reasons.get(p));
    out.set(p, null);
  }
  return out;
}

function fileAtBase(baseRef, relPath) {
  return filesAtBase(baseRef, [relPath]).get(relPath);
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
  return countsAtBase(baseRef, [relPath], countFn).get(relPath);
}

/**
 * `countAtBase` for many files in one read — what a ratchet scanning a directory should call
 * (#2081): collect the files it judges, then ask once. Same `null` meaning, same `countFn`.
 */
function countsAtBase(baseRef, relPaths, countFn) {
  const out = new Map();
  for (const [p, content] of filesAtBase(baseRef, relPaths)) out.set(p, content === null ? null : countFn(content));
  return out;
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
  return lineCountsAtBase(baseRef, [relPath]).get(relPath);
}

/** `lineCountAtBase` for many files in one read (#2081). */
function lineCountsAtBase(baseRef, relPaths) {
  return countsAtBase(baseRef, relPaths, (content) => content.split('\n').length);
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
  DEFAULT_BASE_REFS, resolveBaseRef, fileAtBase, filesAtBase, readAtBase, showAtBase,
  lineCountAtBase, lineCountsAtBase, countAtBase, countsAtBase, dirNamesAtBase,
  materialiseBaseTree, cleanupBaseTree, verdict,
};

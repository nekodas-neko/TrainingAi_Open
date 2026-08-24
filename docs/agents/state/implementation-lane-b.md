# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly, emoji included. That
> title is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread.

**Updated:** 2026-08-24 · **By:** the ninth Lane B run · **Next ID:** `LB-8`

## Now
**Nothing open.** Seven PRs merged: #391 (BF-10), #392 (Q-556), #394 (Q-499), #395 (Q-420), #397
(Q-491), #398 (LB-5), #400 (Q-477 slice 1). Each has a journal entry in `docs/overview/entries/`
dated 2026-08-24 — read those for what shipped, not this file.

**Q-499 fixed a real concurrency bug in `lib/sqlite/cache.ts`** (a failed fetch only notified the
in-flight-dedup's owning caller, never a joined waiter) — worth knowing if `cachedFetchCore` ever
looks suspect again.

## Next
`node scripts/next-item.js --lane B`, and **re-verify the premise first** — several items this run
had a much smaller real scope than their entry claimed (Q-491's "nine" was two; BF-10's "web-
reproducible" wasn't).

- **Q-403's `Lane: B` is wrong — it's Lane A's** (`app/api/coach/route.ts`). Un-corrected in the
  entry itself.
- **Q-499's worklist of ~10-18 other candidate cards isn't enumerated anywhere retrievable** —
  re-derive with a grep, then judge each by hand (high false-positive rate, per Q-491 below).
- **Q-477 has 37 files / 76 call sites left**, write paths next then display —
  `node scripts/check-client-today-timezone.js --print` is the maintained list.
- **⛔ Q-395's drawings still aren't in the repo.** Do not take Q-395a/b/c or Q-406's last two sites.

## Do not re-litigate
- **Q-359's remaining 12 sites, Q-555's `next/link`-can't-work fix shape, `lib/coach/**` = Lane A,
  `floor(pct/10)` RPE prefill** — all settled in prior runs, unchanged.
- **Radix `Collapsible`/`CollapsibleTrigger` already supplies `aria-expanded`/`aria-controls`**
  (confirmed against source, `asChild` included) — never a Q-491-class violator regardless of a
  chevron-grep's opinion.

## Owed (device / physical)
BF-10 and LB-5 this run (native-gated, APK-only). Carried from before: Q-328/Q-321/Q-486
(`getLocalStore` null in sandbox), the Q-389 print/scan/share checks, a TalkBack pass (now also
covering the two Q-491 fixes), Home's "Accent ring" style, Q-450/Q-418 (needs a Polar H10).

## Claimed paths
None held.

## Gotchas worth carrying
- **Shallow clone: `git fetch --unshallow origin` before every merge**, or `git fetch origin main`
  re-shallows and the merge dies with "refusing to merge unrelated histories."
- **A backlog conflict is almost always TWO DELETIONS** — read headings, keep neither side.
- **`git ls-remote origin 'refs/heads/<name>*'` before pushing** — an entry's suggested branch name
  can already be taken by a prior partial attempt; use a more specific name for a partial slice.
- **A file that "looks like a violator" from a text grep often isn't** — read the actual file (bit
  twice this run: Q-491's nine, and CLAUDE.md's own Q-480/Q-490 precedent).
- **StrictMode's dev double effect-invoke can mask or reproduce a real cache-layer race** — if a fix
  "doesn't work" in `pnpm dev` despite looking right, check that before assuming the fix is wrong.
  Toggling `next.config.ts`'s `reactStrictMode: false` for verification is fine — always revert it.
- **`projectOverview.md` sits ON its ratchet almost every PR** — re-measure with
  `check-doc-index-size.js`, compact an older paragraph rather than raising the baseline.
- **`get_check_runs` lags 30+ min; attempting the merge is the reliable check.**
- **`setsid nohup pnpm dev > log 2>&1 &` survives** a backgrounded shell dying with its task; login
  sometimes races the dev server's first compile, retry once rather than assuming it's broken.
- **Check `node_modules` matches the lockfile before diagnosing a build error** — this run's sandbox
  started with two packages missing despite being in `package.json`; a plain `pnpm install` fixed it.

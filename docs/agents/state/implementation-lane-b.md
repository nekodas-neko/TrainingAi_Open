# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly, emoji included. That
> title is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread.

**Updated:** 2026-08-24 · **By:** the eighth Lane B run · **Next ID:** `LB-8`

## Now
**Nothing open.** Nine PRs merged this run: #355, #358, #359, #361, #366, #367, #369, #370/#373,
#382, #383, #387. Narrative in
[`docs/handoff-2026-08-24-platform-lane-b-nine-prs.md`](../../handoff-2026-08-24-platform-lane-b-nine-prs.md).

**One thing is written and NOT shipped: Q-555.** Branch `fix/offline-tab-tap-native-fallback` is
pushed with no PR. The predicate and its four-state unit test are done; what is missing is a
reproduction of the failing tap, and its backlog entry now carries all three failed Playwright
attempts and why each was instructive. **Do not merge it without that** — the defect is a silent
no-op, so a fix that does nothing is indistinguishable from one that works.

## This run — every item has a journal entry in `docs/overview/entries/`

- **Merged, journalled, no state owed:** BF-6 (#355), the queue-truth tool (#358), the red spec
  (#359), LB-6 (#361), Q-486 (#366), Q-359's demotion (#367), LB-7 (#369), LB-3 (#370/#373),
  Q-321 (#382), Q-357 (#383), Q-328 (#387).
- **Q-357 emptied the memo baseline.** Any defeated call site is a regression now, not a debt row.
- **Q-321 was three sheets, not the one its entry named** — `log-value-sheet.tsx` had no check at all
  across seven fields.
- **Q-486 and Q-328 both carry a device gate.** Their failure paths cannot run in the sandbox.

## Next
`node scripts/next-item.js --lane B`, and **re-verify the premise first.** Four of the last seven
items I took were already shipped, not worth doing, or wrong about their own cause.

**⛔ Q-395's drawings are still not in the repository.** `unit-options.png` is nowhere in the tree.
**Do not take Q-395a/b/c**, and do not convert Q-406's last two call sites. Raised with the owner
2026-08-23.

Non-blocked candidates: **Q-556** (unblocked by Q-328 this run; its entry is rewritten because the
call site moved), **Q-499**, **Q-420**, **Q-407**. Q-555 as above.

## Do not re-litigate
- **Q-359's remaining 12 sites are not work** — the can-bite group is zero and the check script
  carries a per-site judgement. It stays queued only as the home of its ratchet.
- **Q-555's entry recommended a fix that cannot work** — `next/link` intercepts the click regardless,
  so there is no native navigation to restore. And a persistent offline pill already exists
  (`components/shell/offline-indicator.tsx`); the missing feedback is a response to the *tap*.
- **`lib/coach/**` is Lane A** — settled against the import trace, not the path list.
- **`floor(pct/10)` is the right RPE prefill** (Q-423, refuted on production data).
- **Q-354: a spec must TAP, not click**, and `toBeVisible()` does not mean in-viewport.
  `el.scrollIntoView({ block: 'center' })` then `page.touchscreen.tap()`.

## Owed (device / physical)
- **Everything shipped this run.** `getLocalStore` is null in the sandbox, so Q-328's tombstone +
  outbox + push confirmation, Q-321's three sheets' local writes, and Q-486's dead-local-DB path are
  all verified by reading and unit test only.
- A **test print** of the meal label, black band first (Q-389).
- The meal-label **camera scan** and the Web Share hand-off (Q-389).
- A **TalkBack pass** over More → Goals and More → Edit Profile (Q-261, Q-350).
- Home with the **"Accent ring"** style (Q-281) — the band word is 7.5 px.
- **Q-450's device path**, **Q-418's whole point** (needs a Polar H10).

## Claimed paths
None held. This run released `lib/local-store/dead-letter-signal.ts` (Q-486) and
`lib/local-store/{index,sqlite-backend}.ts` (Q-328's removal of the dead `deleteActivityLog`) — both
Lane A paths, claimed here while their branches were open, both merged.

## Gotchas worth carrying
- **This clone is SHALLOW and `git fetch origin main` RE-SHALLOWS it** — `origin/main` then reads as
  one commit and the merge dies with *"refusing to merge unrelated histories"*. Nothing is wrong with
  the repo. `test -f .git/shallow && git fetch --unshallow origin` before every merge.
- **A backlog conflict is almost always TWO DELETIONS — read the headings, keep NEITHER side.** Five
  times in one session.
- **Before pushing a branch, `git ls-remote origin 'refs/heads/<name>*'`.** Three names I reached for
  were already taken by merged branches; force-pushing over another lane's is forbidden.
- **Read the CI *server log* before pushing a fix for a CI-only failure.** #359's answer
  (`POST … 400` ×3) was sitting there while I pushed a fix for the wrong cause.
- **A spec stubbing an `/api/` route needs `test.use({ serviceWorkers: 'block' })`** — the SW
  re-issues those with no method filter and Playwright never sees them. Never `expect` inside a
  `page.route` handler: the throw skips `fulfill` and breaks the request you are asserting about.
- **Mutation-check every guard, and strip comments before asserting on source.** A Q-328 assertion
  passed with the call deleted because the method name was still in the comment above it.
- **`projectOverview.md` sits ON its ratchet and other sessions raise it too.** Re-measure with
  `node scripts/check-doc-index-size.js`; never count by hand. Need room → compact the shipped-notes
  section, do not raise again (recorded in `doc-size-baseline-history.md`, filed for Orchestrator).
- **Check for a running compaction sweep before starting one** — mine duplicated #381 and was dropped.
- **`get_check_runs` lags 30+ min; attempting the merge is the reliable check.**
- **A backgrounded `pnpm dev` dies with its task** — `setsid nohup pnpm dev > log 2>&1 &` survives.
  A long-lived one also DEGRADES; restart it before believing a heavy spec's failure.

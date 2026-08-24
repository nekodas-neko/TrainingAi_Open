# Lane B, 2026-08-24 — nine merged PRs, and the two things that cost the most

**Successor session title: `🚧 Implementation Agent (B) 🟢`** — exactly, emoji included.

## What this session was for

Work the Lane B queue top-down, one verified PR at a time, on the standing instruction *"continue
until all of Lane B's backlog is complete"*. Nine PRs merged. Nothing is left open.

## What shipped

| PR | Item | What it does |
|---|---|---|
| #355 | BF-6 | "Finished logging" moves under the meals; End of Day last. Zero presses in seven weeks. |
| #358 | queue truth | `next-item.js` says what is actually startable. |
| #359 | red spec | `recipe-url-to-meal.spec.ts` was red on `main` — two stacked defects, below. |
| #361 | LB-6 | Sixteen writes revalidate **after** their push, not around it. New Custom Rules step (55). |
| #366 | Q-486 | The four swallowed workout `queueMutation` calls warn and toast. |
| #367 | Q-359 | Moved down: its remaining sites are judged not worth converting. |
| #369 | LB-7 | The recipe attribution is asserted by its row, not by text position. |
| #370 | LB-3 | The unreachable day-overlay sheet retired; two affordances ported to `/health/day`. |
| #373 | — | (LB-3's sibling.) |
| #382 | Q-321 | Body-metric bounds asked at the keyboard, on **three** sheets. |
| #383 | Q-357 | Memo-stability baseline **emptied** — all four defeated call sites cleared. |
| #387 | Q-328 | The activity delete goes through the outbox, so it works offline. |

Each has a journal entry in `docs/overview/entries/`; read those rather than re-deriving anything.

## The two decisions worth not re-litigating

**Q-359 is not work, and its queue position was wrong.** It headed the READY list because it once
reported 36 fetch-once effects carrying Q-402's bug, some in the permanently-mounted shell where the
bug bites. Four slices later that group is **zero**; the 12 remaining all unmount on navigate, and
`check-fetch-once-effects.js` carries a per-site judgement that none is worth converting — a
subscription on a key nothing writes while the component is up adds a refetch with no reader waiting.
It stays queued as the home of its ratchet. #367 moved it down and banners it.

**Q-321's fix belonged on three sheets, not the one the entry named.**
`app/session-select/components/log-value-sheet.tsx` had **no** bounds check across seven fields, and
`water-log-sheet.tsx`'s validator *quarantines* rather than coerces, so an over-5,000 ml entry
dead-lettered into a badge the user cannot act on. That was the one actually costing something.

## The two things that cost the most time

**1. A CI-only failure whose answer was in the CI server log the whole time (#359).** The spec
asserted inside a `page.route` handler, so a failed expectation skipped `route.fulfill` and broke the
request it was asserting about; the error surfaced three assertions later as a strict-mode locator
violation. I fixed that and said the payload difference was "still unknown" — it failed again. The
log had `POST /api/nutrition/scan 400` ×3. Underneath was a second defect: **`public/sw-template.js`
re-issues every `/api/` request with no method filter**, so once the worker controls the page
Playwright never sees the request, which is why it passed locally and failed 3-of-4 on CI. Both rules
are now in `e2e/README.md`. **Read the CI server log before pushing a fix for a CI-only failure.**

**2. `projectOverview.md` and the doc ratchets.** The file sits exactly on its shrink-only baseline
and *two* sessions raised it on the same day. Three rounds of shaving prose to fit a four-line note is
a file past its maintenance point — recorded in `docs/doc-size-baseline-history.md` with the note that
the next session needing room should **compact the shipped-notes section rather than raise again**.
Filed for Orchestrator. Related: I started a compaction sweep of `docs/overview/entries/` and dropped
it as a duplicate of another session's #381, which folded 60 against my 30 and caught a fourth link
trap I had not hit. **Check `git ls-remote origin 'refs/heads/chore/compact*'` before starting one.**

## Deliberately not done

- **Q-555 — the fix is written, unmerged, and unverified.** Branch
  `fix/offline-tab-tap-native-fallback` is pushed with no PR. Its backlog entry is rewritten with
  everything measured, including that the entry's own recommended fix shape **cannot work** (these are
  `next/link` anchors, so Next intercepts the click regardless) and that a persistent offline pill
  already exists. What blocks it is that **nobody has reproduced the failing tap** — three Playwright
  attempts, each failing differently, all written up in the entry. Do not ship it without that.
- **Q-395a/b/c and Q-406's last two call sites** — `unit-options.png` and the Q-395 drawings are
  still not in the repository. Raised with the owner 2026-08-23; still absent.

## Owed on device

Everything shipped this session took the **web** path. `getLocalStore` returns null in the sandbox,
so for Q-328 the local tombstone, the queued mutation and the push confirmation are verified by unit
test and by reading only; for Q-321 the same is true of all three sheets' local writes; and Q-486's
failure (a dead local SQLite) cannot be induced here at all. Q-486's Known-Issues row and Q-328's
entry both carry that. Nothing was checked on the S25.

## Pickup prompt

Read in this order: `projectOverview.md` → `docs/agents/state/implementation-lane-b.md` → this
handoff → `docs/domains/<pillar>/README.md` for whatever you take.

```
You are the Lane B Implementation Agent for TrainingAi_Open. Rename this session so its title is
exactly `🚧 Implementation Agent (B) 🟢` (get_session with session_id omitted returns your own id,
then set_session_title). Develop on a feature branch, open a PR, merge when CI is green.

Read projectOverview.md, then docs/agents/state/implementation-lane-b.md, then
docs/handoff-2026-08-24-platform-lane-b-nine-prs.md.

First action: `node scripts/next-item.js --lane B`, and RE-VERIFY the top entry's premise against
current main before writing any code. Four of the last seven items I took turned out to be already
shipped, not worth doing, or wrong about their own cause — that check is the highest-value thing you
will do.

Constraints that will otherwise cost you an hour each:
- `git fetch origin main` RE-SHALLOWS this clone and the next merge dies with "refusing to merge
  unrelated histories". Run `test -f .git/shallow && git fetch --unshallow origin` before every merge.
- A conflict in docs/implementation-backlog.md is almost always TWO DELETIONS — read the headings and
  keep NEITHER side. It happened five times in one session.
- Rebuild packages/shared/src/changelog.ts from `git show origin/main:...` and prepend; never splice a
  conflict hunk. Expect to re-bump the version on every rebase.
- projectOverview.md is on a shrink-only ratchet and sits ON its number. Re-measure with
  `node scripts/check-doc-index-size.js`; never count lines by hand. If you need room, compact the
  shipped-notes section — do not raise the baseline again.
- `get_check_runs` lags reality by 30+ minutes. Attempting the merge IS the reliable green check.
- Before pushing a branch, `git ls-remote origin 'refs/heads/<name>*'` — several names are already
  taken by merged branches, and force-pushing over another lane's is forbidden.
- Quote `pnpm check:rules`'s "Ran N of N" count, never the word "pass".

Do NOT take Q-395a/b/c or Q-406's last two call sites: the drawings are still not in the repo.
Q-555 has a written-but-unverified fix on `fix/offline-tab-tap-native-fallback`; its entry says what
is left. Everything shipped this session is owed a device check.
```

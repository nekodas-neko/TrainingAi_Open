# Lane B session close — nine PRs, and Q-555 handed over unfinished

**Branch:** `docs/wrap-lane-b-2026-08-24` · **Lane B** · docs only

Wrap-up for the eighth Lane B run. Narrative:
[`docs/handoff-2026-08-24-platform-lane-b-nine-prs.md`](../../handoff-2026-08-24-platform-lane-b-nine-prs.md).

## What this commit does

- **The handoff doc**, with the pickup prompt for the successor.
- **The baton rewritten in full** (never appended) — 88 lines, down from 108.
- **`projectOverview.md`:** shipped notes for Q-328, Q-357 and Q-321, and **Q-488 amended rather than
  archived.** Its substance is fixed — Q-328 made the delete write locally first — but the archive
  rule says a fix that shipped without a device check stays, and that check is exactly what is owed.
  Its line numbers were also dead twice over, since the call site moved in LB-1 and again in LB-3.
- **Q-555's entry rewritten** with everything measured, because its recommended fix shape does not
  work and the next session would otherwise spend the same hour discovering that.

## Q-555, stated plainly

The fix is written and pushed on `fix/offline-tab-tap-native-fallback` with **no PR**, because
**nobody has reproduced the failing tap.** Three Playwright attempts failed for three different
reasons, all recorded in the entry — the most instructive being that tapping from a settled `/health`
measures `TabShell`'s in-app tab switch, where the URL also does not change, which is what made a
first probe read as a reproduction when it was not.

Shipping it would have been the exact thing this repo's rules forbid: the defect is a **silent
no-op**, so a fix that does nothing looks identical to a fix that works. Three things it did
establish, and they are the reusable part:

1. The entry's own recommendation — stop suppressing the native navigation — **cannot work.** These
   are `next/link` anchors; Next's handler intercepts and calls `router.push` regardless.
2. Forcing a real navigation does work but is worse: measured, it lands on
   `chrome-error://chromewebdata/`, throwing away the cached screen that offline is the one thing
   still working.
3. A persistent *"Offline — showing saved data"* pill already exists in the root layout. The missing
   feedback is a response to the **tap**, not a statement about the connection.

## Verification

`pnpm check:rules` — Ran 55 of 55. `check-doc-links` clean. Docs only; no runtime change.

## Not exercised

Nothing to run. Everything the session shipped is owed a device check — enumerated in the baton's
Owed section and on Q-486's and Q-488's rows.

# Review sweep 49 — the deload confirm evicts neither key the screen in front of you reads

**Date:** 2026-09-06 · **Agent:** 📖 Review · **Branch:** `claude/review-agent-sweep-49` · Docs only.

The owner reported pages not resetting from cache after a change, naming food adds and deload
selection. The deload half reproduces at mechanism level, two defects stacked: the Home confirm
calls `invalidatePrescriptionChanged()` **without a sessionId**, and the group's own conditional
makes that a no-op for every `workout-card:<id>` — the exact keys Q-117's fix comment, sitting
directly above the call, says were the problem — while `next-session`, Home's recommendation key,
is not in the group at all (RV-49). The reader half: three raw seed-only
`readCacheSync('workout-card:<id>')` sites — two self-documented — can never revalidate, so a
missed eviction is 6 hours of hard staleness rather than one paint (RV-50, `Needs:` RV-49).

Q-117 was "fixed" on the caller that passes the id; the surface it was filed about still misses.
Fifth instance this quarter of a fix comment testifying against its own call site.

**The nutrition half came back clean at source**, with method: all nine food-add surfaces close the
callback loop (`onLogged` with the written entity, per the mutation-callback contract), the
nutrition write group evicts eleven keys including `home-day-timeline`, Home repaints it via
`useInvalidationRefetch`, and `use-day-entry-mutations` has no food branch by design. The 80
`readCacheSync` sites were scanned mechanically; the 25 candidates reduce to the three
`workout-card` reads once fallback-paired seeds are discarded. If the owner's food-add symptom
survives RV-49, one reproduction (which screen added from, which screen stale) routes it — most
plausibly to Home immediately after the add, which is RV-49's mechanism, or to the APK's
local-store path, which this sandbox cannot exercise.

**Not exercised:** rendered repaints in a browser (mechanism is source-proven; the fix's test
should carry the Playwright assertion) and the device.

Write-up:
[`docs/reviews/2026-09-06-deload-confirm-eviction-gap.md`](../../reviews/2026-09-06-deload-confirm-eviction-gap.md).

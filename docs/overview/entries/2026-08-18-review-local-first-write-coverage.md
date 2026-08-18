# 2026-08-18 — Review: is Q-488 the only one?

**Agent:** Review 📖 · **Branch:** `claude/review-server-read-screens` · **Docs-only.**
**Filed:** nothing; **bounds Q-488** · **Review:** [`docs/reviews/2026-08-18-local-first-write-coverage.md`](../../reviews/2026-08-18-local-first-write-coverage.md)

## Why

Q-488 found the activity delete updating the server and caches but never the local store, and named
the shape: a server-reading screen writing to a local-first domain. An implementer taking it needs to
know whether that is one handler or a class — those are different jobs.

## The check that does not work

Asking whether the **file** touches the local store reports `health-content.tsx` — the Q-488 file —
as fine, because it uses the store elsewhere and just not in the delete handler. **File-level
coverage says nothing about a handler**, and this check's own output proves it.

## Result

Auditing each mutating write for a local-store call *inside the handler*: `injury-sheet` (PATCH,
DELETE), `nutrition-content` (DELETE), `quick-edit-log-sheet` (PATCH), `saved-meals-sheet` (DELETE),
`manage-supplements-sheet` (DELETE, PATCH), `done-activity-screen` (PATCH) — **all eight write
locally.** Only Q-488's handler does not.

**Q-488 is the sole instance; its fix is one handler, not a class sweep.**

## Two server-only writers, both clean

The Health Connect metrics PATCH arrives via the pull (chain verified in sweep 23). And
`meal-plan-setup-sheet.tsx:387` creates saved meals server-only, which is fine because `saved_meals`
is **push-only** in the outbox and kept current by **hydrate-on-read** — `saved-meals-sheet.tsx:111`
hydrates from the API, and `food-logger-sheet.tsx:196` falls back to it when the local lookup misses.

So **"no pull mapping" is not evidence of a gap.** A future audit testing pull coverage alone would
file that one wrongly.

## Not verified

Static audit and source reading; not on the APK. The handler-window heuristic reads a fixed span
around each call site, so a local write further away would be missed — for the eight above the call
is within a few lines.

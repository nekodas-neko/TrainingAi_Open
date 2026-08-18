# 2026-08-18 — Review: the rest of the render rules

**Agent:** Review 📖 · **Branch:** `claude/review-render-hot-paths` · **Docs-only.**
**Filed:** nothing · **Review:** [`docs/reviews/2026-08-18-render-hot-paths.md`](../../reviews/2026-08-18-render-hot-paths.md)

## Why

Sweep 26 audited memo stability and listed what it had not covered: Zustand selector breadth, timers
in orchestrators, `readCacheSync` in a timer-rendering body, and `key={index}` in editable lists.

## All four held

- **`key={index}`** — 85 occurrences, but filtering to lists that are **both editable and deletable**
  gives **zero**; the known editable lists key on `meal.id`, `item.id`, `style.id`, `program.id`.
  Index keys on a static list are correct React and reporting the 85 would have been wrong.
- **Orchestrator timer** — `workout-screen.tsx:797` holds a `setInterval` that writes
  `recordTraceSample(...)` to a module singleton with no `setState`. That is the pattern the rule
  wants, and the comment above it says so.
- **Zustand selector breadth** — the orchestrator's `useShallow` pick is 62 fields, and the hot-path
  *values* (`perSetWeights`, `rpeValues`) are **absent** from it; only their actions are picked, and
  action references are stable. The leaves read the values via their own narrow selectors.
  **Counting fields in a pick is not the test — actions vs values is.**
- **`readCacheSync` in a render body** — 25 hits outside an effect/callback, three in the orchestrator,
  all false positives. The first is the **comment stating the rule**: *"readCacheSync must never live
  in that path"*, reported as a breach of that rule.

## The standing lesson, six sweeps running

Every mechanical check in this sweep over-reported, and one flagged the prose of the rule it was
checking. **The grep finds candidates; the handler decides.** A review that filed the raw counts would
have produced three wrong entries and one absurd one.

## Result

Combined with sweep 26, the render section is in good shape: 64 of 66 memos stable, hot-path store
reads in leaves, the orchestrator's timer writing a singleton, editable lists keyed by id. Q-490 is
the only open item.

## Not verified

Static analysis, no profiler, not on the APK. The editable/deletable classifier reads a ±40-line
window around each `key={index}`; the 85 occurrences themselves are exhaustive.

# 2026-08-03 — a phase transition could repaint the phase it just left

_Branch `fix/prescription-cache-staleness` · v1.252.6 · domain `workouts` · closes backlog Q-53_

`/api/ai-periodization/session/[id]` ships `Cache-Control: private, max-age=60,
stale-while-revalidate=120` — confirmed live on the dev server, not assumed. Anything reading it with
a bare `fetch` inside that minute gets the browser's copy, which after a phase transition is the
*previous* phase.

## (a) — the fix is a deletion, and the defect was worse than filed

Q-53 described `onPhaseChanged` as "missing the `cache: 'no-store'` override". Reading it showed
something else:

```tsx
onPhaseChanged={() => {
  if (!programSessionId || programPhaseMode !== 'ai_dynamic') return;
  setPeriodizationLoading(true);
  fetch(`/api/ai-periodization/session/${programSessionId}`)   // ← bare
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) setPeriodization(d); })
    ...
  refreshExercises();     // ← already does all of this, correctly
}}
```

`refreshExercises()` on the next line already calls `invalidatePrescriptionChanged` +
`fetchExercises` + `loadPeriodization({ afterWrite: true })`. So the bare fetch was **redundant, and
strictly worse than the call it duplicated** — no cache seed, no `no-store`, no cache write-back, no
404 stranded-session-id recovery, and critically **no `periodizationReqRef` guard**. Two concurrent
requests to the same endpoint, one of them unguarded: the stale one could resolve *last* and
overwrite the fresh state.

Adding `cache: 'no-store'` to it, as filed, would have fixed the staleness and left the race. It is
deleted instead. The guard and the `refreshExercises()` call are unchanged, so behaviour for
non-`ai_dynamic` programs is identical.

## (b) — one trigger site never invalidated

The `aiPrescriptionPending` effect refreshed its *own* two views on success and stopped there. Every
other trigger site (`:497`, `:508`, `:1532`, and both in `ai-prescription-card.tsx`) calls
`invalidatePrescriptionChanged(programSessionId)` first. This one never did — so a prescription
generated there, **including one that auto-applied a phase transition**, left session-select, the
done screen's "Next workout" card and the home seeds repainting pre-transition state from cache.

That group is not a small blast radius: it clears `workout-data`, `next-session-prescription`,
`workout-card:<id>`, `ai-periodization-session:<id>`, the AI-periodization group, and the legacy
home seeds. Missing it is the exact shape of the project's most-repeated bug class.

## (c) — investigated, unreachable, no code written

The plan flagged `mood-checkin-sheet.tsx`'s duration-preset handler as medium-confidence: it POSTs,
invalidates, but has no `afterWrite` refetch. Traced it — it doesn't need one. It has no
periodization view of its own, and the invalidation clears every downstream key.

The only way staleness could survive is a **bare** reader of that endpoint inside the 60s window.
After (a), there are exactly two readers left:

| Reader | Safe because |
|---|---|
| `workout-screen.tsx:457` (`loadPeriodization`) | passes `cache: 'no-store'` on every write path |
| `mood-checkin-sheet.tsx:107` | `cachedFetch` on `ai-periodization-session:${sessionId}` — the same key the invalidation group clears |

So deleting the bare fetch in (a) is what closes (c) too. Taking the plan's explicit branch: noted,
not fixed.

## Verification

- Route header confirmed live: `private, max-age=60, stale-while-revalidate=120` — the window is
  real.
- Every reader of the endpoint enumerated by grep and read individually (table above).
- Dev server with the program flipped to `ai_dynamic` (the seed is `manual`, so both fixed paths are
  gated off by default): `/workout` renders 200, the periodization route returns real state, no
  runtime errors. Restored to `manual` afterwards.
- Full suite green first pass (384 files / 2965 tests), typecheck clean, lint at its 120-warning
  baseline with no new warnings.

## Not verified

**The staleness itself, end to end.** Reproducing it needs a real phase transition and a second read
inside a 60-second window — the timing is not drivable from the sandbox, and the seed program has no
transition history. What is proven is that the window exists, that the removed call sat inside it,
and that every remaining reader either bypasses it or goes through the invalidated cache.

Also not verified on device. This is a pure client-side change and ships through Railway with no APK.

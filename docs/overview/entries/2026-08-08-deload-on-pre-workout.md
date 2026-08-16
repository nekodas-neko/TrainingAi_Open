## 2026-08-08 — `feat/deload-on-pre-workout` — Q-109-followup: Deload moves to where the session is

Closes **Q-109-followup**. Q-109's calculation half shipped earlier (`buildWorkoutExercises` applies
`deloadOverrideForGoal()` when Deload is picked); this is the relocation the plan deferred as
"low-value to ship before the calculation gap itself is closed". Confirmed with the owner first:
Deload leaves Home entirely — Home keeps Rest / Full.

### What moved

- **Home** (`recommendation-card.tsx`): the three-choice grid is now two — Rest / Full. `onDeload`,
  `handleDeload` and the `TrendingDown` import are gone. Home keeps the two choices that are about
  *whether to train at all*; intensity is a property of the session.
- **Pre-workout** (`components/workout/deload-toggle.tsx`): a Full / Deload radio group styled to
  match `SessionDurationPicker`, since they answer the same question — what shape is today's
  session. It carries a "Deload suggested" label when the readiness engine is asking for one, read
  from the same `next-session` seed Home paints from. **The label never gates the choice**; a cache
  miss means no label, never a wrong one.

### The part that wasn't a UI move

`aiDeload` was a **URL param**, fixed for the life of the screen and read at eight places in
`workout-screen.tsx`'s data layer (cache key, seed, fetch params, `isAnyDeload`, `intensityMode`).
A toggle needs it to be live state. It is now seeded from the URL by `useDeloadChoice()` and flipping
it re-keys the workout-data cache and refetches with `aiDeload=1` — **exactly the request the old
navigation made**, verified in the browser:

```
workout-data requests after toggling ON: ["/api/workout-data?tab=<id>&aiDeload=1"]
```

The old URL entry point still works unchanged, so any existing link or back-navigation behaves as
before.

### Placement bug caught during verification, not after

First attempt put the toggle inside the same `prescription && prescriptionStatus !== 'consumed'`
branch as the duration picker. The browser check showed it never rendering — and the reason matters
more than the fix: **gated that way, there is no way to pick Deload before a prescription exists**,
which is precisely the case Home's button used to cover. It now sits above that branch, gated only
on the ai_dynamic path (the one the server honours `aiDeload` on) and on there being no automatic
deload phase already active.

### Paying for the lines (Q-138)

`workout-screen.tsx` is a recorded size hotspot and the ratchet failed at 1878 vs its 1861 baseline.
Rather than trim comments to squeak under, took **Q-138's own proposed split for this file**:
`WorkoutLoadError` extracted to `components/workout/workout-load-error.tsx`, and the deload state
into the `useDeloadChoice` hook. **1861 → 1850**, and the baseline in `check-component-size.js` is
shrunk to 1850 so the gain can't be spent later.

### Verification

- `tsc --noEmit` clean · `eslint` 0 errors · full suite **413/413 files, 3261/3261 tests** · custom
  rules pass.
- **Exercised in the browser** at the S25 viewport as a logged-in user: Home renders **0** buttons
  labelled Deload; the pre-workout toggle renders; clicking Deload fires the `aiDeload=1` refetch and
  flips `aria-checked`. The seeded program had to be switched to `ai_dynamic` to reach the toggle at
  all (it seeds as `manual`) — **restored to `manual` afterwards**.

### Not exercised

No device run — no native, safe-area, gesture or notification path.

**The deloaded prescription itself was not compared against a full one.** The check proves the toggle
requests `aiDeload=1` and that the screen re-fetches; it does not prove the returned weights differ,
because the seeded local DB has no generated prescription to regenerate. That half is Q-109's already
shipped calculation path, unchanged here.

`phaseStatus?.isDeloadActive` (an automatic deload phase) hides the toggle, on the grounds that the
program is already deloading and a second manual one would compound. That branch was **not** rendered
in testing — the seeded program has no active deload phase.

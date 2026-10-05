# 2026-09-29 — Q-231: the card stays, the Oura plumbing goes

**Branch:** `chore/q231-exercise-detected-card` · v1.485.2.

Q-231 was owner-approved, re-sequenced by Lane A the day before, and told this lane to **remove the
"Exercise detected" card**. It should not be removed, and the entry's own reasoning is what showed it.

## The owner's yes was conditional, and the condition does not hold

His words: *"If its not being used because we don't use the oura sync then get rid of it."* The entry
then argued the condition was satisfied — *"retiring this card removes nothing he currently sees
working"* — on the basis that the card reads `oura_workouts`, written only by the retired Oura Cloud
sync, while the live auto-detection he sees writes `activity_logs` from the BLE classifier.

Two pipelines, correctly separated. **There is a third.** `pendingSessions` — the list this card
renders — has a second writer that has nothing to do with the Cloud sync:

- `AutoDetectionProvider` is mounted in **`app/layout.tsx:188`**, the root layout, on every route.
- It calls `startAutoDetection()` **unconditionally on native**. Nothing gates it; there is no setting.
- `endSession()` turns a session passing the distance / pace / motorised-P80 gates into a
  `pendingSessions` entry. `inflight-teardown.test.ts` calls that entry *"the popup"* outright.
- **`ExerciseDetectedCard` is the only surface that renders one.** `exercise-review-sheet.tsx` resolves
  a session by id, and that id comes only from this card's `onReview(session.id)`.

So removing the card would have orphaned the live phone detector **silently** — no compile error, no
failing test anywhere in the suite. The walk would be detected, finalised, stored, and never shown.

## What shipped instead

His instruction, executed faithfully once the premise is corrected: **the Cloud plumbing goes, the card
stays.** This is not a new product decision — the Oura half is genuinely unusable (`upsertOuraWorkouts`
is not merely callerless, it no longer exists in the repo, so `oura_workouts` cannot gain a row), and
the half he can still see working is untouched.

- **Card** (128 → 85 lines): the `oura-unreviewed-workouts` fetch, the ingest effect,
  `markReviewedOnServer`, and its `invalidateOuraWorkoutReview` calls. Dismissal is now purely local,
  which is all a phone session ever needed.
- **Review sheet** (352 → 317): both `source === 'oura'` PATCH branches, the
  phone-saves-overlapping-Oura sweep, the *"Route not available — phone wasn't tracking"* branch, and
  its two `invalidateOuraWorkoutReview` pairings.
- **Store**: `addOuraSession` removed, `source` narrowed to `'phone'`. The union is kept at one member
  rather than deleted because **the store is persisted** — and a session stamped `'oura'` before the
  change is now dropped in `onRehydrateStorage` rather than left to render as a route-less phone
  session that nothing can mark reviewed.

Lane A's half is unchanged and now safe to take: the route, the `day-timeline` filters, `OuraWorkout`,
and `invalidateOuraWorkoutReview` (callerless as of this PR). **`repo.getOuraWorkouts` still must
survive** — `compute-hr-recovery-profile.ts` reads the frozen rows as HR-recovery anchors.

## Guarded, and control-run

`q231-detected-card-is-the-phone-surface.test.ts`, 6 tests: the provider is mounted in the root layout,
the store still finalises a phone session, the card renders `pendingSessions`, the banner stack mounts
it, the sheet reaches a session only by the card's id, and the Cloud plumbing is absent.

**Control:** removing the mount fails the test named *"removing it orphans the phone detector"*. Mount
restored, tree verified clean.

⚠ Its Cloud-absence assertions match **code, not mentions**. The first version failed on the card's own
new docstring explaining what had been removed — the exact false positive `scripts/lib/strip-comments.js`
exists for, hit inside a test written the same hour.

`LB-132`'s source guard needed its two patterns narrowing: it pins the literal invalidation pairing in
the review sheet, and `invalidateOuraWorkoutReview` left both sides. The rule it protects is unchanged —
revalidate on the far side of the push, still invalidate immediately for the writing device offline.

## Verified

`npx tsc --noEmit` · `pnpm check:rules` **Ran 84 of 84** · `pnpm lint` 0 errors · `pnpm test`
**11,038 passed** · `check-test-typecheck` at baseline.

## Not exercised

- **The device.** The phone detector needs GPS, a real walk and the APK; `getLocalStore` is null in a
  browser. What is proven here is that the render path and its only surface survive, by source guard and
  by the full suite — not that a walk end-to-end still raises the card on the S25.
- **The rehydrate filter against a real persisted `'oura'` session.** Asserted at source; no device has
  been checked for one.
- **Whether any of the 13 frozen rows were still unreviewed.** If so, the card stops offering them —
  which is the point of the change, but it means a card he may occasionally have seen will not return.

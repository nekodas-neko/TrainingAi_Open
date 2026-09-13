# 2026-09-12 — BF-146 closed without a code change: BF-148 had already removed the cause

**PR:** `fix/bf146-baseline-not-a-failure` · **Lane B** · `e2e/baseline-not-a-failure.spec.ts` (new),
`docs/implementation-backlog.md`.

Owner, minutes before training: *"its not able to generate an ai workout for the new one"*, under an
amber *"Couldn't generate your AI prescription just now — showing your base program. Tap refresh to
try again."*

## The report and the diagnosis were both right

`generate-prescription.ts:201` returns `{ ok: false, error: 'Baseline not complete', status: 400 }`
while `phase === 'baseline' && !baselineComplete` — correct, because a prescription is a percentage
of a 1RM and there is none before the AMRAP. The client rendered that under
`prescriptionGenTimedOut`, a *timeout* flag, so a settled state got amber, a warning triangle and a
retry that could never succeed, beneath a panel already explaining it correctly.

I implemented the fix the entry recommended, keyed on the state rather than the error string.

## Then the spec passed without it

Before shipping I wrote `e2e/baseline-not-a-failure.spec.ts`: it puts the seeded user's session into
`phase = 'baseline', baseline_complete = false` on an `ai_dynamic` program — the owner's exact state
— opens the card, waits past the poll window, and asserts no banner. It passed. **It also passed
with the fix reverted**, which is the only reason this entry is closed rather than shipped.

The banner needs `aiPrescriptionPending`, and `isAiPrescriptionPending` requires **`!isBaselinePhase`**
(`prescription-pending.ts:26`). In this state `isAiDynamicBaseline` is true, so `isBaselinePhase` is
true, so pending is false and the poll never runs. The banner is unreachable.

### Correction — the first spec could not have told me that

The reading of the source above stands, but the run that "confirmed" it was worth nothing.
`isAiPrescriptionPending` is `isAiDynamic && !isBaselinePhase && state.prescriptionStatus ===
'consumed'`, and the first fixture wrote `prescription_status = 'none'`. **With that status the two
assertions hold whatever the baseline terms do**, so passing with the fix reverted was not evidence
that the fix was dead — it was a spec that could not fail.

Corrected in this PR: the fixture writes `'consumed'`, and the guard was then measured rather than
read. Reinstating BF-148's removed veto in `app/api/workout-data` (locally, never committed) makes
the spec **fail** on `Preparing your AI workout…`; removing it again makes it pass. That is the
evidence the paragraph above was asserting, and now it exists.

**What changed is `isAiDynamicBaseline` itself.** It used to carry a third, name-keyed
`hasAnyPriorLog` term — true of any rebuilt session — which vetoed the baseline, made
`isBaselinePhase` false, let generation be attempted, and produced exactly this banner.
**`ad8938d328` (BF-148, #1117) removed that term**, hours after BF-146 was filed. The surviving
comment at `app/api/workout-data/route.ts:215` names BF-148 as the reason.

So BF-146's own recommended fix would now be dead code. It was reverted, along with its source guard
and the version bump.

## What ships

The spec, and nothing else. BF-148's change is to a *guard*; nothing pinned the user-visible
consequence, so restoring the veto would have gone unnoticed by tests. This is the verification
BF-146 asked for, kept as a regression net for another lane's fix.

The entry is removed from the queue rather than marked done — a fix nobody made is not a fix, and
CLAUDE.md's rule for a superseded plan is to close it with the reason rather than force a mismatched
implementation to clear the queue.

**If it ever returns**, the fix is not to let generation proceed — that is the borrowed-anchor
prescribing BF-143 removed. Suppress on the state (`phase === 'baseline' && !baselineComplete`),
which the pre-workout screen already computes for its baseline panel. Keying on the error string is
wider and needs text threaded through `workout-screen.tsx`, shrink-only at 1833 lines.

## The spec assumed a database only a developer has

Its first CI run was the PR's one hard failure: `test@local.dev has no session_periodization row`.
`scripts/local-db/seed.sql` ships the program as **`phase_mode = 'manual'` with no
`session_periodization` rows at all** — both halves of the fixture's premise are created lazily by
the app, so a session-aged local database has them and a fresh CI seed does not. A spec that *reads*
shared seed state and mutates it is therefore green locally and red on the first machine that has
not run the app yet.

Rewritten on `deload-visible.spec.ts`'s pattern, which had already solved this: flip `phase_mode` to
`ai_dynamic`, `INSERT … ON CONFLICT DO UPDATE` the periodization row, and put both back in
`afterAll` — restoring the prior row where one existed and deleting it where one did not, since
every other spec in a serial suite runs against this same program. The session is picked by
`ORDER BY position LIMIT 1` rather than by name, and the test navigates straight to
`/workout?session=<id>` instead of clicking through the recommendation, so nothing depends on which
session the Workout tab would choose. Verified by reproducing the CI seed locally — `phase_mode`
back to `manual`, periodization emptied — running the spec green, and confirming both were restored
untouched afterwards.

## Verification

`pnpm check:rules` **Ran 73 of 73**; `pnpm exec tsc --noEmit` and `eslint` clean.
`e2e/baseline-not-a-failure.spec.ts` passes from a CI-shaped database and restores everything it
changed; it fails, as it must, against a locally reinstated BF-148 veto. No production code was
touched, so no version bump and no changelog entry — the app behaves exactly as it did before this
PR.

**Not exercised:** the APK. This is a web-harness run, where `getLocalStore` returns null; the
device path, safe-area insets and Samsung WebView rendering are all untested here. The change is a
test fixture, so there is nothing for a device to verify.

**No `projectOverview.md` Known-Issues row**, deliberately: the user-visible fix is BF-148's, and
claiming it here would put one outcome in two places.

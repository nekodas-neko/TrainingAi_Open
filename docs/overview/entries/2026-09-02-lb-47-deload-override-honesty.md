# 2026-09-02 — the `Full` override claimed a revert that had not happened (LB-47)

**Lane B · branch `fix/lb-47-deload-override-honesty` · v1.431.2**

LB-47 asked whether BF-64's `Full` override does anything on a real session-level deload. Its
measurement was exactly right and its conclusion was not — and what is actually wrong is worse than
what it described.

## The measurement held to the row

Re-measured against production: **5** stored prescriptions, **1** with a session-level `deload: true`
carrying **0** exercises with `deloaded`/`preDeload`, **2** with a per-exercise deload, **0** with
both. The entry's figures, confirmed. (The endpoint is row-scoped to one user, so the larger sample
the entry asked for does not exist to be taken — n = 5 is all there is.)

## But the screen does something the entry did not check

On that prescription the toggle **is not rendered at all**. It carries `phase: 'deload'`, so
`aiDynamicFallbackPhaseStatus` returns `isDeloadActive: true`, and `pre-workout-screen.tsx` gates the
whole `DeloadToggle` on `!phaseStatus?.isDeloadActive`. So `Full` is not "an override that does
nothing" on the owner's data — it is **not offerable**. The entry's proposed fix, *disable the toggle
on a session deload*, is already the behaviour.

## What is reachable is a false confirmation, which is worse

`deloadRevertNames` and `deloadOverrideBlocked` **both** return empty in that shape, and the card read
`blocked.length === 0` as *everything reverted*:

> Every exercise is back to its pre-deload weights and sets, and these sets count toward your 1RM.

Both clauses false, in the direction that misleads — the user reads a confirmation that the override
worked and trains the deload weights believing they are full ones. That is BF-8's complaint (*"I was
under the assumption I was doing my full session"*) arriving from the other side, inside the fix filed
to prevent it.

It needs `prescription.deload === true` while the server reports `isDeloadActive` false — a
prescription whose `deload` flag and `phase` disagree. Nothing forbids that and production has not
produced it (0 of 5), so this is **latent**, not the owner's reported symptom. Worth fixing anyway:
the cost is one branch, and the failure is a wrong claim about what is on the bar.

## What shipped

`deloadOverrideOutcome` returns `none` / `all` / `partial` / `nothing-to-revert`, and the card branches
on it **before** the blocked-list check, with a heading and a sentence that say the truth: this
prescription lowered the whole session rather than individual exercises, there are no pre-deload
numbers to go back to, and Full does not change today's targets. **No 1RM claim in that branch** — the
override did not happen, so nothing is owed either way, and the old sentence's 1RM half was the second
false clause.

**BF-64 was not reverted.** Its per-exercise path is correct and is untouched, exactly as the entry
insisted. Only the sentence shown when nothing was reverted changed.

## Verification

- 9 tests, **six mutations kill them**: `nothing-to-revert` collapsing into `all`, the branch disabled
  as `{false ? …}`, the branch moved after the blocked check so it is unreachable, `partial`
  collapsing into `all`, the heading no longer changing, and a 1RM claim added back to the honest
  sentence.
- **The `{false ? …}` mutation survived the first version of these tests** — the sixth time this
  session. Two reasons at once: the text of an unreachable branch is still in the file, and
  `overrideOutcome === 'nothing-to-revert'` also appears in the heading ternary above, so an
  `indexOf` for the condition still found one after the body's was deleted. Every card assertion now
  pins the **condition and its consequent in one pattern**, so they cannot be satisfied separately.
- One test guards a boundary the fix could plausibly get wrong: an undeloaded exercise beside a
  revertible one must read `all`, never `partial` — otherwise every ordinary prescription with one
  deloaded lift starts naming exercises that were never deloaded.
- Full unit suite **744 files / 6,320 tests**; `pnpm check:rules` **Ran 67 of 67**; `tsc` clean, lint
  clean (warnings pre-existing). **One suite run reported a single failure that a re-run did not
  reproduce, and it was not identified** — the run finished before the name could be captured and the
  next run was clean. Recorded rather than dismissed: the local DB accumulates `rate_limits` rows
  across runs and this session has run the suite many times, which is a documented cause of exactly
  this shape, but "flake" is not a root cause and CI on a fresh database is the better signal.

## Deliberately not done

- **A real "run this at full intensity" path on a session deload.** It needs a regeneration
  `/prescribe` cannot do — the route takes no intensity input — so it is a Lane A plus owner question,
  not a copy change.
- **A line of explanation where the toggle would be.** On a real session deload the control simply
  vanishes, so a user wanting a full session sees no control and no reason. That is cheap to add and
  is probably right, but whether it is wanted is the owner's call and is not assumed here.

**Not exercised:** the device, and the reachable case itself — it requires a prescription production
has not produced, so what is proven is the branch logic and the card's source, not a screenshot of the
new copy. The unit suite runs in `node`, so nothing here rendered.

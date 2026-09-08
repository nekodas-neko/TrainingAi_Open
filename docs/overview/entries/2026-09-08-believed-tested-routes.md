## 2026-09-08 — Testing the three routes everyone thought were already tested (PS-39)

**Branch:** `test/believed-tested-routes` · **Lane A**

### What shipped

13 tests across `scale-ble/pending/[id]/confirm`, `…/dismiss` and `nutrition/energy-balance`;
`BASELINE` **139 → 136**.

These three are not the easiest remaining routes. They are three of the **twelve the coverage fix
(#956) exposed as believed-tested-and-not** — routes that read as covered because a test borrowed a
response type from the module and called nothing. The gap between what the ratchet claimed and what
was true was widest here, so this is where the tests are worth most.

### What is pinned, and why these routes in particular

**The pending-weigh-in triage was dead in production once already (BF-53).** A sweep applied the
UUID guard to two routes whose key is a `bigserial`, so every real request got `400 Invalid id`: a
reading that was not the owner's could not be dismissed, and one that was could not be confirmed.
The correct `Number.isInteger` check sat unreachable on the next line. Pinned now: a decimal id
reaches the repository on **both** routes, and the shapes a `bigserial` never produces — `'1e3'`,
`'0x10'`, `' 41 '`, `'0'`, `'-1'`, and a UUID — are refused without touching it. Mutation-checked by
putting the UUID guard back: **four cases fail**, which is the outage reproduced.

**A confirmed reading is filed against the day it was MEASURED (Q-25).** A pending reading is
confirmed whenever the owner next opens the app — potentially days after the anomaly gate staged it
— so keying the write on today filed the weigh-in against the wrong day almost every time it was
used. Mutation-checked with `new Date()`.

Also pinned: `compositionSkippedReason` distinguishes `'impedance'` from `'profile'` (PS-33 widened
it because "skipped" alone cannot tell a bad reading from an incomplete profile, and the two need
different things from the user); an incomplete decode 500s rather than writing a partial weigh-in;
and `isAdditionalReadingForDay` keeps the wire name the installed APK still sends while meaning
"trend unchanged".

**`nutrition/energy-balance`** decides two things this repo has broken before: which day it answers
for — accepting the slash form `localDateString()` emits, defaulting to today **in the user's**
timezone — and that the answer is `no-store`, because it folds live today totals.

### One trap avoided on purpose

The timezone case runs in `America/New_York`, not Brisbane. Written in the default zone it passes
against a route that hardcodes `DEFAULT_TZ` — the vacuous shape a mutation check caught earlier in
this same PS-39 run, and the reason it is now written this way from the start rather than found
again.

### Verification

- `pnpm check:rules` — **Ran 70 of 70**. `tsc --noEmit` clean, `check-test-typecheck` at baseline,
  `pnpm build` exit 0, full suite green.
- **Mutation-checked three ways**: the BF-53 UUID guard fails 4 cases, `new Date()` for `measuredAt`
  fails the Q-25 case, and hardcoding `DEFAULT_TZ` fails the timezone case.

**Not exercised:** mocked repositories throughout, and `applyScaleReadingToBodyMetrics` is stubbed —
what is pinned is which day and which values the route hands it, not what it writes.
`computeBodyComposition` runs for real, so the impedance/profile split is the route's own branch
rather than a stub's.

**Nine of the twelve remain**, and they stay the best next candidates for the same reason: everyone
believed they were covered. Named in the PS-39 entry.

No version bump: tests only.

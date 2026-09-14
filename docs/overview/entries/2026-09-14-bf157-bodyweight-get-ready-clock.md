# 2026-09-14 — the bodyweight ready screen gets its clock back (BF-157)

**Branch:** `fix/bodyweight-getready-countdown` · **Lane B** · v1.456.2

## What it was

Owner, on the Pull-Up ready screen with the session clock at **8:42**: *"The body weight screens have
no warmup timer or load time so its just infinite on this screen."*

One expression explains it:

```js
const warmupSets = (() => {
  const set1 = workingWeight
  if (!set1 || set1 <= 0 || soloMode) return null   // ← bodyweight is 0
  return [{ pct: 50, … }, { pct: 74, … }, { pct: 92, … }]
})()
```

Dropping the ladder is right — 50/74/92% of nothing is not a warm-up. But the on-screen clock was
rendered *from* that array, so removing the ladder removed the clock. Two separate ideas behind one
gate.

## The entry named one case; there are four

BF-157 was filed as a bodyweight bug. The render gate reads
`warmupSets && !isBaseline && !isBodyweight`, so the screen loses its clock whenever **any** of these
holds: bodyweight, an AMRAP baseline, solo mode, or an exercise with no working weight.

`workout-screen.tsx:711` calls `startRestChip` for all of them, unconditionally, on
`transitionSecForEquipment` — and its own comment says that is *"the same total the on-screen ready
bar uses"*. That comment was false in all four. Fixing only the bodyweight case would have left it
false in three, so the fix is the negative branch rather than a bodyweight special case.

## What shipped

`GetReadyProgress` in `workout-clocks.tsx`: one bar, same elapsed derivation as the ramp, running to
`transitionSecForEquipment(equipment)`. `active-workout-screen.tsx` renders it as the `else` of the
ramp condition, so exactly one bounded clock is on screen at all times and both run to the same
total. The ramp for weighted exercises is untouched.

Colours come from `--accent-green` rather than the `#22c55e` the ramp beside it uses —
`check-hex-literals.js` caught the copied literal, which is the right catch: the ratchet is
shrink-only and the ramp's three baselined literals are not this change's to churn.

## Verification

`e2e/get-ready-timer.spec.ts` repoints every session's opening exercise at **Pull-Up**
(`{bodyweight}`) in `beforeAll`, restores it in `afterAll`, drives to the ready screen, and asserts a
`Get ready` bar reading `m:ss / 1:00` that ticks.

**Getting that spec right took three attempts, and both failures are the same mistake in different
clothes — reading the sandbox instead of creating the state.**

1. It assumed the seed's exercises were unweighted, because none carries an `exercise_id`. The ready
   screen came up at **73.75 kg** with a full ramp; the spec proved nothing and passed.
2. It then looked a real `Pull-Up` row up in the sandbox and hardcoded its uuid. CI builds its own
   `exercise_library`, so the `UPDATE` died on `session_exercises_exercise_id_fkey` —
   *"Key (exercise_id)=(d94e8afd…) is not present in table exercise_library"* — green locally, red on
   CI. **Only the Postgres service-container log named the cause**; the Playwright failure was a
   missing element, which reads like a UI regression.
3. It now inserts its own row **by name** (`exercise_library.name` is UNIQUE, which is the one thing
   both databases agree on), upserting so an aborted run leaves nothing behind, and tears down in
   order: `session_exercises` first, the probe row second — the other way round leaves
   `ON DELETE SET NULL` to blank the ids it is about to rewrite.

Teardown verified by reading the tables back after a local run: zero probe rows, all three opening
exercises restored to their original names and null ids.

| Assertion | Status |
|---|---|
| `Get ready` bar present | **falsified** — fails against unpatched `components/` |
| total reads `1:00`, and ticks | **falsified** — same run |
| no `Warm-up ramp-up` on bodyweight | **not falsified** — already true before this change |

The third is a regression guard against someone rendering the ladder at zero weight later, not
evidence about this fix. Recorded as such rather than counted as proof.

Also: `pnpm check:rules` **Ran 74 of 74** · `npx tsc --noEmit` clean · `pnpm lint` 0 errors ·
`vitest` 842 passed · `workout-set-loop` and `baseline-not-a-failure` still green.

## What was NOT exercised

- **No device.** The whole point is a screen the owner watches on the S25, and it has only been seen
  at 412 dp in Chromium. The entry asks for a bodyweight ready screen *and* a barbell one, checking
  the bar agrees with the notification chip — and the chip is native, so that agreement is
  **unverifiable in the sandbox** and is the single thing most worth checking.
- **`prepTimeSec` was not measured end to end.** The argument that a bounded screen improves the
  duration model's input is reasoning about `handleStart`, not an observation of a submitted value.
- **Solo mode and the zero-weight case were not driven**, only the bodyweight one. They share the
  branch, so they are covered by construction rather than by test.

# 2026-08-31 — LA-43: `generate-program` resolves exercise names instead of dropping paraphrases

**Branch:** `fix/generate-program-name-resolution` · **Lane A** · JS/server half only — reaches the
device through a Railway deploy, no APK needed.

## The premise moved, and the real bug was worse than the filed one

LA-43 was filed against `route.ts:330`:

```ts
mainMuscles: libraryMuscles?.mainMuscles ?? ex.mainMuscles ?? [],
```

— three lines below a comment saying the model's muscle output is *"never trusted"*. The entry read
that as a live contradiction: a name the library did not hold would fall through to the model's own
guess.

**It could not.** Sixty lines above, the route already did this:

```ts
const validNames = new Set(filteredExercises.map(e => e.name))
for (const sess of raw.sessions) {
  sess.exercises = sess.exercises.filter(ex => validNames.has(ex.name))
}
```

`validNames` and `exerciseMuscleLookup` are built from the same array, so every surviving name was
guaranteed to resolve and both `??` arms were dead code. The contradiction was real but inert.

**What that filter did instead is the actual defect.** It *silently deleted* every paraphrase. The
prompt's rule 2 says "Use ONLY exercises from the list below. Match exercise names exactly"; the
model writes "Barbell Deadlifts", "Press Dumbbell Incline", "Pull-Ups" anyway. Each one was removed
without a trace — so a session came back short of the exercise count the time budget was computed
from, and nothing in the logs, in `error_events`, or in the response said why.

## What shipped

**`packages/shared/src/workout/exercise-name-resolver.ts`** (new). `buildExerciseNameResolver` indexes
the library in three widening tiers — exact, normalised, word-order — and `resolveAgainstLibrary`
returns each exercise under the **library's** name with the **library's** muscles, plus the names it
could not resolve.

Three decisions worth not re-litigating:

- **It reuses `normalizeExerciseName`** from `exercise-gif-matcher.ts` rather than growing a second
  normaliser (One Formula, One Place). Two things are added locally instead of editing it: hyphens
  and slashes are split to spaces (that file *deletes* punctuation, and its `DIRECT_URL_OVERRIDES`
  keys are stored in its output, so changing it has GIF-matching blast radius), and a trailing `s`
  is stripped per word.
- **It stops at word order.** A subset or edit-distance tier would reach "Back Squat" from "Barbell
  Back Squat" — and would equally reach "Bench Press" from "Incline Bench Press". `personal_records`
  and `exercise_estimates` are unique on `(user_id, exercise_name)`, so a wrong merge writes one
  lift's PR onto another's and there is no way back, while a miss costs one exercise. Under-merging
  is the safe direction, the same call `food-item-identity.ts` makes. A test pins the limit.
- **An ambiguous widened key resolves to null**, never to whichever entry was indexed last.

**`app/api/generate-program/route.ts`.** The exact-match filter is replaced by the resolver; a name
the library genuinely does not hold is still dropped (one lost accessory should not cost a whole
generation) but is now **reported to `error_events`**; a session left with **no** exercises returns
**502** with a named error rather than shipping a program that cannot be started. Both `??` arms are
gone — after resolution they are unreachable, and leaving them would keep the contradiction alive.

## Measured, not assumed

Against the real 142-row catalogue, pinned as a DB-backed test
(`lib/data/postgres/__tests__/exercise-name-resolution-library.test.ts`):

| Query shape | Rows that fail to resolve |
|---|---|
| The name itself | **0 of 142** — the exact tier is unchanged, so nothing that resolved before stopped |
| Lowercase variant | **0 of 142** |
| Reversed word order | **0 of 142** |
| Plural (before de-pluralising) | **49 of 121** |
| Plural (after) | **0 of 121** |

That 49 is what justified de-pluralising at all — "Deadlifts", "Pull-Ups", "Planks", "Lat Pulldowns"
were every one of them unreachable, and they are exactly what a model writes.

**The `depluralise` guards were written and then measured away.** An "ss" exception (so "Press" does
not become "Pres") and a length floor both survived every mutation and changed nothing against the
real catalogue — because the transform is applied to the library name and the query alike, so a word
it mangles is mangled on both sides and still matches. They were removed rather than kept as clauses
that read like protection while providing none. The one condition left is structural: never emit an
empty token.

## Verification

- **9 mutations, all killed** except two that were removed as a result (above): punctuation split,
  ambiguity handling, each of the three tiers independently, an *added* subset tier (proving the
  under-merge pin is load-bearing), the name rewrite, the muscle override, and de-pluralisation.
  Removing the normalised tier initially survived — the word-order tier subsumes it — so a case only
  it can answer was added (two library entries differing **only** in word order, where the wider tier
  is ambiguous and the narrower one is not); it then failed.
- **Full suite green:** 677 files / 5,699 tests. `pnpm check:rules` **Ran 63 of 63**. `tsc` clean.
- **Exercised end-to-end on `pnpm dev` against real Gemini**, including a temporary fault injection
  (reverted) that paraphrased the model's output inside the route:

  | Injected | Resolved to | Tier |
  |---|---|---|
  | `barbell bench presss` | `Barbell Bench Press` | case + plural |
  | `Press Dumbbell Incline` | `Incline Dumbbell Press` | word order |
  | `Deadlift Romanian Barbell` | `Barbell Romanian Deadlift` | word order |
  | `Zercher Good Morning Push` | *dropped, and reported* | genuine miss |

  Before this change all four were dropped, six of twelve exercises in that run. An all-unresolvable
  session returned the 502 with `"no usable exercises for: Push"`. Clean runs after reverting the
  injection produced **zero** drops and correct library muscles on every exercise.

## Not exercised

The APK, safe-area, native SQLite and Samsung WebView paths — this is a server route with no device
surface, so the device-verification gate does not apply. The client already toasts `data.error` on
any non-ok status (`components/workout-builder/builder-wizard.tsx`), so the new 502 needs no Lane B
change; that toast was read, not run. Phase-mode generation could not be exercised locally — the
seeded test user has no phase sets, which is a fixture gap, not a regression.

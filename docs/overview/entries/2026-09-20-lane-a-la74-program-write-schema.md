# 2026-09-20 — LA-74: the program write path is typed, and the schema is pinned to the mapper

**Branch:** `lane-a/la74-program-write-schema` · **Lane A** · fourth KEEP-mined item of the session,
after LA-63, LA-123 and LB-27.

## What it was

`POST /api/workout-templates` spread `body.program` into `repo.saveProgram`. Not mass assignment —
the repository names every column it writes — but nothing typed or bounded a value, and the two
ownership checks the route carries (`phaseSetId`, `styleId`) read as validation while covering two
fields. The style half of this pair shipped 2026-09-07; the program half sat for three weeks behind
one sentence in its sibling's header: *"Strict there needs that enumeration checked against a
device, and getting one key wrong breaks the app's core write path."*

## Both halves of that sentence were wrong, and the entry's own text says so

**The device is not required.** No native code posts to this route. The poster is the WebView, which
ships with the Railway deploy rather than with the APK — so the payload on device is byte-identical
to the payload on web. That is the same reasoning `check-strict-request-schemas.js` uses to decline
exempting this route, and the opposite of `scale-ble/samples`, whose client is Kotlin in an APK that
does not update with a deploy. LA-74 stated this; the sibling's header did not carry it across.

**And there are three producers, not two.** The entry enumerated `config-screen.tsx`'s editor and
its activate button. `workout-builder/builder-review.tsx` is a third, and it is the one that would
have broken a schema checked against only the other two: it sends `userId: ''`, sends `createdAt` /
`updatedAt` / `totalWeeks`, and omits `timeBudgetMinutes` on every session and `supersetGroup` on
every exercise. A schema derived from the `Program` type — or from two of the three call sites —
400s every program the AI builder creates.

Every field in `program-write.ts` was read off a call site, not off the type. The type is what the
producers disagree with.

## The part that needed designing, not just care

The activate button posts the whole stored row back, and that row is exactly what `listPrograms`
mapped. **So the schema is permanently coupled to that mapper**: a column added there and not here
400s activation, on a path no test of the new column would touch. Getting the enumeration right
today does not keep it right.

`program-write-covers-types.test.ts` enforces it in CI. It reads the `Program`, `ProgramSession`,
`SessionExercise`, `Schedule` and `ScheduleDay` interfaces out of the type source — the only way,
since types are erased at runtime — and asks the schema, by parsing, whether each field name
survives. One-directional on purpose: every type field must be accepted, while the schema may carry
fields the type does not, because the producers send `userId` and JSON date strings the type models
differently.

**Its first version walked Zod's `_def` chain to reach each nested shape and broke on
`z.array(...).optional()`.** A test that knows that much about a dependency's internals fails on a
version bump rather than on the drift it exists for. Feeding a key in and looking for
`unrecognized_keys` asks the only question that matters and survives the bump.

## Verification

**Live, against the real route, repository and Postgres** — not a mocked repo:

| payload | result |
|---|---|
| the real `GET` output posted back (producer 2, byte-identical to activate) | **200** |
| editor save, weekly schedule | **200** |
| editor save, rotation schedule | **200** |
| editor save, `schedule: null` (how the editor clears one) | **200** |
| builder-review payload | **200** |
| a program key no column has | **400** |

The first row is the one that matters most: it is the mapper's own output, on real rows, through the
strict schema.

**Mutation pass — 3 mutations, each caught by its intended test:**

| mutation | caught by |
|---|---|
| drop `.strict()` from the program level | `a program key no column has`, and the drift guard's own self-check |
| make `timeBudgetMinutes` required | `accepts sessions without timeBudgetMinutes…` — the builder producer |
| drop `earlyDeloadWeekStart` | the **drift guard**, plus both activate cases |

The third is the one the design was for: a column only the activate path ever carries, removed from
the schema, caught by the guard rather than by a lucky fixture.

**The equivalent control failed on its first attempt, and was right to.** Rewriting
`trainingGoal: z.string().optional()` as `z.union([z.string(), z.undefined()])` is not equivalent in
Zod — the union accepts an `undefined` value but leaves the key **required**, so two producers that
omit it started failing. Redone as renames only: 139/139.

## The Custom Rules gate caught something reading alone did not

`pnpm check:rules` failed on **"Numeric validators carry an upper bound"** (Q-164): seven numeric
fields had a `.min()` and no `.max()`. Every one now carries a named constant, and the comment above
them says what they are — a refusal of nonsense, never a product limit. A bound that could reject a
row already in the database would 400 the activate of a program that was fine yesterday, which is
the exact failure this schema exists to prevent, so each sits orders of magnitude above anything a
producer builds. Re-verified afterwards: all five stored programs round-trip at 200.

One wrinkle worth recording because it will catch the next person: the rule matches **text**, so the
comment introducing those bounds tripped it by naming the validator literally. The comment now says
so in place.

## One test fixture was changed, deliberately

`progression-style-write-schema.test.ts` called itself *"a tripwire for whoever does add that
schema"*, and it fired: all three of its program cases went red. **What they caught was the fixture,
not the schema.** Its `SESSION.exercises[0]` was `{ id, name, sets, styleId }`; a `SessionExercise`
has `exerciseName` and no `sets` at all, and both real producers send `exerciseName`. It was never
wrong in a way anything could notice, because its assertions are about passthrough, which a nonsense
key satisfies as well as a real one. Corrected once, with the reason recorded in the file so it is
not read later as the schema being loosened to fit a test.

## Not exercised

- **The editor UI was not driven end to end.** Reaching its save goes through a Review step that
  needs a Gemini key the sandbox does not have, and the click path dead-ends on *Try again /
  Close*. Producers 1 and 3 were verified by posting their transcribed payloads to the live route,
  repo and database — the real server path with the real shapes — but not by pressing the real
  button. Producer 2 **was** verified against real data, via the GET round-trip.
- **No device run**, and per the reasoning above none is needed for this route specifically. That
  argument is about which client posts here; it is not a general licence.
- **The residual risk is a producer I did not find.** Five POST/DELETE call sites were enumerated by
  grep and four POST shapes verified; if a sixth exists outside `app/`, `components/` and
  `packages/`, it is unguarded by everything above. The drift guard covers type drift, not a new
  caller.

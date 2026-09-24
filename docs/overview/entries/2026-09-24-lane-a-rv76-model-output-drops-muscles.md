# 2026-09-24 — RV-76: the fix was right, and half of where to apply it was wrong

**Branch:** `lane-a/rv76-drop-dead-muscle-arrays` · **Lane A** · two API routes and a new contract
test. No migration, no schema change to stored data, no client change.

## The measurement held

`generate-program` asks the model for `mainMuscles`/`secondaryMuscles`, then runs every exercise
through `resolveAgainstLibrary`, whose own doc comment says it gives each one *"the library's
identity: its canonical name and its muscle assignments, both overwriting whatever the model
produced"* — and drops names the library does not hold. So the model's arrays are gone before
anything reads them.

`builder-chat` is the same shape by a different route: it `.filter()`s to `exerciseMuscleLookup` and
then overwrites from it, so the entry's claim that `libraryMuscles?.mainMuscles ?? ex.mainMuscles`
has **both fallbacks dead** is correct — the lookup cannot miss for a row that survived the filter.

Both verified against `main` before anything was edited.

## Where the entry would have broken the app

It says to delete the fields *"from `BuilderExerciseSchema` and `GeneratedExerciseSchema`"*. Those
are not the same kind of thing, and the second one is a trap:

| schema | what it validates |
|---|---|
| `BuilderExerciseSchema` (builder-chat, local) | the **model's output** |
| `GeneratedExerciseSchema` (`packages/shared/src/validation/`) | the **client's request** |

The request schema is **`.strict()`**, and `builder-review.tsx` posts its live `program` state
wholesale — state that carries `mainMuscles` and uses it (it reads them, writes them on exercise
swap, and builds `muscleGroups` from them). Deleting the fields there would have **400'd every
builder-chat turn**, which is precisely the failure the Q-464 comment *in that same file* records
for `clientId`.

So only the two model-output schemas changed. Both now say so in a comment, because the next sweep
will see the asymmetry and want to tidy it.

## A third dead fallback, found by the compiler

Removing the fields made TypeScript infer the map callbacks from the model schema instead of the
client type, and it immediately rejected `ex.progressionStyleId`:

```ts
progressionStyleId: styleName ? styleByName.get(styleName) : ex.progressionStyleId,
```

**The model-output schema has never carried `progressionStyleId`.** That arm was always `undefined`,
and it type-checked only because the callback was annotated with the *client's* exercise type. The
entry does not mention it. Now written as `: undefined`, with the reason beside it.

The same annotation swap is why `?? []` could go: the filter guarantees the lookup, so the
non-null assertion states that guarantee instead of a default that would silently ship an exercise
with no muscles if the filter were ever loosened.

## One structural change worth naming

`generate-program` used to write resolved exercises back over `sess.exercises`. With muscles gone
from the model schema, that assignment **discards the library's assignments in the type system**
while keeping them at runtime — it compiles, and then something reads `undefined`. The resolved
sessions now live in their own array (`resolvedSessions`), which is what the rest of the handler
consumes.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | muscles put back in the builder-chat model schema | killed |
| 2 | muscles removed from the REQUEST schema (the trap) | killed |
| 3 | request schema loses `.strict()` | killed |
| C | the model schema's fields reordered | **survived** (correct, first time) |

Mutation 2 is the one this test exists for. The control passed first time — second in a row after
four straight failures, and the difference is writing the assertion from the rule rather than by
copying the line just added.

## Not done

- **No latency or token measurement.** The entry could not produce one and neither can this: no
  token counts are stored per call, and `generate-program` is a live model call. The argument is
  shape — two string arrays per exercise across ~30 exercises on the app's slowest call at
  4,786 ms — not a measured delta, and **no version bump or changelog entry is claimed**, because
  nothing observable changes for the user: the muscles are the library's either way.

## Failure surfaces not exercised

Neither route was driven against a real model — both are `generateObject` calls. What is pinned is
the schema contract on both sides and the existing 2,612-test suite over these routes. The device
was not used; nothing here is device-specific.

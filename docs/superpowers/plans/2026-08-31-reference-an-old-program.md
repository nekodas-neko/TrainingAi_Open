# Reference an old program when building a new one (BF-67)

**Entry:** BF-67 · **Lane:** A for the payload, prompt and resolver; B for the picker
**Owner's ask, 2026-08-30:** *"be able to reference an old program so it knows what I did and what I
would like similar to."*
**Owner's clarification, same day:** *"more like understanding what I did and how to build the next
program — ideally we should try keep similar exercises right so we aren't changing it up too much?"*

---

## 1. What the design question actually is

Not *"what does reference mean"* — the owner answered that. It is **what counts as a reason to break
continuity**, because the instruction is *carry the exercises forward unless there is a reason not
to*.

Candidate reasons, to be settled here: a changed goal, a changed muscle focus, an exercise that was
programmed and never actually trained, equipment no longer available, and an active injury (BF-68).

## 2. The finding that should drive the build

**Training history follows the exercise NAME, not the program.** `personal_records` is unique on
`(user_id, exercise_name)` and `exercise_estimates` is keyed the same way. So an exercise carried
forward keeps its 1RM and PR automatically — and a *paraphrased* one silently starts from zero.
"Bent-Over Barbell Row" and "Barbell Bent-Over Row" are one lift to the owner and two rows to the
database.

That makes name fidelity the feature's load-bearing requirement, not a detail.

### 2.1 Measured: the risk is latent, not live

| | |
|---|---|
| `personal_records` rows | **31** |
| …with no `exercise_library` match | **0** |
| distinct programmed exercise names | **39** |
| …with no library match | **0** |
| `exercise_library` size | **149** |

Nothing has paraphrased yet. So this feature would be the **first** thing to make it likely, and the
guard below is preventive rather than corrective. (Row-scoped to one user, which is the right scope —
it is the owner's history that would be lost.)

### 2.2 The hole it would go through, and it contradicts its own comment

`app/api/generate-program/route.ts:322-331` resolves the model's exercise name against the library
with an **exact-name** `Map.get`, then:

```ts
mainMuscles: libraryMuscles?.mainMuscles ?? ex.mainMuscles ?? [],
```

Three lines above the lookup that feeds it sits this comment:

> *"The AI regularly misattributes muscles (e.g. lists Glutes as main for squats), so we **never
> trust** its mainMuscles/secondaryMuscles output."*

The `??` arm trusts exactly that, on every name the library does not contain. So a paraphrase today
produces a program entry that (a) carries the model's guessed muscles into volume accounting and
(b) starts a fresh, history-less lift — neither of which surfaces anywhere.

**This is worth fixing whether or not the reference feature is built.** It is a pre-existing defect
that the feature would convert from unlikely to likely.

## 3. Build order

### Step 1 — resolve names, before anything else

Reject or repair a generated name that is not in the library. Repair beats reject: the model is
being asked to reuse names it was given, so a near-miss is a paraphrase of a known lift, and mapping
it back preserves the history that is the whole point.

- Exact match, then a normalised match (case, punctuation, word order) against the same
  `filteredExercises` list already built for the prompt.
- No match after both → **fail the generation with a named error**, rather than writing a lift with
  guessed muscles. A program is generated rarely and reviewed before use; a hard failure is cheap
  and a silent history reset is not.
- Delete the `?? ex.mainMuscles` / `?? ex.secondaryMuscles` arms. After the resolver they are
  unreachable, and leaving them would keep the contradiction above alive.

**Testable without the device or an LLM**: the resolver is a pure function over the library list.

### Step 2 — structure only

`programId?: string` on `RequestSchema`, read **server-side** and `user_id`-scoped. Never accept a
program object from the client: that is an ownership hole and a prompt-injection surface for no
benefit.

Into the prompt: session names, exercise names, roles, progression styles. Bounded by construction —
a five-session program is ~30 names.

**Bound it at the schema, not by hoping.** The note above `MAX_BODY_BYTES` already records that
`equipment` and `musclesToFocus` are unbounded arrays held only by the byte cap; a reference program
is a larger structure and needs its own `.max()` counts.

### Step 3 — the picker (Lane B)

`listPrograms` already exists. One control in the builder wizard; no reference selected leaves
today's behaviour unchanged.

### Step 4 — the history summary, separately

Per exercise: sessions logged, latest 1RM, and whether it was dropped part-way. **Adherence is the
interesting signal** — an exercise programmed twelve times and trained twice is one the next program
should probably not repeat. This is where the size work lives, and it lands on top without changing
the picker.

## 4. Why this order

Structure alone answers *"make me another one like that"*, is cheap, and is verifiable. Step 1 comes
before it because shipping Step 2 first is what makes paraphrase likely while the hole is still
open — the feature would create the failure it depends on avoiding.

## 5. Verification

- Pick a previous program, generate: the result echoes its split and main lifts rather than a
  generic template. Pick none: output unchanged from today.
- **Every carried-forward exercise keeps its 1RM and PR on the first session.** This is the check
  that catches a paraphrase, because a lift that reads correctly but shows no history is exactly
  what a renamed exercise looks like.
- Feed the resolver a deliberate paraphrase in a unit test and assert it maps back — or fails
  loudly. Do not assert on an LLM's output.

## 6. Out of scope

- BF-68 (injuries reaching the builder) is a separate entry; it is one of the "reasons to change"
  above and should be consumed by this design once built, not re-implemented here.
- Changing how `personal_records` is keyed. Name-keying is what makes continuity free; the fix is
  to protect the name, not to re-key history.

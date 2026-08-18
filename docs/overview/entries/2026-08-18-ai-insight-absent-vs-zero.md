# 2026-08-18 — an absent metric is not a zero (Q-353)

**Lane A** · branch `fix/ai-insight-prompt-absent-vs-zero` · `app/api/ai/health-insight/` only · no
migration, no Kotlin, no APK.

One structural note: the pure helpers live in a new `prompt.ts` beside the route rather than in the
route file, because **a Next.js route module may not export arbitrary symbols** — exporting them for
tests fails the generated route-type check with `Property 'metric' is incompatible with index
signature`. Worth knowing before trying to unit-test anything else that lives in a `route.ts`.

The prompt substituted the literal string `"no data"` for an absent field at **ten sites**. The model
does not read that as absence — it asserts **zero** and editorialises. A day-one account was told
*"your activity tracker currently shows zero movement… this inactivity creates a significant gap"*.

Q-452 (Lane B) gated the insight card on a section having *some* data, which closes the fully-empty
case only. The case left open is the common one: a user with a readiness score but no ring
temperature passes that gate and still gets the invented sentence. That is everyone without a ring,
not an edge case.

## The fix, in two halves that guard different failures

**Omission.** An absent metric's line is not emitted at all — a line that is not there cannot be
misread as a measurement. All four sections now build from `metric(label, value | null)` pairs and
`splitMeasured` partitions them.

**Instruction.** The absent labels are named in one sentence that says what they are: *missing
readings, NOT zeros and NOT observed behaviour; do not describe them as low, absent, skipped, or as
anything the user did or did not do; never build the tip around one.* Omission alone is not enough —
a section with no steps line can still have the model infer the user did not walk. The prompt also
gained a blanket *"never infer a value that is not listed"*.

## Two judgement calls worth recording

**A genuine zero stays a line.** `Steps: 0` is a measurement; `sessions7d` is a real count from our
own workout history, so zero sessions is an observation and not an absent reading. Only `null` /
`undefined` mean "no reading exists".

**The all-absent case now short-circuits.** Omitting lines made it reachable — heart-rate no longer
has any unconditional line — so a section with nothing measured returns a plain deterministic
sentence instead of paying for a model call whose only honest output is "there are no readings",
which is the exact prompt shape that produced the invented zero. It is **deliberately not cached**:
the cache is keyed by `(user, section, date)`, so persisting it would still be served after the ring
syncs later the same day.

## Sibling sweep

The entry asked whether other prompt builders do the same substitution.
`packages/shared/src/ai-periodization/prompt.ts` has **eleven** `no data` substitutions — but it
already carries the instruction this one lacked, at line 177: *"Null values in recovery signals mean
'no data recorded' — omit those signals from your …"*. So it has the weaker half of this fix and not
the stronger one. **Left alone deliberately** — Q-353 scopes to the health-insight route, and that
prompt has no reported misbehaviour. Worth knowing it is instruction-only if one ever appears.

## Verification

- **8 tests.** The partition (omits and collects), the regression in one line (`"no data"` never
  reaches the model), a genuine zero surviving, an empty string counting as measured, the prompt
  naming absent metrics and forbidding each specific editorialisation the incident produced, the
  no-absence case still forbidding invention, and prompt ordering.
- **One route-level test** for the exact shape Q-452's gate lets through: a user whose only sleep
  reading is a score. It asserts the model was genuinely reached (an empty capture would make every
  other assertion vacuously true), that the prompt carries `Sleep score: 80/100`, that all four
  absent field labels are gone from the data block, and that they appear in the absent note instead.
- **Mutation-checked**: re-adding the `"no data"` line turns **three** of them red, including the
  route-level one.
- `tsc --noEmit` clean · `pnpm check:rules` 38 of 38 · full suite green.

## Exercised against the real model

All four sections were driven through `pnpm dev` with `force: true`, against the seeded account —
which has partial data, the exact case this is about. Gemini's actual output:

- **activity** — *"…Steps were not recorded today."* This is the sentence that used to read *"your
  activity tracker currently shows zero movement… this inactivity creates a significant gap"*, and
  the tip is built on the strength sessions, which are real.
- **sleep** — *"…No sleep score was recorded for this period."* States the absence; asserts nothing
  about it.
- **readiness** — *"…no scores or contributor readings were recorded."*
- **heart-rate** — all values present, no absence noise at all.

So the instruction does hold in practice, not only in what the model is handed.

## Failure surfaces NOT exercised

- **One sample per section.** LLM output is not deterministic; four good generations are evidence the
  instruction lands, not proof it always will. The tests pin the *input*, which is the part that can
  be guaranteed.
- **No device, no UI.** The card is Lane B's (`AiInsightCard`), unchanged here.
- Not tested against the owner's production account, whose data shape differs from the seed.

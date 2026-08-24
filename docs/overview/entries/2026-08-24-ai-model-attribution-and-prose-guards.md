# The AI call log recorded an assumption, and the prose had no guards (Q-296, Q-292)

**Branch:** `fix/ai-model-attribution-and-prose-guards` · **Lane A** · no migration · two entries batched

Batched because neither needs device verification and both are the AI platform — one CI run and one
read rather than two.

## Q-296 — the docs were right; the logging was a constant

The entry framed this as "one of the two is wrong and they fail differently". It is the second, the
one that invalidates measurements: `COACH_MODEL_ID = 'gemini-3.6-flash'` exists, the Coach route
calls `coachModel()`, and the grounding tool is live. What was wrong is that `logAiCall` wrote
**`model: AI_MODEL_ID`** — a constant — so `ai_call_log.model` could not disagree with the default.

Re-measured against production 2026-08-24: **22 Coach calls, first on 2026-08-09**, after
`COACH_MODEL_ID` shipped on the 8th, every one filed under flash-lite.

It now logs **what the provider says it served** (`response.modelId`), falling back to a new
`AiCallMeta.model` and only then to the default. Reading the response rather than the request is the
stronger choice: a provider may route a request elsewhere, and that substitution is exactly what a
model column exists to make visible. Coach passes `COACH_MODEL_ID` so its **failures** attribute
correctly too — a failed call has no response to read, and a Coach failure filed against a model
Coach does not run was the least defensible case of all.

The entry also noted `instrument.ts` "greps as a binary file, which is itself worth a look". It held
a **raw NUL byte** inside a template literal. It is now `\0` — the same byte, and the file is text.
A pinned-hash test proves the equivalence rather than asserting it, because fingerprints are
**stored**: a changed separator would silently orphan every existing one and break double-trip
detection.

**Historical rows are not corrected.** Every value written before this is an assumption, and the 22
Coach rows since 2026-08-09 were in fact 3.6-flash — but that is an inference from one deploy and one
code path, not per-row evidence. Any cost or latency work split by model must treat rows before
2026-08-24 as unattributed.

## Q-292 — a score of 80 called "perfect", twice

`PROSE_GUARDS` (`lib/ai/prompt-guards.ts`) is one string interpolated by all five prose routes:
health-insight's builder, daily-digest, weekly-digest, recap, session-explain. It states metric units
outright, forbids converting to imperial, requires numbers to be quoted rather than recomputed, and
**names the superlatives that were actually fabricated** — "perfect", "record", "best", "all-time" —
rather than gesturing at the category.

One string and not five, because the wording drifting into five versions is exactly how `sleep` ends
up without the units clause again. A test fails on a prose route that does not import it.

CLAUDE.md's *no LLM self-reported number* rule now covers numbers **shown to the user as fact**, not
only numbers that gate an action — the gap that let this through.

## Verification

- Q-296: five tests, **mutation-verified** — restoring the hardcoded constant fails three of them.
- Q-292: nine tests over the guard's reach and content.
- `pnpm check:rules` — Ran 55 of 55. `tsc --noEmit` clean, `pnpm lint` 0 errors.
- Full suite: 3972 passed, 820 skipped, 2 pre-existing unrelated failures (missing `qrcode`).

## Not exercised — and Q-292's fix is not proven

**Q-292's fix is prompt text, so the tests cannot prove the model obeys it.** No before/after
generation was compared; that needs live model calls against the owner's real data. The 117-insight
audit should be re-run after a few weeks — if superlatives or Fahrenheit survive, the answer is to
stop asking and start post-checking the output deterministically.

The 12 stored superlatives and 7 Fahrenheit lines are **not rewritten**: they are text the user has
already read, and editing them would fabricate a past that did not happen. The unit system is
hardcoded metric — there is no `users.units` column.

Nothing was seen on device, and `pnpm dev` could not be run (missing `@sentry/nextjs`). **No live AI
call was made from this session**, so the new `response.modelId` read is exercised by tests only.

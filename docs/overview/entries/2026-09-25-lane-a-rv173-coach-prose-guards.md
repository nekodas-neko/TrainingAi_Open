# RV-173 — the Coach wrote about the owner's numbers with no guards, and the test could not notice

**Branch:** `lane-a/rv173-coach-prose-guards` · Lane A · v1.465.48.

## The gap

`app/api/coach/route.ts` streams free prose through `loggedStreamText` and its SYSTEM prompt carried
none of `PROSE_GUARDS` — quote the given numbers, metric units only, no superlatives. Those guards
exist because of Q-292: across 117 audited insights, **12 absolute superlatives and 7 Fahrenheit
errors**, including a stored score of 80 described as *"perfect"* and bedroom advice in Fahrenheit
to a metric user. The Coach is the one surface that streams text about the owner's own data, and it
had none of them.

Its docstring still read *"no user-facing entry point yet — Phase 1 ships the protocol only."*
`app/coach/coach-content.tsx:51` has been driving it as the chat transport the whole time. That
stale sentence is part of why nobody added it to the list.

## The half that matters: the test discovers instead of listing

`prose-guards.test.ts` enforced the guards against a **hand-written list of ten routes**. A list
cannot notice a route nobody adds to it, which is precisely what happened.

It now discovers them: every `app/api/**/route.ts` that calls `loggedStreamText`, `streamText` or
`generateText` must reach the guards — in itself, or in a local module it imports (`health-insight`
builds its prompt in `./prompt.ts`). `generateObject` is deliberately not a prose generator: it
returns structured data, and the routes with a user-facing text field inside that object are already
covered by the explicit `PROSE_FIELD_ROUTES` list, which also checks the guards' *content*. The
discovery block is additive, not a replacement.

**Seven routes call a prose generator. Coach was the only one unguarded.**

## Two things the mutation pass earned

**A hole in my own check.** Removing comment-stripping initially **survived**, because
`reachesGuards` matched the bare identifier `PROSE_GUARDS` — so a route that *imports* the guards
and never interpolates them would have passed, which is a route with no guards and a tidy import
list. It now requires `${PROSE_GUARDS}`, matching what the explicit test always did, and that mutant
is killed.

**A silent-pass guard.** The block asserts the scan finds at least seven routes. A discovery test
whose pattern matches nothing passes with no failures and no output — the same shape as LA-138's bad
join earlier today, which returned a confident zero because it keyed on a dead column.

## A claim I made and withdrew mid-task

While surveying I reported that discovery had found a **second** unguarded route,
`nutrition/meal-plans/generate`. It had not. That route uses `generateObject`, and my grep matched a
**comment** mentioning `generateText`. Third time this session a comment has polluted a source scan,
and the reason the shipped test strips them.

## Verification

`tsc` clean · `typecheck:tests` clean (318 / 89, none above baseline) · lint clean · Custom Rules
**78 of 78** · full suite **9,771 passed**, with one unrelated file
(`planned-pct-bodyweight-migration.test.ts`, a migration test) failing only under parallel load and
passing **4/4 in isolation** — the documented local-DB contention artifact.

Mutation pass — **4 mutants, 4 killed** (one only after the fix above), 1 equivalent control:

| mutant | outcome |
|---|---|
| revert the Coach fix | killed |
| discovery stops stripping comments | survived → **exposed the identifier-vs-interpolation hole** → killed |
| the generator pattern matches nothing | killed, 8 tests |
| *control:* the two guard names reordered | survived, correctly |

## Not verified

**The guards are prompt text, so what is tested is that they reach the model — not that the model
obeys.** Q-292 was measured by auditing 117 real outputs; nothing here re-runs that. Whether Coach's
prose actually stops using superlatives is an observation over future conversations.

**No device check, and none is owed** — a server-side prompt change.

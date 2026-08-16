# Structural patterns to break

Phrase-level cuts are easy. These are the shapes that make writing read as machine-generated even
after every filler word is gone.

## Binary contrast

> "This isn't just a caching bug — it's an architecture problem."
> "It's not about speed. It's about correctness."

The second half is the claim. State it. The first half exists only to build a rhythm.

**Fix:** delete the negation, keep the assertion, add the evidence.
> "The cache key omits the local date, so a 30-minute TTL serves yesterday's data across midnight."

## Negative listing

> "No config files. No migrations. No new dependencies."

Three fragments in a row, each starting with the same word. Reads as advertising copy.

**Fix:** one sentence. *"It needs no config, migration, or new dependency."*

## Rule of three

> "It's fast, safe, and maintainable."
> "Read the plan, check the backlog, verify against main."

Three is the LLM default and the reason lists here feel padded. Real constraint sets are rarely
exactly three.

**Fix:** use the number of items that actually exist. Two is usually the honest count. If it really
is three, vary the item lengths so it does not scan as a template.

## Dramatic fragmentation

> "The migration ran. Partially. That was the whole problem."

One-word or one-clause sentences deployed for effect. One per document is a choice; three is a tic.

**Fix:** rejoin into a full sentence unless the fragment is carrying genuine emphasis.

## Rhetorical setup

> "So what actually broke?"
> "The result? A silent data loss bug."
> "Why does this matter?"

A question you immediately answer is a stalling device.

**Fix:** delete the question, keep the answer.

## False agency

> "The complaint becomes a fix."
> "The data tells a story."
> "This decision emerged from the review."

Inanimate subjects performing human verbs. Common in agent-written retrospectives.

**Fix:** name the actor. *"The review (`docs/reviews/2026-07-07-oura-ble-system-review.md`) found
BLE-1 and we changed the cursor to advance only on a server 2xx."*

## Narrator from a distance

> "Nobody designed it this way."
> "Somewhere along the line, the two paths drifted."
> "In many codebases, this pattern causes trouble."

Vague, unfalsifiable, and it puts the reader outside the room.

**Fix:** be concrete about who, when, and where. *"The web route gained a `sleepQuality ?? 'ok'`
default in #47; the `pushMutations` branch never got it."*

## Symmetric parallelism

> "Fast to write, slow to debug. Easy to add, hard to remove."

Two balanced clauses, repeated. Elegant once. A tell by the third time.

**Fix:** break the symmetry — different lengths, different shapes.

## Meta-commentary

> "The rest of this handoff covers the sync path."
> "Before we get into that, some background."
> "To summarize what we've covered…"

Signposting a document the reader can already see the headings of.

**Fix:** delete. Headings are the signposts. Let the doc move.

## Confident vagueness

The most damaging one in this repo, because it survives every other check.

> "Fixed a cache invalidation issue affecting several screens."

Grammatical, direct, active, no filler — and it tells the next session nothing. Which screens? Which
key? Which group helper? Was it observed working, or only reasoned about?

**Fix:** replace every abstract noun with the thing itself.
> "`invalidateProgramStructure()` missed `ta_recommendation_v1`/`ta_meta_v1`, so home re-painted the
> pre-edit session list after a Config save. Both now clear via `clearLegacyHomeSeeds()`. Verified on
> `pnpm dev`; not verified on the APK."

## Checking a draft for these

Read only the first four words of every sentence in a section. Patterns surface fast: repeated
openers, stacked fragments, a question-answer rhythm, three-item cadence. If the openings look like a
template, the prose reads like one.

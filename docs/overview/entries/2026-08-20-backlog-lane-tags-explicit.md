# 2026-08-20 — eight of Lane A's top ten items were not Lane A's

**Branch:** `fix/backlog-lane-tags-explicit` · **Lane A**

## What was happening

Earlier today I fixed `next-item.js` letting an entry's **prose** outrank its own lane **field**. That
fix only covered entries that *have* a field form. It left a bigger residual class untouched, and
measuring it was unpleasant:

**19 entries have no `Lane:` field at all and mention both lanes in prose.** The parser took the first
match. And the most common shape in this backlog is a banner reading *"the Lane A half SHIPPED — what
is left is Lane B only"* — which puts an `A` several lines above the real tag.

So **eight of Lane A's top ten READY items were Lane B's**: Q-326, Q-398, Q-407, Q-409, Q-327, Q-410,
Q-321, Q-328. The tool was silently guessing on the exact decision it exists to make, and guessing
wrong, at the top of the list an implementer is told to start from.

## The fix is to refuse

No heuristic can tell prose from a tag reliably. So when there is no field form and the bare mentions
disagree, `laneFromLines` returns **`?`** — which the tool already means by *"I could not tell"*: it
surfaces to a human instead of being filtered away. A wrong lane sends work to the wrong agent
silently, which is strictly worse than admitting an entry needs a tag.

## And then resolving the 19, because otherwise the fix just makes a mess visible

Each entry's own text says the answer, so twelve of these are transcription rather than judgement —
*"the Lane A half SHIPPED, what is left is Lane B"* is not ambiguous, it is just not in the field.

| | entries |
|---|---|
| **→ `Lane: B`** | Q-326 · Q-323 · Q-395 · Q-398 · Q-409 · Q-327 · Q-321 · Q-328 · Q-477 · Q-317 · Q-318 · Q-316 |
| **→ `Lane: A`** | Q-392 · Q-315 · Q-541 · Q-464 |
| **→ `Lane: ?`**, genuinely split | Q-407 · Q-410 · Q-535 |

The three left as `?` are **not** laziness: Q-407 and Q-410 are real A/B splits where which half goes
first is a judgement, and Q-535's remaining work is unclear because its sibling Q-318 carries the
other half. Resolving lanes is Orchestrator's job; transcribing an answer an entry already gives is
not, and guessing at the other three would have been.

## What it changes

Lane A's READY list goes from 146 to 137, and its top is no longer a run of nutrition UI work. What
was underneath: **Q-324**, **Q-556**, **Q-555**, **Q-499** — all genuinely Lane A, all previously
buried.

## The duplication I had created, and removed

`laneFromLines` lived in `scripts/lib/lane.js` and was used **only by its own test** — `next-item.js`
kept an inline copy of the same rule. The two drifted within a day: the lib learned to refuse an
ambiguous entry and the tool went on guessing, so the unit test was testing a function the tool did
not call. `next-item.js` now collects each entry's lines and calls the shared rule.

## The gate

**Ran 51 of 51** Custom Rules steps · `check-backlog-pointers` OK (201 entries) · 9 tests on the lane
rule, mutation-verified — restoring the guess turns the new case red.

## Not exercised

Docs and one script. No route, schema, build or device surface.

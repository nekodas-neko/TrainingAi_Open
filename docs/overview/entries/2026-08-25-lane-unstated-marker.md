# 2026-08-25 — the queue says which rows it has not classified (LB-12)

**Branch:** `chore/next-item-lane-unstated` · **Lane B** · one script, one filed entry. No product
change, no version bump.

## Why this came up

Four entries had their lane corrected one at a time this session — **Q-403**, then **Q-289**,
**Q-290**, **Q-291** — and the two rows immediately after them (**Q-295**, **Q-294**) were the same
problem again. At that point correcting them individually stops being work and starts being a
symptom, so it was measured instead.

| | |
|---|---:|
| queue entries | 193 |
| lane stated | 116 |
| **lane UNSTATED** | **77 (40%)** |
| of Lane B's 55 READY rows, how many state no lane | **53** |

**Two** of the fifty-five rows the tool offers Lane B are rows the queue actually knows are Lane B's.

## The tool was right and silent, which is the fixable half

`next-item.js` shows an unlaned entry to **both** lanes on purpose: the path rule in
`docs/agents/README.md` §3 is supposed to answer it, and hiding a row from the lane that might own it
would be worse than showing it to the one that does not. That default stands.

What was wrong is that it said nothing — a reader could not tell a row the queue *knows* is theirs
from one nobody has classified. Those rows now print `⟨lane unstated⟩`, and the READY header counts
them:

```
READY (55) — top of the list is next · 53 state no lane (⟨lane unstated⟩) — apply the path
rule before starting one
   1. Q-295   [platform] Q-295 — Coach is 8% of AI calls…  ⟨lane unstated⟩
```

No entry changes bucket. Nothing is hidden. It marks which rows still owe a path-rule check before
you start one — which is the question the tool exists to answer, and the one it was quietly not
answering.

This is the same shape as PS-6 earlier today: not a wrong answer, an unstated one.

## What is deliberately NOT done

**The sweep.** 77 entries want a `Lane:` field applied, and **lane resolution is the Orchestrator's**
— `docs/agents/README.md` gives it the queue and the docs, and an implementer bulk-editing 77 entries
would be doing another agent's job across the file both lanes read. Filed as **LB-12** with the
measurement, plus one thing worth deciding while sweeping: entries that are *notes rather than work*
should leave READY. **Q-294** says of itself *"this is a note against Q-249, not independent work"*
and *"no branch of its own"*, and it was row 2 of Lane B's queue.

## Verified

Run against the real backlog for both lanes: buckets and counts unchanged, marker present on exactly
the rows whose `laneFromLines` returns `null`. `check-backlog-pointers` OK at 194 entries ·
`pnpm check:rules` **Ran 56 of 56** · eslint clean.

**No unit test was added**, deliberately: the change is one ternary inside a non-exported `fmt`, and
restructuring the script to make a display string testable would be more risk than the string. The
rule it reads — `laneFromLines` returning `null` for "not stated" — is already pinned by
`scripts/__tests__/backlog-lane-resolution.test.ts`, including the case where returning `undefined`
instead once hid 96 of 203 entries from both lanes at once.

## Not exercised

Developer tooling; nothing device-related.

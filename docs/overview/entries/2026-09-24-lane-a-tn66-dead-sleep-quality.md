# TN-66 — Home and an LLM prompt were both reading a write-path default as an answer

**Branch:** `lane-a/tn66-dead-sleep-quality` · **Lane A** · 2026-09-24

`mood_logs.sleep_quality` is `NOT NULL`. The check-in stopped collecting it on 2026-06-25, so the
write path's `'ok'` default became the stored value on every row since — 93 of 108, measured.

That default is load-bearing and stays: without it a queued mutation missing the field is rejected
by the column and strands in the outbox forever, which is how the check-in came back on every app
open (#47). The validator says so in its own comment. The defect was never the default.

The defect was two readers that could not tell a default from an answer:

- **`components/home/home-card-widget.tsx`** rendered *"Sleep: OK"*, every day for 91 days, in the
  card that otherwise shows what the owner reported.
- **`app/api/nutrition-goals/recommend/route.ts`** put it in an **LLM prompt**, beside a genuinely
  measured `Xh sleep` and a real `energy=`. Three months of a constant presented as observation —
  and worse than uninformative, because it teaches the model that this person's sleep never varies.
  The Q-76 comment two lines above exists for the same hazard one field over.

Both reads are gone. Nothing else changed.

## The option the entry missed

TN-66 proposed a `sleep_quality_reported` boolean and a dated backfill. That is a migration, a
`claude_ro` twin, a local SQLite version bump and a backfill — to keep a line on **15 rows from
June**, on a field nothing collects any more. The column would be `false` for every future row
forever: a schema change whose only job is to caveat dead data.

What neither the entry nor that proposal noticed is that **the app already collects a sleep-quality
signal**. `morning-checkin-sheet.tsx` collects `sleepQualityFeel` on a 1–5 scale with its own
touched flag — TN-57's convention, built for precisely this distinction — into `day_checkins`.

The names differ by one word and the tables differ, which is why grepping the dead field's name
reports that nothing collects sleep quality at all. That near-miss is the reusable part of this
entry.

Pointing the surfaces at the live signal is not a one-line swap, though: neither call site reads
check-in data, and Home sits in the persistent tab shell, so a new read there needs
`useCachedValue`, a canonical TTL and registration in the write groups — or it paints once and never
refreshes. And whether Home *should* show that number is an information-architecture choice on a
screen the owner reads daily, which is his call rather than a lane's. Filed as **LA-136**.

Removing a fabricated line needed no such permission, which is why the two halves are separated.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | the prompt fragment returns | killed |
| 2 | the Home line returns | killed |
| 3 | the genuine `energy=` dropped too (over-broad removal) | killed |
| C | the map expression parenthesised, same output | survived (correct) |

Mutation 3 is the one worth having: it fails a fix that removed the honest neighbour along with the
fabricated field, which is the obvious way to over-apply this change.

## A trap worth recording

The first version of the regression test failed — on my own comment. The explanatory note in the
route contained the literal prompt fragment the test greps for, so a comment *about* the absence
read exactly like the thing being absent. Same shape as RV-143, where an entry about the gate parser
was mis-parsed by it. The comment now names the field in prose and says why.

## Failure surfaces not exercised

No device. Home's change is a deletion, so there is nothing new to render, but the card's layout at
the S25 viewport with that line gone has not been looked at.

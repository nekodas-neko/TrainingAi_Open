## 2026-08-20 — Q-362 reproduced, and it is three files and two lanes (Q-362a / Q-362b)

**Branch:** `docs/split-day-log-session-identity` · docs-only, no version bump.

Q-362 said `/api/day-log` keys `workoutDurations` by session name, that the collision was **not
reproduced**, and that the consumer half was "one line" in `day-sections.tsx`. It asked for the
collision to be established before anyone fixed it. Both halves of that turned out to matter.

**Reproduced, against `pnpm dev` and the local dev database.** Two `Push` sessions on one Brisbane
day — 08:00→08:32 and 17:00→18:22, one timed exercise each — then `GET /api/day-log?date=2026/08/19`:

```
workoutDurations: { "Push": { start: "5:00pm", end: "6:22pm", minutes: 82 } }
exercises:        [ Bench Press · Push · 11111111 , Overhead Press · Push · 22222222 ]
```

One key. The morning session's window is **gone**, not merged — the loop at `route.ts:144-166`
writes `workoutDurations[ws.sessionName]` and the last session wins. The `exercises` array beside it
carries the right `workoutSessionId` on every row, which is what makes the fix cheap. Fixture rows
removed from the local database afterwards.

**The consumer half is three files, not one, and one of them is a worse bug than the one filed.**
A sibling-surface sweep for `workoutDurations` found:

| File | Groups by | Consequence |
|---|---|---|
| `components/health/day-detail/day-sections.tsx` | **id** (Q-391) | two correct cards, the same duration on both — the one line the entry meant |
| `components/health/day-overlay-sheet.tsx` | **name** | the two sessions merge into one card, and `loadSessionHr(sessExercises[0].workoutSessionId)` loads **one** session's heart rate under a card listing both |
| `app/session-select/components/week-day-sheet.tsx` | **name** | the two merge into one block with one duration chip |

The heart-rate one is the finding worth the trip. A merged card showing the 08:00 session's HR
against work from both sessions presents a wrong number as the right one, with nothing on screen
saying which session it belongs to — a different failure from a duplicated duration label, and not
what Q-362 was filed about. It is folded into Q-362b's scope rather than filed separately, because
one change fixes both: group by the id.

**Split into two entries, per the protocol.** The route is `app/api/**`, so keying the record by
`workout_sessions.id` is **Q-362a, Lane A**. The three consumers are `components/**` and `app/**`,
so they are **Q-362b, Lane B**, with `Needs: Q-362a` — the order is forced, since a name-keyed
consumer reading an id-keyed record renders no duration at all. `next-item.js --lane B` now parks
Q-362b behind its dependency instead of offering it as startable, which is the whole point of the
field.

**Not exercised.** The route's collision is observed. The three consumers were read from source —
**the merged-card and wrong-HR rendering is inferred from that reading, not seen on screen**; the
reproduction stopped at the API response. Nothing was checked on the S25.

**Verification.** `pnpm check:rules` — Ran 50 of 50 Custom Rules steps, all passed.
`check-backlog-pointers` OK, 211 entries, no cycles, `Needs: Q-362a` resolves.

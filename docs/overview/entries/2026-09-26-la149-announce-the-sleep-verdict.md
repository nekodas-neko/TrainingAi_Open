# 2026-09-26 — LA-149: the verdict now has a way to reach the surface

**Branch:** `feat/la149-announce-sleep-verdict` · **Lane A** · the other half of TN-81; unblocks TN-82

TN-81 landed the computation, the table and the repository methods, deliberately inert. This wires
them to an API so the morning sheet can announce the verdict and record the answer.

## Shape, and why it is a new route

`GET /api/sleep-verdict?date=` and `POST /api/sleep-verdict {date, state}`, rather than adding a
field to `/api/day-checkin`. That route returns the check-in object **directly**, so a new sibling
field would be a breaking change to its response — and the file that reads it is Lane B's, which
TN-82 rewrites anyway. A separate route costs one request on a sheet opened once a day and couples
nothing.

## The two rules the route exists to hold

**A stored verdict is returned, never recomputed.** This is the whole of TN-81: the announcement is
frozen with the values and bands behind it so a correction stays paired with what it disagreed
with. A route that recomputed on every read would undo that silently — the bands would drift under
the answer and nothing would look wrong. A mutant that recomputes is killed by the test.

**The route never writes a `touched` flag.** It writes `response_state` and nothing else. The
correction's *value* belongs to the check-in save path, which already owns that column; only his
own correction is his answer (TN-57).

Writing on a GET is deliberate rather than careless: the row records that an announcement was
**made**, and that happens exactly when the sheet reads it. No read, no announcement, correctly no
row. Repeating it is safe — `upsertSleepVerdict` is idempotent per `(user, date)` and never touches
`response_state`.

Two silences are distinguished, because they render differently: no sleep session yet (the ring
has not drained) and a baseline under 28 nights. Both return `200` with `verdict: null`; the second
adds `baselineNightsRequired` so the surface can tell "not enough history" from "nothing strange
about last night".

## Exercised on `pnpm dev`, against the real route and the local Postgres

Seeded 35 ordinary nights plus a short one, signed in, and drove both verbs:

- **GET #1** — computed `poor`, `triggered: ['duration']`, components `{5.2 h, −60 min, 89%}`,
  duration band `(7.5, 8.25)`, `baselineNights: 28`, `responseState: 'none'`, and the row appeared
  in `sleep_verdicts`. The `−60` is the onset helper reading 23:00 Brisbane correctly.
- **GET #2** — byte-identical, no recompute.
- **POST `corrected`** → `200`; **GET #3** → same verdict, `responseState: 'corrected'`.
- **POST for a day never announced** → `404`, not a silent `200`.
- **`day_checkins` touched flags: unchanged.** The two that are set are from 2026-09-22 and are
  `perceived_recovery` — pre-existing fixtures. Checked by timestamp rather than assumed, because
  "no touched flag" is the claim TN-57 exists to protect.

The seeded nights were removed afterwards and the seed's own 7 restored, so the local DB is back
where it started.

## Mutation pass

8 deliberate defects, all killed; 2 deliberately equivalent controls, both survived.

One mutant was **mis-specified and is worth recording as such**: "store a verdict below the
coverage floor" only removed a response field, because the early return it meant to delete is
guaranteed by the type system — the code after it dereferences a value TypeScript knows is `null`.
So it was really a third control. It did surface something real, though: `baselineNightsRequired`
is part of the contract TN-82 reads and nothing pinned it. It is pinned now.

## Not exercised

No device run, and none applicable yet — this is a server route with no UI. The surface that
announces it is TN-82 (Lane B), which now has its `Needs:` cleared and needs the APK for its own
pass. Nothing here has been exercised against drifted production data: the owner has 119 nights, so
the coverage floor will be satisfied on the first real read, which is the opposite of the local
seed's 7 and worth knowing when the surface lands.

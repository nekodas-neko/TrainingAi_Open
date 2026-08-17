# 2026-08-17 — Q-305 re-measured over 8 weeks, and the finding inverts

**Branch:** `claude/implementation-lane-b-0o7kb9` · **No version bump** — no product code changed · **Lane:** Implementation B

## What this was

Q-305 says the volume landmarks (MEV/MAV/MRV) are computed and never shown to anyone. It also gated
its own implementation:

> ⚠️ One week of one user is a small sample and a light week is not a defect. Before building
> anything, re-run the query over 4–8 weeks…

That re-run is what this PR delivers. **Nothing was built** — the entry asked for a measurement
first, and the measurement is the deliverable.

## The method, and the mistake it caught

56 days of `exercise_logs` × `set_logs` against production via `POST /api/admin/db-query`,
soft-deleted rows excluded, sets attributed by `exercise_library` muscle tags — the same attribution
the app uses.

The part that mattered was not the window length. **The entry's §3 table compared measured volume
against the raw hypertrophy landmark row, and no user is ever measured against that row.** The
landmarks are goal-scaled before use, and the owner's active program *Shikai* is `powerbuilding`, so
`GOAL_MULTIPLIER` applies **×0.8** to the whole table. Comparing against the unscaled row makes every
muscle look lower relative to its target than it is.

Corrected, over 56 days:

| muscle | sets/wk | MEV | MAV | MRV | verdict |
|---|---|---|---|---|---|
| glutes | 22.1 | 3 | 8 | 14 | **158% of MRV** |
| hamstrings | 21.6 | 5 | 10 | 14 | **154% of MRV** |
| triceps | 20.3 | 5 | 10 | 16 | **127% of MRV** |
| shoulders | 14.9 | 6 | 13 | 18 | above MAV |
| biceps | 14.0 | 5 | 11 | 18 | above MAV |
| lower back | 9.4 | 3 | 6 | 10 | above MAV |
| lats | 9.3 | 8 | 13 | 18 | in range |
| upper back | 6.3 | 6 | 11 | 16 | in range |
| calves | 2.8 | 6 | 11 | 16 | **47% of MEV** |

Two corrections to what the entry recorded:

1. **It was not a quiet week.** The pattern holds across eight, so the sample-size caveat is
   discharged rather than confirmed.
2. **Lats and upper back are not below MEV** — they only read that way against the unscaled table.
   Calves are the single genuine deficit, and scaling makes them *worse* (47% of MEV, not the
   "quarter of MEV" the raw comparison suggested — different denominator, same direction).

**The headline inverts.** §3 framed this as under-volume. Three muscles are above *max recoverable*
volume; one is below minimum effective. A surface designed around "you are not doing enough calves"
would miss the larger half of what the data says.

Push:pull replicated independently: legs 458 sets (34%), push 382 (29%), pull 286 (22%), other 202
(15%) over the same 56 days — **1.34**, against the 1.30 the entry recorded over 60 days. Same mild
push dominance, nothing pathological.

## What is left

Q-305 stays in the queue. Its actual work — the surface — is untouched, and it still carries the
cross-item design question the entry raises: whether Q-278, Q-302 and Q-305 get one shared treatment
rather than a third bespoke card. Per the backlog protocol that wants a planning PR before an
implementation PR, and the IA cluster (Q-232…Q-239) is the context for where it lands.

## What was NOT exercised

- **No code ran.** This is a read against production data through the read-only `claude_ro` schema.
- **`claude_ro` is row-scoped to one user**, so every number here is the owner's training only. That
  is the right scope for this question — the landmarks are per-user — but it is not a claim about
  anyone else's volume.
- **Landmark values were read from the source table and scaled by hand** to match what the app
  computes. That is a re-derivation, not an observation of the app's own output; the app has no
  surface that displays a landmark, which is the entry's entire point.

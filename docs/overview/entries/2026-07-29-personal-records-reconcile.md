## 2026-07-29 — Q-5b: making `personal_records` mean what it says

**Branch:** `fix/personal-records-reconcile` · migration 163 · owner-confirmed work, **presented before merge**

Q-5's structural half (migration 159) split the two meanings the table had been serving — an earned
all-time best, and a starting 1RM typed into the builder. This is the data half: the part that
rewrites existing rows, held back through several sessions until the owner confirmed it.

### The plan's numbers had gone stale, and re-auditing was the whole job

The backlog said "Barbell Bench Press 90.8 → 96.0". Production says **92.75** → 96.0. A month of new
logs had moved it. Had the migration been written from the plan's literals it would have targeted a
value that no longer exists and silently done nothing — the failure mode the "re-verify the plan
against current `main`" rule exists to catch, arriving through data rather than code.

Everything below was derived from a fresh read-only audit of production (`claude_ro`), not from the
plan.

### What it does to the 36 live rows

| exercise | from | to | why |
|---|---|---|---|
| Barbell Bench Press | 92.75 | **96.00** | the best log (2026-05-21) predates the PR row, so IfBetter never saw it |
| Barbell Front Squat | 67.50 | **73.75** | same |
| Dumbbell Hammer Curl | 19.25 | **15.75** | no log supports 19.25 |
| Straight Arm Pulldown | 34.50 | **32.50** | no log supports 34.50 |
| Tricep Cable Combo | 33.25 | **29.25** | no log supports 33.25 |
| Dumbbell Lateral Raise | 16.75 | 16.75 | value right, `achieved_at` pointed at the wrong day |

Plus three free-text duplicates merged away: 36 → 33 rows.

### Why the downward corrections are not data loss

A value no log can account for is, by elimination, a number the user typed — a seeded starting 1RM
from when the builder wrote them here. **Step 1 copies those into `exercise_estimates` before
anything is corrected**, and `resolveWorkingBasis` takes the max across log / estimate / PR. The
number keeps doing its job from its proper home; only its claim to be an *earned* record is
withdrawn. The ordering is the load-bearing part, so it is pinned by a test that was confirmed red
when the two steps are swapped.

### Two deliberate departures from the plan

**1. Three of the five name pairs are merged, not five.** The three that are — `Dumbell`/`Dumbbell
Preacher Curl`, `Dumbell`/`Dumbbell Shoulder Press`, `DB lateral Raises`/`Dumbbell Lateral Raise` —
are free-text misspellings with no `exercise_library` row. They are exactly the three NULL
`exercise_id` rows, which is why the plan's "backfill `exercise_id` on all 36" turns out to be
nothing to do: the other 33 ids were verified correct against the library by name, and these three
have nothing to point at.

The other two are a different animal:

| pair | logs | last used |
|---|---|---|
| `Cable Pulldown` | 11 | 2026-07-22 |
| `Cable Lat Pulldown` | 2 | 2026-06-14 |
| `Cable Crunch Abs` | 15 | 2026-07-24 |
| `Cable Crunch` | 1 | 2026-06-25 |

Both sides of each pair are **distinct `exercise_library` entries and both are actively logged** —
and the plan's "keep the canonical spelling" rule would have kept the one the owner has *stopped*
using and deleted the record for the one they actually train. Whether a straight-arm "Cable
Pulldown" is the same movement as a "Cable Lat Pulldown" is a catalogue decision, not data hygiene.
Left open.

**2. The variants' `exercise_logs` are renamed too**, which the plan did not ask for. A PR-only merge
leaves the table asserting a best that the logs under that name cannot support, and the next
`reconcilePersonalRecord` call for that exercise would quietly undo the merge. Renaming makes the
merged value derivable, which is the entire point of the table after Q-5. `set_hr_stats` and
archived `session_exercises` rows move with it, so reactivating an old program cannot re-open the
split.

### Generic over users, and non-destructive by construction

No production row ids and no user id are hardcoded; every statement is expressed over all users and
is inert on a database without these rows. That does mean it acts on the other production accounts —
which is safe because of the order: anything unsupported is preserved into `exercise_estimates`
first, and a PR with no surviving log at all is **left alone rather than deleted**. Verified on a
second local user: their two unsupported PRs were copied to estimates and their rows left intact.

The 1RM formula is not restated (One Formula, One Place) — only the *selection* is, an aggregation
over the `estimated_1rm` column the log path already wrote, with a gate mirroring
`reconcilePersonalRecord` exactly. Same approach migration 148 used.

### Verification

Full suite **2,746 passing** before the new tests, **2,759** with them; `tsc`, lint and
`check-push-mutations` clean.

13 DB-backed tests. **Three were confirmed red against deliberately-broken variants of the
migration** — dropping the deload gate, dropping the `user_id` partition (which would stamp one
account's best onto every user), and moving the preserve step after the correction (which would
delete the typed values). A test that passes either way proves nothing.

The migration was also run twice against a local fixture reproducing the production shapes: correct
after the first run, byte-identical after the second.

### Not exercised

It has not run against production — that happens on deploy. The predicted outcome above was computed
by running the migration's own selection logic against prod read-only, including the post-merge
state, so the six changed rows and the 36 → 33 count are measured rather than assumed.

# Review — 2026-08-18 · this run's own findings, checked against production

_Lens: **measure the claims**. Seven sweeps this run filed 22 findings (Q-450…Q-471), almost all from
code-reading and a local seeded database. `claude_ro` had never been queried directly in any of them.
This sweep points production at my own conclusions._

_Result: **one new finding (Q-472), one of my findings refuted, two re-scoped to zero production
exposure, one shown to be unprovable either way, and `error_events` clean.** More of this write-up is
corrections than discoveries, which is the point of running it._

## Method, and what it does not establish

`POST /api/admin/db-query` over the `claude_ro` views, against Railway production.

**The constraint that governs every number below:** those views are **row-scoped to one user** and
`error_events` **prunes at 30 days**. So every count here is *the owner's data, recently* — never
"the system's". Where a count is zero, that means the owner has never done the thing; other accounts
are structurally invisible to this endpoint and no claim is made about them. This is `CLAUDE.md`'s own
warning about this endpoint, and it is load-bearing for how Q-472 below should be read.

**One query in this sweep was wrong and is corrected in place** — see Q-465. The wrong version would
have produced a dramatic and false headline.

---

## Q-472 — the Coach's write capability has never once been used in production

**Severity: low as a defect (it is not one) — filed because it re-prices Q-467 and Q-468, and because
a subsystem this size with no usage is a question the owner should get to answer.** `[app-shell][platform]`

`coach_changes` is **empty**. Not "no undos" — **no applied changes at all**, ever:

```
total: 0    ever_undone: 0    first: null    last: null
```

The Coach is not unused. The owner has had **5 threads / 16 messages** (8 user, 8 assistant), the most
recent on 2026-08-13, and the AI-usage screen shows 17 Coach calls in 30 days. The assistant is
rendering its widget vocabulary:

| | count |
|---|---|
| assistant messages | 8 |
| carrying any tool call | **8 of 8** |
| carrying a `choice_list` | 5 |
| carrying a **`change_preview`** | **1** |
| **changes actually applied** | **0** |

So across five conversations the model proposed a change **once**, and it was not accepted.

**What this does and does not mean.** It does **not** mean apply is broken — I applied a patch through
the real route in the previous sweep and it worked correctly, and the four client call sites are
wired. It means the write capability — five domain handlers, apply, preview, undo, `coach_changes`,
roughly 1,100 lines under `lib/coach/domains/` alone — has produced **zero writes**. Whether that is
because the model rarely proposes changes (1 preview in 8 assistant messages), or because the one
proposal was simply declined, is **not determinable from this data**, and I am not going to guess
between them.

**Why file it rather than leave it as an observation:** it changes the priority of two entries filed
hours earlier (below), and "is this earning its complexity?" is an owner question, not a reviewer's.
The measurement that would answer it is a wider window or a second account — neither available here.

---

## Corrections to this run's own findings

### Q-467 and Q-468 have zero production exposure — re-scope, do not close

Both remain **real defects**; both are **latent in a way the entries did not say**.

- **Q-467** (the Coach's undo has no caller): still true in code. But since no change has ever been
  applied, there has never been anything to undo. The user-facing harm the entry describes — "the
  Coach changed your programme and you cannot reverse it" — **has not yet happened to this account**.
- **Q-468** (undo restores stale state without a drift check): I demonstrated it live locally and it
  reproduces. In production there is **not one `target_id` with more than one change**, so the
  stacked-change scenario that triggers it has no instance.

Neither should be closed: the code paths are wrong and the first real use will meet them. But
"upper-mid, at the top of the queue" was priced on an exposure that does not exist yet. Both entries
now carry this correction.

### Q-465 is refuted — my first query was wrong, and the corrected one kills the finding

Q-465 filed `POST /api/day-checkin` creating a row from an empty body, and said explicitly that its
consequence was unproven. Production settles it: **unproven and, so far, absent.**

My first query reported **45 of 50** check-in rows "entirely empty" — a dramatic number that was
**wrong**. It tested only the seven evening-check-in columns and ignored six morning ones
(`wake_mood`, `perceived_recovery`, `motivation`, `sleep_quality_feel`, `resting_soreness`,
`illness_context`). All 45 morning rows carry answers in exactly those columns. Re-run against **all**
answer columns:

| phase | rows | truly empty |
|---|---|---|
| morning | 45 | **0** |
| evening | 5 | **0** |

**Zero empty check-ins exist in production.** The route accepts `{}` and will write a hollow row, but
nothing in real use has done so. Q-465 is amended to say so and dropped in priority; filing it with
"consequence unproven" rather than an invented symptom is what made this correction cheap.

### Q-460 cannot be adjudicated from production, and that is worth recording

Q-460 said a session RPE can be silently dropped. Production:

```
completed sessions: 77    with an RPE: 20    missing: 57  (74.0%)
```

74% missing looks supportive and **is not evidence**. A dropped write and a user who simply skipped
the optional RPE prompt are indistinguishable here, because the mechanism Q-460 describes leaves the
value in the *local* store — which this endpoint cannot see — while the server row looks identical to
a skip. **Do not cite the 74% as proof of Q-460 in either direction.** Separating them needs the
device, which is the standing ceiling on this whole run.

---

## Clean — `error_events` holds nothing new

The session-start ritual's read, done properly. Last 30 days, grouped:

| url | message | hits | latest |
|---|---|---|---|
| `POST /api/hr-ingest` | `[pg 21000]` insert into `oura_heartrate` | **5,771** | 2026-08-13 |
| `/` (client) | Minified React error #418 | 91 | 2026-08-07 |
| `POST /api/oura-ble/samples` | `aborted` | 74 | 2026-08-13 |
| `POST /api/oura-ble/samples` | connect timeout | 40 | 2026-08-13 |
| `POST /api/oura-ble/battery-poll` | `aborted` | 23 | 2026-08-17 |

**The 5,771 dominate everything and are already recorded and fixed** — the backlog carries the
cardinality-violation entry with the same count, and the last occurrence (2026-08-13) is the fix
landing rather than a fault that stopped mysteriously. I checked before filing; a duplicate entry for
the loudest line in the table would have been the easy mistake.

The remainder are connection-timeout and `aborted` noise mapping to the already-recorded pool and
disk-full incidents. **Nothing in the last 7 or 30 days is unrecorded.**

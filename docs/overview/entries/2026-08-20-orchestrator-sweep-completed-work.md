## Orchestrator sweep 1 — the completed-work baseline, cleared (2026-08-20)

The first run of the Orchestrator role. `scripts/check-backlog-pointers.js` carried a shrink-only
list of **17 queue entries whose heading announced its own completion**; the sweep's job was to work
it to zero, confirming each against a merged diff rather than against its own heading.

**Seven of the seventeen were finished.** Ten were not, and that ratio is the finding.

### What each turned out to be

| | entries | what happened |
|---|---|---|
| **Deleted — finished, nothing owed** | Q-107 · Q-139 · Q-170 · Q-207 · Q-213 · Q-217 · Q-32 | verified in a merged diff or in production, and any residual check is already tracked by a `projectOverview.md` row |
| **Kept with a `Keep:` line + `Gate: owner`** | Q-11 · Q-71 · Q-1b | the code shipped; each still owes the owner an action only they can take |
| **Retitled — never finished** | Q-149 · Q-219 · Q-254 · Q-270 · Q-298 · Q-394 · Q-500 | the heading announced a diagnosis, or one half of the work, or a fix production later refuted |

The baseline is now `new Set([])` and stays shrink-only: an ID may leave it, never join it.

### The one that mattered: Q-270 was marked FIXED FORWARD and is not fixed

`training_load_ots` was reported empty on 89 days, diagnosed as "nothing ever calls the route", and
closed on 2026-08-15 with a sync-provider warm-list entry. That entry set its own re-check condition:
*"Re-read `training_load_ots` in a day or two; if it is still 0, the diagnosis was incomplete."*

Five days on, `claude_ro.oura_daily_derived` holds **96 days with the column populated on 0 of them**,
and `active_calories_est` on 0 as well. Nobody had run the re-check. The entry is reopened 🔴 with the
measurement and one instruction: prove the route is called at all before re-measuring the four gates,
which were measured passing on 2026-08-15 and are the trap this entry has already fallen into once.

Q-298 is the same shape, more quietly: its heading read RESOLVED because the *cause* was found.
`log-exercise.ts:196` still zeroes the estimate on the phase-level deload while line 264 still stores
only the AI flag — the two-line fix it describes was never written.

### Q-213 and Q-107 closed on production evidence, not on their own say-so

Both entries said in their own text that they could only close on a production read. The whole
retained `error_events` window (2026-07-20 → 2026-08-19), grouped by day:

| day | connect-timeout | `/api/sync/pull` | body-battery + readiness-score | all events |
|---|---:|---:|---:|---:|
| 08-19 | 0 | 0 | 0 | 1 |
| 08-17 | **1** | 0 | 0 | 8 |
| 08-15/16/18 | 0 | 0 | 0 | 1 each |
| 08-13 | 16 | 1 | 2 | 757 |
| 08-12 | 39 | 0 | 2 | 2,556 |
| 08-09 | 33 | 1 | 3 | 2,615 |

All three families stop dead on **2026-08-13**, the day Q-213's stages shipped. The single
connect-timeout since then sits inside the unrelated `disk_full` outage of 2026-08-17, which the same
date's two `[pg 53100]` rows identify. The app was in use throughout — `set_hr_stats` rows were
computed on 08-15, 08-16, 08-17 and 08-19 — so the silence is not an idle account.

That evidence also closed two `projectOverview.md` Known Issues, moved whole to the archive: the
`/api/sync/pull` fan-out row (**the batching fix it proposed should not be built** — Q-213 established
the pool exhaustion was a symptom, not a cause) and the `/api/body-battery` + `/api/readiness-score`
row, whose "cause NOT diagnosed" now has a cause. The Q-213 row itself **stays live**: none of the
three stages has been exercised on the S25, and that gate is untouched by any of this.

### Also measured, and recorded where it belongs

- **Database: 178 MB total**, against a 171 MB baseline on 2026-08-18 — inside the ~0.4 MB/day trend,
  no row needed. `oura_raw_samples` is now 63 MB over 221,499 rows, which weakens Q-219's size case
  enough that the entry says so.
- **22 of 78 completed workout sessions still hold no per-set HR attribution**, and no bulk
  `computed_at` batch has landed since 2026-07-22 — the Q-11 backfill button has not been pressed.
- **85 device-verification rows**, tagged browser 31 · android 26 · data 11 · hardware 15. **Two carry
  no `needs:` tag at all**; Q-254 now says so.

### Verification

`pnpm check:rules` — **50 of 50**. `node scripts/check-backlog-pointers.js` — 204 entries, 0
baselined done-headings. `node scripts/next-item.js` places every entry. `anchor-source.test.ts`
re-run for Q-394: 3 passed.

Two traps recurred while archiving, both already documented and both caught by the gate rather than
by care: relative links shift by two directory levels moving from `projectOverview.md` into
`docs/overview/`, and an archived heading that names a still-live entry's ID reads as a duplicated
issue.

**Not exercised:** nothing here touched the app. Docs and one CI script. No runtime, no device, no
version bump.

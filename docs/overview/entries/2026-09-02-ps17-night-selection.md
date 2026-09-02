## 2026-09-02 — a nap that did not happen scored a day, because the rollup kept its own wrong copy of a rule (PS-17, defect 2)

**Branch:** `claude/la-ps17-night-selection` · **Lane:** A · **No version bump** — an engine
correction with no user-visible surface; the stored day is still wrong until the back-fill runs.

### The fault

2026-08-27's `oura_daily_summary` reads **4.75 h, HRV 26.5, RHR 73.7**. The surrounding days read
7.5–8.25 h at HRV 53–71 and RHR 59–62. Those are awake daytime values, and readiness for the 27th
was computed from them.

### The entry's diagnosis was half right, and the wrong half mattered

PS-17 says *"the summary picks the wrong session when a day has several."* **The summary never reads
`sleep_sessions`.** Verified against production:

| date | `sleep_sessions` | `oura_daily_summary` |
|---|---|---|
| 08-27 | real night **+ phantom** | took the phantom ✗ |
| 08-29 | **phantom only** | correct, 8.25 h ✓ |
| 08-30 | **phantom only** | correct, 7.92 h ✓ |

On the 29th and 30th the summary holds a night that is **not in `sleep_sessions` at all** for that
date. Two different write paths. Had I built "pick the longest session for the summary" as written,
it would have been a fix to something that does not exist.

**Only 08-27 was ever corrupted.** The entry lists three phantoms but claims damage for one, and
that is exactly right.

### What it actually was

The rollup resolves its own one-night-per-date map, and that loop did a bare `.set()` per period —
**last-wins**. On the 27th the day carried two night *periods*: the real night (23:02→06:37) and the
phantom (11:35→16:52). The 5 h gap between them is past `MAX_INTRA_NIGHT_GAP_HOURS = 3`, so they
never merge, and the later one won on recency.

**The rule was never missing.** `nightForDate`, in the same module as the classifier, documents it:
*"When a day somehow carries more than one night period … the longer wins — total sleep, not
recency."* The rollup had a second, wrong copy — One Formula, One Place failing in the direction
that is hardest to see, because both copies look reasonable in isolation.

So the fix removes the duplication rather than correcting the copy: **`nightPeriodsByDate`** in
`sleep-night.ts`, called by both `nightForDate` and the rollup.

**A second last-wins site went with it.** `bdiByDate.set(wakeDate, …)` carried a comment saying it
was *"matching the last-window-wins semantics of nightInputsByDate below"* — so fixing one silently
drifts the other. BDI is now keyed per window and lifted out by the winning period.

### Why the phantom is called a night at all — identified, deliberately not fixed

`ALWAYS_NIGHT_MIN_HOURS = 4` short-circuits the circadian check, so a 4.75 h window is night sleep
wherever it sat; the phantom's midpoint is 14:13. **Raising that constant would be a calibration
decision on n=1** — it is the escape hatch that stops a shift worker scoring nothing, and the margin
is real but narrow (longest nap in the history 1.42 h, shortest real night 5.33 h). Along with the
detector emitting a sleep window over 468 logged steps, it stays open on PS-17.

### Verification

Six tests built from the actual production rows, pinning the three facts that combine: the escape
hatch admits the phantom, the day yields two periods, and last-wins picks the 4.75 h one.
**Mutation-tested** — reverting `nightPeriodsByDate` to last-wins fails exactly 2 of 28; restoring
passes all 28. An earlier version of the test inlined the selection loop and would have passed with
the rollup still broken; it now calls the function the rollup calls.

Full suites: rollup project 71 passed, health + Postgres 1,884 passed, `pnpm check:rules` 67 of 67.

### The back-fill has NOT run, and I could not run it

The 27th's summary is still wrong on disk — this changes what a *future* aggregate writes. The
re-aggregate is `POST /api/oura-ble/samples/redecode`, which is **session + admin gated with no
bearer path**, and this session has read-only database access. It needs the owner once this deploys.

## 2026-09-07 — The collection engine can be fed now, and the threshold I picked was wrong (LB-60)

**Branch:** `feat/collection-read-route` · **Lane A**

### What shipped

`GET /api/collection` returns the three finished `CollectionState`s. BF-122a shipped
`replayCollection` as a pure fold and deliberately no route, which left it with **no caller anywhere
in the repo** and BF-122b's widget unstartable: of the four things a `ReplayInput` needs, the client
could reach one, over a fixed window, for one of the three ladders.

Returning the **states** rather than the inputs is what LB-60 asked for and it is right — the fold is
shared and pure, so shipping its inputs to the client lets two places disagree about which days
paused, which for `pausedDays` is the difference between a rest day the app asked for and a missed
one.

- `repo.listTrainedDayKeys(userId, tz)` is new: every local day with a surviving exercise log, all
  history, distinct, ascending. **No window** — a windowed replay is a wrong answer, which is why
  `/api/streak-data` could not be reused.
- `maxRestGap` comes from `maxCompliantRestGap(activeProgram)` for the workout ladder, and from
  `ladder.ts`'s own constants for the other two.
- `pausedDays` is `listRestDays` — the rest days the user actually chose.
- `COLLECTION_RULES_VERSION` rides on the response, and the route is `private, no-store`. Both
  halves of BF-122a's versioning note: the state is replayed on every read, so a cached response and
  a live one must not straddle a threshold change.

### The correction worth reading

I first wrote a `faucets.ts` with `STEPS_FAUCET_MIN = 8_000` and `SLEEP_FAUCET_MIN_HOURS = 6`, and
flagged them as an owner decision. **Both were wrong, and the file already said so twice.**

**`STEPS_MAX_REST_GAP` and `SLEEP_MAX_REST_GAP` already existed** in `ladder.ts`. I added a third
copy of the same number under a new name because the engine's field comment says *"a constant for
steps and sleep"* and I read that instead of grepping for the constant — the One Formula, One Place
defect I have been fixing all session, committed while fixing it. The module map's own row for this
file named both constants; I had read the row.

**And the threshold contradicted the design it was calibrated against.** `ladder.ts` chose a 2-day
allowance because *"steps logged 129 of 129 days and sleep lands nightly, so these two ladders will
essentially never decay — they are the calm half BY CONSTRUCTION. Do not tighten them to manufacture
tension."* That is a statement about days **with data**, not days above a bar. Measured on production
before wiring it up:

| faucet | recorded | above my threshold | average |
|---|---|---|---|
| steps | 130 days | **35** (≥ 8,000) | 5,646 |
| sleep | 107 nights | 79 (≥ 6 h) | 6.27 h |

An 8k faucet with a 2-day allowance decays the steps ladder most weeks — exactly the tension the file
says not to manufacture. So a faucet day is a **recorded** day, there is no threshold, and there is
no owner decision to make. A per-user goal would have been worse still: goals are editable, so
replaying against one un-spawns past days the moment someone raises their target — the retroactive
rewrite the versioning note exists to prevent, arriving without anyone editing a constant.

### Verification

- `packages/shared` + `lib/__tests__` + the timezone suite + `app/api/__tests__`: **3460 passed**,
  10 skipped.
- The route tests pin the **assembly**, not the fold (`collection/__tests__` already covers the
  fold): all history rather than a window, the schedule-derived allowance on the ladder that has a
  schedule, chosen rest days as `pausedDays`, a recorded day as a faucet day, and that the rest gaps
  come from the existing constants rather than a new copy.
- **Mutation-checked four ways:** dropping `pausedDays`, swapping the schedule allowance for the
  constant, making the faucet exclusive, and hardcoding Brisbane in the new SQL each fail exactly one
  case. The timezone one matters most — this reader has no window, so a day filed in the wrong zone
  is wrong forever rather than until it ages out.
- `pnpm check:rules` — **Ran 68 of 68**. It caught a real violation on the way: my test helper walked
  days with the banned `toISOString().slice(0, 10)`, now `shiftDateStr`.
- `tsc --noEmit` clean, ESLint clean. `pnpm dev`: the route returns 401, not 500.

**Not exercised:** no widget consumes this yet — BF-122b is the surface half and it is Lane B's. The
route has not been called with a real session, so the numbers it returns for the owner's history are
unverified; the assembly is what is tested.

### What is still owed

**LA-76 — deload days are not in `pausedDays`.** BF-122a's argument is that decaying compliance turns
the mechanic against the user, and a deload week is compliance the app itself prescribed.
`isDeloadActive` answers per day given a resolved phase, so covering a week means running the phase
engine per day across all history — too much for a read route on every call and too easy to get
quietly wrong. A rest day is weekly and a deload week is occasional, so the common case is covered
and the remainder is filed rather than pretended away.

No version bump: nothing user-visible ships until the widget does.

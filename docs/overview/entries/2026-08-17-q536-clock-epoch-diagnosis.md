## 2026-08-17 — the 43 midday bedtimes are a spurious clock epoch, not a timezone bug (Q-536 diagnosis, docs-only)

Q-536 was handed to Lane A as top of queue with an explicit gate: *"Do not run a corrective pass
until the open question is settled"* — whether the 2026-07-04 → 08-16 rows were already wrong or
were rewritten wrong by the 2026-08-17 redecode. **Both of its questions are now answered from
production, and two hypotheses are refuted.** No code shipped: the fix the entry proposed would have
made things worse, and the fix that is right mutates the owner's health history.

### What is actually wrong

The ring clock **never reset**. `oura_ble_clock_anchors` holds four epochs, and the minimum lag
(`anchor_utc − anchor_ds×100`, bounded below by the true offset because an event cannot be received
before it happened) agrees across all four to within **50 seconds**, over three weeks and 5,368
anchors:

| epoch | anchors | min lag vs epoch 2 | p10 lag vs epoch 2 | created |
|---|---|---|---|---|
| 0 | 312 | −5 s | −0.01 h | (default) |
| 1 | 695 | +44 s | **+12.17 h** | 2026-07-30, 28-min burst |
| 2 | 3,666 | 0 s | 0.00 h | 2026-07-30 |
| 3 | 695 | +45 s | **+14.16 h** | 2026-08-17, 40-min burst |

Epochs 1 and 3 are **history re-drains misread as resets**. After a re-pair the app holds no sync
cursor, so the ring replays days of buffered events; the replayed `ds` looks like a counter
regression and `isClockEpochReset` opens an epoch. The counter is in fact continuous — epoch 3's
first sample above epoch 2's ceiling is ds 37,112,507 against 37,112,321, a gap of **18.6 seconds**.
Nothing dropped to near zero, which is what `clock.ts` itself says a real reset does.

The damage follows in two steps. `robustOffsetMs` estimates an epoch's offset at the **p10** of lag,
justified in its own comment by a steady-state measurement (n=99, p0→p10 spans 1.4 min). A re-drain
breaks that assumption outright: over 90% of the burst's anchors carry backlog, so p10 lands 14.16 h
inside it. Epoch 3 then became `currentEpoch(anchors)`, and `aggregateOuraRawSamples`'s `toDate`
(`adapter.ts:5088`) calls `resolveDsToMs(ds, anchors)` **with no epoch argument**, defaulting to the
newest. Every historical sample was re-timed by +14.16 h.

**The number reconciles exactly.** Subtracting 14 h 10 min from the 43 wrong `sleep_start` values
puts every one into a bedtime distribution: 2 at 20:00, 15 at 21:00, 23 at 22:00, 2 at 23:00, 1 at
00:00 Brisbane. Nothing else is needed to explain them.

### The two blocking questions

**Were the rows already wrong, or rewritten wrong? Rewritten, by the redecode.**
`sleep_sessions.updated_at` shows **49 nights** written on 2026-08-17 covering 2026-07-08 →
2026-08-17; every other night was last written on its own day. Before the reinstall `currentEpoch`
was 2, whose offset matches epoch 0's to within 48 s — so those rows were **correct when written**.
Nothing needs reconstructing, and a corrective pass is the right response.

**Is the resolver epoch-scoped per row, and is that the fix? No, and no.** The samples do carry
`oura_raw_samples.epoch` (migration 161), and `ds → epoch` is very nearly a function — 3 collisions
in ~1.09 M rows. But epoch 3 holds **5,756 re-drained rows below epoch 2's ceiling**, interleaved
with their epoch-2 originals across ds 33.0 M–37.11 M. Resolving those per-row would split one span
across two offsets 14 hours apart, which is worse than the uniform shift it replaces. The entry's
*"That is the fix"* does not survive contact with the data: **the epoch labels themselves are
wrong**, so scoping to them repairs nothing.

### What was deliberately not done

- **No code.** The right repair is a migration merging epoch 3 → 2 and epoch 1 → 0 across
  `oura_ble_clock_anchors` and `oura_raw_samples`, then a full redecode. Both mutate the owner's
  health history, so both are waiting on sign-off rather than shipped.
- **`robustOffsetMs` was left alone, on evidence.** Lowering the percentile is the obvious fix and
  it is wrong: on a drained epoch even **p1 is already +1.28 h contaminated**, and only the *two*
  smallest anchors are clean — too thin to estimate from. On a healthy epoch p0→p10 spans 7 s and
  50 s, so the statistic is fine. The defect is the spurious epoch.
- **Reset detection was not changed** — filed as **Q-314** instead, because it needs a design
  decision and there is **no observed true reset in the data** to validate any threshold against.
  Both epoch openings were re-drains. Getting it wrong in the other direction — missing a real
  re-key — is worse and quieter than the current failure, which is not a call to make silently.

### Not exercised

- **Nothing was run.** This is a measurement and reconciliation pass over production via the
  read-only `claude_ro` views; no code path was executed, no dev server, no device.
- **Owner-scoped.** Every count is the owner's rows only, and `claude_ro` prunes at 30 days.
- **The repair is unverified** because it has not been run. The +14.16 h reconciliation is
  arithmetic on stored values, not an observed corrected window.

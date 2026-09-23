# Should we drop the server-side Oura raw archive? — the case, measured

**For:** the owner · **Written:** 2026-09-23 (OR-126) · **Answers:** Q-29 Task 5

You were asked for a yes-on-principle to dropping the server raw archive and said you wanted the
case first. This is it. Every number below was measured against production on 2026-09-23, not
carried forward from an earlier document.

**Recommendation: keep it.** It costs about **five cents a year**, and what it buys cannot be bought
back at any price. The rest of this explains why the question looked closer than it is.

---

## The premise moved, and that is the main finding

Q-29 Task 5 proposes dropping **`oura_raw_samples.body_hex`**, described as *"the archival source of
truth"*. That was true when the task was written. It is not true now.

The packer shipped (Q-541 Task 4) and moved the archive into a different table:

| | rows | what it holds | payload | span |
|---|---|---|---|---|
| `oura_raw_samples` | 189,263 | the **hot window** | **4.5 MB** of hex | 8 days |
| `oura_raw_packed` | 1,467 | the **archive** | **25 MB** of blob | **1,811,765 frames** |

`oura_raw_samples` is a 7-day working buffer now (`HOT_WINDOW_DS`); anything older is packed into
one compressed blob per bucket and deleted from it. **So Q-29 Task 5 as written would drop a
week-long scratch buffer, not the archive.** It would save 4.5 MB and lose almost nothing — which
is not the trade anyone thought they were weighing.

The move is lossless and it is not taken on trust. The packer inserts the blob, **reads it back out
of the database, unpacks it, and proves the frames equal** before it deletes anything; a mismatch
leaves the blob, deletes nothing, and stops. Readers already span both tiers, so nothing in the app
knows or cares which side a frame is on.

---

## 1. What would actually be dropped

**`oura_raw_packed`: 1,811,765 ring frames in 25 MB**, accumulated since the packer began on
2026-08-18 and growing at **0.72 MB/day**.

That is every raw BLE event the ring has produced that has aged out of the hot window — the bytes
the decoders run on, not the numbers they produce. Sleep stages, heart rate, HRV and everything else
you read in the app are *derived* from these and would survive the drop. What would not survive is
the ability to derive them **differently**.

## 2. What survives on the device — and this is the part that has changed for the worse

The case for dropping rests on the phone keeping a copy. **It is not keeping the copy the plan
assumed.**

The 14-day rolling window you decided on 2026-08-02 **has not shipped.** From
`projectOverview.md:6211`: `OuraRawDb.kt` implements `pruneRaw` and exposes it on the plugin bridge,
and *"a repo-wide grep finds no caller"*. Two independent causes, and fixing one does not fix the
other — nothing invokes it, and its predicate needs `rolled_up = 1`, which is set only by D2 Task 5,
which is not built. Confirmed from the device on 2026-08-18: **209,326 rows, 0 rolled up, 31.2 MB.**

So the device store today is neither a 14-day window nor an archive. It is an unbounded pile growing
at ~3.4 MB/day, and two further things are true about it:

- **Its prune requires `synced = 1`** — a row becomes eligible for deletion only once the server has
  it. The device was designed as the *secondary* copy. Dropping the server archive inverts that
  relationship without changing the code that assumes it.
- **It is not backed up.** Android Auto Backup's per-app quota is 25 MB and the store passed that
  months ago, so nothing past it goes to the cloud. An uninstall takes the lot — and an uninstall is
  already the operation that destroys the ring's BLE key, so it is not hypothetical.

**Once D2 Task 5 lands and the window starts working, the device holds 14 days.** That is the
deliberate design and it is the right one — raw frames are input to the on-device rollup, not an
archive. It is simply not a place to put the only copy of anything.

## 3. What becomes permanently unrecoverable

**All 1,811,765 frames, and every frame recorded after the drop beyond the device's window.**

The ring's history buffer is finite and the sync cursor only moves forward. It cannot be rewound.
So a decoder fix written next year can back-fill **only** by re-decoding stored bytes — there is no
re-drain. Four raw tags are currently stored and never decoded, and one of them has no decoder at
all (`TN-41`); every one of those is recoverable today and would not be afterwards.

This is the asymmetry that makes the question worth a brief. Keeping the archive buys nothing you
can see. Dropping it costs nothing you can see either — until the day someone fixes a decoder, and
then the cost is total and retroactive.

## 4. What keeping it costs

Railway bills storage on use at **$0.15/GB/month**.

| | archive size | cost |
|---|---|---|
| today | 25 MB | **$0.004/month** — under five cents a year |
| in 1 year | 288 MB | $0.04/month |
| in 3 years | 813 MB | $0.12/month |
| in 10 years | 2.6 GB | $0.39/month — **$4.66 a year** |

**This is not a cost problem, and it would be dishonest to imply a saving.** Ten years of
accumulated raw ring history costs less per year than a coffee.

**One number makes it look worse than it is, and it belongs to a different question.**
`oura_raw_samples` reads 76 MB in the table listing — but that is 32 MB heap plus **45 MB of index**
against 4.5 MB of actual payload. The rest is bloat the packer freed and Postgres never returned.
That is `BF-106`, a `VACUUM FULL` you have already seen and deferred, and it reclaims ~71 MB without
dropping a single byte of data. **If the goal is a smaller database, that lever is ten times larger
than this one and costs nothing.**

## 5. The reversal cost

**There isn't one.** A dropped archive cannot be restored from the ring, the server, a backup, or
this repository. That is the entire reason this needed a brief rather than a yes.

---

## What I would do

**Keep the archive**, and if database size is the underlying worry, take `BF-106` instead — it
reclaims ~71 MB against this lever's 25 MB, and it is reversible in the sense that nothing is lost
at all.

**Then fix the premise rather than acting on it.** Q-29 Task 5 should be rewritten to say what it
now means, or struck. Three things it assumes are no longer true: the archive is in a different
table, that table is compressed rather than hex, and the device window it relies on has not shipped.
A task whose three load-bearing facts have all moved should be reconciled before anyone builds from
it, not answered.

**If you want to drop it anyway** — and it is your call, the case above is meant to make it
answerable rather than to win it — the honest sequence is: ship D2 Task 5 so the device window
actually works, decide what the device's retention should be knowing it is then the *only* copy and
is not backed up, and drop `oura_raw_packed` rather than `oura_raw_samples`. Dropping it in the
order Q-29 currently describes would remove the wrong table.

---

**Sources.** Production reads on 2026-09-23 via `/api/admin/db-query` (`pg_stat_user_tables`,
`claude_ro.oura_raw_samples`, `claude_ro.oura_raw_packed`);
`lib/data/postgres/slices/oura-raw-pack.ts` (the packer's seal/verify/delete contract);
`lib/data/postgres/slices/oura-raw-frames.ts` (readers spanning both tiers);
`android/app/src/main/java/com/trainingai/app/oura/OuraRawDb.kt:322` (the prune predicate);
`components/oura-ble/raw-store-health.ts` (Q-538, the device measurement);
`projectOverview.md:6211` (the unshipped window); Railway's published storage price.

# "Accurate on first open" — what it actually requires

**Date:** 2026-08-20 · **Agent:** Tuning 🎶 · **Pillars:** `[devices]` `[sleep]` `[app-shell]`
**Owner requirement:** *"Ideally I want the score and sleep time to be accurate on first open of the
day without needing time to 'adjust'."*
**Extends Q-529**, which after its correction is *"a provisional sleep score is displayed as final
while the night is still syncing."* This measures what it would take for there to be nothing
provisional to display.

**The cause is not the scoring, and not the rollup. The ring uploads roughly once an hour, so the
server can be up to an hour behind the wrist at the moment the app opens.**

---

## 1. The measurement

Over 7 days, **214 ingest batches** in `oura_raw_samples`, gaps between consecutive batches:

| | minutes |
|---|---|
| median gap | **62.0** |
| p90 | 71.0 |
| max | 306 |

**A ~62-minute upload cadence.** Each batch carries a short high-rate burst — e.g. the 01:13 batch
holds 1,899 samples covering 01:05–01:13 — so the ring records in bursts and ships them about hourly
rather than streaming continuously.

### What that produced on the morning of the report

| time | event |
|---|---|
| ~06:07 | owner's last sleep epoch (from the stored hypnogram) |
| **05:40** | **last upload before the app was opened** — covers to 05:40 |
| **06:46** | **owner opens the app** → sees a night ending **4:52 am** |
| 06:44 | upload lands, covering to 06:44 |
| 06:46:19 | session rewritten → ends **6:44** |
| 06:50 | upload lands, covering to 06:50 |
| 06:51:03 | session rewritten → ends **6:47** |
| 06:54:41 | score recomputed → **55** |

**The owner opened the app inside the gap between two hourly uploads.** The data for their wake was
still on the ring. No scoring change could have helped — the server did not have it.

**Drain lag relative to wake, last 8 nights:** +3, +9, **−5**, +2, +17, **+62**, +4 min (and one
4-day backfill). Usually minutes; **once an hour**. The −5 is worth noting: on 08-18 the night's data
was complete *before* the wake timestamp, so the outcome depends entirely on where waking falls in
the upload cycle — it is luck, not design.

---

## 2. What "accurate on first open" requires — three links, all of them

1. **Drain on app open** (or on wake detection). This closes the ≤62-minute data gap and is the
   dominant term. **Native — Kotlin, and therefore a new APK**, not a Railway deploy.
2. **Roll up and re-score immediately after that drain**, rather than on whatever schedule runs today.
   This morning the last upload landed 06:50 and the score settled 06:54:41 — **~4 minutes** of
   processing lag behind the data.
3. **Until 1 and 2 both land, do not render a number that will change.** This is Q-529's existing
   scope and remains the only part shippable without an APK.

**Ordering matters:** doing 2 without 1 makes the app faster at displaying stale data. Doing 3 first
is the honest interim — and it is the only one Lane B can ship alone.

---

## 3. The limit worth stating plainly

**If the app is opened before the ring has registered the end of the night, no engineering fixes it.**
On the morning in question the session's own end timestamp was **06:47** and the screenshot was taken
at **06:46** — the owner was, for that read, ahead of the ring. Their *sleep* ended ~06:07, but the
in-bed session ran to 06:47, and the session is what the summary describes.

So the achievable target is **"accurate within seconds of the ring knowing"**, not "accurate before
the ring knows". For a 06:07 wake and a 06:46 open, an on-open drain would deliver it. For an open at
06:10 — three minutes after waking, still in bed — it would not, because the night has not ended.

That distinction should shape the UI: a night that is genuinely still in progress is a different state
from one that is complete but unsynced, and both differ from a settled night. **Three states, and the
app currently renders all three identically.**

---

## 4. Recommendation

**Ship Q-529's provisional state first** (Lane B, no APK), because it is honest immediately and costs
little. **Then the on-open drain** (Lane A / native, new APK), which is what actually delivers the
owner's requirement. Re-measure the 62-minute cadence afterwards — if an on-open drain shortens it,
the provisional state will fire rarely and can stay as the safety net it should be.

**Do not** attempt to fix this by shortening the rollup schedule alone. That addresses the ~4-minute
term while leaving the ~62-minute one untouched, and would read as "we made it faster and it still
adjusts".

**Caveats.** One athlete, 7 days, 214 batches, `claude_ro` row-scoped. **The 62-minute cadence is the
ring's observed upload behaviour, not a documented setting** — whether it is configurable, and what it
costs in ring battery to shorten it, is unknown here and must be checked before anyone promises an
on-open drain is cheap. Battery is the obvious risk: more frequent radio wake-ups on a ring whose
firmware is deliberately frozen.

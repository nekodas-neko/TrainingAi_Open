# Routing device sweep 4a — six entries out of the device lane, one closed

Sitting 4a (#1696) closed **ten** entries as verified and left eleven needing a decision. This is
the routing pass. **No device time and no product code** — it moves work to the lane that can do it.

## The failure mode this prevents

Seven entries sat in `Lane: DV` that the sitting had **already answered**. Left alone, the next
sitting re-picks them — the trap CLAUDE.md names as *"a probe that has already been run is no longer
DV's"*. An answered probe is not device work; it is whatever the answer implies.

## Re-laned off `DV`

| entry | now | why |
|---|---|---|
| `RV-186` | **A** | ②③⑤ FAILED, so what is left is code. ⑤ (`hr-profile`/`zone-minutes` 430–610 ms) is route latency = A; ②③ (4 requests per resume, 24 on a Health switch) are client counts = B. Reaching both means **A first**, per the path rule. |
| `OR-162` | **B** | Sweep 4a **named the cause** it existed to find: two *HEART RATE · TODAY* charts re-measure on every switch **while hidden**. `components/**`. |
| `RV-153` | **B** | Answered: **~120k characters of `localStorage` rewritten per Home tap**, friends-feed 459k. Stores and hooks. |
| `RV-150` | **B** | Answered: a failed refetch is invisible. This is the `Q-499` shape — `cachedFetch` swallows `!res.ok` without `onError` — so the fix is at the call sites. |
| `DV-8` | **A** | **Second independent reproduction** (food delete pending, both outboxes empty). Two is enough; more device time would be re-running an answered probe. |
| `Q-300` | **A** | See below — it had **no lane field at all**. |

## `Q-300` was invisible to every implementer

It carried **no `Lane:` field**, so `next-item.js` printed it as UNCLASSIFIED and nobody could pick
it up. Sweep 4a discharged the one thing it owed: with `/api/health-trends*` blocked the *Rest
discipline* card showed *"Couldn't load this trend"*, proving it renders from the **server route**
rather than `getLocalStore`. What remains is the RPE model gaining a rest term — domain math in
`packages/shared/**`, so **Lane A**.

## `DV-12` is a pass test, not a task

Annotated rather than re-laned. It stays `B`, but it is now explicit that **`OR-162` and `RV-153`
hold the fixes** and this entry is where the result gets re-measured. Starting it as work would
duplicate both.

## `Q-11` closed — the backfill ran and found nothing

Its `Keep:` was *"the one-off backfill over pre-fix sessions"*. Owner-approved and run in 4a:
**33 sessions processed, 0 had HR data, nothing filled**, production under 0.55 s throughout.

The owed action is discharged, so the entry leaves the queue. **The durable fact is that those
sessions can never gain per-set HR attribution** — the underlying data is gone, so this is a
permanent state rather than outstanding work. It is recorded in the sweep-4a journal.

## Left where it is

`RV-132` stays `DV`, correctly: sweep 4a found the link census is **nearly empty by construction**
(only one `<a href>` route is reachable from the tab roots — Home → `/coach`), so the real census is
tap-by-tap over buttons with a write-safe allowlist. That still needs the phone.

`RV-205` stays `DV` — tier 1 done, further tiers owed.

## Still failing, and now owned

`DV-12`, `BF-61` ①, and `RV-186` ②③⑤ are FAILED results. Per the standing rule a **FAILED is work,
not verification debt** — each is now in the lane that owns its surface rather than sitting as a
device gate that reads as finished.

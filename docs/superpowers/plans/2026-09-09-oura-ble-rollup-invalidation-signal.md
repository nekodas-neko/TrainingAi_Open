# Q-91-followup — the BLE rollup's invalidation signal: the decision, and the design

**Status:** design only. Nothing here is implemented. **Lane A**, JS/server only, **device-gated**.
**Written:** 2026-09-09, against `main` at `24f95074`.

---

## The question as filed

Q-91 fixed reactivity for the two signals that already existed — a manual Redecode, and a manual
drain settling — both of which end in `invalidateOuraSync()` + a `ta:oura-ble-synced` window event.
The **ordinary** flow does not: the native service drains hourly, POSTs to
`/api/oura-ble/samples`, and the route schedules a debounced rollup that writes `sleep_sessions` and
`body_metrics`. Nothing tells the client. A mounted sleep screen holds its cache until the next
natural mount or the 30-minute TTL.

The entry asked whether the ingest rollup should emit its own client invalidation, and flagged the
risk: the rollup is deliberately fire-and-forget for latency reasons (I20), and hanging a signal off
its completion could reintroduce the timeout class that produced the 499 → cursor-hold → re-drain
storm (I19/I20) and the 2026-08-13 outage (I26).

## The decision: no — and the premise was too narrow

**The rollup should not emit its own signal, and it does not need to.** The question assumed the
only place to hang a signal is the server, which is what made it look like a latency trade. It is
not: **the client can already hear the drain finish, over a channel that exists today.**

`OuraRingService.emitStatus()` (`android/…/oura/OuraRingService.kt:771`) pushes an `ouraStatus`
event through the plugin bridge, carrying the same `OuraBleStatus` the manual path polls — including
`draining`. It is called on every state change, forced, and it does not care whether the drain was
manual or the hourly background one. The plugin already declares the listener
(`lib/oura-ble/plugin.ts:112`). So a `draining` **true → false** transition is observable in the
WebView right now, for the ordinary flow, with **no native change and no server change**.

That removes the I20 trade entirely. The signal does not come off the rollup.

## The part that is actually hard, and the reason this is not a two-line fix

**Drain-end is not rollup-done.** The POST returns as soon as the raw rows are stored; the rollup is
a **3-second trailing-edge debounce** (`ROLLUP_DEBOUNCE_MS`, `app/api/oura-ble/samples/route.ts:40`)
and then runs off-loop for however long it takes. Invalidating at drain-end therefore races: the
refetch can land *before* the rollup has written, get pre-rollup data, and **cache that**.

That is worse than the staleness it replaces. A stale cache is old data that a later mount corrects;
a cache refilled from a pre-rollup read is old data wearing a fresh timestamp, and the 30-minute TTL
then holds it. **Do not ship the naive version** — an `ouraStatus` listener that invalidates on
`draining` going false is the obvious implementation and it is the wrong one.

Note the manual path has the same race today: `afterDrainSettles` (`lib/oura-ble/sync.ts:12`) polls
the `draining` flag up to 10 × 3 s and then invalidates unconditionally, with nothing confirming the
server-side rollup ran. Its 30-second ceiling probably outlasts the 3 s debounce often enough to
mask it. I have not found a report attributable to it, and absence of a report is not evidence it
never fires — this design should fix both paths, not add a second mechanism beside it.

## The design: confirm the rollup advanced, don't guess at it

The server already persists exactly the fact the client needs. `oura_rollup_state` (migration 184)
holds `last_rolled_ds` and `epoch` per user, written after each **successful** run
(`lib/data/postgres/slices/oura.ts:1911`). It is the watermark the rollup itself narrows from. It is
**not exposed over HTTP** — that is the only missing piece.

1. **`GET /api/oura-ble/rollup-state`** — returns `{ lastRolledDs, epoch }` for the session user.
   Auth-gated, `Cache-Control: private, no-store`, rate-limited like its siblings, no admin gate (it
   leaks nothing but a cursor). Tiny single-row read.
2. **On `draining` true → false**, read the watermark once to get a baseline, then poll that endpoint
   on a bounded schedule until `lastRolledDs` advances past the baseline (or `epoch` changes, which
   is a re-key and invalidates everything anyway).
3. **Only then** `invalidateOuraSync()` + dispatch `ta:oura-ble-synced` — the same two lines both
   existing paths end with, so mounted screens need no change.
4. **Converge the manual path onto the same helper.** `afterDrainSettles` stops polling `draining`
   and then guessing; it waits on the watermark like everything else. One mechanism, not two.

**Bounds it needs.** A ceiling (the drain may have carried nothing the rollup changes, in which case
the watermark never moves and the poll must simply stop — this is the normal case for a debug-only
batch, not an error); backoff rather than a fixed 3 s, since the rollup's duration varies with span;
and a no-op off-device, where `getOuraBle()` returns null.

## Alternatives, and what each is better at

- **Signal off the rollup's completion (the entry's own framing).** Better at precision — it knows
  exactly when the write landed, with no polling at all. Rejected because it is the one option that
  reintroduces the I20 coupling, and because it cannot reach the client anyway: the rollup finishes
  in a background worker with no request to answer, so it would still need a push channel.
- **SSE or WebSocket push.** Genuinely better if this were the first of several server→client
  signals. Rejected as disproportionate for one event with a documented outage history around it,
  and it adds a connection to hold on a battery-sensitive device.
- **A fixed client-side delay after drain-end.** Cheapest, and honestly what the manual path already
  approximates. Rejected because the correct delay is the rollup's duration, which varies with the
  span it re-derives — a fixed number is right until the day it is not, and the failure is silent.
- **Shorten the TTL.** Rejected on the standing rule: a shorter TTL adds load and hides the defect,
  and does nothing for a screen whose read path never re-fetches.

**Reversal cost: low.** One new GET and one client helper; deleting them restores today's behaviour
exactly. The route is additive, so nothing else depends on it.

## Verification this needs, and cannot get here

**Device-gated, and that is why this is a design rather than a diff.** `getOuraBle()` returns null
off-device, so the entire listener path is unreachable in the sandbox — a green `pnpm dev` would
prove nothing about the behaviour being changed. What can be tested here: the new route (handler
test like its siblings) and the poll/backoff helper as a pure function with an injected clock.

What must be observed on the S25, with the ring attached:
- an hourly background drain, app in foreground, sleep screen mounted → screen updates without a
  remount and without waiting out the TTL;
- a drain carrying nothing the rollup changes → the poll stops at its ceiling and does not spin;
- pull-to-sync still behaves as it does today, now on the shared helper.

## What this is not

Not a fix for a reported bug — Q-91-followup is a deferred decision point, filed as "not a bug".
The user-visible symptom is bounded by the 30-minute TTL and only bites when the app is already open
and mounted as a background drain lands.

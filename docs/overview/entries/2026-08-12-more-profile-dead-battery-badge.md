# 2026-08-12 — More/Profile's ring battery stops lying (Q-205, v1.290.2)

**Branch:** `fix/more-profile-dead-battery-badge`

## What was wrong

`components/more/oura-section.tsx` read `batteryLevel` / `batteryStale` from `/api/oura/token` — the
Oura **Cloud** value, which froze at the 2026-07-07 direct-BLE re-key. `batteryStale` is therefore
effectively always true, so the card rendered a grey `BatteryMedium` and the literal text
**"Not live"**, and had done for over a month.

This was found while implementing Q-203 (removing the Home battery chip), whose entry justified the
removal by claiming More/Profile "already renders ring battery status independently". Checking that
claim rather than trusting it is what surfaced this.

## The fix

Point the card at `/api/oura-ble/battery-latest` — the live BLE keepalive poll — preferring it and
falling back to the Cloud value only when BLE has nothing.

**This is the treatment the same card already gave the sync timestamp** and never gave the battery:
twenty lines above, `lastSyncedAt` is already computed as
`bleFresh ? bleLastMeasuredAt : lastSyncedAt`. The battery was the one field left behind.

Reuses the existing `oura-ble-battery-latest` key with the same `cachedFetchToday` variant and
`TTL_MEDIUM` — a second key for one endpoint causes stale/blank first paints, and mixing
`cachedFetch` with `cachedFetchToday` on one key makes freshness last-writer-wins. The Health tab's
Ring Status card is the other reader.

Three display states, replacing two:

| state | rendering |
|---|---|
| fresh BLE reading (≤ 180 min) | coloured icon + percentage |
| real BLE reading, aged past 180 min | muted icon + percentage, `title` naming its age |
| no BLE reading at all, Cloud frozen | the old "Not live" badge — now meaning what it says |

The middle row is new: a true last-known value is worth showing muted rather than discarding.

## Two things fixed alongside, because the change exposed them

**1. `oura-ble-battery-latest` was in no invalidation group.** A BLE sync drains new keepalive
battery polls, so the reading is stale immediately after one, and both Ring Status cards were
relying on TTL expiry alone. Added to `invalidateOuraSync()` in `lib/cache-groups.ts` — which fixes
the Health card too, not just this one.

**2. The card refreshes on tab re-show; the battery would not have.** Its own comment says *"Ring
battery and last-sync age are the two things on this card that are wrong within minutes, and the tab
never unmounts to re-fetch them"* — but a mount-only `cachedFetchToday` would have served the cached
value on every subsequent tab visit. `loadLiveBattery(force)` now invalidates before re-fetching on
the `useRefreshOnTabShow` path, so the stated intent actually holds.

## Verified on the dev server, all reachable states

Seeded an `oura_tokens` row (so the card renders) plus one `oura_ble_battery_poll`, at 412×915:

| seed | before (`origin/main`) | after |
|---|---|---|
| poll 12 min old, 68% | `Oura Ring 5 \| Connected \| Live` — **no battery indicator at all** | `… \| 68% \| Live` |
| poll 5 h old, 41% | same | `… \| 41% \| Live`, `title="Ring battery 41%, last seen 5h ago"` |

No page errors in any run. All seeded rows deleted afterwards. Full suite 448 files / 3,697 tests
green; `tsc` and eslint clean (one pre-existing unused-var warning in this file).

## What was NOT exercised

- **The literal "Not live" rendering could not be reproduced locally, in either direction.** It
  requires the Cloud call to *succeed* and return a battery reading with an old timestamp. The local
  fixture has no real Oura token, so `fetchLatestBatteryLevel` rejects, `batteryLevel` stays null,
  and no badge renders at all. So the local before-state is "nothing shown", while the **owner's
  device** shows "Not live". Both are wrong and both are fixed by the same change, but the exact
  broken rendering named in Q-205 is established from the code path, not observed here.
- **Not verified on device.** Samsung's WebView compositor and safe-area insets are not reproduced
  in the web sandbox. A Known-Issues row records it.
- The `useRefreshOnTabShow` path was not exercised — it fires on native tab visibility changes.
  The mount path was.

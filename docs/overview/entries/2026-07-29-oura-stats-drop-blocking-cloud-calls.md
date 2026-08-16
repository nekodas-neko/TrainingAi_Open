## 2026-07-29 — `/api/oura/stats` no longer blocks on the Oura Cloud (the blank second, found)

From issue #868's Phase 0 device measurement. This is the single largest win found in that
investigation, and it was not in any of the phase plans — it only surfaced once the owner captured
DevTools against the APK.

### How it was found

The owner ran the Phase 0 measurement on the S25 and reported *"screens have no content for a
second"* on a cold open. The Network capture at that exact moment showed:

- `stats` — **1.37 s / 1.36 s** (and **1.60 s** in a separate Health capture)
- `favicon.ico` — still `(pending)`
- **everything else — 1–6 ms**, mostly `(disk cache)`

So the blank second was never geography, the remote shell, or round-trip count. It was one endpoint.

### The cause

`app/api/oura/stats/route.ts` made two live calls to the Oura Cloud API on **every** request —
`fetchLatestBatteryLevel` and `fetchRingConfiguration` — and awaited both before responding. Both
fetch data that cannot change:

- **Battery** — the ring has sent the Oura Cloud nothing since the direct-BLE re-key (`CLAUDE.md`,
  Oura Direct-BLE section). `components/health/oura-section.tsx` already discarded this value in
  favour of `/api/oura-ble/battery-latest`, which returns in ~4 ms. Its own comments said so:
  *"Prefer the live direct-BLE battery poll over the frozen Cloud reading"*, and the tile carried a
  *"Frozen Cloud reading since the direct-BLE re-key — not a live value"* tooltip.
- **Ring configuration** — colour, design, size, firmware. Static; and the firmware is *deliberately
  pinned* to keep the reverse-engineered BLE protocol stable, so the one mutable field is the one
  specifically frozen.

The app spent ~1.4 s per Health load re-fetching a frozen number and a constant.

This also violated an existing `CLAUDE.md` rule that names this exact mistake on another route:
*"Don't auto-fire slow external round-trips on screens the user is trying to leave (the done screen
awaited a live Oura Cloud sync on mount)."*

### Change

- `app/api/oura/stats/route.ts` — drops both Cloud calls and the `getValidOuraToken` lookup that
  existed only to feed them. The route now reads today's rollup from our own DB and returns.
  `battery`, `batteryStale` and `ring` are removed from `OuraStatsResponse`.
- `components/health/oura-section.tsx` — the Cloud-battery fallback branch is deleted (it could no
  longer fire), leaving the BLE poll as the only battery source. The Firmware / Ring Size tiles and
  the colour/design/hardware chips are removed, since nothing supplies them any more.

`fetchLatestBatteryLevel` / `fetchRingConfiguration` / `isBatteryStale` remain in `lib/oura/client.ts`
and are still used by `app/api/oura/token/route.ts`, which validates a PAT on connect. That is a
legitimate Cloud call on a cold path and is untouched.

### Deliberate UI removal

The **Firmware**, **Ring Size**, colour, design and hardware-type displays are gone. The owner
confirmed the Cloud API is deprecated in favour of BLE. BLE *can* supply firmware — `lib/oura-ble/
decode.ts:589` maps opcode `0x08: 'firmware_version'` — but nothing stores or exposes it, and wiring
it up is Kotlin work requiring an APK rebuild. Left as a follow-up rather than blocking a 1.4 s fix.

### Tests

`pnpm tsc --noEmit` clean; `pnpm lint` 0 errors (114 pre-existing warnings untouched). Route returns
200 with the new shape against the local dev DB; `/health` renders with no runtime errors.

**Not measured locally.** The test user has no Oura token, so the route takes its early
`connected: false` return — which was already fast. The improvement is on the *connected* path and
can only be confirmed against a real token, i.e. on the owner's account in production. Expected:
`stats` drops from ~1.4 s to single-digit ms, matching its neighbours on that screen.

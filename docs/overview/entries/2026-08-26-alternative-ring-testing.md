# 2026-08-26 — The Colmi ring: a plan, and the reason it costs almost nothing (PS-8)

**Branch:** `claude/alternative-ring-testing-jzk8el` · one-off session · **docs only, nothing built**

The owner acquired a Colmi smart ring and asked two questions: how to test it, and whether to test
it on themselves or on the second account holder. This is a planning PR under the backlog-driven
protocol — the plan and the queue entry land here; the spike is a later branch.

## The answer

**Wear it yourself, opposite hand to the Oura, and quarantine its writes.** The only question worth
a fortnight is *how close is it to the Oura*, and one body has to wear both for that to have an
answer. The reason to reach for a second person — two rings writing into one account — is a
**write-path** problem, and this repo already owns the mechanism for it.

## Three findings that changed the shape of the plan

**It needs no APK.** `lib/live-hr/chest-strap-source.ts` does the full BLE cycle — scan, connect,
subscribe, decode, ingest — in TypeScript in the WebView via `@capacitor-community/bluetooth-le`,
already a dependency. The Kotlin service came later and is an all-day-background upgrade, not a
prerequisite. The Colmi logs HR, steps and sleep internally and is read back on demand, so the
WebView path's backgrounding limit barely applies: sync on app open, like the scale. Ships through
Railway, no Gradle, and so **no uninstall risk to the Oura key**.

**`oura_heartrate` is the one table with no protection.** The ranked per-field merge in
`lib/data/health-source.ts` would make `body_metrics` / `sleep_sessions` / `oura_daily` safe for a
second ring by construction — a `colmi_ble` ranked below `oura_ble` can only fill a NULL, and it is
a one-line change to a `const` tuple with no migration. But `oura_heartrate` has a bare `text`
source, a `(user_id, timestamp)` unique and `onConflictDoNothing`, so a same-second collision
between two rings is first-writer-wins permanently. `app/api/hr-ingest/route.ts` also hardcodes
`source: 'chest_strap'`. That is what Phase 1's quarantine is actually protecting.

**The scoring already exists.** `lib/oura-comparison-harness.ts` takes an adapter supplying two
bucketed series and reports within-tolerance counts and mean absolute delta;
`components/oura-ble/comparison-harness-console.tsx` renders it. A Colmi adapter is the
`ringVsH10HrAdapter` pattern with one side re-pointed — about 40 lines, and nothing new gets built
for measurement.

## Protocol, quoted rather than remembered

Per the external-field rule, §3 of the plan quotes the transport UUIDs, the 16-byte framing, the
**mod-255** checksum and the command bytes (`0x03` battery, `0x01` set time, `0x15` HR log, `0x43`
steps, `0x69`/`0x6A` real-time) from `tahnok/colmi_r02_client`, fetched today. **None of it is
verified against the owner's unit** — the client covers R02/R06/R10 and the model is unknown, which
is exactly what Phase 0 exists to settle.

Sleep is **not** in that client. Gadgetbridge implements it from a separate Wireshark dissection,
so it is known-possible from a second codebase — not a copy-paste, and Phase 3.

## What is deliberately not queued

Promotion to a ranked source, sleep, and handing a ring to the second account holder are all
conditional on Phase 1's report. The friend phase tests **tier 2** — a non-Oura user getting working
score cards, which `device-agnostic-source-architecture.md` says has never run against a real
non-owner device — and that is a different question from ring accuracy.

**Do not flash the circulating raw-streaming mod firmware.** It is the only step in the arc that can
brick the device, and it would be taken before knowing whether the sensor is worth streaming from.

## Files

- `docs/superpowers/plans/2026-08-26-alternative-ring-colmi-testing.md` — the plan
- `docs/implementation-backlog.md` — PS-8 at the queue top, `Gate: device`
- `docs/domains/devices/README.md` — plan linked from the pillar index

# 2026-08-12 — the ring-battery chip leaves Home (Q-203, v1.290.1)

**Branch:** `fix/ring-battery-chip-remove-from-home`

## What shipped

`OuraBatteryChip` is gone from the Home header, and `components/oura-battery-chip.tsx` is deleted —
Home was its only call site.

This is the fourth round on the same owner complaint (Q-159 → Q-165 → Q-169 → this). Q-169 shipped
"move it and simplify it" on 2026-08-10; the owner reported the identical *"move it or remove it"*
two days later, on the build that already carried that fix. One relocation round was tried and did
not resolve it, so the third option from the original write-up — off Home entirely — is what is
left.

## The backlog entry's justification was wrong, and it matters

Q-203 said removing the chip loses nothing because *"`components/more/oura-section.tsx` already
renders ring battery status independently."* **It doesn't.** More/Profile reads `batteryLevel` /
`batteryStale` from `/api/oura/token` — the **Oura Cloud** value, frozen since the 2026-07-07
direct-BLE re-key. `batteryStale` is effectively always true there, so that surface renders a grey
`BatteryMedium` icon and the literal text **"Not live"**, never a percentage. It is the dead one.

The surface that actually preserves the reading is **`components/health/oura-section.tsx`** — the
Health tab's Ring Status card, which fetches the same `/api/oura-ble/battery-latest` endpoint the
Home chip used, on the same `oura-ble-battery-latest` cache key, and renders a live **Battery NN%**
tile.

So the removal is safe — for a different reason than the entry gives. Had the entry been followed
without checking, the verification step would have landed on a permanent "Not live" badge and either
blocked the fix or shipped it on a false premise.

## Verified on the dev server, and made falsifiable first

The obvious smoke test is worthless here: `/api/oura-ble/battery-latest` returns `{"latest":null}`
on the local dev fixture, so the chip renders nothing before *or* after the change, and "0 battery
elements on Home" proves precisely nothing.

Seeded one real poll row (`oura_ble_battery_poll`, 72%, 10 min old) and re-ran both sides at the S25
viewport (412×915), signed in as the seeded user:

| | Home header right-hand cluster |
|---|---|
| `origin/main` | `<div … aria-label="Ring battery 72 percent">` with a green `BatteryFull` glyph, **then** the Reorder button |
| this branch | the Reorder button directly; everything else byte-identical |

No console or page errors on either. The seeded row was deleted afterwards.

## What was NOT exercised

- **The Health tab's Ring Status card could not be reached locally.** `OuraSection` early-returns on
  `if (!data?.connected)` (`components/health/oura-section.tsx:94`), and the local fixture has no
  Oura token, so `/api/oura/stats` never reports connected. That the card reads the live BLE
  endpoint is established **by reading the source**, not by observing it render. On the owner's
  device, where the ring is connected, it will render.
- **Not verified on device.** This is a header layout change; safe-area insets render as 0 in the
  web sandbox and Samsung's WebView compositor is not reproduced here. A Known-Issues row in
  `projectOverview.md` records it as not-yet-device-verified.
- The pre-existing `400` from `/api/oura/sync` on Home is the local fixture having no Oura token —
  unrelated to this change and present on `main` too.

## Follow-up worth knowing

`components/more/oura-section.tsx` still shows a permanently-"Not live" battery badge sourced from
the frozen Cloud value. That is now the app's only *misleading* battery surface, and it is a
separate finding from this one — filed rather than fixed here, since it is a different file, a
different endpoint, and not what the owner asked about.

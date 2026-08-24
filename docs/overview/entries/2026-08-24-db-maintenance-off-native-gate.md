# Server-side disk maintenance renders on a desktop (Q-544)

**Branch:** `fix/admin-db-maintenance-off-native-gate` · **Lane B** · v1.363.4

## What shipped

`DbFootprintCard` and `DeviceMetricsPanel` moved out of `OuraBleDebug` and onto
`app/admin/oura-ble/page.tsx`, **above** `<OuraBleDebug />`. Neither touches the Capacitor plugin —
both read only `/api/oura-ble/*` — and both were unreachable outside the APK purely because of where
they were rendered.

`OuraBleDebug` early-returns a *"Native OuraBle plugin unavailable"* banner when the plugin is
absent and renders nothing after it. Everything downstream of that return was APK-only, which is
correct for the BLE levers and wrong for these two.

## Why the gate mattered more than it looks

`VACUUM FULL` takes an `ACCESS EXCLUSIVE` lock, so **the APK is the one client blocked while it
runs**, with a WebView timeout free to swallow the response. And if the APK is broken, uninstalled
or mid-rebuild, the disk could not be reclaimed *at all* — which is exactly the situation where a
full volume is most likely. On 2026-08-18 the workaround during the `disk_full` recovery was a
hand-typed `fetch()` from a desktop console.

`DeviceMetricsPanel` was the panel BF-10 fixed and then could not observe, for the same reason.

## Q-544's second half was Q-316

The entry's second half — the pack backfill having no button — shipped separately today as Q-316.
This PR is what makes that button reachable from anything but the phone.

## Verification

Driven in a browser against `pnpm dev` + local Postgres, as an admin user, with **no native plugin**
(so `OuraBleDebug`'s unavailable banner is present on the page throughout — confirmed, not assumed):

- **DB footprint** renders, with all three controls: *Null historical decoded*, *Reclaim disk —
  VACUUM FULL*, *Pack sealed frames*, plus *"1 bucket(s) packable"*.
- **Device metrics** renders.
- Both sit **above** the banner in document order.
- One control was actually driven from that desktop context: pack returned *"packed 1 bucket(s) ·
  40 frames → 244 B · nothing left to pack · 0.2s"*.
- Zero page errors.

`tsc --noEmit` clean · `eslint` zero new warnings · `pnpm check:rules` **Ran 55 of 55**.

## Not exercised

**VACUUM FULL itself was not pressed** — it rewrites the table under an exclusive lock and there was
nothing to reclaim on the local seed. What this PR changes is where the button renders, and that was
proven by driving its neighbour through the same code path.

The genuinely native panels — `RawStoreStatusConsole`, the SleepNet dump, the sensor probe,
`SampleInspector` (which takes plugin-sourced props) — deliberately stay behind the gate.

Nothing checked on the S25. The APK's view of this page changes: the two cards now appear above the
console rather than inside it. That is a layout change worth a look on device.

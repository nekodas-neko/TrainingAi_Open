# The Devices card stops calling the ring healthy when it has no key (LB-5)

**Branch:** `fix/devices-card-ring-key-state` · **Lane B** · v1.359.0

## What was wrong

`OuraConnectionSection` (the ring card on More → Devices) reads its state entirely from server
data — `/api/oura-ble/freshness` and the battery cache. Both keep reporting whatever the server
last recorded for as long as those rows exist, regardless of whether the native BLE service is
actually running. After an uninstall/reinstall (which destroys the stored key —
`OuraBlePlugin.kt`'s comment: *"the key never leaves SharedPreferences; never logged"*), the
service logs `no key stored` and refuses to start, while this card kept showing *"Ring synced 2h
ago"* from before the reinstall. The one screen someone would open to find out why the ring
stopped syncing was the one screen that couldn't tell them, because it was never asking the thing
that actually knows: the plugin itself.

## What shipped

`OuraConnectionSection` now calls `hasKey()` on the plugin (`getOuraBle()` +
`plugin.hasKey()`, both already exported from `lib/oura-ble/plugin.ts`) on mount, alongside the
existing battery/freshness fetches. When it resolves `false`, the whole card is replaced with an
amber "No ring key stored" state that links to `/admin/oura-ble` — it takes priority over the
normal healthy/unseen card, since a ring that synced recently but has no key *now* is not healthy,
whatever the server-derived data still says.

Nothing on this card reveals or re-enters the key — it only navigates to the admin console, per the
entry's explicit constraint (the owner's backup affordance is deliberately behind one entry point,
not two). `getOuraBle()` returning `null` (web, or an APK built before the plugin existed) leaves
`hasKey` at `null`, and the card renders exactly as it did before this change — the keyless branch
only activates on a real `false`.

## Verification

- `pnpm tsc --noEmit` / `eslint` — clean.
- Rendered the Devices screen against the running dev server (real login, real Postgres): no crash,
  no page error, the card renders identically to before — `getOuraBle()` is absent on web, so
  `hasKey` correctly stays `null` and the new branch never fires.
- **The keyless branch itself can't be reached in the web sandbox** (`getOuraBle()` returns `null`
  there by construction), so verified it directly: temporarily forced the state to `false`, took a
  screenshot confirming the amber card renders with the right copy and links to `/admin/oura-ble`,
  then reverted the change before committing — nothing shipped from that step.
- `pnpm check:rules` — Ran 55 of 55.

## Not exercised

**The real path — an actual reinstalled device with a genuinely missing key — was not seen.** Only
the inert web branch (`hasKey` stays `null`) and a locally forced `hasKey === false` were verified;
the actual `getOuraBle()` → `plugin.hasKey()` round-trip against the native plugin only runs on the
APK. `Gate: device` on the backlog entry.

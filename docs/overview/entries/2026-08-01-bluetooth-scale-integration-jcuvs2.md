# 2026-08-01 — Scale reliability arc bookkeeping (#965–#974 catch-up)

Branch: `claude/bluetooth-scale-integration-jcuvs2` · v1.249.1

Docs-only catch-up. The direct-BLE Renpho scale integration (original PR, #848) went through ten
more owner-directed on-device debugging rounds on 2026-07-31 and 2026-08-01 (PRs #965–#974), each
shipped as its own small merged PR per the owner's explicit "fix this now, no separate planning
PR" authorization for the arc. None of those ten PRs bumped `package.json`/`lib/changelog.ts` or
extended the `projectOverview.md` Known-Issues row, so the docs stopped reflecting reality partway
through v1.246.9. This entry + its accompanying commit close that gap; no application code changed.

## What the undocumented arc actually shipped (all native Kotlin, `android/app/.../scale/*.kt`)

- **#965** — scan match now also checks the result's MAC against the paired scale's stored
  `device_id`, fixing false-positive connects to unrelated BLE peripherals sharing the same
  generic FFE0/1/2/3 UUID pattern (device-confirmed).
- **#966** — every scale toast state (progress and result) now renders via `toast.custom()`, so
  Sonner's toast-merge-by-id can no longer leave a stale progress-bar `jsx` bleeding through a
  result toast (device-confirmed).
- **#967** — `MATCH_MODE_AGGRESSIVE` scan settings on the Home-screen live scan, plus a diagnostic
  `scan_source` tag distinguishing the live vs. background scan path.
- **#968–#971** — a same-day back-and-forth on when `ScaleGattClient` writes the FFE3
  live-measurement request: raw-hex logging of the previously-assumed-harmless handshake frame
  (#968) → re-enabled the stored-measurement drain write (#969) → deferred the live request to a
  fallback-only path (#970) → **reverted the next commit** (#971) after on-device testing showed
  deferring made the common case worse. Net result matches the original integration's behavior
  (write immediately after subscribe), with the early-data watchdog simplified back to arming once
  per connection instead of twice.
- **#972** — architecture change: the GATT connection is now held open indefinitely after linking
  (`START_STICKY`, no auto-disconnect after one reading), modeled directly on how
  `PolarStrapService` already handles the chest strap, after on-device testing found "instant"
  weigh-ins only ever happened when some other client had already left a connection open.
- **#973** — scopes the now-unbounded persistent connection (and the aggressive live scan from
  #967) to Home-screen dwell time specifically, stopping the service outright on navigating away.
- **#974** — fixed two bugs that were direct consequences of #972: duplicate ingest POSTs from the
  scale's own repeated stable-weight retransmission, and a stuck "weighing you…" toast /
  spurious failure notification caused by forwarding a background reconnect's state transitions
  the same way as a fresh weigh-in.

Full narrative (evidence, reversed theories, exact constants) written into the
`### [devices][body] Scale passive-scan background sync` Known-Issues row in `projectOverview.md`
rather than duplicated here.

## Verification status

**Not run in this session** — no code changed, so no lint/typecheck/build/test pass was needed for
this commit. The underlying #965–#974 changes were each merged individually with their own CI
gates already green.

## Not verified

- **The persistent-connection redesign (#972–#974) has no recorded on-device confirmation.**
  Every earlier step in this arc was explicitly rebuilt-and-retested on the owner's S25 before the
  next theory was tried; #972 onward does not have that. Flagged in `projectOverview.md` as
  PARTIALLY (not fully) verified — needs a real weigh-in, a back-to-back double weigh-in (the #974
  dedup path), and a Home→Settings→Home transition (the #973 scoping path) on a rebuilt APK.
- This entire round is native-only; nothing here reaches the running APK until
  `npx cap sync android && ./gradlew assembleDebug`.

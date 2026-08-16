## 2026-07-30 — Fix scale background-sync retry storm; add Body Composition card

Follow-up to the passive-scan rework (#879, v1.238.0). The owner rebuilt the APK, and within
minutes reported the "Watching for scale…" notification was gone but a new "connecting…" →
"Retrying…" notification stuck around for ~30 minutes with the scale completely untouched.

### Diagnosis
Worked through it live with the owner via `adb logcat -d` dumps. Ruled out, in order:
- **OS Bluetooth bonding** — the owner confirmed the scale isn't paired in system Bluetooth
  settings, so the periodic `BluetoothDeviceBatteryManager: # Alias(QN-Scale)` log lines aren't
  the OS polling a bonded device's battery; they're a side effect of *our own* app's repeated GATT
  connections (any GATT connection to a device exposing battery info triggers that log,
  bonded or not).
- **The official Renpho app** — force-closed both TrainingAI and Renpho; the loop still recurred
  as a fresh episode ~18 minutes later, ruling out cross-app BLE contention.

That left the scale's own firmware: `ScaleScanReceiver` fired 37 times over ~30 minutes at
irregular ~20-90s intervals, with nobody near the scale — almost certainly a motion/vibration
wake unrelated to an actual weigh-in, which is not something this app controls.

### Root cause (code)
Reading `ScaleGattClient.kt` confirmed a connect attempt doesn't require someone to actually be
standing on the scale to succeed — GATT connects, services discover, the "request measurement"
command is written, then it sits in `WAITING` state for up to `WEIGH_IN_TIMEOUT_MS` (30s) for a
stable reading that never comes. In `ScaleBleService.onFailure`, `client` is set to `null` before
the 8s scheduled retry (`RETRY_GAP_MS`) fires. `onStartCommand`'s only re-entrancy guard was
`if (client != null) ignore` — so any scan match arriving during that gap (or during the 30s wait
itself) looked like a brand-new wake, reset `attempts` back to 0, and restarted the whole 2-attempt
cycle immediately. As long as the scale kept re-advertising, this had no exit condition.

### Fix
`ScaleBleService.kt`:
- Added `cycleActive`, an instance-level guard true for the *entire* wake episode (first attempt
  through any retry gaps to the final give-up/success) — not just while a `ScaleGattClient` object
  happens to exist. Closes the window where a scan match during the retry gap could reset the
  attempt counter.
- Added `GIVE_UP_COOLDOWN_MS` (2 minutes, companion-object state so it survives Service
  re-creation within the same process) — after giving up on `MAX_ATTEMPTS`, further scan-triggered
  wakes are ignored until the cooldown expires. A real weigh-in still succeeds on its very first
  attempt (a stable reading lands in ~1-5s, nowhere near the 30s timeout), so this costs nothing
  for the genuine case while stopping an indefinite loop from a scale that just won't stop stirring.
- The cooldown-ignore path still calls `startInForeground()` before immediately `stopSelf()`-ing
  (required by Android's foreground-service contract for any `startForegroundService()`-triggered
  start) — so a spurious wake during the cooldown window still briefly flashes/clears the
  notification rather than being fully silent, a minor known tradeoff.

`capacitor-native-init.tsx`: wired `scaleLog`/`scaleStatus` native plugin events to
`console.info` (JS-only, no rebuild needed) — these were declared in the plugin's TypeScript
interface but nothing ever subscribed to them, so a recurrence was previously undebuggable short of
scavenging `adb logcat` for lines the app never actually logged there. Now visible live via
`chrome://inspect`.

### Also shipped: Body Composition card
Separately, the owner asked whether the scale integration was capturing everything beyond
weight/body-fat (it is — `lib/scale-ble/composition.ts` already computes and stores skeletal
muscle %, fat-free mass, muscle/bone mass, body water %, subcutaneous fat %, visceral fat index,
protein %, BMR, and metabolic age) and asked for a trends card. Extended `BodyMetaRow`/
`/api/body-metadata` to include the 10 fields (reusing the existing `repo.listBodyMetrics` call —
no new endpoint, no new cache key) and added a "Body Composition (Scale)" card to Health > Body,
next to the existing `bodyWeight`/`bodyFat`/`leanMass` cards, visible only once a user has a scale
reading (`isSectionVisible`'s `bodyComposition` case). Follows the established stat-tile-grid +
sparkline pattern (`RhrHrvSpo2Card`) and `accentCardStyle` container convention. Updated every
other `BodyMetaRow`-shaped object literal across the codebase (`health-content.tsx`,
`session-select-content.tsx`, `log-value-sheet.tsx`, `metric-log-sheet.tsx`) to carry the new
fields through — the local-SQLite read paths already had them mirrored from the original scale PR,
so those pass real values through rather than nulling them.

### Tests
`pnpm typecheck`/`pnpm lint` clean (0 errors), `node scripts/check-reconcile.js` and
`check-push-mutations.js` clean, `pnpm test` — 2544 passing (one pre-existing, unrelated flake in
`oura-ble/live-steps/implausible-cadence.test.ts` confirmed passing in isolation — the documented
DB-pool-oversubscription class), `pnpm build` clean.

### Not yet confirmed
The cooldown fix is compile-reviewed only — no Android SDK/Bluetooth hardware in this sandbox. The
owner needs to rebuild the APK and confirm the retry storm actually stops (or at least backs off to
one flash-and-clear per cooldown window) the next time the scale spuriously wakes. The Body
Composition card is JS/API-only and auto-deploys via Railway — no rebuild needed for that half.

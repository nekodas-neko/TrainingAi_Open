# Colmi background sync — a transport-only native service

**Status:** plan, not started · **Lane:** A · **Needs an APK** (Stage B onward)

## The problem this solves

`useColmiAutoSync` (v1.395.1) syncs the ring while the app is open — on launch, on resume, and every
30 minutes foregrounded. It closed the evening gap that cost two days of stress data, and it is
still not enough:

- **Measured 2026-09-02:** the last reading was 11:45 and the owner checked at 17:59. Six hours
  missing, because the app had not been opened. HRV, stress, SpO₂ and temperature are offered by the
  ring **for the current day only**, so they would have been lost at midnight rather than
  back-filled.
- **A second wearer will not open the app on our schedule.** This is the blocker on handing the ring
  to anyone else, more than any unvalidated metric.

## The decision: Kotlin carries bytes, the server reads them

The obvious build copies `OuraRingService` — 2,208 lines of Kotlin including a full protocol and
decoder port. **Do not do that.**

| | Full Kotlin port | Transport-only |
|---|---|---|
| Kotlin | ~1,500 lines | ~400 |
| Decoder implementations | 2 | 1 |
| A decoder fix reaches archived data | No | **Yes** |
| A decoder fix needs an APK | Yes | **No** |

The third and fourth rows decide it. **Three of this week's Colmi defects were decoder defects** —
the ten-hour heart-rate anchor, the dropped continuation packets, the sleep frame's junk tail. Each
was fixed once in TypeScript and applied retroactively by re-reading `colmi_raw_frames`. With a
Kotlin copy, each needs fixing twice and the phone's copy only improves when an APK is installed.

Kotlin needs the **command builders** (~10 small byte-array functions, already written in
`lib/colmi-ble/protocol.ts` and trivially portable) and **not** the decoders.

**Reversal cost:** low now, high later. Once the phone owns decoding, taking it back means
re-verifying on-device; leaving decode on the server keeps adding it later purely additive.

---

## Stage A — move decode server-side (JS only, no APK)

The riskiest step, and it ships without touching Android. Sequence matters: the in-app sync must
keep working throughout.

1. **Add a `rawFrames`-only ingest path.** `/api/colmi/samples` already accepts `rawFrames` and
   stores them. Add server-side decode: run the existing `decodeV1` / `decodeBigData` /
   `framesToPayload` over the posted frames and write the readings, when the body carries frames and
   no `readings`.
   - `framesToPayload` needs `todayStr` and `timezone`. The route already resolves the user's
     timezone; **it must resolve the day server-side too**, never from the client — same rule the
     `local_date` write already follows.
   - The heart-rate anchor conversion (`wallClockSecondsToEpochMs`) moves with it.
2. **Prove equivalence before switching anything.** Take the ~90 archived `colmi_raw_frames` rows,
   run them through the server path, and assert the readings match what the client path produced for
   the same sync. This is a test, not a migration — the frames are already stored and every one has
   a known outcome in `colmi_readings`.
3. **Switch the WebView client to post frames only.** `syncColmiRing` stops calling
   `framesToPayload` and posts `rawFrames` alone. The card's counts come from the response.
4. **Keep `framesToPayload` exported and tested.** It is the same function either side; only its
   caller moves.

**Verification for Stage A:** one in-app sync produces the same rows it does today. Because the raw
frames are archived, a mistake here is repairable by re-decoding rather than by re-wearing the ring.

---

## Stage B — the Kotlin transport service (needs an APK)

Mirror `OuraRingService`'s *shape*, not its size.

**Files** (`android/app/src/main/java/com/trainingai/app/colmi/`):

- `ColmiProtocol.kt` — the command builders only. Port of `protocol.ts`: `buildPacket`, the mod-256
  checksum, `cmdPhoneName`, `cmdSetDateTime`, `cmdBattery`, `cmdWriteAutoPref`, `cmdReadAutoPref`,
  `cmdSyncActivity`, `cmdSyncHeartRate`, `cmdSyncHrv`, `cmdSyncStress`, and the three V2 big-data
  commands. **Every builder gets the same test vector as its TypeScript twin** — that is what keeps
  the one duplicated surface honest.
- `ColmiGattClient.kt` — connect by stored device id, discover the two services, enable notifications
  on both notify characteristics, write with a gap, collect frames. Reassemble V2 frames using the
  declared-length rule (`bigDataPayloadLength`).
- `ColmiSyncService.kt` — a foreground service that runs one sync and stops. Posts
  `{ rawFrames: [...] }` to `/api/colmi/samples`.
- `ColmiBootReceiver.kt` — re-arm after reboot.

**The command sequence to replicate**, in order (from `ble.ts`):

```
phoneName → setDateTime → battery
  → writeAutoPref × 5 → readAutoPref × 5
  → syncActivity × N days
  → syncHeartRate × N days   (local midnight as wall-clock-seconds-as-UTC)
  → syncHrv → syncStress
  → V2: syncSleep → syncTemperature → syncSpo2
```

**Auth: reuse the WebView cookie.** `OuraRingService` reads
`CookieManager.getInstance().getCookie(base)` and sets it as a `Cookie` header. Copy that exactly —
no new secret, no token plumbing, and it fails closed when the user is logged out.

**Two hazards already learned on this device:**

- **A peripheral takes one connection.** The scale's scanner holding the radio presents the ring as
  *not found*. The service must not fight the in-app sync — share a lock, and prefer the app's sync
  when the app is foreground.
- **Samsung does not honour `autoConnect = true`** (proven on the Oura, v1.116.4). Direct connect
  plus a bounded same-device retry.

---

## Stage C — cadence

Match the ring's own granularity rather than guessing. Its metrics move at 30-minute resolution, and
its history back-fills for heart rate and activity but **not** for the four current-day-only
metrics.

- **A periodic sync every ~2 hours** is enough to keep the current-day metrics safe, and cheap: a
  sync is seconds of radio.
- **One guaranteed sync late in the evening** (~22:00 local) is the load-bearing one — it is what
  captures the day before midnight discards it.
- Skip when a sync already ran inside the interval. Reuse `shouldAutoSync`'s logic and its
  future-clock guard rather than writing a second one.

---

## Verification — device only

None of Stage B or C can be verified in the sandbox; BLE does not exist there.

1. **A day with the app never opened.** Stress and HRV must run past 18:00. The failing shape is
   already on record: 2026-08-28 stops at 06:30, 2026-08-29 at 17:30.
2. **A reboot**, then a day with the app never opened. Same check.
3. **The scale then the ring**, back to back — the sync must queue rather than report a missing ring.
4. **Battery.** Read the ring's own battery trend across three days against the current baseline;
   a service that wakes the ring too often will show up there before anywhere else.

## What this plan does NOT do

- It does not make the ring's data appear anywhere in the app. Learning-mode isolation stands, and
  wiring the ring into scoring is a separate decision that should wait for the H10 session.
- It does not resolve steps, calories, or the sleep stage mapping (PS-16, PS-19).
- It does not touch the Oura service.

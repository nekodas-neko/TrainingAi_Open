# The Colmi ring — testing it, and where it lands in the source tiers

**Status:** design proposed 2026-08-26 from an owner question. **Nothing implemented, nothing
measured, no Colmi ring has ever connected to this app.** Protocol constants below are quoted from
the primary open-source client (§3) and are still unverified against the owner's actual unit.
**Backlog entry:** PS-8 (Phase 0 + Phase 1 only — Phases 2–4 are deliberately not queued).
**Domain:** [`devices`](../../domains/devices/README.md)
**Owner question this answers:** *"how can I go about using it/testing it? should I test it on
myself or another user first?"*

---

## 1. The answer in one paragraph

**Wear it yourself, on the opposite hand to the Oura, and quarantine its writes.** The only
question worth spending a fortnight on is *how close is it to the Oura*, and that question has no
answer unless one body wears both at once. A friend wearing it produces numbers with nothing to
check them against. The reason to reach for a second person — two rings writing into one account —
is real, but it is a **write-path** problem, not a **who-wears-it** problem, and this repo already
owns the mechanism that solves it (§5). The friend is Phase 4, and it tests something completely
different: whether a non-owner gets a working app at all, which
[`device-agnostic-source-architecture.md`](../../device-agnostic-source-architecture.md) says has
**never run against a real non-owner device**.

---

## 2. Why this ring is nothing like the Oura to work with

Every hard rule in `CLAUDE.md`'s Oura section exists because the Oura ring is a hostage: it runs on
our own key, the key exists in exactly one file on one machine, and its firmware is frozen because
a vendor update would break a reverse-engineered protocol. None of that transfers.

| | Oura Ring 5 | Colmi |
|---|---|---|
| Auth | re-keyed onto our key; **an uninstall destroys it** | none — open GATT, connect and talk |
| Protocol source | `open_oura` Rust, reverse-engineered, pinned to captured vectors | published Python client + a Gadgetbridge implementation |
| Firmware | **deliberately frozen** — an update is a protocol re-validation | updatable; a raw-streaming mod firmware exists (§7) |
| Blast radius of a mistake | lose the key, lose the ring | re-pair it |
| Vendor app | must never be re-onboarded | fine, just disconnect it before testing |

**The practical upshot: the Colmi is safe to experiment on in a way the Oura is not.** There is no
irreversible step anywhere in Phases 0–4. That is what makes "test it on yourself" the cheap option
rather than the risky one — the intuition that a second person is safer is inherited from the Oura's
constraints, and it does not apply here.

One constraint does apply: **a BLE peripheral holds one connection**. The ring must be disconnected
from the QRing/Colmi vendor app before ours can reach it.

---

## 3. The protocol, quoted from source

Per `CLAUDE.md`'s external-field rule — read the pinned source, never memory. These come from
[`tahnok/colmi_r02_client`](https://github.com/tahnok/colmi_r02_client), fetched 2026-08-26.
**They are a starting point for Phase 0, not a specification to build against**: the client's own
README supports R02/R06/R10, and the owner's model and firmware are not yet known (§9).

**Transport.** A Nordic-UART-shaped custom service:

| | UUID |
|---|---|
| Service | `6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E` |
| RX (we write) | `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` |
| TX (we subscribe) | `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` |

**Framing.** Fixed 16-byte packets both directions. Byte 0 is the command; bytes 1–14 are payload;
byte 15 is a checksum — *the sum of the first 15 bytes, modulo 255*. Note **255, not 256**; that is
what the source says and it is the kind of detail that silently fails every write if assumed.

**Commands verified in source:**

| Command | Byte | Notes |
|---|---|---|
| Battery | `0x03` | request and response share the tag |
| Set time | `0x01` | the ring's clock is what every log timestamp is relative to |
| Read HR log | `0x15` (21) | multi-packet; sub-type 0 = header (packet count + interval), sub-type 1 carries a little-endian `<l` unix timestamp then 9 values, sub-types 2+ carry 13 values each, sub-type 23 terminates, `0xFF` = no data |
| Read steps | `0x43` (67) | per-day, `day_offset` relative to the ring clock; each record is steps / calories / distance-in-metres keyed to a 15-minute `time_index` |
| Start real-time | `0x69` (105) | + a reading type + an action |
| Stop real-time | `0x6A` (106) | + the reading type |
| Reading types | | HR `1`, blood pressure `2`, SpO2 `3`, fatigue `4`, ECG `7`, HRV `10` |
| Actions | | start `1`, pause `2`, continue `3`, stop `4` |

**What is NOT in that client, and this matters:** no sleep, no SpO2 log, no raw accelerometer, no
raw PPG. Its own reverse-engineering checklist lists sleep tracking as unticked. Gadgetbridge's
Colmi support *does* implement sleep sync, derived from a Wireshark dissection of the vendor app —
so sleep is known-possible but is a second protocol source to port from, not a copy-paste.

---

## 4. The thing that makes this cheap: it needs no APK

This is the finding that should change the plan you were expecting.

`lib/live-hr/chest-strap-source.ts` connects to the Polar H10, subscribes to notifications, decodes
frames and posts them to an ingest route — **entirely in TypeScript, in the WebView, via
`@capacitor-community/bluetooth-le`** (already a dependency, v8.2.0). `components/settings/
chest-strap-pairing.tsx` does the pairing with `BleClient.requestDevice()` and reads the battery and
firmware characteristics the same way. The Kotlin foreground service came *later* and is an
upgrade for all-day background operation, not a prerequisite.

So a Colmi spike is JavaScript. It ships through Railway on a normal merge, with **no Gradle build,
no APK install, and therefore no uninstall risk to the Oura key**. Iteration is a deploy, not a
device cycle.

The WebView BLE path is suspended when the app is backgrounded — which for the Oura would be fatal,
because its pipeline continuously drains a finite history buffer. For the Colmi it is nearly
irrelevant: the ring logs HR, steps and sleep internally, and you read them back with `0x15`/`0x43`
on demand. **Open the app, sync, done** — the same shape as the scale, not the same shape as the
Oura. Backgrounding only becomes necessary for real-time streaming, which is Phase 3 at the
earliest.

---

## 5. Two rings on one account — why this is a solved problem here

The worry behind *"if it's another user there won't be issues with having 2 rings"* is that a second
ring corrupts the first one's data. Here is what actually governs that.

**`body_metrics` / `sleep_sessions` / `oura_daily` are safe by construction.** They carry a
`source_map` JSONB and go through the ranked per-field merge in `lib/data/health-source.ts`. A new
`colmi_ble` source slotted *below* `oura_ble` in
`packages/shared/src/health/source-rank.ts` can only ever fill a NULL — it cannot overwrite a value
the Oura wrote. Adding it is a one-line change to a `const` tuple. **No migration**: the map is
JSONB and the ranks are TypeScript.

**`oura_heartrate` is NOT safe, and this is the one to watch.** Its `source` is a bare `text`
column with no rank merge, and the unique key is `(user_id, timestamp)` resolved by
`onConflictDoNothing`. Two rings both emitting a sample on the same second is **first-writer-wins,
permanently**. It is also written by `app/api/hr-ingest/route.ts`, which hardcodes
`source: 'chest_strap'` — so a Colmi HR ingest cannot reuse that route as-is.

**Therefore Phase 1 quarantines.** The Colmi writes to nothing shared: its own local capture, read
back by the comparison harness only. Promotion to a ranked source is Phase 2, and it is gated on
having a number that says the ring is worth promoting.

That is the whole reason the second-person option looked attractive, and it costs one decision to
remove.

---

## 6. The phases

### Phase 0 — identify the unit (30 minutes, no code)

Answering §9's open questions is the entire deliverable.

1. Disconnect the ring from the vendor app.
2. Scan for it. `components/settings/chest-strap-pairing.tsx` is the working reference for
   `BleClient.requestDevice()`; filter on service `6E40FFF0-…` rather than a name prefix, since
   advertised names vary by model (`R02_…`, `R06_…`, `Colmi …`).
3. Read Device Information (`0x180A`) firmware revision and the model string, and Battery (`0x180F`)
   if present. Record both **in this document** — the firmware revision is what a later protocol
   discrepancy gets diagnosed against, exactly as the plan does for the H10.
4. Send `0x03` (battery) and confirm a 16-byte reply with a valid mod-255 checksum. That single
   round trip proves transport, framing and checksum in one shot.

**Gate:** if step 4 fails, everything after it is void and the model is not in the R02 protocol
family. Stop and re-plan rather than guessing at command bytes.

### Phase 1 — the comparison spike (the actual deliverable)

A `lib/colmi-ble/` directory mirroring `lib/scale-ble/`'s shape: `plugin.ts`-equivalent BLE access,
a pure `protocol.ts` (build/parse/checksum — **pure, so it is unit-testable without a device**, the
same split as `PolarProtocol.kt`), a `sync.ts` that pulls the HR log and the step log, and a
pairing card under `components/settings/`.

Writes go **only** to a quarantined store. Reads go **only** to a new comparison adapter.

`lib/oura-comparison-harness.ts` already does the scoring — it takes an adapter supplying two
bucketed series and reports within-tolerance counts and mean absolute delta, and
`components/oura-ble/comparison-harness-console.tsx` already renders it. A Colmi adapter is the
`ringVsH10HrAdapter` pattern with one side re-pointed: roughly 40 lines. **Build nothing new for
scoring.**

Every pure decoder gets a test pinned to a captured packet hex, per the rule the Oura pipeline
already follows.

### Phase 2 — promote it, if the numbers earn it (not queued)

Add `colmi_ble` to `HEALTH_SOURCES` below `oura_ble`, extend `hr-ingest` to take a source instead of
hardcoding one, and let it fill what the Oura leaves NULL. Conditional on Phase 1's report.

### Phase 3 — sleep (not queued)

Needs the Gadgetbridge protocol port. Worth doing only if Phase 1 shows the ring's HR is credible,
since a sleep stage the ring derives from a bad PPG is not going to be better than its HR.

### Phase 4 — the friend (not queued, and it is a different question)

Give a validated ring to the second account holder. What this tests is **tier 2** — a user with no
Oura getting working score cards — and per `device-agnostic-source-architecture.md` §4a several read
paths currently have no generic fallback and will render blank. That is a real finding waiting to
happen, and it is worth having, but it is not a ring-accuracy test and should not be confused with
one.

---

## 7. The one irreversible thing: do not flash the mod firmware

There is a circulating `R02_3.00.06_FasterRawValuesMOD.bin` that raises the raw-streaming rate, and
Edge Impulse's data-collection example calls upgrading "highly recommended" for raw capture. Raw
accelerometer and PPG are exactly what
[`device-agnostic-source-architecture.md`](../../device-agnostic-source-architecture.md) means by a
**raw-capable source** — a tier-1 device we derive metrics from ourselves — so this is genuinely
tempting.

**Not in Phase 1.** A third-party firmware flash is the only step in this whole plan that can brick
the device, and it would be taken *before* knowing whether the ring's sensor is good enough to be
worth streaming from. Phase 1's numbers are what tell you whether tier-1 ambitions are justified.
If they are, flashing is a separate owner decision with its own write-up.

Until then the Colmi is a **computed source**: it hands us finished HR, steps and (later) sleep,
which puts it in the right-hand column beside Health Connect.

---

## 8. The wear protocol — how to not get a meaningless number

- **Opposite hands.** Contralateral is fine for HR, HRV and sleep. It is **not** fine for step
  counts: a wrist/finger step counter reads materially differently on the dominant hand. Record
  which hand each ring is on.
- **Swap hands at the halfway mark.** A fortnight split 7/7 with the rings swapped separates
  *device* bias from *hand* bias. Without the swap, a step-count difference is uninterpretable.
- **Wear the Polar H10 for at least three workouts during the trial.** It is the only real ground
  truth for HR in the building, and the harness already scores against it. Ring-vs-ring tells you
  they disagree; ring-vs-strap tells you which one is wrong.
- **14 nights minimum before drawing a sleep conclusion.** `CLAUDE.md` records a documented false
  conclusion from a pooled correlation, where the honest per-version signal was n=11. Short trials
  here have already produced published wrong answers.
- **Record the ring's own firmware once at the start and once at the end.** If it silently updates
  mid-trial, every number before and after it belongs to a different device, which is the same
  `model_version` trap `CLAUDE.md` describes for scores.

---

## 9. Open questions — owner input

1. **Which model, exactly?** R02, R03, R06, R10, R12? The referenced client supports R02/R06/R10 and
   the newer models are not guaranteed to share the framing. This does not block Phase 0 — Phase 0
   *is* how it gets answered — but it changes how much of §3 survives.
2. **Is the ring currently paired to the QRing/Colmi vendor app?** It has to be disconnected, and
   if the vendor app has already been used, its own sync may have consumed on-ring log history.
3. **Sizing** — is it wearable on the opposite hand's equivalent finger? The wear protocol in §8
   depends on it.

---

## 10. What this plan does not claim

- No Colmi ring has connected to this app. Every byte in §3 comes from someone else's repository.
- The mod-255 checksum, the 16-byte framing and every command byte are **unverified on hardware**.
- Sleep is not solved — it is *known to be solvable*, from a second codebase, which is not the same
  thing.
- Phase 1 produces a comparison report. It does not produce a second ring anyone can use.

## Pickup prompt

Check out a branch from a freshly-fetched `main`. Read, in order: `projectOverview.md`,
[`docs/domains/devices/README.md`](../../domains/devices/README.md), this plan, then
`lib/live-hr/chest-strap-source.ts` and `components/settings/chest-strap-pairing.tsx` — those two
files are the working in-WebView BLE reference and the whole Phase 1 spike is shaped like them.

**First concrete action: Phase 0, §6.** It is a scan, two characteristic reads and one `0x03`
round trip, and it needs the physical ring in hand. Do not write `lib/colmi-ble/` before it passes —
the command bytes in §3 are from a third-party client and the owner's model may not be in that
protocol family.

Constraints that will otherwise be rediscovered: this needs **no APK** (the WebView BLE path ships
via Railway — §4), the Colmi must write **nothing** to shared health tables in Phase 1 (§5, and
`oura_heartrate` is the specific table with no merge protection), and the raw-streaming mod firmware
is **out of scope** (§7). Backlog entry is PS-8.

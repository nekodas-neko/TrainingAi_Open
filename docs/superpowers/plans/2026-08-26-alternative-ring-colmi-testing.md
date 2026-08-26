# The Colmi R09 in learning mode — deployment plan

**Status:** design, 2026-08-26. **No Colmi ring has connected to this app.** Protocol constants in
§4 are quoted from published clients and are **unverified against the owner's R09**.
**Backlog entry:** PS-8 · **Domain:** [`devices`](../../domains/devices/README.md)
**Guard shipped with this plan:** `scripts/check-learning-mode-isolation.js`, wired into the Custom
Rules CI job. It is the enforcement half of §2 and it exists *before* the integration on purpose.

**The owner's two questions, 2026-08-26:**
1. *"lets do the full deployment plan"* → §3–§7.
2. *"are we sure its data will be read only and wont affect scoring of anything I have going? I
   basically just want to ingest the data in a 'learning' mode state."* → §1–§2. **Short answer:
   yes, but not for the reason you would expect, and the obvious way of achieving it does not
   work.**

---

## 1. Why the obvious isolation mechanism does not work

The tempting answer is *"add `colmi_ble` to the source ladder below `oura_ble` and the ranked
per-field merge will protect everything."* **That is wrong, and it is worth being precise about
why, because it is the failure this whole design is shaped around.**

The ranked merge in `lib/data/health-source.ts` governs **writes**. It decides whether an incoming
value may overwrite a stored one. It says nothing about **reads** — and every scoring read in this
app is source-blind:

| Read path | What it does with `source` |
|---|---|
| `getHrForWindow` (`lib/data/postgres/slices/oura.ts:743`) | selects `oura_heartrate` with **no source predicate**, then calls `preferStrapBuckets` |
| `preferStrapBuckets` (`packages/shared/src/health/hr-window-merge.ts`) | an **allowlist of exactly one value** — `chest_strap`. Every other source falls through untouched |
| `listBodyMetrics` · `listSleepSessions` · `getOuraDaily` · `getOuraDailyDerived` | read whole rows. `source_map` is per-field write provenance; **no read consults it** |

Repo-wide, exactly **two** reads filter `oura_heartrate` by source, and both are deliberate: the
rollup (`'ble'`) and the comparison adapter's `getOuraHeartrateBySource`. Nothing else.

**So a Colmi row inside `oura_heartrate` is a scored row, whatever it is stamped.** It would feed
`lib/health/readiness-payload.ts` (readiness) and `app/api/body-battery` directly, through
`getHrForWindow`. Ranking it low would stop it *overwriting* an Oura value and would not stop it
being *read*.

Isolation therefore cannot come from ranking. It comes from the data never entering those tables.

---

## 2. What "learning mode" means here — four layers

**Definition.** A learning-mode device is *ingested, stored, and compared*, and is read by nothing
that produces a number the app shows you as your own. It is a research input, not a health source.

### Layer 1 — separate tables (the substance)

Colmi data lands in its own tables and touches none of the five that feed scoring:

> `oura_heartrate` · `body_metrics` · `sleep_sessions` · `oura_daily` · `oura_daily_derived`

That list is not a guess — it is the union of every table reachable from the scoring routes'
repository calls (`readiness-payload.ts`, `app/api/body-battery`, `app/api/health-trends`), and it
is encoded in the guard so it cannot quietly drift.

### Layer 2 — the type system, by omission (the strongest layer, and it is free)

Every shared-table write takes `source: HealthSource`:

```ts
upsertBodyMetrics(userId, metrics, source: HealthSource)
saveSleepSession(userId, session, source: HealthSource)
upsertOuraDaily(userId, rows, source: HealthSource)
```

`HealthSource` is a closed union built from the `HEALTH_SOURCES` tuple in
`packages/shared/src/health/source-rank.ts`. **By NOT adding `colmi_ble` to that tuple, a Colmi
write to any shared table becomes a compile error.** Not a lint warning, not a convention — the
build fails.

This is the part worth internalising: the protection comes from the ladder entry being **absent**.
Adding it "just for provenance" is exactly the change that would remove the guarantee.

### Layer 3 — the CI guard (shipped with this plan)

`scripts/check-learning-mode-isolation.js` fails the Custom Rules job on any of:

- a `lib/colmi-ble/**` module naming a scoring table (including **inside a string** — a raw
  `sql\`INSERT INTO oura_heartrate …\`` is the leak that matters most, and the first draft of the
  guard missed it because it blanked string bodies; a probe caught that the same hour);
- a `lib/colmi-ble/**` module calling a shared writer (`upsertBodyMetrics`, `mergeSet`, …);
- anything outside `lib/colmi-ble/**` importing it, **except** `lib/oura-comparison-harness-adapters.ts`,
  which is the one sanctioned reader;
- `colmi` appearing in `HEALTH_SOURCES`, or in any scoring input file.

Empty baseline, same shape as `check-aest-midnight-timezone.js`: there is no existing debt, so any
hit is a regression. **All four shapes were probed and confirmed failing before the guard landed** —
a check that has only ever passed proves nothing.

Promotion out of learning mode is then a deliberate, visible act: the guard starts failing, and the
promoting PR has to remove `colmi` from `LEARNING_MODE` in that script. There is no path where it
happens by accident.

### Layer 4 — no sync, no outbox, no local-store domain

The Colmi tables get **no** `getSyncDelta` entry, **no** outbox domain, and **no** `pullDelta`
mapping. Learning-mode data does not need to survive on a second device, and every one of those
wirings is a route into shared machinery. `full-export` / `db-snapshot` may include the tables (they
are yours) but nothing computes from them.

### What this costs you

Nothing you would otherwise have. In learning mode the ring gives you a **comparison report**, not a
second opinion on your readiness. That is the trade, stated plainly: you cannot both quarantine the
data and have it improve your scores. Promotion is §7, and it is a decision to take *after* you know
whether the ring is any good.

---

## 3. The R09 specifically — what changed from the R02 assumption

The owner has a **Colmi R09**. This matters:

- The reference client `tahnok/colmi_r02_client` lists **R02, R06 and R10** as compatible. **R09 is
  not on that list.**
- A fork, [`patmorli/colmi-r09-smart-ring`](https://github.com/patmorli/colmi-r09-smart-ring),
  exists specifically to track R09 work and reports the **same** service/characteristic UUIDs, the
  same 16-byte framing, the same mod-255 checksum, and the same implemented feature set (real-time
  HR + SpO2, HR logs, step logs, time sync).

So the R09 is *probably* in the R02 protocol family, on the evidence of one fork. That was enough to
start and not enough to build on.

**Updated 2026-08-26 — the transport half is now measured, not inferred.** A Phase 0 enumeration on
the owner's unit found service `6E40FFF0-…` present with RX `6E400002-…` (WRITE / WRITE NO RESPONSE)
and TX `6E400003-…` (NOTIFY + CCCD). Firmware `RT09_3.10.22_260420`, hardware `RT09_V3.1`. Full
record in §11. **The framing and checksum are still unverified** — that is the `0x03` round trip,
and it is the one step of the gate still outstanding.

---

## 4. Protocol — from the implementation that works on the R09

**Rewritten 2026-08-26.** The earlier version of this section quoted `tahnok/colmi_r02_client`, a
Python client that does not list the R09. The authority is now **Gadgetbridge**, which carries a
first-class `ColmiR09Coordinator.java` and a user running the model with every sensor working
([#4491](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/4491)). Source:
`devices/yawell/ring/YawellRingConstants.java` and
`service/devices/yawell/ring/YawellRingDeviceSupport.java` (the rings are Yawell-OEM; Colmi is the
brand). Where the two sources disagree, Gadgetbridge wins — it is the one demonstrated on this model.

### 4a. There are TWO protocol versions and the ring speaks both

This is the structural fact the earlier version missed entirely.

| | Service | Write | Notify |
|---|---|---|---|
| **V1** — ordinary commands | `6e40fff0-…` | `6e400002-…` | `6e400003-…` |
| **V2** — "big data" | `de5bf728-…` | `de5bf72a-…` | `de5bf729-…` |

Gadgetbridge registers **both** services and subscribes to **both** notify characteristics on
connect. V1 carries the 16-byte command traffic; **V2 carries sleep, temperature, SpO2 and alarms**
as length-prefixed, CRC16-Modbus-checksummed, *multi-packet* payloads that must be reassembled.

So §11b's "second custom service, purpose unknown" is answered: it is where the data this plan most
wanted — **sleep and skin temperature** — actually lives.

### 4b. The checksum is mod 256 — **the earlier mod-255 claim was wrong**

`buildPacket` in `YawellRingDeviceSupport.java`:

```java
int checksum = 0;
for (byte content : contents) { checksum = (byte) (checksum + content) & 0xff; }
buffer.put(15, (byte) checksum);
```

`& 0xff` is **mod 256**. Every Python client says mod 255, and this plan repeated that with a
warning that assuming 256 would fail on half of all commands. **That was backwards.** The two agree
for any payload summing under 255 — including every probe run so far — and diverge above it
(`ff ff` → 254 vs 0; `80 7f` → 255 vs 0). Take mod 256, from the implementation that works, and pin
a test to a captured vector rather than to either claim.

**The V2 big-data channel does not use this checksum at all** — it uses CRC16-Modbus over the
payload, with a 6-byte header (`0xbc`, type, u16 length, u16 crc). Two different integrity schemes
in one device.

### 4c. There is a connect handshake, and battery is requested LAST

`initializeDevice` → read `0x180A` → subscribe **both** notify characteristics → **wait 2 seconds
("to give the ring time to settle")** → then, in order: **phone name → date/time → preferences →
battery**.

A bare battery request on a freshly-connected ring is not what the working client does, which is the
most likely reason the probes in §11c got nothing back.

### 4d. Commands (Gadgetbridge, R09-verified)

| Command | Byte | | Command | Byte |
|---|---|---|---|---|
| Set date/time | `0x01` | | Sync stress | `0x37` |
| Battery | `0x03` | | Auto-HRV pref | `0x38` |
| **Phone name** (handshake) | `0x04` | | **Sync HRV** | `0x39` |
| Display pref | `0x05` | | Auto-temperature pref | `0x3a` |
| Power off | `0x08` | | **Sync activity/steps** | `0x43` |
| Preferences | `0x0a` | | **Find device** (blink) | `0x50` |
| **Sync heart rate** | `0x15` | | Manual heart rate | `0x69` |
| Auto-HR pref | `0x16` | | Notification | `0x73` |
| Realtime heart rate | `0x1e` | | **Big data (V2)** | `0xbc` |
| Goals | `0x21` | | Factory reset | `0xff` |
| Auto-SpO2 pref | `0x2c` | | Packet size | `0x2f` |
| Auto-stress pref | `0x36` | | | |

**V2 big-data types:** temperature `0x25` · **sleep `0x27`** · SpO2 `0x2a` · alarm `0x2c`.
**Sleep stages:** light `0x02` · deep `0x03` · REM `0x04` · awake `0x05`.
**Push notifications from the ring:** new HR `0x01` · new SpO2 `0x03` · new steps `0x04` ·
battery `0x0c` · live activity `0x12`.

**Note `0x50` FIND_DEVICE, not `0x10`.** The Python client's `CMD_BLINK_TWICE = 0x10` has no
counterpart in Gadgetbridge's set, which is the simplest explanation for the §11c blink probe doing
nothing: it may not be a command this firmware knows.

**What this rewrite buys the plan.** Sleep is no longer "known-solvable from a second codebase" —
the command, the type byte, the stage encoding and the framing are all in hand, and **skin
temperature**, which neither the Oura BLE pipeline nor any Python client provides, comes with it.
Phase 6 shrinks accordingly. Cross-check: the commands the Python client did document
(`0x01`/`0x03`/`0x15`/`0x43`/`0x1e`) all agree with Gadgetbridge, so §4's older material was right
as far as it went.

## 5. Why deployment is cheap: no APK

`lib/live-hr/chest-strap-source.ts` performs the full BLE cycle — scan, connect, subscribe, decode,
ingest — **in TypeScript in the WebView**, via `@capacitor-community/bluetooth-le` (already a
dependency, v8.2.0). `components/settings/chest-strap-pairing.tsx` does the pairing with
`BleClient.requestDevice()`. The Kotlin foreground service came later and is an all-day-background
upgrade, not a prerequisite.

The WebView BLE path is suspended when the app is backgrounded. For the Oura that would be fatal —
its pipeline continuously drains a finite history buffer. For the Colmi it barely matters: the ring
logs HR and steps internally and you read them back on demand with `0x15`/`0x43`. **Open the app,
sync, done** — the scale's shape, not the Oura's.

Consequences: ships through Railway on a normal merge, no Gradle, **no APK install, and therefore no
uninstall risk to the Oura ring key.**

---

## 6. The deployment phases

### Phase 0 — identify the unit · owner, no code, no repo change · **gate**

**Starting position, confirmed by the owner 2026-08-26: the ring is factory-fresh and no software
of any kind has been installed.** That is the best possible starting state — full on-ring log
history, nothing holding the BLE connection, and no vendor app to undo. It also means two things
must happen before any of the rest of this document is testable.

#### 0a. Charge it first — it ships switched off

Per Colmi's own FAQ the ring **leaves the factory powered down** and needs charging *"for more than
1 hour until the charging indicator turns green"* to activate for the first time. Until that is
done it will not advertise, and a scan finding nothing means nothing.

#### 0b. Do NOT install QRing — use a generic BLE tool instead

Colmi's support material says the QRing app is required and that pairing *"must be done within the
QRing app, not directly through your phone's Bluetooth settings."* **Treat that as a statement about
their supported flow, not a hardware lock.** `tahnok/colmi_r02_client` connects with `bleak`
directly and documents no QRing-first step, and Gadgetbridge exists specifically to replace the
vendor app. The vendor's insistence is most plausibly the charge-to-activate step above, which is
real, wearing a different hat.

**Use [nRF Connect for Mobile](https://play.google.com/store/apps/details?id=no.nordicsemi.android.mcp)
(Nordic Semiconductor, free).** It is a generic GATT explorer, not vendor software: it pushes no
firmware, syncs nothing, and consumes no on-ring history. It also does the entire Phase 0 gate
**without a line of code being written or a single repo change** — which means a failure here is
unambiguously the ring or the model, never our decoder.

**QRing is the fallback, not the plan.** If 0c finds the ring does not advertise after a full
charge, install it, pair, confirm the ring works, then uninstall it immediately. Its costs, in
order: it may prompt a **firmware update — decline it** (a changed event encoding is the one thing
that would invalidate §4); it holds the BLE connection, so it must be force-stopped or removed
before ours can connect; and its first sync may consume on-ring log history.

#### 0c. The gate itself, in nRF Connect

1. **Scan.** Record the **advertised name** (expect something like `R09_xxxx` or `Colmi …`) and the
   MAC. Filter by service `6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E` if the list is crowded.
2. **Connect**, then open **Device Information (`0x180A`)** and read **Firmware Revision**, **Model
   Number** and **Manufacturer Name**. **Write all three into §11 of this document.** The firmware
   string is what a later protocol discrepancy gets diagnosed against, and re-reading it at the end
   of the trial is how a silent mid-trial update gets caught.
3. **Confirm service `6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E` is present.** This is the single most
   important unknown about the R09 — the reference client does not list the model, and this is the
   check that settles whether §4 applies to it at all.
4. **Enable notifications** on TX `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` (the triple-arrow icon).
5. **Write this to RX `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`**, as a WRITE REQUEST, hex:

   ```
   03000000000000000000000000000003
   ```

   That is the battery command: byte 0 = `0x03`, bytes 1–14 zero, byte 15 = checksum = `3`
   (sum-of-first-15 **mod 255**). Generated and verified rather than typed by hand.
6. **Expect a 16-byte notification whose first byte is `0x03`.**

**Step 6 is the gate.** One round trip proves the transport, the framing and the checksum
convention together. If it returns nothing, or returns something that is not 16 bytes, the R09 is
not in the R02 protocol family and Phases 1+ are void — **stop and re-plan rather than guessing at
command bytes**.

> **Why mod 255 and not 256 is worth care.** For the battery packet they agree (both give `3`), so
> that probe cannot distinguish them. They diverge as soon as the bytes sum past 255: a payload
> summing to `0x1FE` is `0` under mod 255 and `254` under mod 256. Every published client says 255.
> A decoder that assumes 256 passes Phase 0 and then fails on roughly half of all real commands.

### Phase 1 — the pure protocol module · no device needed

`lib/colmi-ble/protocol.ts`: build a command, verify a checksum, parse an HR-log packet chain, parse
a step record. **Pure functions, no I/O**, mirroring the `PolarProtocol.kt` / `ScaleProtocol.kt`
split. Every decoder pinned to a captured packet hex as a test fixture, per the rule the Oura
pipeline already follows. This is fully unit-testable in the sandbox and is where the protocol risk
actually gets retired.

### Phase 2 — storage · **Lane A owns the migration**

Two tables, `colmi_raw_packets` (archival hex, so a later decoder fix can re-parse without
re-draining the ring) and `colmi_readings` (decoded HR / steps). Both `user_id`-scoped.

> **Handoff, per `CLAUDE.md`:** Postgres migration numbers belong to Implementation **Lane A**
> alone. This session is a one-off (`PS-`) and deliberately did not claim one. Next free is **231**
> as of 2026-08-26, and it must be re-checked against the pointer at claim time.

### Phase 3 — sync + pairing card

`lib/colmi-ble/sync.ts` (set time → pull HR log → pull step log → store) and a pairing card under
`components/settings/`, copying `chest-strap-pairing.tsx`. A new route `app/api/colmi/samples`.
**It must not reuse `app/api/hr-ingest`** — that route hardcodes `source: 'chest_strap'` and writes
`oura_heartrate`, which is precisely the table §1 says to stay out of.

### Phase 4 — the comparison report

One adapter for `lib/oura-comparison-harness.ts`, which already merges two bucketed series and
reports within-tolerance counts and mean absolute delta;
`components/oura-ble/comparison-harness-console.tsx` already renders it. The adapter is the
`ringVsH10HrAdapter` pattern with one side re-pointed — roughly 40 lines. **Build nothing new for
scoring.** This is the sanctioned reader of the Colmi tables and the only one.

### Phase 5 — wear the thing (14 days)

- **Opposite hands.** Fine for HR and HRV. **Not** fine for steps — dominant-hand bias is real.
  Record which ring is on which hand.
- **Swap hands at day 7.** Separates *device* bias from *hand* bias. Without the swap a step-count
  gap is uninterpretable.
- **Wear the Polar H10 for ≥3 workouts.** It is the only real HR ground truth here and the harness
  already scores against it. Ring-vs-ring says they disagree; ring-vs-strap says which is wrong.
- **14 nights minimum before any conclusion.** `CLAUDE.md` records a documented false conclusion
  drawn from a pooled correlation where the honest per-version signal was n=11.
- **Re-read the firmware at the end.** A silent update mid-trial splits the data across two devices
  — the same `model_version` trap the repo already has a rule about.

### Phase 6 — sleep · not queued

Needs the Gadgetbridge port. Worth doing only if Phase 5 says the HR is credible: a sleep stage
derived from a bad PPG will not be better than the PPG.

---

## 7. Promotion — what it would take, and why it is not now

If the report says the ring is good, promotion is a **separate, deliberate PR** that:

1. adds `colmi_ble` to `HEALTH_SOURCES` at a chosen rank (below `oura_ble` for a second-opinion
   role; the ladder needs no migration — the map is JSONB and the ranks are TypeScript);
2. removes `colmi` from `LEARNING_MODE` in `scripts/check-learning-mode-isolation.js`, **which is
   the change that makes the guard stop failing** — the audit trail is built in;
3. handles `oura_heartrate` explicitly, since that table has no per-field merge at all: bare `text`
   source, `(user_id, timestamp)` unique, `onConflictDoNothing`. Two rings emitting on the same
   second is first-writer-wins **permanently**. `preferStrapBuckets` would need a real precedence
   rule rather than its current allowlist-of-one.

Item 3 is the genuinely hard one and is the reason promotion is not a footnote to this plan.

---

## 8. The one irreversible step: do not flash the mod firmware

A `R02_3.00.06_FasterRawValuesMOD.bin` circulates that raises the raw-streaming rate, and Edge
Impulse's data-collection example calls upgrading "highly recommended" for raw capture. Raw
accelerometer and PPG are exactly what
[`device-agnostic-source-architecture.md`](../../device-agnostic-source-architecture.md) means by a
**raw-capable** (tier-1) source, so it is genuinely tempting.

**Not in this plan.** It is the only step in the entire arc that can brick the device, and it would
be taken *before* knowing whether the sensor is worth streaming from. Phase 5's numbers are what
justify it or don't. If they do, it is a separate owner decision with its own write-up.

Until then the Colmi is a **computed source** — it hands us finished HR and steps — which puts it in
the right-hand column beside Health Connect, not beside the Oura.

---

## 9. Open questions

1. ~~**Is the ring already paired to the QRing/Colmi vendor app?**~~ **Answered 2026-08-26 — no.
   The ring is factory-fresh and no software has been installed.** Best case: full on-ring history,
   no connection contention, nothing to undo. Phase 0 is rewritten around that starting state.
2. **Does it fit the opposite hand's equivalent finger?** Phase 5's wear protocol depends on it, and
   sizing is fixed at purchase. Worth checking before the trial is planned around it.
3. **Does the R09 advertise the `6E40FFF0-…` service at all?** Phase 0c step 3 answers it. Until
   then, everything in §4 is an assumption inherited from a different model.

Only question 3 gates anything, and Phase 0 is how it gets answered.

---

## 10. What this plan does not claim

- No Colmi ring has connected to **this app**. The Phase 0 enumeration in §11 was done in nRF
  Connect, which proves the ring's GATT layout and nothing about our code.
- **The transport is measured; the protocol is not.** Service and characteristic UUIDs are confirmed
  on the owner's unit (§11), and §4 now comes from Gadgetbridge, which supports the R09 as a
  first-class device. **Nothing in §4 has been exercised against this ring**: no command has yet
  produced a reply (§11c). The plan's earlier mod-255 checksum claim was **wrong** and is corrected
  in §4b — read from a working implementation, not measured here either.
- **The pairing model is unresolved** (§11a). The address is a rotating type by its own bits and
  looks stable by every other sign; which it is decides whether Phase 3 copies the scale or the Oura.
- Sleep is not solved; it is known-solvable from a second codebase, which is not the same thing.
- The isolation guarantee in §2 is **verified for the paths named there** — the five scoring tables
  and the routes that read them. It was established by reading the code, and the guard freezes it.
  It has **not** been exercised against a running device, because no device exists yet.

## 11. Device record — Phase 0, run 2026-08-26

Read in nRF Connect on a factory-fresh ring. **No vendor app was ever installed.**

| | Value |
|---|---|
| Advertised name | `R09_C400` |
| BLE address | `31:37:41:30:C4:00` — **random, non-resolvable (see §11a)** |
| Hardware Revision (`0x2A27`) | `RT09_V3.1` |
| **Firmware Revision (`0x2A26`), trial start** | **`RT09_3.10.22_260420`** |
| Serial Number (`0x2A25`) | *empty* |
| System ID (`0x2A23`) | `00-C4-30-00-00-41-37-31` — the MAC reversed, `00-00` inserted (EUI-48→EUI-64) |
| `6E40FFF0-…` service present? | **yes** |
| RX `6E400002-…` | **present** — WRITE, WRITE NO RESPONSE |
| TX `6E400003-…` | **present** — NOTIFY, with CCCD `0x2902` |
| `0x03` round trip | **written, no reply** — see §11c |
| Firmware Revision, trial end | _not yet read_ |

**What this settles:** the R09 exposes the R02 family's transport exactly — same service UUID, same
RX/TX split, same properties. §3's "probably in the family, on the evidence of one fork" is now
measured at the transport layer. **What it does not settle:** framing, checksum convention and
command semantics. Those need the `0x03` round trip, and until it runs every byte in §4 is still
inherited from a different model.

### 11a. The address is a rotating type — this breaks the assumed pairing pattern

`31:37:41:30:C4:00` is not a valid public address: bit 0 of the first octet (`0x31` = `00110001`) is
the multicast bit and it is **set**. As a *random* address its top two bits are `00`, which is
**non-resolvable private** — the kind that rotates.

That matters because Phase 3 assumed the scale/strap pattern. It cannot be assumed now:

| device | address | how pairing persists |
|---|---|---|
| Renpho scale | stable MAC | `lib/scale-ble/paired-scale.ts` stores `deviceId` in `localStorage` |
| Polar H10 | stable public MAC | `lib/live-hr/paired-strap.ts`, same shape |
| Oura Ring 5 | rotating RPA | **scan by name / manufacturer id, never by MAC** |
| **Colmi R09** | **rotating by type, stable by evidence** | **undecided — see the test below** |

The counter-evidence is strong enough not to conclude yet: the advertised name `R09_C400` encodes
the address tail `C4:00`, and the System ID characteristic embeds the whole address. A vendor does
not usually bake a rotating address into a static characteristic.

**Free test, and it must be run before Phase 3 is designed:** re-scan tomorrow, after a
Bluetooth toggle and after the ring has been off the phone for some hours. Same address → treat it
as stable and copy `paired-scale.ts`. Different address → the ring is scanned by name like the Oura,
and a stored `deviceId` would silently stop resolving after a day. **Record the result here.**
Getting this wrong produces a pairing that works all afternoon and is dead the next morning.

### 11b. Two services no client documents

Beyond `6E40FFF0-…` and the standard `0x1800`/`0x1801`/`0x180A`, the ring exposes:

- **`de5bf728-d711-4e47-af26-65e3012a5dc7`** — **enumerated 2026-08-26**: `de5bf72a` (WRITE, WRITE
  NO RESPONSE) and `de5bf729` (NOTIFY + CCCD). Identified in the ATC RF03 and Colmi R02/R03/R06 work
  as a **Serial Port Service**. It is in none of the clients surveyed in §3/§4, and it is now a
  prime suspect for why the ring answers nothing on `6E40FFF0-…` — see §11c candidate 2.
- **`0xFEE7`** — Telink's OTA firmware-update service. This is the channel a firmware flash would
  go through, including the mod firmware §8 says to stay away from. **Do not write to it at all.**
  Noting it because knowing where the loaded gun is kept is the point of an enumeration pass.
- `0x1812` (HID) — the ring can present as a Human Interface Device, which is how these rings do
  camera-shutter/gesture control. Irrelevant to this plan; recorded so it is not rediscovered as a
  mystery.

### 11c. The `0x03` write lands and the ring does not answer — 2026-08-26

Observed in nRF Connect: notifications enabled on TX (`0x2902` reads *"Notifications enabled"*),
`03000000000000000000000000000003` written to RX and echoed back in its Value field, **and TX never
produced a Value at all.** Repeated; no reply either time.

**The checksum convention is not the cause and cannot be.** For `0x03` with a zero payload the sum
is 3, and 3 is 3 under both mod 255 and mod 256. Whatever is wrong here, it is not that.

**What the ring is NOT is broken.** Gadgetbridge supports the **R09 specifically** —
[issue #4491](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/4491) is a user running one
with every sensor working, temperature included, on a nightly build. So a working open-source
implementation of this exact model exists, which relocates the problem from "is the R09 in the
protocol family" to "how are we poking it". That is a much better problem.

**Ranked candidates:**

1. **Write type.** RX advertises WRITE *and* WRITE NO RESPONSE. nRF's Write-value dialog hides the
   selector behind its **Advanced** expander and defaults to Write Request. Several of these rings
   only act on Write Command. **Cheapest test, try first.**
2. **Wrong service.** The ring also exposes `de5bf728-d711-4e47-af26-65e3012a5dc7` — identified in
   the ATC RF03 and Colmi R02/R03/R06 work as a **Serial Port Service**, with `de5bf72a` (write) and
   `de5bf729` (notify). The `RT09_*` firmware line is not the `R02_3.00.x` line the published
   clients were written against, so `6E40FFF0-…` may be vestigial here and the serial service live.
   **Enable notify on `de5bf729`, write the same packet to `de5bf72a`.**
3. **A required handshake.** The ring may answer nothing until its clock is set (`0x01`) or some
   enable packet is sent. Plausible on a ring that has never been paired to anything.
4. **Power gating.** These rings sleep their radio/sensors when idle, like the Oura. Less likely to
   suppress a battery reply, but worn-and-moving or on-charger is a free thing to vary.

**The decisive diagnostic is `0x10` — blink twice.** `CMD_BLINK_TWICE = 16` in the reference client;
the packet is:

```
10000000000000000000000000000010
```

It produces **physical feedback from the ring itself**, which separates the two failure modes that
otherwise look identical: *the ring is not accepting our commands* versus *the ring accepts them and
we are not receiving its replies*. If the ring blinks, the command channel works and only the notify
path is broken. If it does not blink under either write type on either service, nothing is getting
through and the framing is wrong for this firmware.

### 11c-resolved. Why the probes got nothing — read from the working client

Gadgetbridge's source (§4) answers three of §11c's four candidates without another probe:

- **Write type is NOT the cause.** Gadgetbridge calls `builder.write(characteristic, contents)` —
  Android's default write type, a Write **Request**. That is what was already being sent. Candidate 1
  is eliminated.
- **Checksum is NOT the cause**, and could not have been: `0x03` and `0x10` sum below 255, where both
  conventions agree. (It *was* wrong in the plan — see §4b — just not wrong in a way that mattered
  here.)
- **`0x10` is probably not a command this firmware knows.** Gadgetbridge has no `0x10`; its
  blink-the-ring command is **`0x50` FIND_DEVICE**. So the blink probe failing tells us nothing about
  the channel — it was very likely an unknown opcode.
- **Candidate 3 — a required handshake — is the surviving explanation**, and §4c shows its exact
  shape: subscribe to both notify characteristics, **wait 2 seconds**, then **phone name (`0x04`) →
  date/time (`0x01`) → preferences → battery**. Battery is what the working client asks for *last*.

**Next probe, in order, on V1 write `6e400002` with both notify characteristics subscribed** (the
checksums below are mod 256; every one of them sums under 255, so they are valid under either
convention):

| # | What | Hex |
|---|---|---|
| 1 | Phone name — the handshake | `04020a47420000000000000000000099` |
| 2 | Set date/time (2026-08-26 20:00:00 local, BCD) | `01260826200000000000000000000075` |
| 3 | Battery | `03000000000000000000000000000003` |
| 4 | Find device — should make the ring blink | `50000000000000000000000000000050` |

Send 1, wait a beat, then 2, then 3. If TX answers on `0x03` after the handshake, the channel is
proven and Phase 1 can start. **`0x50` is the new physical-feedback test**, replacing the `0x10`
that was never a real command.

Note the date/time encoding: `Byte.parseByte(String.valueOf(n), 16)` reads the *decimal* digits as
*hex*, i.e. BCD. Year is `now % 2000`, so 2026 → `0x26`. Adjust bytes 4–6 to the actual clock time
before sending; being a few minutes out is harmless for a probe and Gadgetbridge resets it anyway.

### 11c-exhausted. The handshake was sent and the ring still says nothing — 2026-08-26

Phone name (`04020a…99`) and find-device (`0x50`) both written to V1 RX with both notify
characteristics subscribed. No notification, no blink. **Every protocol-side explanation is now
eliminated from the working client's own source:**

| Candidate | Verdict | Evidence |
|---|---|---|
| Write type | eliminated | Gadgetbridge issues a plain Write Request |
| Checksum | eliminated | both conventions agree below 255 |
| Wrong service | eliminated | both V1 and V2 tried; Gadgetbridge uses both |
| Wrong opcode | eliminated | `0x04`/`0x50` are Gadgetbridge's own constants |
| **Bonding** | **eliminated** | `AbstractYawellRingCoordinator.getBondingStyle()` → **`BONDING_STYLE_NONE`** |
| **Device match** | **eliminated** | `ColmiR09Coordinator.getSupportedDeviceName()` → `Pattern.compile("R09_.*")`, and the ring is `R09_C400` |

**When every protocol hypothesis is dead, the remaining ones are about the device's state.** Two,
both cheap, and the second is a pattern this repo already documents for the Oura:

1. ~~**The ring may not be fully activated.**~~ **Eliminated — owner confirms it reached green on
   the charger before being taken off**, which is Colmi's stated first-activation condition. The
   ring is activated.
2. **The application MCU may be asleep — the only candidate still standing.** Every read that has succeeded — device info, the CCCD —
   is served by the **BLE stack**. Executing a command needs the **application processor**, and
   these rings power-gate it hard. `CLAUDE.md`'s Oura section records the same behaviour: *"The ring
   radio/PPG sleeps when worn-idle — wakes on charger, worn+moving, or during sleep."* A ring lying
   still on a desk is the worst case. **Put it on the charger, or wear it and move, then retry.**

**And read the nRF Connect log** — the floating button, bottom right. It timestamps every ATT
operation and shows write results and errors (`GATT ERROR`, status 133, etc.) that the Value line
does not. The Value field updates from what was *sent*; it is not proof of what the ring *accepted*.

**Stop hand-driving after this.** The remaining differences between nRF Connect and Gadgetbridge are
connection parameters, MTU negotiation, transaction sequencing and retry — precisely the things a
device-support class exists to get right and a manual GATT explorer does not attempt. Continuing to
poke by hand is now the expensive path to an answer §11d gets for free.

### 11d. Gadgetbridge is the reference implementation, and it should be installed next

Given #4491, the fastest way to settle framing, sleep, and temperature at once is to install
**Gadgetbridge** — open-source, no vendor cloud, no firmware push — and let it drive the ring.

What it buys, beyond confirming the hardware end to end:

- **Sleep and skin temperature**, which no surveyed Python client implements (§4). If the R09 yields
  those through Gadgetbridge, §4's "sleep is Phase 6, a port from a second codebase" is confirmed
  as achievable and Gadgetbridge becomes the source to port from.
- A working baseline to diff our own decoder against later.
- It sets the ring's clock, which has to happen regardless.

**Costs, stated plainly:** it will connect and sync, so it may consume some on-ring history buffer —
irrelevant on a ring with a day of data and nothing depending on it. It is reversible (uninstall).
It is **not** QRing and carries none of QRing's firmware-update exposure.

## Pickup prompt

Check out a branch from a freshly-fetched `main`. Read in order: `projectOverview.md`,
[`docs/domains/devices/README.md`](../../domains/devices/README.md), this plan, then
`lib/live-hr/chest-strap-source.ts` and `components/settings/chest-strap-pairing.tsx` — those two
are the working in-WebView BLE reference and Phases 1–3 are shaped like them.

**First concrete action: Phase 0 (§6), and it needs no code and no repo change.** The ring is
factory-fresh: charge it for an hour until the indicator goes green (it ships switched off), then
run the whole gate in **nRF Connect** — **not** QRing, which is the fallback and carries a firmware
-update risk. Scan, read `0x180A`, confirm the `6E40FFF0-…` service exists, then write
`03000000000000000000000000000003` to the RX characteristic and expect a 16-byte reply starting
`03`. **Record the model and firmware into §11 before doing anything else.** Do not write
`lib/colmi-ble/` before that round trip passes — the command bytes in §4 come from a client that
does not list the R09 as supported.

Constraints that will otherwise be rediscovered: this needs **no APK** (§5); the Colmi must write to
**none** of `oura_heartrate` / `body_metrics` / `sleep_sessions` / `oura_daily` /
`oura_daily_derived`, and `scripts/check-learning-mode-isolation.js` fails CI if it tries (§2); do
**not** add `colmi_ble` to `HEALTH_SOURCES`, because its absence is what makes a shared write a
compile error; the migration is **Lane A's** to number (§6 Phase 2); and the raw-streaming mod
firmware is out of scope (§8). Backlog entry PS-8.

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

So the R09 is *probably* in the R02 protocol family, on the evidence of one fork. That is enough to
start and not enough to build on. **Phase 0 is more important than it was, not less** — it is now
the step that converts "probably" into "measured".

---

## 4. Protocol, quoted rather than remembered

Per `CLAUDE.md`'s external-field rule. Fetched 2026-08-26 from the clients named above.

**Transport** — a Nordic-UART-shaped custom service:

| | UUID |
|---|---|
| Service | `6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E` |
| RX (we write) | `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` |
| TX (we subscribe) | `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` |

**Framing** — fixed 16 bytes both directions. Byte 0 = command, bytes 1–14 = payload, byte 15 =
checksum: the sum of the first 15 bytes **modulo 255**. Note 255, not 256 — that is what the source
says, and assuming 256 fails every write silently.

| Command | Byte | Notes |
|---|---|---|
| Set time | `0x01` | the ring's clock is what every log timestamp is relative to — **send this first** |
| Battery | `0x03` | request and response share the tag |
| Read HR log | `0x15` (21) | multi-packet: sub-type 0 = header (packet count + interval), sub-type 1 carries a little-endian `<l` unix timestamp then 9 values, sub-types 2+ carry 13 each, sub-type 23 terminates, `0xFF` = no data |
| Read steps | `0x43` (67) | per-day, `day_offset` from the ring clock; records are steps / calories / distance-m keyed to a 15-min `time_index` |
| Start real-time | `0x69` (105) | + reading type + action |
| Stop real-time | `0x6A` (106) | + reading type |
| Reading types | | HR `1`, blood pressure `2`, SpO2 `3`, fatigue `4`, ECG `7`, HRV `10` |
| Actions | | start `1`, pause `2`, continue `3`, stop `4` |

**Not implemented in either client: sleep, SpO2 logs, raw accelerometer, raw PPG.** Gadgetbridge
implements Colmi sleep sync from a separate Wireshark dissection of the vendor app — known-possible,
from a second codebase, and therefore a port rather than a copy. That is Phase 6.

---

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

- No Colmi ring has connected to this app. Every byte in §4 comes from someone else's repository,
  and the R09 is not on the reference client's own compatibility list.
- The framing, checksum and command bytes are **unverified on hardware**.
- Sleep is not solved; it is known-solvable from a second codebase, which is not the same thing.
- The isolation guarantee in §2 is **verified for the paths named there** — the five scoring tables
  and the routes that read them. It was established by reading the code, and the guard freezes it.
  It has **not** been exercised against a running device, because no device exists yet.

## 11. Device record — fill this in during Phase 0

Left deliberately empty. A protocol discrepancy six weeks from now is diagnosed against these
values, and a firmware string that was never written down is a firmware string nobody has.

| | Value | When |
|---|---|---|
| Model (from `0x180A`) | _not yet read_ | |
| Firmware revision, trial start | _not yet read_ | |
| Firmware revision, trial end | _not yet read_ | |
| Advertised name | _not yet read_ | |
| `6E40FFF0-…` service present? | _not yet checked_ | |
| `0x03` round trip | _not yet run_ | |

---

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

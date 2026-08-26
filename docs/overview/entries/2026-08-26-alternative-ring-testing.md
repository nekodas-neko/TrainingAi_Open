# 2026-08-26 — The Colmi R09 in learning mode, and the guard that makes it true (PS-8)

**Branch:** `claude/alternative-ring-testing-jzk8el` · one-off session · plan + one CI check, no
integration code

The owner acquired a Colmi R09 and asked for a deployment plan plus a guarantee: *"are we sure its
data will be read only and wont affect scoring of anything I have going? I basically just want to
ingest the data in a 'learning' mode state."*

## The finding that shaped the design

**The obvious isolation mechanism does not work.** Ranking `colmi_ble` below `oura_ble` in
`HEALTH_SOURCES` would make the per-field merge refuse to let it overwrite an Oura value — and would
not stop it being read. Every scoring read in the app is source-blind:

- `getHrForWindow` (`lib/data/postgres/slices/oura.ts:743`) selects `oura_heartrate` with **no
  source predicate** and hands the rows to `preferStrapBuckets`, which is an **allowlist of exactly
  one value** (`chest_strap`) with everything else falling through untouched. A row stamped
  `colmi_ble` would feed the readiness payload and the body-battery window directly.
- `listBodyMetrics` / `listSleepSessions` / `getOuraDaily` / `getOuraDailyDerived` read whole rows.
  `source_map` is per-field *write* provenance; no read consults it.

Repo-wide, two reads filter `oura_heartrate` by source and both are deliberate (the rollup's `'ble'`
and the comparison adapter). **A row in a shared table is a scored row however it is stamped.** So
isolation has to come from the data never entering those five tables — `oura_heartrate`,
`body_metrics`, `sleep_sessions`, `oura_daily`, `oura_daily_derived`.

## The strongest layer is an omission

Every shared-table write takes `source: HealthSource`, a closed union built from the
`HEALTH_SOURCES` tuple. **Not adding `colmi_ble` to that tuple makes a Colmi write to any shared
table a compile error.** The protection comes from the ladder entry being absent, which means adding
it "just for provenance" is exactly the change that removes the guarantee. Worth stating in the plan
so nobody helpfully adds it later.

## What shipped

`scripts/check-learning-mode-isolation.js`, wired into the Custom Rules job, empty baseline. It
fails on a learning-mode module naming a scoring table or calling a shared writer, on any import
outside its own directory except the comparison adapters, on `colmi` appearing in `HEALTH_SOURCES`,
and on `colmi` appearing in any scoring input.

**It was landed before the integration on purpose** — a guard written after the code is a guard that
can be argued with, and promotion out of learning mode now has to delete a line from this script and
show up in a diff.

**Its first draft was wrong and a probe caught it.** Copying `check-aest-midnight-timezone.js`, it
blanked string bodies as well as comments — so a ladder that *had* been given `'colmi_ble'` passed
silently, and the leak that matters most (a raw ``sql`INSERT INTO oura_heartrate …` `` inside a
string) would have been invisible. It strips comments only now. All four violation shapes were
probed failing, then the tree restored and re-probed clean.

## The R09 specifically

The reference client `tahnok/colmi_r02_client` lists **R02/R06/R10** — the R09 is **not** on it.
A fork (`patmorli/colmi-r09-smart-ring`) targets the R09 and reports the same UUIDs, the same
16-byte framing with a **mod-255** checksum, and the same feature set. That is enough to start and
not enough to build on, which makes Phase 0 — one `0x03` round trip proving transport, framing and
checksum together — the gate rather than a formality.

Sleep is in neither client. Gadgetbridge has it from a separate Wireshark dissection: a port, not a
copy, and Phase 6.

## Phase 0 rewritten for a factory-fresh ring

The owner confirmed no software of any kind is installed. That answers the plan's first open
question in the best way — full on-ring history, nothing holding the BLE connection, nothing to
undo — and it moved two facts into Phase 0 that were not there before.

**The ring ships switched off.** Colmi's FAQ says to charge *"more than 1 hour until the charging
indicator turns green"* to activate it for the first time. Until then it does not advertise, so a
scan finding nothing proves nothing.

**The gate now runs in nRF Connect, not QRing.** Colmi's support material claims the vendor app is
required and that pairing cannot be done outside it; that is a statement about their supported flow,
not a hardware lock — `colmi_r02_client` connects directly with `bleak` and Gadgetbridge exists to
replace the app. A generic GATT explorer pushes no firmware, syncs nothing, consumes no on-ring
history, and settles the entire gate **without a line of code or a repo change** — which also means
a failure there is unambiguously the ring or the model rather than our decoder. QRing is the
fallback if the ring will not advertise after a full charge, with its firmware-update prompt
declined and the app removed afterwards.

The probe packet is generated rather than typed: `03000000000000000000000000000003` (byte 0 `0x03`,
bytes 1–14 zero, byte 15 = sum-of-first-15 **mod 255** = 3). **The battery packet cannot distinguish
mod 255 from mod 256** — both give 3 — so the plan says so explicitly: they diverge once the bytes
sum past 255 (`0x1FE` → 0 vs 254), and a decoder that assumes 256 passes Phase 0 and fails on about
half of all real commands.

§11 of the plan is an empty device record to fill in during Phase 0. A firmware string that was
never written down is a firmware string nobody has, and re-reading it at the end of the trial is how
a silent mid-trial update gets caught.

## Phase 0 ran — transport confirmed, two surprises

Enumerated on the owner's factory-fresh unit in nRF Connect, no vendor app ever installed.
`R09_C400`, hardware `RT09_V3.1`, firmware `RT09_3.10.22_260420`. Service
`6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E` is present with RX `6E400002` (WRITE / WRITE NO RESPONSE) and
TX `6E400003` (NOTIFY + CCCD `0x2902`) — the R02 family's transport exactly. The biggest unknown
about the R09 is settled at the transport layer. **The `0x03` round trip has not run**, so the
framing and mod-255 checksum remain inherited from a client that does not list this model.

**The ring's address is a rotating type, which breaks the pairing pattern the plan assumed.**
`31:37:41:30:C4:00` has the multicast bit set in its first octet, so it is not a valid public
address; as a random address its top two bits are `00` — non-resolvable private, the rotating kind.
Phase 3 had assumed the scale/strap shape, where a `deviceId` is persisted to `localStorage` because
the MAC is stable. The Oura ring is the counter-example already in the repo: rotating RPA, scanned
by name, never by MAC.

It is not conclusive either way — the advertised name encodes the address tail `C4:00` and the
System ID characteristic embeds the whole address, and vendors do not usually bake a rotating
address into a static characteristic. The test is free (re-scan after a day and a Bluetooth toggle)
and it has to happen before pairing is designed, because the failure mode is a pairing that works
all afternoon and is dead the next morning.

**Two services no surveyed client documents:** `de5bf728-d711-4e47-af26-65e3012a5dc7`, a plausible
candidate for the raw/big-data channel behind §4's missing sleep and PPG paths, and `0xFEE7` —
Telink's OTA service, which is the firmware-flash path the mod-firmware rule says to stay away from.
Recorded because knowing where that one lives is the point of an enumeration pass.

## The ring accepts the write and answers nothing

Notifications confirmed enabled on TX, `03000000000000000000000000000003` written to RX and echoed
in its Value field, TX silent. Twice.

**The checksum convention is ruled out and could never have been the cause here** — `0x03` with a
zero payload sums to 3, and 3 is 3 under both mod 255 and mod 256. The one distinction the plan went
out of its way to be careful about is the one thing this probe cannot test, which is worth noticing
about probe design rather than about the ring.

**The R09 is known-good.** [Gadgetbridge #4491](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/4491)
is a user running this exact model with every sensor working, temperature included. So the question
moved from *is the R09 in the protocol family* to *how are we poking it*, which is a much better
question to have.

Ranked suspects in §11c: the write type (RX advertises WRITE and WRITE NO RESPONSE; nRF defaults to
Write Request and hides the selector under **Advanced**); the **Serial Port Service** `de5bf728`,
whose `de5bf72a`/`de5bf729` pair the `RT09_*` firmware line may use instead of `6E40FFF0-…`; a
required handshake; radio power-gating.

The diagnostic that actually separates the failure modes is **`0x10` blink-twice**, because the ring
answers it physically. A blink means the command channel works and only the notify path is broken;
no blink under either write type on either service means nothing is getting through at all.

**Next step is Gadgetbridge, not more nRF poking.** It is open-source, pushes no firmware, and
already works on this model — so it settles framing end-to-end and, if it produces sleep and skin
temperature here, both confirms §4's Phase 6 is achievable and names the codebase to port from.

## Reading the working client settled it, and corrected the plan

The R09 turns out to be a **first-class Gadgetbridge device** — `ColmiR09Coordinator.java`, under the
`yawell` OEM namespace. Reading `YawellRingConstants.java` and `YawellRingDeviceSupport.java`
answered the silence and overturned three things the plan had asserted.

**The checksum is mod 256, not mod 255.** `buildPacket` accumulates `(byte)(checksum + content) &
0xff`. Every Python client says 255, this plan repeated it, and went out of its way to warn that
assuming 256 would fail on half of all commands. Backwards. The two agree below 255 — including
every probe run so far — and diverge above it. The correction is §4b, and the lesson is the repo's
own rule: pin the decoder to a captured vector, not to either claim.

**There are two protocol versions and the ring speaks both.** V1 `6e40fff0` carries the 16-byte
commands; V2 `de5bf728` carries "big data". Gadgetbridge registers both services and subscribes to
both notify characteristics on connect. So §11b's unknown second service is answered — and it is
where **sleep and skin temperature** live, as CRC16-Modbus, length-prefixed, multi-packet payloads.
A different integrity scheme from V1's, in the same device.

That moves sleep from "known-solvable from a second codebase" to solved-on-paper: command `0xbc`,
type `0x27`, stages light/deep/REM/awake as `0x02`/`0x03`/`0x04`/`0x05`. Temperature comes with it
(`0x25`), which neither the Oura BLE pipeline nor any Python client provides.

**Why nothing answered.** Write type eliminated — Gadgetbridge issues a plain Write Request, which
is what was already being sent. Checksum eliminated — both conventions agree on these payloads.
And `0x10` blink-twice **is not a command in this firmware**; Gadgetbridge's equivalent is `0x50`
FIND_DEVICE, so that probe was very likely an unknown opcode and told us nothing. What survives is
the **connect handshake**: subscribe both notify characteristics, wait two seconds, then phone name
`0x04` → date/time `0x01` → preferences → **battery last**. A bare battery request on a fresh
connection is not what the working client does.

## Deployment shape

No APK. `lib/live-hr/chest-strap-source.ts` already does the full BLE cycle in TypeScript in the
WebView, and the Colmi logs internally so it syncs on app open like the scale rather than needing a
foreground service like the Oura. Ships via Railway; **no uninstall risk to the Oura ring key**.

The migration (Phase 2) was deliberately **not** claimed — Postgres numbers belong to Lane A, and
this was a `PS-` session. Next free was 231.

## Files

- `scripts/check-learning-mode-isolation.js` + `.github/workflows/ci.yml` — the guard
- `docs/superpowers/plans/2026-08-26-alternative-ring-colmi-testing.md` — the deployment plan
- `docs/implementation-backlog.md` — PS-8, `Gate: device`
- `docs/module-map.md` · `docs/domains/devices/README.md` — index rows

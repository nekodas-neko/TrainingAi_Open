# Oura Ring — Direct BLE Ingestion (Feasibility & Approach)

> **⚡ UPDATE 2026-07-07 — Phase 0 PASSED.** The desktop-CLI hardware spike below (§7)
> was executed on the actual Ring 5. Auth, **reset/re-key (the crux — §3.3 Option A,
> confirmed)**, incremental history sync, and ~100% event decode all passed; live-HR and
> overnight sleep/SpO₂ remain open. Full results, **all deviations found from stock
> open_oura**, the decoded data structures, the connection-stability verdict, and the
> next-build checklist are in
> **`docs/superpowers/plans/2026-07-07-oura-direct-ble-phase-0-results.md`** — read that
> alongside this doc; it resolves several open questions in §6/§8 below.
>
> **Status:** R&D / feasibility analysis, not a ready-to-build plan. This is a
> single-user (owner-only) investigation into reading the Oura Ring 5 **directly
> over Bluetooth LE** — bypassing the Oura Cloud API and the official app — to land
> raw sensor data in our DB and run **our own** readiness/sleep/recovery analysis on
> it. It does **not** authorise implementation; it defines what's true, what's
> unknown, and the cheapest order to de-risk it. Reference project:
> [`Th0rgal/open_oura`](https://github.com/Th0rgal/open_oura) (Rust, Ring 3/4/5).

**Date:** 2026-07-06
**Owner runtime:** Samsung S25 Ultra, Oura Ring 5. APK-only is the canonical target
(see `2026-07-06-apk-canonical-target-dual-path-tax.md`), which this direction fits.
**Protocol knowledge base:** the `oura-native-ble` skill
(`.agents/skills/oura-native-ble/SKILL.md`) — the full distilled read of `open_oura`
(GATT, auth, framing, commands, event decoding, feature-enabling, sync, the three
compute tiers, firmware/maintenance, and the Rust→Kotlin porting map). Read it before
any implementation work.

---

## 1. Why this is even worth considering

Our current Oura integration (`lib/oura/`, `app/api/oura/*`) reads the **Cloud API**,
which only ever returns **daily rollups**, "available the morning after," and only
after the **official Oura app** has synced the ring to Oura's servers over BLE. Two
structural limitations fall out of that:

1. **No raw data.** We get one readiness score, one HRV number, aggregated MET
   minutes per day. The richer signal — beat-to-beat intervals, the PPG waveform,
   continuous temperature, motion — never leaves the ring in any form the API exposes.
2. **Hard dependency on the official app.** The ring has no WiFi/cellular; it only
   uploads when the official app connects to it. That is precisely why "open Oura
   first in the morning" is required before our data is fresh.

The ring's **BLE history-event stream** carries the raw samples the cloud hides:
`open_oura` documents it as *"raw PPG/IBI/temperature/motion/SpO2 samples plus the
ring's on-device sleep stages, activity MET levels, and HRV."* For an owner-only app
whose explicit goal is **our own analysis on rich data, no black box**, that is a
materially better dataset than the Cloud API can ever provide. This doc treats that
as the motivating win and asks what it costs.

**Scope boundary (important):** direct-BLE is a poor fit for **live HR during hard
exercise** — the ring's finger PPG is motion-noisy, which is why even Oura's own live
workout feature pairs an *external* strap for HR. Live training HR should stay a
**separate track** (a standard BLE chest strap/watch via a Capacitor BLE plugin, HR
Service `0x180D`). This doc is about **rich resting/recovery/sleep data + on-demand
sync**, not live running HR. Keep the two tracks separate.

---

## 2. What the ring exposes over BLE (data inventory)

Per `open_oura`'s `docs/` (`native-decoder.md`, `data-recovery-map.md`,
`ring-5-observations.md`) and README:

| Capability | Over BLE (direct) | Cloud API (today) |
|---|---|---|
| Raw PPG waveform | ✅ | ❌ |
| Beat-to-beat IBI | ✅ | ❌ (only avg HR / avg HRV/day) |
| Continuous skin temperature | ✅ | ❌ (only daily deviation) |
| Accelerometer / motion | ✅ | ❌ |
| SpO₂ samples | ✅ | ⚠️ daily average only |
| On-ring sleep stages | ✅ | ✅ (daily) |
| On-ring activity MET levels | ✅ | ⚠️ aggregated |
| HRV (rMSSD) | ✅ (samples) | ⚠️ daily |
| Live HR / SpO₂ (at rest) | ✅ | ❌ |
| Battery, device info | ✅ | ❌ |
| **0–100 Readiness/Sleep/Activity/Stress scores** | ⚠️ only via Oura's proprietary PyTorch models | ✅ (pre-computed) |
| **Automatic workout *classification*** | ❌ (cloud-only) | ✅ |

**The only things the Cloud API gives that direct-BLE does not are the two *computed*
outputs at the bottom: the polished scores and workout type-labelling.** Everything
else the ring holds locally, at higher resolution. Since we are explicitly building
**our own** scores (§5), the scores gap is a non-issue by design — we don't want
Oura's black box. Automatic workout classification is the one genuine loss; we can
either live without it or derive our own from raw motion + HR later.

---

## 3. Feasibility of the protocol (what's actually known)

`open_oura` has reverse-engineered and **documented** (not just coded) the protocol.
This is the single biggest de-risking fact: a port translates specs, not guesswork.

### 3.1 BLE GATT map (from `docs/android-app-reversing.md`)
- **Ring service:** `98ED0001-A541-11E4-B6A0-0002A5D5C51B`
- **Write characteristic:** `98ED0002-…`
- **Read/notify characteristic:** `98ED0003-…`
- **Manufacturer ID:** `0x02b2` (used to identify Oura rings during scan)
- Ring 3/4/5 share GATT layout, packet framing, and the auth flow.

### 3.2 Auth handshake (per connection)
The ring requires a **16-byte auth key**, re-authenticated every connection:
1. **GetAuthNonce** — write `2f012b`; ring returns a **15-byte nonce** (bytes `[3,18)`).
2. **Encrypt nonce** — `AES/ECB/PKCS5Padding` with the 16-byte `authKey` → 16 bytes.
3. **Authenticate** — write `2f112d` + the 16 encrypted bytes; success byte at index 3.
4. (**SetAuthKey** — write `2410` + 16-byte key — lets you *set your own* key on a
   reset ring; success `0x00` at index 2.)

All standard, reproducible crypto (`javax.crypto.Cipher` on Android). No exotic
primitives. This is the well-understood part.

### 3.3 Getting the auth key — three options, in order of preference for us
- **(A) Reset + onboard with our own key (cleanest).** Factory-reset the ring, run
  the onboarding/SetAuthKey ourselves, and we own a known 16-byte key. No extraction,
  no root. **Cost:** the official app/Cloud API are abandoned for this ring (nothing
  syncs them anymore) — acceptable for an owner-only, self-sufficient app, but it is a
  one-way door until re-onboarded to Oura.
- **(B) Extract from the official app's Realm DB.** Key lives at
  `DbRingConfiguration.authKey` (serialized `auth_key`). Needs filesystem access to
  the app's private data → **rooted phone** (ADB backup is typically disabled by the
  app). Lets the official app keep working in parallel *in principle*, but see §6 BLE
  contention.
- **(C) Sniff during a fresh onboarding** (Ubertooth/HCI snoop). Most fiddly; only if
  A and B are undesirable.

**Recommendation:** Option A. It matches "owner-only, our own analysis, no Oura
dependency," and needs neither root nor a BLE sniffer. Confirm the ring can be
re-onboarded back to Oura later if we ever want the official app again.

### 3.4 History-event stream & decoders
The request/paginate flow and event-body layout are documented in
`docs/native-decoder.md` and `docs/horizon-ring3-protocol-cheatsheet.md`, with the
canonical decoders in the **`oura-protocol`** crate. This is the **bulk of the port
work** — the auth is small; the event decoders (many event types, packed binary) are
where the real Kotlin translation effort lives. Treat `oura-protocol` +
`native-decoder.md` as the source of truth to port.

### 3.5 Crate map (what to port from)
| `open_oura` crate | Role | Port relevance |
|---|---|---|
| `oura-protocol` | BLE protocol + event decoding | **port to Kotlin** (the core) |
| `oura-link` | BLE fetch/sync orchestration | reference for sync recipes (`docs/sync-orchestration.md`) |
| `oura-analysis` | reimplemented metrics/scoring | **reference for our own formulas** (§5) |
| `oura-store` | SQLite storage | replaced by our local store + Postgres |
| `oura-cli` | CLI | replaced by our plugin API |

---

## 4. Architecture for *this* app

The hard part is **not** "write a Capacitor plugin" (scaffold is trivial). It is
**porting `oura-protocol`'s auth + event decoders from Rust to Kotlin** inside that
plugin, because there is no Android/JS port in existence today. APK-only helps: once
the shell is bundled natively, a BLE plugin with a **foreground service** is a
first-class citizen that can hold the ring connection and parse in the background.

```
┌─────────────────────────────────────────────────────────┐
│ Native Android (Kotlin) — new Capacitor plugin           │
│  • BLE scan (manufacturer 0x02b2) + connect               │
│  • Auth handshake (AES/ECB, our own key)                  │
│  • History-event stream reader + event decoders           │  ← ported oura-protocol
│  • Foreground service for background pulls                 │
└───────────────┬──────────────────────────────────────────┘
                │ decoded raw samples (JSON/typed events)
                ▼
┌─────────────────────────────────────────────────────────┐
│ JS/TS bridge → local SQLite store + outbox                │
│  • new local table: oura_raw_samples (+ event tables)     │
│  • queueMutation → pushMutations → Postgres (backup/sync) │  ← existing offline-first spine
└───────────────┬──────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────┐
│ Postgres: oura_raw_samples (+ derived tables)             │
│ Our own analysis (lib/health/*): readiness, sleep, etc.   │  ← §5
└─────────────────────────────────────────────────────────┘
```

This reuses the offline-first spine wholesale — the plugin is just a **new write
source** feeding the same `store.upsertX` + `queueMutation` → `pushMutations` path
every other domain uses. No new sync philosophy; a new raw-samples domain added per
the CLAUDE.md offline-sync checklist (local table holds enough to render/analyse
offline, `getSyncDelta`/`pullDelta`/`applyDelta` all cover it).

**New data model (sketch):** a high-volume `oura_raw_samples` table (timestamped
typed samples: hr/ibi/temp/motion/spo2) plus decoded session tables. Raw sample
volume is large — needs a retention policy from day one (reuse the
`retention-throttle.ts` pattern already used for `oura_heartrate`). Do **not** try to
force raw samples through the existing daily-rollup tables; it's a new domain.

---

## 5. Our own analysis — replacing the black box

This is the part that makes the whole thing coherent, and it **deletes the ugliest
dependency** (Oura's proprietary, gitignored PyTorch models — we never touch them).

- **`open_oura`'s `oura-analysis` crate + `docs/algorithms/README.md`** already
  reimplement the ring's on-device metrics from raw inputs. That is a reference for
  *how* to turn IBI/temp/motion into HRV, sleep staging, and readiness-like scores —
  not something to copy blindly, but a strong starting point.
- Our formulas live **once** in `lib/` per the One-Formula-One-Place rule (e.g.
  `lib/health/readiness.ts`, `lib/health/sleep-score.ts`), computed server-side from
  `oura_raw_samples`, and consumed by the UI as interpretations (never re-banded
  client-side). This slots into the existing `lib/health/score-band.ts` conventions.
- Because we own the inputs *and* the math, "readiness" can finally blend **our**
  tracked data (training load / ACWR from `computeVolumeAcwr`, logged RPE, sleep) with
  ring biometrics — the thing the Cloud score structurally can't do.

**Consequence:** in a full direct-BLE world we need the Cloud API for **nothing**
except optional workout classification. And since going direct-BLE via Option A stops
feeding Oura's cloud anyway, "keep the Cloud API as backup" is not really on the table
— it's close to all-or-nothing. Decide that consciously (see §7).

---

## 6. Risks, unknowns, and honesty

- **BLE single-central contention.** A ring generally holds one BLE connection at a
  time. If we keep the official app (Option B), the two will fight for the ring. Option
  A (own the ring, drop the official app) sidesteps this but is all-or-nothing.
- **Firmware fragility.** Reverse-engineered protocol with no stability guarantee; an
  Oura firmware update can shift framing/opcodes and it's on us to re-derive. We own
  all parsing and maintenance forever.
- **ToS / warranty grey area.** Reverse-engineering a device you own for personal data
  access is a legitimate owner-only use case, but it is outside Oura's ToS. Named, not
  moralised — it's the user's ring and data.
- **Raw sample volume.** Continuous PPG/IBI/motion is a lot of rows; retention +
  downsampling policy is mandatory, not optional.
- **Exercise-HR accuracy** (as above) — out of scope here; strap track handles it.
- **Effort is real and front-loaded in the decoder port.** Auth is a day; the
  `oura-protocol` event-decoder port + a robust foreground-service BLE lifecycle on
  Samsung's stack is the multi-week core.
- **Unknown until tested:** exact history-stream pagination/opcodes for Ring 5
  (documented for Ring 3; `ring-5-observations.md` notes deltas but we must verify on
  our actual ring), and whether Ring 5 firmware still matches the documented flow.

---

## 7. Cheapest order to de-risk (phased — do NOT start with the plugin)

The plugin is the expensive part; prove the risky assumptions **before** building it.

- **Phase 0 — Laptop spike (days, no app code).** Clone `open_oura`, build the Rust
  CLI on a Mac/Linux box with BLE, and prove on **our actual Ring 5**: (a) we can
  authenticate (via Option A reset-and-own-key, or B extraction), (b) we can pull the
  history-event stream, (c) the decoded raw data looks sane. **This single step
  answers "is this even possible for our ring/firmware" for near-zero cost.** If Phase
  0 fails, stop — no Capacitor work wasted. **Step-by-step runbook (Kali + rooted
  Android):** `2026-07-06-oura-direct-ble-phase-0-runbook.md`.
- **Phase 1 — Decision gate.** Given Phase 0 results, the user decides: Option A
  (own the ring, drop Oura cloud) vs keep both. This is a one-way-door decision and
  belongs to the user, not the implementer.
- **Phase 2 — Kotlin auth proof.** Minimal Android app (not the plugin yet): scan,
  connect, auth handshake, read *one* live HR value. Proves the crypto + GATT port in
  isolation.
- **Phase 3 — Event-decoder port.** Port `oura-protocol`'s history-stream decoders to
  Kotlin; validate decoded output byte-for-byte against the Rust CLI on the same ring.
- **Phase 4 — Capacitor plugin + offline-first domain.** Wrap Phases 2–3 as a plugin,
  add the `oura_raw_samples` domain end-to-end per the CLAUDE.md offline-sync
  checklist (local table, outbox, pull-delta, retention), foreground service.
- **Phase 5 — Our own analysis.** `lib/health/*` formulas over raw samples; UI.

Each phase is independently abandonable. Nothing after Phase 0 should start until
Phase 0 proves the ring cooperates.

---

## 8. Open questions for the user (decide before Phase 2)

1. **Option A vs B for the auth key** — own the ring (drop official app + Cloud API)
   vs extract the key on a rooted phone and keep both (accepting BLE contention)?
2. **Is dropping the Cloud API acceptable?** In Option A, our existing `lib/oura/`
   cloud sync becomes dead for this ring. OK to retire, or keep a dual path?
3. **Scope confirm:** live *exercise* HR stays on a separate BLE-strap track, yes?
4. **Appetite:** this is a multi-week native R&D effort with ongoing maintenance —
   worth it for the raw dataset, or is "Cloud API + webhooks for freshness + a chest
   strap for live HR" the pragmatic 90% at 10% of the cost?

---

## 9. Relationship to existing work

- Complements, doesn't replace, the shipped **App-Open Oura Sync**
  (`2026-07-04-app-open-oura-sync.md`) and **HR-for-session** cloud paths — those stay
  until/unless Option A retires the Cloud integration.
- Fits the **APK-canonical** direction (`2026-07-06-apk-canonical-target-*`): native
  on-device capability is exactly what that endgame is for.
- If pursued, `docs/module-map.md` §8 (Oura) and the offline-sync domain list get a
  new `oura_raw_samples` row in the implementing PR.

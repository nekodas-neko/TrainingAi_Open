# Ingest and scoring architecture

**Status: draft v1, 2026-10-05.** Written by the Orchestrator from the owner's direction on
`OR-213`, `OR-214`, `OR-215`. **Decisions marked 🔧 are taken** (delegated to the Orchestrator and
recorded with their reversal cost). Sections marked ❓ are open and named as such.

One document rather than several, because the problem this solves is that **no single place answers
"what are our sources and how do we aggregate them"**. Splitting it would recreate that.

---

## 0. Why

Measured 2026-10-05, production, one user, 263 MB:

| bucket | size | share |
|---|---|---|
| raw / sample, device-sourced | 182 MB | 73.3% |
| ops + logs | 54 MB | 21.8% |
| **calculated + app data** | **12 MB** | **4.9%** |

Only the calculated tier belongs in the cloud. That takes a user from ~263 MB to **~12 MB, about
22×** — the difference between ~26 GB and ~1.2 GB at a hundred users. The driver is multi-user:
the owner's goal is 1–2 → ~5 → upward.

---

## 1. The four layers

```
  ┌─ L1 CONNECTOR ──────┐  ┌─ L2 NORMALISER ─┐  ┌─ L3 DEVICE STORE ─┐  ┌─ L4 CLOUD ────┐
  │ Oura BLE (private)  │  │ canonical       │  │ finest tier       │  │ scored values │
  │ Oura API (public)   │→ │ sample shape    │→ │ + rollups         │→ │ + basis       │
  │ Health Connect      │  │ rank + merge    │  │ 7-day full, then  │  │               │
  │ Renpo scale · Colmi │  │ signal registry │  │ rolled up         │  │ small, bounded│
  │ Polar H10           │  └─────────────────┘  └───────────────────┘  └───────────────┘
```

**L1 Connector** — one per source. Pulls third-party data and hands it to L2 in the canonical
shape. "Link with X" is a connector being enabled.
**L2 Normaliser** — the single place that decides what a sample *is*. Today this does not exist.
**L3 Device store** — the source of truth, at the finest resolution received.
**L4 Cloud** — scored and aggregated values only. Raw never arrives here.

---

## 2. Decisions taken

### 🔧 D1 — Resolution is finest-available per source, tagged

Every sample carries its **source** and **native resolution**. Nothing is resampled on arrival.
Health Connect's 5-minute HR bins stay 5-minute bins *marked as 5-minute*; they are never
interpolated to look like the strap's ~1 s.

*Why:* downsampling later is reversible, discarding is not — and a 5-minute bin dressed as 1 s is a
number the app would trust more than it should.
*Reversal cost:* low on the write path, **total on the data**. Moving to a fixed grid later is a
config change; recovering detail discarded at ingest is impossible.

### 🔧 D2 — Which source wins a given interval is decided by rank, and the loser is kept

Reuse the existing ranked per-field health-write merge rather than inventing a second mechanism.
Finest resolution does not automatically win. **The losing sample is stored, not discarded**, so
the ranking can be changed later without data loss.

### 🔧 D3 — Store the renormalised score AND its coverage; derive everything else

This is the answer to *"what happens when a signal arrives that nobody had before"*, and it is
developed in §3. In short: store `(score, coverage, contributors[])`, never a pre-shrunk number.

### 🔧 D4 — Device retention is 7 days at full resolution, then rolled up

Which is **already the built shape**: `HOT_WINDOW_DS = 7 * 86_400 * 10` in
`lib/data/postgres/slices/oura-raw-pack.ts`, with the packer sealing older buckets into compressed
blobs after verifying by read-back. The work is to **relocate that policy to the device**, not to
design it.

---

## 3. Missing signals — the coverage identity

The owner proposed giving an absent signal a **neutral default** (mid-scale) so that when real data
arrives it moves the score away from the middle. The codebase currently does something different:
absent contributors are **excluded and the weights renormalised**
(`renormalisedContributors`, `packages/shared/src/health/score-audit/`).

**These are the same number, and that is the useful finding.**

Let `wᵢ` be contributor weights summing to 1, `sᵢ` the sub-scores, `P` the present set, and
`C = Σ_{i∈P} wᵢ` the **coverage**.

- Renormalised score: `R = (Σ_{i∈P} wᵢ·sᵢ) / C`
- Neutral-imputed score, with neutral `ν`: `N = Σ_{i∈P} wᵢ·sᵢ + ν·(1 − C)`

Substituting `Σ_{i∈P} wᵢ·sᵢ = R·C`:

> **N = R·C + ν·(1 − C)**

So **the owner's neutral default is exactly the renormalised score shrunk toward ν in proportion to
the missing weight.** No choice between the two approaches is required — provided `C` is stored.

### What follows

- **Store `R` and `C`, never `N`.** `N` is derivable at render or decision time; `R` is not
  recoverable from `N`. Storing `N` also bakes in a particular `ν`, which then cannot be changed
  without re-scoring history.
- **`ν` becomes tunable.** Mid-scale (50) is only neutral if the contributor's expected value is
  50, which for most is false. **Better `ν` is the user's own rolling median for that
  contributor**, with 50 as the cold-start fallback. This is a Tuning question, and it is now a
  *parameter* rather than a structural commitment.
- **The shrinkage strength is also tunable.** `N` above shrinks linearly in `(1 − C)`; a weaker or
  stronger curve is a formula change over stored values, not a migration.
- **It delivers the owner's stated intent**: a new device raises `C`, which both widens the
  attainable range and lets the new signal move the score away from `ν`.

### What coverage fixes that renormalisation alone does not

Renormalisation makes a score **computable**; it does not make two scores **comparable**. A 72 from
six contributors and a 72 from three render identically. With `C` stored:

- **Across users** — comparability is checkable rather than assumed.
- **Within one user across time** — a device arriving is a visible change in `C`, not a silent
  step. This is the same shape as the `vs_yesterday → vs_normal` boundary, solved the same way
  (`vs_question`, `LB-190`).
- **Against a tuning** — a proposal can finally state *how many days it moves* restricted to days
  that actually had the input, which `CLAUDE.md` already requires and nothing currently supports.

### ⚠ The one thing not to do

**Do not store a neutral as though it were a reading.** `TN-57`/`TN-58` is the precedent: *"a
neutral stored as though it were an answer is the defect TN-57 just fixed"*. Imputation at the
storage layer makes a missing signal indistinguishable from an average one — the same class as
`Q-499`, where a card cannot tell "no data" from "the fetch failed". Coverage keeps the
distinction; imputation destroys it.

---

## 4. The signal catalogue

A signal is a **registry entry, never a schema change**. Each declares: name · unit · pillar ·
native resolutions seen · whether it is currently scored · which connectors supply it.

**🔧 Declare the full catalogue; admit a signal into a score only when there is data to calibrate
it.** A contributor nobody has ever supplied cannot be weighted on evidence, and a guessed weight
going live silently re-scores everyone. The basis field records the difference, so an unscored
signal can be collected now and scored later without rewriting history.

❓ The catalogue itself is not yet written. It should be seeded from the five existing integrations
plus Health Connect's record types, rather than invented.

---

## 5. Connector contract

**This is an extraction, not a greenfield build.** Five integrations already exist and each was
hand-rolled with no shared contract: `lib/oura-ble` · `lib/scale-ble` (Renpo) · `lib/colmi-ble` ·
`lib/polar-ble` · `lib/health-connect-sync.ts`, with native services under
`android/app/src/main/java/com/trainingai/app/{oura,scale}`. **Read the contract out of those five
worked examples**; designing it abstractly and retrofitting risks a framework that fits none.

Each connector declares: **signals** provided · each one's **native resolution** · **transport**
(BLE / Health Connect / cloud API) · **link and unlink** flow · **auth or pairing** state ·
**rank** for D2's merge.

### 🔧 D5 — Two connectors may serve one device, and that is the design, not an edge case

The owner wants the jailbroken Oura ring as a **private** connector *and* the ability to restore
the ring to stock and reconnect through the **official Oura API**, switching between them. So
`oura-ble-private` and `oura-api` are two connectors supplying overlapping signals, resolved by
D2's rank. That is exactly what the registry is for, and it is a strong argument for the contract:
without it, switching means a code change.

### ⛔ Two constraints that must survive into the UI

- The ring is on **our own BLE key with frozen firmware**. Re-onboarding the official app can force
  a firmware update that breaks the reverse-engineered protocol. **A connector wraps the existing
  pipeline; it must never silently re-pair the ring.** Switching to the official API is a
  deliberate, warned action.
- **An APK uninstall destroys the ring's BLE key**, recoverable from nowhere. No pairing UI may
  make that reachable by accident.

---

## 6. Phasing

**Phase 0 — make the raw archive safe. Ships first, blocks nothing else.**
`oura_raw_packed` is **28 MB / 1.8 M frames and today the only re-decodable copy**; the ring's
buffer only moves forward, so a lost row cannot be re-drained. Order is fixed:

1. Build the local archive **and prove a restore from it** — read-back and unpack verified, not
   merely a file that exists.
2. Stop writing raw to Railway.
3. **Only then** drop the server archive.

The phone is not that home as it stands: 31.2 MB on-device, past Android Auto Backup's 25 MB quota,
nothing backed up, and `pruneRaw` still has no caller. ❓ Where the archive lives during the tuning
period is open — the owner's own machine is the stated interim, which is not a multi-user answer.

**Phase 1 — the normaliser and the signal catalogue.** The canonical sample shape, D1 and D2, and
the registry. No storage moves.

**Phase 2 — the basis field.** `(score, coverage, contributors[])` on every scored value. Cheap now;
retrofitted, every historical score has an unknown basis forever.

**Phase 3 — the connector contract**, extracted from the five that exist, including D5's dual Oura.

**Phase 4 — the storage move**: device becomes the source of truth, cloud takes scored values only.

---

## 7. Open questions

- ❓ Where the raw archive lives during tuning, and what the multi-user answer is afterwards.
- ❓ The catalogue's contents.
- ❓ `ν` and the shrinkage curve — a Tuning question, now a parameter rather than a commitment.
- ❓ Upload cadence. *"Uploaded instantly"* × N users makes the cloud write path the shared
  bottleneck against a `max: 10` pool that `CLAUDE.md` marks load-bearing; it must be batched and
  bounded per user.
- ❓ Ops/logs are 54 MB (21.8%) and **do not shrink** under this architecture — they are shared
  rather than per-user and need their own retention decision.

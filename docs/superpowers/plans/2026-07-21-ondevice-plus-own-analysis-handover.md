> **⏭ SUPERSEDED (2026-07-21).** The audit this doc scoped is complete; the plan is written, reviewed, and
> on `main`. The current baton for *building* it is **[`docs/oura-ondevice-hybrid-handover.md`](../../oura-ondevice-hybrid-handover.md)**.
> This file is kept for history (its strategy source is `2026-07-21-oura-decoupling-and-own-models-strategy.md`).

# Handover — On-Device-First × Own-Analysis: What Data Do We Actually Need?

**Date:** 2026-07-21 · **Type:** Cross-session handover / synthesis. · **Runtime:** S25 APK, BLE-only ring.

> Combines two threads that have been running separately and only make sense together:
> **(A) "move to on-device first"** — the BLE migration + the DB-bloat/culling problem (*what raw
> data do we keep?*), and **(B) "move to our own local analysis"** — owning the interpretation of
> ring data instead of leaning on Oura's cloud/models (*what do we compute ourselves?*).
> The unifying question this handover exists to answer: **what data do we actually need to keep,
> and what do we calculate from it?**

## The source docs (read these first)

- **Thread B — own the analysis (this session):**
  `docs/superpowers/plans/2026-07-21-oura-decoupling-and-own-models-strategy.md` — the
  decode/interpret/reference three-layer split, the model-ourselves-vs-keep-from-Oura decisions, the
  comparison-harness design, the steps over-count diagnosis, the live-only GPS design.
- **Thread A — move raw + calculation on-device:**
  `docs/superpowers/plans/2026-07-21-oura-raw-on-device-architecture.md` (Phase-0 spec, esp. §5 + the
  Review Outcome), `docs/db-volume-cleanup-handover.md`, `docs/oura-on-device-handover.md` *(may live
  on the other session's unmerged branch — pull it if absent here)*, and the device-primary north star
  (phone computes incl. ML; cloud is backup only — the Garmin/Apple-Health pattern).
- **Thread A — culling:** `docs/superpowers/plans/2026-07-15-oura-data-architecture-and-culling.md` and
  its parent `…-oura-models-program-master.md` §4–5 — completed-form recording + ingestion culling
  levers, the archival rule for `oura_raw_samples.body_hex`, and the retention audit.

## Why they are one problem

They meet at a single dependency: **what we choose to compute pins what raw data we must keep, and what
we choose to drop frees raw data to cull.**

- Thread B says *keep computing steps* (via Oura's `step_counter`) → therefore Thread A **must keep**
  the `0x7e/0x7f` gait frames, and must keep their `body_hex` long enough to backfill.
- Thread B says *drop vascular age / body-comp* (PPG-based, irrelevant to training) → therefore
  Thread A **may cull** raw PPG (`0x81`, `0x64`, `0x68`) once we're sure nothing else needs it.
- Thread B says *the reference models are temporary* (deprecate ~2–3 months) → the retention window for
  their inputs is bounded by that, not forever.

So the culling plan cannot be executed safely in isolation — it needs Thread B's compute decisions as
its input. **This handover's job is to make that dependency explicit and hand an agent the first,
gating piece of work: the keep/cull/calculate matrix.**

## The state of the ground truth (so nothing here is re-litigated)

- **Decode stays Oura-faithful** (`lib/oura-ble/decode.ts`); it's deterministic, keep as-is.
- **We compute essentially everything ourselves** (`lib/health/*`, ~5k lines already built) EXCEPT
  two kept-models: **SleepNet** (hypnogram — heuristic ceilinged on REM, no independent truth) and
  **`step_counter`** (daily steps — our flat 30/window heuristic over-counts; the model is tiny/inline).
- **`oura_raw_samples.body_hex` is archival + immutable** today (redecode source of truth). The owner
  has *signalled openness* to relaxing this (Lever 5: "record, analyse, delete raw later") once a day's
  raw is decoded into completed form — but that's a **data-dropping, confirm-first** change, and the
  window must be long enough that decoders have stabilised.
- **No cron layer** — retention is ingest-time throttled prunes only (`retention-throttle.ts`).
- Culling **Lever 1** (stop persisting the redundant `decoded` JSONB — re-derivable from `body_hex`)
  and **Lever 2** (tag whitelist for raw storage) are the safe, high-leverage, ship-first wins.
  Highest migration number was 122 → claim **123+** (verify against tree + open PRs before allocating).

## The first part of the puzzle — the keep/cull/calculate matrix

Before any migration drops a byte, produce one authoritative matrix that ties compute decisions to
retention decisions. For **every raw BLE tag currently ingested** (`lib/oura-ble/decode.ts`
`EVENT_NAMES`, cross-referenced with `rollup-consumed-tags.ts` and `raw-storage.ts` drop list), record:

| Column | Meaning |
|---|---|
| tag / event name | e.g. `0x80 green_ibi_quality` |
| consumed by | which `lib/health/*` computation(s) or kept-model reads it (or "none") |
| our metric | the interpreted output(s) it feeds (HR, HRV, steps, staging, …) — per the Thread B table |
| keep-model? | is it an input to a kept Oura model (SleepNet / `step_counter`) |
| backfill need | must its `body_hex` survive for future re-decode? for how long? |
| verdict | **keep-raw / keep-hex-only / cull-now / cull-after-window** |
| note | e.g. "PPG — only vascular age needs it, and we dropped vascular age → cull-now" |

Output: a committed doc (or a table on the culling plan) + the concrete lever list it justifies — which
tags Lever 2's whitelist drops, which `body_hex` spans Lever 5 can eventually release, and confirmation
that Lever 1's redecode path covers everything we still compute. This is the gate that lets the culling
migrations ship without risking a signal we actually need.

## Open forks to carry (do not silently resolve)

- **`body_hex` retention window (Lever 5)** — data-dropping, confirm-first, and update the CLAUDE.md
  archival rule in the same PR. Bounded by "decoders stabilised" + the ~2–3mo oracle-deprecation window.
- **Sleep REM ceiling / step over-count** — both resolved as "keep the Oura model," so their inputs are
  keep-raw, not cull.
- **Circular validation** — wire a non-Oura truth reference (Polar H10 chest strap) so tuning isn't
  anchored to Oura's own errors.
- **Native work** (GPS/Activity-Recognition, any Kotlin) needs an owner APK rebuild; device-only verify.

## Agent prompt for the first part (copy/paste — combined)

> Work the first part of the Oura on-device puzzle: the **data-requirements audit** that unifies "move
> raw + calculation on-device" with "figure out what data we actually need to keep and calculate."
>
> **Read first, in full:** this handover
> (`docs/superpowers/plans/2026-07-21-ondevice-plus-own-analysis-handover.md`) and both threads' source
> docs — the own-analysis strategy (`…2026-07-21-oura-decoupling-and-own-models-strategy.md`), the
> Phase-0 on-device spec (`…2026-07-21-oura-raw-on-device-architecture.md`, esp. §5 + Review Outcome),
> the culling plan (`…2026-07-15-oura-data-architecture-and-culling.md`), `docs/db-volume-cleanup-handover.md`,
> and `docs/oura-on-device-handover.md` (pull from the other session's branch if absent). Then CLAUDE.md
> (DB / sync / offline / BLE + "Oura Direct-BLE").
>
> **This is docs/analysis work — write NO device code and do NOT implement.** Produce **one plan doc in
> `docs/superpowers/plans/`**: a definitive **data-requirements map** that is also the
> **keep/cull/calculate matrix**. For the whole app's health/analysis surface, map end-to-end:
> **feature/metric the app shows → the calculated form(s) it reads → the resolution/tier those need →
> the raw Oura tags / `body_hex` those calculations consume → how long raw must be retained on device to
> (re)compute or reprocess (decoder fix OR model-version bump) → what is discardable after calculation →
> what must back up to Railway (the restore subset).** Give each raw tag an explicit verdict:
> **keep-raw / keep-hex-only / cull-now / cull-after-window**, with its backfill justification and
> retention window (bounded by "decoders stabilised" AND the ~2–3-month reference-oracle deprecation
> window from the strategy doc).
>
> **Ground it in the real code, not memory:**
> - `aggregateOuraRawSamples` (`lib/data/postgres/adapter.ts:4033`+) is the authority on what's computed
>   from what today; enumerate which models it actually runs (the wired ONNX set — e.g. SleepNet, dHRV —
>   plus the deterministic math) rather than assuming a count.
> - `lib/oura-ble/decode.ts` (`EVENT_NAMES`) for per-tag decoders; `lib/oura-ble/rollup-consumed-tags.ts`
>   (`ROLLUP_CONSUMED_TAGS`) and `lib/oura-ble/raw-storage.ts` (`RAW_STORAGE_DROP_TAGS`) for
>   consumed-vs-dropped tags.
> - `lib/oura-models/` for the wired models + deterministic math; `lib/health/*` for our own formulas.
> - `lib/data/postgres/schema.ts` vs `lib/sqlite/migrations.ts` for server-vs-local finished tables —
>   the map must **subsume, not duplicate** these.
>
> **Honor the strategy doc's decisions as authoritative input on what we keep computing:** we own
> essentially every interpreted metric ourselves EXCEPT two **kept models** — **SleepNet** (hypnogram)
> and **`step_counter`** (daily steps) — and we **drop** PPG-based vascular age / body-comp and
> ring-based activity-type auto-tag. Kept-model inputs are keep-raw; dropped-metric-only inputs are
> cull candidates. The reference models are a **temporary oracle** (observe, never feed) slated for
> deprecation — so their inputs' retention is bounded, not forever. Flag wiring a non-Oura truth
> reference (Polar H10 chest strap) as the way out of circular validation.
>
> **Enumerate every metric** and where each is consumed: readiness + contributors, sleep score +
> stages, HRV (nightly + intraday), RHR, SpO₂, temperature, respiratory rate, BDI/apnea, resilience,
> illness, chronic/daytime stress, body battery, MET/activity, steps, energy, training load, wear time,
> body comp, vascular age.
>
> **Deliverable & guardrails:** the plan doc directly answers the owner's question — *what raw do we
> keep and for how long, what do we calculate and persist at what tier, what do we discard, what do we
> back up.* Add a backlog entry. Flag any finding that needs the owner's S25 to verify. **Ship no
> migrations and drop no data** — anything that would drop `body_hex` or a biometric tag goes to owner
> confirmation (data-dropping, per CLAUDE.md). Constraints: `oura_raw_samples.body_hex` is
> archival/immutable until an explicit owner-confirmed policy change; no cron layer exists; verify the
> next free migration number against the tree AND open PRs before proposing one; keep the web fallback
> logic-free (Canonical Runtime).
>
> **North star:** everything on the phone, future-proof, best performance/update cadence; **device-primary**
> (Garmin/Apple-Health pattern — phone computes, incl. ML; cloud is backup only). This map is the
> foundation the tier ladder, the rollup port, and the Phase-2 backup subset all build on.

## Next steps after the matrix

1. **Culling Levers 1–2** (safe, ship-first) — justified by the matrix. Data-space win, no compute change.
2. **Steps fix** — wire `steps_motion_decoder` → build `step_counter` → adopt as primary → backfill via
   redecode (work item 1 in the strategy doc; the matrix confirms its inputs are keep-raw).
3. **Comparison harness** + chest-strap reference (Thread B §4).
4. **Lever 5** `body_hex` window — only after decoders stabilise, owner-confirmed.

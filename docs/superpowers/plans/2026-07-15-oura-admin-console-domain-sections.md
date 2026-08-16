# Sub-plan G — Admin Console: Domain-Aligned Collapsible Sections + Per-Domain Testing

**Parent:** `2026-07-15-oura-models-program-master.md` · **Branch:** `feat/oura-admin-console-sections`
· **Phase:** rides alongside the program — land the **shell + section skeleton early** (so each
feature PR drops its test affordances into the right section), fill sections as features land. ·
**Type:** admin-only UI reorg + a few new diagnostic cards. Low product risk (admin-gated, no
end-user surface), but **APK-only to verify** (BLE diagnostics don't run in the web sandbox).

Because the data we measure and derive is changing across this program, the admin console — today
organized by *tool type* and split across two places — should be re-sliced by **data domain**, so
each domain's diagnostics and the **tests needed to verify that domain's new derivations** live
together under one chevron.

---

## 1. Goal

- Re-organize the admin console into **domain collapsible sections** (chevrons), one per program data
  domain, each holding: (a) the existing diagnostics for that domain, and (b) the **new tests** each
  program feature needs to be verified on-device.
- Standardize on the existing `CollapsibleSection` primitive; retire the hand-rolled chevrons.
- Give every program feature a **home for its device-verification affordance** so the "device gate"
  each sub-plan requires (Canonical Runtime) has a concrete button to press.

Non-goal: changing what the diagnostics *do* or the admin auth model. This is organization + a few
new test cards, not a rewrite.

---

## 2. Current state (audited)

- **`/admin`** (`app/admin/admin-content.tsx`) — a **7-tab** bar (`users | invites | exercises |
  activities | tools | feedback | errors`, `:167`). Oura work is reached via a link card in **tools**
  (`:253`) to a separate route.
- **`/admin/oura-ble`** (`components/oura-ble/oura-ble-debug.tsx`) — the rich diagnostic hub. Already
  uses **6 `CollapsibleSection` chevrons**, but grouped by **tool type** (Raw protocol commands / Step
  calibration / Live step test / Continuous capture / Battery soak / Sleep epochs / Log & frames), so
  a single domain is scattered: e.g. "Dump sleep frames" sits in the Raw-commands section while "Sleep
  epochs (debug)" is its own section; HR levers are split between the Measurements `BtnGroup`
  (`:583`), the raw Heart-rate `BtnGroup`, and the separate `LiveHrTestConsole` on the page.
- **Primitive available:** `components/ui/collapsible-section.tsx` — bordered card, real `<button>` +
  `aria-expanded`, 44px header, `ChevronDown/Right`, `icon`/`right`/`defaultOpen` slots. **Standardize
  on this.** Hand-rolled chevrons to retire: `admin-content.tsx:273` ("Additional tools"),
  `sample-inspector.tsx`, `time-audit-card.tsx`.
- **Gate:** every admin action re-checks `requireAdmin` (`lib/admin.ts:15`, authoritative DB lookup,
  ignores stale JWT). Page guards are cosmetic redirects. **Unchanged by this plan.**
- **Diagnostics inventory** (full list in the investigation): sync/redecode/drain, dump-frames by tag,
  measurement feature toggles, step calibration/live/continuous capture, battery soak, sleep-epoch
  debug, HR coverage / live-HR console, sample inspector, ring-key setup. Plus non-Oura admin (users,
  invites, exercises + AI media, activity types, time audit, program export, feedback, errors).

---

## 3. Target structure — domain sections

Keep `/admin/oura-ble` as the **Oura diagnostics route** (it's APK-heavy and benefits from isolation),
but **re-slice its interior into data-domain `CollapsibleSection`s** that mirror the program sub-plans,
and fold the stray `LiveHrTestConsole` into the Cardio section. The `/admin` tabs stay for non-Oura
admin; the **tools** tab's Oura link card becomes a labelled entry to the reorganized route.

**Domain sections (each a `CollapsibleSection`, ordered by program priority):**

| Section (chevron) | Holds (existing diagnostics) | New test affordances (per program feature) |
|---|---|---|
| **① Data / Ingestion / Retention** | Ring-key setup, Connection status, Sync now / Sync&Redecode / Drain / Full re-sync, **Redecode**, Recorded-summary stats + Refresh, Sample inspector, Log & frames | **DB footprint readout** (row counts + bytes per Oura table — verifies the culling); **tag-whitelist preview** (which tags are being stored/dropped); **decoded-JSONB drop toggle** verification; redecode-produces-identical-derived check |
| **② Sleep** | Dump sleep frames (`49/4c/4f/58/4b/4e/5a/76`), Sleep epochs (debug) redecode-by-date | **Feature-stack diff** (old heuristic vs new feature-stack stages side-by-side for a date); REM-% readout vs baseline; sleep-score persisted-value check |
| **③ Steps / Activity / Energy** | Enable/disable steps & measure, Dump step frames (`7e/7f/50/51/52`), Step calibration, Live step test, Continuous capture, Start/Stop accel | **Decoder validation card** (decode a captured walk → show `stride_frequency` per window, assert plausible cadence — the D-2 gate); **counted-walk compare** (cadence total vs hand count); **MET-series inspector**; **OTS/energy readout** for a date |
| **④ Recovery / Readiness / Illness** | (mostly server-derived — few raw levers) | **Nightly-median vs old-mean HRV** compare for a date; **readiness contributors** dump (persisted row); **illness-radar state** readout (baseline maturity, per-biomarker z, flag, applied suppression); **baseline inspector** (EMA vs night-hrv-baseline) |
| **⑤ Cardio / Body-comp** | Live HR / Fast-HR / Exercise-HR / Daytime-HR / HR burst, HR coverage, **Live HR test console** (folded in from the page), Battery / Info / SyncTime, Battery soak | **PPG-capture spike card** (the vascular-age GO/NO-GO: trigger `0x81`, show sample count / effective rate / continuity — the F-spike); **body-comp readout** (fat/lean/BMR from weight+bf%) |
| **⑥ Cloud (legacy, frozen)** | — | Surface **Oura webhook subscriptions** (admin API exists, no UI today); mark clearly "frozen since re-key — no new data" |

`/admin` non-Oura tabs (users/invites/exercises/activities/feedback/errors) are **untouched** except
retiring the two hand-rolled chevrons for `CollapsibleSection`.

**Why keep the route split:** folding the whole BLE console into `/admin` tabs would bloat the tab bar
and mix APK-only diagnostics with web-safe admin. Keeping `/admin/oura-ble` as the "ring lab" and
re-slicing its interior by domain is the lower-risk, higher-clarity move. Revisit only if the owner
wants a single surface.

---

## 4. Per-domain test affordances — the point of the reorg

Each program sub-plan carries a **device-verification gate** (Canonical Runtime — BLE behaviour is
only real on the S25 APK). This plan gives each gate a concrete button so verification is a tap, not a
bespoke setup. New diagnostic cards to build (each a small component under `components/oura-ble/`,
dropped into its section):

- **`DbFootprintCard`** (§①) — GET a per-table row-count + `pg_total_relation_size` readout (new tiny
  admin route `oura-ble/db-stats`), so the culling's effect is measurable in-app before/after. Also
  shows the tag-store whitelist + a sample of what `decoded` now omits.
- **`SleepStageDiffCard`** (§②) — for a date, run the redecode with both the old heuristic and the new
  feature-stack stager and render both hypnograms + stage %s, so the REM-plateau fix is visually
  verifiable against a real night.
- **`StepDecoderCard`** (§③) — decode the captured `0x7e/0x7f` packets for a window, show the three
  `stride_frequency` columns dequantized (Hz) and the resulting step count; this **is** the D-2
  column-mapping validation gate, made interactive.
- **`ReadinessDerivedCard`** (§④) — dump the persisted `oura_daily_derived` row for a date (readiness +
  contributors + illness state + medians), so the "persist in completed form" and "median-not-mean"
  changes are inspectable.
- **`PpgCaptureSpikeCard`** (§⑤) — trigger `0x81` capture and report sample count / inferred rate /
  per-event continuity — the **vascular-age GO/NO-GO** evidence the F sub-plan needs before any port.

These cards are **read-only diagnostics** (no destructive actions) and reuse the existing
`samples/raw` + `samples/redecode` routes where possible; only `DbFootprintCard` needs a new tiny
admin GET route.

---

## 5. Plumbing

- **New/changed files:**
  - `components/oura-ble/oura-ble-debug.tsx` — re-group its interior into the six domain
    `CollapsibleSection`s above (move existing `BtnGroup`s/cards into the right section; no behaviour
    change to the underlying actions).
  - New cards under `components/oura-ble/` (§4). Keep each < ~300 lines; the debug hub already risks
    the 800-line ceiling — **extract sections into child components** (`SleepSection`, `StepsSection`,
    `RecoverySection`, `CardioSection`, `DataSection`) rather than growing the one file (CLAUDE.md
    hotspot-file rule; `oura-ble-debug.tsx` is a known large file).
  - `components/admin/admin-content.tsx` — replace the two hand-rolled chevrons with `CollapsibleSection`.
  - `sample-inspector.tsx`, `time-audit-card.tsx` — swap hand-rolled chevrons for `CollapsibleSection`.
  - One new admin route `app/api/oura-ble/db-stats/route.ts` (GET, `requireAdmin`) for `DbFootprintCard`.
- **No auth change**, no new gate — every new route calls `requireAdmin` like its siblings.
- **Safe-area / a11y:** the console is a full-screen admin surface — headers use `pt-safe`, the new
  `CollapsibleSection`s already carry `aria-expanded` and 44px headers (primitive handles it). Verify
  no nested-interactive-in-button violations when moving cards (WebView rule).
- **No cache/DB-write semantics change** — these are diagnostics; the `db-stats` route is read-only.

---

## 6. Phasing

- **G-1 (early — land the skeleton):** re-slice `oura-ble-debug.tsx` into the six domain
  `CollapsibleSection`s with existing diagnostics moved into place; extract per-section child
  components; retire hand-rolled chevrons. No new cards yet. This gives every later feature PR a
  section to drop its test card into.
- **G-2:** `DbFootprintCard` + `db-stats` route (pairs with the culling PR — lets the owner *see* the
  space freed).
- **G-3..G-6:** add each domain's test card **in the same PR as the feature it verifies** (e.g.
  `StepDecoderCard` ships with the steps decoder; `SleepStageDiffCard` with the sleep feature stack;
  `ReadinessDerivedCard` with the recovery P1; `PpgCaptureSpikeCard` with the vascular-age spike). So
  this sub-plan's later tasks are **absorbed into the feature PRs**, not a separate stream — G owns
  the skeleton (G-1) and the shared footprint card (G-2); the rest ride along.

---

## 7. Testing

- **Web sandbox (`pnpm dev`):** the console renders, sections expand/collapse, non-BLE admin
  (users/exercises/etc.) still works, `db-stats` returns numbers against the local dev DB. Hand-rolled
  → `CollapsibleSection` swaps keep the same content.
- **Device (S25 APK — the real gate):** every BLE diagnostic (dump frames, redecode, capture cards,
  live HR) only functions on-device with the ring. Confirm each moved card still triggers its action
  and the new test cards read correctly. Anything not device-verified in-session → `projectOverview.md`
  Known-Issues row (Canonical Runtime).
- **A11y/WebView:** verify no `<button>`-in-`<button>` after moving interactive cards; 44px targets;
  safe-area on the header.

---

## 8. Risks

- **`oura-ble-debug.tsx` size** — it's already large; re-grouping must **extract child components**,
  not inflate the one file (hotspot rule). Called out in G-1.
- **Moving cards breaks a wiring** — the diagnostics have live handlers/state; move markup + handlers
  together, verify each still fires on-device (diagnostics are the owner's only BLE verification path —
  a broken button blocks all downstream device gates).
- **Scope creep into a rewrite** — keep behaviour identical; this is organization + read-only cards.
- **Web-invisible** — like all BLE surfaces, the sandbox can't exercise the real actions; the reorg
  looks done in `pnpm dev` while a moved handler could be broken on-device. Device smoke is mandatory.

---

## 9. Backlog entry

- **Title:** Admin console — domain-aligned collapsible sections + per-domain test cards
- **Branch:** `feat/oura-admin-console-sections`
- **Plan:** `docs/superpowers/plans/2026-07-15-oura-admin-console-domain-sections.md`
- **Priority rationale:** land **G-1 (section skeleton) early**, right after the enablers, so every
  feature PR drops its device-test card into the right section; G-2 pairs with the culling PR; G-3..6
  ride along inside their feature PRs. Low product risk (admin-only), APK-only to verify.
- **Date added:** 2026-07-15

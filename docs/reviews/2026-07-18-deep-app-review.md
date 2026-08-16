# Deep App Review — 2026-07-18/19 (full-system audit)

**Scope:** the deepest end-to-end review this app has had — 12 dimensions (A–K) plus a prior-review
fixed-claims audit (R), run by 13 parallel review agents over current `main` (c2bd70f, v1.171.0),
with **adversarial verification of every critical/high finding** by independent skeptic agents and
empirical dev-server probing. Review-only: nothing was fixed in this session; every NEW finding is
queued below (plans for the big batches, pointer entries for the rest — see §Queue mapping).

**Method:** every finding cites file:line and is marked CONFIRMED (code-verified, failure traced)
or PLAUSIBLE (needs runtime/device check). Findings already tracked in `projectOverview.md`
Known Issues, `docs/implementation-backlog.md`, `docs/planned_upgrades.md`, or the five prior
reviews were treated as DUPs and not re-raised. All 10 critical/high candidates went through an
adversarial verify pass (verdicts in the appendix): 7 sustained (1 critical, 6 high after merges),
4 downgraded to medium, 0 refuted outright. Baseline: `tsc --noEmit` clean; `pnpm test`
1667 passed / 93 skipped; `pnpm dev` probes in §Empirical.

## Executive summary — verified critical & high findings

| # | Finding | Dim | Sev (verified) | Status | Disposition |
|---|---|---|---|---|---|
| D-1 | `food_items` outbox domain missing from the push envelope enum (`lib/sync/mutation-schema.ts:9`) — on the APK every **new-food log takes the local-store branch even online**; the push route silently drops the `food_items` mutation, the client confirms+deletes it, and the paired `food_logs` mutation **dead-letters on the FK check**. The adapter's fully-built `food_items` branch (adapter.ts:3322) is unreachable. No healing path (web fallback, pull, saved-meals all ruled out). Regression class of "fixed" SYNC-O2. | D | **critical** | CONFIRMED + verified REAL | Plan **P1** (top of queue) |
| J-8 | `/api/zone-minutes` returns `days: []` on **every real client call** — `normalizeDateParam` returns the slash form (`lib/date-utils.ts:100`), the route never converts back, and `eachDay` (`slices/oura.ts:451`) splits on `-` → zero iterations. **Time-in-Zone has been feature-dead since ship (v1.164.0)** and `daily_zone_minutes` has never been populated by real traffic. Empirically reproduced on the dev server. | J | **high** | CONFIRMED + verified REAL + empirical | Plan **P2** |
| J-9 | `/api/training-stress` **500s in prod** whenever a clock anchor exists: slash-form date → `fromZonedTime('YYYY/MM/DDT00:00:00')` → Invalid Date on pinned date-fns-tz 3.2.0 → NaN into a bigint SQL param → unhandled rejection. Even without an anchor the slash date can never match dash-keyed `oura_daily_derived` rows — **OTS persist is unreachable on every branch**. | J | **high** | CONFIRMED + verified REAL | Plan **P2** |
| F8 (= E2-1, + E2-12) | **Five AI read surfaces still read frozen Cloud `oura_daily` readiness**: `signals.ts:460-462` (externalReadiness → prescribe's `external_readiness<40` rest-day arm dead), `ai-chat/context.ts:96-102` + `tools.ts:53-79` (chat answers "no Oura data"), `weekly-digest:137-145`, `health-insight:70-92`, and next-session's deload recommender (E2-12: readiness-graded deloads unreachable, every 3rd consecutive training day becomes "soft deload"). The live composite sits unread in `oura_daily_derived`. Not covered by items 3a/20/22 (verified against their wording). | F/E2 | **high** | CONFIRMED + verified REAL (merged) | Plan **P3** |
| C-1 (= H-2, + C-2 folded) | `aggregateOuraRawSamples` is a **full-history rollup fired per 255-event ingest POST**: no ds lower bound (`adapter.ts:3989-3998`), ~455k in-JS hex decodes per run post-Lever-1a, SleepNet re-inference per night with no new-night gating; ~150 runs/day, 60–100 per morning catch-up. Heading for the silent `statement_timeout` (15s) cliff ~Sep–Oct 2026, at which point health screens freeze while raw ingest keeps succeeding (K6). Also: `0x50` missing from the ingest trigger tag-set. | C/H | **high** | CONFIRMED + verified REAL (merged) | Plan **P4** |
| R-1 | BLE-1's native drain fix has a real **cursor hole-jump race** (`OuraRingService.kt:97/376/381-393/545-553`): batch N fails, batch N+1 succeeds → `confirmStored` never re-checks the non-volatile `drainIngestFailed` flag → cursor advances past the failed span; auto re-drain masks the loss. ≈ one ≤255-event batch of sleep biometrics lost per incident, silent and permanent after ring-buffer wrap. The JS-layer guard is correct but disabled on native-ingest APKs. | R/G | **high** | CONFIRMED + verified REAL | Backlog (native APK pen) + KI row |
| K4 | Local-store init failure yields a **non-null dead store** (`isSQLiteAvailable()` true, `runSQL` no-ops): food/body-metric writes are **lost even online, with success toasts**. Workout logs stay safe (direct POST path). Core data-loss half is tracked (R3 plan Task 4.2, pending); the zero-surfacing half (no banner, no telemetry) is new. | K | **high** | CONFIRMED + verified REAL (mechanism worse than reported) | Plan **P5** + pointer to R3 Task 4.2 |
| A-1 | The running UI styles its accent system with **undefined CSS vars** (`--accent-3/6/9/11` — Radix-scale names that exist nowhere in the codebase; grep-verified): accent colours silently fall back to inherited/default in both themes on every `components/running/` surface. | A | high (UI) | CONFIRMED (double-verified) | Pointer entry (UI batch) |

**Verified-downgraded to medium:** F1 (chat body-weight regex auto-log — real write at
`ai-chat/route.ts:88-101`, but the "Overview any-kg" branch is dead code and the log is announced in
the reply), E2-9 (fitness-test HRR1 deterministically null — display-only consumers), K2 (cachedFetch
never rejects → workout screen's error toast is dead code; infinite skeleton needs cold cache + no
local mirror + persistent failure), K3 (dead-lettered mutations produce zero signal at failure time —
rows persist with working Retry, so divergence not loss), C-2 (folded into C-1), J-1/J-2 (= C-5/H-4
merged: `daily_zone_minutes` compute-once-forever cache — latent until J-8 is fixed, then armed).

**Notable confirmed mediums (unverified — medium bar):** E2-2 (consumption-day re-eval drops
muscleGroups fallback → per-exercise deloads revert on non-library exercises), E2-4/E2-5/E2-6/E2-7 +
J-3/J-4/J-5 (running recovery-gate wiring: strain & hoursSinceLastRun assembled-but-never-read,
sleep input = week's best night, elapsed-hours anchored at end-of-today, pending runs advance the
80/20 sequence), E2-10 (end-test-early applies full-duration equations to truncated distance),
E2-11 (failed-generation retry keyed on a signature normal completions never produce — one Gemini
outage costs two sessions of prescriptions), G-1 (Lever-2 whitelist safety test omits rollup-consumed
0x7e/0x7f and is a hand-copied list), G-2 (one out-of-band sample Zod-rejects a whole strap batch),
K5 (strap HR flush splices the buffer before send — failed POST loses the samples), H-1/H-3
(rr_intervals unbounded; the 180d oura_heartrate prune will silently erase per-workout HR stats its
own comment claims are persisted — first loss ~Jan 2027), K1/K6/K7/K8/K9 (error-surface inventory),
J-6 (OTS MET series drops timestamps), B1/B2 (running-plan cache staleness), E1-1/E1-2/E1-4/E1-7
(calendar UUID titles, sync-time date stamping, stale multi-day resume, wrong PR badge), F2/F4/F5
(sheet_chart unvalidated parse + canvas var(), generate-program self-contradiction, builder-chat
missing whitelist), D-2 (drift guardrails can't catch envelope gaps — the CI check greps only
`this.db`/`sql`).

**Positive verifications worth recording:** 14 of 17 sampled prior-review "fixed" claims verified
still-fixed (R section); admin gating 403s on all maintenance routes (empirical); Zod rejects junk on
all probed write routes; ownership checks hold on running-run PATCH; S7 AI-signal-consistency holds;
v1.165.2 poll fix holds; cursor-advance-on-2xx sound apart from R-1; Polar H10 HRS parsing verified
against spec; Ross/Cooper/Uth-Sørensen/Jackson formulas faithful; all safe-area utilities exist with
no misuse-combos found; canvas `var()` class eradicated via `resolveColor`; check-push-mutations CI
script runs green; the backlog item "advance() stale-closure calendar payload" appears **already
fixed** on main (workout-screen.tsx:793) — annotated in the backlog for retirement.

## Empirical checks (sandbox)

Baseline on `claude/trainingai-deep-review-f8v14b` == `origin/main` (c2bd70f): `pnpm exec tsc
--noEmit` exit 0; `pnpm test` 1667 passed / 93 skipped. Dev server against the seeded local DB,
authenticated as the non-admin test user:

- **Date-param robustness:** no 500s on any probed route; `day-timeline`/`day-log`/
  `workout-sessions/day`/`oura/hr-day` 400 on `date=bogus`; `health-trends?days=abc` and
  `calendar-data?month=2026-13` 400. `zone-minutes?date=bogus` and `training-stress?date=bogus`
  fall back sanely — but see J-8/J-9: the **real client param forms** (`?from&to` dashed, `?date`
  dashed) hit the slash-normalization bug; `zone-minutes?from=2026-07-12&to=2026-07-18`
  empirically returns `days: []`.
- **Admin gating (as non-admin):** every `/api/oura-ble/*` maintenance route (vacuum,
  backfill-null-decoded, redecode, battery-poll, db-stats, device-metrics, step-counter-export,
  battery-analytics, samples ingest + summary) and `/api/admin/*` → 403. Product writes
  `live-steps`/`accel-chunks` → 400 on empty body (Zod).
- **Write validation:** `fitness-tests {}` → 400; `log-exercise {}` → 400 with field errors;
  `mood {mood:null}` → 400; `PATCH running-plan/runs/<foreign-uuid>` → 404 (ownership).

## Not exercised (honesty section)

Native SQLite/Capacitor local store (returns null/absent in the web sandbox — all local-first read
paths and the K4 dead-store mechanism are code-traced, not device-observed), BLE ring + Polar strap
radio paths (R-1 race is code-traced in Kotlin), safe-area rendering, Samsung WebView compositor
behaviour, prod data drift (local DB freshly seeded — J-9's 500 requires a prod clock anchor and is
code-traced + parser-verified, not reproduced against prod data), real Oura/Gemini tokens (no AI
route was spend-tested), push/local notification delivery, APK offline cold-start/service worker.
Each dimension section lists its own not-exercised surfaces.

## Queue mapping (no orphaned findings)

New plan docs (this PR), inserted into `docs/implementation-backlog.md` as the
**▶ Deep-review batch (2026-07-19)**:

| Plan | Covers | Queue position rationale |
|---|---|---|
| **P1** `2026-07-19-food-items-sync-envelope.md` | D-1 (critical), D-2, D-5 note, dead-letter re-queue sweep | Top of queue — live silent data loss on every new-food log |
| **P2** `2026-07-19-zone-training-stress-revival.md` | J-8, J-9, merged zone-cache cluster (J-1/J-2/C-5/H-4), J-6, E2-9, E2-10, G-2 | Two shipped features fully dead + cardio correctness |
| **P3** `2026-07-19-ai-readiness-cutover.md` | F8/E2-1/E2-12 merged, F9, E2-8, E2-11 | Serial track (god-files) — AI decisions blind to live readiness |
| **P4** `2026-07-19-ble-rollup-efficiency-and-retention.md` | C-1/H-2 merged, C-2 (debounce + 0x50), H-1, H-3, H-5, K6, G-6 + §H design notes (retention posture; owner-decision levers flagged) | Serial track — statement-timeout cliff ~Sep–Oct 2026 |
| **P5** `2026-07-19-error-surfacing-standard.md` | K1–K9 (K4 surfacing half; core → R3 Task 4.2), K5, §K design notes | The owner's stated standard, now specified |

Pointer entries (queue rows referencing this review, no separate plan):

- **BLE cursor hole-jump race (R-1)** → native APK holding pen (Kotlin fix + owner rebuild) + KI row.
- **UI polish batch (§A: A-1..A-10)** — A-1 first (undefined accent vars).
- **Caching batch (§B: B1–B8)** — B8 folds into planned_upgrades J1.
- **Workout-flow batch (§E1: E1-1..E1-7 + R-2/E1-5 offline name-fallback)** — Lane 1 territory alongside item 8.
- **Running-gate correctness (E2-2..E2-7, J-3/J-4/J-5)** — annotated onto the F3 Phase-2 entry as prerequisite tasks.
- **AI-route hygiene (§F: F1 downgraded, F2, F4, F5, F6, F7, F10, F11)**.
- **Security hygiene (§I: SEC-I1..I8, all low)**.
- **BLE/data hygiene (§G: G-1, G-5, G-7; G-3/G-4/G-8 informational)**.
- **Misc (§J: J-7 dual "Session Load" naming; §D: D-3, D-4)**.

Reconciliations: backlog "advance() stale-closure calendar payload" annotated likely-already-fixed
(E1 evidence); H-6 confirmed dup of the tracked Lever-5 owner decision; F8's dup question resolved
NOT-covered (verified against items 3a/20/22 wording).

---

*Per-dimension sections follow. Each was produced by a dedicated review agent and carries its own
Summary / Findings / Not-exercised; verdict annotations from the adversarial pass are in the
appendix. Severity labels inside dimension sections are pre-verification — the table above is
authoritative for the critical/high set.*

---

---

# Dimension A — UI & UX (S25 viewport, dark AND light themes)

## Summary

New code shipped since the 07-06/07-10 reviews is mostly disciplined — the running/fitness-tests/health-tile surfaces are split into small components, safe-area utilities are used correctly everywhere checked (all referenced utility classes exist in `app/globals.css:333-380`; no `pt-safe`+`pt-*` combos; no `pb-safe` inside bottom sheets; tab screens all use `pb-nav-safe`), chart components now consistently route `var(--x)` through `resolveColor` (the 07-06 canvas-black-bar class looks eradicated in current code), and the new resilience/illness/stress tiles explicitly honour the colour-plus-label rule. DetailHero now ships real light-mode gradients, retiring CLAUDE.md's "hardcodes dark" cautionary note.

The systemic miss is that the **running UI was built against a different design system**: its `--accent-3/6/9/11` Radix-scale tokens are defined nowhere (A-1, confirmed exhaustively — they are the only genuinely undefined CSS vars in the entire component tree), and the same screen has no loading/error state at all (A-3). Secondary theme regressions cluster in the 07-17 daytime-stress batch (#596): sub-44px bare buttons on consequential actions (A-8), raw emoji where a Lucide mapping exists (A-7), and fresh dark-only palette text (A-9). The legacy oversized orchestrators keep growing (see Component size audit): workout-screen at 1,580 lines took two more feature PRs this week.

## Findings

### A-1 — Running UI uses undefined Radix-scale `--accent-3/6/9/11` CSS variables (accent styling silently no-ops)
- Severity: high
- Status: CONFIRMED
- Dup: no
- Evidence: `components/running/prescribed-run-card.tsx:37,52-54`, `components/running/running-plan-content.tsx:89,116`, `components/running/plan-setup-sheet.tsx:63` all use `text-[color:var(--accent-9)]`, `border-[color:var(--accent-6)]`, `bg-[color:var(--accent-3)]`, `text-[color:var(--accent-11)]`. A repo-wide grep shows `--accent-3/6/9/11` are DEFINED NOWHERE — `app/globals.css` only defines `--accent`, `--accent-foreground`, and `--accent-green/cyan/amber/purple` (globals.css:60-63,80-81,124-125,149-152); no `@radix-ui/themes` package is installed (package.json has only Radix primitives). These are Radix Themes scale tokens copied from another design system.
- Failure scenario: `var()` on an undefined custom property with no fallback makes the declaration invalid-at-computed-value-time → the property resolves as `unset`. Concretely: (a) plan-setup-sheet's *selected* goal card (line 63) loses its accent border + tinted background — border falls back to `currentColor`, background to transparent — so the selected/unselected distinction is an accidental bright-vs-muted border, not the designed accent highlight; (b) prescribed-run-card's info callout (line 52) renders with no tint and a currentColor border in both themes; (c) the Footprints/CheckCircle2 accent icons inherit plain foreground colour. Same wrong-but-not-invisible result in dark and light.
- Recommendation: Replace with the app's real tokens (`--accent`, `--accent-green` family, or Tailwind theme colours) per the "semantic UI colours come from theme tokens" rule; alternatively define the scale in globals.css for both themes. Sweep for any future `--accent-N` usage in CI.

### A-2 — PlanSetupSheet submit failure is fully silent (no error state, no toast)
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `components/running/plan-setup-sheet.tsx:34-38` — the catch block is empty ("Leave the sheet open on failure so the user can retry"); the only observable change is the button text flipping back from "Creating…" to "Create plan".
- Failure scenario: Offline or 4xx/5xx on `POST /api/running-plan` → the sheet just sits there; the user taps "Create plan" repeatedly with no explanation. Violates the "no silent fallbacks on failure paths — surface an error state" rule.
- Recommendation: Show a toast or inline error line on failure.

### A-3 — Running screen renders a blank body with no loading/empty/error state until the fetch resolves
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `components/running/running-plan-content.tsx:86-127` — every body block is gated on `data` (`data && data.plan == null` line 93, `data?.plan && ...` lines 103, 113). `data` starts `null` (line 26); the cache seed (line 36) only helps on repeat visits; the revalidate fetch swallows all errors (`.catch(() => {})`, line 31). There is no skeleton, no empty state, and no failure state — only the "Running" header renders.
- Failure scenario: First-ever visit to `/running` (no cache yet) while offline or when `/api/running-plan` errors → the screen is permanently a lone "Running" heading over an empty page, with no retry affordance and no explanation. Violates both the instant-paint rule (screens seed-or-skeleton, never blank) and "self-fetching cards need an explicit failure state" (`cachedFetch` swallows `!res.ok` including the route's own rate limit).
- Recommendation: Render a lightweight skeleton while `data == null`, and an explicit error/empty state when the fetch fails with no seed.

### A-4 — `/baselines` page root missing `bg-page` (bypasses the dynamic-background system)
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `app/baselines/page.tsx:27` — root is `<div className="h-screen w-full">` with no background class, while the sibling new full-screen route `app/running/page.tsx:10` correctly uses `<div className="bg-page h-screen w-full">`. CLAUDE.md mandates "Screen backgrounds go through the `bg-page` + dynamic-background system".
- Failure scenario: The fitness-test flow (select/countdown/active/result) renders on whatever the body default paints instead of the themed page surface — the screen looks visually inconsistent with every other screen (no wallpaper/scrim layer), most visibly for a user with a dynamic background configured, in both themes.
- Recommendation: Add `bg-page` to the baselines page root, matching `app/running/page.tsx`.

### A-5 — New fitness-tests UI ships fresh hex-literal accents instead of theme tokens
- Severity: low
- Status: CONFIRMED
- Dup: likely (CLAUDE.md "455 hex literals bypass the tuned tokens" audit class — but the rule says NEW UI uses tokens, and this is new code)
- Evidence: `components/fitness-tests/latest-baseline-card.tsx:39,42,43` hardcodes `#14b8a6` (teal) three times for `accentCardStyle`, the icon, and the label; `components/fitness-tests/test-result.tsx:128` hardcodes `#22c55e`/`#ef4444` for the trend delta (the delta IS paired with a Trending icon, so it's not colour-only state); `components/fitness-tests/test-active.tsx:89` uses palette class `text-amber-500` for the GPS error line. The app has `--accent-cyan`/`--accent-green`/`--accent-amber` tokens (app/globals.css:60-63,149-152).
- Failure scenario: These colours don't follow the tuned theme palette; teal `#14b8a6` and green `#22c55e` are fixed regardless of light/dark, drifting from the token-tuned look and adding to the audit debt the rule exists to stop.
- Recommendation: Swap to the existing accent tokens (`var(--accent-cyan)` etc.) on touch.

### A-6 — ZoneBreakdown zone labels coloured with raw zone hex — Z2/Z3 labels near-illegible in light theme
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `components/health/zone-breakdown.tsx:37` renders each zone's name as 11px text coloured directly with the zone palette hex (`style={{ color: z.color }}`); the palette (`lib/health/hr-zones.ts:33-37`) includes `#eab308` (yellow, Z3) and `#22c55e` (green, Z2). Rendered inside `components/workout/done-screen.tsx:468` and `components/activity/activity-detail-sheet.tsx:155`, whose surfaces follow the theme. Contrast of #eab308 on a light card is ~1.6-1.9:1 (far below the 4.5:1 body-text rule). Compare `components/health/time-in-zone-card.tsx:130-135`, which does it right: a colour swatch + `text-muted-foreground` label.
- Failure scenario: Light-theme user opens the workout done screen or an activity detail sheet → the "Z2 Light" / "Z3 Aerobic" row labels are washed-out yellow/green on a light background and effectively unreadable.
- Recommendation: Use the swatch-plus-neutral-text pattern from time-in-zone-card, or a scheme-conditional colour pair.

### A-7 — AI-periodization status card renders raw session-icon emoji, bypassing the existing Lucide mapping
- Severity: low
- Status: CONFIRMED
- Dup: likely (2026-07-02 emoji audit tracks the emoji-vs-Lucide class as "replace on touch" — but this surface WAS touched/shipped 2026-07-17 in #596 and still renders emoji)
- Evidence: `components/health/ai-periodization-status-card.tsx:119` — `<span className="text-base flex-none">{s.icon ?? '💪'}</span>` renders the session's stored emoji as text with an emoji fallback. `lib/session-icon.tsx:51` exports `getSessionIcon(emoji, palettePosition)` which exists precisely to map these stored emoji to Lucide icons; other session surfaces use it.
- Failure scenario: Health tab's periodization card shows platform emoji glyphs while every session list/card around it shows Lucide icons — the established convention (sessions 149/155) regresses on a freshly shipped surface.
- Recommendation: Use `getSessionIcon(s.icon)` like sibling session rows.

### A-8 — Consequential actions on new cards are bare sub-44px buttons ("Take deload week now", "Use prior data →")
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `components/home/early-deload-card.tsx:27-37` — "Take deload week now" is a bare `<button>` with `text-xs rounded px-3 py-1.5` (~28px tall) and "Dismiss" is a bare text-only `<button>` with no padding at all; both shipped with the daytime-stress wiring (#596, 2026-07-17). `components/health/ai-periodization-status-card.tsx:125-131` — "Use prior data →" is a bare `<button>` with `text-[10px] hover:underline` (~14px tall). None use the shared `<Button>` (`components/ui/button.tsx`), and per the no-global-selector rule there is no element-level tap floor to catch them.
- Failure scenario: On the S25, "Take deload week now" mutates the training program (POST `/api/confirm-early-deload`) from a ~28px target sitting 8px from "Dismiss" — a mis-tap either fires a deload week the user didn't want or dismisses a warning they meant to act on. "Use prior data →" applies baseline data from a ~14px target. Violates the ≥48dp touch-target rule for the highest-consequence taps on these cards.
- Recommendation: Use the shared `<Button size="sm">`/`variant="ghost"` primitives (which carry the 44px floor) for all three controls.

### A-9 — New surfaces keep shipping dark-only `-400`/`-500` palette text that washes out in light theme
- Severity: low
- Status: CONFIRMED
- Dup: likely (07-10 review UI-class "light-mode borders/palette literals" + CLAUDE.md hex/palette audit — but these are instances in code shipped 2026-07-17/18)
- Evidence: `components/settings/chest-strap-pairing.tsx:84` — pairing error rendered `text-red-400` (contrast ~2.9:1 on a light card); `components/health/trend-sparkline.tsx:43` — delta chips `text-green-400`/`text-red-400` at 10px; `components/health/day-overlay-sheet.tsx:191` — HRR adequate/inadequate in `text-green-400`/`text-red-400`. Contrast: the same PRs show the correct pattern exists (`ai-periodization-status-card.tsx:146,149` uses `text-amber-600 dark:text-amber-400`; `early-deload-card.tsx:22` uses `text-amber-700 dark:text-amber-400`), so this is inconsistency within the same shipping window, not ignorance of the pattern.
- Failure scenario: Light-theme user gets a nearly invisible strap-pairing error message (the only failure feedback that flow has) and washed-out trend/HRR chips. The delta chips do pair colour with ▲/▼ symbols, so state survives — legibility doesn't.
- Recommendation: Apply the `-600 dark:-400` dual-shade pattern (or tokens) on touch; the pairing error especially, since it is a sole failure surface.

### A-10 — Shared lazy TrendSparkline wrapper puts a loading skeleton on cache-seeded health cards
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `components/health/trend-sparkline-lazy.tsx:8-14` — the one shared `dynamic()` wrapper for all health trend sparklines declares `loading: () => <Skeleton className="h-[152px] w-full" />`. Its consumers are cache-seeded: e.g. `components/health/workout-density-card.tsx:17-19` seeds `trends` synchronously from `readTodayCacheSync` (and may receive parent-resolved data via props) before the chunk has loaded. CLAUDE.md: "A `loading:` skeleton on a cache-seeded card is a contradiction (the skeleton wins and defeats the cache-seed instant-paint rule)."
- Failure scenario: On APK cold start, opening a health tab shows a 152px pulsing skeleton for each sparkline card even though the data was already in hand — a repeat-visit skeleton flash, the exact bug class sessions 147/155/165/167 retrofitted. Once the chunk is cached the flash is one frame, but it recurs on every cold start / SW update.
- Recommendation: Replace the pulse skeleton with a fixed-height static placeholder (empty 152px box), matching `components/muscle-heatmap.tsx:10`'s approach.

## Component size audit

Line counts (2026-07-19, `wc -l`), threshold ~800; churn = commits touching the file in the visible (post-2026-07-17, shallow-clone) history:

| File | Lines | Churn | Judgement |
|---|---|---|---|
| `components/workout-screen.tsx` | 1,580 | 5 | **Actively absorbing** — WK-13/16 rollover fix (#643) and stale-session-id identity (#628) both landed here this week; the designated orchestrator, but at 2× the cap and still growing. |
| `app/session-select/session-select-content.tsx` | 1,362 | 2 | **Actively absorbing** — named hotspot; still gaining features (#628). |
| `components/config-screen.tsx` | 997 | 2 | Absorbing (id-identity sweep touched it); over cap. |
| `components/config/program-editor-sheet.tsx` | 963 | 2 | Absorbing; over cap. |
| `app/health/health-content.tsx` | 879 | 4 | **Actively absorbing** — pull-to-sync gating (#646) + health tiles keep landing here despite `health-sections.tsx` split. |
| `components/workout/active-workout-screen.tsx` | 814 | 1 | Just over cap; relatively stable this window (known 1Hz self-tick refactor deferred in backlog). |
| `components/chat.tsx` | 794 | 1 | At the line; stable. |
| `app/health/health-sections.tsx` | 788 | 5 | **At the line and hottest churn** — every new health tile (timeInZone etc.) registers here; will cross 800 next feature. |
| `components/more/profile-tab.tsx` | 767 | 2 | Approaching; moderate churn. |
| `components/workout-builder/builder-review.tsx` | 731 / `builder-wizard.tsx` 673 | — | Below cap, stable. |
| `components/oura-ble/oura-ble-debug.tsx` | 728 | — | Admin-only console; acceptable. |

Net: the five files CLAUDE.md names as hotspots are all still over (or at) the cap and four of them absorbed new features in the last week — the "extract new features into `components/` children" rule is being followed for brand-new surfaces (running/, fitness-tests/, health tiles are properly split into small files) but not for changes to the legacy orchestrators.

## Not exercised

- No on-device (S25 APK) rendering: every finding is code-verified only; real safe-area insets, Samsung WebView compositor behaviour, and Android system back/edge-gesture conflicts with `TabSwipeNavigator`'s 24px edge zones (`components/shell/tab-swipe-navigator.tsx:9`) could not be observed — that gesture may be partially shadowed by Android gesture-nav on device.
- No visual rendering at the ≤640px viewport in either theme — contrast figures (A-6, A-9) are computed from the colour values, not screenshots.
- SVG-presentation-attribute `stroke={color}` with `var(--x)` in `components/ui/sparkline.tsx:52` was NOT flagged: it is a long-shipped shared primitive presumed device-verified, but I could not confirm Samsung WebView resolves var() in SVG attributes.
- Git history is shallow (50 commits, earliest 2026-07-17), so "new since 07-10" dating for a few files (early-deload-card, illness-advisory-banner) relies on the #596/#610 PR messages rather than full history.
- Dynamic-background/dark-vs-light wallpaper interaction of the missing `bg-page` on `/baselines` (A-4) was reasoned, not rendered.
- Admin-only consoles (`components/oura-ble/*`) were skimmed, not swept — owner-only debug surfaces, lower stakes.

---

# Dimension B — Caching & invalidation

## Summary
The core cache machinery is in good shape: the prior review's fixes (CACHE-F1 mixed variants, CCH-1 workout-card freshWithinTtl proof, CCH-3 next-session TTL, legacy-seed clearing in the two big groups, canonical TTLs in `lib/cache-ttl.ts`) are all holding, and I found **no key fetched with divergent TTLs, no key mixing `cachedFetch`/`cachedFetchToday`, no unsafe prefix-sibling, and every `freshWithinTtl:true` site except none has a provable invalidation story**. The CACHE_TASKS warm list matches read-site key/TTL/variant exactly.

The recurrence is exactly where the brief predicted: **the post-2026-07-10 keys were shipped without joining the group system**. `training-stress`, `body-battery`, and `hr-profile` appear in no invalidation group at all; `running-plan` — the most consequential because it renders a training prescription and a recovery-gate decision — additionally caches a today-scoped payload (`run.date = today`, `run.status`) under a plain date-less `cachedFetch` key, so with the 7-day offline seed floor it will paint yesterday's "Today's run is done" (or yesterday's gate decision) across midnight, indefinitely when offline. The pull-delta invalidation blocks also drifted: `domains.fitnessTests` is ignored by both consumers and `domains.running` by the More-tab copy that claims to mirror sync-provider. One invariant regression: `invalidatePrescriptionChanged` deletes `workout-data:meta` via prefix but skips `clearLegacyHomeSeeds()`, violating the rule written at the top of `cache-groups.ts` itself.

Because every non-`freshWithinTtl` read revalidates on mount, most missing-group gaps degrade to "stale seed flash + wrong data only while offline/refetch-failed" rather than hard staleness — severities are set accordingly (B1/B2 medium, rest low).

## Findings

### B1 — `running-plan` cache holds today's prescription/run status with no date embed and no date-on-read guard
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `components/running/running-plan-content.tsx:36-38` seeds via plain `readCacheSync<PlanResponse>('running-plan')` and fetches via plain `cachedFetch` (not `cachedFetchToday`); the payload's `run` field is a prescribed_run row explicitly created *for today* by `app/api/running-plan/route.ts:150-158` (`date: today`, `status`). The render at `running-plan-content.tsx:84,113-123` uses `status = localStatus ?? data?.run?.status` and shows "Today's run is done — nice work." when it's `completed`. `localStatus` only populates if the *local store* has a row dated today (`:43-51`), which it won't on a fresh day. `lib/sqlite/cache.ts:102-108` floors the localStorage seed to 7 days (`OFFLINE_SEED_TTL_FLOOR`), so the entry survives midnight by design.
- Failure scenario: user completes/skips Monday's run (cached payload now has `run.status='completed'`). Tuesday morning, open the Running screen: the seed paints "Today's run is done" for Monday's run. Online it corrects when the refetch lands (~1s); offline (the exact APK scenario the 7-day seed floor exists for) it stays wrong indefinitely — today's actual prescription is never shown. Inverse case: yesterday's `pending` prescription (e.g. "Long run, proceed") paints as today's, with yesterday's gate decision.
- Recommendation: switch the key to `cachedFetchToday`/`readTodayCacheSync` (it is exactly the "date-less today key" case those were built for), or validate `run.date === todayInTz()` on read before trusting `run.status`/`prescription`.

### B2 — `running-plan` missing from the write groups of every upstream writer (activity, workout, fitness-test)
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/running-plan/route.ts:39-107` derives the prescription and recovery gate from activity logs (`hoursSinceLastRun`, `runsThisWeek`), workout sessions (`hoursSinceLowerBodyStrength`, `lastLowerBodyVolumeKg`, ACWR/strain), sleep sessions, readiness, and fitness tests (`resolveSnapshot`, `:110-127`). But `lib/cache-groups.ts:176-193` (`invalidateActivityWrites`), `:15-62` (`invalidateWorkoutSummaries`) and `:196-201` (`invalidateFitnessTests`) none contain `'running-plan'` — only plan setup, run mark, and the pull-delta `running` domain invalidate it (`cache-groups.ts:204-206`, `running-plan-content.tsx:74`, `sync-provider.tsx:126`).
- Failure scenario: user logs a run via the activity flow, or finishes a heavy leg workout, then opens the Running screen: the seed paints the pre-write prescription and gate ("proceed" although the gate should now say "soften"/"rest"). Online this is a stale flash until the SWR refetch corrects it; offline (or if the refetch fails) the wrong gate decision persists — and this is a training-prescription surface, i.e. wrong training numbers, not just cosmetics. Completing a cardio fitness test also changes the fitness snapshot (VO₂max/maxHr → target HR zones) with no invalidation.
- Recommendation: add `invalidateCache('running-plan')` to `invalidateActivityWrites`, `invalidateWorkoutSummaries`, and `invalidateFitnessTests` (cheap: one bare key each).

### B3 — `training-stress` key is in no invalidation group at all
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: read at `components/health/training-stress-line.tsx:17-23` and `components/workout/training-stress-badge.tsx:16-21` (`cachedFetchToday`, `TRAINING_STRESS_TTL` = 30 min, consistent). `grep invalidateCache('training-stress')` → zero hits; not in `lib/cache-groups.ts`. Its payload (`app/api/training-stress/route.ts:32-72`) derives from derived readiness, body metrics (RHR/weight) and the ring's MET stream — all of which change on BLE drains (`invalidateOuraSync`, which the autonomous-drain watcher at `sync-provider.tsx:399-428` fires) and body-metric writes, none of which clear this key.
- Failure scenario: done-screen badge / health card seed-paints the pre-drain OTS value; because `cachedFetchToday` always revalidates, the exposure is a stale first paint plus a wrong value whenever the network refetch fails. Bounded, but it violates the "every writer's group contains the key" rule the project treats as strict.
- Recommendation: add `'training-stress'` to `invalidateOuraSync` and `invalidateBodyMetricWrite` (and `invalidateWorkoutSummaries` for symmetry with `training-load`).

### B4 — `body-battery` key is in no invalidation group at all
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: fetched with `cachedFetchToday`/`TTL_SHORT` at `app/session-select/session-select-content.tsx:685-688`, `components/sync-provider.tsx:343`, `components/nutrition/end-of-day/end-of-day-review.tsx:75` (TTLs consistent). No `invalidateCache('body-battery')` anywhere; absent from `lib/cache-groups.ts`. Its inputs (stress/HR/sleep from BLE, workouts) change on every drain and workout completion; `invalidateOuraSync`/`invalidateWorkoutSummaries` don't clear it. Note the pull-to-sync path (`session-select-content.tsx:585-595`) relies on `refreshTick` refetches rather than invalidation to correct it.
- Failure scenario: same class as B3 — stale seed paint of the battery gauge after a drain; also `reconcileHealthAlerts` (`sync-provider.tsx:340-353`) can fire a stress notification off a battery payload that a failed refetch left stale (cached value still same-day, so the today-envelope doesn't reject it).
- Recommendation: add `'body-battery'` to `invalidateOuraSync` (and `invalidateWorkoutSummaries`/`invalidateReadinessInputs`).

### B5 — `hr-profile` key has no invalidation story
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `components/workout/live-hr-chart.tsx:44-46` (`cachedFetch`, `HR_PROFILE_TTL` = 6h, sole site). Payload (`app/api/hr-profile/route.ts:32-41`) = DOB-derived HRmax + 28-day RHR average from `body_metrics`. Writers: profile edits (`invalidateUserProfile` — only clears `more-user-profile`), body-metric writes, Oura/BLE RHR backfill — none touch `hr-profile`.
- Failure scenario: after a BLE sync updates RHR (or a DOB/profile fix), live-workout HR zones are computed from the stale profile for up to one SWR round-trip; zone drift is small (Karvonen bounds), so impact is minor.
- Recommendation: add `'hr-profile'` to `invalidateBodyMetricWrite`/`invalidateOuraSync`, or document it as an accepted TTL-only key.

### B6 — pull-delta invalidation ignores `domains.fitnessTests` everywhere, and More-tab sync also ignores `domains.running`
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `lib/local-store/sync-engine.ts:437` sets a `fitnessTests` domain flag on pulls. Neither consumer acts on it: `components/sync-provider.tsx:120-131` handles biometrics/programs/workouts/nutrition/supplements/activity/running/injuries/ouraDaily only; `app/more/more-content.tsx:129-137` — whose comment says "mirrors sync-provider.tsx" — additionally omits `domains.running` (sync-provider handles it at `:126`; more-content has no `invalidateRunningPlan` branch). So a pull that brings prescribed-run or fitness-test rows via the More-tab manual sync never clears `running-plan`/`fitness-tests`.
- Failure scenario: single-device impact is limited because the APK fitness-tests/prescribed-run read paths are local-store-first (`components/fitness-tests/latest-baseline-card.tsx:18-27`, `running-plan-content.tsx:43-51`); the stale key mainly hits the web/QA fallback and the `running-plan` server payload (`run.status`) after a More-tab sync reconciles an outbox-pushed run completion — screen can keep showing "pending" from cache.
- Recommendation: add `if (delta.domains.fitnessTests) await invalidateFitnessTests()` to both sites and `if (delta.domains.running) await invalidateRunningPlan()` to more-content; the drift between the two "mirror" blocks is the sibling-surface smell worth a CI check.

### B7 — `invalidatePrescriptionChanged` drops `workout-data:meta` but does not clear the legacy home seeds, violating cache-groups' own invariant
- Severity: low
- Status: CONFIRMED
- Dup: no (CCH-2 fixed `invalidateProgramStructure`; this group was added later and misses the same thing)
- Evidence: `lib/cache-groups.ts:3-5` states the invariant: "every group that invalidates workout-data:meta or next-session MUST also clear these" (`ta_recommendation_v1`/`ta_meta_v1`). `invalidatePrescriptionChanged` (`:259-267`) calls `invalidateCache('workout-data')` — a prefix match that deletes `workout-data:meta` (LIKE `'workout-data%'`, `lib/sqlite/cache.ts:145`) — but never calls `clearLegacyHomeSeeds()`. Same for the ad-hoc `invalidateCache('workout-data')` at `components/workout-screen.tsx:1266` and `invalidateCache('workout-data:meta')` at `app/session-select/session-select-content.tsx:970`. `session-select-content.tsx:292-299` reads `ta_meta_v1` in the first-paint path.
- Failure scenario: user accepts an AI prescription / executes a phase transition (which changes `phaseStatus`/`perSessionPhaseStatus` in the meta payload) → the TTL cache is correctly dropped, but home's first paint re-hydrates the pre-transition phase state from the surviving `ta_meta_v1` sessionStorage seed until the refetch overwrites it — exactly the stale-seed-wins race the invariant comment describes.
- Recommendation: call `clearLegacyHomeSeeds()` from `invalidatePrescriptionChanged` (export it or fold the two ad-hoc call sites into a group that does).

### B8 — ad-hoc single-key `invalidateCache()` calls at write sites (oura-unreviewed-workouts ×4, sleep-performance-correlation, workout-data/meta)
- Severity: low
- Status: CONFIRMED
- Dup: likely (planned_upgrades J1 "invalidateCache( inline lists" residual CI check)
- Evidence: `components/activity/exercise-review-sheet.tsx:142,160`, `components/activity/exercise-detected-card.tsx:87,96` (`invalidateCache('oura-unreviewed-workouts')` beside a group call), `app/session-select/session-select-content.tsx:592` (`invalidateCache('sleep-performance-correlation')` appended to a group list), `components/workout-screen.tsx:1266`, `session-select-content.tsx:970`.
- Failure scenario: none acute today (each key is also in a group where needed); the risk is the documented drift class — the next writer of the same domain won't know these extra keys exist.
- Recommendation: fold `oura-unreviewed-workouts` into a small `invalidateOuraWorkoutReview()` group helper; keep the J1 CI check on the backlog.

## Proof table (key → writers → group ok/MISSING)

Method: all 231 `cachedFetch`/`cachedFetchToday`/`readCacheSync`/`readTodayCacheSync` call sites enumerated (grep, excluding cache.ts + tests). "Variant OK" = no key is fetched with both `cachedFetch` and `cachedFetchToday`. TTLs cross-checked against `lib/cache-ttl.ts`.

### New keys (shipped since ~2026-07-10) — full proof

| Key | Variant / TTL (all sites) | Writers that change the payload | Group coverage |
|---|---|---|---|
| `zone-minutes:<from>:<to>` | `cachedFetch` / `ZONE_MINUTES_TTL` (time-in-zone-card.tsx:61, sole site; `to`=today so key is date-embedded) | workout complete (HR rows), activity save, BLE drain/Oura sync, strap `/api/hr-ingest` | **OK** — `'zone-minutes:'` prefix in `invalidateWorkoutSummaries`:34, `invalidateOuraSync`:154, `invalidateActivityWrites`:191. Strap ingest during a workout is covered at completion by the workout group; route recomputes "today" server-side (reconcile-on-read). |
| `fitness-tests` | `cachedFetch` / `FITNESS_TESTS_TTL` ×2 (latest-baseline-card:24, test-select:31 — web fallback only; APK reads local store) | test save (test-result.tsx:84,107 → `invalidateFitnessTests` **OK**); pull delta `domains.fitnessTests` | **MISSING** in both pull consumers (sync-provider.tsx:120-131, more-content.tsx:129-137) → finding B6 |
| `running-plan` | `cachedFetch` / `RUNNING_PLAN_TTL` ×2 (running-plan-content:31,36; plan-setup via group) | plan create (OK), run complete/skip (running-plan-content:74 OK), pull `domains.running` (sync-provider:126 OK; more-content **MISSING**), activity run log (**MISSING** in `invalidateActivityWrites`), workout complete (**MISSING** in `invalidateWorkoutSummaries`), fitness-test save (**MISSING** in `invalidateFitnessTests`) → findings B1/B2/B6. Also today-payload with no date guard (B1). |
| `training-stress` | `cachedFetchToday` / `TRAINING_STRESS_TTL` ×2 (training-stress-line:20, training-stress-badge:18; badge date prop = `todayInTz()` at done-screen:398, so key/date coherent) | BLE drain / Oura sync (MET+readiness), body-metric writes (RHR/weight) | **MISSING — key in no group at all** → finding B3 |
| `body-battery` | `cachedFetchToday` / `TTL_SHORT` ×3 (session-select:685, sync-provider:343, end-of-day-review:75) — consistent | BLE drain (stress/HR), sleep/mood writes, workout complete | **MISSING — key in no group at all** → finding B4 |
| `hr-profile` | `cachedFetch` / `HR_PROFILE_TTL` (live-hr-chart:46, sole site) | profile DOB edit, body-metric/Oura RHR writes | **MISSING — no group** (deliberately slow-changing per comment) → finding B5 |
| `workout-load-history:<sessionId>` | `cachedFetch` / `TTL_SHORT` (day-review-sheet:59-62, sole site) | workout complete/edit | **OK** — `'workout-load-history:'` prefix in `invalidateWorkoutSummaries`:59 |
| `oura-unreviewed-workouts` | `cachedFetch` / `TTL_MEDIUM` (exercise-detected-card:53-58, sole site) | review/dismiss (exercise-review-sheet:142,160; exercise-detected-card:87,96 — ad-hoc but present), Oura sync | **OK** (in `invalidateOuraSync`:165) — style finding B8 |
| `health-trends-summary` | `cachedFetchToday` / `HEALTH_TRENDS_SUMMARY_TTL` ×6 (health-content:336, heart-rate:37, health-score-detail:157, oura-section:84, nutrition-activity-trends-card:28, workout-density-card:28) — all consistent | workout, oura sync, activity, body-metric, nutrition writes | **OK** — bare key present in all five groups (cache-groups:56,163,189,215,296); NOT matched by `'health-trends:'` prefix (hyphen ≠ colon — safe, documented at :52-56) |
| `session-explain-insight:<id>` | `readCacheSync` seed + `setCached` after stream (ai-insight-card:20, TTL_LONG) | its own stream overwrite each open | acceptable — regenerated on every view; no invalidation needed |
| `resilience` | no dedicated key — rendered from `readiness-score` payload (`ownResilience*` fields, readiness-score/route.ts:451-453) | — | covered by `readiness-score` groups ✓ |

### Old keys — spot-checks (TTL/variant/invalidations)

| Key | Check | Result |
|---|---|---|
| `readiness-score` | `cachedFetchToday`+`READINESS_SCORE_TTL` at every site (health-content:310, heart-rate:34, health-score-detail:154, sync-provider:50,342, overview-screen:165) | ✓ one TTL, one variant; in workout/readiness/biometrics/oura groups |
| `next-session` | `NEXT_SESSION_TTL`, `cachedFetchToday` ×4 + warm `today:true` (workout-select:143, session-select:485, session-explain:39, sync-provider:40,278) | ✓ consistent (CCH-3 fix holding) |
| `muscle-recovery` | `MUSCLE_RECOVERY_TTL` ×4 (workout-select:180, session-select:703, health-content:366, warm list:54) | ✓ |
| `exercise-history:<name>` | `EXERCISE_HISTORY_TTL` ×4 (exercise-history-sheet:66, exercise-stats-sheet:61, active-workout-screen:147, exercise-summary-screen:66) | ✓ one TTL; prefix in workout+exercise-logged groups |
| `body-metadata` | `TTL_MEDIUM` ×7 incl. warm list; date-on-read via `isBodyMetadataFresh` at fetch-hit paths (cache.ts:305-307, end-of-day-review:82) | ✓ |
| `weekly-stats`, `progress-summary`, `training-load`, `home-day-timeline`, `oura-stats` | today-envelope variant at every site; warm list `today:true` matches reader variant | ✓ (CACHE-F1 fix holding) |
| `calendar-data:<ym>` / `streak-data` | TTL_MEDIUM / TTL_LONG at fetch sites AND at the optimistic `setCached` in workout-screen:1289-1291 | ✓ TTLs match per key |
| `workout-card:<id>` (freshWithinTtl, TTL_LONG) | invalidation proof: `invalidateWorkoutSummaries`:51, `invalidateProgramStructure`:108, `invalidateExerciseLogged`:83, `invalidatePrescriptionChanged`:263 — writers = workout complete, exercise log, config edit, prescription accept/dismiss/transition | ✓ (CCH-1 fix holding); comment-documented at workout-select:162-164 |
| `exercise-library` (freshWithinTtl ×3: stats-content:62, add-exercise-sheet:65, config-screen:125) | writers: add-exercise-sheet:144,171; admin exercise-manager:272,287 → `invalidateExerciseLibrary` | ✓ all writers covered |
| `activity-types` (freshWithinTtl ×2: activity-history-card:57, log-activity-sheet:28; health-content:355) | writer: admin activity-type-manager:135,153 | ✓ |
| `progression-styles` (freshWithinTtl, config-screen:116) | writers: every config-screen save path → `invalidateProgramStructure` (contains `'progression-styles'`:103) | ✓ |
| Legacy seeds `ta_recommendation_v1`/`ta_meta_v1` | cleared by `invalidateWorkoutSummaries`+`invalidateProgramStructure`; `ta_streak_v1`/`ta_calendar_v2` confirmed dead (zero source hits) | ✓ except `invalidatePrescriptionChanged` + 2 ad-hoc sites → finding B7 |
| Prefix-sibling audit | group prefixes: `achievements:` `calendar-data:` `zone-minutes:` `day-log:` `workout-sessions-day:` `exercise-history:` `health-trends:` `workout-card:` `workout-load-history:` `oura-hr-day:` `ai-periodization-session:` `nutrition-food-logs-` `nutrition-recent-for-meal:` `friends-` `workout-data` — checked every bare key against each: no unsafe sibling (`health-trends-summary` vs `health-trends:` is safe and deliberately distinct; `nutrition-food-items-all` not matched by `nutrition-food-logs-`; `workout-data` prefix intentionally covers `:meta`/`:<tab>`/`:deload`) | ✓ |
| Mixed-variant audit | every shared key checked across its sites — no key is fetched with both `cachedFetch` and `cachedFetchToday` | ✓ |
| CACHE_TASKS warm list (sync-provider:38-62) | each of the 20 entries compared against its read sites: key, TTL constant, and `today` flag all match reader variant | ✓ |
| `mood:<date>` | date-embedded key, `MOOD_TTL` both sites; writes go through optimistic `setCached` (mood-checkin-sheet:160,171) rather than invalidation — consistent with the no-null-clobber rule | ✓ |
| `day-log:<date>` | TTL_MEDIUM ×2 (week-day-sheet:31, health-content:497); payload = exercises+bodyMeta+activity (no food-log rows, day-log/route.ts:37-43), writers covered by workout/exercise/activity/body-metric groups. bodyMeta macros derive from body_metrics; nutrition writes that roll into body_metrics invalidate `body-metadata` but not `day-log:` — borderline, SWR-bounded, not raised as a finding | ✓ (note) |

## Not exercised
- Native SQLite `api_cache` layer (the APK path of `getCached`/`setCached`/`invalidateCache`) — reasoned from code only; web sandbox uses the localStorage branch.
- Runtime verification of the B1 cross-midnight scenario (needs a device with a day-old `running-plan` seed, ideally offline).
- Service-worker HTTP cache interaction with the client key cache (SW rework is another dimension); `Cache-Control` SWR headers were noted present on all new routes but not behaviorally tested.
- `updateCache` optimistic-paint consumers beyond the workout-screen calendar/streak stamps (spot-checked those two only).
- Admin-screen bare `fetch` sites (admin/pending-count 3× bare fetch is already tracked in planned_upgrades B6 — not re-raised).

---

# Dimension C — Performance & perceived latency

## Summary

The dominant performance risk in the app today is server-side, not client-side: the Oura BLE post-ingest rollup (`aggregateOuraRawSamples`) is a **full-history recompute with no time bound** — every run re-reads essentially the whole `oura_raw_samples` table (~307k rows and growing ~35-40k/day), hex-decodes ~280k bodies in JS (worse since Lever 1b nulled the persisted `decoded` column), re-runs neural sleep staging over every historical night, and re-derives steps/SpO₂/summaries/illness for all time — and it fires **once per 255-event ingest POST**, so a morning drain runs it dozens of times back-to-back (C-1, C-2). Cost grows linearly forever; nothing bounds it but the ring's own history. The fix shape is cheap (the `(user_id, tag, ring_timestamp_ds)` index already supports a cutoff, and the HR-series step already demonstrates the bounded pattern in the same function) plus a debounce so a drain triggers one trailing rollup instead of N.

Client-side, the perceived-latency story has genuinely improved and mostly held: the 2026-07-11 offline-feel review's Layer A (kill the ~1s tab-tap RSC round-trip) shipped as router `staleTimes` (v1.133.0) plus the persistent tab shell (`components/shell/tab-shell.tsx` — home statically imported, other four tabs code-split with keep-alive `content-visibility:hidden` panes, `replaceState` URL sync); what still stands is exactly the DUP-tracked open set: START-2/P2.1 network-first document, START-3/P2.2 no splash screen, START-5/P2.3 startup request stampede, and the P4 remote-shell structural ceiling — all already queued, so not re-raised here. Entry-chunk bundle discipline is good (home statically imports no heavy dep; charts/markdown/AI overlay are all `dynamic({ssr:false})`); the one slip is chart.js riding statically in the Health tab's base chunk (C-3). Prior render-discipline fixes (leaf 1 Hz tickers, memoized heatmap props, HomeCardWidget stable props) held on re-inspection; the one fresh instance of the defeated-memo class is in the new running engine (C-4). Serial client save-path fetches are confined to the sanctioned web-only fallback (DUP B5). Among the hot server read routes, `health/trends`, `oura/hr-day` and `readiness-score` are well-bounded; the new `daily_zone_minutes` reconcile-on-read cache has a never-invalidated staleness hole plus a serial cold path (C-5).

## Findings

### C-1 — aggregateOuraRawSamples is a full-history rollup: unbounded reads, per-row hex decode, and per-night ONNX re-inference on every run
- Severity: high
- Status: CONFIRMED
- Dup: no (the DUP index tracks rollup *correctness* items and Lever-1/2 storage levers; the unbounded-recompute cost itself is untracked)
- Evidence:
  - `lib/data/postgres/adapter.ts:3989-3998` — `rowsByTags` selects from `oura_raw_samples` with `WHERE user_id = ? AND tag IN (...)` and **no `ring_timestamp_ds` lower bound**; line 4000-4011 fires 10 such queries covering tags 0x76, 0x4b/0x4e/0x5a, 0x80/0x60 (IBI — the densest stream), 0x5d, 0x6f, 0x8b, 0x86 (always-on daytime HR), 0x46/0x69, 0x72/0x75, 0x50 — i.e. essentially the whole table, every run.
  - `adapter.ts:3996` — since Lever 1b nulled `decoded` (306,948 rows in prod, 282,256 of which carried `decoded` — `docs/oura-ble-operations.md` §1 I16, device-verified 2026-07-15), nearly every fetched row now runs `decodeEventBody(tag, hexToBytes(bodyHex))` **in JS memory on every rollup invocation** — ~280k+ hex decodes per run, growing daily.
  - `adapter.ts:4085` + `4108-4109` — the night loop iterates every window in full history, and `inWindow` is a **linear filter over the whole tag array**, called ~8× per window (clamp at 4097, phase 4122, MET 4144, HRV 4158, HR 4177, staging 4219/4224/4225/4233, snInput 4256-4280, temps 4381/4385) → O(nights × total rows).
  - `adapter.ts:4215, 4288-4297` — the Ring 5 emits no phase events (`phases.length === 0` always), so **every historical night** runs the heuristic stager AND the SleepNet neural stager (`sleepNetStages5Min`, onnxruntime-node inference — session cached in `lib/oura-models/inference/session.ts:14`, but inference itself per night per run).
  - `adapter.ts:4506-4517` — the `steps_estimate` step re-fetches **all** 0x7e/0x7f rows (no time bound) and re-pairs/re-classifies full history each run.
  - `adapter.ts:4667-4670` — `computeDailySummaries` over all nights + `replaceOuraDailySummary` rewrites the whole summary table each run; `4676-4685` — the illness step loops **all** summary rows with one serially-awaited `upsertOuraDailyDerived` per night (N−1 sequential round-trips).
  - `adapter.ts:4728-4729, 4744-4810` — resilience is the only capped step (21 days), but per the in-code comment at 4701-4702 `buildDaytimeStressSeries` runs **one ONNX pass per 30-min bucket** → up to 21 days × 48 buckets ≈ 1,000 dHRV inferences per rollup invocation.
  - Contrast: the HR-series step (`adapter.ts:4557-4558`) shows the intended pattern — a 14-day `hrSeriesCutoffDs` — but only that one step and resilience are bounded; sleep windows, HRV/RHR, SpO₂, steps, wear, summaries, and illness are all full-history.
  - The index `oura_raw_samples_user_tag_ts (user_id, tag, ring_timestamp_ds)` (`migrations/114_oura_raw_samples.sql:19-20`) matches the WHERE and *would* support a `ring_timestamp_ds >= cutoff` range predicate — the bound is simply never passed.
- Failure scenario: at ~300k rows after ~8 days of BLE capture (≈35-40k rows/day), every rollup already pulls the entire table into Node memory, hex-decodes ~280k bodies, and re-runs neural staging over every night since 2026-07-07. Growth is linear and unbounded: in 3 months this is ~3.5M rows and ~90 SleepNet nights per invocation. Cost surfaces as multi-second-to-minute ingest POST latency, Railway dyno CPU/memory pressure (risk of OOM given each row carries a hex string), `statement_timeout` exposure on the big reads, and — because the rollup runs inside the ingest request (C-2) — a progressively slower drain whose batches keep the DB pool busy. Nothing before ~yesterday can change (the ring's history only moves forward; older nights re-derive to the same values), so all of that work is recompute-to-identical-output.
- Recommendation: bound every step the way `hr_series` already is — compute a cutoff (e.g. `anchor.anchorDs − N days`, N≈14-21 to cover the resilience window) and pass it into `rowsByTags` and the 0x7e/0x7f fetch as `gte(ringTimestampDs, cutoff)`; keep the existing Redecode admin route as the explicit full-history path (it already exists at `app/api/oura-ble/samples/redecode/route.ts` for exactly this). Batch the illness upserts (or restrict them to the same window).

### C-2 — The full rollup fires once per 255-event ingest POST (dozens of times per drain), and the trigger tag-set is inconsistent (0x50 missing)
- Severity: high
- Status: CONFIRMED
- Dup: no (I12 in `docs/oura-ble-operations.md` tracks rollup *failure* handling, not its per-batch invocation cost; the 0x50 gap is raised by the G reviewer for correctness — cross-referenced here for its perf face)
- Evidence:
  - `app/api/oura-ble/samples/route.ts:70-85` — after `insertOuraRawSamples`, the route calls `repo.aggregateOuraRawSamples(userId, tz)` whenever the batch contains any of the 16 `BIOMETRIC_TAGS`. Per `docs/oura-ble-operations.md` §2, the ring returns **255 events per GetHistory batch and the plugin does one POST per batch, in-order**. An overnight backlog (~8h of dense IBI at hundreds of beats per 5-min epoch) is dozens of batches → the morning drain runs the entire C-1 full-history rollup dozens of times back-to-back, serially, each run strictly slower than the last (the table just grew). A "Full re-sync" multiplies this by hundreds.
  - Each of those rollup runs is awaited inside the POST handler (`route.ts:80`), so rollup latency directly extends batch confirmation time; the drain cursor only advances on 2xx, so the whole drain throughput is gated on N× full-history recompute.
  - Trigger-set inconsistency: `BIOMETRIC_TAGS` (route.ts:70) omits **0x50** (`activity_information` / MET), yet the rollup consumes 0x50 centrally — `adapter.ts:4010` fetches it, and it feeds the MET active-period HRV/RHR gates (4143-4148), daily-summary `metAvg` (4647-4666), and the resilience daytime-stress series (4714). A drain batch carrying only 0x50 frames stores them but never triggers the rollup, so MET-gated HRV/RHR and the day's summary/resilience stay stale until an unrelated biometric batch arrives.
- Failure scenario: (perf) morning drain of a night's data = ~30-100 POSTs × full-history rollup ≈ minutes of serialized server compute and repeated ~300k-row reads, all before the Health screens show the night; drain time degrades linearly with table age. (staleness) an afternoon MET-only batch (user sedentary, ring emitting activity_information but no HR-worthy events) leaves `metAvg`/stress inputs unrolled until the next night's sleep data lands.
- Recommendation: debounce the rollup off the per-batch path — e.g. only aggregate on the drain's final batch (the plugin knows when the backlog is exhausted; or a short server-side debounce/coalesce keyed on userId so concurrent batches trigger one trailing rollup). Independently, either add 0x50 to `BIOMETRIC_TAGS` or document why MET-only batches intentionally defer. C-1's time-bounding shrinks the per-run cost; this finding removes the ×N multiplier.

### C-3 — chart.js is statically bundled into the Health tab's base chunk via TimeInZoneCard, defeating the chunk's other lazy chart imports
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `app/health/health-sections.tsx:12` — `import { TimeInZoneCard } from "@/components/health/time-in-zone-card"` (static), and `components/health/time-in-zone-card.tsx:10-11` statically imports `chart.js` + `react-chartjs-2`. `health-sections` is statically imported by `app/health/health-content.tsx:7`, which is the Health tab's code-split chunk (`components/shell/tab-shell.tsx:27-29`). Meanwhile the same chunk carefully lazy-loads its other charts (`trends-section.tsx:12-13` TrendChart, `health-sections.tsx:42` OuraSection, `trend-sparkline-lazy`) — pointless once chart.js rides in the base chunk anyway. Everything reachable from home/entry is clean: `session-select-content.tsx` dynamics AiChatOverlay/WeatherChip (lines 18-19), `day-review-sheet` and `home-card-widget` dynamic their charts, `workout-screen.tsx:46` dynamics DoneScreen (whose HrRecoveryChart static import stays inside that lazy chunk).
- Failure scenario: first activation of the Health tab downloads/parses chart.js (+ its tree) inside the tab's base chunk, lengthening the one-time `TabChunkPulse`; the per-component `dynamic()` wrappers in the same chunk buy nothing. Not on the entry path, so impact is confined to the Health tab's first paint.
- Recommendation: convert the `TimeInZoneCard` import in `health-sections.tsx` to `next/dynamic({ ssr: false })` like its sibling OuraSection/TrendChart imports.

### C-4 — PrescribedRunCard's memo is defeated by inline props at its only call site (new running-engine code)
- Severity: low
- Status: CONFIRMED
- Dup: no (same bug class as the fixed PRF findings, but in code shipped after them)
- Evidence: `components/running/prescribed-run-card.tsx:75` exports `memo(PrescribedRunCardImpl)`, but its sole call site `components/running/running-plan-content.tsx:107-109` passes `gateReasons={data.gateReasons ?? []}` (fresh array whenever `gateReasons` is undefined — the server omits it in the common no-gate case) and `onSkip={() => markRun('skipped')}` (inline arrow, new identity every render). Every parent re-render (data refresh, localStatus flip, setup-sheet open/close) re-renders the card.
- Failure scenario: minimal user-visible cost today — the parent renders infrequently — but it's the exact call-site pattern CLAUDE.md's render-discipline rule names ("an inline arrow or object literal defeats the memo silently"), re-shipped in the newest feature area; the memo is dead code as written.
- Recommendation: hoist a module-level `EMPTY: string[] = []` (or keep `gateReasons` nullable), and wrap the skip handler in `useCallback` alongside the existing `onStart`.

### C-5 — daily_zone_minutes reconcile-on-read cache: past days are cached forever while the rollup keeps rewriting their HR, and the zone profile isn't part of the key
- Severity: medium
- Status: CONFIRMED (mechanism code-traced; wrongness magnitude needs prod data)
- Dup: no (zone minutes is post-07-10 code the preamble directs at; no tracked row covers it)
- Evidence:
  - `lib/data/postgres/slices/oura.ts:478-497` — `getZoneMinutesRange` computes a missing non-today day once and upserts it into `daily_zone_minutes`; **nothing anywhere deletes or recomputes these rows** (grep: the table's only writers/readers are these lines — no invalidation call exists server-side; `lib/cache-groups.ts:34,154,191` invalidates only the *client* `zone-minutes:` key).
  - But the day's underlying HR is not immutable: `adapter.ts:4604-4611` delete-and-reinserts `source='ble'` rows across a **14-day window** on every ingest rollup, and BLE drains land data late (a disconnect evening drains next morning). A day cached before its HR fully landed stays wrong forever.
  - Profile drift: `app/api/zone-minutes/route.ts:32-35` derives `restingHr` as the rolling average over the request range and `maxHr` from age — both change over time — yet cached rows key only on `(user_id, day)` (`migrations/129`), so a range mixes days computed under different zone boundaries and never converges.
  - Minor perf face: the cold path (`oura.ts:478-497`) computes missing days **serially** — one full-day `getHrForWindow` + one upsert per day, awaited in a loop — so a first 30-day request is ~60 sequential round-trips.
- Failure scenario: user's phone is off the ring overnight; at 07:00 they open Health before the morning drain finishes; yesterday is computed from partial HR and cached. The drain then rewrites yesterday's `oura_heartrate` rows, but the time-in-zone card shows the truncated minutes for that day permanently (and the weekly zone totals stay wrong). Separately, as the user's fitness changes RHR, older cached days silently reflect obsolete zone boundaries.
- Recommendation: store `computedAt` is already there — recompute (instead of trusting) any cached day within the rollup's 14-day HR-rewrite window, or have the rollup delete `daily_zone_minutes` rows for days whose HR it rewrote (same owns-its-rows pattern it already uses for `oura_heartrate`). Consider storing the profile `(maxHr, restingHr)` on the row and recomputing on mismatch. Parallelize the cold-path day loop with `Promise.all` over missing days.

## Not exercised

- Actual runtime cost of a rollup invocation (query ms, Node heap, ONNX inference time per night) — no prod DB or `oura_raw_samples` data in the sandbox; C-1's magnitude is derived from the documented 306,948-row prod count and code structure, not measured.
- On-device feel of the persistent tab shell (memory/GC of five kept-alive tabs, back-button behaviour) — already a tracked KI row (v1.145.0, web-verified only).
- Real bundle-chunk composition (`next build` output / bundle analyzer not run) — C-3 is from import-graph tracing, not emitted chunk inspection.
- GPS-active screens under a real multi-hour recording (leaflet re-render cost, `Math.min(...spread)` over very large point arrays in `activity-route-map.tsx:61-64`) — needs device GPS.
- The startup request stampede count (~35-40 reqs, START-5) — not re-measured; relied on the tracked open item.
- Service-worker cache hit behaviour on the S25 WebView (warm tab-chunk loads "near-instant" claim in `tab-shell.tsx:13-14`).

---

# Dimension D — Save/load paths & offline-first structure

## Summary
The offline-first machinery is in much better shape than its history suggests: applyDelta clobber-gates (`sync_status='synced'` WHERE guards) are present and consistent across every gated domain including the newest (fitness_tests, prescribed_runs, set_logs planned-snapshot columns); tombstones (`deleted_at` + `updated_at` bump) are emitted by getSyncDelta for every domain with delete UI; cursor pagination covers all page-limited domains; per-item outbox confirmation is by mutation id with bounded retry/dead-letter; and the newest domains (fitness_tests, prescribed_run) use genuinely shared Zod schemas + repo functions between the web route and pushMutations.

The pass found one critical, structural failure that defeats all of the above for nutrition: the push envelope schema (`lib/sync/mutation-schema.ts`) was never taught the `food_items` domain that `logFoodEntries` has queued since PR #596. The push route silently drops unknown-domain mutations *and confirms them to the client* (deliberately, as poison-pill quarantine), so on the S25 APK every newly-created food item is permanently discarded server-side and its dependent food_log dead-letters on FK validation — i.e. the "offline new/scanned food logging" fix (SYNC-O2, listed as fixed) is structurally broken end-to-end, online or offline. Secondary findings: the CI/test guardrails cannot catch this bug class (parity tests skip in CI and bypass the route; the custom rule only greps for `this.db`), the stranded-workout rebuild drops the progression-style snapshot, and ActivityHistoryCard lets the server list clobber a pending local activity out of view.

## Per-domain table (write path → read path, checklist verdict)
| Domain | Local write + outbox | Web route | pushMutations branch | UI read | Verdict |
|---|---|---|---|---|---|
| workout log (exercise/set) | `logWorkoutLocally` + POST-primary/outbox-fallback (`workout-screen.tsx:1088-1122`) | `/api/log-exercise` | shared `logExerciseFromPayload` (adapter:3483) | local-first (workout store + local store) | OK; stranded-rebuild residual (D-3) |
| complete_workout / session_rpe | local stamp + POST-primary/outbox-fallback (`workout-screen.tsx:1296-1319`, `done-screen.tsx:141-148`) | `/api/complete-workout`, `/api/workout-sessions/rpe` | shared `completeWorkoutFromPayload` (adapter:3502); `setSessionRpe` (adapter:3494) | local-first | OK; markSessionSynced SYN-7 guard present (`sqlite-backend.ts:391`) |
| food_logs | `upsertFoodLog`+outbox (log-food/log-meal/quick-edit/delete) | `/api/nutrition/food-logs` (+`[id]` PATCH/DELETE) | adapter:3346 (qty clamp + FK check, mirrored) | local-first (`nutrition-content.tsx`) | write path OK, but **poisoned by D-1** for new items |
| food_items (client-minted id) | `upsertFoodItem`+outbox `'food_items'` (`log-food.ts:199-219`) | `/api/nutrition/food-items` (web fallback only) | adapter:3322 — **unreachable** | via food-log JOIN, local-first | **BROKEN — D-1 (critical)** |
| saved meals | server-only CRUD, visible-failure toasts (`saved-meals-sheet.tsx:165-218`); *logging* a meal = food_logs outbox (`log-meal.ts`) | `/api/nutrition/saved-meals*` | none (by design) | server (cachedFetch) | acceptable (reference-data mgmt; fails visibly) |
| meal types | server-only | `/api/nutrition/meal-types*` | none | server | DUP — backlog item 10 (offline meal-types mirror deferred) |
| supplements + logs | local + outbox both CRUD and toggle (`manage-supplements-sheet.tsx`, `supplements-section.tsx:35-55`) | `/api/supplements*` | adapter:3373/3381 (name guard, delete mirrored) | local-first (reference pattern) | OK |
| body_metrics (incl. water, weight quick-log) | read-merge upsert (`sqlite-backend.ts:655-676`) + outbox; water uses `waterMlDelta` increment | `/api/body-metadata`, `/api/water-log` | adapter:3225 (bounds mirrored; `waterMlDelta`→`incrementWaterLog`, parity-tested) | local-first per session-178 audit | OK — metric-log-sheet null-fields are safe because upsert read-merges |
| mood_logs | local + outbox (`mood-checkin-sheet.tsx:144`) | `/api/mood` | adapter:3265 (sleepQuality 'ok' default mirrored) | local-first | OK |
| day_checkins (morning + evening/day-review) | local + outbox with `phase` (`morning-checkin-sheet.tsx:70-94`, `end-of-day-review.tsx:173`) | `/api/day-checkin` | adapter:3280 (scales/extras/phase validation) | local-first (`end-of-day-review.tsx:87-90`) | OK |
| injuries | local + outbox for create/edit/resolve/delete (`injury-sheet.tsx`) | `/api/injuries*` | adapter:3452 (create-upsert / resolve patch / tombstone delete) | local-first | OK — resolved injuries not editable, so the create-upsert's `resolvedDate: null` cannot clobber in practice |
| activity_logs | local + outbox (`done-activity-screen.tsx:135`, `walk-summary.tsx:64`) | `/api/activity-logs` | adapter:3404 (shared `ActivityLogBody` + `deriveEndTime`) | mixed — local read then server overwrite (D-4) | mostly OK; D-4 repaint gap |
| fitness_tests (newest) | local + outbox (`test-result.tsx:71-89`) | `/api/fitness-tests` (shared `FitnessTestBody`, soft delete adapter:2059) | adapter:3425 (same schema+`saveFitnessTest`) | local-first w/ pure API fallback (test-select, latest-baseline-card) | OK — model citizen. Note: no client delete UI yet; push branch has no `deleted` arm (matches) |
| prescribed_run (newest) | status patch local + outbox (`running-plan-content.tsx:60-65`) | `/api/running-plan/runs/[id]` PATCH (same schema+repo fn, stated in-code) | adapter:3438 | prescription server-computed (by design); status read local-first (lines 43-51) | OK |
| sleep_sessions / oura_daily / personal_records / program structure | pull-only mirrors (no client writes) | n/a | n/a | local mirror | OK — no clobber gate needed (server-authoritative), PR downward-correction accepted verbatim |

## Findings

### D-1 — `food_items` outbox mutations are silently dropped by the push envelope schema → every new-food log on the APK never reaches the server (regression of "fixed" SYNC-O2)
- Severity: critical
- Status: CONFIRMED
- Dup: no (SYNC-O2 is listed in the DUP index as "R3 Chunk1 fixed" — this shows the fix is structurally broken, which per the briefing IS a new finding)
- Evidence:
  - `lib/nutrition/log-food.ts:207-219` — on any device with a local store (i.e. ALWAYS on the S25 APK, online or offline), a new food item gets a client-minted `crypto.randomUUID()` id and is queued as `queueMutation({ domain: 'food_items', ... })`; the paired log is queued as `domain: 'food_logs'` referencing that id (lines 227-232). The direct `POST /api/nutrition/food-items` path (line 99) is only the web fallback (line 244+ "dev-DB/web-only path").
  - `lib/sync/mutation-schema.ts:9` — the `MutationSchema` domain enum is `['body_metrics', 'mood_logs', 'food_logs', 'supplement_logs', 'injuries', 'supplements', 'activity_logs', 'fitness_tests', 'prescribed_run', 'workout_log', 'day_checkins', 'session_rpe', 'complete_workout']` — **no `'food_items'`**.
  - `app/api/sync/push/route.ts:32-42` — each mutation is `MutationSchema.safeParse`d; a parse failure is logged server-side and **omitted from the response errors**, with an explicit comment: "Omitting it from the response errors makes the client treat it as done (quarantined)".
  - `lib/local-store/sync-engine.ts:558-574` — the client confirms every chunk mutation not present in `result.errors` and `deleteMutations()`s it. The dropped `food_items` mutation is therefore deleted from the outbox permanently — it will never be retried.
  - `lib/data/postgres/adapter.ts:3322-3345` — a fully-built `food_items` pushMutations branch exists (`createFoodItem` with client id) but is **unreachable**: the route filters the mutation out before `pushMutations` is called.
  - `lib/data/postgres/adapter.ts:3359-3362` — the subsequent `food_logs` mutation fails `foodLogRefsValid(userId, mealTypeId, foodItemId)` because the item never landed server-side → per-item error 'FK ownership check failed' → `recordMutationFailures` → retry/backoff → dead-letter at max attempts. The log also never reaches the server.
- Failure scenario: On the S25 APK the user scans/AI-logs/manually enters ANY food that isn't an existing library pick. Locally everything looks perfect (item + log render local-first, `syncStatus: 'pending'`). On the next sync push, the `food_items` mutation is silently discarded server-side and deleted from the outbox; the `food_logs` mutation fails FK validation forever and dead-letters. Result: none of the user's new-food nutrition data ever reaches Postgres — server-computed surfaces (day-timeline calories, weekly stats, AI chat/digest nutrition context, end-of-day review aggregates) silently under-count every day, and any local-store wipe (reinstall, More-tab data clear) permanently loses the entries. This affects the ONLINE path too, since the local-store branch is taken whenever the store exists.
- Recommendation: Add `'food_items'` to the `MutationSchema` enum (one-line fix) and add a regression test asserting every `domain:` string emitted by a `queueMutation` call site parses. Consider a CI grep pairing `queueMutation({... domain: 'X'})` call sites against the enum. Audit the dead-letter table for stranded `food_logs` rows and re-queue them after the fix.

### D-2 — The drift guardrails structurally cannot catch domain-envelope gaps: parity tests skip in CI and bypass the push route; check-push-mutations.js only greps for `this.db`/`sql`
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence:
  - `scripts/check-push-mutations.js:55-62` — the CI "Custom Rules" guard only flags `this.db.` / raw `` sql` `` usage inside `pushMutations`. It says nothing about whether a client-emitted domain is accepted by the push route's envelope schema, or whether the branch calls the *same* function as the web route.
  - `lib/data/postgres/__tests__/push-mutations-web-parity.test.ts:8-11,28` — the only web↔push parity suite runs `describe.skipIf(!process.env.DATABASE_URL)` and the header comment states CI's Tests job has no `DATABASE_URL`, "so CI stays green" — i.e. the entire drift-regression suite is skipped on every CI run. It also drives `repo.pushMutations` directly (line 30-38), bypassing `app/api/sync/push/route.ts`, so the `MutationSchema` filter (the layer that broke in D-1) is exercised by no test at any layer.
  - `lib/sync/__tests__/mutation-schema.test.ts` — tests only that `'users'` is rejected; no assertion that the enum covers the set of domains `queueMutation` call sites emit.
- Failure scenario: exactly D-1 — a new outbox domain (`food_items`, added in PR #596) shipped with a working adapter branch, green CI, green Custom Rules, and a silently dead sync path. Nothing in the pipeline can catch the next occurrence either (the next new domain has the same exposure).
- Recommendation: (1) add a unit test (no DB needed, so it runs in CI) asserting `MutationSchema` parses one fixture mutation per domain emitted by client code — ideally generated by grepping `domain: '...'` literals; (2) route the parity suite's push side through the actual route handler; (3) consider giving CI a throwaway Postgres so the parity suite actually runs.

### D-3 — Stranded-workout outbox rebuild drops the progression-style snapshot: planned_pct / planned_rest_sec lost and use_for_1rm re-derived on replay
- Severity: low
- Status: CONFIRMED
- Dup: no (the planned-snapshot feature itself is the 2026-07-16 plan; SYN-4/SYN-6 fixes are tracked but this residual is not)
- Evidence:
  - `lib/local-store/sqlite-backend.ts:333-361` — the local set rows DO store `planned_pct`/`planned_rest_sec` and the style's `useFor1rm` (from `payload.progressionStyle`), so the data survives locally.
  - `lib/local-store/sync-helpers.ts:63-97` — `buildWorkoutLogPayload` (used by the stranded-pending sweep, `sync-engine.ts:499-508`) reconstructs the outbox payload from local rows but emits no `progressionStyle` array and no per-set planned fields.
  - `lib/workout/log-exercise.ts:193-197` — the server derives `plannedPct`/`plannedRestSec` (and the `useFor1rm` override) exclusively from `payload.progressionStyle[i]`; absent that, planned fields are `undefined` and `useFor1rm` falls back to `defaultUseFor1rm`, which can differ from the style's explicit flags.
- Failure scenario: a set is logged while the direct POST fails AND `queueMutation` throws (the double-failure the sweep exists for). The recovered replay writes server set_logs with NULL planned_pct/planned_rest_sec and possibly different use_for_1rm than the style prescribed — silently degrading prescription-adherence analytics and potentially 1RM attribution for that exercise. Local rows keep the correct values, so the local and server copies of the same sets permanently disagree (until a pull clobbers local with the degraded server rows after markWorkoutSynced).
- Recommendation: have `buildWorkoutLogPayload` reconstruct `progressionStyle` from the local set rows (`plannedPct`, `plannedRestSec`, `useFor1rm` are all present on `LocalSetLog`), or extend `LogExercisePayloadSchema` to accept per-set planned fields directly.

### D-4 — ActivityHistoryCard applies the server list over the local-first read, hiding a pending offline activity
- Severity: low
- Status: CONFIRMED
- Dup: likely (adjacent to the tracked "after an optimistic local write, never apply a server response that would replace it" rule and item 7 R3 residuals, but this specific surface isn't listed)
- Evidence: `components/health/activity-history-card.tsx:52-71` — the effect seeds from the `activity-logs` cache mirror, then reads the local store ("local-first: the on-device store is the source of truth"), then unconditionally fires `cachedFetch('/api/activity-logs?days=7')` whose `onData` does `setLogs(d?.activityLogs ?? [])`, replacing the local-store list. The code comment declares the server "authoritative", which inverts the offline-first rule for a domain whose writes are local+outbox (`components/activity/done-activity-screen.tsx:135`, `components/guided-walk/walk-summary.tsx:64`).
- Failure scenario: user finishes a guided walk while the push hasn't landed (offline burst, 5xx backoff, or dead-letter). The card initially shows the walk (local read), then the server response resolves and the walk vanishes from "Activities This Week" until a successful push+pull round-trip — the classic "my data disappeared" repaint, bounded but user-visible; unbounded if the mutation dead-letters.
- Recommendation: merge server and pending-local rows (union by id, local `sync_status='pending'` rows always retained) instead of replacing state with the server payload.

### D-5 — food-items applyDelta path is an unconditional overwrite, but no clobber risk today (informational, verified-not-a-bug)
- Severity: low
- Status: CONFIRMED (as designed)
- Dup: no
- Evidence: `lib/local-store/sqlite-backend.ts:1162-1164` applies pulled food items via plain `upsertFoodItem` with no sync_status gate — but food_items rows are immutable reference data (create-only; server edits don't exist), and a locally-minted pending item's id cannot appear in a pull until its own mutation lands. Recorded so a future food-item *edit* feature knows this gate is absent.
- Failure scenario: none today; becomes a pull-clobber gap only if food-item editing ships.
- Recommendation: add the standard gate if/when food items become editable.

## Not exercised
- Actual on-device SQLite behaviour (`getLocalStore` returns null in the sandbox) — every local-write/read path above is code-traced, not runtime-observed; the D-1 failure chain is fully static-verified but the dead-letter accumulation on the real device was not inspected.
- The dead-letter/quarantine runtime behaviour (`recordMutationFailures`, `MAX_MUTATION_ATTEMPTS` backoff) — logic read, not executed.
- Whether the production DB already holds the D-1 damage (how many food_logs are dead-lettered / how many food items exist only on-device) — needs an owner query on the device outbox + server tables.
- The web-parity integration suite (skips without DATABASE_URL; not run).
- Cross-device delete propagation (tombstone → second device) — single-device user; code-verified only.
- Stats-tab workout edit/delete local mirror (SYN-1/SYN-2, shipped per DUP index) — not re-audited this pass beyond confirming shared-function branches exist.
- exercise-review-sheet activity edit path (`components/activity/exercise-review-sheet.tsx:98`) — not traced for offline fallback.

---

# Dimension E1 — Workout system end-to-end

## Summary
The workout system's core loop (pre → warmup → active → exercise-summary → done) is in good shape: timer anchors are epoch-ms based and suspend-safe (`useElapsedSec`, rest ring, chip, and notification all recompute from `Date.now()` on resume), the double-tap guards (`isLoggingRef`/`isCompletingRef`) hold, superset ordering (`buildSetSequence`/`nextStep`) is correct including the unequal-set tail resume, `complete-workout` is idempotent with a correct phase-counter increment/decrement/reconcile triangle, and the c2bd70f strict-id change is consistently applied across every server `workout-data?tab=` caller.

The confirmed problems cluster at the edges. Two identity leftovers survived the id-migration: the Google Calendar event title is now a raw session UUID (E1-1), and the offline local-store seed still resolves stale ids by name/`sessions[0]` (E1-5), the exact behavior c2bd70f removed server-side. The rehydrate staleness guard covers `active` mode's timer anchors but not the workout identity itself — a days-old abandoned workout remains resumable with multi-day durations, and warmup mode escapes the guard entirely (E1-4). On the data-correctness side: outbox-replayed exercise logs are date-stamped at sync time because the WK-16 `localDate` datetime can never pass `normalizeDateParam` and `loggedAt` is always `new Date()` (E1-2); the PR reconcile stamps `achievedAt = now`, creating phantom "recent PRs" in digests after deletes/edits (E1-6); and the exercise-summary screen's "New Personal Record!" badge uses a last-session comparison that contradicts the real `personal_records` gate (E1-7).

Tracking note: the DUP-index item "advance() stale-closure calendar payload (final exercise missing) — unclaimed" appears already fixed on current `main` — `advance()` snapshots `useWorkoutStore.getState().sessionLog` fresh (`components/workout-screen.tsx:793`) before `handleAddToCalendar(snapLog)`, so the final exercise is included; the backlog entry can likely be retired.

## Findings

### E1-1 — Google Calendar event titled with the raw session UUID, not the session name
- Severity: medium
- Status: CONFIRMED
- Dup: no (WK-18 tracks the missing outbox for this call, not this)
- Evidence: `components/workout-screen.tsx:1243` — `handleAddToCalendar` POSTs `{ sessionType, ... }` where `sessionType` is the WorkoutScreen prop; since navigation went id-based (`/workout?session=<uuid>`, `app/workout/page.tsx:19` passes the raw `session` query param, and `session-select-content.tsx:848` pushes `session.id`), that prop is the DB session UUID. `app/api/log-calendar-event/route.ts:54` uses it verbatim as the event title: `summary: \`${sessionType} · TrainingAI\``. The route never resolves the name, and the client has `sessionDisplayName` in scope (used correctly two callbacks earlier at `completeWorkout`'s `const name = sessionDisplayName || sessionType`, line 1276) but doesn't pass it.
- Failure scenario: every workout completion with calendar sync on creates a Google Calendar event titled like `2f6a9c1e-04d2-4b3e-… · TrainingAI` instead of `Push · TrainingAI`. User-visible wrong output on an external system on every single completed workout.
- Recommendation: send `sessionDisplayName || sessionType` as the calendar payload's `sessionType` (mirroring `completeWorkout`'s `name`), or resolve the session name server-side from the id.

### E1-2 — Outbox-replayed exercise logs are date-stamped at sync time, not workout time (`loggedAt: new Date()`; client `localDate` can never parse)
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `lib/workout/log-exercise.ts:213` stamps `loggedAt: new Date()` (server receive time) on every exercise_log — including outbox replays via `pushMutations` (`lib/data/postgres/adapter.ts:3492`). The payload's `localDate` is `nowDatetimeInTz()` = `'yyyy/MM/dd HH:mm'` (`lib/date-utils.ts:36-38`, sent at `components/workout-screen.tsx:1027/1058`), but the server runs it through `normalizeDateParam` (`log-exercise.ts:135`) whose regex `^(\d{4})[-/](\d{2})[-/](\d{2})$` is `$`-anchored — a datetime with a trailing ` HH:mm` NEVER matches, so `rawDate` always falls back to server-today. Consumers of `loggedAt`: `app/api/exercise-history/route.ts:42` (entry dates), `adapter.ts:1271-1272` (`first1rm`/`last1rm` ORDER BY loggedAt), `adapter.ts:2641` (PR reconcile tiebreak), RM-trend sparklines.
- Failure scenario: workout logged offline Friday evening (primary POST fails → outbox); phone syncs Saturday. Every exercise log gets `loggedAt` = Saturday: 1RM history/trend shows the workout on the wrong day, and if an older offline workout syncs after a newer online one, `last1rm` (ORDER BY loggedAt DESC) returns the OLDER workout's 1RM — wrong trend direction feeding the AI signals. The WK-16 comment ("stamps the user's calendar day, matching the server's own todayInTz recompute") is only true while the replay happens the same calendar day.
- Recommendation: derive `loggedAt` from the payload — `setEndTimes` last element or `workoutStartedAt` — falling back to `new Date()` only when absent; or make `normalizeDateParam` (or a sibling helper) accept the datetime form and use it for replays.

### E1-3 — "Complete Workout" CTA reappears for an already-completed session; tapping it completes a nonexistent session id
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: after completion the reset-on-mount effect (`components/workout-screen.tsx:462-468`) calls `resetSession()`, which mints a fresh unused `workoutSessionId` and keeps `todayLogged` (`lib/stores/workout-store.ts:279-285`). On revisiting the same session later that day, `allDoneToday` is true (`pre-workout-screen.tsx:108-111`, server `loggedTodayInSession` + kept `todayLogged`), so the primary CTA is the green "Complete Workout" button (`pre-workout-screen.tsx:327-334`), not a "done" state. Tapping it runs `completeWorkout()` with the fresh, never-created UUID: local `completeWorkoutLocally` UPDATE no-ops, `/api/complete-workout` 404s ("Session not found", `app/api/complete-workout/route.ts:24-26`), and the client queues a `complete_workout` outbox mutation guaranteed to fail until dead-letter (`workout-screen.tsx:1311-1318`); the UI flips to a done screen with zero volume/sets and refires the calendar/cache stamping.
- Failure scenario: user finishes Push at 9am, reopens the Push screen at 6pm to review, sees "Complete Workout", taps it → empty done screen (0 kg, 0 sets), junk dead-letter mutation, duplicate optimistic calendar stamp.
- Recommendation: when `allDoneToday && !workoutActive` (no `workoutStartMs`), render a non-interactive "Done for today" state instead of the Complete button, or guard `onCompleteWorkout` on `store.workoutStartMs != null`.

### E1-4 — Rehydrate staleness reset keeps `workoutStartMs`, so a days-old abandoned workout stays resumable ("Continue Workout") and produces multi-day durations
- Severity: medium
- Status: CONFIRMED
- Dup: likely (item 8 / WK-13 territory — but this specific residual is not what shipped; WK-13 covered todayLogged ticks, not session-identity anchors)
- Evidence: `lib/stores/workout-store.ts:217-231` — the >4h/date-rollover guard resets `mode` to `'pre'` and nulls `lapStartMs`/`restStartMs`/`lastSetRestStartMs`, but leaves `workoutStartMs`, `workoutSessionId`, `sessionLog` and `exerciseBuffers` intact. The same applies when the app was killed while on the mid-workout `'pre'` hub (guard only runs for `mode === 'active'`). `isWorkoutActive` (`workout-store.ts:404-406`) and the pre-hub's `workoutActive={!!store.workoutStartMs}` (`workout-screen.tsx:1397`) therefore still read "in progress" days later, offering "Continue Workout" (`pre-workout-screen.tsx:335-343`), which resumes the old `workoutSessionId`.
- Failure scenario: user starts Push on Monday, logs one exercise, backgrounds and forgets; opens the same session Wednesday → "Continue Workout" resumes Monday's `workoutSessionId` (server `started_at` Monday). New sets attach to a session started 2 days ago; on completion `durationMinutes = workoutEndMs − workoutStartMs` ≈ 2,880 min on the done screen; server session spans two days (duration-derived stats, HR-window sync `oura/hr-sync` over the session window, day attribution of the session all wrong). `sessionLog` also still holds Monday's entries, so the done-screen volume/sets and the calendar event description mix both days.
- Recommendation: in `applyRehydrateFixups`, when `staleAnchor` (or `storedDate` rollover with `mode==='pre'` and a `workoutStartMs` older than the rolled date) fires, fully `resetSession`-equivalent the workout identity (clear `workoutStartMs`, `sessionLog`, `exerciseBuffers`, mint nothing) instead of only dropping timer anchors — the partially-logged server session is already safe in the DB.
- Additional gaps in the same guard: (a) `mode === 'warmup'` is not covered at all — an app killed during warm-up and reopened days later rehydrates straight back into the warmup screen with a multi-day session clock (`warmup-screen.tsx:23`, `useElapsedSec(workoutStartMs)`) and a status-bar chip anchored at the days-old `workoutStartMs` (`workout-screen.tsx:529-531`); (b) `exerciseBuffers` persist stale `restStartMs`/`exerciseStartMs`/`timerStarted` values that `restoreExercise` (`workout-store.ts:340-358`) later reloads verbatim, bypassing the 4-hour anchor check.

### E1-5 — Strict id-only identity (v1.171.0) not mirrored in the offline local-store fallback: stale nav id silently paints another session's exercises
- Severity: low
- Status: CONFIRMED
- Dup: no (c2bd70f itself is the tracked KI row; this is a gap in what shipped)
- Evidence: `components/workout-screen.tsx:318-321` — the offline seed path still resolves `local?.sessions.find(s => s.id === tab) ?? local?.sessions.find(s => s.name.toLowerCase() === tab) ?? local?.sessions[0]` and then `setProgramSessionId(sess.id)`. Commit c2bd70f removed exactly this name/`sessions[0]` fallback from the server route ("a stale id must … never silently return the wrong session's data") but left it in the client's offline branch. When the network fetch fails (offline), the `sessionNotFound` guard never runs and the arbitrary `sessions[0]` stays painted; sets logged then attach to `sessions[0]`'s id/name.
- Failure scenario: program edited on the web sandbox re-mints session ids; APK opens a stale `/workout?session=<old-id>` link (shell-restored URL or old deep link) while offline → screen paints the first session of the program, user starts training believing it's the tapped session; logs are attributed to `sessions[0]` (`programSessionId` used in `logPayload.sessionId`, phase counters, todayLogged key).
- Recommendation: in the local fallback, resolve strictly by id and show the same `sessionStale` reselect state when the id is absent from the mirror, matching the server semantics.

### E1-6 — PR reconcile stamps `achievedAt = now`, so digests/recaps report phantom "new PRs" after any edit/delete
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `lib/data/postgres/adapter.ts:2616-2650` — `reconcilePersonalRecord` SELECTs `loggedAt` of the surviving best log (line 2618) but never uses it: it calls `upsertPersonalRecord(...)` (line 2649) which stamps `achievedAt: new Date()` (lines 2587, 2590). `listRecentPersonalRecords` filters on `achievedAt` windows (adapter.ts:2655-2669) and feeds `daily-digest`, `weekly-digest`, session recap, year-review and nutrition-goal recommendation.
- Failure scenario: user deletes a duplicate workout from months ago (or edits a set via workout-entry PATCH, both of which call `reconcilePersonalRecord`); the surviving all-time PR — achieved months ago — is re-upserted with `achievedAt = today`. That evening's daily digest and the weekly digest list it as a PR achieved this week; the recap congratulates a PR that didn't happen.
- Recommendation: pass the surviving log's `loggedAt` through to the upsert (`achievedAt: best.loggedAt`) in the reconcile path.

### E1-7 — Exercise-summary "New Personal Record!" badge compares against last session's 1RM, not the all-time PR
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `components/workout/exercise-summary-screen.tsx:78` — `isNewPR = newEst1rm > 0 && (prevEst1rm == null || newEst1rm > prevEst1rm + 0.1)`, rendered as a trophy "New Personal Record!" badge with a success haptic (lines 80-82, 108-119). `prevEst1rm` is `ex.estimated1rm` (`workout-screen.tsx:1143`), which the workout-data route fills from the LAST log only: `estimated1rm: lastLog?.estimated1rm ?? null` (`app/api/workout-data/route.ts:485` — the all-time PR `prMap` is used only for `basis` at line 477). Meanwhile the authoritative PR paths (server `upsertPersonalRecordIfBetter`, and the client's optimistic check against `store_.getPersonalRecord` in `workout-screen.tsx:1090-1097`) compare against the all-time record.
- Failure scenario: all-time bench PR is 105 kg; last session was an off day estimating 95. Today estimates 97 → the summary screen flashes "New Personal Record!" + haptic, but `personal_records` is untouched and the done screen's PR list (correctly) omits it. The user is told a PR happened that the app then never shows again. Also fires on RPE-targeted accessory days where the estimate naturally wobbles.
- Recommendation: pass the all-time PR (`prMap` value, already fetched in workout-data) into `WorkoutExercise` (or into `ExerciseSummaryData`) and gate the badge on beating it; keep the last-session comparison as the existing up/down arrow only.

## Not exercised
- On-device behavior: rest-timer status-bar chip rendering (Now Bar), local notification delivery/cancellation timing, PiP bridge, keep-awake, haptics — all no-op in the sandbox; code paths were read, not run.
- Android WebView suspend/kill semantics — the 20-min-suspend and app-killed-mid-set scenarios were traced through the persisted-store/rehydrate code only, not reproduced on the S25.
- Live-HR in-workout displays (LiveHrChart, trace buffer, set-boundary markers) — require a connected ring/strap; only the recording effect's stale-gap guard was read.
- The local SQLite store paths (`logWorkoutLocally`, `completeWorkoutLocally`, outbox queue/push round-trip) — native-only; traced statically.
- Actual Google Calendar insertion (E1-1) — verified from payload construction and route code, not by executing the OAuth call.
- Emergency-deload / AI prescription generation internals — sibling reviewer's dimension; only the workout-flow-facing seams (prescribe route 404 self-heal, per-exercise-deload lib, confirm-early-deload route) were read.
- Midnight-rollover-while-foregrounded (WK-13 `rolloverDay`) was traced but not runtime-tested; its designed consequence (mid-workout tick clearing at rollover, re-offering already-logged exercises on Continue) was judged intended semantics and not raised as a finding.

---

# Dimension E2 — AI training engine deep-dive

## Summary
The strength-side AI chain (signals → prompt → generateObject → reconcile → autoregulation → time-budget → phase-guards → confidence → consumption) is in much better shape than at the 07-10 review: the AI-1/2/3 fixes are genuinely present (setLastSessionRanPrescription is called at completion, consumption-day re-evaluation runs once per day, the v1.165.2 poll=1 gate holds on both client and server, expiry is enforced at both read sites, and the reconcile/backfill layer makes a partial/hallucinated LLM response safe). The formulas audited (expected-RPE inversion, ACWR gating, confidence, phase ceilings, time-budget trimming, volume landmarks, Ross/Cooper/Uth-Sørensen/Jackson equations) are internally consistent and match their cited sources.

The dead-input class the brief targets is alive, though, and it clusters around the BLE re-key and the new (2026-07-17) running engine. Post-re-key, two decision layers still read frozen `oura_daily` fields: the prescription's `externalReadiness` signal (E2-1) and — more consequentially — the next-session recommender's readiness/temperature deload grading (E2-12), both dead while the live replacement value sits in `oura_daily_derived` rows the same code paths already fetch. The running recovery gate ships two never-read inputs (`strain`, `hoursSinceLastRun`, E2-4), a "last night's sleep" that is actually the week's best night (E2-5), an elapsed-hours anchor that makes the 24h leg-interference check unreachable for yesterday's sessions (E2-6), and a week-sequencer that counts never-run pending prescriptions as completed training (E2-7). In the fitness-test flow, the HRR protocol's headline metric is structurally null on every device (E2-9). One resilience regression-shaped gap: the failed-generation retry and "preparing" gate key on a `'consumed' + null` signature that a normal completion never produces, so a single Gemini failure at completion still silently costs two sessions of AI prescriptions (E2-11).

## Findings

### E2-1 — `externalReadiness` signal permanently dead post-BLE-re-key (reads frozen `oura_daily.readiness_score` for today)
- Severity: medium
- Status: CONFIRMED
- Dup: no (closest tracked items are S7/item-20 "temp deviation into periodization" and S9 "dual readiness" consolidation — neither names externalReadiness)
- Evidence: `lib/ai-periodization/signals.ts:460-462` — `externalReadiness: await repo.getOuraDaily(userId, today, today).then(rows => rows[0]?.readinessScore ?? null)`. The only writers of `oura_daily.readiness_score` are the Cloud sync (`app/api/oura/sync/route.ts:222`) and the Cloud webhook (`app/api/oura/webhook/route.ts`) — both frozen since the 2026-07-07 ring re-key. The only BLE writer of `oura_daily` writes wear-time only (`lib/data/postgres/adapter.ts:4641`, `nonWearTimeSec`). Meanwhile a live BLE readiness composite IS persisted daily to `oura_daily_derived.readiness_score` (`app/api/readiness-score/route.ts:379`), and signals.ts already fetches `getOuraDailyDerived` (line 143) for the illness flag — but never reads its readinessScore.
- Failure scenario: every prescription generated since 2026-07-07 has `externalReadiness: null`, so the prompt line "External readiness score: N/100" (`lib/ai-periodization/prompt.ts:243-244`) is silently omitted from every LLM call. The engine's stated "one signal among many" readiness input is a permanent no-op — exactly the repCompletionRate dead-signal class from the 07-10 review, re-introduced by the re-key.
- Recommendation: read `readinessScore` off the `derivedRows` already fetched at signals.ts:143 (widen the window to include yesterday's rollup as the illness read does), and delete the frozen `getOuraDaily(today, today)` call.

### E2-2 — Consumption-day re-evaluation drops the muscleGroups fallback: per-exercise deloads on non-library exercises silently revert to full weights while still sore
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: At generation time, `lib/ai-periodization/signals.ts:179-182` falls back to `ex.muscleGroups.map(mg => ({ muscle: mg, role: 'main' }))` when the exercise has no `exercise_library` muscle assignments, so `computePerExerciseDeload` can match soreness on custom/non-library exercises. The consumption-day re-evaluation in `app/api/workout-data/route.ts:330-334` builds the same input as `muscleAssignments: muscleAssignmentsMap[ex.exerciseName] ?? []` — no fallback. `reevaluatePrescriptionForToday` (`lib/ai-periodization/reevaluate.ts:84-113`) then computes `isDeloaded=false` for that exercise and, because `wasDeloaded && preDeload` is set, restores full pre-deload weights.
- Failure scenario: user has a custom exercise not present in `exercise_library`; sore muscles at completion → per-exercise deload applied to it. Next calendar day (still sore, same mood log carried or re-logged), the first workout-data fetch re-evaluates, finds zero assignments for that exercise, and flips it back to full sets/reps/pct — the user lifts full load on a muscle the engine decided yesterday was too sore. Also skews the `affected*2 > exercises.length` whole-session threshold between the two evaluation sites.
- Recommendation: in the re-eval signal assembly, apply the identical fallback: `muscleAssignmentsMap[ex.exerciseName]?.length ? … : ex.muscleGroups.map(mg => ({ muscle: mg, role: 'main' }))`.

### E2-3 — Emergency-deload trigger `hoursSinceLastSession < 36 && soreMuscles ≥ 3` still evaluates at generation time where hoursSinceLastSession ≈ 0 by construction
- Severity: low
- Status: CONFIRMED
- Dup: likely (07-10 AI-3 marked "shipped" — the consumption-day re-check DID ship, but the generation-time condition remains degenerate in the opposite direction)
- Evidence: `lib/ai-periodization/signals.ts:228-232` — `hoursSinceLastSession` is computed from `last5.find(s => s.completedAt != null)`, and `getRecentSessionsOfType` (`lib/data/postgres/slices/periodization.ts:299-317`) includes the just-completed session, so when /prescribe fires from `app/api/complete-workout/route.ts:44` the value is minutes, i.e. always `< 36`. `shouldTriggerEmergencyDeload` (`lib/ai-periodization/emergency-deload.ts:28`) therefore reduces to "≥3 sore muscles in the NEXT session's muscle map at completion time" — post-workout acute soreness from the session just done (mood log logged that evening) trivially satisfies it for overlapping splits. The stored emergency deload gets a 7-day expiry (`prescribe/route.ts:176`) and the pending-deload early-return (`prescribe/route.ts:151-162`) plus `shouldTriggerEmergencyDeload`'s own suppression keep re-serving it; a pending `deload_recommended` never enters the reevaluate path (`prescriptionDrivesLoad` false), so cleared soreness cannot retract the offer for up to 7 days.
- Failure scenario: the prescribe fired at completion targets the SAME session type just trained. User finishes that session and logs ≥3 sore matching muscles in that evening's/that day's mood check-in (routine post-training soreness) → the next week's session for that type gets an emergency whole-session deload instead of an LLM prescription. Days later, fully recovered, the offer still stands (7-day expiry) and the reevaluate path can never retract it because a pending `deload_recommended` never drives load.
- Recommendation: exclude the just-completed session when computing `hoursSinceLastSession` at generation time (or skip the 36h-soreness emergency arm at generation and leave it to the consumption-day re-check, which was built precisely for it); consider the 1-day expiry for soreness-driven emergency deloads, matching the per-exercise whole-session escalation.

### E2-4 — Running recovery gate: `strain` and `hoursSinceLastRun` are assembled (with DB queries) but never read by the gate — Foster monotony/strain protection is a no-op
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `RecoveryGateInputs` declares `strain` and `hoursSinceLastRun` (`lib/running/recovery-gate.ts:12,14`), and `app/api/running-plan/route.ts:67-82` computes both (incl. `computeMonotonyStrain` over 7 daily loads and an activity-log scan). The body of `applyRecoveryGate` (`recovery-gate.ts:40-79`) references only `readiness`, `readinessProvisional`, `hoursSinceLowerBodyStrength`, `lastLowerBodyVolumeKg`, `acwr`, `sleepHoursLastNight` — `i.strain` and `i.hoursSinceLastRun` appear nowhere. Grep of `lib/running/` confirms no other consumer.
- Failure scenario: a week of monotonous high load (exactly what Foster strain exists to flag) never softens a prescribed run; back-to-back hard runs on consecutive days are never gated by run spacing. The dead-signal class the 07-10 review flagged (AI-1), reintroduced in the 2026-07-17 running engine.
- Recommendation: either wire `strain` (e.g. escalate SOFTEN above a documented threshold) and use `hoursSinceLastRun` to block consecutive hard days, or delete the fields and their assembly cost so the interface stops advertising protection it doesn't provide.

### E2-5 — Running gate `sleepHoursLastNight` is the BEST night since week start, not last night — short-sleep soften nearly unreachable
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/running-plan/route.ts:45` fetches `listSleepSessions(userId, weekStartIso, todayIso)` (week-to-date window) and line 85-87 computes `Math.max(...sleepSessions.map(s => s.durationHours ?? 0))`. The gate treats this as "Short sleep last night" (`recovery-gate.ts:69-71`, threshold 5.5h).
- Failure scenario: user sleeps 8h Monday, 4h Thursday night; Friday's hard run is NOT softened because the week's max (8h) is compared against 5.5. The trigger can only fire when every night since Monday was short — or on Mondays. Wrong-training-number class: the engine prescribes intervals on a 4-hour night.
- Recommendation: fetch only last night (e.g. window `shiftDateStr(todayIso,-1)..todayIso`, pick the session whose wake date is today, longest if several), matching the field's name and the gate's message.

### E2-6 — Running gate elapsed-hours math anchors at END of today (`todayMid + 86_400_000`), so the 24h heavy-legs interference check only fires for leg sessions started TODAY
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/running-plan/route.ts:61` — `hoursSinceLowerBodyStrength = (todayMid.getTime() + 86_400_000 - lastLeg.startedAt.getTime()) / 3_600_000`, i.e. hours from the leg session to *midnight tonight*, always ≥ the real elapsed time by (24h − current time-of-day). The gate threshold is `< LEG_INTERFERENCE_HOURS = 24` (`recovery-gate.ts:26,51-56`). Any leg session started before today's local midnight computes ≥ 24 and never triggers. Same anchor is used for `hoursSinceLastRun` (line 80-82, currently dead per E2-4).
- Failure scenario: heavy squats yesterday 20:00; user opens the running tab at 07:00 and is prescribed intervals — real gap 11h, computed 28h, no interference soften. The classic morning-after-leg-day case (the one the constant is documented for) is structurally unreachable; the check degenerates to "did you train legs earlier today".
- Recommendation: anchor at `Date.now()` (the prescription is being read now); if a whole-day semantic is wanted, the conservative anchor is start-of-day, not end.

### E2-7 — `runsThisWeek` counts pending (never-run) prescribed rows as completed training — merely opening the running tab advances the 80/20 sequence toward an interval day
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/running-plan/route.ts:46,89` — `getPrescribedRuns(userId, weekStartIso, todayIso)` filtered only by `status !== 'skipped'`, so `status='pending'` rows count. The GET handler creates today's `prescribed_run` row on every first view of the tab (lines 150-158), and nothing ever auto-skips a stale pending row (PATCH schema `lib/validation/prescribed-run.ts:7` only accepts `completed|skipped` from the user). `polarized.ts` `nextRun` counts these rows as `easySoFar`/`hasLong` to decide when the weekly interval/long run is due.
- Failure scenario: user opens the running tab Mon–Fri without running once (five pending 'easy' rows accumulate); Saturday the framework sees `easySoFar ≥ 4, hardSoFar 0` and prescribes a hard interval session as the user's FIRST run of the week — inverted 80/20.
- Recommendation: count only `status === 'completed'` rows (optionally pending rows for *today*), or auto-skip stale pending rows from previous days when assembling the week.

### E2-8 — Running gate readiness "provisional" flag fires whenever TODAY's summary row is absent — hard runs silently softened on any morning the rollup hasn't run yet
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/running-plan/route.ts:41,51` — `getOuraDailySummary(userId, todayIso, todayIso)` then `readinessProvisional = (summaries[0]?.nHistory ?? 0) < 14`. No row for today (ring not yet synced this morning, or rollup keyed to yesterday) → `?? 0` → provisional=true → `escalate(SOFTEN)` with "baseline is still learning" (`recovery-gate.ts:61-62`), downgrading any tempo/interval/long to easy. This contradicts the route's own contract comment ("Every signal degrades to neutral (null) on absence — the gate never fabricates", route.ts:28).
- Failure scenario: user checks the plan before the morning BLE sync completes; the weekly quality session is shown as an easy run with a misleading "baseline still learning" reason, and that softened type is persisted as today's `prescribed_run` row (never overwritten later per the no-clobber rule at route.ts:151-152) — the day's stored run stays soft even after data arrives.
- Recommendation: treat a missing summary row as neutral (look back a day for the latest summary's `nHistory`, or skip the provisional soften when no row exists at all).

### E2-9 — Resting HR + Recovery test: HRR1 is structurally null — recovery is anchored at capture end, and HR sampling stops at that same instant
- Severity: high
- Status: CONFIRMED
- Dup: no (KI row "Cardio Baseline Fitness Tests … not device-verified" is a verification gap; this is a logic bug provable without a device)
- Evidence: `components/fitness-tests/test-result.tsx:41-42` sets `recoveryStart = new Date(capture.endMs)` and calls `baselineHrr1(readings, recoveryStart)`. `capture.endMs = Date.now()` at the moment Finish is tapped (`test-active.tsx:48-53`), and HR capture stops on unmount right then (`test-active.tsx:57-62`), so every reading is ≤ endMs. `baselineHrr1` → `analyseHrRecovery` (`lib/workout/hr-analysis.ts:64-66`) needs a reading near `endMs + 60s` within a 45s window — the closest sample is 60s away, outside the window → `bpm60 = null` → `hrr1 = null`, always.
- Failure scenario: user runs the "Resting HR + Recovery" protocol exactly as described (rest, 1-min hard effort, rest, tap Finish): the primary stat "1-min HR recovery" renders "—" every single time, and `hrr1Bpm: null` is persisted; the HRR baseline the protocol exists to measure can never be captured on any device. Additionally, even if sampling continued, `endMs` is the wrong anchor — the protocol's recovery window starts at the END OF EFFORT (≈ the peak-HR instant), not at the Finish tap after the rest.
- Recommendation: anchor recovery at the time of peak HR within the capture (e.g. the timestamp of `maxHrFrom`), and compute HRR1 from samples already inside the capture (the user's post-effort rest minute) — no post-finish sampling needed.

### E2-10 — "End test early" applies full-duration VO2max equations (Ross 6MWT / Cooper 12-min) to a truncated distance — grossly wrong VO2max saved and propagated
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `components/fitness-tests/test-active.tsx:95-96` offers "End test early" which calls `finish()` with whatever distance was covered; `test-result.tsx:34-35` unconditionally applies `sixMwtVo2max`/`cooperVo2max` — both distance-only equations calibrated to the full 360s/720s protocol (`lib/fitness-tests/protocols.ts:28,39`). No duration check exists anywhere in the flow; `durationSec` is stored but never validated against `protocol.durationSec`.
- Failure scenario: user aborts the Cooper run at 6 min with 1200 m covered → VO2max = (1200−504.9)/44.73 ≈ 15.5 mL/kg/min saved as a genuine baseline. `app/api/running-plan/route.ts:120-125` then picks the latest test's `vo2maxEst` into the fitness snapshot, and the OTS/VO2max banding consumes the same stored value — a single mistap poisons downstream training numbers for 90 days.
- Recommendation: when `capture.endMs − capture.startMs` is materially short of `protocol.durationSec` (e.g. <90%), skip the VO2max computation (save HR stats only) or require explicit confirmation that the result will be discarded.

### E2-11 — Failed-generation retry (and the "preparing" gate) can never fire after a normal completion: nothing nulls the prescription on consume, so the `'consumed' + null` signature is unreachable on that path
- Severity: medium
- Status: CONFIRMED
- Dup: no (AI-9 "single-shot generation no retry" added in-route `withAiRetry`; this is the outer safety net not matching its own trigger condition)
- Evidence: `completeWorkoutFromPayload` (`lib/workout/complete-workout.ts:51`) only flips status to `'consumed'` — the prescription JSONB is left in place. The only writers of `prescription: null` are `advancePhase` (`lib/data/postgres/slices/periodization.ts:88`) and `clearProgramPrescriptions` (`:134`, program edits). But `isAiPrescriptionPending` (`lib/ai-periodization/prescription-pending.ts:20-21`) requires `prescriptionStatus === 'consumed' && prescription == null`, and both the workout-data failed-generation retry (`app/api/workout-data/route.ts:367-374`) and the client "preparing your AI workout" state key off it. The route's own comment (:358-360: "the previous session consumed its prescription slot but no prescription ever landed … Without a retry here, the gap persists until the next session's completion") describes exactly the case the signature cannot match.
- Failure scenario: user completes a workout; the fire-and-forget `/prescribe` from `app/api/complete-workout/route.ts:44` fails (Gemini outage, 429 after rate-limit exhaustion, Railway blip). State is `'consumed'` + old prescription retained → every later workout-data fetch computes `aiPrescriptionPending=false`, fires no retry, shows static base numbers with no "preparing" indication. The next AI prescription only appears after the NEXT session's completion — one outage silently costs two sessions of AI-driven load, the precise outcome the retry was built to prevent.
- Recommendation: either null the prescription (or set a dedicated flag) when consuming in `completeWorkoutFromPayload`, or widen the retry/pending signature to `status === 'consumed'` regardless of the retained (non-driving) prescription JSONB, with the generatedAt timestamp guarding against refiring when a fresh prescription already landed.

### E2-12 — Next-session (AI-dynamic) deload recommender: readiness and temperature inputs read frozen `oura_daily` — readiness-graded deload strengths unreachable, defaults make every 3rd consecutive training day a "soft deload"
- Severity: medium
- Status: CONFIRMED
- Dup: no (S5 stress wiring shipped for this site; item 21 is display honesty; neither covers readiness/temp feeding this recommender)
- Evidence: `lib/data/postgres/adapter.ts:1550,1599-1601` — the AI-dynamic branch of `getNextSession` reads `readinessScore`, `temperatureDeviation`, `daySummary` from `getOuraDaily(userId, todayIso, todayIso)`; all three columns are Cloud-only (frozen since re-key — the sole BLE writer of `oura_daily` writes wear-time, adapter.ts:4641). In `computeDeloadStrength` (`lib/ai-periodization/ai-dynamic.ts:170-188`): `tempAlert` can never be true; `readinessScore` is always null so `r = readinessScore ?? 70` → the `r >= 50 → 'recommended'` and `r < 50 → 'strong'` branches are unreachable from readiness, and after ≥3 consecutive training days the recommender ALWAYS emits a soft deload regardless of actual (excellent or terrible) recovery. `lowReadiness` (`:216`) is likewise always false, so the recovery-weighted scoring shift never engages via readiness. The live BLE readiness composite is present in the `derivedRows` already fetched two lines up (`adapter.ts:1556`, `oura_daily_derived.readiness_score`) but only `stressHighMinutes`/illness are read from it.
- Failure scenario: since 2026-07-07, the home-screen next-session deload recommendation is readiness-blind: a 35/100 readiness morning after 3 training days still shows only "soft", and a 90/100 readiness morning ALSO shows a deload suggestion — both wrong in opposite directions; skin-temp fever deviation can no longer raise the alert (only the separate illness radar path can).
- Recommendation: source readiness from `derivedRows.find(r => r.day === todayIso)?.readinessScore` (mirroring the stress fix at adapter.ts:1561-1565) and temperature from the daily-summary tempZ path used by signals.ts; keep the Cloud fields only as explicit fallbacks.

## Not exercised
- No runtime execution: no dev server, no live Gemini call — `generateObject`/`withAiRetry` behaviour under real 429/502 responses and the actual latency of the post-completion regeneration window were not observed.
- On-device paths: live HR sampling cadence during fitness tests (E2-9 is provable statically, but the exact sample timestamps were not observed), GPS distance accuracy, and the S25 WebView poll behaviour of the "preparing" screen.
- `app/api/ai-periodization/baseline/complete` and `.../transition` routes were only skimmed (fire-and-forget prescribe confirmed; their phase-ordering internals not deeply traced — 07-10 AI-9/17 marked shipped).
- `lib/ai-periodization/muscle-recovery.ts`, `explain.ts`, and the respond route's status transitions were not deeply audited (CCH-1 invalidation dup territory).
- Concurrency: parallel prescribe POSTs for the same session (e.g. multiple non-poll workout-data fetches after a program edit) — no in-flight dedup exists in the route; last-write-wins on `storePrescription` was reasoned about, not exercised.
- The `pushMutations` fitness-test branch / server route for fitness tests (mirror-drift check) was not audited.
- Running engine Phase-2 items (weekIndex always 0 / volume growth) — tracked as backlog F3, not re-raised.

---

# Dimension F — AI usage (LLM routes & prompts)

## Summary
All 15 LLM surfaces were read end-to-end. The overall engineering standard is high: every structured output uses `generateObject`+Zod with deterministic post-processing that distrusts the model (generate-program overrides muscles from the DB, prescribe clamps into `intensityZoneForRole` + autoregulation, workout-review filters invented ids, nutrition-goals clamps against a computed baseline, scan computes totals from ingredients in code). Rate limits exist on every route and the three insight/digest routes check their DB cache **before** spending or counting against the limit; daily-digest adds a context-hash so unchanged days never re-spend. `withAiRetry` is sound (retries only 429/5xx/NoObjectGenerated, exactly once, no double-spend on non-retryable errors), and streaming routes share a proper mid-stream error marker (`lib/ai/stream.ts`). The S7 AI-signal-consistency fix **holds**: temp-z, sleep-quality-trend, SpO2 trend, illness radar, and daytime stress all reach the prescription prompt and/or chat tools.

The two significant problems are on the write path and the signal plane. (1) The chat route's pre-LLM regex body-weight auto-log (F1) writes the *first* "N kg" number in a message to `body_metrics` with manual (highest-precedence) provenance — on the Overview tab *any* kg mention triggers it — a silent health-data poisoning path. (2) The AI layers' notion of "current readiness" still reads the structurally-dead post-re-key `oura_daily` Cloud table (F8): the prescribe engine's `external_readiness < 40` rest-day trigger can never fire, chat says "no Oura data" daily, and the weekly digest dropped its readiness line — all while the app's own composite sits computed in `oura_daily_derived`. The newest signal generation (resilience, BDI, zone minutes, Training Stress/OTS) repeats the one-way-pipe pattern: computed, stored, surfaced in UI routes, invisible to every AI layer (F9). Secondary: the `<sheet_chart>` free-text JSON path has no shape validation before chart.js (F2), and builder-chat lacks the hallucinated-exercise-name filter its sibling has (F5).

## Route inventory

| # | Route | Model call | Structured? | Rate limit | Cache-before-spend | Notes |
|---|-------|-----------|-------------|------------|--------------------|-------|
| 1 | `app/api/ai-chat/route.ts` | streamText gemini-3.1-flash-lite, tools, stepCountIs(6) | free text + `<sheet_chart>` tag | yes 15/min | n/a (streamed) | pre-LLM regex body-weight write (F1); tools all read-only |
| 2 | `app/api/nutrition/scan/route.ts` | generateObject (image or text) | Zod ScanSchema; deterministic totals via `sumIngredients` | yes 10/min | n/a | body-size caps, control-char strip, 500-char note cap — reference-quality route |
| 3 | `app/api/running-plan/explain/route.ts` | generateText prose | prose only, deterministic fallback on error | yes 15/hr | n/a (client caches?) | unbounded Zod strings interpolated into prompt (F6) |
| 4 | `app/api/ai/health-insight/route.ts` | generateText prose | prose | yes 10/hr, after cache check | yes (`getAiHealthInsight` per section+date) | no withAiRetry → SDK default 2 retries (F7); frozen-Cloud fields annotated |
| 5 | `app/api/weekly-digest/route.ts` | generateText + withAiRetry | prose | yes 3/min after cache | yes (per ISO week key) | best signal coverage: own sleep score, illness, daytime stress |
| 6 | `app/api/daily-digest/route.ts` | generateText + withAiRetry | prose | yes 3/min after cache | yes + context-hash regeneration guard | good pattern |
| 7 | `app/api/session-explain/insight/route.ts` | streamText | prose stream | yes 20/hr after cache | yes (per session-id+day, onComplete write) | clean |
| 8 | `app/api/generate-program/route.ts` | generateObject + withAiRetry | Zod + heavy server post-processing | yes 20/hr | n/a | prompt self-contradiction (F4); library context ~141 lines ≈ 2.5–3.5k tokens (acceptable) |
| 9 | `app/api/builder-chat/route.ts` | generateObject + withAiRetry | Zod + style/muscle re-enforcement | yes 20/hr | n/a | missing exercise-name whitelist filter its sibling has (F5) |
| 10 | `app/api/ai-periodization/session/[id]/prescribe/route.ts` | generateObject + withAiRetry | Zod PrescriptionSchema + reconcile/clamp layers | yes 10/hr | prescription stored/reused | best-in-repo prompt (`lib/ai-periodization/prompt.ts`); externalReadiness dead (F8) |
| 11 | `app/api/workout-review/session/[id]/route.ts` | generateObject + withAiRetry | Zod + `reconcileReview` (invented-id filter, budget trim) | yes 10/hr | n/a | clean; logs invented ids |
| 12 | `app/api/workout-sessions/[id]/recap/route.ts` | generateText + withAiRetry | prose | yes 20/hr after cache | yes (per session id) | clean; deterministic facts via `buildRecapFacts` |
| 13 | `app/api/nutrition-goals/recommend/route.ts` | generateObject bare | Zod + `clampRecommendation` deterministic clamp | yes 5/min | n/a (persists rec row) | no withAiRetry/maxRetries:0 (F7) |
| 14 | `app/api/exercises/generate/route.ts` | generateObject + withAiRetry | Zod, enum-constrained muscles/equipment | yes 20/min | n/a | clean |
| 15 | `app/api/ai-chat/tts/route.ts` | `@google/genai` gemini-2.5-flash-preview-tts | audio bytes | yes 10/min | no | separate `GEMINI_API_KEY` env (F11); 2,000-char Zod cap |
| — | `respond`/`transition` (ai-periodization) | no LLM call | — | — | — | deterministic state transitions only |

## Findings

### F1 — Chat body-weight regex auto-log writes the first "N kg" number in the message; on the Overview tab ANY "kg" mention logs body weight
- Severity: high
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/ai-chat/route.ts:88-101`. Trigger: `/\b(?:log|record|save|update)\b.*\bweight\b|\bweight\b.*\b(?:log|record|save|update)\b|\bmy\s+(?:body\s+)?weight\s+(?:is|today|as)\b/i` OR (`/\b\d+(?:\.\d+)?\s*kg\b/i` AND `sessionType === "Overview"`). The value written is the **first** `(\d+(\.\d+)?)\s*kg` match anywhere in the prompt (`route.ts:91`), gated only by `validWeightKgOrNull` (20–500 kg, `lib/validation/body-metrics.ts:11-15`). Write: `repo.upsertBodyMetrics(userId,[{date: todayIso, weightKg}], 'manual')` — `adapter.ts:1698-1720` upserts with `mergeSet(..., 'manual')`, i.e. the value lands with **manual provenance**, the highest-precedence source, overwriting any real weight for today.
- Failure scenario: (a) on the Overview tab (`ta_session` cookie set to "Overview" by chat.tsx), the user asks "should I try 100kg on deadlift today?" → body weight silently logged as 100 kg for today with manual provenance; a later ring/HC value cannot correct it. (b) any tab: "can you update my target weight for bench? last set was 80kg" matches `update…weight` → 80 kg logged as body weight. (c) "log my weight — I benched 100kg, I'm at 92kg now" logs **100** (first match), not 92. The model then confidently confirms the wrong log (`writeContext` → "Completed: Body weight 100kg logged"). Also: the client never invalidates body-metric caches after this server-side write, so even a *correct* chat log shows stale on Health until TTL.
- Recommendation: replace the regex heuristic with an LLM **write tool** (`logBodyWeight(weightKg)`) that requires the model to extract the value in context — tools are already wired and everything else is read-only; or at minimum require the kg number to be adjacent to the word "weight/weigh" and drop the Overview-tab any-kg branch. Have the client invalidate the body-metrics cache group when the response contains the logged confirmation.

### F2 — `<sheet_chart>` payload is JSON.parsed with zero shape validation and fed straight to chart.js — a wrong-shape but valid-JSON block crashes the chat overlay render
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `lib/parse-chart-blocks.ts:27-33` — `charts.push(JSON.parse(match[1]))`, only a syntax try/catch, no Zod. `components/chart-message.tsx:44-57` immediately does `datasets.map(...)` and passes `labels`/`type` through. `components/ai-chat-overlay.tsx:19-31` renders `ChartMessage` with no error boundary. CLAUDE.md's own AI rule ("never JSON.parse of free text" for structured data) is violated on this one path.
- Failure scenario: model emits `<sheet_chart>{"type":"line","labels":["a"],"datasets":{"label":"x"}}</sheet_chart>` (valid JSON, datasets not an array) → `datasets.map` throws during render → React unmounts to the nearest error boundary, killing the whole chat sheet mid-conversation. flash-lite emitting a malformed block under token pressure is exactly the kind of drift this class sees. Note also `options.scales.ticks.color: 'var(--muted-foreground)'` at `chart-message.tsx:71-77` — a CSS var handed to canvas paint, the exact pattern CLAUDE.md bans (renders fallback/black); dup-adjacent to the R7 chart-colour class but this instance is unlisted.
- Recommendation: add a small Zod schema for `ChartPayload` in `parseChartBlocks` (skip block on failure — same UX as invalid JSON today), and wrap `ChartMessage` in an error boundary. Resolve theme colours via `resolveColor` instead of `var()` strings.

### F3 — Chat tool surface is read-only (positive containment note) but prompt-injection can still steer the pre-LLM weight write's *confirmation*, and `localDate` is regex-valid but not calendar-valid
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: every tool in `lib/ai-chat/tools.ts` is a pure read (verified all 11: getWorkoutsByExercise … getMilestones — no repo write calls). Conversation history is capped (20 turns × 2,000 chars, `route.ts:38-41`) and kept out of the system prompt (`route.ts:152-157`). The only write happens before the LLM sees anything (F1), so injected text in food names/exercise names can at worst produce bad advice or a bogus chart — no data mutation. `localDate` passes `/^\d{4}-\d{2}-\d{2}$/` (`lib/validators/chat.ts`) but `2026-99-99` passes the regex; `fromZonedTime` then yields Invalid Date → NaN window → repo query throws → 500 "Chat failed".
- Failure scenario: injection: minimal (read-only tools). The invalid-date path is self-inflicted-client only; still a 500 instead of a 400.
- Recommendation: keep the tool surface read-only if a write tool is added for F1, gate it on an explicit value schema (Zod min/max as today). Validate `localDate` semantically (`normalizeDateParam` per the Date-Arithmetic rule — this route was named in the 07-06 sweep; the regex was added but calendar validity was not).

### F4 — generate-program prompt contradicts itself on exercise count: computed target says "~7–9 exercises", Rule 6 says "2–3 compounds + 1–2 isolation"
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/generate-program/route.ts:140-156` builds `targetExercises` ("target ~N exercises (X compounds + Y accessories)", or with no time constraint "5–6 compounds + 2–3 accessories = 7–9 exercises per session"), injected at line 183. Rule 6 at line 222: "Structure each session as: 2–3 compound exercises + 1–2 isolation exercises." — a hard cap of 3–5 that directly contradicts the computed 6–9 target. Rule 1 ("use the recommended split") also collides with Rule 12's consecutive-muscle constraint for the 6-day PPL×2 recommendation (Legs B→Push A is fine, but Push A→Push B adjacency in "Push/Pull/Legs/Push/Pull/Legs" ordering never occurs — that one is consistent; the count contradiction is the real one).
- Failure scenario: flash-lite resolves the conflict unpredictably — programs come back with 3–5 exercises per session when the time budget calls for 8, silently undershooting the volume targets the same prompt calls "critical". This matches the class behind the "Preparing your AI workout" retry machinery: schema-valid but instruction-conflicted outputs.
- Recommendation: delete Rule 6 or rewrite it to defer to the computed target ("compound:isolation ≈ 60:40 of the session target above"). One count authority per prompt.

### F5 — builder-chat does not filter model-returned exercise names against the library — hallucinated exercises flow into the saved program (its sibling generate-program does filter)
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/generate-program/route.ts:256-259` filters `sess.exercises` to `validNames` from the library. `app/api/builder-chat/route.ts:175-202` has no such filter: it re-enforces styles and overrides muscles only when `exerciseMuscleLookup.get(ex.name)` hits (`:192`); a miss falls back to the AI's own `ex.mainMuscles ?? []` (`:197-198`). The result is returned to the builder UI and saved via `POST /api/workout-templates` → `repo.saveProgram` (`app/api/workout-templates/route.ts:46-52`), which performs no library-name validation either.
- Failure scenario: user asks builder-chat "swap incline press for a landmine variation"; model invents "Landmine Chest Press" (not one of the 141 library rows). The exercise saves with AI-supplied (per CLAUDE.md "regularly misattributed") or empty muscle assignments — muscle-recovery, weekly-set counts, heatmaps and the periodization engine's per-muscle volume steering silently under-count that muscle from then on. Also a prompt-injection write vector: chat text is the one user-controlled string that can shape a persisted program.
- Recommendation: apply the same `validNames` filter (and surface "removed N unknown exercises" in `response`), mirroring generate-program — the Sibling-Surface Sweep rule applies verbatim.

### F6 — Unbounded user strings interpolated into prompts: running-explain `rationale`/`gateReasons` and builder-chat `chatHistory[].content` have no length caps
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/running-plan/explain/route.ts:8-13` — `rationale: z.string()`, `gateReasons: z.array(z.string())`, both unbounded, joined straight into the prompt (`:32`). `app/api/builder-chat/route.ts:14-17` — `ChatMessageSchema.content: z.string()` unbounded (the live `message` is capped at 1,000; ai-chat caps history at 2,000 chars/turn, so the caps exist elsewhere and were missed here). `program: GeneratedProgramSchema` is also serialized wholesale into the prompt (`:132`).
- Failure scenario: not a stranger-attack surface (single-user, authed), but a buggy or replayed client can ship megabyte prompts → token spend and 502s; also the same unbounded-Zod class TMR-3 fixed on the timing route.
- Recommendation: cap `rationale`/`gateReasons` items (~500 chars) and `chatHistory[].content` (~2,000 chars) to match ai-chat.

### F7 — health-insight is the only AI route using the SDK's default retry policy instead of `withAiRetry` — retry semantics fork
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `lib/ai/retry.ts:24-27` documents the design: "Callers pass maxRetries: 0 to the SDK call so the retry policy lives in one place." Every other generate call does so (`nutrition/scan:102`, `generate-program:251`, `builder-chat:158`, `weekly-digest:199`, `daily-digest:137`). `app/api/ai/health-insight/route.ts:123-126` calls `generateText` bare — no `withAiRetry`, no `maxRetries: 0` — so the AI SDK's default (2 retries with its own backoff) applies, and failures skip `reportServerError` observability that `withAiRetry` provides. `withAiRetry` itself is sound: `isRetryableAiError` only retries 429/5xx, so no non-retryable double-spend (verified `lib/ai/retry.ts:5-11`).
- Failure scenario: a hard 400 (e.g. safety block) still returns quickly, but a 429 burns up to 3 attempts against the free-tier RPD without the shared jitter/reporting; retry behaviour differs between the four insight cards and every other AI surface.
- Recommendation: wrap in `withAiRetry(() => generateText({..., maxRetries: 0}))` like weekly-digest. Same fix applies to `nutrition-goals/recommend`: `app/api/nutrition-goals/recommend/route.ts:223-238` also calls `generateObject` bare (no `withAiRetry`, no `maxRetries: 0`).

### F8 — Every AI layer's "current readiness" reads the structurally-dead `oura_daily` Cloud table; the prescription engine's `external_readiness < 40` rest-day trigger can never fire again
- Severity: high
- Status: CONFIRMED
- Dup: likely (data-eff 1.1 "oura_daily_derived write-only … rest gated on P-D/P-E" + S9 dual-readiness consolidation track the general class; the AI-specific consequences below are not explicitly tracked anywhere)
- Evidence: `app/api/readiness-score/route.ts:280-285` states the invariant: post-re-key, "the wear-time writer is the only live oura_daily writer" — Cloud readiness/sleep/activity scores froze 2026-07-07, and the route computes an **own composite** (`computeReadinessComposite`, `:293-304`) persisted to `oura_daily_derived` (`:374-385`). Yet: (a) `lib/ai-periodization/signals.ts:460-461` sets `externalReadiness` from `repo.getOuraDaily(userId, today, today) → readinessScore` — structurally always null; the prescribe prompt's rest-day rule "external_readiness < 40" (`lib/ai-periodization/prompt.ts:157-166`) is dead code, and the model reads "External readiness: no data" every session. (b) `app/api/ai-chat/route.ts:71` + `lib/ai-chat/context.ts:88-102` — the chat's default "Today:" recovery line comes from `oura_daily`, so it renders "Today: no Oura data" every single day; the own composite is never offered, and the `getRecoveryData` tool (`lib/ai-chat/tools.ts:53-79`) maps only illness + daytime stress from `oura_daily_derived`, not its `readiness_score`/`resilience` columns. (c) `app/api/weekly-digest/route.ts:137-145` `readinessOf` averages the same dead Cloud rows — the readiness line has been silently absent from every digest since the re-key. (d) `app/api/ai/health-insight/route.ts:70-92` at least annotates the stale fallback, but its "readiness" card still narrates a frozen pre-2026-07-07 score instead of the own composite the readiness screen shows.
- Failure scenario: the S25 user trains through a low-recovery day: own composite readiness is 35, but the prescription engine sees "no data", the chat says "no Oura data today", and the weekly digest never mentions readiness — the exact autoregulation signal the system was built around is invisible to all four AI layers while being displayed on the Health screen. AI advice and the visible readiness number also actively disagree (the model may say "no readiness data" seconds after the user looked at their score).
- Recommendation: thread the own composite through: `signals.externalReadiness` should read `oura_daily_derived.readiness_score` (fallback Cloud pre-re-key), and `buildRecoverySummary`/`getRecoveryData`/`readinessOf` should do the same. One readiness source per the One-Formula rule — the readiness-score route already persists it, so this is a read-side change only.

### F9 — Newest signals are one-way pipes again: resilience, BDI, zone minutes, and Training Stress/OTS are computed and stored but invisible to every AI surface
- Severity: medium
- Status: CONFIRMED
- Dup: no (S5 daytime-stress→chat/digest wiring has since shipped — verified present in `tools.ts:76-78` and `weekly-digest:158-167`; none of these four newer signals appears in any tracked AI-wiring item)
- Evidence: grep across all AI surfaces (`lib/ai-chat/*`, `lib/ai-periodization/signals.ts` + `prompt.ts`, `app/api/ai-chat`, `app/api/weekly-digest`, `app/api/daily-digest`, `app/api/ai/health-insight`) returns **zero** hits for resilience / zone-minutes / BDI / OTS / VO2. The data exists: own stress-resilience level (`lib/health/stress-resilience.ts:241-265`, persisted mig 127/123, surfaced in `readiness-score/route.ts:451-453`), BDI (`mig 128_bdi_derived`), zone minutes (`mig 129_daily_zone_minutes` + `app/api/zone-minutes/route.ts`), Training Stress/OTS (`lib/oura-models/inference/ots.ts` + `app/api/training-stress/route.ts`).
- Failure scenario: user asks the chat "am I overtraining?" → `getTrainingLoadRisk` returns ACWR only, while the purpose-built OTS risk model's output sits unread in the DB; "how resilient am I to stress lately?" → the model has no tool that can answer and will improvise from HRV. The weekly digest recaps a week where the user hit 150 zone minutes without ever being able to mention it. The prescribe engine weighs ACWR but never the OTS state that v1.162.0 was built to produce. This is the same one-way-pipe pattern the 07-16 data-efficiency review flagged for the previous signal generation.
- Recommendation: cheapest wins first: add resilience level + OTS band + weekly zone minutes as three lines in `buildRecoverySummary` and the weekly-digest context (all already queryable in the rows those routes fetch or one repo call away); extend `getRecoveryData`'s derived mapping with `resilienceLevel`; feed OTS state into `PrescriptionSignals` next to ACWR.

### F10 — User-controlled strings (`ta_session` cookie = user-defined session names) are interpolated into the chat SYSTEM prompt, contradicting the route's own history-isolation design
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/ai-chat/route.ts:53` reads the `ta_session` cookie (set client-side from user-defined program session names — `app/session-select/session-select-content.tsx:847`, `app/workout-select/workout-select-content.tsx:238`, `components/overview-screen.tsx:197`) with no length cap or sanitisation, and injects it into the **system** prompt at `:111`. The same route explicitly keeps conversation history out of the system prompt "so user-supplied content cannot influence the system instructions" (`:152-153`) — the cookie path defeats that intent. A session name is also what flips the F1 any-kg auto-log branch (`sessionType === "Overview"`, and a session literally named "Overview" would arm it).
- Failure scenario: single-user app, so this is hygiene rather than attack surface: a session renamed to something long/instruction-like ("Legs. Ignore the This Week section…") skews every chat answer from the system slot; a cookie set to a 4KB string bloats every request.
- Recommendation: whitelist-validate: the route already fetches the active program — match the cookie against actual session names + the two literals ("Overview", "AI Analysis"), else fall back to "General Training"; or cap and move the tab hint into the user message.

### F11 — TTS route depends on a second, separately-provisioned key (`GEMINI_API_KEY`) that the CLAUDE.md Railway env list omits
- Severity: low
- Status: PLAUSIBLE (cannot verify Railway env in sandbox)
- Dup: no
- Evidence: `app/api/ai-chat/tts/route.ts:11-13` constructs `GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })` — every other AI route uses `@ai-sdk/google` which reads `GOOGLE_GENERATIVE_AI_API_KEY`. `.env.example:22-24` documents the split ("can be the same key"), but CLAUDE.md's "Required in Railway" list contains only `GOOGLE_GENERATIVE_AI_API_KEY`. If Railway lacks `GEMINI_API_KEY`, every speak-aloud request 500s ("Error generating audio") while normal chat works, which looks like a TTS bug rather than a config gap.
- Failure scenario: user toggles speak-aloud in chat → every request fails with a generic 500; nothing in logs points at the env var (the constructor accepts undefined).
- Recommendation: read `process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY`, and add the var to the CLAUDE.md env list.

## Design notes — prompt quality (owner asked for critique)

**Best in repo:** `lib/ai-periodization/prompt.ts` — states units, date, null-handling ("omit absent signals from reasoning entirely"), declares the deterministic layers so the model doesn't double-apply cuts ("do NOT pre-emptively lower pct… a deterministic autoregulation layer applies those cuts after you"), pins trend semantics ("use rm1_trend only, not baseline_1rm"), and derives its zone text from the same `INTENSITY_ZONES` table the clamp uses (One-Formula done right). `nutrition/scan` and `exercises/generate` are also model prompts of their class.

**Token measurements:** exercise library = 141 rows; the `name|muscles|equipment` block ≈ 9–11 KB ≈ **2.5–3.5k tokens** worst case (full gym + full body) in generate-program, and builder-chat resends it (equipment-filtered only, no muscle filter) **plus** the full program JSON (~1.5–3k tokens) **plus** history *every turn* — ~5–7k tokens/turn. Tolerable on flash-lite pricing, but builder-chat could send only `name|equipment` (muscles are overridden server-side anyway — the prompt's muscle data is used purely for the model's volume tally, which the WEEKLY VOLUME EXAMPLE could cover with a per-muscle set summary computed in code instead).

**Concrete rewrite suggestions:**
1. generate-program: delete/replace Rule 6 (see F4) — one exercise-count authority. Also Rule 13's "tally sets per large muscle" asks flash-lite to do arithmetic the server never checks; consider a post-generation deterministic volume check that triggers the existing retry instead.
2. ai-chat system prompt: the chart example hardcodes `"backgroundColor":"#22c55e"` — models copy examples, so most charts come back green regardless of theme; drop the colour keys from the example and let `ChartMessage` defaults assign the palette.
3. ai-chat: "call at most 3 tools per answer" vs `stopWhen: stepCountIs(6)` — harmless but the two limits will confuse maintenance; align them.
4. ai-chat: "Body weight logging is handled automatically — confirm when it happens" invites the model to confirm logs the regex never made (no `Completed:` marker present). Rephrase: "Only confirm a body-weight log if the message contains a 'Completed:' line; otherwise tell the user to log it via Health."
5. weekly-digest context is the model for prose-route context blocks (units, week-over-week pairs, weighted-set note matching the periodization engine's weighting). health-insight's "Past week scores" line prints frozen Cloud scores post-re-key — swap to derived scores per F8.

## Not exercised
- Live model behaviour (does flash-lite actually mis-resolve the F4 contradiction / emit malformed chart JSON) — sandbox has no `GOOGLE_GENERATIVE_AI_API_KEY`; findings are code-traced only.
- Railway env state for `GEMINI_API_KEY` (F11) and free-tier RPD pressure under SDK-default retries (F7).
- TTS audio output correctness (L16→WAV conversion) on the S25 WebView.
- Whether any production `oura_daily` rows post-date the re-key (F8 relies on the readiness-score route's own stated invariant plus writer enumeration, not prod data).
- The prescribe route's full 476-line signal aggregation was skimmed, not line-audited (AI-1..17 batch already covered it; only the `externalReadiness` source was traced).

---

# Dimension G — Ring + strap data usage

## Summary
The two USED-BUT-FRAGILE invariants at the core of this dimension are in good shape at runtime but have guard-rail gaps. The cursor-advance-on-2xx contract is intact end-to-end (native service holds the persisted cursor until the server's durable insert returns 2xx; the server can no longer 500 out of the rollup) — no finding. The Lever-2 drop whitelist does not currently intersect any rollup-consumed tag, but the unit test that is supposed to make that impossible enforces a hand-copied 15-tag list that already omits two tags the rollup reads (0x7e/0x7f, queried outside the `rowsByTags` fan-out) — the invariant is real, the safety net has a hole (G-1). The Polar H10 path parses the HRS characteristic byte-correct per the pinned skill spec and the strap-over-ring precedence is centralized and sound; the real fragility is the hr-ingest route's all-or-nothing Zod schema, which silently discards an entire 40-sample flush when one bpm/RR sample is out of band — the classic batch-poison-pill class this repo has shipped three times before (G-2).

On capture-vs-use: the heavy hitters are genuinely consumed (IBI 0x80/0x60, HRV 0x5d, temps, 0x72/0x75 sleep signals, MET 0x50, aohr 0x86, SpO2 0x8b, step features 0x7e/0x7f — the brief's suspicion that aohr and step-features are unconsumed is outdated; both feed the rollup). The residual unused surface is mostly already tracked by the 2026-07-16 data-efficiency review and the backlog (0x59/0x47/0x6b/0x6c/0x74 deliberate keeps, cva 0x81 / atlas 0x87/0x88 parked, cumulative-stress and AWHR wiring deferred, body_battery_daily as a tuning snapshot). The owner's keep-everything-archival judgment holds up under pressure-testing: ingest drops are forward-unrecoverable, 0x47 is load-bearing for the step-validation tool, and undecoded tags storing with `decoded=null` is the documented I10 design. New, untracked items: a dead duplicate port of the steps-motion decoder (G-5), rr_intervals having no retention bound unlike its sibling HR table (G-6), and the accel-chunk route promising a "later recount pass" that does not exist (G-7).

## Signal → consumer map
| Signal / tag | Decoded? | Consumers (file:line) | Verdict |
|---|---|---|---|
| 0x76 bedtime_period | yes | rollup sleep windows (adapter.ts:4001,4026-4035) | USED |
| 0x4b/0x4e/0x5a sleep phases | yes | rollup hypnogram (adapter.ts:4121-4137) — dormant, Ring 5 emits none (KI dup); also wear | USED-when-present |
| 0x80/0x60 IBI | yes | night HR/RHR/onset (4097-4197), SleepNet input (4256), HR series (4590), wear (4626), stress (4716), live-HR client | USED (heavily) |
| 0x5d hrv_event | yes | nightly HRV median (4156-4167,4346), stager hv (4233), wear | USED |
| 0x6f spo2 / 0x8b R-PI | yes | body_metrics SpO2 (4470-4495), SleepNet spo2 channel (4270-4280) | USED (0x8b is the live source; 0x6f never emitted by Ring 5) |
| 0x86 aohr | yes (unvalidated) | HR series (4594-4597), wear (4626), stress allHr (4717) | USED — brief's "unconsumed?" is outdated |
| 0x46/0x69/0x75 temps | yes | nightly temp (4380-4390), stager, wear skin-gate (4629), resilience (4710-4713) | USED |
| 0x72 sleep_acm | yes | window clustering (4037-4062), stager movement, SleepNet motion | USED |
| 0x50 MET | yes | MET exclusion (4143-4148), metAvg (4647-4666), daytime stress (4714) | USED — but absent from ingest `BIOMETRIC_TAGS` rollup trigger (route.ts:70) |
| 0x7e/0x7f step features | naive-only (decode.ts:377 — fields meaningless by design) | steps_estimate via body_hex/unpack27 (adapter.ts:4506-4546); step-counter validation pipeline | USED — but MISSING from drop-whitelist test (G-1) |
| 0x61 battery subtypes 0x11/0x24 | yes | ring-battery telemetry (subtype keep, raw-storage.ts:30-45) | USED |
| 0x47 motion_event | yes | step-counter-export validation route only (route.ts:17) | validation-only; keep (drop would break tool + future gait counter) |
| 0x59 EDA, 0x6b motion_period, 0x6c feature_session, 0x74 intensity | yes | none | deliberate keep, owner-deferred 2026-07-16 — DUP (data-eff 1.5) |
| 0x81 cva_raw_ppg | yes | none — P-F P3 vascular-age GO/NO-GO | DUP (backlog holding, item 4a "cva parked") |
| 0x87/0x88 atlas bioZ | yes (unvalidated) | none | archival keep — DUP (item 4a) |
| 0x84 ambient | yes (unvalidated) | none | archival keep |
| 0x44, 0x48, 0x4a, 0x4d, 0x51/0x52, 0x54, 0x55, 0x57, 0x5c, 0x5e, 0x5f, 0x62, 0x63, 0x64, 0x65/0x66, 0x67, 0x68, 0x6a, 0x6d, 0x6e, 0x70, 0x71, 0x73, 0x7a | NO decoder — stored `decoded=null` | none (re-decodable from body_hex forever) | deliberate archive (ops-manual I10); see Design notes on 0x54/0x55 |
| 0x42/0x43/0x45/0x53/0x56/0x5b/0x61-nonbattery/0x79/0x82/0x83 | (dropped at ingest) | — | Lever-2 drop, verified non-intersecting today |
| oura_accel_chunks.magnitudes | — | write-only after ingest-time count; 7-day prune (adapter.ts:4875-4878) | DUP (data-eff 1.5) + G-7 (recount pass nonexistent) |
| rr_intervals | — | only `getRrForWindow` for completed-workout HRV (hr-data/route.ts:26) | G-6: no retention prune; pre/post-window beats never readable |
| body_battery_daily | — | write-only tuning snapshot (slices/body-battery.ts:8-10, docs/body-battery-tuning.md); `getBodyBatteryHistory` has zero callers | deliberate archive — DUP (data-eff 2.3); dead read method noted in G-8 |
| Model ports: cumulative-stress / ASTD / AWHR selector | — | none (library-only, documented) | DUP (backlog serial + P-E + item 4a) |
| Model port: steps-motion-decoder ×2 copies | — | oura-models copy → step-counter pipeline; oura-ble copy → nothing | G-5 dead duplicate |

## Findings

### G-1 — Lever-2 drop-whitelist safety test omits 0x7e/0x7f (rollup-consumed step-feature tags) and is a hand-copied list
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `lib/oura-ble/__tests__/raw-storage.test.ts:8-10` hardcodes `ROLLUP_CONSUMED_TAGS = [0x76, 0x4b, 0x4e, 0x5a, 0x80, 0x60, 0x5d, 0x6f, 0x8b, 0x86, 0x46, 0x69, 0x72, 0x75, 0x50]`. But `aggregateOuraRawSamples` ALSO reads tags 0x7e/0x7f directly from `oura_raw_samples` in the `steps_estimate` step (`lib/data/postgres/adapter.ts:4506-4512`, `inArray(s.ouraRawSamples.tag, [0x7e, 0x7f])`) — a second query outside the `rowsByTags` fan-out at adapter.ts:4000-4011. The same stale claim is baked into the whitelist comment (`lib/oura-ble/raw-storage.ts:6-8` lists only the 15 tags) and `docs/module-map.md:32`. Additionally, the battery-telemetry consumer reads 0x61 rows (kept only via the `isBatteryDebugEvent` subtype exception), and the test list is a manual copy of the adapter code, not derived from it — it drifts silently whenever the rollup adds a tag (it already has, twice: 0x7e/0x7f and 0x8b was added later but did get copied).
- Failure scenario: no data is lost *today* (0x7e/0x7f are not in `RAW_STORAGE_DROP_TAGS`). But the invariant the test claims to enforce — "the drop-list can NEVER intersect a rollup-consumed tag" — is false as written: a future Lever-2 widening that adds 0x7e/0x7f (plausible: they're "feature vectors, not a count" per decode.ts:368-376, and the naive decode is documented as meaningless) would pass the whole suite while silently and unrecoverably killing the daily step estimate (ingest-time drops are forward-unrecoverable per the plan's own constraint).
- Recommendation: add 0x7e/0x7f (and 0x61-battery as a subtype note) to `ROLLUP_CONSUMED_TAGS`, fix the raw-storage.ts:6-8 comment and module-map row, and ideally export the consumed-tag list from one shared module that both the adapter queries and the test import, so the list cannot drift from the code.

### G-2 — hr-ingest Zod rejects the whole strap batch on one out-of-band sample (bpm=0 pre-lock / RR artifact)
- Severity: medium
- Status: CONFIRMED (code path); device trigger PLAUSIBLE
- Dup: no
- Evidence: `app/api/hr-ingest/route.ts:8-14` — `BodySchema` requires every sample `bpm >= 20 && <= 250` and every RR `>= 200 && <= 4000`; `safeParse` failure returns 400 for the ENTIRE batch (route.ts:26). The client parser (`lib/live-hr/hr-measurement.ts:14-40`) passes through bpm=0 and RR up to 63,999 ms (raw u16/1024) unfiltered; `ChestStrapSource` buffers every worn-state sample and flushes 40 at a time with `fetch(...).catch(() => {})` (`lib/live-hr/chest-strap-source.ts:77-78,114-118`) — a 400 is silently swallowed and the batch is gone (no re-queue on this path, unlike the ring's live-frame re-queue).
- Failure scenario: the H10 commonly reports bpm=0 with contact=true during signal acquisition at strap-on (and RR artifacts >4000 ms during poor-contact moments). One such sample poisons its flush batch: up to 40 s of strap HR + all its RR beats are dropped silently — typically the opening minute of every workout, which then also degrades the post-workout `workoutHrvMs` (hr-data reads only stored RR). This is exactly the CLAUDE.md "one bad key rejects the batch" / "Zod poison-pill" class.
- Recommendation: filter per-sample instead of failing the batch — either drop out-of-band samples client-side before buffering (bpm < 20 → skip), or have the route `filter` invalid samples and store the rest. Keep the 400 only for structurally invalid payloads.

### G-3 — Cursor-advance-on-2xx invariant: verified intact (no finding)
- Severity: low (informational)
- Status: CONFIRMED sound
- Dup: no
- Evidence: native path — `OuraRingService.kt:339-351` advances only the in-memory `drainCursor`; the persisted `history_cursor_ds` moves solely in `confirmStored()` (kt:540-550, monotonic guard) which is called only when `postFramesWithRetry` returned non-null (kt:380-391), and `postFrames` throws on any non-2xx (kt:462-463). A failed batch sets `drainIngestFailed` so later batches of the same drain are skipped, never confirmed (kt:375-379); flag reset per new drain (kt:529). Server side — `app/api/oura-ble/samples/route.ts:61-84` inserts durably before responding, and a rollup failure is caught so it can never 500 and wedge the cursor. Minor note: `BIOMETRIC_TAGS` (route.ts:70) omits 0x50, so a MET-only batch skips the rollup trigger until the next biometric batch — cosmetic latency, not loss.

### G-4 — Polar H10 HRS parse + strap precedence: verified correct (no finding)
- Severity: low (informational)
- Status: CONFIRMED sound
- Dup: no
- Evidence: `lib/live-hr/hr-measurement.ts:16-39` matches the pinned spec (`.agents/skills/polar-h10-ble/SKILL.md:94-107`): bit0 16-bit HR, bit1 contact, bit2 contact-supported, bit3 energy (skipped 2 bytes), bit4 RR, RR = raw/1024×1000 ms. Worn-gate (15 s grace, `chest-strap-source.ts:87-95`) reports 'disconnected' when off-chest so `manager.ts:36-40` precedence (strap registered first) falls back to the ring. Read-side precedence is centralized: every HR read goes through `getHrForWindow` → `preferStrapBuckets` (`lib/data/postgres/slices/oura.ts:411-422`, `lib/health/hr-window-merge.ts`), and the ring rollup's delete-and-reinsert only targets `source='ble'` (adapter.ts:4605-4608) so strap rows survive. RR beat-time reconstruction walks backwards from packet receive time (`app/api/hr-ingest/route.ts:37-47`) — sound for its only use (set-window classification of beats; rMSSD uses the RR values, not the reconstructed times).

### G-5 — Two independent ports of `steps_motion_decoder_2_0_0`; the lib/oura-ble copy is dead code
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `lib/oura-ble/steps-motion-decoder.ts` (per-packet `decodeStepsPacket`/`decodeColumn` API) and `lib/oura-models/steps-motion-decoder.ts` (batch `runStepsMotionDecoder`, golden-pinned) are separate implementations of the same Oura codec. The only production consumer is the oura-models copy (`lib/oura-ble/step-counter-pipeline.ts:25`); the oura-ble copy is imported solely by its own test (`lib/oura-ble/__tests__/steps-motion-decoder.test.ts:3`).
- Failure scenario: One-Formula-One-Place violation in waiting — a future fix to the dequantization (e.g. an encode_zero clamp nuance; the two copies already implement the clamp differently: per-value `Math.max(code-1,0)` vs the model's batch `clamp(x-1, 0, max(x-1))`) lands in one copy and not the other, and a later consumer wires the stale one into the step count.
- Recommendation: delete `lib/oura-ble/steps-motion-decoder.ts` (or make it a thin re-export of the oura-models port) and move any test coverage worth keeping onto the surviving copy.

### G-6 — rr_intervals has no retention bound (its sibling HR table prunes at 180 days)
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `oura_heartrate` gets a throttled 180-day prune on write (`lib/data/postgres/slices/oura.ts:404-408`); `insertRrIntervals` (oura.ts:501-506) has none, and no other code deletes from `rr_intervals` (migration 124 defines no TTL). The only reader is `getRrForWindow` scoped to `ws.startedAt..ws.completedAt` (`app/api/oura/hr-data/route.ts:26`), so beats buffered before workout start / after completion (the strap flushes whenever the live-HR manager runs) are stored and can never be read by any code path.
- Failure scenario: one row per beat during every strap session (~5-15k rows/hour) accumulates forever on a Railway Postgres already under active storage-culling effort (Levers 1-5); a year of strap use is millions of permanently-unreadable-except-last-workout rows.
- Recommendation: add the same throttled prune pattern (e.g. 180 days, matching oura_heartrate) inside `insertRrIntervals`, or a shorter window if post-workout HRV is the only consumer.

### G-7 — accel-chunks route promises a "later recount pass" that does not exist; missing-anchor chunks lose their steps permanently
- Severity: low
- Status: CONFIRMED
- Dup: likely (data-eff 1.5 documents magnitudes as write-only-by-design; the nonexistent-backfill angle is new)
- Evidence: `app/api/oura-ble/accel-chunks/route.ts:57-71` — when `getOuraClockAnchor` returns null, the raw chunk is stored but no `step_live_windows` row is written, with the comment "the window can be backfilled by a later recount pass". No recount pass exists anywhere (`grep -ri recount` matches only comments), and the raw chunk is pruned at 7 days (`adapter.ts:4873-4878`), after which the Tier-2 steps for that span are unrecoverable.
- Failure scenario: continuous capture running before the first BLE drain establishes an anchor (fresh install / post-re-key epoch): every chunk in that state contributes zero steps, silently, and after 7 days the promised backfill is impossible. For the single owner this is an edge state, but it is exactly the window where the ring's own step signals are also disrupted.
- Recommendation: either implement the recount (on next anchor write, recount un-windowed chunks ≤7 days old — cheap, `steps` is already stored per chunk so only ds conversion is needed) or fix the comment and accept the loss explicitly.

### G-8 — Captured-but-unused verdicts: owner's archival stance is correct; two candidates worth a look (design note grade)
- Severity: low
- Status: CONFIRMED (code) / PLAUSIBLE (data volumes)
- Dup: mostly yes — data-eff review 1.5/2.3, backlog items 4a/P-D/P-E, owner deferral 2026-07-16
- Evidence & verdicts:
  - **Undecoded tags stored `decoded=null` forever** (0x44, 0x54, 0x55, 0x63/0x64/0x67/0x68 raw PPG, 0x70/0x77, etc.): KEEP-AS-DELIBERATE-ARCHIVE — this is the documented I10 design (`docs/oura-ble-operations.md` §1) and the body_hex invariant makes it the only safe stance; ingest drops are forward-unrecoverable. Storage cost is managed by the separate Lever program (1/1b/1c/5).
  - **Owner deferral of dropping 0x59/0x47/0x6b/0x6c/0x74**: pressure-tested, AGREE. 0x47 is actively read by the step-counter validation route (`step-counter-export/route.ts:17`) and is an input to the future gait counter; 0x59 EDA is the only stress-adjacent raw stream for a post-dHRV stress feature; the rest are cheap relative to the raw-PPG tags.
  - **`getBodyBatteryHistory`** (`slices/body-battery.ts:49`, `repository.ts:781`): zero callers — dead repo surface; harmless but delete-on-touch.
  - **cva 0x81 / atlas 0x87-0x88 / aohr-unvalidated markers**: all decoders are infallible and archival; wiring decisions are tracked (P-F GO/NO-GO, item 4a). No action beyond the tracked queue.

## Design notes
- **0x54 `recovery_summary` and 0x55 `sleep_heart_rate` are the highest-value undecoded tags** if they actually appear in this ring's syncs (unverifiable from the sandbox — needs a `SELECT tag, count(*)` against prod, e.g. via the tester's byTag summary). 0x55 would give a firmware-computed sleep-HR series to cross-check the rollup's IBI-derived RHR; 0x54 may carry the ring's own recovery contributors. Worth one admin-console look at the tag histogram before spending any decode effort.
- The H10's PMD service (ECG/accel) staying out of scope remains right: it is tracked as explicit R&D ([backlog not-queued] Polar H10 PMD streaming; F5 strap-cadence-spike), the HRS RR stream already feeds the only shipped HRV consumer, and PMD adds a proprietary-protocol maintenance surface for no current product feature.

## Not exercised
- Production tag histogram: which undecoded tags (0x44/0x54/0x55/0x63/0x64/0x67/0x68/0x70/0x77 …) actually accumulate in `oura_raw_samples`, and at what volume — sandbox has no prod DB access; local dev DB has no BLE rows.
- On-device H10 behaviour: whether this unit emits bpm=0 / >4000 ms RR artifacts during acquisition (G-2's trigger) — the parse path is confirmed, the trigger frequency is not.
- Native cursor state machine at runtime (drain abort mid-batch, prefs persistence across process kill) — Kotlin is compile-gated only in the sandbox; code-read only.
- Whether 0x50-only (MET-only) ingest batches occur in practice (the missed rollup-trigger note in G-3).
- Actual `rr_intervals` row counts / growth rate in prod (G-6 sizing is arithmetic, not measured).
- SleepNet/rollup end-to-end on real nights (covered by existing KI verification-gap rows; not re-tested here).

---

# Dimension H — Data retention & time-bucketing

## Summary

The app's retention posture today is five opportunistic throttled prunes fired from write paths (the module-map §0 pattern) and nothing else. Verified: `oura_heartrate` 180d (lib/data/postgres/slices/oura.ts:389–408), `step_live_windows` 30d (lib/data/postgres/adapter.ts:4845–4851), `oura_accel_chunks` 7d (adapter.ts:4873–4878, unthrottled/per-insert), `error_events` 30d (adapter.ts:3615–3619), plus a fifth the brief didn't list — `oura_ble_battery_poll` 90d (adapter.ts:3836–3843, migration 133). Confirmed that **nothing ages `oura_raw_samples`** (insertOuraRawSamples, adapter.ts:3858–3914 — no delete anywhere outside tests) and **nothing ages `rr_intervals`** (insertRrIntervals, slices/oura.ts:501–506 — no delete anywhere). `oura_raw_samples` is unbounded *by policy* (body_hex archival rule; Lever 5 owner-deferred); `rr_intervals` is unbounded *by omission* — it shipped with the Polar H10 (migration 124) with no retention decision at all.

On the way to the proposal I found three real gaps: (1) the 180d HR prune's own justifying comment is false — per-workout HR stats (HRR1, peak BPM, workout rest-HRV) are *not* persisted in `exercise_logs`/`set_logs`; they are recomputed live from `oura_heartrate`/`rr_intervals` on every done-screen/recap view, so the prune silently erases them (and the HR trace) for any workout older than 180 days; (2) the BLE rollup (`aggregateOuraRawSamples`) reads the **entire** `oura_raw_samples` table per consumed tag — no ds cutoff — and now in-memory-decodes every historical body_hex on **every biometric ingest batch**, so rollup cost grows linearly forever and structurally couples sync latency to the no-retention posture; (3) `daily_zone_minutes` cached rows are never recomputed after a zone-profile change, and past-180d recompute is already impossible, making the cache silently authoritative-with-old-profile.

The Design notes section carries the full proposal: a three-tier scheme (archival hex → bounded sample tier → indefinite daily/per-workout derived tier), with materialize-before-thin gates, per-lever resolution-loss statements proven against a full consumer matrix, sizing against the owner-observed footprint (306,948 raw rows ≈ 229 MB at 2026-07-15), and everything recurring expressed as throttled write-path passes — no cron.

## Findings

### H-1 — `rr_intervals` is unbounded with no retention policy and a single, live-compute-only consumer
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `insertRrIntervals` (lib/data/postgres/slices/oura.ts:501–506) inserts with `onConflictDoNothing` and no prune; no `DELETE`/prune of `rr_intervals` exists anywhere in lib/ or app/ (only test teardowns). Writer: `app/api/hr-ingest/route.ts:39–48` reconstructs one row **per heartbeat** from Polar H10 strap packets. Schema (schema.ts:757–763): uuid PK + `unique(user_id, at)` — two indexes per row. Sole reader: `app/api/oura/hr-data/route.ts:26` (workout-window rest-RR → `rmssdFromRr` at line 45), recomputed on every done-screen/recap view and never persisted.
- Failure scenario: strap worn for ~4–6 workout-hours/week ⇒ ~1.3–1.6M rows/yr (~150–250 MB/yr with indexes) on the Railway Postgres, growing forever, while the only value ever extracted from a row older than the last recap view is a recomputation of the same rMSSD scalar. This will overtake pruned `oura_heartrate` as the #2 growth driver behind raw samples.
- Recommendation: materialize `workoutHrvMs` per completed session (see Design notes, Lever R), then add the standard throttled prune (90d) fired from the `hr-ingest` write path.

### H-2 — BLE rollup reads and decodes the entire `oura_raw_samples` history on every biometric ingest batch
- Severity: medium (perf today, trending worse linearly; also blocks Lever 5 cold-store)
- Status: CONFIRMED
- Dup: no
- Evidence: `rowsByTags` (adapter.ts:3989–3998) selects **all** rows for the given tags — filter is only `(user_id, tag IN …)`, no `ring_timestamp_ds` cutoff — and post-Lever-1 maps every row through `decodeEventBody(hexToBytes(body_hex))` in memory (line 3996, since `decoded` is now NULL everywhere after the Lever-1b backfill). `aggregateOuraRawSamples` fans out ten such reads (adapter.ts:4000–4011). It is invoked on **every** samples POST that carries any biometric tag (app/api/oura-ble/samples/route.ts:70–80) — i.e. many times per nightly drain. The 14-day `hrSeriesCutoffDs` (adapter.ts:4557–4558) and per-night sleep windows are applied *after* the full-table load.
- Failure scenario: at 306,948 rows (2026-07-15, ops doc I16) each drain batch already re-loads and re-hex-decodes hundreds of thousands of rows × 10 tag groups; at the plan's ~1–2M rows/yr the rollup's per-batch cost grows without bound — sync latency, Railway CPU, and pool statement_timeout (15s) pressure — while every downstream computation only ever uses a bounded recent window (14d HR series, current nights, recent MET/temp epochs).
- Recommendation: add a ds cutoff to `rowsByTags` (e.g. anchor − 35 days, comfortably above every internal window), with the explicit invariant "the incremental rollup never needs rows older than N — full-history reprocessing goes through the admin Redecode path only". This is also a hard prerequisite for any body_hex cold-store (Design notes §4).

### H-3 — The 180d `oura_heartrate` prune silently erases per-workout HR stats its own comment claims are persisted
- Severity: medium (first real loss lands ~Jan 2027; silent, unrecoverable for strap data)
- Status: CONFIRMED
- Dup: no
- Evidence: the prune's justification (slices/oura.ts:386–388) says "derived per-session stats live in exercise_logs/set_logs and are unaffected by pruning the raw series." False for HR: `analyseHrRecovery` outputs (peakBpm, hrr1, bpmAtLog) and `workoutHrvMs` are computed live per request in `app/api/oura/hr-data/route.ts:29–45` and returned to the done screen — nothing writes them back. Schema check: no HR columns on `workout_sessions`/`exercise_logs`/`set_logs`; only `fitness_tests` (schema.ts:305–322) and `activity_logs` (schema.ts:289–290) persist HR scalars, and `health/trends` re-derives HRR from raw HR each request but only over 14d (app/api/health/trends/route.ts:69–86).
- Failure scenario: user opens the recap of a strength session from >180 days ago → `getHrForWindow` returns nothing → `hasData: false`; the HR trace, set-by-set HRR1, and workout HRV that were once displayed are gone. Strap-sourced (`chest_strap`) rows are not re-derivable from anything (BLE rows can in principle be re-rolled from body_hex; strap samples exist only in `oura_heartrate`/`rr_intervals`). Pre-re-key Oura Cloud intraday HR is also deleted by this prune (Cloud re-fetch via hr-window can restore it, but only while the Cloud token/API access persists).
- Recommendation: materialize a per-workout HR snapshot at completion (Design notes, Lever W) and backfill sessions still inside the 180d window before the first pruned workout ages out (~2027-01); then fix the comment.

### H-4 — `daily_zone_minutes` cache is never recomputed on zone-profile change, and >180d recompute is already impossible
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `getZoneMinutesRange` (slices/oura.ts:465–499) returns the cached row for any past day unconditionally (line 480–483) — the cache key is `(user_id, day)` only, no profile hash/version; nothing outside tests deletes `daily_zone_minutes` rows. Zone boundaries come from the caller-supplied `{maxHr, restingHr}` profile (line 434, 443).
- Failure scenario: user corrects their max HR → all previously cached days keep zone splits computed under the old profile; days older than the 180d HR prune can never be recomputed at all, so the trend chart mixes two zone definitions with no indicator.
- Recommendation: stamp the profile (or a version int) on the row and treat a mismatch as a cache miss for days still inside HR retention; accept-and-document the frozen-profile semantics for older days. This matters for the retention design because it makes `daily_zone_minutes` the *permanent* record once HR thins (Design notes §2).

### H-5 — Prune-machinery hygiene: silent error swallow, global (non-user-scoped) deletes, one unthrottled awaited prune, doc drift
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: (a) all throttled prunes are `.catch(() => {})` fire-and-forget with no logging (slices/oura.ts:407, adapter.ts:3618, 3841, 4850) — a permanently failing prune (e.g. lock timeouts) is invisible and the throttle var still advances, so a failure costs a full 24h window each time; (b) every prune `DELETE` is global, not user-scoped (fine single-user, but inconsistent with the "every UPDATE/DELETE is user-scoped" sync rule and worth one comment each); (c) the `oura_accel_chunks` prune (adapter.ts:4875–4878) is *awaited on every insert* — unlike its siblings a transient delete failure fails the whole ingest write; (d) module-map §0's prune list omits the 90d `oura_ble_battery_poll` prune shipped in migration 133 (docs/module-map.md §0 table lists only four).
- Failure scenario: (c) is the concrete one — a lock conflict on the accel prune 500s an accel-chunk POST that had already succeeded semantically; the others are observability/doc debt.
- Recommendation: make the accel prune fire-and-forget + throttled like its siblings; add a `console.error` to the catch blocks; add the battery-poll row to module-map §0.

### H-6 — `oura_raw_samples` unbounded growth (confirmation of the tracked posture)
- Severity: low (as a finding — the design work is in Design notes)
- Status: CONFIRMED
- Dup: yes ([backlog P-A] Lever 5 aged body_hex cold-storage, owner-deferred 2026-07-16; [backlog holding] owner-decision row)
- Evidence: `insertOuraRawSamples` (adapter.ts:3858–3914) has no retention pass; the only reducers shipped are Lever 1a/1b (decoded → NULL), Lever 1c (VACUUM FULL, admin-gated), and Lever 2 (ingest tag whitelist, lib/oura-ble/raw-storage.ts). body_hex is archival per CLAUDE.md — correctly untouched.
- Failure scenario: none new — this confirms the brief's premise; growth ~1–2M rows/yr per the culling plan (§1) on top of ~229 MB observed 2026-07-15.
- Recommendation: refine (don't implement) Lever 5 per Design notes §4.

## Design notes

### 0. Verified current posture (the baseline the proposal builds on)

| Table | Retention today | Mechanism | Cite |
|---|---|---|---|
| `oura_heartrate` | 180d | throttled 24h, fired from `upsertOuraHeartrate` | slices/oura.ts:389–408 |
| `step_live_windows` | 30d | throttled 24h, fired from `upsertStepLiveWindow` (Lever 3) | adapter.ts:4845–4851 |
| `oura_accel_chunks` | 7d | **unthrottled, awaited**, every insert | adapter.ts:4873–4878 |
| `error_events` | 30d | throttled 24h, fired from `insertErrorEvent` | adapter.ts:3615–3619 |
| `oura_ble_battery_poll` | 90d | throttled 24h, fired from `insertOuraBatteryPoll` | adapter.ts:3836–3843 |
| `oura_raw_samples` | **none** (archival body_hex; decoded now NULL) | — | adapter.ts:3858–3914 |
| `rr_intervals` | **none** | — | slices/oura.ts:501–506 |
| daily tables (`oura_daily*`, `oura_daily_derived`, `daily_zone_minutes`, `sleep_sessions`, `body_metrics`) | none needed | ~365 rows/yr each | culling plan §1 |

Real numbers (admin G-2 machinery `getOuraStorageStats`, slices/oura.ts:812–844; owner-observed, ops doc I16/I17): `oura_raw_samples` = **306,948 rows ≈ 229 MB** at 2026-07-15 (decoded JSONB backlog of ~36–42 MB nulled; VACUUM FULL available to reclaim). Culling-plan growth estimate ~1–2M rows/yr ⇒ **~0.5–1 GB/yr** at observed ~600–750 B/row total-relation cost. `rr_intervals` projected ~1.3–1.6M rows/yr ≈ 150–250 MB/yr (H-1). `oura_heartrate` is bounded by its 180d window at roughly 300k–900k rows (~50–120 MB steady state: 288 5-min bins/day + 15-s workout bins + ~1 Hz strap rows during workouts — bin constants at adapter.ts:4555–4556, strap writer hr-ingest). Everything else is bounded and negligible.

### 1. Consumer matrix (who reads what, at what granularity/window)

**`oura_heartrate`** (read exclusively via `getHrForWindow`, slices/oura.ts:411–422, merged by `preferStrapBuckets` at 10-s buckets):
- `app/api/readiness-score/route.ts:138` — today only; daytime-HR contributors.
- `app/api/body-battery/route.ts:87` — today only.
- `app/api/oura/hr-day/route.ts:26` — one arbitrary day (intraday chart); 5-min bins suffice outside workouts.
- `app/api/oura/hr-window/route.ts:42–57` — arbitrary window, with an Oura-Cloud re-fetch fallback (only useful pre-re-key data).
- `app/api/health/trends/route.ts:78–86` — last **14 days** only (per-session HRR re-derive).
- `app/api/oura/hr-data/route.ts:24` — per-workout ±10 min window, **any age** (done screen/recap replay) — needs 15-s/strap resolution to resolve set/rest structure; the only consumer that wants fine granularity beyond 14 days.
- `computeDayZoneSeconds` → `getZoneMinutesRange` (slices/oura.ts:432–499) — per-day; **past days cached in `daily_zone_minutes`** and never re-read once cached.
- BLE rollup delete-and-reinsert owns `source='ble'` rows only within anchor−14d (adapter.ts:4557, 4603–4611) — never touches older rows.

**`rr_intervals`**: single consumer, `app/api/oura/hr-data/route.ts:26` — per-workout window, rest-beat rMSSD (`workoutHrvMs`), recomputed per view, never persisted. (Ring-side HRV/LF-HF/daytime-stress pipelines read ring IBI from `oura_raw_samples`, not this table.)

**`oura_raw_samples`**: `aggregateOuraRawSamples` (full-table per tag — H-2; effective windows all ≤14d/recent nights); SleepNet night assembler; `redecodeOuraRawSamples` (whole table, admin-triggered); admin debug readers (`getOuraRawSampleSummary`/`getOuraRawSamplesByTags`, raw dump); battery-event reader for 0x61 (adapter.ts:3810–3834). The open-ended consumer is the **future decoder back-fill** guarantee — the whole reason body_hex is archival.

**`step_live_windows`**: step rollup Tier-2 merge reads all rows (adapter.ts:4514–4516; bounded by the 30d prune); steps folded into `body_metrics.steps`/derived daily long before 30d.

### 2. Proposed tier model

Three durability tiers; data only thins *downward* after the tier above it is provably materialized:

- **Tier 0 — archival**: `oura_raw_samples.body_hex`. Never pruned or mutated (hard constraint). Ages into a *cold store* at ~12 months (§4) — moved, never dropped.
- **Tier 1 — bounded sample series**: `oura_heartrate`, `rr_intervals`, `step_live_windows`, `oura_accel_chunks`, `oura_ble_battery_poll`. Finite windows, age-based downsampling inside the window.
- **Tier 2 — indefinite derived**: `oura_daily`, `oura_daily_summary`, `oura_daily_derived`, `daily_zone_minutes`, `sleep_sessions`, `body_metrics`, `fitness_tests`, plus the new per-workout HR snapshot (Lever W). ~365–500 rows/yr each; kept forever. This tier is the app's permanent health record; Tier 1 exists only to feed it and to power recent-window UI.

### 3. Concrete levers (ordered; each states resolution lost + consumer proof)

**Lever W — persist per-workout HR stats at completion (prerequisite; closes H-3).**
New table `workout_hr_stats` (or nullable columns on `workout_sessions`): `workout_session_id PK/FK, avg_bpm, peak_bpm, hrr1_best, workout_hrv_ms, readings_count, computed_at, source`. Written fire-and-forget from the same place the done screen first fetches `/api/oura/hr-data` (server-side: compute-and-persist inside that route on first `ready:true` view, COALESCE upsert so a partial early compute never clobbers a later fuller one), plus a one-shot admin backfill over completed sessions still inside the 180d HR window. Optionally persist the downsampled trace (1-min JSONB array, ~100 points/workout) so old recaps keep a chart. *Resolution lost:* none — additive. *Gate:* backfill must land before ~2027-01 (first BLE-era workout hits 180d).

**Lever R — `rr_intervals` retention at 90d (closes H-1).**
After Lever W persists `workout_hrv_ms`, add the standard throttled prune fired from the `hr-ingest` write path (module-map §0 pattern, mirror slices/oura.ts:389–408): `DELETE FROM rr_intervals WHERE at < now() - interval '90 days'`, 24h throttle, fire-and-forget-with-log. *Resolution lost:* per-beat RR older than 90d. *Consumer proof:* the only reader (hr-data:26) recomputes a scalar already snapshotted by Lever W; the F5 strap-cadence/PMD spike ([backlog F5]) consumes live device streams, not this table; ring-side HRV pipelines never read it. 90d (not 30d) so a whole training block remains re-analyzable with better rest-window logic before thinning.

**Lever H — age-based downsampling of `oura_heartrate` inside the 180d window.**
Buckets: **≤35d native** (15-s workout bins, ~1 Hz strap, 5-min elsewhere) → **35–180d coarsened to 1-min bins** for any sub-minute rows (strap + workout bins; 5-min rows untouched) → **>180d deleted** (existing prune, now lossless for Tier-2 numbers thanks to Lever W + zone cache). Mechanics, no cron: piggyback the existing 24h throttle in `upsertOuraHeartrate` — after the 180d delete, run **one bounded pass**: find the single oldest local day older than 35d that still has >60 rows/hour, `INSERT … SELECT date_trunc('minute', timestamp), round(avg(bpm)) … GROUP BY minute ON CONFLICT DO NOTHING` then delete that day's sub-minute rows, one day per firing (≤ ~10k rows, well inside the 15s statement_timeout; idempotent — a re-run finds the day already coarse). 35d > the rollup's 14d `source='ble'` ownership window (adapter.ts:4557), so it never fights the delete-and-reinsert. *Resolution lost:* sub-minute intra-workout HR shape for workouts 35–180d old, and the whole series >180d. *Consumer proof:* hr-data (the only fine-granularity reader) still renders a 1-min trace for 35–180d recaps and reads the Lever-W snapshot beyond; trends (14d), readiness/body-battery/zone-compute (today/cached) never see >35d rows; `preferStrapBuckets`' 10-s buckets degrade gracefully (1-min rows just occupy their bucket). Sizing: strap rows are ~60× reduced, workout bins 4×; steady-state table shrinks from ~50–120 MB toward ~20–40 MB. *Optional:* if Lever W persists the 1-min trace JSONB, the 35–180d band can drop to 5-min instead — decide after measuring.

**Lever Z — make the zone cache the durable record properly (closes H-4).**
Before Lever H ships: one-shot sweep materializing `daily_zone_minutes` for every day from the first HR row to yesterday (call `getZoneMinutesRange` over the full span, chunked by month — it self-caches); add `profile_max_hr`/`profile_resting_hr` columns (or a version stamp) so a profile change invalidates only days still inside HR retention. *Resolution lost:* none. This is the "zone-minutes/rollups persisted" guarantee the brief's HR bucketing is conditioned on — Lever H must not merge before this sweep is verified (proof query: `count(days with HR rows) − count(zone rows) = 0` over the pre-cutoff span).

**Lever 5 refinement — aged body_hex cold store at ~12 months (owner-deferred; refine only).**
Shape that fits this codebase best: **5a cold table, in-DB, admin-triggered** — `oura_raw_samples_cold(id, user_id, ring_timestamp_ds, tag, event_name, body_hex bytea /* gzip via pg compress or app-side */, measured_at)`, moved in bounded 500-row batches by an admin button exactly like Lever 1b (`nullHistoricalDecoded` is the reference: slices/oura.ts:858–881 — bounded batches, resumable, confirm-dialog, watch G-2), followed by the existing Lever 1c VACUUM to physically shrink the hot table. Move-then-delete per batch with row-count + hex-checksum equality checked before the hot delete; `redecodeOuraRawSamples` and the admin raw readers grow a `UNION ALL` fallback to the cold table (decompress on demand). Not a write-path throttle job — it is data-*moving*, hence confirm-first and owner-pressed, matching the established Lever 1b/1c console pattern. **Prerequisite: H-2's rollup ds-cutoff** — the incremental rollup must provably never need cold rows, else a cold-move breaks nightly aggregation. 12-month boundary rationale: every decoder shipped to date stabilized within weeks of its tag first being captured, and SleepNet/redecode passes have only ever re-read months, not a year; G-2 gives the owner the exact bytes the move reclaims before pressing. 5b (hard delete of cold hex) stays a separate, later owner decision — this proposal deliberately does not schedule it. *Resolution lost:* none (compressed + slower to read). *Consumer proof:* hot-path consumers all read ≤35d post-H-2; only admin redecode/back-fill touch cold rows, and they get the fallback read path.

**Ordering / gates (backfill-before-thin, explicit):**
1. Lever W snapshot + backfill → verify (`sessions with HR readings but no snapshot = 0`).
2. Lever Z zone sweep + profile stamp → verify (`HR-days without zone rows = 0`).
3. Lever R rr prune (needs only W).
4. Lever H HR downsampling (needs W + Z).
5. H-2 rollup cutoff (independent, ship anytime — before 6).
6. Lever 5a cold store (owner-confirmed window; needs 5).

Nothing here adds a scheduler: R and H ride existing write-path throttles; W is compute-on-first-view; Z, backfills, and 5a are admin-button one-shots like Levers 1b/1c.

### 4. What this buys, sized

Against the observed footprint: raw samples stay the dominant line (~0.5–1 GB/yr accumulating) until Lever 5a caps the *hot* table at ~12 months (~0.5–1 GB hot ceiling, cold compressed at roughly 3–5× reduction for hex-of-binary payloads). Lever R removes an unbounded ~150–250 MB/yr line entirely (steady ~40–60 MB). Lever H roughly halves-to-thirds the HR table's steady state. Net posture: every table is either bounded, downsampled-by-age, or cold-stored; the only indefinitely-growing hot data is Tier 2 at a few MB/yr — and the admin G-2 card verifies each step with real numbers, per the project's own "measure, then cull" doctrine.

## Not exercised

- No queries were run against production Railway Postgres (sandbox-blocked); all sizing uses the owner-observed I16/I17 numbers and schema-derived per-row estimates.
- Actual strap usage rate (hours/week the Polar H10 streams) is estimated, not measured — rr_intervals growth could be lower.
- Rollup wall-clock cost per ingest batch (H-2) not profiled — the linear-growth mechanism is code-verified, the current absolute latency is not.
- Postgres compression behavior for gzip'd bytea vs TOAST on the proposed cold table not benchmarked.
- Whether Oura Cloud still serves pre-re-key intraday HR for re-fetch (hr-window fallback) was not verified against the live API.

---

# Dimension I — Security

## Summary

The three recurring ownership classes from CLAUDE.md are in good shape: the R1 fixes are present and not regressed. `saveProgressionStyle` now has an explicit affected-row-count guard before its unscoped `style_sets` delete/re-insert (`lib/data/postgres/slices/programs.ts:701-706`), `updateSavedMeal` has both the row-count guard and a food-item ownership join check (`lib/data/postgres/slices/nutrition.ts:357-368`), and `ensureWorkoutSession` still throws on non-owned session ids (`lib/data/postgres/adapter.ts:719-743`). Every Drizzle `.set()` I traced is key-whitelisted at the repo layer (updateInjury, updateSupplement, updateUserProfile, updateUserGoals, updatePrescribedRun, updateGoalRecommendationStatus) or fed from a Zod-parsed object at the route; no raw request body reaches `.set()`. The routes added since 2026-07-06 (fitness-tests, running-plan + runs/[id], hr-ingest, zone-minutes, training-stress, the oura-ble family) are the *best*-disciplined in the codebase: shared Zod schemas reused across web route and pushMutations (`lib/validation/fitness-test.ts`, `lib/validation/prescribed-run.ts`), `onConflictDoUpdate` with `setWhere: eq(userId)`, rate limits, and `readJsonLimited` size caps on the BLE ingest paths.

Admin gating is complete: every `/api/admin/*` route and every oura-ble maintenance route (samples ingest, backfill-null-decoded, redecode, vacuum, battery-poll, battery-analytics, daytime-coverage, db-stats, device-metrics, step-counter-export, workout-sensors, samples/raw, samples/summary) calls `requireAdmin`, which deliberately ignores the stale JWT flag and does an authoritative DB check (`lib/admin.ts:15-20`). `accel-chunks` and `live-steps` are intentionally non-admin product writes (documented in-file), user-scoped, Zod-validated and rate-limited — matching the orchestrator's empirical probes. The auth machinery is strong: PKCE verify is timing-safe with length pre-check (`lib/pkce.ts`), mobile tokens are single-use/5-min/burned-on-failed-verifier (`lib/mobile-auth-tokens.ts`, `app/api/auth/exchange-mobile-token/route.ts:20-23`), the Oura webhook fails closed and explicitly avoids the user-enumeration oracle (`app/api/oura/webhook/route.ts:64-75`), health-connect ingest uses a constant-time compare that also masks length, Oura tokens are AES-GCM encrypted at rest with fail-closed writes (`lib/oura/token-crypto.ts`), all `sql.raw` uses are compile-time constants, and the pg pool error handler + both timeouts are intact (`lib/data/postgres/client.ts:25-34`). What remains are hardening residuals: an unbounded timestamp in hr-ingest, an unbounded body buffer on the avatar route, brute-force ordering on the ingest secret, and a handful of pre-2026-07 routes still doing hand-rolled (though effectively whitelisting) validation instead of Zod.

## Findings

### SEC-I1 — hr-ingest accepts unbounded `at` epoch timestamps
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/hr-ingest/route.ts:10` — `at: z.number().int()` with no range bound, then `new Date(s.at)` at :32 and RR back-walk from `at` at :39-47. Contrast `app/api/oura-ble/accel-chunks/route.ts:39-43`, which explicitly rejects `startedAt` more than 60s in the future or 7 days in the past ("a bad phone clock would otherwise plant a live window over a span the ring never covered").
- Failure scenario: a strap client with a wrong clock (or any crafted call) writes chest-strap HR/RR rows at arbitrary past/future wall-clock times into `oura_heartrate`/RR tables; `at > 8.64e15` produces an Invalid Date and a driver-level 500. Polluted timestamps flow into zone-minutes, HRV and live-HR reads with no way to distinguish them from real data, and (per the route comment) exact-timestamp collision handling means a bogus early row can win over a later real ring rollup row via `onConflictDoNothing`.
- Recommendation: clamp `at` to `now ± small window` (mirroring accel-chunks) and bound the schema numerically; reject or clamp RR back-walk results that cross the window.

### SEC-I2 — avatar upload buffers the whole body before any size check
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/user/avatar/route.ts:11-24` — `await req.json()` buffers the entire request body in memory, and only afterwards estimates base64 size against the 5MB cap. `lib/http/request-guards.ts` (`readJsonLimited`, streaming cancel at cap) exists precisely for this and is used by `nutrition/scan` (8MB cap + `isAllowedImageMime`) and the oura-ble ingest routes — avatar, the other image-ingest route, missed it. It also has no rate limit and no MIME whitelist beyond the `data:image/` prefix (so `data:image/svg+xml` stores; served only through `<img>` so no script execution, but inconsistent with `ALLOWED_IMAGE_MIME`).
- Failure scenario: an authenticated client (i.e. the owner's own compromised WebView, or any invited account) POSTs a few-hundred-MB JSON body; the Node process buffers it fully before rejecting, spiking memory on the single Railway instance — the process that also serves the APK.
- Recommendation: switch to `readJsonLimited(req, ~7MB)`, validate the data-URL MIME against `ALLOWED_IMAGE_MIME`, and add the standard per-user rate limit.

### SEC-I3 — health-connect ingest: failed secret guesses are never rate-limited
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/health-connect/ingest/route.ts:55-66` — the `safeCompare` secret check runs first and returns 401; the IP rate limit sits *after* a successful match, with a comment framing this as avoiding a distinguishable response. Net effect: only legitimate Tasker calls are rate-limited; brute-force attempts on the secret run at unbounded throughput. The compare is constant-time, so the residual exposure is raw guessing speed against the secret's entropy.
- Failure scenario: an internet attacker hammers the endpoint with candidate secrets at network line rate indefinitely; nothing throttles or alerts. With a high-entropy secret this is impractical, but the route is the only unauthenticated write into `body_metrics` and there is no failure-side observability at all.
- Recommendation: add a separate failure-keyed limiter (e.g. `hc-ingest-fail:${ip}`) checked before the compare, returning the same 401 body when tripped (or a uniform 429); optionally log failed-attempt counts.

### SEC-I4 — injuries web PATCH forwards an unvalidated body (sync mirror validates, web doesn't)
- Severity: low
- Status: CONFIRMED
- Dup: likely (CLAUDE.md cites `updateInjury` as the whitelisting reference; the 07-06 R1 batch covered the `.set()` class, but the route-level schema gap is untracked)
- Evidence: `app/api/injuries/[id]/route.ts:13-14` — `const body = await req.json(); repo.updateInjury(id, session.user.id, body)` with zero validation. The adapter (`lib/data/postgres/adapter.ts:2877-2892`) key-whitelists columns, so mass assignment of `userId`/`deletedAt` is blocked, but value types/enums are not checked: `severity` can be any string of any length, `startedDate`/`resolvedDate`/`muscleName`/`notes` arbitrary values. The pushMutations `injuries` branch *does* enforce the `['mild','moderate','severe']` enum (`adapter.ts:3466-3470`, comment "Matches the web route's severity enum") — but the web PATCH route enforces nothing, so the mirror claim is inverted: the offline path is stricter than the web path.
- Failure scenario: a buggy client PATCH writes `severity: "Severe "` or a non-date `startedDate`; the injury-warning muscle matching and severity display silently degrade, and the drifted row then syncs down to the device. (Cross-user impact: none — scoping is intact.)
- Recommendation: add a Zod `.strict()` patch schema at the route (same shape as the supplement patch schema in `app/api/supplements/[id]/route.ts:6-13`) and reuse it in the pushMutations branch, per the one-schema-two-paths pattern the running domain already uses.

### SEC-I5 — prescribed-run `activityLogId` stored without ownership verification (class c)
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/running-plan/runs/[id]/route.ts:23-26` and the pushMutations branch (`adapter.ts:3447-3450`) pass the client-supplied `activityLogId` into `updatePrescribedRun` (`adapter.ts:2132-2141`), which sets it with no check that the referenced `activity_logs` row belongs to the user. `lib/data/postgres/schema.ts:351` shows a plain FK (`references activity_logs.id, onDelete set null`) with no user constraint. CLAUDE.md rule (c) requires ownership-verifying client-supplied row ids "even when the table has no user_id column" via a join — the saved-meal food-items check (`nutrition.ts:362-368`) is the in-repo reference. No current read path joins through the column cross-user (verified by grep — it's returned as an opaque id in user-scoped rows), so today the impact is only a UUID-existence oracle via FK success/failure across users.
- Failure scenario: a second (invited) account that learns/guesses an activity-log UUID links its prescribed run to the owner's log; nothing leaks today, but the first future read that joins `prescribed_runs → activity_logs` by that FK without re-scoping would leak the owner's run (distance/GPS-derived fields) — the exact latent shape the rule exists to prevent.
- Recommendation: pre-check `activityLogId` ownership with a one-row select scoped to `userId` before setting it (both in the shared repo function so web and sync paths inherit it).

### SEC-I6 — Postgres TLS with `rejectUnauthorized: false`
- Severity: low
- Status: CONFIRMED
- Dup: no (long-standing, but not in the tracked index)
- Evidence: `lib/data/postgres/client.ts:16-18` — production SSL config is `{ rejectUnauthorized: false }`: encrypted but unauthenticated TLS to the DB.
- Failure scenario: a MITM between the Railway app container and the Postgres endpoint could impersonate the DB. On Railway's private network this is largely theoretical (and is the platform's common pattern because Railway PG uses self-signed certs), but every credential and health record transits this link.
- Recommendation: if Railway exposes the instance CA, pin it via `ssl.ca`; otherwise document the acceptance in CLAUDE.md's pool section so it isn't cargo-culted into other connections.

### SEC-I7 — residual hand-rolled validation on older write routes (type-level 500s / garbage values, no cross-user exposure)
- Severity: low
- Status: CONFIRMED
- Dup: likely (review 07-06 R1 security batch territory; the routes predate the "Zod at creation" rule)
- Evidence (each read in full): `app/api/supplements/route.ts:22-31` — `body.dose?.trim()` throws a 500 on non-string `dose`; `reminderTime`/`sortOrder` types unchecked into the insert. `app/api/phase-sets/[id]/route.ts` PUT — `durationCycles`/`phaseType`/`name` types unchecked (style-id ownership IS checked against `listProgressionStyles`); `app/api/phase-sets/clone/route.ts` — `overrides` record values unchecked into `durationCycles`. `app/api/workout-templates/route.ts` POST — the whole `Program` object (sessions/exercises arrays) passes to `saveProgram` unvalidated; ownership is enforced (update scoped at `programs.ts:178`; a foreign `program.id` yields a 0-row update and then a TypeError at `programs.ts:195` *before* the dependent session deletes at :235 — fail-closed via crash rather than a clean 404). `app/api/progression-styles/route.ts` POST — `sets` array element types unchecked (set count capped at 40; ownership guarded in the slice). None of these permit cross-user writes; all can 500 or store type-garbage in the single user's own rows.
- Failure scenario: a malformed client payload (e.g. after a future UI refactor) stores a string where a number belongs or 500s mid-save, surfacing as "save doesn't persist".
- Recommendation: opportunistic fix-on-touch — add Zod schemas when these routes are next edited; not worth a dedicated PR.

### SEC-I8 — oura-ble/freshness has no rate limit (only unlimited authenticated GET in the BLE family)
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/oura-ble/freshness/route.ts` — auth-gated single-row read, no `rateLimit` call, while every sibling oura-ble GET (db-stats 10/min, daytime-coverage 20/min, battery-analytics 20/min) has one. It is called on app open, so the omission may be deliberate for burst tolerance, but it breaks the "match siblings" rule.
- Failure scenario: negligible — one indexed MAX() query per call; worst case a stuck client loop adds DB load.
- Recommendation: add a generous limiter (e.g. 60/min per user) for consistency, or a comment stating why it's exempt.

## Write-route table (auth / Zod / rate-limit / ownership)

Legend: auth = session check; zod = Zod parse (m = manual field whitelist/validation, — = none); rl = rateLimit; own = user-scoping of the actual write (✓ = verified in repo code; route-only rows are reads-that-write). Admin rows additionally verified to call `requireAdmin` (DB-authoritative).

| Route (write methods) | auth | zod | rl | own / notes |
|---|---|---|---|---|
| fitness-tests (POST/DELETE) | ✓ | ✓ shared schema | — | ✓ id-conflict `setWhere` userId (adapter:2037-2042); foreign-id replay → 0-row update → 500 (fail-closed) |
| running-plan (POST) | ✓ | ✓ | ✓ 20/min | ✓ plan+run inserts server-minted ids |
| running-plan/runs/[id] (PATCH) | ✓ | ✓ shared schema | ✓ 30/min | ✓ scoped update + 404 on 0 rows; SEC-I5: activityLogId FK unverified |
| hr-ingest (POST) | ✓ | ✓ | ✓ 120/min | ✓; SEC-I1 unbounded `at` |
| zone-minutes (GET, write-through cache) | ✓ | n/a | ✓ 30/min | ✓ |
| training-stress (GET, persists derived) | ✓ | n/a | ✓ 30/min | ✓ upsert own userId |
| oura-ble/samples (POST) | ✓ | ✓ + readJsonLimited 512KB | ✓ 120/min | ADMIN ✓; user-scoped insert |
| oura-ble/samples/backfill-null-decoded (POST) | ✓ | m (maxRows clamp) | ✓ 4/min | ADMIN ✓; nulls only caller's rows |
| oura-ble/samples/redecode (POST) | ✓ | m | ✓ 4/min | ADMIN ✓; user-scoped |
| oura-ble/samples/vacuum (POST) | ✓ | n/a | ✓ 2/min | ADMIN ✓; table-wide but non-destructive VACUUM FULL |
| oura-ble/battery-poll (POST) | ✓ | ✓ .strict() + readJsonLimited 4KB | ✓ 60/min | ADMIN ✓ |
| oura-ble/accel-chunks (POST) | ✓ | ✓ + clock-sanity window | ✓ 20/min | product write (deliberately non-admin), user-scoped |
| oura-ble/live-steps (POST) | ✓ | ✓ union schema, 4h window cap | ✓ 20/min | product write, user-scoped |
| admin/* (all write methods, 13 routes) | ✓ | mixed (activity-types/exercises/timing-baseline Zod; users/invites manual) | — | ADMIN ✓ on every handler (verified per-handler grep); users DELETE blocks self-delete |
| oura/webhook (POST) | HMAC | ✓ shape | — | fail-closed sig, enumeration-uniform 403, 16KB cap |
| oura/webhooks admin (POST/DELETE) | ✓ | n/a | — | ADMIN ✓ |
| auth/exchange-mobile-token (POST) | token+PKCE | m | ✓ 10/5min per IP | single-use, burn-on-failure |
| health-connect/ingest (POST) | shared secret (timing-safe) | ✓ ranged | ✓ post-auth only (SEC-I3) | fixed WEBHOOK_USER_ID target |
| sync/push (POST) | ✓ | ✓ envelope + per-mutation | ✓ 60/min | every pushMutations branch user-scoped; poison-pill quarantine intact |
| supplements / injuries / water-log / equipped-title / friends[id] / nutrition-goals[id] / food-logs[id] / phase-sets / progression-styles / workout-templates / oura-workouts / confirm-early-deload | ✓ | m (SEC-I4/I7 residuals) | — | ✓ all repo writes scoped; rowcount guards present where dependent child writes follow |
| log-exercise / complete-workout / workout-entry / workout-sessions* / sync-workout / mood / day-checkin / activity-logs / nutrition CRUD / user profile+goals+password / push subscribe | ✓ | ✓ | partial (matches siblings) | ✓ incl. `ensureWorkoutSession` join-ownership for session ids |
| AI routes (ai-chat, tts, builder-chat, generate-program, exercises/generate, health-insight, nutrition/scan, digests, workout-review, prescribe) | ✓ | ✓ or m | ✓ all | ✓; scan uses readJsonLimited 8MB + MIME whitelist |

## Not exercised
- Runtime timing measurements (timing-safe claims verified by code reading only, not measured).
- Multi-replica behaviour of the in-memory mobile-token store and rate-limiter L1 (single Railway instance assumed; tokens would break silently behind >1 replica since the map is per-process).
- Actual Railway network posture for SEC-I6 (whether the PG endpoint is private-network-only).
- CSRF posture of cookie-auth POST routes (Auth.js `sameSite: lax` assumed; WebView deep-link flows not driven).
- The native Kotlin side of ingest (what the plugin actually sends; sandbox has no APK).
- `scripts/check-push-mutations.js` CI rule execution (read as source only).

---

# Dimension J — Logic errors, dates, formulas

## Summary
This dimension audited logic/date/formula correctness in the post-2026-07-10 code (zone minutes, training stress/OTS, running engine, fitness tests, daytime stress/resilience, RR/BLE units). The headline result is a **date-format split inside `lib/date-utils.ts` itself**: `normalizeDateParam` returns `YYYY/MM/DD` (for the legacy `getDayLog` slash convention) while everything else speaks `YYYY-MM-DD`, and two of the newest routes consumed its output without converting back. That single mismatch **kills two shipped features outright**: `/api/zone-minutes` returns an empty `days` array on every real client request (J-8, Time-in-Zone card permanently blank), and `/api/training-stress` 500s on every client request (J-9, Training Stress line/badge silently hidden and the OTS persist to `oura_daily_derived` never runs). Both are invisible because `cachedFetch` swallows failures and the components self-hide — a no-param curl works, which is exactly how they passed testing.

Beyond that, the zone-minutes rollup cache is compute-once-forever with no invalidation on late-arriving BLE HR (J-1) and bakes a range-dependent zone profile into permanent rows (J-2); the running recovery gate measures "hours since leg day" to *tomorrow's midnight* instead of now (J-3) and its "last night's sleep" input is actually the week's best night (J-4); the OTS MET series drops timestamps so recording gaps compress the day (J-6); and two different "Session Load" formulas surface under one user-facing name (J-7). Boundary bucketing in the resilience/daily-summary rollups, `aestMidnight` overflow normalisation, RR 1/1024s→ms conversion, ds↔ms (×100) anchoring, and m-vs-km units in running/fitness-tests all checked out clean.

## Findings

### J-1 — daily_zone_minutes past-day cache is compute-once-forever: late-arriving BLE HR permanently under-counts zone minutes
- Severity: high
- Status: CONFIRMED
- Dup: no
- Evidence: `lib/data/postgres/slices/oura.ts:465-499` — `getZoneMinutesRange` returns the cached row for any non-today day (`if (row && day !== today)`) and only computes+caches when the row is missing. Grep confirms no other write/delete site for `dailyZoneMinutes` anywhere in `lib/` or `app/` — nothing invalidates a cached day when new `oura_heartrate` rows land for it (BLE history drains, strap `hr-ingest`, or a redecode back-fill pass). Migration comment (`129_daily_zone_minutes.sql`) and route comment claim "recomputed on read (reconcile)" — the code does not do that for existing rows.
- Failure scenario: The ring buffers HR history and drains it on the next sync (often the next morning, per the sync-cadence policy). If the zone-minutes range is read after local midnight but before yesterday's HR has drained (user opens the cardio stats screen at 6am pre-sync, or any consumer calls `/api/zone-minutes`), yesterday is computed from partial data and cached; when the full HR arrives an hour later the cached under-count is served forever. Same for any decoder-fix redecode that back-fills historical `oura_heartrate` — zone minutes for those days never update. Wrong training numbers, silently, permanently.
- Recommendation: Store a coverage marker with the cached row (e.g. last HR timestamp seen, or count of readings) and recompute when it drifts; or delete affected `daily_zone_minutes` rows from the HR ingest/redecode write paths (the cache-groups analogue for a server-side rollup); or at minimum always recompute "yesterday" too.

### J-2 — zone-minutes zone profile is NOT "same derivation as /api/hr-profile": resting-HR window = the query range, so zone bands shift with the range and get baked into the permanent cache
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/zone-minutes/route.ts:27-35` averages `restingHeartRate` over `listBodyMetrics(userId, from, today)` — i.e. over whatever range the caller queried (default 30d, but `?from=` is caller-controlled). `app/api/hr-profile/route.ts:30-40` uses a fixed 28-day window. The zone-minutes comment (line 9-10, "derived exactly as /api/hr-profile") is false. Because `getZoneMinutesRange` bakes computed seconds into `daily_zone_minutes` permanently (J-1), a day first computed under a 90-day-average RHR profile keeps those bands even when later reads use a different profile — cached and live days in one response can be banded with different zone boundaries.
- Failure scenario: User opens a 7-day view (RHR avg ≈ recent 55) then a 90-day view (RHR avg ≈ 60): the 90-day read computes+caches older days with 60-based bands; subsequent 7-day-profile reads serve those cached rows alongside fresh days banded at 55 — inconsistent zone attribution inside a single chart, off by up to a full zone near boundaries.
- Recommendation: Use one canonical profile derivation (the hr-profile 28-day window) for zone-minutes regardless of query range, and version the cache by profile (or accept J-1's recompute-on-drift fix which also covers profile drift).

### J-3 — Running recovery gate anchors "now" at tomorrow's local midnight: heavy-legs interference check under-protects morning runs
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/running-plan/route.ts:61` — `hoursSinceLowerBodyStrength = (todayMid.getTime() + 86_400_000 - lastLeg.startedAt.getTime()) / 3_600_000`, i.e. hours from the leg session's start to *tomorrow's* local midnight, not to now. `lib/running/recovery-gate.ts:26,51-59` softens a hard run only when this value `< 24` (LEG_INTERFERENCE_HOURS) and volume ≥ 3000 kg.
- Failure scenario: Heavy leg session yesterday 7pm; user opens the running screen at 6am (real gap 11 h). Computed value = tomorrow-midnight − yesterday-19:00 = 29 h > 24 → the gate does NOT soften, and a hard interval/tempo run is prescribed and persisted as today's `prescribed_runs` row 11 hours after a 3000 kg leg day — exactly the interference case the gate exists for. Any leg session started after ~midnight-minus-48h+24h... in practice any evening leg day is exempted from the gate the next morning.
- Recommendation: Anchor at `Date.now()` (or at today's local *start* if a whole-day-safe value is wanted — the conservative bound), not end-of-today.

### J-4 — "sleepHoursLastNight" is actually the max sleep across the whole current week — short-sleep soften almost never fires
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/running-plan/route.ts:45` fetches `listSleepSessions(userId, weekStartIso, todayIso)` (week start → today) and lines 84-87 compute `sleepHoursLastNight = Math.max(...sleepSessions.map(s => s.durationHours ?? 0))` over that whole window. `recovery-gate.ts:69-71` softens when `< 5.5` h.
- Failure scenario: User sleeps 8 h Monday night, 4 h Thursday night; Friday morning the gate sees `sleepHoursLastNight = 8` and prescribes the full hard run — the short-sleep guard can only ever fire on the first morning of the week or when every night that week was short. The gate input is mislabeled and effectively dead for 6 of 7 days.
- Recommendation: Fetch only last night's session(s) (yesterday/today wake-date window) and take the longest of those, mirroring how the Oura sync picks the best session per day.

### J-5 — hoursSinceLastRun: dead gate input, and computed with a mixed timezone anchor
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/running-plan/route.ts:80-82` computes `hoursSinceLastRun` from `new Date(\`${lastRun.date}T00:00:00Z\`)` — a user-local YYYY-MM-DD parsed as UTC midnight (10 h later than Brisbane local midnight), differenced against the local-midnight-anchored `todayMid` — mixing the two "today" conventions the Date-Arithmetic rule forbids. `lib/running/recovery-gate.ts` declares `hoursSinceLastRun` in `RecoveryGateInputs` (line 14) but `applyRecoveryGate` never reads it — grep shows the only consumers are the declaration and the route's assembly.
- Failure scenario: None today (the value is unused), but the first future gate rule that reads it inherits a silently 10-h-skewed number.
- Recommendation: Either delete the input or compute it via `fromZonedTime(\`${date}T00:00:00\`, tz)` and actually use it.

### J-6 — Training-stress MET series drops timestamps: recording gaps compress the day and skew the OTS sliding window
- Severity: medium
- Status: PLAUSIBLE
- Dup: no
- Evidence: `app/api/training-stress/route.ts:50-52` — `metsPerMinute = met.map(m => m.value)` discards each sample's `tsMs`, keeping only `startTimestampMs = met[0].tsMs`. `lib/oura-models/inference/ots.ts:119-164` treats the array as strictly contiguous 1-min samples (window end ts = `startSec + (w+719)*60`; per-position recency weights `C.metWeights[j]` over a 720-minute window). Any gap in the ring's 0x50 stream (charger time, non-wear, a partial history drain) compresses later samples earlier, so a "720-minute" window can span far more wall-clock time and the recency weighting is applied to the wrong minutes. The `length ≥ 720 / valid ≥ 360` gates count samples, not coverage, so a gappy day passes.
- Failure scenario: Ring on charger 9-10am (60-min gap). Evening samples all shift 60 positions earlier; the end-of-day OTS window mixes minutes across the gap with recency weights off by an hour — wrong OTS, and possibly a spurious `high` flag persisted to `oura_daily_derived.training_load_ots/high` and consumed by the running gate/readiness surfaces. Needs a real gappy day to quantify.
- Recommendation: Rebuild a true 1-min grid from `tsMs` (fill gaps with null/NaN — the core already NaN-cleans) instead of using sample index as the time axis.

### J-7 — Two different "session load" numbers shown to the user under one name (Foster sRPE×min vs Edwards TRIMP)
- Severity: low
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/health-trends/route.ts:146` computes `sessionLoad = Math.round(ws.sessionRpe! * durationMin)` (Foster session-RPE load), displayed by `components/health/trend-chart.tsx:47` as "load N". `lib/health/zone-minutes.ts:37-39,71` defines "Session Load" as Edwards TRIMP, displayed by `components/health/zone-breakdown.tsx:31` as "Session Load". Module-map §6 declares Edwards-TRIMP = "Session Load" as the canonical per-workout number; the sRPE variant carries the same user-facing word with different semantics and a very different scale (RPE 8 × 60 min = 480 vs TRIMP ≈ 120 for the same hour).
- Failure scenario: The single user sees "load 480" on the session-RPE trend and "Session Load 118" on the same workout's zone breakdown and reasonably concludes one is broken.
- Recommendation: Rename the trend metric ("sRPE load") or annotate per the canonical-display-sources rule; don't merge the formulas — they are legitimately different metrics.

### J-8 — /api/zone-minutes returns `days: []` for every real client request: normalizeDateParam's slash output breaks `eachDay`'s dash split — Time-in-Zone card is dead
- Severity: high
- Status: CONFIRMED
- Dup: no
- Evidence: `normalizeDateParam` returns `YYYY/MM/DD` (slash form — `lib/date-utils.ts:100`, tests `lib/__tests__/date-utils.test.ts:56`). `app/api/zone-minutes/route.ts:22-23` assigns its output directly to `from`/`to` with no `.replace(/\//g,'-')` (unlike `day-timeline/route.ts:69` which does convert). The only client, `components/health/time-in-zone-card.tsx:50-61`, always sends dash-form `?from=...&to=...` (from `todayInTz()`/`shiftDateStr`), so the route always runs them through normalize → slash form. Downstream, `eachDay` (`lib/data/postgres/slices/oura.ts:449-461`) does `fromDay.split('-')` → `Number('2026/06/20')` = NaN → `Date.UTC(NaN,…)` = NaN → `while (NaN <= NaN)` never runs → `getZoneMinutesRange` returns `[]`.
- Failure scenario: Every load of the health Time-in-Zone card (day/week/month) gets `{ days: [] }` — the chart renders permanently empty, zero zone minutes for a user with full HR coverage. The rollup cache is also never populated via this path (nothing loops). A direct no-param request (`?from` absent) would work — which is exactly what a curl smoke test does, masking the bug.
- Recommendation: Convert normalized params back to dash form (`normalizeDateParam(x)?.replace(/\//g,'-')`) as day-timeline does — or make `eachDay` (and callers) separator-agnostic. Add one test that exercises the route with dash-form params.

### J-9 — /api/training-stress 500s on every client call: slash-form date → `dateStrMidnightInTz` → Invalid Date → Drizzle RangeError; Training Stress feature invisibly dead and OTS never persisted
- Severity: high
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/training-stress/route.ts:22` — `date = normalizeDateParam(raw) ?? todayInTz(tz)`; both clients (`components/health/training-stress-line.tsx:21`, `components/workout/training-stress-badge.tsx:19`) always pass `?date=${todayInTz()}` (dash form), so `date` is always slash form `'2026/07/19'`. Line 29: `dateStrMidnightInTz('2026/07/19', tz)` = `fromZonedTime('2026/07/19T00:00:00', tz)` — traced in the pinned `date-fns-tz` (`node_modules/date-fns-tz/dist/cjs/toDate/index.js:12,139-168`): the `dateTimePattern` requires `T`/space immediately after `[0-9W+-]+`, the `/` stops the match, the remainder `'/07/19T00:00:00'` fails every time pattern → Invalid Date. `dayStart`/`dayEnd` are NaN dates fed to `repo.getOuraDaytimeSignals` (line 37); the adapter (`lib/data/postgres/adapter.ts:3767-3768`) turns them into `startDs`/`endDs` = NaN via `dsFromMeasuredAtMs(from.getTime()=NaN, …)` and compares them against the bigint `ring_timestamp_ds` column — the NaN param reaches Postgres as `'NaN'`, the query errors, the Promise.all rejects, and the route (no try/catch) 500s. (Only a user with no ring clock anchor escapes — the early `return { temp: [], met: [] }` at adapter.ts:3765 — but the S25 owner has an anchor.)
- Failure scenario: Every fetch of `/api/training-stress?date=…` 500s. `cachedFetch`/`cachedFetchToday` swallow `!res.ok`, and both the health Training-Stress line and the done-screen badge self-hide on null — so the whole Training Stress Score feature silently renders nothing, and the `upsertOuraDailyDerived` persist of `trainingLoadOts/High` (lines 74-83) never executes, starving downstream consumers (running gate hard-day check, readiness surfaces) of `training_load_ots`.
- Failure interplay: this also invalidates the "ok path" assumption in the KI row "Training Stress Score OTS (v1.162.0) — not device-verified e2e": it is not merely unverified, the shipped read path is structurally broken for the real client. (The gated/ok distinction is unreachable — the 500 happens before compute.)
- Recommendation: `const date = (raw ? normalizeDateParam(raw)?.replace(/\//g,'-') ?? null : null) ?? todayInTz(tz)`. Consider making `normalizeDateParam` return dash form and giving `getDayLog`-style slash consumers an explicit converter — three routes now hand-convert in three different ways, which is how this drifted.

## Not exercised
- Runtime confirmation of J-8/J-9 against a live server (`pnpm dev` + curl with dash-form params) — traced statically through `normalizeDateParam` → `eachDay`/`toDate` source (including the pinned `date-fns-tz` parser), but not executed.
- J-6 (OTS gap compression) needs a real gappy MET day from the ring to quantify — synthetic reasoning only.
- On-device behaviour of any BLE-fed path (real ring drains, real clock anchor, real HR density feeding zone minutes / daytime stress) — sandbox has no ring data.
- 23:59/00:01 boundary behaviour was traced by reading the window math (resilience rollup `aestMidnight` day windows, body-battery wake→now window, daily-summary pure sequencing) — no runtime clock-edge test was run.
- The ONNX daytime-stress/dHRV inference outputs (golden-tested upstream) — formula assembly read only.
- Prod-DB data drift (e.g. whether any slash-form `target_date`/derived rows already landed in prod from the J-8/J-9 code paths).

---

# Dimension K — Safety nets & error surfaces

## Summary

The app has real safety-net infrastructure: a two-tier client error pipeline (`ErrorReporter` global listeners + root error boundary → `POST /api/client-error` → `error_events` → Admin Errors tab), an outbox with bounded retry + dead-letter, a global offline pill ("Offline — showing saved data", `components/shell/offline-indicator.tsx` mounted at `app/layout.tsx:108`), and broad `toast.error` coverage on request/response-style user writes (~130 call sites). The problem is that the pieces don't connect at exactly the highest-cost points: the workout error boundary is the only boundary that does NOT report to telemetry; the dead-letter queue — the last stop for a workout that failed to sync — produces zero signal at failure time and is only ever visible if the user happens to open the More tab; and `cachedFetch` swallows every HTTP-level failure so thoroughly that several "error handling" catch blocks downstream of it are provably dead code (including the workout screen's own "Could not load workout data" toast, leaving an infinite skeleton as the actual failure UI).

The offline-first write paths are architecturally sound (local write → outbox → retry → dead-letter), but the whole chain is silent end-to-end, and its foundation — the local SQLite store — can fail to initialize with nothing but a `console.error`, silently removing the outbox safety net from every subsequent write. Given this project's documented history (local DB silently dead on Android twice; "my data disappeared" as the recurring report class), the missing piece is not more error handling but a small number of *surfaces*: dead-letter notification, a store-unavailable banner, and a fetch API that lets cards distinguish "no data" from "fetch failed".

Read-side, essentially no health/home card distinguishes failure from absence: the universal idiom is `return null` (card vanishes) or `—` (dash), which is indistinguishable from "nothing logged today". Offline is handled well (the pill, cache seeds, `applyDelta` gates); *online-but-failing* (500, 429 from the app's own rate limits, expired auth) is the unhandled quadrant.

## Findings

### K1 — /workout error boundary reports nothing to telemetry (the only boundary that doesn't)
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `app/workout/error.tsx:18-26` — on a caught error it only does `console.error("Workout error boundary caught:", error)`. Contrast `app/error.tsx:23-31`, which builds a JSON body and sends it to `/api/client-error` via `sendBeacon`/`fetch`. These are the only two `error.tsx` files in the tree (verified by glob). React boundary-caught render errors are not re-dispatched to `window`'s `error`/`unhandledrejection` events, so the global `ErrorReporter` (`components/error-reporter.tsx:34-44`) does not see them either.
- Failure scenario: a render crash mid-workout (the screen with the most complex state machine and the most rehydration hazards in the app) shows the recovery UI but leaves no row in `error_events` — the Admin Errors tab says "No errors recorded — nice" while the highest-value crash class in the app goes uncounted. Everywhere else in the app the same crash would be recorded.
- Recommendation: copy the ~8-line report block from `app/error.tsx:23-31` into `app/workout/error.tsx` (same online gate). Optionally tag the payload `url` so workout-boundary reports are distinguishable.

### K2 — cachedFetch swallows all HTTP failures → workout screen can hang on an infinite skeleton, and its error toast is dead code
- Severity: high
- Status: CONFIRMED
- Dup: no (the *rule* "self-fetching cards need explicit failure state" is in CLAUDE.md; this is a live violation on the primary workout load path, not a tracked item)
- Evidence: `lib/sqlite/cache.ts:239-255` — inside `cachedFetchCore`'s fetch promise: `if (!res.ok) return;` and `catch { /* Network unavailable */ }`. The promise never rejects for HTTP errors or network errors, so `cachedFetch(...).catch(...)` at call sites can only fire for pathological synchronous throws. In `components/workout-screen.tsx:333-369`: when there is no cache seed and no local-store program (`setLoading(true)` at :311 and the local fallback at :315-329 didn't hydrate), the only things that end the loading state are `onData` (:363) — which never fires on `!res.ok` — and the `catch` at :366-368 (`toast.error("Could not load workout data")`) — which never fires at all.
- Failure scenario: fresh cache (post-`clearAllCache`, More-tab cache wipe, or first open of a newly added session) + `/api/workout-data` returning 500/429/401 → the workout screen shows a skeleton forever with no message and no retry affordance; the user's only move is to force-kill the app. The same swallow makes every `cachedFetch(...).catch(() => {})` in the codebase (60+ sites) *look* like error handling while handling nothing.
- Recommendation: give `cachedFetchCore` an outcome signal (e.g. resolve `{ cacheHit, fetchOk, status }` or accept an `onError(status)` callback). In `fetchExercises`, on `!fetchOk && !cacheHit` set an error state with a Retry button (and keep the offline case separate via `navigator.onLine`).

### K3 — Dead-lettered outbox mutations produce zero signal at failure time; only surface is a card the user must navigate to
- Severity: high
- Status: CONFIRMED
- Dup: no (the dead-letter *mechanism* is tracked — Batch A v1.76.0 KI row, device-unverified; the outbox-depth card was item 13 and shipped. The gap here is that nothing notifies at dead-letter time — that claim in my brief is verified true, not tracked anywhere as a finding)
- Evidence: `lib/local-store/sqlite-backend.ts:1630-1646` — `recordMutationFailures` flips `status='failed'` at `attempts >= MAX_MUTATION_ATTEMPTS` (5, `lib/local-store/sync-helpers.ts:37`) and returns; no callback, no event, no toast. Both call sites (`lib/local-store/sync-engine.ts:545-547, 566-568`) are themselves `.catch(() => {})`-wrapped. The only reader of failed rows is `getFailedMutations` (grep-verified), consumed solely by `SyncHealthCard` (`components/more/sync-health-card.tsx:37`), mounted only at `app/more/more-content.tsx:165`, and refreshed only on mount (`sync-health-card.tsx:44`). No badge on the More tab, no notification, no toast.
- Failure scenario: the user logs a workout; the direct POST gets a 4xx (e.g. a payload/validation drift between web route and push branch — the historically recurring class #47/#74/#82); the outbox retries 5× over ~42 minutes, then dead-letters. Locally everything *looks* saved (local-first reads render the workout), so the user has no reason to open More. From then on: PRs, weekly stats, AI periodization, phase counters — all server-computed — silently exclude that workout, and a later device reset/re-install loses it entirely. The exact "vanished workout save" the app's standards call the worst outcome.
- Recommendation: at the `dead === true` transition, surface immediately: fire a toast if the app is foregrounded ("A workout didn't sync — tap to review") and a native LocalNotification otherwise, and drive a persistent badge/dot on the More tab from failed-count. Tier by domain: workout_log/complete_workout/session_rpe → notify; food/supplement/mood/checkin → badge only.

### K4 — Local-store init failure is silent (console-only), removing the outbox safety net for every subsequent write with no user or telemetry signal
- Severity: high
- Status: CONFIRMED (the surfacing gap; the trigger itself is the historically-proven migration-failure class)
- Dup: no (CLAUDE.md documents the *history*; nothing tracks the absence of a surface)
- Evidence: `components/sync-provider.tsx:92-97` — `initSQLite` failure → `console.error` + `return` (sync layer dead for the session; caught locally, so `ErrorReporter`'s `unhandledrejection` listener never sees it, and nothing calls `/api/client-error`). `lib/local-store/index.ts:116-118` — `getLocalStore` returns `null` whenever `isSQLiteAvailable()` is false. In `components/workout-screen.tsx:1079, 1115-1121`: with `store_ === null`, every `store_?.queueMutation(...)` in the POST failure handlers is a silent no-op — the set log's only remaining path is the direct POST, and if that also fails the write is gone while the UI already showed success (`workout-screen.tsx:1127-1130` fires haptic + logged-count synchronously).
- Failure scenario: a partially-applied local migration (the #27/#85 class) makes `open()` throw on next launch → app silently runs in web-mode on the APK: no local reads (staleness everywhere), no outbox. In a no-signal gym, every logged set and the completion POST fail → whole workout lost, zero indication at any point, nothing in `error_events`.
- Recommendation: on `initSQLite` failure on a native platform: (1) report via `/api/client-error` (it's just a fetch), (2) set a module flag surfaced as a persistent banner ("Local storage unavailable — data will only save while online"), so degraded mode is at least visible. This converts the app's single worst historical failure class from invisible to diagnosed-in-one-screenshot.

### K5 — Chest-strap HR flush drops samples permanently on a failed POST (buffer spliced before send, no re-buffer)
- Severity: medium
- Status: CONFIRMED
- Dup: no (the Polar KI row tracks device-verification of the feature, not this loss mode; the code comment claims "lossy by design", but the design note covers stream lossiness, not systematic loss)
- Evidence: `lib/live-hr/chest-strap-source.ts:109-119` — `flush()` does `const samples = this.buffer.splice(0)` then `fetch('/api/hr-ingest', ...).catch(() => {})`. A rejected/failed POST discards that window's samples with no retry, no re-buffer, no outbox. The final `stop()` flush (:124) has the same property.
- Failure scenario: gym basement with no signal — every periodic flush fails for the whole session → the entire workout's strap HR series is lost server-side while the live UI happily showed beats throughout; the workout HR summary/replay and any zone-minutes computed from `oura_heartrate` are silently empty for that session. Unlike ring history (cursor re-drains), the strap stream has no second chance.
- Recommendation: on failed flush, unshift the samples back into the buffer (with a size cap) so the next flush or `stop()` retries; or route through the existing outbox with a size-bounded `hr_samples` domain. Even network-blip resilience alone (single re-buffer) removes most of the loss.

### K6 — BLE ingest rollup failure is console-only: raw samples accumulate while health screens silently freeze
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `app/api/oura-ble/samples/route.ts:79-84` — `aggregateOuraRawSamples` failure is caught, stored in `aggregateError`, and `console.error`'d; correctly does not fail the ingest (cursor safety), but is not passed to `reportServerError` and the JSON field is ignored by the native caller (the Kotlin service only reads the `stored` count — `OuraRingService.kt:449-467` region). The only surfaces are Railway logs and, indirectly, staleness.
- Failure scenario: a decoder/rollup regression (or a bad row) makes aggregation throw on every drain → `oura_raw_samples` keeps growing, `sleep_sessions`/`body_metrics` stop updating, and the user sees "frozen health screens" — the precise symptom class of BLE-3/4 — with the root cause visible nowhere except server stdout. Because the error repeats on *every* drain, one `reportServerError` call would have pinpointed it in the Errors tab immediately.
- Recommendation: add `reportServerError(err, { userId, url: '/api/oura-ble/samples#aggregate' })` beside the `console.error`. Cheap, high-signal, and consistent with the "highest-risk routes" adoption policy — this is the archival ingest path for the ring.

### K7 — Pull-to-sync always "succeeds": push/pull/backoff failures during an explicit user refresh give no feedback
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `app/session-select/session-select-content.tsx:580-595` — `handlePullSync` wraps `pushMutations` and `pullDelta` in `.catch(() => {})` and unconditionally proceeds to invalidate + refetch. Additionally `pullDelta` returns `null` without attempting anything when inside its backoff window (`lib/local-store/sync-engine.ts:63`) — including `force=true` calls — so even the user's deliberate gesture can no-op silently. The same silent-null applies to the stale-session recovery resync at `components/workout-screen.tsx:350, 449`. (Contrast: the Health tab's sync toasts on Oura Cloud rejection, `app/health/health-content.tsx:472`, but not on push/pull failure.)
- Failure scenario: server 500s → whole-queue backoff engages; the user pulls to refresh precisely *because* things look stale; the spinner completes, caches are invalidated and refetched (also failing, silently, per K2's swallow), and the screen re-paints the same stale data with no explanation. The user's mental model — "refresh fixes it" — is invalidated with zero information.
- Recommendation: `pushMutations`/`pullDelta` already return `null` on failure — check the return values in `handlePullSync` and show one toast ("Sync failed — will retry automatically" / "Offline — changes queued") when both are null and the device is online. Consider letting an explicit `force` pull bypass (or at least report) the backoff window.

### K8 — Server error telemetry covers 3 of 176 routes (+ the AI retry helper); complete-workout — the heaviest side-effect route — is not one of them
- Severity: medium
- Status: CONFIRMED
- Dup: no
- Evidence: `reportServerError` call sites (grep-verified, exactly 4): `app/api/log-exercise/route.ts:46`, `app/api/sync/push/route.ts:54`, `app/api/oura/sync/route.ts:402`, and `lib/ai/retry.ts:46` (which serves 9 AI routes' final-failure path). `lib/observability.ts:5-6` documents the narrow adoption as deliberate ("highest-risk routes only"). But `app/api/complete-workout/route.ts:22-26` catches the shared-function failure and returns a bare 404 with no report — and its two fire-and-forget follow-ups (`:32-39` hr-sync, `:43-47` AI prescribe) are `.catch(() => {})`, so a prescription-generation outage after every workout is invisible. `/api/sync/pull` and `/api/workout-data` (the two reads the whole offline architecture leans on) also report nothing.
- Failure scenario: `completeWorkoutFromPayload` starts throwing (e.g. drifted prod data — the class local dev can't reproduce); the client silently queues to outbox (`workout-screen.tsx:1311-1313`), which then dead-letters per K3, and no server-side trace exists to correlate. The one tool built for exactly this (`error_events`) stays green.
- Recommendation: extend adoption to the rest of the offline-critical write/read set: `complete-workout` (both the 404 path and the fire-and-forget catches), `sync/pull`, `workout-data`. Keeping the deliberate non-blanket policy, that's ~5 added lines.

### K9 — Health/home self-fetching cards uniformly render failure as absence (vanish or "—"), never as an error
- Severity: medium
- Status: CONFIRMED (sampled; pattern is systemic)
- Dup: no (CLAUDE.md states the rule; these are current violations. The 2026-06-29 perf plan noted the smell for nutrition sheets — those now toast — but the read-side cards were never converted)
- Evidence (self-fetching examples, all downstream of K2's swallow so their failure branch is unreachable-as-error): `components/health/ai-weekly-volume-card.tsx:30` — `if (!loading && (!data || …)) return null` (card vanishes on failed fetch with cold cache); `components/health/training-stress-line.tsx:26` — `return null` merges "gated by design" with "fetch failed"; `app/health/heart-rate/page.tsx:54-79` — failed `readiness-score`/`oura-hr-day` fetches render `—` in every stat, indistinguishable from "no data yet"; `components/more/friend-feed.tsx:68` and `friend-leaderboard.tsx:44` — `.catch(() => {}).finally(() => setLoading(false))` lands on the empty state. Counter-examples proving the app knows how: `components/workout/exercise-stats-sheet.tsx:223` ("Failed to load exercise history"), `next-workout-card.tsx:86` and `done-screen.tsx:496` (Retry), `components/admin/time-audit-card.tsx:140` (error + Retry).
- Failure scenario: the app's own rate limiter 429s a health endpoint (the CLAUDE.md-documented self-inflicted case — home + health + sync-provider warm all hit `readiness-score`-class endpoints on open) → tiles quietly vanish or dash out; the user reads it as "no data today" and mistrusts the ring pipeline (support cost lands on the BLE integration, which is innocent).
- Recommendation: after K2's outcome signal exists, adopt one shared tri-state for self-fetching cards: data / empty-with-reason / error-with-retry (online only). Prioritize the cards whose absence has caused past "is my ring broken?" confusion: readiness, HR day, sleep, trends sparklines.

## Design notes

### 1. Inventory of silent-failure sites, ranked by user cost

Cost tiers: **T1** = user data permanently lost or silently diverging; **T2** = user misled at decision time (wrong/missing numbers, dead affordance); **T3** = degraded/stale but recoverable; **T4** = accepted/by-design silence (fine).

| # | Tier | Site | Evidence | What is swallowed |
|---|------|------|----------|-------------------|
| 1 | T1 | Outbox dead-letter transition | `sqlite-backend.ts:1630-1646`; callers `sync-engine.ts:545-547,566-568` | Final failure of any offline-first write (workout, completion, food, mood…). No signal at failure time; More-tab card only (K3) |
| 2 | T1 | Set-log double-failure with dead local store | `workout-screen.tsx:1079,1104-1122` (`store_?.queueMutation` no-ops when store null) | Entire set log lost after success feedback already fired (K4) |
| 3 | T1 | `initSQLite` failure | `sync-provider.tsx:92-97` | The whole local-first + outbox layer, silently, for the session (K4) |
| 4 | T1 | Chest-strap HR flush | `chest-strap-source.ts:109-119` | Whole-session strap HR on flaky network (K5) |
| 5 | T2 | `cachedFetchCore` HTTP swallow | `cache.ts:240,251-255` | Every non-ok response (incl. own 429s) for ~60 read sites; makes downstream `.catch` handlers dead code (K2) |
| 6 | T2 | Workout screen primary load | `workout-screen.tsx:333-369` | Infinite skeleton; dead "Could not load workout data" toast (K2) |
| 7 | T2 | Pull-to-sync | `session-select-content.tsx:584-595`; `sync-engine.ts:63` backoff null | User's explicit refresh fails invisibly (K7) |
| 8 | T2 | Self-fetching health/home cards | K9 list | Failure rendered as absence |
| 9 | T2 | BLE rollup failure at ingest | `oura-ble/samples/route.ts:79-84` | Health-screen freeze with cause visible only in Railway logs (K6) |
| 10 | T2 | complete-workout side effects | `complete-workout/route.ts:32-47`; `lib/workout/complete-workout.ts:49` | hr-sync, next AI prescription, ranPrescription flag — all fire-and-forget server-side (K8) |
| 11 | T3 | `pullDelta` page failures | `sync-engine.ts:74-81,456-467` | Staleness only; backoff sensible; partial-page progress preserved. Acceptable *given* an eventual surface for prolonged failure |
| 12 | T3 | Sync-provider warms | `sync-provider.tsx:64-81` (`if (!res.ok) return`) | Cache stays cold; screens' own fetches are the fallback. Acceptable |
| 13 | T3 | Reminder reconcilers | `sync-provider.tsx:248-250,286-288,314-316,354-356`; `lib/meal-reminders.ts`, `workout-reminders.ts`, `supplement-reminders.ts`, `health-alerts.ts` catch-{} sites | A reconcile skip = a reminder that silently doesn't fire/cancel. Borderline T2; delivery already tracked as device-unverified KI rows |
| 14 | T3 | `syncOuraRing` manual drain | `lib/oura-ble/sync.ts:48-50` | Manual ring refresh fails silently; hourly drain is the net. Borderline with #7 |
| 15 | T4 | Service worker fetch handlers | `public/sw-template.js:104-107,137-156,161-175` | Correct: API passthrough (client handles), navigations network→cached→/offline, `res.ok` guards prevent cache poisoning. No silent-failure defect found |
| 16 | T4 | Native BLE drain POSTs | `OuraRingService.kt:371-441` | Correct: bounded retries, cursor held on failure, `lastIngestError` surfaced in admin debug console (`oura-ble-debug.tsx:503-505`) |
| 17 | T4 | Haptics/notification-permission/`Browser.close` catch-{}s | `lib/haptics.ts`, `lib/notifications.ts:42,50`, etc. | Correctly silent |
| 18 | T4 | `/api/log-rest-day` fire-and-forget | `session-select-content.tsx:871`; route is a deliberate no-op (`app/api/log-rest-day/route.ts:7-9`); state lives in the date-stamped localStorage marker | Looks like the CLAUDE.md smell but is not a write |

### 2. A coherent minimal error-surfacing standard

**Axiom (already the house position, keep it): offline is not an error.** The global pill (`offline-indicator.tsx`, mounted `app/layout.tsx:108`) plus cache-seeded paints ARE the offline UX. Every rule below applies only when `navigator.onLine` is true; when offline, writes queue silently and reads show saved data — no red anywhere.

**W1 — Request/response user writes (save buttons, sheets): toast on failure, with cause.** Already ~90% adopted. Standardize on `lib/ui/fetch-with-toast.ts` — which currently has **zero call sites** (grep-verified) despite being listed in `docs/module-map.md:350` as the standard — or delete it; a documented standard helper with no users is worse than none, because reviewers assume coverage.

**W2 — Offline-first fire-and-forget writes: success feedback stays synchronous; failure surfacing belongs to the outbox, tiered by domain.**
- *Transient failure (attempts < 5):* silent. Retry/backoff is working as designed; nagging here would train the user to ignore red.
- *Dead-letter transition:* this is the one moment that must notify (K3). Tier A (workout_log, complete_workout, session_rpe, fitness_tests): immediate toast when foregrounded + LocalNotification otherwise ("A workout didn't sync — review in More"). Tier B (food, supplements, mood, checkins, injuries): persistent More-tab badge only. Tier C (telemetry: hr samples, battery polls): silent.
- *Detail/retry/discard surface:* `SyncHealthCard` stays as-is; add a refresh trigger beyond mount (resume listener) so the count isn't stale.

**W3 — Store-unavailable is a mode, not an event.** Native + `getLocalStore() === null` ⇒ persistent banner ("Local storage unavailable — saving online only") + one client-error report (K4). This is the single cheapest insurance against the app's worst historical failure class.

**R1 — Reads must be able to distinguish miss from failure.** Extend `cachedFetchCore` to expose fetch outcome (status/ok) to callers (K2). Until then, every read-side rule is unimplementable — this is the keystone change.

**R2 — Screens (primary dataset):** loading must terminally resolve to data | empty | error-with-retry. An infinite skeleton is a bug by definition (workout screen is the current violation). Error copy names the resource, not "something went wrong": "Couldn't load this session — Retry".

**R3 — Cards/tiles (secondary data):** tri-state. Cached-but-stale data always beats an error state (render it, optionally with the existing stale-indicator pattern); error-with-retry only when online + no cache; empty-with-reason ("No sleep recorded yet") only when the fetch *succeeded* empty. A 429 from the app's own rate limiter gets distinct copy ("Busy — retrying shortly") and never an alarming red.

**T1 — Telemetry floor:** both error boundaries report (fix `app/workout/error.tsx`, K1); `reportServerError` covers every route that participates in the offline-first write/read chain (add complete-workout, sync/pull, workout-data, oura-ble samples-rollup — K6/K8). Everything else stays opt-in per the existing non-blanket policy.

### 3. Existing generic failures that should become specific

| Current | Where | Should say |
|---|---|---|
| Infinite skeleton (no message at all) | workout screen cold-cache + server error (K2) | "Couldn't load this session — Retry" vs the offline pill |
| "Could not load workout data" (dead code) | `workout-screen.tsx:367` | Wire it (needs K2 keystone), split offline / server / rate-limited |
| Card vanishes / "—" | K9 list | Tri-state per R3; "—" reserved for genuinely-absent data |
| "Oura sync failed" | `health-content.tsx:472`, `more-content.tsx:123` | Distinguish token-expired ("Reconnect Oura in More") from network from frozen-Cloud (which per CLAUDe rules isn't freshness anyway) |
| "push rejected: HTTP 400" / raw server error strings | `sync-engine.ts:546` → `SyncHealthCard` line 103 | Map the common envelope/validation causes to human text; keep raw string in the expandable detail |
| "Something went wrong" + raw `error.message` | both boundaries | Fine for a single-user app; add the digest so the Errors tab row and the screenshot correlate |
| Silent success on failed pull-to-sync | K7 | "Sync failed — will retry automatically" |

### 4. Brief-verification answers (explicit)

- **`app/workout/error.tsx` reports no telemetry:** CONFIRMED — console.error only (`:20-22`); root boundary does report (`app/error.tsx:26-30`).
- **`reportServerError` call sites:** exactly 4 — 3 routes (`log-exercise:46`, `sync/push:54`, `oura/sync:402`) + `lib/ai/retry.ts:46` (serving 9 AI routes via `withAiRetry`). 176 total API routes.
- **`cachedFetch` swallows `!res.ok` incl. 429:** CONFIRMED — `cache.ts:240`; additionally never rejects, so caller `.catch`es are dead (K2).
- **Dead-letter only visible in More tab:** CONFIRMED — sole reader `SyncHealthCard`, mounted `app/more/more-content.tsx:165`; at failure time: nothing (K3).
- **`error_events` + `/api/client-error` flow:** CONFIRMED end-to-end — `migrations/109_error_events.sql`, `schema.ts:564`, route validates + rate-limits (`client-error/route.ts:17-37`), both `ErrorReporter` and the root boundary POST (sendBeacon-first), Admin Errors tab renders (`components/admin/errors-tab.tsx`), 30-day retention prune (`adapter.ts:3618`).
- **Toast coverage writes vs reads:** request/response writes broadly toast (~130 sites); offline-first fire-and-forget writes rely on the (silent) outbox; background reads are uniformly silent — correct per the standard above *except* the dead-letter moment and pull-to-sync.

## Not exercised

- Any on-device runtime behavior: actual SQLite init failure, dead-letter flow on a real APK, LocalNotifications delivery, Samsung WebView `sendBeacon` behavior.
- React 19 boundary/window-event interaction (K1's claim that `ErrorReporter` cannot see boundary-caught errors) is from framework semantics, not observed at runtime.
- Reproduction of the app's own rate limits triggering the K2/K9 paths (statically traced only).
- Kotlin BLE service beyond static read (`OuraRingService.kt`); the accel/live-frame paths and `OuraGattClient` were not audited.
- Service-worker behavior under a real deploy transition (two-generation cache retention logic read, not exercised).
- `/api/sync/push` server-side per-mutation error semantics (read only as consumed by the client; the route body itself was not fully audited — Dimension-K scope was the client surfacing).

---

# Dimension R — Prior-review fixed-claims re-verification + regression hunt

## Summary
Re-verified 17 of the highest-impact "fixed/shipped" claims from the five prior reviews and projectOverview.md against current `main` (c2bd70f). 14 are VERIFIED-STILL-FIXED with code at the cited lines doing what the claim says (AI-1 repCompletionRate chain, v1.165.2 poll gate, S1/S2/S6/S7 derived-scores + AI-signal fixes, v1.157.1 SW network-first, v1.124.7 tombstone + offline-food fixes, clearLegacyHomeSeeds, check-push-mutations CI rule (ran it — OK), normalizeDateParam sweep, TMR-2 timer staleness guard, CCH-1 prescription invalidation group, AI-8 deload PR gate, NEW-1 invalidateCache('') removal).

Three findings. The big one confirms the prior partial pass's suspicion: **the BLE-1 "cursor advances only on 2xx" native fix contains a real hole-jump race (R-1, high)** — the `drainIngestFailed` gate is read on the ingest executor immediately after the failing batch's `main.post` is queued but before it runs (and the flag is non-volatile), and `confirmStored` on the success path never checks the flag, so a batch succeeding right after a failed one advances the persisted cursor past the failed span, silently and permanently skipping it on the automatic re-drain. The other two are residue of otherwise-good fixes: the v1.171.0 strict-id fix left the offline local-store seed still resolving dead session ids by name→sessions[0] (R-2, low), and /api/oura/hr-window's date+time form escaped the normalizeDateParam sweep (R-3, low). One additional non-finding note: whole-session delete tombstones set_logs without bumping updated_at (invisible today because reads join through tombstoned parents).

## Claims table
| # | Claim | Verdict | Evidence (see finding/verdict detail below) |
|---|-------|---------|---------------------------------------------|
| 1 | BLE-1 cursor-advance-only-on-2xx (two-layer fix) | PARTIAL — JS layer correct; native layer has a CONFIRMED cursor hole-jump race (finding R-1) | OuraRingService.kt:375-394, 545-553; oura-ble-debug.tsx:174-198 |
| 2 | 2026-07-10 AI-1: setLastSessionRanPrescription never called → repCompletionRate dead | VERIFIED-STILL-FIXED | lib/workout/complete-workout.ts:44-49 calls it (reads status BEFORE overwriting to 'consumed'); shared fn used by web route (app/api/complete-workout/route.ts:4) AND pushMutations complete_workout branch (adapter.ts:3502-3510); read side gates on state.lastSessionRanPrescription (lib/ai-periodization/signals.ts:282) and feeds autoregulation/emergency-deload; unit tests cover it |
| 3 | v1.165.2 preparing-poll rate-limit fix (poll must not re-fire /prescribe) | VERIFIED-STILL-FIXED | Client poll passes poll=1 and never re-triggers generation (components/workout-screen.tsx:336-338, 393-396; bounded 10×3s at :51-52, :388); server skips the prescribe re-fire when isPoll (app/api/workout-data/route.ts:89, :368-373) |
| 4 | S7 AI-signal consistency (v1.161.1: temp deviation into periodization, sleep trend on score not just duration, SpO2 into chat) | VERIFIED-STILL-FIXED | signals.ts computes sleepScoreTrend (:364), spo2Trend (:386-399), tempZ vs prior-night baseline reusing illnessZScores (:404-409); prompt.ts renders all three (:228-238); ai-chat health tool exposes spo2Pct + daytime stress (lib/ai-chat/tools.ts:47,70). (DUP index listed S7 as OPEN — it shipped later as v1.161.1) |
| 5 | S1 dead post-re-key sparklines → /api/health/trends reads oura_daily_derived (v1.158.1) | VERIFIED-STILL-FIXED | app/api/health/trends/route.ts:46-56, 92-99 coalesces derived-first (derived?.readinessScore ?? oura?.readinessScore etc.); dedicated test app/api/health/trends/__tests__/derived-coalesce.test.ts; all sparkline cards fetch this route via the shared health-trends-summary key. (Note: the sibling /api/health-trends correlation views at route.ts:124-126,188 still x-axis on frozen Cloud getOuraDaily readiness — post-re-key days silently drop out of correlations; that is S8/S9-adjacent open scope, not an S1 regression) |
| 6 | S2 Body Battery flat-50 anchor → own composite (v1.158.1) | VERIFIED-STILL-FIXED (re-confirming prior pass) | app/api/body-battery/route.ts:112-136 anchor precedence: derivedToday.readinessScore → own sleep score → Cloud readiness/sleep → default 50; anchorSource surfaced and tested (app/api/body-battery/__tests__/anchor-source.test.ts) |
| 7 | S6 own sleep-score contributors served + persisted (v1.158.1) | VERIFIED-STILL-FIXED | app/api/readiness-score/route.ts:170 builds ownSleepContributors via sleepComponentsToContributors; :423 response prefers Cloud only when present (frozen Cloud has no post-re-key rows → own served); :401 persists into oura_daily_derived; renderer components/readiness-card.tsx:235-236 + sleep detail (health-score-detail.tsx:163) read the response field; DB-level test sleep-contributors-persist.test.ts |
| 8 | v1.157.1 SW deploy-skew fix (navigations network-first; prev-gen cache retained; no force-reload) | VERIFIED-STILL-FIXED | public/sw-template.js:126-156 navigations network-first with cache-put only for the offline fallback path; :18-38 activate retains current+previous build caches via ta-meta "prev" and drops client.navigate force-reload; /api/* never cached (:104-107); res.ok guards throughout |
| 9 | v1.124.7 R3 Chunk-1: workout-delete tombstones propagate (SYNC-C1) + offline new-food save (SYNC-O2) | VERIFIED-STILL-FIXED | Delete: lib/workout/delete-session.ts:48-61 soft-deletes session+exercise_logs+set_logs with updated_at bump on session/exercise_logs; getSyncDelta emits deletedAt for workout_sessions/exercise_logs/set_logs (adapter.ts:2985-3061); client maps deletedAt (sync-engine.ts:136,155,175) and local reads filter deleted parents (sqlite-backend.ts:176,195). Minor non-finding note: set_logs tombstone omits an updated_at bump (delete-session.ts:57-60) so already-synced devices never receive the child tombstones — harmless today because every local set-log read joins through a (tombstoned) parent, but orphan set rows persist locally. Offline food: 'food_items' outbox domain (lib/local-store/types.ts:335) handled in pushMutations (adapter.ts:3322-3345); local food_items table + join render (sqlite-backend.ts:1377,1400-1404) |
| 11 | clearLegacyHomeSeeds coverage (session 271 claim: called from BOTH invalidateWorkoutSummaries and invalidateProgramStructure) | VERIFIED-STILL-FIXED | lib/cache-groups.ts:6-12 clears ta_recommendation_v1/ta_meta_v1; called at :61 (invalidateWorkoutSummaries) and :116 (invalidateProgramStructure). Also confirmed ta_streak_v1/ta_calendar_v2 have no remaining seed sites (grep clean) |
| 12 | check-push-mutations CI rule (Canonical Runtime: pushMutations may not touch this.db/raw sql) | VERIFIED-STILL-FIXED | scripts/check-push-mutations.js brace-matches the method body and flags this.db./sql` lines; ran it — "check-push-mutations: OK", exit 0; wired into CI at .github/workflows/ci.yml:230 |
| 13 | normalizeDateParam coverage (session-212 + 2026-07-06 gaps: day-log, day-timeline, workout-sessions/day, oura/hr-day, ai-chat localDate; new routes guarded at creation) | VERIFIED-STILL-FIXED, one residual same-class gap (finding R-3) | day-log/route.ts:55, day-timeline/route.ts:69, workout-sessions/day/route.ts:13, oura/hr-day/route.ts:15 all normalize; ai-chat localDate Zod-regex `^\d{4}-\d{2}-\d{2}$` (lib/validators/chat.ts:12); newer routes training-stress:22, zone-minutes:22-23, running-plan:181 guarded; unit tests in lib/__tests__/date-utils.test.ts:54-71. Residue: /api/oura/hr-window date+time form does raw split+Date arithmetic (R-3) |
| 14 | 2026-07-10 TMR-2 staleness guard on rehydrated timers (+TMR-1/5 shared effectiveRestSec) | VERIFIED-STILL-FIXED | lib/stores/workout-store.ts applyRehydrateFixups (:191-220+): 4h-stale/date-rolled timer anchors reset to 'pre'/idle; exercise-summary/done modes never survive rehydrate; wired at onRehydrateStorage :391-394; WK-13 rolloverDay added for foregrounded midnight (:380). effectiveRestSec (:412-414) is the single rest-target derivation (TMR-1/TMR-5) |
| 15 | 2026-07-10 CCH-1 prescription accept/dismiss invalidates workout-card freshWithinTtl | VERIFIED-STILL-FIXED | invalidatePrescriptionChanged group (lib/cache-groups.ts:259-267) clears workout-data + workout-card:<id> + ai-periodization-session:<id> + AI overview; called at accept AND dismiss (components/workout/ai-prescription-card.tsx:81,100) and phase transition (workout-screen.tsx:373); unit-tested (lib/__tests__/cache-groups.test.ts:169-177) |
| 16 | 2026-07-10 AI-8 deload sessions must not mint PRs | VERIFIED-STILL-FIXED | lib/workout/log-exercise.ts:50-56 shouldCountTowardPr gates on isAnyDeload + per-exercise exerciseDeloaded; :114-120 explicitly resolves ai_dynamic deload state from session_periodization (the gap AI-8 found — automatic-program phase lookup returns null for ai_dynamic) |
| 17 | 07-11 offline-feel NEW-1 More-tab invalidateCache('') nuke (v1.133.0) | VERIFIED-STILL-FIXED | No invalidateCache('') remains anywhere under app/ (grep clean); app/more/more-content.tsx:126 documents the targeted-group replacement. Bonus: the health-content invalidateCache('') residual tracked in planned_upgrades R 07-03 is also gone from source |
| 10 | v1.171.0 stale-session-id / strict-id identity fix (#628, c2bd70f) | VERIFIED-FIXED as described, with one sibling-surface residue (finding R-2) | Server resolves strictly by id, no name/sessions[0] fallback, sessionNotFound flag (workout-data/route.ts:144-154); prescribe validates against active program + self-heals state row (prescribe/route.ts:121-139); all prefetch/nav callers now pass ids (session-select:510, workout-select:168, overview-screen:181, workout?session= links all id-based); editor round-trips session_exercises ids (program-editor-sheet.tsx EditableExercise.id, config-screen.tsx:394,447; programs.ts:239-262 honors them); config save + 404 recovery force pullDelta full re-sync (config-screen.tsx:501-506, workout-screen.tsx:344-350, 435-446; sync-engine.ts fullResync param). Regression hunt in the diff itself: found the local-store offline seed still name/sessions[0]-fallback-resolves (R-2); sessionNotFound payload is cached 6h under workout-data:{tab} and re-fires an epoch full-resync per mount of a dead link (wasteful, bounded — not a finding); periodization fetch converted to bare fetch deliberately to observe 404 status (documented deviation, has manual seed+setCached) |

## Findings

### R-1 — BLE-1 native drain fix has a real cursor hole-jump race: a batch after a failed batch can still confirm and permanently skip the failed span
- Severity: high
- Status: CONFIRMED (code-traced; the exact interleaving is deterministic, only the network condition is probabilistic)
- Dup: no (the KI row tracks BLE-1 as "fixed 2 layers; needs APK rebuild" — this is the shipped fix being WRONG, which per the DUP rules is a new finding; a prior partial pass suspected this race and it is hereby verified)
- Evidence:
  - `android/app/src/main/java/com/trainingai/app/oura/OuraRingService.kt:97` — `private var drainIngestFailed = false` is a plain non-volatile field (contrast `lastIngestError` at :104 which IS `@Volatile`).
  - `:375-379` — `postDrainBatch` (runs on the single-thread `ingest` executor) gates only at the START: `if (drainIngestFailed) { skip }`. This read happens on the ingest thread.
  - `:380-393` — on failure, `drainIngestFailed = true` is set inside a `main.post { }` (async, on the main thread). On success, `confirmStored(batchMaxDs)` is called inside a `main.post { }` — **with no `drainIngestFailed` check**.
  - `:545-553` — `confirmStored` unconditionally advances the persisted `history_cursor_ds` monotonically; it never consults `drainIngestFailed`.
  - Interleaving: batch N's `postFramesWithRetry` exhausts its 4 attempts (~17s of sleeps, `:60-61`, `:425-441`) synchronously on the ingest thread, then calls `main.post {fail}` and returns; the executor immediately dequeues batch N+1's task, whose `drainIngestFailed` read at `:376` executes microseconds later — the main thread has almost certainly NOT yet run the posted runnable, so N+1 sees `false` and uploads anyway (the guard is effectively dead for the batch immediately following a failure; it only protects N+2 onward). Even if visibility were fixed with `@Volatile`, the success path's `confirmStored` still doesn't check the flag, so the main-thread event order "set failed=true (from N), then confirmStored(dsN+1max) (from N+1)" still jumps the hole.
- Failure scenario: multi-batch drain in progress (the ring returns ≤255 events per GetHistory and the drain loop pulls at BLE speed while POSTs trail behind, `:348-351`). A transient server outage lasting ~17–35s (Railway deploy 502 window, a 429 burst, or a 401 that resolves when the owner opens the app and the cookie refreshes) makes batch N fail all 4 retries while batch N+1 — starting immediately after and enjoying its own 4 attempts over another ~17s — succeeds. N+1's `confirmStored(batchMaxDs_{N+1})` advances the persisted resume cursor past batch N's never-stored span. Batch N's failure also set `lastDrainCompletedAt = 0` (`:384`) so the keepalive re-drains within 5 min — but from the jumped cursor, so the hole (up to 255 events ≈ tens of minutes of HR/SpO2/temp/steps/sleep events) is never re-requested. Loss is silent (only a log line on a debug screen) and only recoverable by a manual "Full re-sync" before the ring's finite buffer overwrites the span — exactly the failure class BLE-1 was supposed to close. Doc comment `:372-374` states the invariant ("the resume cursor must never jump a hole") but the code does not enforce it on the confirm side.
- Recommendation: move the gate to the confirm side — in `postDrainBatch`'s success `main.post`, check `drainIngestFailed` before calling `confirmStored` (both write and read then occur on the main thread, eliminating the visibility problem too); keep the ingest-thread skip as a bandwidth optimization only. One-line fix; needs an owner APK rebuild.
- Note on the second layer: the legacy JS forwarding path (`components/oura-ble/oura-ble-debug.tsx:174-198`) is correct — frames are spliced from the pending buffer and `confirmStored` called only after a 2xx, sequential with a `flushing` guard, and it is disabled entirely when native ingest is active (`nativeIngest.current`). The defect is exclusively in the native path that current APKs use.

### R-2 — Strict-id identity fix (v1.171.0) left its own sibling surface: the offline local-store seed still resolves a dead session id by name → sessions[0], silently loading the wrong session
- Severity: low
- Status: CONFIRMED (code path traced; requires offline + stale id, the exact scenario the fix targets)
- Dup: no (the KI row claims "workout-data name fallback removed"; this fallback survives in the same function the fix edited)
- Evidence: `components/workout-screen.tsx:318-327` — when there is no cached seed, the offline paint path resolves `local?.sessions.find(s => s.id === tab) ?? local?.sessions.find(s => s.name.toLowerCase() === tab) ?? local?.sessions[0]` and then `setProgramSessionId(sess.id)` — the name-and-first-session fallback the same PR deleted from the server route (`app/api/workout-data/route.ts:144-148`, whose comment says a stale id must "never silently return the wrong session's data"). Commit c2bd70f edited this very function but did not sweep this branch.
- Failure scenario: program edited (ids re-minted for a new session) → user opens a stale `/workout?session=<dead-id>` link while offline (airplane mode / gym dead zone) with no `workout-data:` cache for that key. The local seed silently paints `sessions[0]` — a different session — and sets it as the live `programSessionId`; sets logged then attach to the wrong program session (phase counting, prescriptions, todayLogged keying). Online, the network response's `sessionNotFound` overrides it; offline, nothing does.
- Recommendation: mirror the server's semantics in the local seed — id-only match; on miss, show the same "session was updated" reselect screen instead of falling back by name/position.

### R-3 — /api/oura/hr-window's date+time form escaped the normalizeDateParam sweep: raw split + Date arithmetic on an unvalidated date param
- Severity: low
- Status: CONFIRMED (code shows no guard; 500 requires a malformed param, which no current client sends)
- Dup: no (the 2026-07-06 sweep + follow-ups covered day-log/day-timeline/workout-sessions-day/oura-hr-day/ai-chat and new routes; hr-window was missed and the CLAUDE.md rule says "every API route that accepts a date param")
- Evidence: `app/api/oura/hr-window/route.ts:24-29` — `dateParam.split('-').map(Number)` then `new Date(y, mo - 1, d, sh, sm, 0)` and `fromZonedTime(...)` with no `normalizeDateParam`/NaN check on the `?date=` form (the ISO `?start/?end` form at :34-38 IS validated). A malformed `date`/`startTime` yields Invalid Dates flowing into `repo.getHrForWindow` → driver-level error → 500, the exact class the rule exists to prevent.
- Failure scenario: any caller (future feature, cached URL with a mangled param) hitting `?date=<garbage>&startTime=..&endTime=..` gets a 500 instead of a 400. No current in-app caller sends malformed values, so impact is robustness-only.
- Recommendation: run `dateParam` through `normalizeDateParam` and validate the HH:MM pieces, returning 400 on null — same as sibling routes.

## Not exercised
- Runtime/on-device behaviour of any fix — everything here is static code verification (no APK, no BLE ring, no Samsung WebView, no real Oura data). The R-1 race in particular needs the exact 17–35s-outage timing to fire; it was traced, not reproduced.
- The v1.161.1 digest-windowing bonus fix ("avg sleep covers just this week") — signal wiring verified, the weekly-digest window math itself not re-derived.
- Prod-data-drift-dependent claims (migrations, seeded-row corrections) — local sandbox DB only.
- The full breadth of the 07-06 review's ~90 findings — sampled the highest-impact per the brief; batches R1/R2/R5/R7/R8 shipped claims not individually re-verified beyond the sampled items (CCH-1/2-class, NEW-1, normalizeDateParam, AI-*, TMR-*, SYN-* sampled).
- b5dc2b6 (WK-13/WK-16 day-rollover) diff was only spot-checked via the workout-store rolloverDay action; its completion-flow timezone half not independently re-traced.

---

# Appendix — Adversarial verification verdicts

# Verdict: D-1 (food_items push-envelope drop)

VERDICT: REAL
Revised severity: critical (unchanged)
isDup: no

## Reasoning (adversarial verification — attempted refutation failed at every step)

Every link in the claimed failure chain was re-read from source and holds; no healing path exists.

1. **The mutation is queued.** `/home/user/TrainingAI/lib/nutrition/log-food.ts:181-237` — `logFoodEntries` takes the local-store branch whenever `getLocalStore(userId)` returns a store (i.e. always on the S25 APK, online or offline; network state is never consulted). For any entry without a pre-existing `foodItemId` it mints `crypto.randomUUID()` (line 193) and queues `queueMutation({ domain: 'food_items', ... })` (lines 208-219), then queues the dependent `domain: 'food_logs'` mutation referencing that id (lines 227-232). The direct `POST /api/nutrition/food-items` (line 100, `createFoodItem`) is reached only in the web fallback after line 244 — dead code on the APK unless the SQLite write itself throws.

2. **The envelope rejects it.** `/home/user/TrainingAI/lib/sync/mutation-schema.ts:9` — the `domain` `z.enum` lists 13 domains; `'food_items'` is not among them. Exact mechanism in the route: `/home/user/TrainingAI/app/api/sync/push/route.ts:32-43` runs `MutationSchema.safeParse` per mutation (not `.parse`, so no 400); on failure it `console.error`s and **deliberately omits the mutation from both `valid` and the response `errors`** (comment at lines 37-39: "makes the client treat it as done (quarantined)"). So the server returns 200 with no error row for the food_items mutation.

3. **The client permanently deletes it.** `/home/user/TrainingAI/lib/local-store/sync-engine.ts:554-574` — `resolveFailedOutboxIds(chunk, result.errors)` marks only mutations present in `result.errors` as failed; everything else in the chunk is `confirmed` (line 561) and `store.deleteMutations(confirmed...)` (line 574) removes the outbox row. No retry, no dead-letter — the food_items mutation is gone after the first push while the item exists only in on-device SQLite.

4. **The adapter branch is real but unreachable.** `/home/user/TrainingAI/lib/data/postgres/adapter.ts:3322-3345` has a complete `food_items` pushMutations branch (`createFoodItem` with client-supplied id) — but `pushMutations` receives only the route's `valid` array (route line 47), which the schema filter emptied of food_items. This asymmetry (branch written, enum never updated) is exactly the shipping mistake claimed; history even records the mirror-image incident: `docs/overview/history-recent.md:286` notes PR #12 had to add `'workout_log'` to "the `/api/sync/push` domain enum (the one gate Phase 2 missed)" — same gate, and `food_items` (added in the SYNC-O2 change, `docs/implementation-backlog.md:779-783`) never got that step.

5. **The paired food_logs mutation dead-letters, exactly as claimed.** `/home/user/TrainingAI/lib/data/postgres/slices/nutrition.ts:210-217` — `foodLogRefsValid` requires a `food_items` row with `id = foodItemId AND user_id = userId`; the item never landed, so it returns false → adapter:3359-3361 pushes `{ error: 'FK ownership check failed' }` → client `recordMutationFailures` (`sync-engine.ts:562-569`) → backoff per `sync-helpers.ts:37-39` (30s·4^n) → dead-letter at `MAX_MUTATION_ATTEMPTS = 5` (`sqlite-backend.ts:1630-1637`). The log never reaches Postgres either.

6. **No healing path (refutation attempts, all failed):**
   - *Web fallback POST:* only runs when the local store is null or the SQLite write throws (`log-food.ts:239-249`) — never on a healthy APK.
   - *Pull:* `getSyncDelta` can only emit rows that exist server-side; the item never does, so no pull can back-fill it (and the pull direction couldn't push it anyway).
   - *Stranded-pending sweep:* `sync-engine.ts:496-508` re-queues **workout_log only** (`getStrandedPendingWorkouts`); and even if food rows were swept, re-queuing `food_items` would just be dropped again.
   - *Other client POST paths:* the only other live `POST /api/nutrition/food-items` caller is `components/nutrition/saved-meals-sheet.tsx:131` (saved-meal builder, server-only CRUD) — a different flow creating different server-side ids; it cannot recreate the client-minted UUID the stranded food_log references.
   - Local rendering keeps working (item + log render local-first with `syncStatus: 'pending'`), which is what makes the loss silent — server aggregates (day-timeline, weekly stats, AI nutrition context) permanently under-count, and a reinstall/local-store wipe loses the data outright.

7. **Not tracked.** `docs/implementation-backlog.md:779-783` records SYNC-O2 as **completed** (Chunk 1 Task 1.4) with the outbox push ordering explicitly listed as "Not exercised... device smoke not run"; `projectOverview.md` Known Issues (lines 3768+) has no row for food_items/nutrition sync — the WK-13/WK-16, accessory-intensity, health-alerts, and running-coach rows are unrelated. No open backlog item or Known-Issues row mentions the `MutationSchema` enum gap. The finding is the discovery that a fix recorded as shipped is structurally broken — not a duplicate of the SYNC-O2 entry itself.

Severity stays **critical**: silent, permanent, unrecoverable (outbox row deleted) server-side loss of every newly-created food item and its log, on the canonical runtime, online or offline, for the app's primary nutrition-entry flows (scan/AI/manual/barcode — anything not picked from the existing library). The one-line fix (add `'food_items'` to the enum) plus dead-letter re-queue audit in the finding's recommendation is correct.


# Verdict R-1 — BLE-1 native drain cursor hole-jump race

VERDICT: REAL
Revised severity: high (confirmed as filed; per-incident loss is bounded — see below — but the class is silent, self-masking, permanent-after-wrap data loss in the one pipeline whose entire design promise is "the resume cursor never jumps a hole")
isDup: no — projectOverview.md:4369 tracks BLE-1 as "FIXED in two layers; needs APK rebuild" and explicitly claims "a failed batch skips all later confirms so the cursor never jumps a hole"; this finding is that shipped claim being wrong in the native layer, which is a new finding, not a duplicate of the (closed) BLE-1 row. docs/oura-ble-operations.md rows I2/I3 ("later batches of that drain are skipped (the cursor must never jump a hole)") document the same unenforced invariant.

## Reasoning

I attempted to refute the finding by tracing the exact interleaving in `android/app/src/main/java/com/trainingai/app/oura/OuraRingService.kt` and could not — every load-bearing claim checks out at the cited lines.

**The flag and its threads.** `drainIngestFailed` (OuraRingService.kt:97) is a plain `var`, non-volatile (contrast `lastIngestError` at :104, which is `@Volatile`). It is reset on the main thread in `startDrain` (:529), written `true` on the main thread inside the failure branch's `main.post { }` (:381-385), and read on the single-thread `ingest` executor at the top of `postDrainBatch` (:376). Cross-thread, no synchronization, no happens-before edge — the finding's threading claim is accurate.

**The race is real and the gate is effectively dead for batch N+1.** The drain loop explicitly does not wait for uploads (:348-351: "The drain loop does NOT wait — it keeps pulling at BLE speed while batches upload behind it"), so in any multi-batch drain, batch N+1's task is already sitting in the executor queue while batch N POSTs. When batch N exhausts its 4 attempts (`POST_RETRIES=3` at :60, sleeps 2+5+10 s at :61/:436 — ~17 s minimum, more with the 15/30 s connect/read timeouts at :456-457), `postFramesWithRetry` returns null on the ingest thread, `main.post {fail}` is *queued* (:381), and `postDrainBatch` returns — whereupon the executor immediately dequeues batch N+1's task and executes the `:376` flag read microseconds later. The main thread has essentially never run the posted runnable by then, so N+1 reads `false` and uploads. Even if the timing broke the other way, the non-volatile read has no visibility guarantee. And the finding's deeper point holds: the success path (:387) calls `confirmStored(batchMaxDs)` inside its own `main.post` with **no** `drainIngestFailed` check, and `confirmStored` (:545-553) unconditionally advances the persisted `history_cursor_ds` monotonically forward. So on the main thread the runnables execute in order — "set failed=true (from N)" then "confirmStored(dsN+1max) (from N+1)" — and the persisted resume cursor lands past batch N's never-stored span. `@Volatile` alone would NOT fix this; the confirm-side check is required, exactly as the finding recommends.

**The hole is permanent on the automatic path, and the failure self-masks.** Batch N's frames were a local `ArrayList` copy (:340) — discarded on failure. The failure zeroes `lastDrainCompletedAt` (:384), so the keepalive (:216-230) re-drains within ≤5 min — but `startDrain(false)` resumes from the *persisted* cursor (:531-532), which is now past the hole, and resets `drainIngestFailed = false` (:529). The re-drain then completes cleanly, so the tester shows a subsequent successful drain: the incident is masked. `reqGetHistory(cursor)` only serves events ≥ cursor, so the skipped span is never re-requested. Recovery exists only via the manual Full re-sync (`fromZero=true`, :520-534; ops doc "loss-free and idempotent ... drains the ring's entire buffer from cursor 0") and only until the ring's finite buffer overwrites the span (ops doc R4: "The hard loss window. Oldest unsynced events are silently overwritten"; §"Honest limit": events overwritten before the first successful drain are permanently lost). Nothing prompts the user to run it — the only trace is a debug-screen log line.

**Second layer checked (refutation attempt).** The JS forwarding path in `components/oura-ble/oura-ble-debug.tsx:174-198` is correct — single `flushing.current` guard, ascending ds sort, splice-and-`confirmStored` only after `res.ok`, catch leaves the batch queued. But it is explicitly disabled on native-ingest APKs (:146 `if (!nativeIngest.current)` buffer gate; :175 flush gate), i.e. on every current build. The "fixed 2 layers" claim in projectOverview.md:4369 is therefore accurate for the JS layer and wrong for the native layer that actually runs.

**Single-user severity calibration.** A realistic transient failure (Railway deploy 502 window of ~20-60 s colliding with a multi-batch drain — the morning sleep drain is reliably multi-batch: the live BLE-1 confirmation cites 1,520+360+103+520 events, i.e. ~10 batches at ≤255 events/batch; or a 401 whose cookie refreshes when the owner opens the app during N+1's retry window) loses **one batch's span per incident** in the common case: ≤255 events ≈ tens of minutes to ~an hour of sleep-time IBI/HR/temp/SpO₂ samples. N+2 onward is *usually* gated once the flag lands (though the non-volatile read means even that is unguaranteed). So this is not the original "critical" BLE-1 (which lost structurally everything); "high" — not critical, not medium — is the right grade for a bounded, probabilistic-trigger, but silent, self-masking, invariant-violating, permanent-after-wrap loss in the pipeline the project's own ops doc calls its hard loss window. The recommended fix (check `drainIngestFailed` inside the success `main.post` before `confirmStored`, making write and read both main-thread) is correct, one line, and does eliminate both the ordering and visibility halves; it needs an owner APK rebuild since it is Kotlin-only.

**Not exercised:** static trace only — no APK, no ring, no reproduction of the 17-35 s outage timing. The interleaving is deterministic given the network condition; only the trigger is probabilistic.


# K4 Verdict — silent local-store init failure removes the outbox safety net

VERDICT: REAL (with corrections: mechanism misattributed, consequence understated, dup status partially wrong)
Revised severity: high (unchanged)
isDup: PARTIAL — the underlying data-loss mechanism is already tracked as backlog item 7 (R3 — Offline-first integrity), Chunk 4 Task 4.2 / SYNC-C3, `docs/superpowers/plans/2026-07-09-r3-offline-first-integrity.md:414-436`, still unimplemented (chunks 1–2 shipped per `docs/implementation-backlog.md:761-820`; `runSQL` is unchanged). The *surfacing* half (banner + `/api/client-error` report on init failure) is NOT tracked anywhere — Task 4.2's planned fix (make `runSQL` throw so write sites take the API fallback) fixes the loss, not the telemetry/visibility gap.

## Reasoning

**The core claim survives refutation, but K4's stated mechanism is wrong in a way that makes reality worse, not better.** K4 frames the native failure as `getLocalStore` returning null (`lib/local-store/index.ts:116-118`) so `store_?.queueMutation` no-ops. In fact `isSQLiteAvailable()` (`lib/sqlite/sqlite-service.ts:16-21`) checks only platform + plugin presence, never whether `open()` succeeded — so on a native device where init failed, `getLocalStore` returns a **non-null** store whose every operation routes through `runSQL`/`querySQL`, which silently resolve as no-ops when `_db === null` (`sqlite-service.ts:107-110, 116-118`). `queueMutation` (`lib/local-store/sqlite-backend.ts:1602-1608`) resolves successfully having written nothing. Same end state K4 described (outbox gone, no signal), different — and confirmed-in-code — path.

**Per-domain fallback trace (the severity hinge):**
- **Workout set logs** (`components/workout-screen.tsx:1079-1122`): the primary send is a direct POST to `/api/log-exercise` at :1104 regardless of store state, so **online, data is safe**. The outbox is only the POST-failure fallback (:1117, :1121) — with a dead store that fallback silently no-ops, so **offline/no-signal, the whole workout is lost after success feedback already fired** (:1127-1130). Exactly K4's gym scenario. CONFIRMED.
- **Food logs** (`lib/nutrition/log-food.ts:181-242`): local-first with an API fallback reached only via `if (!store)` (never true on native) or the catch at :239 (never fires — the dead store's writes *resolve*, they don't throw). So `logFoodEntries` returns optimistic success (:238) having written to nothing; `pushMutations` finds zero pending rows. **Food logs are lost even while fully ONLINE.** This is WORSE than K4 stated — K4's "data safe online via direct POST" framing only holds for the workout domain.
- **Body metrics** (`components/health/metric-log-sheet.tsx:57-124`): same shape — `upsertBodyMetric` + `queueMutation` no-op without throwing, `savedLocally = true` at :114, `toast.success` at :88, the `!savedLocally` API branch at :119-129 is skipped. **Lost while online, with a success toast.** The R3 plan's Task 4.2 text independently confirms this reading: "a write whose direct POST also failed is lost with no error" and notes the food/body/activity paths only take the API fallback on a *throw*.

**Signal check (K4's actual subject): CONFIRMED zero.** `components/sync-provider.tsx:92-97` — catch → `console.error` + `return`; caught locally, so `ErrorReporter`'s `unhandledrejection` listener never fires and nothing posts to `/api/client-error`. `sqlite-service.ts:70` — `console.error` only. No toast, no banner, no `error_events` row. Worse, the only diagnostics surface (`SyncHealthCard` → `getFailedMutations`) reads via `querySQL`, which returns `[]` on a dead store — the More tab would show a *healthy* sync card while the store is dead.

**One refutation point that partially lands — trigger likelihood.** K4 calls the trigger "the historically-proven migration-failure class (#27/#85)". That class is now largely self-healed inside `initSQLite` itself: `sqlite-service.ts:38-57` catches the versioned-upgrade failure, reopens at version 1 without running the upgrade, and `reconcileSchema` (:85-105) idempotently adds missing tables/columns. Reaching the outer catch (:67-74) now requires the v1 reopen to fail too (plugin-level failure, disk corruption, storage exhaustion) — rarer than the finding implies. This weakens the probability, not the severity-given-occurrence, and the device-smoke checklist (`docs/device-smoke-checklist.md:54`) checking for the `[initSQLite] failed` log line shows the project itself treats this failure as live enough to gate on — via a human reading logcat, which is precisely the absent surface.

**Net:** REAL at high severity. The consequence is broader than written (online data loss for food/body-metric domains, not just offline outbox loss), the mechanism line in the evidence should be corrected (non-null dead store via `isSQLiteAvailable`, not null store), and the dup field should be amended: the data-loss core duplicates pending backlog work (R3 Task 4.2 / SYNC-C3); only the surfacing recommendation (banner + client-error report) is genuinely untracked and remains the novel actionable part of K4.


# Verdict — F8

VERDICT: REAL — MERGED(with E2-1); F8 is the umbrella, E2-1 is its sub-claim (a). Cross-reference E2-12 as a fifth surface of the same class (keep it listed, fold its fix into the same work item).

Revised severity: **high (sustained, with one precision caveat)**. E2-1's "medium" was correct for the signals-only slice; the aggregate — four AI surfaces simultaneously blind to the one readiness number the user actually sees — justifies high for a product whose core loop is AI autoregulation. Caveat that must survive into the final report: the "rest-day trigger can never fire" claim is true of the `external_readiness < 40` **arm specifically**, not of rest-day recommendations overall — the other arms (sleep_score_trend, hrv_trend, spo2_trend, temp_z, illness radar) read live BLE-derived sources (shipped in item 20/S7), and the dead composite is itself built from those same z-components, so much of the underlying signal still reaches the prescribe engine through parallel channels. F8's wording is precise on this ("trigger", not "rest days"); the failure scenario's "the exact autoregulation signal … is invisible to all four AI layers" slightly oversells — the *composite* is invisible, its *components* mostly are not. Do not downgrade for it, but do not let the summary imply the engine is recovery-blind.

## Verification (every sub-claim re-traced to source)

- **Premise (structurally dead)**: `app/api/readiness-score/route.ts:280-285` states the invariant ("the wear-time writer is the only live oura_daily writer"; Cloud froze at the 2026-07-07 re-key), and :293-304 / :377-387 compute `ownComposite` and persist it to `oura_daily_derived` (`readinessScore`, `readinessSource: 'ble-derived'`). Only `oura_daily.readiness_score` writers are the frozen Cloud sync/webhook (`app/api/oura/sync`, `app/api/oura/webhook`); CLAUDE.md's Oura-BLE section makes "Cloud gets no new data, ever" a hard invariant. Premise holds.
- **(a) prescribe/signals**: `lib/ai-periodization/signals.ts:460-462` — `externalReadiness: await repo.getOuraDaily(userId, today, today).then(rows => rows[0]?.readinessScore ?? null)` — structurally always null. Rest-day arm `external_readiness < 40` at `lib/ai-periodization/prompt.ts:157-166` (the literal `< 40` at :159) is dead code. Identical to E2-1 (`E2-ai-engine.md` lines 10-16), whose recommendation (read `derivedRows` already fetched at signals.ts:143) is the right fix. **Same issue — merge.**
- **(b) chat**: `app/api/ai-chat/route.ts:68-83` fetches `ouraRows` via `repo.getOuraDaily` (:71) and passes them to `buildRecoverySummary`; `lib/ai-chat/context.ts:96-102` builds the "Today:" line only from `ouraToday.readinessScore/sleepScore/activityScore` → renders `'Today: no Oura data'` daily (and the 7-day readiness avg at :122-126 is equally dead). The route *does* fetch `derivedRows` (:75) but uses them only for illness. `lib/ai-chat/tools.ts:53-79` — `getRecoveryData` maps derived rows to illness + daytime stress only; derived `readiness_score`/`resilience` never exposed (the tool description at :47 does honestly warn "Cloud-era fields end 2026-07-07", a partial mitigation F8 doesn't mention).
- **(c) weekly digest**: `app/api/weekly-digest/route.ts:137-145` — `readinessOf` filters `ouraRows` (Cloud) for `readinessScore != null` → `readinessLine` is null every week post-re-key. The route already holds `derivedRows` (used for illness :148, stress :159-167), so the fix is a one-line source swap.
- **(d) health-insight**: `app/api/ai/health-insight/route.ts:62-63, 70-92` — readiness card reads `todayOura.readinessScore` with fallback to the *last frozen row* (:70) and prints "Past week scores" from frozen `ouraRows` (:92). Mitigated by the `staleNote` annotation (:74-76) — the model is told the data is frozen — but the card still narrates a pre-07-07 score instead of the derived composite the Health screen displays. F8 characterizes this fairly ("at least annotates").

## isDup: NO (class-adjacent tracking only; the AI read-path scope is genuinely untracked)

- **data-eff review §1.1** ("oura_daily_derived write-only"): tracked the *generic* no-reader state; its remediation graduated as **item 3a (S1+S2+S6, shipped v1.158.1)** which fixed *display* read-paths only (trends sparklines, Body Battery anchor, sleep contributors). No AI surface enumerated anywhere in §1.1 or item 3a.
- **§2.4 (AI periodization inconsistencies → item 20/S7, shipped)**: lists temp deviation, sleep-duration-only trend, SpO₂, mood — **readiness is absent from the list**. The S7 plan (`docs/superpowers/plans/2026-07-16-ai-signal-consistency.md`) touches `externalReadiness` only as a `null` test-fixture value (:295, :302, :428) — it explicitly did not change the source. So "item 20 covers it" is false.
- **§3.3 (frozen-Cloud reads → item 21/S8+S10 display honesty, shipped)**: names chat-context/health-insight **temp deviation** and display chrome, not the readiness reads in signals.ts / weekly-digest / chat context; and its remedy was *annotation*, not source substitution (the staleNote and "pre-re-key" labels now in the code are its output).
- **item 22/S9** (shipped): F8's own dup line calls this "S9 dual-readiness consolidation" — **inaccurate**: per `planned_upgrades.md:133,159` and the backlog, S9 = *metric label consolidation* ("one canonical source + label per displayed metric"), display-scoped. Correct F8's dup wording in the merged item.
- Conclusion: the class ("derived table exists, X still reads frozen Cloud") is a known pattern with shipped display-side fixes, but **no tracked item names any of the four AI read sites**, and E2-1's independent dup check reached the same conclusion. Under the repo's "no orphaned findings" rule this needs its own backlog entry.

## Merged item shape (recommendation)
One read-side PR: source readiness from `oura_daily_derived.readiness_score` (Cloud as pre-re-key fallback) in (1) `signals.ts:460` [E2-1's fix], (2) `buildRecoverySummary` + `getRecoveryData` derived mapping, (3) `weekly-digest readinessOf`, (4) health-insight readiness card, plus (5) E2-12's next-session deload recommender. All five call sites already fetch or are one repo call from the derived rows.


# Verdicts — C-1, C-2 (adversarial verification)

## C-1 — full-history rollup (unbounded reads, per-row decode, per-night ONNX)
- **VERDICT: REAL — MERGED(with H-2)**
- Revised severity: **high** for the merged item (raise H-2's medium; C-1's quantification justifies it — but note the "high" is trajectory + silent-failure cliff, not a today-outage)
- isDup: **yes** — H-2 (`H-retention.md` H-2) is the same mechanism: unbounded `rowsByTags` read + in-memory hex decode, fired per biometric ingest batch. C-1 is the fuller writeup (adds the O(nights×rows) window filters, per-night SleepNet, steps re-pair, serial illness upserts); keep C-1's evidence as the canonical body under one merged finding.

**Reasoning / quantified bound.** Every load-bearing claim in C-1 survives adversarial re-reading. `adapter.ts:3989-3998`: `rowsByTags` filters only `(user_id, tag IN …)` — no `ring_timestamp_ds` bound — and line 3996 decodes `body_hex` in JS for every row whose `decoded` is null, which post-Lever-1 is *all* rows: `insertOuraRawSamples` explicitly stores `decoded: null` (`adapter.ts:3898`), so the coalesce path is dead for new data. All 10 tag-group reads (`adapter.ts:4000-4011`) plus the steps re-fetch of 0x7e/0x7f (`adapter.ts:4508-4512`) are full-history; I checked each step for a hidden bound and found exactly three bounded pieces — the hr_series *write* filter (14d, `adapter.ts:4557-4558, 4590-4596` — the read is still full-table), the workout-windows DB query (14d, `adapter.ts:4569`), and the resilience loop (`RESILIENCE_MAX_DAYS = 21`, `adapter.ts:4728-4729`). The night loop (`adapter.ts:4085`) iterates every window since capture began with `inWindow` linear scans (`adapter.ts:4108-4109`) called ~8-10× per window over the full tag arrays. ONNX re-inference is genuinely ungated: the Ring 5 emits no phase events, so `phases.length === 0` on every night (`adapter.ts:4215`), and `sleepNetStages5Min` runs per night per invocation (`adapter.ts:4288-4290`) — there is no dirty-day/new-night check anywhere in the function; only the *model session* is cached (`lib/oura-models/inference/session.ts:14-25`), not the inference. The dHRV claim also holds: `buildDaytimeStressSeries` awaits one `computeDaytimeStress` (ONNX `runDhrvImputation`) per 30-min bucket (`lib/health/daytime-stress.ts:220-229`), ≤ 21×48 ≈ 1,000 micro-inferences/run (today realistically ~300-500 — only HR-carrying buckets score). One extra cost C-1 missed: the resilience step expands *full-history* IBI+aohr into per-beat `{tsMs,bpm}` objects and sorts them (`adapter.ts:4715-4718`) — likely the largest single allocation in the function.

**Numbers (single user):** 306,948 rows at 2026-07-15 over ~8 days of capture ⇒ ~38k rows/day ⇒ **~455k rows today (2026-07-19)**, ~12 nights of SleepNet inference per run (+1/day forever), ~11 serial illness upserts per run (`adapter.ts:4676-4685`, N−1 round-trips), whole-summary rewrite per run (`adapter.ts:4670`). Estimated per-run cost: tens of MB of DB transfer (10 parallel reads over a ~229 MB+ table), ~450k hex decodes, ~12 SleepNet nights, ~10-15s plausible wall clock at current scale (unmeasured — same caveat as the finding). The real cliff: `statement_timeout: 15_000` (`lib/data/postgres/client.ts:25`) — when the dominant IBI read crosses 15s (~1M+ rows, plausibly ~Sep-Oct 2026 at 38k/day), every rollup fails *silently* (caught at `route.ts:79-84`, ingest still 2xx, error only in the POST response/log) and BLE-derived sleep/HRV/RHR/steps stop updating entirely. No data loss ever (raw rows durable; Redecode replays), which is why this isn't critical.

## C-2 — rollup fires once per 255-event batch; 0x50 missing from trigger set
- **VERDICT: REAL — DOWNGRADED (high → medium)**
- Revised severity: **medium**
- isDup: **partial** — the per-batch invocation is already stated inside H-2's evidence ("invoked on every samples POST … many times per nightly drain"), but H-2's recommendation covers only the per-run cutoff; C-2's debounce fix and the 0x50 trigger gap are untracked. Fold into the same merged H-2/C-1 item as a second, independent fix lever.

**Reasoning / quantified bound.** Mechanism verified: `app/api/oura-ble/samples/route.ts:70-85` — no throttle, debounce, or coalescing anywhere; the rollup is awaited inline per POST whenever the batch carries a `BIOMETRIC_TAGS` member, and since IBI (0x80/0x60) dominates the stream, essentially every drain batch triggers it. Batch math: 255 events/GetHistory, one POST per batch, serial single-threaded (ops doc §2 table, "one POST per batch, in-order") ⇒ ~150 rollups/day at 38k rows/day under the hourly-drain cadence, and a morning catch-up drain of an overnight backlog ≈ 60-100 serial full rollups — the "dozens" claim is if anything conservative. **One correction that drives the downgrade:** the finding's "the whole drain throughput is gated on N× full-history recompute" overstates it — per the ops doc the in-memory `drainCursor` is *decoupled* and the BLE pull continues while POSTs confirm asynchronously; only the durable-confirm queue serializes, and re-sends are loss-free. So the user-facing effect is a minutes-scale freshness lag on the morning drain (night's data lands near drain end) plus sustained Railway CPU/DB cost — pure server cost + mild latency, nothing breaks and nothing is lost today. Under the routine hourly cadence the multiplier is only ~6-8×/hour, not dozens. The **0x50 gap is confirmed**: `route.ts:70` lists {0x76,0x4b,0x4e,0x5a,0x5d,0x80,0x60,0x6f,0x8b,0x86,0x46,0x69,0x72,0x75,0x7e,0x7f} — no 0x50 — while the rollup fetches it (`adapter.ts:4010`) and feeds MET gates/`metAvg`/resilience from it, and 0x50 IS stored (not in `RAW_STORAGE_DROP_TAGS`, `lib/oura-ble/raw-storage.ts:10-21`, whose own comment lists 0x50 as rollup-consumed). Bounding the staleness face: a *pure*-0x50 batch is uncommon (temp 0x46/0x69 and aohr 0x86 ride the same stream and are in the set), so it's a real but low-frequency inconsistency — a one-token fix, correctness side already raised by the G reviewer.

**Combined note for the merger:** the two fixes are independent and multiplicative — the ds cutoff (H-2/C-1) shrinks per-run cost from O(full history) to O(35d); the debounce (C-2) shrinks runs-per-drain from N to 1. Either alone defers the 15s-timeout cliff; both together make the pipeline flat-cost.


# Verdicts — J-1, J-8, J-9 (adversarial verification)

## J-8 — /api/zone-minutes returns days:[] on every real client request
- **VERDICT: REAL**
- **Revised severity: high (upheld)**
- **isDup: no**
- Mechanism claim VERIFIED, not just the symptom:
  - `lib/date-utils.ts:90-101` — `normalizeDateParam` returns `YYYY/MM/DD` (slash form), confirmed in source.
  - `app/api/zone-minutes/route.ts:22-24` — assigns the slash output to `from`/`to` with no `.replace(/\//g,'-')` (contrast `app/api/day-timeline/route.ts:69`, which converts back).
  - `lib/data/postgres/slices/oura.ts:449-461` — `eachDay` does `fromDay.split('-')` → `Number('2026/07/12')` = NaN → `Date.UTC(NaN,…)` = NaN → `while (NaN <= NaN)` never iterates → `getZoneMinutesRange` returns `[]`. Confirmed exactly as claimed.
  - Additional mechanism the finding missed (same conclusion, more damage): the cache pre-select at `oura.ts:470-474` (`gte/lte(day, …)`) and the route's `listBodyMetrics(userId, from, today)` at `route.ts:30` also compare slash strings against dash-stored day columns — `'2026/…' > '2026-…'` in byte order, so both return nothing; `restingHr` silently defaults to 60. Moot while `days` is `[]`, but the fix must convert *both* params.
- **Per-workout ZoneBreakdown surface: NOT affected.** `components/health/zone-breakdown.tsx` is a pure client-side component computing from `readings` props. Its two consumers fetch readings via `components/workout/done-screen.tsx:172` (`/api/oura/hr-data?sessionId=…` — no date param) and `components/activity/activity-detail-sheet.tsx:46-51` (`/api/oura/hr-window?date=…` — that route does not use `normalizeDateParam`; grep of `app/api` confirms only day-log, day-timeline, hr-day, workout-sessions/day, running-plan, training-stress and zone-minutes import it). Only the day/week/month Time-in-Zone card (`components/health/time-in-zone-card.tsx:57-61`, the route's sole caller) is dead.
- **Feature-dead since ship: YES.** Shipped v1.164.0 (2026-07-17). The only client always sends both `from`/`to` in dash form (`todayInTz()`/`shiftDateStr`), so every real request goes through normalize → slash → `[]`. The dash-form default path only executes when a param is *absent* — no code path ever does that except a hand-written no-param curl (which is exactly how it passed its smoke test; the plan doc's own smoke command used `?from=…&to=…` dash params against a route, so either it was never run as written or the empty `days` went unnoticed). Corollary: `daily_zone_minutes` has never been populated by any client traffic in prod — the eachDay loop dies before the compute/cache step (relevant to J-1 below).

## J-9 — /api/training-stress 500s on every client call; OTS never persisted
- **VERDICT: REAL — REAL 500 in prod; permanently-gated (silently dead) in the no-anchor case. Not refuted, and not a silently-wrong-window: the route can never emit a wrong number, it just never emits one.**
- **Revised severity: high (upheld)**
- **isDup: no**
- The orchestrator's V8 counterpoint does not apply: `new Date('2026/07/18')` parses in V8, but the code never calls that. It calls `dateStrMidnightInTz('2026/07/19', tz)` = `fromZonedTime('2026/07/19T00:00:00', tz)` (`lib/date-utils.ts:74-76`). **Empirically executed against the pinned date-fns-tz 3.2.0 in this repo's node_modules: `fromZonedTime('2026/07/19T00:00:00', 'Australia/Brisbane')` → `Invalid Date`.** (Incidentally `new Date('2026/07/19T00:00:00')` is *also* Invalid in V8 — slash form only parses without the `T` suffix — so even the fallback intuition fails for this exact string.)
- Failure location verified end-to-end:
  - `app/api/training-stress/route.ts:22` — both clients always send dash `?date=` (`components/health/training-stress-line.tsx:19-21` uses `todayInTz()`; `components/workout/training-stress-badge.tsx:18-19` receives `date={todayInTz()}` from `done-screen.tsx:398`) → `date` is always slash form.
  - `route.ts:29-30` — `dayStart` = Invalid Date, `dayEnd` = NaN date.
  - `lib/data/postgres/adapter.ts:3760-3777` — with a clock anchor present, `startDs`/`endDs` = `Math.floor/ceil(dsFromMeasuredAtMs(NaN,…))` = NaN, fed to `gte/lte` on the bigint `ring_timestamp_ds` column. **Empirically executed against the local Postgres: a NaN numeric param errors with `invalid input syntax for type bigint: "NaN"`.** The rejected promise is inside `Promise.all` (`route.ts:32-38`); the route has no try/catch → Next.js 500. 
  - Why the dev probe saw `gated/no_readiness` instead: the seeded dev DB has no `oura_ble_clock_anchors` row, so `adapter.ts:3765` early-returns `{temp:[],met:[]}` before the NaN ever reaches SQL — exactly the escape hatch the finding already identified. The probe does NOT contradict the finding; it confirms the anchor-gated branch. In prod the anchor necessarily exists (the entire BLE pipeline since 2026-07-07 depends on the ds↔UTC anchor to timestamp every sample), so the S25 owner hits the 500 path.
  - **Even in the no-anchor counterfactual the feature is still structurally dead** — a point the finding under-claimed: `getOuraDailyDerived/getOuraDailySummary/listBodyMetrics(userId, '2026/07/19', …)` all compare the slash string against dash-keyed day columns (writers: `app/api/readiness-score/route.ts:379,399` key by summary/sleep dash dates), so `readiness` is null *forever* regardless of how much BLE-derived readiness exists → permanently `gated: no_readiness` → the `status==='ok'` persist at `route.ts:74-83` is unreachable either way. Fixing only the NaN/`dateStrMidnightInTz` half would NOT revive the feature; the fix must dash-normalize `date` itself (the finding's recommendation is correct).
- Finding's interplay note (invalidates the "not device-verified e2e" KI row's ok-path assumption) stands.

## J-1 — daily_zone_minutes compute-once-forever; late-arriving BLE HR permanently under-counts
- **VERDICT: MERGED (mechanism REAL) — merge with C-5 (and fold in J-2 + H-4): one cache, one fix**
- **Revised severity: medium (down from high)**
- **isDup: yes — C-5 (C-performance.md:55-65) covers the identical compute-once + late-HR mechanism *plus* the profile-drift half (which is J-2, and H-4's profile-change case). Recommend C-5 as the canonical finding absorbing J-1/J-2/H-4.**
- Mechanism verified in code:
  - `lib/data/postgres/slices/oura.ts:478-497` — `if (row && day !== today)` serves the cached row for any past day; compute happens only when the row is missing. "Today" IS always recomputed (and never cached — the `day !== today` guard on the upsert), so the freeze applies to past days only, exactly as claimed. The migration/route "reconcile-on-read" comments oversell it: reconcile = fill-missing, never re-verify.
  - Grep confirms the table's only writer is `oura.ts:492` and only deleters are tests (`lib/data/postgres/__tests__/zone-minutes-range.test.ts`) — no invalidation path exists; `lib/cache-groups.ts:34,154,191` invalidate only the *client* `zone-minutes:` key, not the server rows.
  - Corroboration that strengthens the mechanism (from C-5, verified here): the BLE ingest rollup **delete-and-reinserts** `source='ble'` `oura_heartrate` rows from a trailing cutoff on every rollup (`adapter.ts:4603-4611`), so past-day HR is routinely rewritten while the zone row stays frozen — this is not just an edge-case race.
- Why downgraded to medium as an independent item:
  1. **Currently latent in prod because of J-8**: the route is the table's only production writer, and the slash-date bug makes `eachDay` return `[]` before any compute/cache — so no poisoned rows can exist yet. J-1 only goes live the moment J-8 is fixed (which is precisely why the two fixes must ship together — fixing J-8 alone arms J-1).
  2. Drain cadence bounds the miss window: with hourly drains + overnight backfill, most past days have complete HR by their first post-midnight read. The real exposure is pre-drain early-morning reads, multi-day phone-away gaps, and decoder-fix redecode backfills (which can never propagate into frozen rows — the one genuinely permanent case).
- Fix shape (agreeing with C-5's): recompute any cached day still inside the BLE HR-rewrite window (or have the rollup delete `daily_zone_minutes` rows for days whose HR it rewrote), and stamp the profile on the row for the J-2/H-4 half. One PR, alongside the J-8 date fix.


# F1 verdict — chat body-weight regex auto-log

VERDICT: DOWNGRADED
Revised severity: medium (was high)
isDup: no

## Reasoning

**Verified true (core mechanism).** `app/api/ai-chat/route.ts:88-101` is exactly as claimed: pre-LLM, before any model call, `isBodyWeightLog` fires on `/\b(?:log|record|save|update)\b.*\bweight\b|\bweight\b.*\b(?:log|record|save|update)\b|\bmy\s+(?:body\s+)?weight\s+(?:is|today|as)\b/i` (line 89) OR on any `N kg` token when `sessionType === "Overview"` (line 90); the value written is the **first** `(\d+(?:\.\d+)?)\s*kg` match anywhere in the prompt (line 91), gated only by the 20-500 kg clamp (`lib/validation/body-metrics.ts:7-12`). The write at line 96 is `repo.upsertBodyMetrics(userId, [{date: todayIso, weightKg}], 'manual')` — and the provenance claim holds precisely: `lib/data/health-source.ts:19-24` ranks `manual`=4 (highest), and `mergeSet` (health-source.ts:55-72) lets a strictly-lower source (Health Connect=1, which *does* carry `weightKg` per `app/api/health-connect/ingest/route.ts:19`) only fill NULLs, never overwrite. So a false log blocks the smart-scale/HC value for that day until the user manually re-logs (equal-rank newer-wins is the only correction path). There is **no confirmation before the write and no undo**; `components/chat.tsx` contains zero cache invalidation, so even correct logs paint stale on Health (verified: no `invalidate` in the file). Failure scenarios (b) and (c) are live on every tab: "what weight should I log for squats? last set was 100kg" matches the `weight…log` alternation and logs 100 kg as body weight; "log my weight — I benched 100kg, I'm at 92kg" logs 100 (first match). Untracked anywhere: no entry in `docs/implementation-backlog.md`, no projectOverview Known-Issues row, no review dup (batch-d only added the 20-500 clamp as mitigation, `docs/superpowers/plans/archive/2026-07-01-batch-d-security-hardening.md:1064`). isDup: no.

**Refuted / overstated (the part that drove "high").** The headline claim — "on the Overview tab ANY kg mention logs body weight" — is **dead code in live builds**. The Overview tab does not set `ta_session=Overview`: `components/overview-screen.tsx:197` sets the cookie to `previewSession.name` (and only on Start Workout). A repo-wide grep finds **no live setter** of `ta_session=Overview` — the setters are session names (`app/session-select/session-select-content.tsx:847`, `app/workout-select/workout-select-content.tsx:238`) and the literal "AI Analysis" (`components/ai-chat-overlay.tsx:80`); the old `ta_session=Overview` line was deliberately deleted per `docs/superpowers/plans/2026-07-01-batch-e-ai-usage.md:1325`, and the cookie's 7-day max-age means stale values expired by ~2026-07-08. The branch can only arm if the user names a program session literally "Overview" (F10's hygiene note). So the task's canary sentences do NOT log: "I benched 80 kg" has no intent+weight words and no live Overview branch; "ate 2 kg of rice" additionally fails the 20 kg floor. "Silent" is also overstated: `writeContext` appends "Completed: Body weight Xkg logged" to the user turn and the system prompt (route.ts:143) tells the model to confirm — the log is normally announced in the reply (though after the fact, and lost if the stream errors).

**Real-severity judgment (single user).** The live trigger needs an intent word + "weight" + a kg number in one message — plausible in this user's chat (target-weight questions with kg numbers are the app's bread and butter), so an occasional false positive over months is likely, and the first-match extraction makes mixed messages actively wrong. Downstream, one bad manual weight for today feeds the body-comp/Cunningham-BMR derivation into `oura_daily_derived.body_comp`, the weight-rate trend slope, and any nutrition-goal baseline computed that day, and blocks the HC scale value for the date — but it is visible (announced in chat, shown on Health), single-day, and correctable by a manual re-log. That is a real, untracked, medium bug — not the "any kg mention silently poisons health data" high the finding painted. The fix recommendation (LLM write tool or adjacency requirement + delete the dead Overview branch + client invalidation) stands.


# E2-9 verdict — HRR1 structurally null in the Resting HR + Recovery fitness test

VERDICT: REAL (mechanism fully confirmed) — DOWNGRADED
Revised severity: medium (from high)
isDup: no

## Reasoning

The core claim survives every refutation attempt; the severity does not.

**Mechanism confirmed, line by line.** `components/fitness-tests/test-active.tsx:44-53` — `finish()` builds the capture with `endMs: Date.now()` at the Finish tap and passes `hrSamples: hrRef.current`. Sampling stops at that same instant: `onFinish` runs `setCapture(c); finish()` in `fitness-tests-content.tsx:51`, flipping the store mode to `'done'`, which unmounts `TestActive` in the same batched render and fires the effect cleanup at `test-active.tsx:61` (`unsub(); mgr.stop()`). The manager (`lib/live-hr/manager.ts:63-66`) has no replay buffer and `unsub` removes the callback, so even if another consumer kept the singleton running, nothing pushes into `hrRef.current` after unmount — there is **no post-test sampling continuation**; every reading has `at ≤ endMs` (+ at most a few ms of pre-unmount race). `test-result.tsx:41-42` then anchors `recoveryStart = new Date(capture.endMs)` and calls `baselineHrr1`, which delegates to `analyseHrRecovery` (`lib/health/fitness-tests.ts:38-43` → `lib/workout/hr-analysis.ts:64-66`): `bpm60 = nearestBpm(readings, endMs + 60_000, 45_000)` requires a sample at ≥ endMs + 15 s. No such sample can exist → `bpm60 = null` → `hrr1 = null`, deterministically, on every device. The green unit test (`lib/health/__tests__/fitness-tests.test.ts:18-25`) only passes because its synthetic readings extend 60 s past `recoveryStart` — exactly the data shape the real flow can never produce. The secondary claim also holds: per the protocol text ("Rest 1 min, do 1 min of hard effort, then rest", `lib/fitness-tests/protocols.ts:49`), the recovery minute is *inside* the capture, so `endMs` (the post-rest Finish tap) is the wrong anchor even in principle; there is no user-behaviour interpretation (e.g. tapping Finish at end-of-effort) that yields non-null, since sampling stops at the tap regardless.

**Scope check — 6MWT/Cooper unaffected by design.** Both have `captureHrr: false` (`protocols.ts:30,41`), so `test-result.tsx:38` never computes HRR1 for them; their null `hrr1Bpm` is intentional. The finding correctly scopes to `resting_hrr` only.

**Why downgraded to medium.** What lands is `hrr1Bpm: null` in the `fitness_tests` row (`test-result.tsx:66,80`), and I traced every consumer of that column: the result-screen headline ("—", `test-result.tsx:49`), the trend delta vs previous test (`:51-53`), `test-select.tsx:46`, and `latest-baseline-card.tsx:55` — **all display-only**. The running-engine fitness snapshot reads only `vo2maxEst`/`maxHr` (`app/api/running-plan/route.ts:122-124`), the recovery gate never reads HRR, and the health-trends `hrr1Bpm` sparkline (`app/api/health/trends/route.ts:69-102`) is independently re-derived from workout-session HR windows, not from fitness-test rows. So no training decision, gate, or stored aggregate consumes the null — the failure is a visibly-dead metric ("—" every run), not a silently-wrong number. By the audit's own scale (E2-10, which *poisons* downstream VO2max for 90 days, is rated medium), a loud-null display-only failure cannot sit above it. It remains a real, statically-provable bug that makes one of three shipped protocols permanently unable to deliver its headline purpose (the `restingHr` min-bpm secondary stat still works), hence medium, not low.

**Dup check confirmed — not a dup.** The Known-Issues row "Cardio Baseline Fitness Tests (v1.166.0) — shipped, on-device flow NOT verified" (`projectOverview.md:3842-3848`) tracks sandbox-unverifiable surfaces: live HR sources (APK-only), GPS fix, native SQLite, safe-area. E2-9 is a logic bug in the recovery-anchor math, provable without a device, and would persist after every item in that KI row is verified. Distinct finding; the fix direction (anchor at peak-HR timestamp within the capture, compute HRR1 from the in-capture post-effort minute) is sound.


# K2 Verdict — cachedFetch swallows HTTP failures / workout-screen infinite skeleton / dead toast

VERDICT: DOWNGRADED
Revised severity: medium (was high)
isDup: partial — the *mechanism* is already documented project knowledge; the *workout-screen instance* is untracked

## Mechanism claims: CONFIRMED, could not refute

- `lib/sqlite/cache.ts:237-256` — the inner `fetchPromise` is `(async () => { try { const res = await fetch(url); if (!res.ok) return; ... } catch { /* Network unavailable */ } finally { ... } })()`. Every failure mode (HTTP !ok including 500/429/401, network throw, JSON parse throw) is absorbed; `onData` (line 242) fires only on a fully successful `res.ok` + `res.json()`. The outer awaits at `cache.ts:229` and `cache.ts:259-263` therefore always resolve — `cachedFetch`/`cachedFetchToday` never reject. Verified by node simulation of the exact promise shape (resolves; outer catch unreachable).
- `components/workout-screen.tsx:333-369` — the `try { await cachedFetch(...) }` block's `catch` at :366-368 (`toast.error("Could not load workout data")` + `setLoading(false)`) is dead code: the awaited promise cannot reject. Nothing after the await clears `loading` either (the boolean return value is ignored), so on a cache miss `setLoading(false)` is reachable only via `onData` (:363) or the `sessionNotFound` branch (:349) — neither fires on a failed fetch. `loading` then stays `true` for the life of the mount and `components/workout/pre-workout-screen.tsx:199-203` renders the pulse skeleton indefinitely. Aggravator the finding missed: the header refresh button is `disabled={loading}` (`pre-workout-screen.tsx:156`), so the one retry affordance on the screen is deliberately disabled in exactly the stuck state.
- Crucially, the project itself already proved this class at runtime: session 286 (`docs/overview/history-newer.md:22-57`) forced real 500s with Playwright and observed `trends-section.tsx` "permanently stuck on the pulsing skeleton" because `setLoading(false)` lived only in `onData` — the identical shape to workout-screen's load path. So the failure mode is not hypothetical; it was reproduced live on a sibling surface.

## Why DOWNGRADED, not REAL-high: the skeleton needs a triple conjunction on the canonical runtime

The finding's "fresh cache + server error → skeleton forever" is correct but understates the seed/fallback layering, which makes the trigger rare on the S25:

1. **Cache is very rarely cold.** `readCacheSync` (`cache.ts:11-19`) falls back from sessionStorage to localStorage, and `setCached` (`cache.ts:102-108`) floors the localStorage seed TTL to the 7-day offline floor — seeds survive APK kills. The screen additionally cross-seeds from `workout-card:<sessionType>` (`workout-screen.tsx:293-295`), which home/session-select prefetch before the screen is ever opened. Cold = fresh install, More-tab cache wipe, post-`invalidateProgramStructure` (config save), or a never-opened session/AI-deload key (deload skips the card seed, :293).
2. **On the APK, the local-store fallback usually paints anyway.** `workout-screen.tsx:315-329` hydrates from `getActiveProgramLocal()` and even falls back to `sessions[0]`, calling `setLoading(false)` at :327. On the canonical runtime this only fails when the local mirror is empty (first run before first sync) or the local DB is dead (the K4 class — which HAS happened twice historically, so this leg is not fanciful).
3. **Server must be persistently failing** (500/429/401) while online.

So the true hang condition on-device is: (cold cache) AND (no usable local mirror) AND (server failing). Realistic paths exist — notably fresh install during an outage, and the nasty one: the user wipes cache from More *because* things already look broken, then opens workout — but they are conjunctions, not the everyday "first open of a newly added session" the finding implies (a new session on-device still has the local mirror). On web (`pnpm dev`), where `getLocalStore` is always null, the hang is one condition away — but web is explicitly the non-canonical dev surface.

Also overstated: "the user's only move is to force-kill the app." Navigating back and re-entering remounts the screen and re-fires `fetchExercises` (`workout-screen.tsx:400`), so back-nav retries without a force-kill. The stuck state is per-mount, permanent only while the server keeps failing.

## Dup status: partial

- The never-reject behavior is a **documented "load-bearing discovery"** — `docs/overview/history-newer.md:22-36` (session 286) states verbatim that a `.catch(() => setError(true))` on `cachedFetch` "is therefore dead code that can never fire," and the backlog (`docs/implementation-backlog.md:825`) already refers to "the established 'never reject' pattern rather than a dead `.catch()`." K2's claim of novelty for the mechanism is wrong.
- The self-fetching-card sweep (health-tab-overhaul Task 6.1, session 286) shipped the `.finally()`-driven-loading fix — but only for `components/health/*` / `app/health/**`. **No backlog entry, plan, or Known-Issues row covers `workout-screen.tsx`'s load path** (grep of `docs/implementation-backlog.md` for workout-screen/skeleton/stuck confirms), so the specific violation on the app's highest-value screen is genuinely untracked and per the "no orphaned findings" rule deserves a backlog entry.
- K9 overlap: K2's "60+ dead `.catch` sites" generalization is really K9's territory (and partially shipped for health cards); K2 should be scoped to the workout-screen instance only.
- Recommendation note: K2's proposed fix (extend `cachedFetchCore` with an outcome signal) contradicts the codebase's established, cheaper pattern — `.finally()`/settle-based loading + the returned cache-hit boolean. `await cachedFetch(...)` always settles; a `painted` flag + `setLoading(false)` after the await + an error/retry branch (and un-disabling the refresh button in the error state) fixes the screen with no cache-layer change.

## Bottom line

The static claims (swallow, never-reject, dead toast, skeleton-with-no-exit) are all true and independently corroborated by the project's own runtime experiment on a sibling component. But the severity was graded as if cold cache were common; on the only supported runtime the hang needs cold cache + dead/empty local mirror + persistent server failure, and back-nav retries. That is a real but low-frequency hard-UX failure on the primary screen → medium, with a note that the fix is ~10 lines using the already-established never-reject pattern, and that the finding should be filed as untracked despite the mechanism being known.


# K3 verdict — dead-lettered outbox mutations produce zero signal at failure time

VERDICT: REAL (core claim fully verified) — severity DOWNGRADED
Revised severity: medium (was high)
isDup: no (partial overlap only: the projectOverview.md:4609-4617 "Offline-sync protocol hardening (Batch A, v1.76.0)" KI row tracks *device-verification of the dead-letter mechanism*, and the shipped "item 13" outbox-depth card covers *depth display*; nothing in projectOverview.md or docs/implementation-backlog.md tracks notify-at-failure-time — grep for dead-letter/outbox/notify/badge across both files found no such row)

## Verified claims (all file:line checked against current tree)

1. **Quarantine is signal-free.** `lib/local-store/sqlite-backend.ts:1630-1646` — `recordMutationFailures` flips `status='failed'` when `attempts >= MAX_MUTATION_ATTEMPTS` (5, `lib/local-store/sync-helpers.ts:37`; backoff 30s/2m/8m/32m → the "~42 min" claim is arithmetically right) and returns void. No callback, event, or toast. Both call sites in `lib/local-store/sync-engine.ts` (the envelope-4xx chunk quarantine at ~:545-547 and the per-item rejection path at ~:566-568) are `.catch(() => {})`-wrapped. Confirmed.
2. **Sole surface is the More-tab card, mount-refresh only.** `getFailedMutations` has exactly one UI consumer (grep-verified): `components/more/sync-health-card.tsx:37`, mounted only at `app/more/more-content.tsx:165`, refreshed only in a mount effect (`sync-health-card.tsx:44` — no resume/visibility listener). Confirmed, including the claimed file:lines.
3. **No toast at failure time anywhere.** All ~30 `pushMutations` call sites are fire-and-forget `.catch(() => {})`; the only sync-failure toasts in the tree are Oura Cloud sync (`health-content.tsx:472`, `more-content.tsx:123`) and the SyncHealthCard's own manual-Retry toasts. Confirmed.
4. **The "no badge" claim needs one nuance but survives.** The More tab *does* have a badge dot (`components/shell/bottom-nav.tsx:26-38,109-111`) — but it is admin-only and fed exclusively by `/api/admin/pending-count` = `countInactiveUsers() + countFeedback()` (`app/api/admin/pending-count/route.ts:13-15`). Failed local mutations are on-device SQLite; the server can't count them and nothing client-side feeds the badge. So: badge infrastructure exists (making the fix cheap), but no badge reflects dead-letters. Substantively confirmed.
5. **No server-side trace either.** Per-item rejections return in `result.errors` from `repo.pushMutations` (`adapter.ts:3539` console.error only); `reportServerError` fires only when `pushMutations` *throws* (`app/api/sync/push/route.ts:54`). So a dead-lettering validation rejection leaves no `error_events` row — the admin Errors tab stays green too.

## The one refuted piece: the D-1 combination argument

The verifier brief's premise "food_items dead-letters would be exactly what this hides" is **wrong, in a way that matters**. D-1's `food_items` mutations never dead-letter at all: `lib/sync/mutation-schema.ts:9` omits `food_items` from the domain enum, and `app/api/sync/push/route.ts:36-42` drops schema-failing mutations *and deliberately omits them from `errors`* — so `resolveFailedOutboxIds` (`sync-helpers.ts:17-35`) treats them as confirmed and `sync-engine.ts` **deletes them from the outbox**. D-1 rows never appear in `getFailedMutations`, never reach the SyncHealthCard, and would not be caught by K3's recommended dead-letter notification either. K3 does not "hide" D-1; D-1 bypasses the dead-letter machinery entirely (a strictly worse, separate defect). The combination therefore does not compound K3's severity — it undercuts the strongest concrete instance the "high" rating leaned on.

## Severity reasoning (single user)

What remains true: when a mutation *does* dead-letter (per-item server rejection — the historically recurring #47/#74/#82 drift class — or an envelope-level non-429 4xx), the moment passes with zero signal, local-first reads keep rendering the data as saved, and server-computed aggregates (PRs, weekly stats, AI periodization) silently diverge. That is real and untracked. Mitigations that pull it down from high: (a) the data is not lost — the failed row persists with working Retry/Discard, and the user (a single owner who visits More regularly for Oura controls) will eventually see a red "N changes failed to sync" card; permanent loss requires a reinstall/reset before noticing; (b) the loudest adjacent data-loss bug (D-1) is outside this mechanism's reach, so fixing K3 buys less than the finding implies; (c) the entire dead-letter path is itself device-unverified (v1.76.0 KI row), so the notify-gap sits atop a mechanism whose basic operation hasn't been observed. Medium: worth a backlog entry (toast/LocalNotification at the `dead === true` transition + feeding the existing bottom-nav badge from `getFailedMutations().length`), but not a drop-everything data-loss bug on its own.


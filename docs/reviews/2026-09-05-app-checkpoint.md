# App checkpoint — twenty-six lanes, one report

**Date:** 2026-09-05/06 · **Session:** 📖 Review (running the checkpoint prompt as a one-off) ·
**IDs:** `PS-` · **Pillars:** all eleven
**Method:** the twenty-six specialist lanes of [`docs/agents/prompts/checkpoint.md`](../agents/prompts/checkpoint.md),
run as read-only subagents where budget allowed and by the coordinator directly where it did not,
with **every finding below re-verified by the coordinator** — re-run against the live dev server,
production (`claude_ro`, owner-scoped), or the cited line — before it was written here. Lane raw
returns: `scratchpad/checkpoint/returns/lane-*.md` (ephemeral); the verification ledger is §7.

## 1. What this app now contains

A Next.js 15 offline-first training app whose engine is in better shape than its edges. The core
write paths are genuinely hardened — sweeps 40–48 plus this checkpoint's probes found ownership
enforced on every surface tried: cross-user reads, writes, deletes, coach patches and client-minted
ids all refuse correctly, the outbox replays with an optimistic-concurrency token, and the cache
layer has no bare prefix-siblings and one TTL per key. The maths is where the drift is: five
independent arithmetic defects live in the scoring path (three on the owner's data today), the same
formula has grown second and third homes in three domains, and the AI layer spends tokens on calls
whose inputs are empty. The single worst finding is not maths: **deactivating a user does not end
their session, and the fix that shipped for exactly this on 2026-09-05 (LA-58) reads a claim that is
never refreshed.** Documentation is extensive and mostly honest, but `CLAUDE.md` — loaded into every
session — carries seven verified-stale claims, and the custom-rules gate, this repo's proudest
mechanism, has six rules that fire on the textbook violation and miss the common shape of it.

## 2. Escalated — production authorisation, confirmed live

**PS-24 — Deactivation and admin revocation never reach a live session.** Set `is_active = false`
for a signed-in account: its existing cookie kept answering `200` on API routes and pages
(3× `/api/friends`, `GET /` no redirect). Only a fresh sign-in is blocked (control: 302 → `/pending`).
Cause, verified in source: `middleware.ts:5` runs `NextAuth(authConfig)` whose jwt callback
(`auth.config.ts:32-46`) sets `isActive` only at sign-in; the refresh (`refreshIsActiveClaim`) is
wired only into `auth.ts:60`, and the no-arg `auth()` every route uses discards the re-signed
cookie. The Edge middleware re-signs the sign-in-time claim with a fresh 7-day expiry on every
request, so the session is effectively immortal while used. **LA-58 (#884, merged 2026-09-05)
added the 403 gate but the claim it reads never changes** — its Known-Issues row must reopen, not
archive. Same mechanism: an `isAdmin` revocation never reaches a live session.

**PS-25 — The login brute-force limiter is bypassed by whitespace.** `auth.ts:26` keys the limit on
the **untrimmed** email; `:29` looks up the **trimmed** one — ` user@x` and `user@x ` are fresh
20-attempt buckets against one account (lane-verified live: attempt 21 plain → refused; attempt 22
padded → signed in). Case IS folded (control). No IP-keyed limit exists on this endpoint.

## 3. Cross-lane patterns, by cause

**P1 — A guard that exists is not a guard that reaches** (the repo's own recurring class, now
measured at checkpoint scale): `PROSE_GUARDS` says *"imported by every prose-generating AI route"*
and reaches 5 of 9 (lane 13); `invalidUuidResponse` reaches 27/27 path-ids and 0 body-ids (RV-47,
sweep 48); `check-body-fat-correction.js` never walks `components/` and its `DERIVERS` list omits
`calculateBaseline`, the function its header names (lane 10); `health-insight`'s "nothing to
interpret" gate is defeated by its own unconditional `Contributors:` line in 3 of 4 sections, so
Gemini is paid to say "no data was recorded" (lane 12, live); and **six custom rules fire on the
textbook violation and miss the common shape** (lane 25, harness-verified): the PPL rule's
case-sensitive `grep -v 'push\|pull'` hides `"Push"` on any line with lowercase push/pull; the
icon-button regex stops at the `>` of `=>` so every inline-arrow `onClick` button is unexamined;
the Capacitor-proxy rule needs single quotes and no semicolon; the doc-size ratchet is not
shrink-only (CLAUDE.md sits 430 lines under baseline and can grow back silently); the
test-user-UUID rule reads `git ls-files` so untracked tests are invisible locally; the
vendor-constants rule is vacuous (0 JSON files to compare against).

**P2 — A value stamped once, trusted forever**: the auth claims (§2); `workout-store.ts:438` passes
`today = null` into rehydration so the *"or from a previous day is abandoned"* branch (its own E1-4
comment) is dead — a cross-midnight workout keeps its session while its ticks are cleared (lane 01);
the weather cache is one unkeyed `localStorage` entry returned before coordinates are read, so a
moved device shows the previous location for 30 min (lane 08).

**P3 — One formula, several homes**: ACWR is banded from a 28-day window on the Health card but the
AI-chat tool computes it over **56 days and returns the raw number with no band** — 32 of the
owner's last 76 days disagree (lane 06); program-age baselining has **three** rules across three
consumers, and the owner's active program (`started_at = NULL`) takes a different one on each
(lane 06); "WHO moderate-equivalent minutes" has **three** mappings (Z3 doubled / Z3 single / the
filed Tuning band) (lane 08); the water goal is weight-derived in `goal-recommendation.ts` and
hardcoded 2500 ml in two consumers (lane 09); the same screen rounds the pre-filled set weight
NEAREST and its target display UP on the no-style branch (lane 05).

**P4 — Arithmetic wrong at the boundary**: `amrapScaleFactor`'s step table makes the stored 1RM
**non-monotone in reps** — one more rep at 80 kg *lowers* the estimate at 5→6, 8→9, 12→13, 20→21
(−8 kg at the last), coordinator-verified through the shipped module, and the backlog's Q-514 claim
that this path has "no production call site" is false (lane 05); bodyweight estimates scale with
`amrapScaleFactor` but invert without it, so 10 achieved reps are stored as a "7 RM" and exact
adherence ratchets prescriptions DOWN (10→7→6→5) — the spec says the opposite design was chosen
precisely to avoid this (lane 05); `computeVolumeAcwr`'s acute window is 8 inclusive days over a
28/4 chronic, so constant load reads 1.10 daily and lands exactly on the 1.2 early-deload threshold
for an every-third-day lifter (coordinator-verified) (lane 06); the sleep-performance correlation
counts one point per **exercise**, so 4 days clear the 20-"paired days" floor and the p-value is
computed at 5× the real n (lane 07); the >30-rep guard drops a working set to 0 but clamps a
baseline set to 30 (lane 05).

**P5 — Live on the owner's data today** (all coordinator-verified in production): the home strength
card shows a full-1RM red drop and 0 % bar for **16 of 34 exercises** whose latest log is a deload —
Q-298's `> 0` guard reached `listPrevious1rm` and not the current side (lane 05); `oura_daily`
recorded the ring worn **0.3–1.5 h on 20 consecutive days** (08-14→09-02) that each carry a 7–9 h
scored night, feeding `isLowWearToday`, the baseline exclusion and the wear chart a false signal
(lane 07, mechanism not established); PS-17's phantom afternoon night still sits scored in the
summary (status, already filed).

**P6 — AI spend without a data gate**: `weekly-digest` generates a Gemini recap of zeros for an
empty week (lane 01, live, cached; also fires on the seeded account); `health-insight` calls the
model for sleep/readiness/activity with every metric absent (§P1); `running-plan/explain` is the
one site missing `maxRetries: 0`, multiplying the SDK's retries with the shared helper's; the
image-scan fingerprint omits content so the ai-usage double-trip metric false-positives (Q-471's
fix unapplied there); the model's `confidence` is rendered as an "AI confidence" bar and picks the
saved entry's `source` (against CLAUDE.md's letter; honestly labelled — owner call). **Prompt
injection**: `meal-plans/generate` splices `excludedFoods`/`usualMeals`/`stores` raw — a 71-char
"exclusion" renamed the plan and every meal to PWNED (lane 13, live; self-injection only).

**P7 — Ingest trusts a placeholder**: scale ingest computes and stores body fat and metabolic age
from `height ?? 170` / `age ?? 35` when the profile lacks them, filed under `scale_ble` as a real
reading (lane 10, live); `scale_raw_samples` has no dedup key, unlike its Oura sibling.

## 4. The consolidation proposal (lane 02, `Gate: owner`)

Of 46 pages: **41 keep, 5 delete, 0 merge**. The five are zero-content redirect/duplicate routes
with ≤4 in-repo callers each: `/workout-select` (same `WorkoutSelectContent` as the Workout tab,
mounted outside the shell — re-point 3 pushes in `done-activity-screen.tsx`), `/session-select`
(redirects to `/workout`; also the PWA `start_url`, so a manifest launch lands on the Workout tab
under a name that means Home), `/stats`, `/config`, `/profile` (each a bare `redirect()` with 1–3
callers). ~10 call-site edits plus `manifest.ts` and two dead `pathname-routing.ts` palette keys.
The four `health/*` details are hub→detail, not duplicates; `more/data` vs `more/details` hold
different data; no page is orphaned; the middleware's public set exactly matches the five
no-session pages. Coordinator correction to the lane: `pathname-routing.ts:26` (`/workout`)
precedes `:45` (`/workout-select`), so the `workoutSelect` palette branch is unreachable — the
lane's palette-differs claim is **not established**; the dead branch itself is the hygiene item.

## 5. The CLAUDE.md audit (lane 26, every item coordinator-verified)

Seven stale claims in the file every session loads: :64 "three-part wrap-up" vs :154 "four steps";
:304's fetch-once counts (36/19/16) vs the script's real 12-across-10; :360 cites `/api/oura/sync`,
which does not exist; :689/:748 put the W1 bounce in `set-card.tsx` when `animate-bounce` exists
only in `active-workout-screen.tsx`; :664 names one Gemini model when the coach runs a second
(`gemini-3.6-flash`); :753-754 keep two struck-through Known Issues in place against the file's own
:178 rule; the `Ran N of N` origin story predates the count tripling. Plus: **Q-479 has two live
FIXED rows in `projectOverview.md` (:2486, :2998)** and the duplication check only compares across
files; 13 backlog `Needs:` edges point at KEEP entries, which `next-item.js`'s "absent = shipped"
rule can never clear; LB-27's Keep asks for a decision `client.ts:36` already made
(`connectionTimeoutMillis: 5_000`); 22 backlog-cited paths no longer exist; 17 handoffs are
unindexed and one is indexed nowhere; four top-level docs have zero inbound references. Disposition
table for all 41 top-level docs (9 archive/merge/delete candidates, led by
`oura-ring-data-reference.md`, which documents the retired Cloud API with no retirement note) is in
the lane return and the backlog entry.

## 6. Per-lane results (compressed; ✅ = clean, method stated in §7's ledger)

| Lane | Verdict |
|---|---|
| 01 boot | 4 findings (§P2/P6); ✅ warm boot paints with zero skeleton frames; nothing DB-bound before first paint; cold Fast-3G inventory measured |
| 02 IA | §4; ✅ no orphan pages; middleware public set exact |
| 03 auth | §2 (2 escalations) + per-request users lookup + dev-only bridge double-bundle; ✅ unauth sweep, tampered/expired JWT, friendship gating, per-IP limits |
| 04 offline | ✅ at source: SW `/api/` no-store bypass, `/offline` fallback, `clients.claim()` present (corrects lane 01); device half not exercised |
| 05 strength | 6 findings (§P4/P5); RV-43 unchanged; ✅ `mround125Up` still dead |
| 06 load | 4 findings (§P3/P4); ✅ one ACWR implementation, band edges right, week starts in user tz, owner's ACWR spans all four bands |
| 07 sleep | 3 findings (§P4/P5); ✅ scoreBand single-source, sleep-day keying 0/75 mismatches, HRV is RMSSD end-to-end, score distributions healthy |
| 08 cardio | 4 findings (§P3 + sex='other' Ross fallback + best-pace floor + weather); ✅ HR zones exact at every ±1 bpm boundary; equations match their citations |
| 09 nutrition | 3 small findings (§P3 + water-log day keys + meal-split contract); ✅ RMR ladder single and documented; day totals drift ≤0.5 kcal over 62 days |
| 10 body | 3 findings (§P7 + body-fat check scope); ✅ DEXA correction reaches its consumers; lowest-wins weigh-ins; provider-supplied blood ranges |
| 11 tz | ✅ full suite green with the user's tz in the 00:00–02:00 hazard band (5405 passed; single failure was the coordinator's env, not tz); partial coverage — seeded user only, 23:30 half not run |
| 12 AI inventory | 5 findings (§P6); ✅ 0 `JSON.parse` of model text, all 17 sites instrumented, every object post-processed, rate limits everywhere; 30-day cost 594k in/77k out tokens, coach = 60 % of input spend |
| 13 prompts | 3 findings (§P6); ✅ live no-superlatives control (a score of 80 → no "perfect"); every prompt hands numbers with units |
| 14 coach | ✅ CLEAN: preview measures consequences and refuses cross-user; apply replay → 409 with drift (`from` is an optimistic-concurrency token); closes the baton's `/api/coach/preview` item |
| 15 schema/FK | ✅ the workout/device FK half: all CASCADEs same-owner; the one client-writable CASCADE edge (`phase_set_id`) refused cross-user with control; cross-ref count 0 |
| 16 write paths | ✅ by reference: sweeps 40/43/47/48 + this checkpoint; POST surface remains the baton's next lens |
| 17 outbox | ✅ reconcile/push/invalidate checks green; device half not exercised |
| 18 cache | ✅ 20 prefix groups, zero bare prefix-sibling keys across every read site; TTL and no-store checks green; full matrix not built |
| 19 export | ✅ 94 tables: 71 exported, 26 excluded with reasons, 18 soft-delete-filtered |
| 20/21 devices | pipeline LIVE (latest ring sample minutes old); wear-time defect carried in §P5; scale dedup in §P7 |
| 22 native | not exercisable here; both native-guard rules green (with lane 25's caveats) |
| 23 mobile UI | NOT swept (screenshot crawl unbudgeted) — recorded as not established, not clean |
| 24 perf | build + dependency scan: see below |
| 25 CI rules | `Ran 68 of 68`; 67/67 rule steps fire on their simplest violation; 6 bypass shapes (§P1); 93 of 219 routes referenced by no test |
| 26 docs | §5 |

### Lane 24 — performance
Dependency scan: 88 dependencies, 4 with no source reference after excluding toolchain —
**`@ai-sdk/openai`** (an OpenAI SDK in a Gemini-only app), `@aws-sdk/lib-storage`, `@dnd-kit/dom`,
`@radix-ui/react-use-controllable-state`. Boot cost measured by lane 01 (cold Fast-3G: 35 API calls
/ 121 KB; warm: 16 / 25 KB; the §P2 warm-duplication is the one waste found). Production build: shared first-load JS **192 kB**; heaviest pages `/workout` **496 kB**
(43.5 kB own), `/admin/data-capture` 466 kB, the four tab pages 449 kB each, `/health/day` 408 kB
(33.6 kB own). Nothing pathological for a WebView app that ships its tabs in one shell; the two
page-level outliers (`/workout`, `/health/day`) are the places a split would pay.

## 7. What was NOT exercised

The device, entirely: native SQLite (`getLocalStore()` null — every offline-first read took its web
fallback), safe-area, gestures, notifications, BLE, Samsung WebView. The screenshot crawl (lane 23)
and per-route bundle-to-page seam. The 23:30 half of the tz run; non-seeded-user tz coverage.
`oura_workouts`' positive control (0 rows). Production readiness of the dev-only mobile-bridge
finding. The correlation route's live owner output. Mechanism of the wear-time undercount.
`claude_ro` is owner-scoped throughout: every production claim reads "the owner's rows", never
"nobody's". The coordinator's own errors are recorded inline where they occurred: two probes that
missed their handler (coach domain/targetId), one environmental 500 (a build clobbering `.next`
under the dev server) withdrawn rather than filed, and one lane claim (missing `clients.claim()`)
struck on re-verification.

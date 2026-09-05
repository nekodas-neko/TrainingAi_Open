# App checkpoint — WORK IN PROGRESS (coordinator ledger snapshot, not the report)

Safety commit so verified findings survive the ephemeral container. Replaced by the collated report before merge.

# Coordinator ledger — what I have re-verified myself (survives compaction)

## Lane 02 (IA) — VERIFIED 2026-09-05
- Dev server was down during its run (a lane's Playwright harness spawned :3104 and killed :3000). Source-only; crawl NOT run.
- VERIFIED by my own grep: manifest.ts:8 start_url=/session-select; session-select/page.tsx redirect(/workout);
  tab-shell:139 home=SessionSelectContent, :151 workout=WorkoutSelectContent; workout-select/page.tsx renders
  WorkoutSelectContent+BottomNav OUTSIDE shell; done-activity-screen pushes /workout-select x3 (:264,:310,:320);
  done-screen pushes /session-select (:512); stats/config/profile are redirect-only; callers as cited.
- CORRECTION to lane: pathname-routing.ts:26 `startsWith('/workout')` precedes :45 `startsWith('/workout-select')`,
  so :45 is likely UNREACHABLE and /workout-select gets palette 'workout' — the palette-differs claim is NOT established;
  the dead-branch at :45 is a small extra hygiene item. Duplicate-URL finding stands.
- Disposition: 41 keep / 5 delete (workout-select, session-select, stats, config, profile) / 0 merge. -> ONE backlog entry, Gate: owner.
- Clean: middleware public set == the 5 no-session pages; all admin pages gate; no orphan pages.

## Lane 26 (docs + CLAUDE.md) — VERIFIED 2026-09-05 (11 of 12 findings spot-checked by me, all confirmed)
- CLAUDE.md:64 "three-part wrap-up ritual" vs :154 "all four steps" — CONFIRMED.
- CLAUDE.md:304 "36 remaining sites / 19 mounted" vs `node scripts/check-fetch-once-effects.js` -> "12 known ... across 10 files" — CONFIRMED.
- CLAUDE.md:360 cites /api/oura/sync; app/api/oura/ has hr-data hr-day hr-sync hr-window stats workouts (no sync) — CONFIRMED.
- CLAUDE.md:689/748 W1 bounce in set-card.tsx; animate-bounce only in active-workout-screen.tsx — CONFIRMED.
- CLAUDE.md:664 one model; instrument.ts:10 gemini-3.1-flash-lite, :27 COACH gemini-3.6-flash — CONFIRMED.
- projectOverview.md has Q-479 as TWO live headings (:2486, :2998); check-known-issue-duplication is cross-file only — CONFIRMED.
- next-item.js:111 `unmetNeeds = needs.filter(n => inQueue.has(n))` => a Needs: on a KEEP entry never clears; BF-118/BF-43 -> BF-41 confirmed as examples. 13 edges claimed, 2 verified.
- LB-27 Keep asks for a decision on connectionTimeoutMillis:0; client.ts:36 already 5_000 — CONFIRMED.
- Missing backlog paths: 4 of 5 spot-checked missing; lib/keep.js is really scripts/lib/keep.js — CONFIRMED.
- Unindexed top-level docs: device-perf-profiling-checklist, oura-asset-architecture, owner-decisions-2026-08-12 have 0 index refs — CONFIRMED.
- handoff-2026-08-24-cross-bugfix-* indexed nowhere — CONFIRMED.
- NOT re-verified: the 17-handoff unindexed list beyond one, the doc-disposition reasons (41 rows), CLAUDE.md duplication line pairs.
- Collation note: these are ONE class "CLAUDE.md carries stale counts/paths/claims" (7 items) + ONE class "backlog/index hygiene" (paths, handoffs, Q-479 dup) + ONE process defect (Needs->KEEP). Cap accordingly.

## Lane 03 (auth) — VERIFIED 2026-09-05 — TWO SECURITY FINDINGS, ESCALATE #1
- **#1 CONFIRMED LIVE BY ME:** UPDATE users SET is_active=false for zero; zero's EXISTING cookie -> GET /api/friends 200,200,200; GET / 200 no redirect.
  CONTROL: fresh sign-in while inactive -> 302 /pending. Gate works only at sign-in.
  ROOT CAUSE (source, verified): middleware.ts:5 `NextAuth(authConfig)`; auth.config.ts jwt callback (:32-46) sets isActive only from `user` at sign-in, no refresh;
  the refresh (`refreshIsActiveClaim`) is only wired in auth.ts:60 (Node `auth()`), and no-arg auth() discards the re-signed cookie (next-auth lib/index.js:104-106 per lane).
  => LA-58 (#884, merged today, "make the deactivation gate cover API routes") added the 403 gate but the claim it reads never changes. Same for isAdmin revocation.
  SEVERITY: data-correctness/authorisation. Known-Issues row for LA-58 must be REOPENED, not archived.
- **#2 CONFIRMED (source, decisive):** auth.ts:26 rateLimit key `login:${email.toLowerCase()}` (untrimmed) vs :29 lookup `.toLowerCase().trim()` => padded email = fresh bucket. Lane's live 24-attempt sequence consistent (case IS folded; whitespace is NOT). No IP-keyed limit on this endpoint.
- #3 (hygiene) isActiveCheckedAt never persists -> users lookup every request. Consistent with #1's mechanism; not separately measured by me.
- #4 (dev-only) mobile-bridge token Map bundled twice under Turbopack -> exchange 401 locally. NOT established for the prod webpack build.
- Clean (lane, not re-verified by me): unauth sweep, expired/tampered JWT, friendship-gated profile reads, per-IP limits on register/exchange, check-sign-out-clears-device + check-admin-claim-in-api green.
- Lane 03's probe file is gone; the untracked file now is lane 05's (in flight).

## Lane 01 (boot) — VERIFIED 2026-09-05 (4 of 4 by me)
- warmCache (sync-provider.tsx:99) bare fetch; cache.ts:137 inFlightRequests module-private (0 exports) => Phase-3 warm duplicates home's 3 heaviest requests on slow network (lane measured: body-metadata x2, workout-data x3, next-session x2 on Fast-3G). CONFIRMED source; magnitude on device NOT established. hygiene.
- workout-store.ts:438 `applyRehydrateFixups(state, null, ...)`; :204 `dateRolledOver = today !== null && ...` => the E1-4 "or from a previous day" abandon branch is DEAD; rolloverDay (:425) clears todayLogged/revertedDeloads but keeps workoutSessionId/workoutStartMs. CONFIRMED source + lane's fixture reload. consistency. (Claim tested: the E1-4 comment at :222.)
- weekly-digest: no insufficient-data gate; live POST as zero@ returns a Gemini digest "0 sessions ... 0 kg" (cached). CONFIRMED live. user-visible. Also an AI-cost item (lane 12 seam).
- weather-chip.tsx:26-28 pulses while loading, no timeout/failure state; lane saw 1 pulse element for full 8s sample on web. CONFIRMED source; device NOT established. hygiene.
- Clean (lane): warm boot zero skeleton frames (readCacheSync localStorage fallback works); nothing DB-bound before first paint; app-load beacon once; expired/garbage cookie -> 307 with valid control; zero-data boots clean; SW caches `/` once controlling but NO clients.claim() so launch 1 never caches it (worth a hygiene line).
- NOT established: offline boot (setOffline doesn't reach SW target) -> device checklist.

## Lane 25 (CI rules + tests) — VERIFIED 2026-09-05 (5 of 7 by me; #2 mechanism plausible, #7 spot-checked)
- `Ran 68 of 68` confirmed by lane. Lane built a harness that injected a violation per rule into a scratch copy: 67/67 rule steps FIRED on the simple shape. Findings are BYPASS SHAPES:
- #1 PPL rule: ci.yml:173 `grep -v 'push\|pull'` is case-sensitive and runs BEFORE the -Ei match, so a line with lowercase push/pull hides a "Push" literal. CONFIRMED source.
- #2 icon-button rule: attribute regex stops at the `>` of `=>` so `<button onClick={() => …}>` is never examined. Mechanism plausible (regex at the `<(button|Button)` line); lane's harness showed DID-NOT-FIRE; 0 live instances.
- #3 Capacitor-proxy rule: only single-quoted import + return with NO semicolon. Lane harness; 0 live. Not re-run by me.
- #4 doc-size ratchet is NOT shrink-only: CLAUDE.md 774 vs baseline 1204, lane-a baton 91 vs 193 — CONFIRMED numbers; a 400-line regrowth passes. Unlike check-hex-literals/fetch-once/component-size which fail on shrink.
- #5 test-user-uuid-collisions reads `git ls-files '*.test.ts'` (:111) => untracked/.test.tsx invisible locally. CONFIRMED source.
- #6 vendor-constants rule vacuous: 0 json in lib/oura-models/constants/, script prints "0 vendor values". CONFIRMED.
- #7 93 of 219 routes referenced by no test (lane's scan). Spot: calendar-data appears only in cache-groups + use-cached-value tests (cache-key strings). Consistent; not re-run.
- COLLATION: #1-#6 are ONE class "a custom rule that fires on the simple shape and not the common one" (6 rules) -> one entry listing the six. #7 separate (test coverage).
- Clean (lane): all 67 rule steps fired on their simplest violation; both trees left clean.

## Lane 05 (strength/1RM) — VERIFIED 2026-09-05 (5 of 6 by me)
- #3 CONFIRMED by my vitest on shipped calculate1RM([80],[r]): 5->6 91.75->91.5; 8->9 97.25->96.25; 12->13 105.75->103.25; 20->21 133.25->125.25. One more rep LOWERS the estimate (amrapScaleFactor step table). data-correctness. Claim tested: backlog Q-514 text says calcAmrap1RM/amrapScaleFactor "have no production call site" — false (calculate1RM's no-style fallback + amrapAverage1Rm).
- #4 CONFIRMED: calculate1RM 80x31 -> 0 (dropped); calcAmrap1RM 80x31 -> 136 (clamped). ">30 guard" applied two ways. Owner max reps 25 => latent.
- #5 CONFIRMED source: workout-screen.tsx:78 mroundStep vs active-workout-screen.tsx:377 mroundStepUp on the same no-style branch. Latent (every owner exercise has a style).
- #6 CONFIRMED source: utils.ts:68-74 clamp [5,250]. Latent for owner (max 127.5).
- #1 CONFIRMED source: strength-progress.ts:32-34 delta uses current with NO >0 guard; :52-59 pct = estimated1rm/max => a deload row's stored 0 gives 0% bar and "-<full 1RM>" delta. Q-298's guard reached listPrevious1rm only. Prod "16 of 31 exercises" NOT yet re-verified by me (query pending). user-visible.
- #2 bodyweight ratchet-DOWN: lane's vitest (10 reps stored as 7 RM; 10->7->6->5). My re-probe: see coord-bw.txt.
- RV-43 not re-filed (lane checked: unchanged).
- Lane 05 #2 bodyweight CONFIRMED by my vitest: estimateOneRm 6 reps -> 114.5 -> repMaxFromOneRm = 5; 10 -> 124 -> 7; 20 -> 166.5 -> 16. Store scales (amrapScaleFactor), inverse does not => prescribed reps ratchet DOWN under exact adherence. data-correctness. Claim tested: spec 2026-07-01-bodyweight-rep-progression-design.md:41-46 says no scale factor for bodyweight and repMaxFromOneRm(calc1RM(BW_REF,r))===r.
- Lane 25 #2 CONFIRMED: check-icon-button-names.js:41 regex `(\s[^>]*?)?>` — `[^>]` stops at the `>` of `=>`. #4 CONFIRMED: check-doc-index-size.js:85 `if (lines <= limit) continue;` — no shrink branch.
- Lane 05 #1 PROD CONFIRMED by me (claude_ro, owner's rows): 34 exercises, latest log estimated_1rm=0 for 16, exercise_deloaded for 16. => the strength card's deload-zero defect is LIVE on ~half the owner's exercises today. user-visible, top of queue with the auth items.

## Lane 06 (training load) — VERIFIED 2026-09-05 (#1,#3,#4 by me from source+prod; #2 my re-run below)
- #1 CONFIRMED: lib/ai-chat/tools.ts:402-408 `daysAgo(56)` + `return { acwr }` (no band) vs app/api/training-load/route.ts:25 `from28d`, :84 `interpretation: acwrBand(acwr).key`. Chat bands the number itself, on a different window. Claim tested: acwr.ts "never re-derive from the raw acwr number at the call site". consistency. Lane's prod replay: 32 of 76 days differ in band.
- #3 CONFIRMED: three baselining rules — route:60-63 startedAt ?? createdAt; readiness-payload.ts:365-368 startedAt else Infinity (never baselines); signals.ts:423-429 none. PROD (by me): active program 'Shikai' started_at=NULL, created_at=2026-07-01. So in July the card said baselining while early-deload/activity taper consumed live ACWR. consistency.
- #4 CONFIRMED: training_load_gate reason values are read by NO UI (grep: only the route + a test); training-stress-line.tsx:22 hides on any non-ok. PROD (by me): oura_daily_derived since 2026-07-01: 63 days gate NULL, 1 day insufficient_met, 0 OTS values. The J-9 "OTS persists on a good read" has never had a good read. user-visible (an empty card with a recorded reason nobody shows).
- #2 acute window: acwr.ts:18 `from7d = todayMid - 7d`, session counted if `t >= from7d` => 8 inclusive days vs chronic/4. See coord-acwr.txt for my constant-load numbers.
- Clean (lane): one computeVolumeAcwr; band edges correct; week starts in user tz (Monday, Brisbane); ACWR null until >=21-day span; owner's ACWR spans 0.70-1.69 across all four bands.
- Hygiene (lane, not re-verified): route shows toFixed(2) but bands the unrounded value (1.304 -> "1.30 · elevated"); health-insight hands computeVolumeAcwr a UTC midnight (only reads a window-independent median today).
- #2 CONFIRMED by my vitest (constant 1000 kg/session, 28-day list): daily, trained today -> acwr 1.103 (acute 8 sessions=8000 vs 29/4=7250); daily, trained yesterday -> 1.000; two days ago -> 0.889; every-3rd-day trained yesterday -> 1.200 (=EARLY_DELOAD_ACWR_MIN); two days ago -> 0.825. Steady state is biased +10% and swings 0.89<->1.10 on whether today's session is logged. data-correctness. Claim tested: training-load-card.tsx "last 7 days vs your 28-day average" — it is 8 days.

## Lane 12 (AI inventory) — VERIFIED 2026-09-05 (5 of 5 by me)
- Inventory (lane): 17 sites all via lib/ai/instrument.ts loggedGenerate* -> withAiRetry -> ai_call_log; 0 JSON.parse of model text; every object site post-processes/clamps; rate limits on all 13 routes; PROSE_GUARDS on every prose card except running-plan/explain.
- Prod cost (lane, claude_ro.ai_call_log, owner, 30d): 210 calls, 594k in / 77k out tokens; coach 356k in (22 flash-lite + 5 on 3.6-flash); prescription 94k; nutrition-scan 37k. NO price anywhere in repo — ai-usage page reports tokens only, default window 168h.
- #1 CONFIRMED LIVE: POST /api/ai/health-insight {section:sleep, force} as zero-data -> 200 with a Gemini "no data available" insight; route.ts:125 unconditional `Contributors: …` line makes splitMeasured count the section as measured, defeating the :180-183 deterministic gate (which its own comment says exists to avoid paying for this). readiness (:104,:111) and activity (:173) same; heart-rate has no such line and gates correctly. user-visible + AI cost. SIBLING of lane 01's weekly-digest-of-zeros (lane 12 confirms weekly-digest emits zeros on the SEEDED account too).
- #2 CONFIRMED: running-plan/explain/route.ts has no maxRetries:0 (14 other files do) => SDK default 2 retries x withAiRetry 1. consistency.
- #3 CONFIRMED: scan/route.ts:184 image fingerprint {mode,imageKind,note} => distinct photos share a fingerprint; ai-usage double-trip metric false-positives (Q-471's contentKey fix not applied here). hygiene.
- #4 CONFIRMED: meal/route.ts:172-175 error copy swapped (fresh generation says "Could not rewrite"). hygiene.
- #5 CONFIRMED: review-step.tsx:182-187 renders model `confidence` as an "AI confidence" bar; log-food.ts:31 `confidence ? 'ai' : 'manual'` decides source. Against CLAUDE.md's letter ("no LLM self-reported number shown as fact"); labelled honestly. consistency, Gate: owner.
- Clean (lane): daily-digest gate holds ({digest:null}, no call); heart-rate insight gate holds; workout-review confidence overwritten to 1.0 by /apply (correct); generate-program's Push/Pull/Legs example names are an explicit CI exemption.
- COLLATION: #1 + lane01 weekly-digest = ONE class "AI routes with no data gate" (health-insight x3 sections, weekly-digest). 

## Lane 07 (sleep/readiness) — VERIFIED 2026-09-05 (3 of 3 new findings by me; PS-17 status only)
- #1 CONFIRMED source: sleep-performance-correlation/route.ts `points.push` inside `for (const ex of ws.exercises)` with one sleepHours per day => n counts exercises not days; DEFAULT_MIN_N=20 (correlation.ts:190) cleared by 4 days x 5 exercises; p-value at n=20; text says "N paired days". data-correctness. Owner live output NOT fetched (session-scoped).
- #2 PROD CONFIRMED by me (owner's rows, 60d): 62 days; 20 where (86400-non_wear_time_sec) < sleep seconds; first 2026-08-14, last 2026-09-02. 09-01 worn 0.5h vs slept 7.5h HRV 65; 09-02 0.5h vs 8.17h; 09-03 20h; 09-04 24h. Writer run.ts:880-905 (wornSec = bins x 900 over the run's window). Consumers: readiness-payload isLowWearToday (:799), excludeLowWearDays on HRV/RHR baselines (:329/:341), trends worn-hours chart, chip dims at lowWear. MECHANISM NOT ESTABLISHED (suspect: incremental run's narrowed window overwrites a full-pass count). Not previously filed (no non_wear/wear-time heading). data-correctness.
- #4 CONFIRMED source: readiness-payload.ts:566-572 score = ownComposite.score (z-composite) else legacy sum; :739 serves legacy parts as `components` regardless => components (sum 78) do not explain score (46). No UI consumer found. hygiene.
- PS-17 status (lane, prod): 08-27 phantom 4.75h row still in oura_daily_summary (hrv 26.5, rhr 73.7), derived 08-27 readiness 33 / sleep 36; groupSleepPeriods still promotes a 4.02h afternoon window (ALWAYS_NIGHT_MIN_HOURS=4). Back-fill not run. Already filed — status only.
- Q-507 reversed by TN-22; Q-518 fixed #525 (not re-verified); Q-501 still queued, night_hrv_baseline_ms null on all rows.
- Clean (lane): scoreBand single source, boundaries 49.9/50/69.9/70 correct; sleep-day keying 0 mismatches over 75 prod nights; HRV is RMSSD end to end (one stale SDNN comment in health-connect-sync.ts:51); 73/75 nights have HRV; baselines seed from first sample; readiness 90d mean 66 sd 14 range 25-87, sleep mean 77 sd 21 — every band populated.
- Nit (lane): contributor-detail.tsx:31 `score < 50 ? low : high` gives Moderate band the "high" text.

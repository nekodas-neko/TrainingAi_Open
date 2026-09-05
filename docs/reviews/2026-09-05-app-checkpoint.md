# App checkpoint — WORK IN PROGRESS (coordinator ledger snapshot, not the report)

This file is a safety commit so the checkpoint's verified findings survive the ephemeral container. It will be REPLACED by the collated report before this branch is merged.

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

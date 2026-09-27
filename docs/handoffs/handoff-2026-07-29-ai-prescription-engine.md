# Handoff — AI workout prescription session (2026-07-28 → 07-29)

**Scope of this session:** the AI prescription engine, end to end — audit, six fixes, role ordering,
and the Exercise Readiness rework. Everything below is either merged or explicitly not-merged with a
reason.

> **Read first:** `projectOverview.md` (status + Known Issues), then `docs/implementation-backlog.md`
> (the queue). This file only covers what *this* session did and what it leaves behind.

---

## 1. What shipped

| Ver | PR | What |
|---|---|---|
| 1.230.0 | #855 | Prescription review + six fixes (see §1.1) |
| — | #863 | Retraction of a false data-loss claim |
| — | #866, #871 | Docs / method-hazard notes |
| — | #872 | `nap-wake-anchor` test broke `main` ~6 h/day (seeded 06:00, asserted 05:54 — failed before dawn) |
| — | #874 | Single-set floor applied **on read**, not only at generation |
| 1.232.0 | #880 | Role ordering — nothing out-loads the session anchor |
| 1.233.1 | #883 | Role caps **on read**, so stored prescriptions get corrected |
| 1.235.0 | #888 | Exercise Readiness rework (body map, recovery-driven soreness, time constraints) |
| — | #875 | Role-ordering plan + spec (docs) |
| — | #910 | **Closed unmerged** — superseded, see §4 |

### 1.1 The six original fixes (v1.230.0)

1. **Inert prescriptions.** The AI drove load on **1 of 5 sessions**. A pending
   `transition_recommended` discarded its own sets/reps/pct, and three sessions carried a
   self-contradictory transition *to the phase already in progress*, which reset `sessions_in_phase`
   on acceptance so the block could never complete. → 5 of 5 now drive load.
2. **Duration model.** Rest was charged for `sets − 1`. Production shows per-set rest and
   inter-exercise gaps are separate clocks — a ~7–8 min under-estimate per 5-exercise session, and
   **10 of the last 20 workouts ran past their 60-minute budget**.
3. **Check-in reached the plan.** Soreness was blocked by a 6-hour cache *and* a once-per-day stamp
   set by the first read of the day — so logging how you feel after opening the app (the normal
   order) could never take effect.
4. **Short / Standard / Long** duration presets.
5. **Done-screen instant paint** (six uncached fetches).
6. **HR recovery per exercise** instead of per set.

---

## 2. The one bug class that recurred three times in a day

**A generation-time fix cannot reach prescriptions already stored**, and they live up to 7 days.

| PR | Fixed at generation | Left stranded |
|---|---|---|
| #855 | set floor | 4 single-set exercises still live |
| #874 | — | added the read-side floor |
| #880 | role ordering | Upper still had an accessory out-loading the primary |
| #883 | — | added the read-side role caps |

I knew about the class after #874 and shipped it again in #880. `normalizeStoredPrescription`
(`lib/ai-periodization/reconcile-prescription.ts`) is the read-side hook; it is called from **all
four** read paths. **Any future prescription-shaping rule must be applied there too, or it will not
reach live plans.**

One deliberate exception, with a test asserting it: the read path applies only the **absolute** rules
(per-role `SET_CEILING`, anchor load cap). It does **not** apply the anchor *set* cap, whose
lagging-muscle exception needs weekly-volume data the read path lacks — enforcing it blind would
delete sets that generation granted an under-target muscle on purpose.

---

## 3. Where the logic lives

| Concern | File |
|---|---|
| Role ordering (load cap, anchor role, read-side caps) | `lib/ai-periodization/role-plausibility.ts` |
| Role ordering (volume / set ceilings + lagging exception) | `lib/ai-periodization/time-budget.ts` → `applyRoleSetPlausibility` |
| Read-side correction of stored prescriptions | `lib/ai-periodization/reconcile-prescription.ts` → `normalizeStoredPrescription` |
| Duration presets (relative ±30) | `lib/workout/duration-model.ts` → `budgetForPreset` |
| Soreness = "not recovered" | `lib/checkin/suggested-soreness.ts` |
| Self-reported illness → rest/deload | `signals.ts` (`selfReportedSick`), `emergency-deload.ts`, `ai-dynamic.ts`, `reevaluate.ts` |

### Two untuned constants — the highest-value follow-up

Both decide how eagerly the app intervenes, and both were chosen by reasoning, not data:

- **`LAGGING_RATIO = -0.25`** (`time-budget.ts`) — how far below weekly MAV a muscle must be before
  role order yields on volume.
- **`RECOVERED_PCT = 85`** (`suggested-soreness.ts`) — the recovery threshold below which a muscle is
  auto-marked sore.

These want a few weeks of real training to calibrate against, **not more code**. The check to run:
does the app deload more often than the owner would have chosen?

---

## 4. Corrections made this session (do not re-derive the wrong versions)

Four claims I made were wrong and were retracted. They are listed because the retractions matter more
than the claims:

1. **Claimed data loss.** Reported a soft-deleted exercise log. The owner's screenshot refuted it — I
   had queried at 08:52 while the exercise synced at 08:54:14. Method hazard now in the data-quality
   charter.
2. **Claimed the server was in Virginia**, from `x-railway-edge: iad1`. That header reports the
   *caller's* edge PoP, not the deployment region.
3. **Three responsiveness claims** (#876, another session) — the 172 ms proxy figure never applied to
   the app (it was my own admin-audit endpoint), "every screen change waits on a round trip" was too
   broad (`tab-shell.tsx` keeps five tabs client-side), and cache-seed coverage was 85 %, not a gap
   (I grepped `readCacheSync` and missed `readTodayCacheSync`).
4. **Q-21 flake investigation (#910, closed).** I measured 12 clean local runs and concluded "rate
   dropped, cause unknown, re-measure on CI". Another session found the real cause: `sleep_sessions.oura_id`
   is **globally unique**, the BLE rollup derives it as `ble:<startDs>` with **no user component**, and
   four rollup tests all started at ds `1_000_000` — so concurrent files collided, the violation was
   swallowed into `stepErrors`, and the table came back empty. Scheduling-dependent, which is exactly
   why 12 runs can pass. **Q-21 is fixed and struck.**

---

## 5. What is left

### 5.1 Needs the owner (nothing else can proceed on these)

| Item | What is actually needed |
|---|---|
| **Device verification** | 8 features shipped 07-28/29 are marked NOT verified on device in `projectOverview.md`, including the Readiness rework (v1.235.0) and the prescription batch (v1.230.0 — **the per-exercise HR list has never rendered against real HR data**) |
| **Auto-marked soreness sanity check** | On the first real check-in: do the ↻-marked muscles match what you actually trained? Verified only against a *seeded* session, never real history |
| **Q-5b** | Migration **written and merged (#905)** — awaiting the owner's look before it reaches prod |

### 5.2 Ready to implement, needs nobody

> **Re-verified against `main` @ 2e2c88e at session close.** An earlier draft of this file named
> Phase 4 as "next" — it shipped (#897) while this session was running. Check the Q-1 phase table
> before starting anything here; that initiative moved fast.

**Next task: Q-1 Phase 3 — bundle the shell into the APK.**
Plan: `docs/superpowers/plans/2026-07-28-native-feel-phase-3-bundled-shell.md`.

**Its verdict was reversed on 2026-07-29 and the reversal matters more than the plan.** An earlier
revision said "Phase 3 should not be built", judging it purely as a latency optimisation — on that
basis it *does* look marginal (the blank second was `/api/oura/stats`, not the shell;
`DOMContentLoaded` was already 463 ms). That framing was retracted: **the owner's direction is
app-native — everything on device, Postgres demoted to sync and redundancy.** Phase 3 *is* that
direction. It is architecture, not an optimisation declinable on a millisecond count. Do not let a
performance framing talk you out of it.

Two measured facts should shape **how**, not **whether**:
- It buys **cold start and hard reloads only.** Tab switches are already local; non-tab routes are
  RSC fetches. It will not make navigation faster — that is already done.
- Cold start is now dominated by **JS parse/execute**, not the document fetch. Bundling removes the
  network hop for that JS but not the time spent running it. Budget accordingly.

**Do not naively retry Phase 2's cached-document half** (reverted in #891): serving a cached document
meant serving one stamped with an old Next build id against a newer server.

**Then Q-2 — nightly-temperature rollup.** Spec is the backlog entry itself, reproduced end-to-end:
the shipped path over 631 real frames returns 36.00 °C, exactly what production stored. The decoder is
**correct and must not be changed**; the bug is `adapter.ts:4861-4869` flattening three tags' `temps_c`
into one array and stamping every value with its frame's single `ds`, so 631 frames become 2,398
"samples". Sequenced **after Q-1** so history replays once.

Then: Q-22, Q-23, Q-3b, Q-4, Q-7b, Q-10, Q-11.

### 5.3 Filed but unplanned

**Whole-week re-balance after a short session** — a `short` session drops exercises, removing weekly
volume nothing tells the rest of the week about. Deferred deliberately: the weekly-MAV trim priority
already gives most of the benefit implicitly (what a short session skips leaves that muscle
under-target, so the next session protects it). **Do not build a second weekly-volume model** —
`muscleOverageRatio` is the currency. Wants evidence that a muscle actually ends a week under target.

---

## 6. Session-specific gotchas worth keeping

- **`curl` to `api.github.com` is NOT authorized in this environment.** It returns "GitHub access is
  not enabled for this session". Several CI monitors I armed failed silently because of it and I read
  the silence as "still running". **Use the GitHub MCP tools.**
- **`main` drifted 7 times during one PR**, colliding on `package.json` + `lib/changelog.ts` every
  time. Expect it; re-bump on the fresh base. `enable_pr_auto_merge` does **not** help — it reads
  GitHub's `unstable` (checks pending) as "required checks are failing" and refuses.
- **GitHub can report a PR "clean, all checks passed" seconds after a push**, before checks register
  on the new head. Always verify against the head SHA.
- **The DB-backed tests flake under a full run** and pass in isolation — re-run before reporting.
- **Playwright is not installed**, but Chromium is at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Install `playwright-core` in the scratchpad
  and inject a session cookie obtained via `curl` — the in-browser credentials sign-in fails
  headless. This is how the Readiness UI was actually verified at 412×915.

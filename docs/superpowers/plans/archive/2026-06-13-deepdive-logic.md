# Deep-Dive Audit #2 — Logic: Timezone & Progression (2026-06-13)

Scope: timezone-correctness rule + workout/progression domain logic (1RM, AMRAP, guards, deload, SET_COLORS).
Skills: `.agents/skills/timezone-handling/SKILL.md` + `.agents/skills/workout-progression-domain/SKILL.md`.
Excludes session-104 logic plan items (L1 PR-after-tx, L2 bodyweight latest weigh-in, L4 offline `useFor1rm`,
L5 SESSION_TO_TAB) — all verified resolved in current code.

**Both strict project rules are in good shape**: zero `toISOString().slice/.split` violations; no hardcoded
session-name comparisons; canonical 1RM guards intact. Findings below are localized.

---

## Task 1 — `workout-entry` PATCH has a duplicate `calc1RM` missing the reps>30 guard · **Med**

- **Where:** `app/api/workout-entry/route.ts:9-15` (private `calc1RM`), used at `:51`. Live path — invoked from the stats and health edit flows (`app/stats/stats-content.tsx:146,163`, `app/health/health-content.tsx:310,327`).
- **Problem:** This route reimplements `calc1RM` and omits the `reps <= 30` exclusion the canonical route applies (`app/api/log-exercise/route.ts:73`). Editing an existing log with a high-rep set (e.g. 50 reps) recomputes `estimated_1rm`/`target_80`/`intensity_pct` with an absurd inflated value — contradicting the domain rule "sets with reps > 30 are excluded from normal 1RM".
- **Fix:** Guard the map at `:51`:
  ```ts
  const oneRMs = weights
    .map((w, i) => { const r = reps[i] ?? 0; return r > 0 && r <= 30 ? calc1RM(w, r) : 0; })
    .filter(v => v > 0);
  ```
  Better: delete the private copy and import the shared `calc1RM`/`calculate1RM` so the guard can't drift again. (While here, this route also bypasses the repository and lacks Zod bounds — see Security plan Tasks 7 & 3; fix together.)
- **Verify:** Edit a logged set to 50 reps → `estimated_1rm` matches the canonical log-exercise result (high-rep set excluded), not an inflated value. Add a unit test on the shared helper.

## Task 2 — Offline 1RM snapshot in `workout-screen` omits the reps>30 guard · **Low**

- **Where:** `components/workout-screen.tsx:438` — `const perSetEst1rm = snapWeights.map((w, i) => calc1RM(w, snapReps[i] ?? 0))`.
- **Problem:** No `reps <= 30` cap, so an offline-written log of a high-rep set briefly stores an inflated `estimated1rm`/`target80`/`intensityPct` until the server response replaces the row. Transient (server-corrected), but inconsistent with the server guard.
- **Fix:** `snapReps[i] != null && snapReps[i] <= 30 ? calc1RM(w, snapReps[i]) : 0`.

## Task 3 — Client `localDate` date keys use device-local time, not the profile timezone · **Low (tracking)**

- **Where:** `lib/utils.ts:16-24` (`localDateString`/`localDatetimeString`) and callers: `components/chat.tsx:367`, `components/chat-overlay.tsx:104`, `components/weekly-ai-summary.tsx:30-36` (`getWeekStartStr`, a Gemini cache key), `components/stats/weekly-stats-hub.tsx:27`, `components/calendar-widget.tsx:78`, `components/overview-screen.tsx:185`, `app/health/health-content.tsx:377`, `app/session-select/session-select-content.tsx:727`.
- **Problem:** These build "today"/date keys from `new Date().getFullYear()/getMonth()/getDate()` (device-local TZ) — the skill flags this as "local-to-server-TZ, not user TZ". Correct on the target AEST device, but they don't honour the user's Profile `timezone`. Most are display or write-today keys the server re-derives authoritatively via `todayInTz(tz)`, so impact is bounded.
- **Fix:** Where a session timezone is reachable, prefer `todayInTz(session.user.timezone)`. Low urgency — tracking note; revisit if multi-timezone support is ever needed.

## Task 4 — Redundant `.replace(/-/g, "/")` on an already-slash date string · **Low (hygiene)**

- **Where:** `components/stats/weekly-stats-hub.tsx:27` — `localDateString().replace(/-/g, "/")`.
- **Problem:** `localDateString()` already returns `YYYY/MM/DD` (slashes); the replace is a no-op that misleads a reader into thinking dash-normalization is happening. Output correct, code confusing.
- **Fix:** Drop the `.replace(...)` (or move to `todayInTz()` and convert once if dash→slash was the real intent).

---

## Confirmed clean (no action)
Canonical guards intact: `log-exercise/route.ts:73` (reps ≤ 30) and `:177` (AMRAP `Math.min(reps[0], 36)`);
`calcAmrap1RM` rep-band factor and `calc1RM` reps ≥ 37 Epley-only branch intact in `components/workout/utils.ts`;
`mround125` clamp `[5,250]`; bodyweight 1RM uses latest weigh-in; deload excluded from PR + aggregates;
`SET_COLORS` reused via `i % SET_COLORS.length`. "N-days-ago" rolling windows use instant cutoffs against
`startedAt` timestamps (not calendar-date keys), so unaffected by the AEST/UTC boundary.

## Verification & commit
- `pnpm test` (add the shared-`calc1RM` high-rep test), `tsc`/`lint`.
- Task 1 is user-visible (edited high-rep sets no longer inflate 1RM/PR) → patch bump + changelog line.

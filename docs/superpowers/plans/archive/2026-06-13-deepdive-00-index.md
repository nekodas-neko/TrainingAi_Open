# Deep-Dive Audit #2 — Index (2026-06-13, session 105)

> Second full-codebase deep dive, run against the ten domain SKILLs in `.agents/skills/`
> (caching-conventions, timezone-handling, capacitor-native-plugins, db-migrations-repository,
> workout-progression-domain, session-wrapup, chartjs-dashboards, motion-animations,
> pwa-offline-patterns, svg-icon-design). Six parallel domain audits over `app/`, `components/`,
> `lib/`, cross-referenced against `projectOverview.md` and the session-104 audit plans
> (`2026-06-13-audit-*.md`) so only **new** findings or **still-deferred** items are recorded.

**Each linked plan is self-contained** and can be executed independently with
`superpowers:executing-plans`. Tasks are bite-sized with file:line, problem, fix, and a
verification step. Execute in the priority order below.

---

## The six plans

| # | Plan | Scope | Headline (highest-severity) finding |
|---|------|-------|-------------------------------------|
| 1 | [`deepdive-security.md`](./2026-06-13-deepdive-security.md) | AuthZ/IDOR, validation, rate-limit, repo bypass | **Med×2:** cross-tenant IDORs — phase-set can pin another user's style UUID; food-log can reference another user's meal-type/food-item |
| 2 | [`deepdive-caching.md`](./2026-06-13-deepdive-caching.md) | Client cache invalidation, sign-out wipe, offline states | **High:** sign-out clears **no** client cache layer → second account on the same device sees the first user's data |
| 3 | [`deepdive-native-health.md`](./2026-06-13-deepdive-native-health.md) | Capacitor gating, Health Connect permission keys | **High:** `lib/haptics.ts` + barcode-scanner static-import native plugins into the web bundle; `TotalCaloriesBurned` permission never requested |
| 4 | [`deepdive-logic.md`](./2026-06-13-deepdive-logic.md) | Timezone rule, 1RM/progression correctness | **Med:** `workout-entry` PATCH has a duplicate `calc1RM` missing the reps>30 guard → editing a high-rep set inflates 1RM/PR |
| 5 | [`deepdive-ui-charts-animations.md`](./2026-06-13-deepdive-ui-charts-animations.md) | Chart.js, motion, compositor, a11y, consistency | **High:** chart.js eagerly bundled into home/health/stats/nutrition initial chunks via chat + weekly-summary + nutrition chart |
| 6 | [`deepdive-performance-breakup.md`](./2026-06-13-deepdive-performance-breakup.md) | Re-renders, bundle, DB, component splitting | **High:** activity-tracking screens subscribe to the whole Zustand store → re-render on every GPS tick (the session-104 workout-store fix was never applied to the activity flow) |

---

## Recommended execution order

1. **Security** (plan 1) — two cross-tenant IDORs + a cluster of unbounded-array DoS writes; ship the IDOR + bounds first.
2. **Caching** (plan 2) — H1 (sign-out cache wipe) is a genuine cross-user data-leak; H2/H3/M1–M4 are "edit doesn't show up for 6h" correctness bugs.
3. **Native/Health** (plan 3) — the two static-import fixes are sandbox-verifiable (`pnpm build`); the Health Connect permission fixes need on-device APK verification.
4. **Logic** (plan 4) — the `workout-entry` high-rep guard is a small, high-value data-integrity fix.
5. **Performance + breakup** (plan 6) — PER-1 (activity store selector) is the biggest mobile-feel/battery win; the component-breakup tasks (CB-1…CB-7) are low-risk refactors to do piecemeal.
6. **UI/charts/animations** (plan 5) — chart.js lazy-loading (shared with PER-2), chart theming, reduced-motion. Incremental polish.

Each plan ends with its own verification + commit steps. After a plan lands on `main`, follow the
`session-wrapup` skill: tick the roadmap, bump `package.json`, add a `lib/changelog.ts` entry if
user-visible, and update `projectOverview.md`.

---

## Cross-plan overlaps (do once, reference from the other plan)

- **Lazy-load chart.js** appears in both plan 5 (C1/C2/C5) and plan 6 (PER-2) — the canonical tasks live in **plan 5**; plan 6 cross-references them.
- **`workout-entry` route** appears in plan 4 (missing 1RM guard), plan 1 (repo bypass + no body bounds) — fix all three together when touching the file.
- **`health-content.tsx` calc memoization** (plan 6 PER-5) naturally falls out of the **CB-4** breakup (plan 6) — do them as one task.

---

## What this audit confirmed is already healthy (no action)

- **Timezone rule:** zero live `toISOString().slice/.split` violations; all date-sensitive API routes use `toZonedTime`/`todayMidnightUtc`/`toAestDay` with the session tz; the only date-keyed cache (`nutrition-food-logs-<date>`) uses `todayInTz()`.
- **No-hardcoded-session-names rule:** `SESSION_TO_TAB` gone; all `sessionName ===` sites compare against the user's own DB-sourced program sessions.
- **Emoji-as-iconography rule:** clean — zero emoji used as UI icons.
- **Migrations:** all idempotent (legacy raw `ADD COLUMN`/`CREATE` are wrapped in guarded `DO $$ … information_schema … $$` blocks). **Next free migration number: `064`.**
- **SQL injection / prompt injection:** none new; Drizzle parameterized; AI routes delimit user turns.
- **Samsung WebView compositor fix:** `accentCardStyle()` (`lib/utils.ts:65`) carries `willChange:'transform'`, so new home-card inline SVGs inherit Fix B — no new violation.
- **Sparkline/stats charts:** `SparklineChart` and `ExerciseStatsSheet` are already lazy-loaded, themed via CSS vars, guarded for insufficient data, and abort stale fetches.
- **Notification channels/IDs:** both channels registered; rest-timer (9001) and meal-reminder (9200–9999) id ranges don't collide.

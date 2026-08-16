## 2026-07-20 — Wiring & load-performance audit (planning session, docs-only)

**Branch:** `claude/app-audit-wiring-perf-bzz5d2` · **Type:** planning session per the
backlog-driven protocol — no code shipped, plans + backlog entries only.

Ran six parallel research sweeps across the whole app: dead/unwired API routes (all ~85 routes,
combined with the 2026-07-18 review's coverage — nothing left unaudited), cache-invalidation/TTL
discipline, instant-paint/render discipline, AI subsystem wiring, workout/running/progression
wiring (including re-verifying four previously-uncertain deep-review findings), and nutrition +
general waterfall/over-fetching patterns. Every finding was cross-checked against CLAUDE.md's
rules and the three prior review docs (2026-07-11, 2026-07-16, 2026-07-18) so nothing already
fixed was re-raised — the 2026-07-19 deep-review batch (P1-P5, Streams 1/2) is fully shipped per
today's earlier reconciliation and was treated as a baseline, not re-audited.

**New review doc:** `docs/reviews/2026-07-20-wiring-caching-perf-audit.md`.

**Seven implementation plans written and queued** (top of `docs/implementation-backlog.md`, W1–W7,
ranked above every numbered item):
- **W1** cache staleness — `achievements:` cache group missing from the nutrition and body-metric
  write paths; `supplements` today-key cache has no date guard (stale checkmarks across midnight).
- **W2** workout-screen's orchestrator-level `useShallow` selector includes per-set weight/rep/timer
  fields, re-rendering the 1680-line screen on every weight-dial tick.
- **W3** AI wiring: Workout Review's apply route lets the LLM's own self-reported confidence drive
  the mandatory low-confidence confirmation gate instead of the deterministic engine score every
  other AI surface uses (a direct violation of the "no LLM self-report gates an automatic action"
  rule); session-explain reads the dead frozen Oura Cloud readiness column instead of the new
  `live-readiness` composite — a 6th AI surface the P3 cutover missed; next-session doesn't check
  prescription expiry the way workout-data does.
- **W4** dead-route/dead-field cleanup: the friends-leaderboard "Streak" tab is fully wired to a UI
  control but the route hardcodes both streak fields to `0` (fake user-visible data); two fully
  dead routes (`sync-workout` — received real bug-fix effort today despite zero callers;
  `running-plan/explain` — built but never wired into the UI); five dead/never-rendered fields.
- **W5** deload correctness: confirming "early deload" from the home card never actually reduces
  prescribed load — it only suppresses PR writes and shows a banner, contradicting its own UI copy;
  re-verified the deep-review's E2-3 (emergency-deload can self-trigger on the session that just
  completed) is genuinely still open, not shipped.
- **W6** a small hydration-mismatch batch — three components read the cache inside a `useState`
  lazy initializer (the banned pattern), one shows a spinner instead of instant-paint, one
  reorderable list is keyed by index.
- **W7** nutrition offline-first gap — food-item search/reuse reads server-only despite the domain
  writing to the local store (a partial recurrence of the historical `food_items` incident) — plus
  a duplicate BMR/age-from-DOB formula and one harmless-but-inconsistent date-arithmetic pattern.

Also re-verified as **genuinely fixed** (no action needed): E2-8 (running-gate provisional flag),
E2-9 (HRR1 structurally null), E2-10 ("end test early" VO2max poisoning) — all three previously
flagged uncertain in the 2026-07-18 review, now confirmed correctly shipped on `main`.

**One finding recorded as a Known-Issues row instead of a plan** (no orphaned findings):
`components/workout/active-workout-screen.tsx` has grown to 814 lines, a new hotspot not on
CLAUDE.md's named list — advisory only, no obviously-correct extraction yet.

**Not exercised:** static code review only, no on-device or in-browser timing. Each plan's own
verification section names the device-smoke gate where APK-only behavior is involved (W2's
workout-screen re-render fix, W7's offline food-item search).

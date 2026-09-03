# 📖 Review Agent — baton

> **Successor sessions are titled `📖 Review Agent 🟢`** — exactly, both emoji included. The **leading**
> emoji is the role and never changes; the **trailing light** is that session's own status (🟢 live,
> 🔴 handed on) and is the only part that moves. A session self-titles 🟢 on its first instruction and
> flips itself to 🔴 as the last step of its handoff, after the baton and every PR have landed.

**Updated:** 2026-09-03 · **By:** forty-five sweeps (2026-08-17 ×2, 2026-08-18 ×37, 2026-08-20 ×1,
2026-09-03 ×5) · **Next ID: `RV-43`.**

> **Sweep 40's run is closed and nothing is owed from it** — RV-32, RV-33, RV-34 all shipped, verified
> in source rather than taken from the closure note, and their `projectOverview.md` row is in
> [`known-issues-resolved.md`](../../overview/known-issues-resolved.md). Record, with its pickup
> prompt: [`handoff-2026-08-24-…-sweep-40-write-surface.md`](../../handoff-2026-08-24-workouts-review-sweep-40-write-surface.md).

**A baton carries state, not history** — it was 1,280 lines before sweep 40 cut it. Keep it to a
screen: replace §Now each sweep and let the write-up hold the story. Nothing is lost by doing so —
every sweep has its own `docs/reviews/` write-up, indexed from the eleven `docs/domains/*/README.md`
files, and every finding is a `projectOverview.md` row or a queue entry.

---

## IDs

`RV-<n>`, counting up forever. No band, no pointer, no ledger.
`grep -rhoE '\bRV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`.

One trap in that command: `docs/agents/README.md` and `docs/implementation-backlog.md` carry
**`RV-31` as a prose example**, not an entry. Follow the lookup anyway — skipped numbers cost nothing.
Legacy `Q-` numbers stay valid where already used and are never renumbered.

## Still open — do not re-file these

From sweeps 29–39
([record](../../handoff-2026-08-20-platform-review-sweeps-29-39.md); 10 of its 13 findings shipped):
**Q-499** (self-fetching cards vanish on a failed fetch — its ten unverified candidates are a
*worklist*, not a defect count), **Q-555** (offline, a tab tap is a silent no-op before the service
worker claims the page), **Q-556** (`DELETE /api/activity-logs` reports success for a row it did not
delete). From sweeps 41-42: **RV-37** and **RV-39**, both needing the device.

**Three surfaces are explicitly unverified, not clean** — each a probe rejected on some *other* field
before the guard under test ran: `PATCH /api/activity-logs/<id>/metrics` (cross-user behaviour
unknown), and RV-40's `POST /api/complete-workout` and `POST /api/log-exercise` (malformed-id
behaviour unknown). **A 4xx is not evidence the guard fired** — read which field it names.

## Now — sweeps 41–45 filed (2026-09-03). **Next ID: `RV-43`.**

41–42 ran the owner's lens (mobile UI: safe area, back-and-return scroll, cache staleness); 43 took
rule (a); 44 the owner's nutrition/workouts/coach ask; 45 the FK edges. **41** →
[write-up](../../reviews/2026-09-03-nutrition-day-rollover-and-scroll-coverage.md), RV-35/36/37.
**42** → [write-up](../../reviews/2026-09-03-first-run-honesty-and-instant-paint.md), RV-38/39.
**43** → [write-up](../../reviews/2026-09-03-ownership-rule-a-and-body-supplied-ids.md), RV-40.
**44** → [write-up](../../reviews/2026-09-03-coach-write-bounds-vs-user-routes.md), RV-41.
**45** → [write-up](../../reviews/2026-09-03-fk-edges-meal-plan-cross-user-refs.md), RV-42.

- **A guard that exists is not a guard that reaches — all eight findings are this.** `useLocalDay()`
  (BF-86) has 3 consumers; `useScrollRestoration` (BF-100) rides `pull-to-sync.tsx`, which 3 screens
  use; `tabs-instant-paint.spec.ts` guards the 5 screens that never unmount and none of the ~20 that
  do; the "Limited data" badge is gated on `hasData`, so the no-data case cannot reach it; and
  `invalidUuidResponse` covers **27 of 27 dynamic `[id]` routes and zero body-id routes**; the Coach's
  goal bounds are a second validator five times looser than the user routes'; and `meal_plan_meals`
  checks the plan's owner but not its child ids. **Grep the call sites, and read the guard's own
  comment** — two of these name their own scope or guarantee, and neither holds.
- **The zero-data account reaches a state nothing else can** and was pointed at 2 screens. All 22 took
  one loop and found RV-38 at once. Re-run it whenever a scoring surface changes — the seeded user has
  data for everything, so a fabrication is invisible there.
- **Assert the payload beside the rendered text, and count requests by the DATE they carry.** "The card
  shows 50" is not a finding; "the route says `hasData: false` and the card shows 50" is. Health
  reissued 11 requests on resume and only 3 carried the new day — a raw count would have been wrong
  three ways.
- **Test the comment, not just the code, and send the same value to both surfaces.** RV-41 was a doc
  comment's own worked example (*"set my calories to 26000"*) sent as a request. Where two paths write
  one column, drive both in the same session — read from source, the divergence is invisible and its
  direction easy to get backwards.
- **Pair every refusal with a control, and ask what the READ joins before calling a stored cross-user
  reference a leak.** Three of sweep 45's four clean edges first returned a 400 for an *unrelated*
  reason, which reads exactly like a guard firing; the pair differs by one field and nothing else
  proves it. And RV-32's severity was an unscoped join returning another user's *name* — RV-42 is the
  same write defect with a read carrying ids only, which is the difference between a report and an
  alarm.

**Closed clean, do not re-sweep:** the seven `freshWithinTtl` sites (every writer is in a group);
`check-fetch-once-effects.js`'s CAN-BITE group (empty); instant paint on the sub-routes (13 of 14);
the first-run render (21 of 22 routes); ownership rule (a) — **all three rules now have evidence**;
and the Coach apply path's five domain handlers, now all driven end to end (write, undo, 404
cross-user, 409 stale-with-drift); and four nutrition FK edges, each with a control. **Still owed:**
RV-37 and RV-39 need the device; RV-38's and RV-41's bound questions need the owner; RV-40 leaves two
routes and sweep 45 the whole workout/device FK half **unverified, not clean**.

## Carried from sweep 40 ([write-up](../../reviews/2026-08-20-non-workout-write-surface-ownership.md))

- **✅ All three write-path ownership rules now have evidence.** (b): 116 mutating routes, 325
  `.set()` sites, all built field by field (sweep 40). (c): produced RV-32. (a): 21 unscoped child
  deletes across 12 functions, all guarded, both source incidents reproduced and refused (sweep 43).
- **A cheap contrast beats a long argument**, used seven times now: *PUT 400, POST 201* (RV-32);
  `/more` restores 840 and `/nutrition` returns 0; Home rolls the day over and Nutrition does not;
  streak says `—` and Body Battery says 50; three routes say `400 Invalid id` and two say 500; the
  user's form refuses 26,000 kcal and the Coach stores it. Find the surface that already does it right
  before arguing that it should.

## Next — in the order they are worth doing

**Not this:** the documentation-integrity seam. Sweeps 34–37 were four consecutive passes over it and
left three CI checks behind (`check-known-issue-duplication`, `check-index-doc-paths`,
`check-module-map-symbols`). Pick a lens that runs the app.

- **The remaining FK edges — the WORKOUT and DEVICE half.** Sweep 45 did the nutrition ones and found
  RV-42; `program_phases`, `schedules`, `set_hr_stats`, `blood_analytes`, `dexa_scan_regions`,
  `exercise_logs` and `prescribed_runs` are **untouched, not clean**. The inventory is **31 edges, not
  27** — re-run the query in sweep 45's write-up §2 rather than any remembered count. **Check each
  edge's `delete_rule` too**: `ON DELETE SET NULL` on an unverified FK is a cross-account write
  primitive, and `CASCADE` on the same defect would delete rather than null.
- **The 62 mutating routes that *do* carry a `try {`** were checked only for whether they map a refusal
  at all, never for whether they map it to the *right* status. Sweep 43 did this for eight body-id
  routes and found two wrong; the other ~54 are untouched, and it is now the top lens.
- **A clean clone, actually built.** Nobody has done `git clone` into an empty container and run
  `pnpm install && pnpm build && pnpm test`. It is the one check that would settle `NOTICE`'s claim outright,
  and Q-313 (no `next build` gate in the publish dry-run) is why it is worth doing.
- **The sync/outbox under a server that fails mid-push, on the device half.** Sweep 10 drove the
  server half; the local SQLite outbox has never been exercised, and it needs hardware.
- **`/api/coach/preview`, still unprobed** after three Coach sweeps — and **whether the model proposes
  sane numbers**, which no sweep has touched because every patch has been hand-written. RV-41 makes
  the second one matter more than it did.
- **Q-452's siblings — partly done by sweep 42, and what remains is narrower.** All 22 routes were
  driven as the zero-data account and are honest bar RV-38, so the *rendering* half is swept. Still
  untouched: `weekly-digest` and the coach, neither of which produces output for a zero-data account
  and so cannot be reached that way — they need a **partial**-data fixture, which does not exist yet.

## Blocked

Nothing. The standing ceiling is **the device**: everything this role runs is the **web** build, where
`getLocalStore()` returns null and every offline-first domain takes its web fallback. No safe-area,
Samsung-WebView, native-plugin or native-SQLite finding can originate here, and every write-up must say so.

Production is partly open — `claude_ro` is **row-scoped to the owner**, so a second real account is out of
reach there specifically. When the *victim* of a bug is another account, that view structurally cannot see
it: write "no evidence in the owner's rows", never "it has not happened".

## Claimed paths

None. This role's PRs are docs-only.

## Do not re-litigate

- Authority limits and the lane contract are settled in [`docs/agents/README.md`](../README.md).
- **Queue position is priority; the ID is not.** An `RV-32` above a `Q-331` is deliberate.
- **Before writing a surface off as unreachable, spend ten minutes trying. Five for five now** — one env
  var, one `context.setOffline(true)`, an account the harness already had, `page.clock` for crossing
  midnight (sweep 41), and that same zero-data account pointed at 22 routes instead of 2 (sweep 42).

## Method notes — do not re-derive these

- `pnpm install --frozen-lockfile` first if `node_modules` is missing (`@sentry/nextjs` failing to resolve
  is the tell), then `pnpm db:local`, then **`env -u DATABASE_URL -u DATABASE_SSL pnpm dev`**. Both vars are
  pre-set to production in the container and Next will not let `.env.local` override an already-set
  `process.env` var — without the `env -u` the dev server silently tries production and fails.
- Launch the dev server with `nohup … &` through a **background** Bash call. A `(cmd &)` subshell gets
  reaped when the tool call returns.
- API sweeps: sign in with `curl` via `/api/auth/csrf` → `/api/auth/callback/credentials`
  (`test@local.dev` / `testpass123`) into a cookie jar. A second account is two minutes: insert a row
  copying the seeded user's `password_hash` with `is_active = true` — **without `is_active`, sign-in 302s
  and leaves a null session**, which reads like broken login and is the invite gate working.
- Screens: temporary specs in `e2e/`, run against the already-running server with
  `E2E_BASE_URL=http://localhost:3000` **and `DATABASE_URL=…` set** (`zero-data.setup.ts` fails loudly
  without it, before your spec runs). **Delete the spec and `test-results/` before committing.**
- **This container's clone is SHALLOW.** After `git fetch origin main`, a merge can fail with
  *"refusing to merge unrelated histories"* and `git merge-base HEAD origin/main` can print nothing —
  neither means divergence. The fetched commits simply do not reach back past the shallow boundary.
  `git fetch --unshallow origin` fixes it in one call, and the merge base appears immediately. Do not
  reach for `--allow-unrelated-histories`; it would graft two disjoint trees together.
- **`get_check_runs` returning `total_count: 0` has a third cause, and it is the likeliest one here.**
  `CLAUDE.md` names a stale base; the PR field to read is **`mergeable_state`**. `dirty` means a merge
  conflict, and **GitHub runs no PR checks at all while it cannot compute the merge commit** — so a
  conflicted PR looks exactly like CI that never fired. Sweep 40 lost fifteen minutes to this with a
  base that was provably current (`git merge-base --is-ancestor origin/main HEAD` passed). Resolve the
  conflict and the checks start within seconds; `unstable` means mergeable with checks still running.
  **Check `mergeable_state` before waiting on anything.**
- **Crossing local midnight is one Playwright call** — `page.clock.install({time})`, `fastForward`,
  then dispatch `visibilitychange`. That measured every tab's day-rollover in one run (sweep 41).
  `faketime` neither helps nor is needed.
- **`page.goto()` is a HARD navigation and makes every screen look broken:** React cleanup never runs,
  so nothing saves its scroll offset — sweep 41's first table read `{}` for `/more`, the screen that
  provably works. Drive a real in-app click. And a screen with nothing to scroll fails identically to
  a broken one, so assert the precondition. Two more traps on BF-100's four, all reporting
  `expected N, received 0`.
- **Assert every probe reached a real route.** Next's HTML 404 for an unmatched path is indistinguishable
  from an access-control rejection by status alone — the tell is the body, HTML vs JSON. A 405 means the
  route is real and the verb is wrong; check the handler before concluding anything.
- **Read the row back out of Postgres.** A 2xx cannot distinguish "did it" from "ignored it safely", and a
  response body echoing your input proves nothing about what was stored.
- **Expect your probe to be wrong in the direction of your hypothesis.** Sweeps 36–39 produced four
  measurement errors, every one plausible, specific and publishable as written. **Corroboration between two
  weak signals is not evidence when they can fail for the same reason** — prefer one signal that cannot be
  faked over two that agree.
- First-visit renders are confounded by Turbopack compile time; anything that looks sparse must be
  re-checked warm before it is believed.
- **Before running the docs compaction chore, check the open-PR list** — it is a whole-directory operation
  and has been done in duplicate twice. And when a durable doc cites a session, cite the **review or handoff
  doc**, never the loose journal entry: the linked-entry floor tracks durable-doc citations, not entry count.

## Where the earlier sweeps live

**All eleven pillars have been reviewed at least once.** Read the write-ups by *subject*, through
`docs/domains/*/README.md`, rather than in sweep order — the pillar index is what that is for.

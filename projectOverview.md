# TrainingAI — Project Overview

> **Lean index — orient here, then dive.** This file holds the current status, the live Known
> Issues & Risks, and the What's Left To Do list. Nothing else. The per-session journal lives under
> `docs/overview/`; the Document Map at the bottom routes everything else.
>
> It is kept lean on purpose, and it has drifted twice. If you are about to append a dated summary
> of what you just shipped, that belongs in your journal entry, not here.

**The documentation flow at a glance:**

| Kind of work | Where it lives |
|---|---|
| **Who does what** | [`docs/agents/README.md`](docs/agents/README.md) — the six standing agents, their authority, and the two-lane file-ownership contract. Read this before starting a session. |
| **Upcoming — ready to build** | [`docs/implementation-backlog.md`](docs/implementation-backlog.md) — a priority-ordered queue; implementer sessions take the top item per the protocol in that file |
| **Upcoming — ideas/findings** | [`docs/planned_upgrades.md`](docs/planned_upgrades.md) — open uplift ideas; they graduate to the backlog once a session writes their implementation plan |
| **Completed — session journal** | `docs/overview/entries/` (current window, one file per PR) then the batched `docs/overview/history-*.md` |
| **Completed — shipped plans/specs** | `docs/superpowers/plans/archive/` and `docs/superpowers/specs/archive/` |
| **Completed — shipped uplift ideas** | `docs/overview/uplift-archive.md` |
| **Architecture reference** | the top of [`CLAUDE.md`](CLAUDE.md) — stack, data model, key files, Oura integration (authoritative, kept current) |
| **Session handoffs** | `docs/handoff-YYYY-MM-DD-<domain>-<title>.md` — the **only** handoff convention (there is no root `HANDOFF.md`). `ls docs/handoff-*-<pillar>-*.md` finds every handoff for a pillar; the pillar index at `docs/domains/<pillar>/README.md` links the ones that matter. Written via the `handoff` skill — see **Session Wrap-Up** in [`CLAUDE.md`](CLAUDE.md). |

---

## 🔖 Current Status

**Version:** v1.318.10 · **Branch:** `main` · Railway auto-deploys on push to `main`.
**Last updated:** 2026-08-20.

**The public repository is now the working repo.** `nekodas-neko/TrainingAi_Open` carries the
history that was ported out of the archived private repo (PRs #1, #3, #7). The archived repo is
reference only — nothing lands there.

**Work runs through six standing agents.** Two Implementation lanes split the backlog by file
ownership, plus an Orchestrator owning the queue and docs, and a BugFix, a Tuning and a Review
agent. Their roles, authority limits, lane contract and cold-start prompts are in
[`docs/agents/README.md`](docs/agents/README.md). Start there, not straight off the queue.

**Entry IDs come from your agent's own prefix now, not a reserved band** (2026-08-19). `LA-` Lane A ·
`LB-` Lane B · `BF-` BugFix · `RV-` Review · `TN-` Tuning · `PS-` one-off sessions, counting up with
no shared pointer to collide on. Bands exhausted and their ledger drifted twice; the prefix says who
*found* an item and never changes, so an entry filed by Review and built by Lane A keeps its `RV-`.
Legacy `Q-` numbers stay valid and are not renumbered. **An implementer's first command is now
`node scripts/next-item.js --lane <A|B>`**, which prints READY / PARKED / UNCLASSIFIED from the new
`Needs:` and `Gate: owner|device` fields — the queue file cannot show you which of its top entries
are actually startable.

**Session handoff:** [`docs/handoff-2026-08-20-platform-migration-gate-and-energy-weight.md`](docs/handoff-2026-08-20-platform-migration-gate-and-energy-weight.md)
— the CI job named **Migration Check** could not fail on a broken migration, and fixing that
immediately caught one: `142_claude_ro_views.sql` creates a view over a table `143` creates, so on
every fresh CI database 142 aborted and every view below it rolled back, in three green jobs. Also
the CSP's missing `'wasm-unsafe-eval'`, and the done screen estimating calories from the first
weight ever logged. **PS-3 closed on top of it (2026-08-20):** the four migrations that failed on a
database already holding their objects — and so were retried on every cold start — are idempotent,
and the dev database now records 206 of 206
([journal](docs/overview/entries/2026-08-20-non-idempotent-migrations.md)).

**Q-331 closed on top of that (2026-08-20, v1.333.1):** the done screen and the day screen were
estimating the same workout with **different formulas** — Q-421 gave the day path a heart-rate
estimate and left the done screen's route on the MET fallback, so the 42 of 78 sessions carrying an
`avg_bpm` were reported twice, differently. Both now call one `estSessionKcal`, and a
mutation-verified parity test fails if either side drifts again
([journal](docs/overview/entries/2026-08-20-session-energy-cross-surface-parity.md)).

**Session handoff:** [`docs/handoff-2026-08-20-workouts-energy-accuracy-and-rpe-intake.md`](docs/handoff-2026-08-20-workouts-energy-accuracy-and-rpe-intake.md)
— the intake pass behind that energy work, from the owner's *"how can we make energy usage/burned
from excercuse more accurate"*. Read it as reasoning rather than status: three of its six entries
were built by Lane A within hours of being filed.

**Session handoff:** [`docs/handoff-2026-08-17-platform-agent-model-and-device-session-findings.md`](docs/handoff-2026-08-17-platform-agent-model-and-device-session-findings.md)
— the agent model itself, plus six findings from a live APK reinstall and Oura re-sync. **Q-536 is
CLOSED (2026-08-17, confirmed on device)**: the 43 wrong sleep windows came from a re-drain misread
as a clock reset, and migrations 189 + 190 plus a redecode took the midday cluster to 4 short
daytime fragments. Its *cause* — **Q-314** — is still live, so every re-pair reopens it.

**Open at the time of writing:** PR #6 (session notes the public cut did not carry), PR #10 (the
public-repo migration handoff). Check `list_pull_requests` rather than trusting this line — it is a
snapshot, not a live view, and it was already three PRs out of date once.

**What shipped recently is in the journal, not here.** Read `docs/overview/entries/` for the current
window, then the newest `history-*.md`. The 157 dated status notes this section used to carry were
archived to [`docs/overview/status-archive.md`](docs/overview/status-archive.md) on 2026-08-17 —
they had stopped being *current* status somewhere around the fortieth one, and were never in date
order.

---

## ⚠️ Known Issues & Risks With Recently Shipped Features

> **This section is the OPEN issues. Resolved ones live in
> [`docs/overview/known-issues-resolved.md`](docs/overview/known-issues-resolved.md)** — 53 entries,
> 1,092 lines, moved out 2026-08-13. **Grep the archive before concluding something has never been
> looked at**; "we already fixed that, and here is what it turned out to be" is why they are kept.
>
> **Striking an issue means MOVING it there, not marking it ✅ in place** (`CLAUDE.md`, Session
> Wrap-Up step 2). Without that rule this regrows — 72 ✅ entries had accumulated before the first
> sweep, and 53 of them had nothing outstanding at all.
>
> An entry only leaves when **nothing is still owed**: no open work, no pending owner or device
> check, no un-run follow-up. Nineteen ✅-marked entries stayed for exactly that reason and are still
> below.

### [workouts][platform][nutrition] 🟠 Three write paths accept another user's progression-style id; the PUT twin of one of them rejects it (RV-32…RV-34, 2026-08-20)

- **The non-workout write surface, probed live with two signed-in accounts**, closing the top item on
  the Review baton's "Next" list since sweep 3.
  [`docs/reviews/2026-08-20-non-workout-write-surface-ownership.md`](docs/reviews/2026-08-20-non-workout-write-surface-ownership.md).
- **🟠 RV-32 — `POST /api/phase-sets`, `POST /api/workout-templates` and `POST /api/log-exercise` all
  persist a `progression_styles` id owned by another user.** `PUT /api/phase-sets/[id]` refuses the
  **identical value** with `400 Invalid primaryStyleId` — same resource, same session. The check exists
  fourteen lines away in the sibling file and was never copied into the create twin. Each accepted row
  was read back out of Postgres with a join proving a different owner.
- **What it costs, measured rather than assumed.** `listPhaseSets` joins the style name in **without a
  user scope**, so `GET /api/phase-sets` returned **the other account's style name**, and that field
  renders in the workout-builder review and goes into an LLM prompt. It stops there: every other read of
  `progression_styles` is `user_id`-scoped, so the borrowed style's set structure never reaches the
  borrower. Separately, all three FKs are `ON DELETE SET NULL` — **deleting your own style nulls a column
  in another user's program and workout history.**
- **🟡 RV-34 — a client-supplied `program_sessions.id` that is not yours is a raw `pg 23505` 500** plus an
  `error_events` row. It fails closed, but by accident of a primary-key constraint rather than by design.
- **🟡 RV-33 — two routes answer a correct ownership refusal with an empty-bodied 500** (`POST
  /api/progression-styles`, `PATCH /api/nutrition/food-logs/[id]`), each filing it into `error_events` as
  a server fault. The Q-462/Q-463 class, on two routes that fix missed. **Neither is a leak or an outbox
  wedge** — both were checked.
- **✅ `CLAUDE.md` write-path ownership rule (b) — a raw request body into Drizzle `.set()` — is audited
  for the first time and is clean.** 116 mutating routes, 325 `.set()` sites, the 21 taking a bare
  identifier or spread each traced to source: every one built field by field. Confirmed live —
  `PATCH /api/user/profile` sent `isAdmin`, `id` and `passwordHash` and changed none of them. **Rule (a)
  is now the only one of the three with no evidence behind it.**
- **Not exploited in the data available:** production shows 0 of 46 phase rows, 0 of 82 styled
  `session_exercises` and 0 of 280 styled `exercise_logs` pointing outside the owner's styles. `claude_ro`
  is row-scoped to the owner and **the victim's rows are the ones it cannot show** — that is "no evidence",
  not "has not happened".
- **Not exercised:** web build only (`getLocalStore()` is null), local DB for the writes, two accounts.
  The 23 other FK edges into user-scoped tables are inventoried in the write-up and unprobed.


### [platform][devices] 🟡 The CSP now permits WASM, and dropped two dead hosts — neither checked on the device (Q-546, 2026-08-20)

- **What shipped.** `script-src` gained **`'wasm-unsafe-eval'`**, which permits WebAssembly
  compilation and nothing else. Without it no WASM session can start in the browser, so every
  on-device model was blocked behind a one-line change — `onnxruntime-web` is already a dependency
  with a passing parity test, and that test runs under Node, which enforces no CSP at all. It proved
  the model matched its golden while nothing could have loaded it.
- **And `connect-src` lost `cloud.ouraring.com` and `api.ouraring.com`**, seven days after the Oura
  Cloud integration was deleted. `lib/oura/__tests__/no-cloud-calls.test.ts` already proved no source
  file calls them — but it swept `app/`, `components/`, `lib/` and `packages/shared/src`, and the CSP
  lived in `next.config.ts` at the repo root, where nothing looked. The guard now sweeps five root
  files too, and fails if one is renamed out of the sweep.
- **⚠ NOT verified on device.** The APK is a WebView loading the Railway URL, so it receives this
  header. `pnpm dev` serves the new directive and the app renders under it, and the deployed header
  can be read with `curl -sI`, but **neither shows the S25's WebView accepting it**. Two things are
  outstanding: that the app still loads normally on the device after the deploy, and — separately,
  and not possible yet — that a real WASM session instantiates, which cannot be asserted until the
  first client-side model actually lands. That assertion belongs in that PR, not this one.
- **`'wasm-unsafe-eval'` is narrower than `'unsafe-eval'`**, does not imply it, and production still
  does not carry `'unsafe-eval'` — a test asserts both halves of that.
- **One thing measured but deliberately not acted on:** `onnxruntime-web` 1.27 can create workers
  from a blob URL when threading/proxying is enabled, which `script-src` would also have to permit.
  Whether that configuration is used is a decision for the PR that adds the first client model, and
  widening a security header on speculation is the wrong order.

### [nutrition] Food logs changed shape three times in one day and none of it is device-verified (Q-413, Q-325, Q-412 · v1.327.0–1.328.0) — NOT verified on device · needs: hardware

- **What shipped**, all on `food_logs`, which is **offline-first** — so the local mirror is where a
  sync half fails silently, and `pnpm dev` proves the server half only (`getLocalStore` returns null
  in the web sandbox).
  - **Q-413** — `logged_at` now means when you *ate*, not when you tapped: inside the meal's window on
    the log's own date keeps the real instant, otherwise it takes the window midpoint in the user's
    timezone. Migration **203** corrected stored rows whose timestamp fell on a different local date
    than their `date`. [`journal`](docs/overview/entries/2026-08-19-resolve-eaten-at.md).
  - **Q-325** — `applyDelta`'s `food_logs` conflict arm updated only 4 of 8 columns, so a device that
    already held a row could never learn a changed `date`, `meal_type_id`, `food_item_id` or
    `logged_at`. **Without this, Q-413's corrections would have stopped at the server.**
  - **Q-412** — a meal type with entries can be deleted by moving them, in one transaction, with each
    moved row re-timed against the new window.
    [`journal`](docs/overview/entries/2026-08-19-meal-type-reassign.md).
- **The checks owed**, all on the APK:
  1. Back-fill yesterday's dinner **while offline** and confirm the row shows the window midpoint
     rather than the current time — before *and* after it syncs. That is the pair that proves the
     local resolver and Q-325's pull together.
  2. Reassign a meal type that has logs, then confirm the entries appear under the new type with the
     same calories, the day total is unchanged, and it survives an app restart.
- **Why it is one row rather than three:** the same offline path carries all three, and one session
  on the device settles them together.

- **A deliberate, stated cost in Q-413's migration:** it corrected only rows whose timestamp fell on
  a *different local date* than their own `date`. A pre-existing row logged on the right day but
  outside its meal's window keeps its original time, while an identical new row is moved to the
  midpoint. So a handful of historical points sit outside their meal's window. That was the
  conservative choice — where the user logged as they ate, the stored instant is the better datum —
  and Q-414's chart entry carries the caveat so it is not met as a surprise.

### [nutrition][platform] Meal label saves to the gallery and declares 600 dpi (Q-400, v1.326.0) — NOT verified on device · needs: hardware + a printer

- **What shipped**: the dead "Share or save" button became **Save to gallery** (native, over a new
  `MediaSave` bridge → MediaStore) and **Share** (system sheet, `canShare` guard kept), every branch
  ending in a toast; and the PNG both hand out now carries a `pHYs` chunk declaring its density.
  [`journal`](docs/overview/entries/2026-08-19-label-save-to-gallery.md).
- **Why it is here**: **needs a new APK**, and both fixes are unobservable from the sandbox — the
  gallery write goes through a bridge that does not exist in a browser, and whether a printer honours
  `pHYs` is a physical measurement. What *was* verified: the chunk read back out of a real PNG by an
  independent decoder (**600.0 dpi** → 1,179 px measures **49.9 mm**, against **311.9 mm** unstamped),
  and two E2E tests driving the real button.
- **The check owed**: install the APK, tap Save, find the file in the Samsung Gallery. Then print
  once and measure against `metrics.codeMm`. **That single print also answers Q-411** — whether the
  circle template crops (module holds at 0.56 mm) or scales (falls to 0.397).
- **Known limitation**: below Android 10 the save reports unavailable rather than falling back, and
  the native paths never fall through to the browser download — in the WebView that is a no-op, so a
  fall-through would toast success and produce nothing.

### [platform] 🟡 ACCEPTED RISK: a revoked admin keeps catalogue write access for ≤24h (Q-479, 2026-08-18)

- **Owner decision, 2026-08-18: not fixing now — "only admin will be me for a long time."** The fix
  is written, tested and CI-green; it is deliberately unmerged. Do **not** re-implement it: the
  branch is `fix/exercises-route-admin-db-check` and the PR is #124.
- **What it is.** `app/api/exercises` authorises from the session's `isAdmin` JWT claim rather than
  reading the row, because it calls `isAdminUser(userId, isAdmin)` — which *returns the passed flag*
  when given one. Its 61 sibling API routes call `requireAdmin`, which reads the row every call and
  refuses to trust the claim. The claim refreshes at most once a day (`ISACTIVE_RECHECK_MS`).
- **Measured**, admin granted → fresh login → token warmed → admin revoked in the DB, no re-login,
  cookie rotation persisted: `POST /api/exercises` **201** (row created in `exercise_library`)
  against `GET /api/admin/errors` **403**, same cookie, same instant, database already saying no.
- **Why accepting it is reasonable, stated so it can be re-checked rather than re-argued.** The
  window opens only on **revocation**. With a single permanent admin, admin is never revoked, so the
  window never opens. The blast radius is also rows in a shared catalogue, not user data.
- **What makes it live again** — any of these, and #124 should merge:
  - a second admin is granted and later revoked;
  - the Play Store / multi-user path in Canonical Runtime advances, since that is where non-owner
    accounts and a real admin/non-admin boundary arrive;
  - `isAdminUser` gains another API-route caller. `scripts/check-admin-claim-in-api.js` on that
    branch would catch it — but that check is **not on `main`**, because it ships with #124.
- **Also unmerged with it:** the correction to `lib/auth/is-active-refresh.ts`, whose docstring
  currently claims *"This governs the UI only: `requireAdmin` reads the row from the database on
  every call and never trusts this claim."* **That sentence is false for this one route**, and it is
  why the gap went unseen — a reviewer who reads it stops looking. Until #124 lands, treat that
  comment as wrong.

### [activity][platform] 🟢 Cross-user isolation holds; one route reports a success it did not perform (Q-556, 2026-08-18)

- **The last reachable "structurally untested" item — a second account — driven for real.** The local
  harness already had a zero-data account with a saved session, so it needed no new infrastructure.
  **Third time this run an "unreachable" surface was not.**
  [`docs/reviews/2026-08-18-cross-user-isolation.md`](docs/reviews/2026-08-18-cross-user-isolation.md).
- **✅ 10 of 11 probes rejected by the route's own ownership check** — reading A's recap/energy/timing,
  deleting A's workout, **logging a set into A's session**, completing A's workout. **And the
  enumeration control passed:** a nonexistent id and A's id return byte-identical responses, so no
  route confirms which ids exist.
- **🟢 Q-556 — `DELETE /api/activity-logs` returns `200 {"success":true}` for another user's row.**
  **Not a leak, and that was checked:** the DB immediately after shows the row intact, `deleted_at`
  NULL, still A's. The repo method returns `void`, so the handler cannot know and answers success
  unconditionally. Filed because it is **inconsistent with every sibling** (house posture is 404 for
  both cases) and because **offline-first makes a false success expensive** — a 2xx confirms and drops
  an outbox mutation. That second path was **not demonstrated**.
- **⚠️ The first run of this sweep reported eleven clean results and proved almost nothing** — six hit
  routes that do not exist (HTML 404s, which read exactly like an access-control pass) and one failed
  schema validation first. **A 404 from an unmatched route is not evidence of access control**, and the
  tell was in the body, not the status.
- **Not exercised:** one probe (`PATCH …/metrics`) still failed validation, so that check is unverified.
  Local DB + web build; not production, not device; two accounts only.


### [app-shell][platform] 🟢 Offline read surfaces work; a tab tap is a silent no-op only before the SW claims (Q-555, 2026-08-18)

- **The offline paths were driven for real for the first time** — this role's baton had listed them as
  structurally untested since sweep 1, and `context.setOffline(true)` turned out to be the whole
  barrier. [`docs/reviews/2026-08-18-offline-read-surfaces.md`](docs/reviews/2026-08-18-offline-read-surfaces.md).
- **✅ Both paths deliver once the worker controls the page.** A full reload offline serves the
  precached `/offline` page verbatim (and the precache works under `next dev`). An offline tab tap
  navigates and paints **2515 chars against 2486 online — ~101%** — no offline page, no skeleton, no
  blank. **This is the strongest positive result of the run; the offline story is not aspirational.**
- **🟢 Q-555 — the narrow gap.** In the **uncontrolled** state the same tap is a **silent no-op**: URL
  unchanged, no navigation, no offline page, no feedback. That state **is the first-ever page load** —
  the worker registers during it and claims only afterwards. Filed because the symptom is
  indistinguishable from a frozen app, and on the APK the worker **is** the offline cold-start
  mechanism, so install day is when a new user is most likely to be changing networks.
- **⚠️ Three of five probe iterations produced plausible, specific, wrong answers** — all retracted
  before filing. The keeper: a "38% retained" figure and a marker match **agreed with each other and
  both failed for the same reason** (the home page renders widgets labelled Readiness/Sleep/Activity).
  Only the URL settled it. **Corroboration between two weak signals is not evidence when they can fail
  the same way.**
- **Not exercised — load-bearing:** web only. On web `cachedFetch` falls back to `localStorage`, so the
  **seed** path was verified, **not** the native SQLite store that is the APK's real source of truth.


### [platform] 🟢 The module map's `path → symbol` claims all hold — 110 of 110, now ratcheted (2026-08-18)

- **A clean sweep, recorded because a null result is easy to under-report.**
  [`docs/reviews/2026-08-18-module-map-symbol-claims.md`](docs/reviews/2026-08-18-module-map-symbol-claims.md).
- **Took Q-554's stated limit as the lens.** That check proves a path *resolves*, never that the prose
  beside it is true. The mechanically checkable part of the prose is the `→ symbolName` claim — the
  part a reader acts on. **All 110 name a symbol that exists in the file they attribute it to.**
- **This bounds the Q-554 worry rather than leaving it open.** Row 232 (a map row for a module never
  built) was **not** the tip of a pattern of sloppy attribution — it was one row, and its path was
  wrong too, which is why the cheaper check caught it. The map's attribution is in good shape.
- **⚠️ A correction inside the measurement.** The first probe reported 72 of 110 rows resolvable —
  implying 38 broken paths, flatly contradicting the check shipped an hour earlier. The **probe** was
  wrong: it omitted the `lib/…` → `packages/shared/src/…` remap (Q-153). **A new measurement that
  contradicts an existing green check is a bug in the measurement until proven otherwise.**
- **Ratcheted:** `scripts/check-module-map-symbols.js`, step **43 of 43**. A presence check, not a
  resolver — the failure worth catching (a symbol that moved, leaving the map pointing at its old
  home) shows up as absence. It earns its place at zero violations because *"One Formula, One Place"*
  names this map as how you find the existing implementation, so a row pointing at the wrong file is
  how the second copy gets written — **by someone who checked first, as instructed.**
- **Not exercised:** a row naming a real file and a real function while describing behaviour neither
  has still passes. That half remains unmeasured.


### [app-shell][health] 🟢 Three lenses — two clean, and cards that cannot tell "no data" from "the fetch failed" (Q-499, 2026-08-18)

- **Two lenses came up clean and are recorded so nobody re-runs them.**
  [`docs/reviews/2026-08-18-silent-card-failures.md`](docs/reviews/2026-08-18-silent-card-failures.md).
  **(1) Internal error text in responses** — 7 route files return `err.message`, every one admin- or
  session-gated, two apparent hits are logs not responses, and `admin/db-query` returning the raw SQL
  error is **correct by design**. **(2) AI rate-limit coverage** — 7 routes looked unlimited; all seven
  make **zero LLM calls** and matched on the `ai` path segment alone. **Every route that actually
  calls an LLM has a rate limit.** Sixth consecutive sweep where the mechanical check over-reported.
- **🟢 Q-499 — and a correction to the rule that names it.** `CLAUDE.md` says `cachedFetch` *"swallows
  `!res.ok`"*; it does **not** unconditionally — `cachedFetchCore` takes an `onError` callback and
  swallows only when the caller declines it. So this is **coverage with an existing mechanism**, not a
  missing capability, and the rule's wording should say so.
- **78 components call `cachedFetch`; 18 reference `onError`** (an upper bound — some are unrelated
  matches). **Two verified by hand**, both conflating failure with emptiness:
  `health/hr-recovery-profile-card.tsx` (`return null` while `profile` stays null on failure) and
  `health/strength-progress-card.tsx` (`.catch(() => {})` then `return null`).
- **Scoped honestly:** 12 candidates from a crude filter, **2 confirmed** — the other ten are a
  worklist, not a defect count.
- **Why it matters more than it looks:** `cachedFetch` treats any `!res.ok` alike, **including a 429
  from the app's own limiter** — a rate-limited user watches health cards vanish rather than seeing
  "try again in a minute", and the same silence covers a 500.
- **✅ REPRODUCED 2026-08-18 (sweep 34)** —
  [`docs/reviews/2026-08-18-card-429-reproduction.md`](docs/reviews/2026-08-18-card-429-reproduction.md).
  `/api/weights-summary` forced to 429 by route interception at the S25 viewport: **`Estimated 1RM`
  went 1 node → 0, with no error wording anywhere on the page.** **Control holds** — blocking a
  different endpoint left it at 1. (`Ring Status` inconclusive: absent at baseline too.)
- **⚠️ Invisible on a warm cache, visible on a cold one.** A repeat visit paints the seed and the
  failed refresh is silent. So the user most likely to hit it is opening fresh, and least likely to
  reproduce it a minute later — *"the card is gone"* reads as **intermittent**, inviting the
  "can't reproduce" dismissal the report-invalidation rule exists to prevent.
- **Still not exercised:** on device and offline (where `cachedFetch` cannot revalidate at all). **One**
  card proven; the other eleven remain a worklist.


### [platform][app-shell][readiness] 🟢 This run's own findings checked against production — one refuted, two re-scoped, one new (Q-472, 2026-08-18)

- **The lens was to measure my own claims.** Seven sweeps filed 22 findings (Q-450…Q-471), almost all
  from code-reading and a local seeded database; `claude_ro` had never been queried directly in any of
  them. More of this write-up is corrections than discoveries, which is the point of running it:
  [`docs/reviews/2026-08-18-production-verification.md`](docs/reviews/2026-08-18-production-verification.md).
- **🆕 Q-472 — the Coach's write capability has never once been used.** `coach_changes` is **empty**:
  no applied change, ever. The Coach is *not* unused (5 threads, 16 messages, 17 calls in 30 days) and
  the widgets render — 8 of 8 assistant messages carry a tool, 5 a `choice_list`, **1 a
  `change_preview`** — but **0 changes were applied**. Apply is **not** broken (the previous sweep
  applied a patch through the real route). Whether the model rarely proposes or the one proposal was
  declined is **not determinable from this data**. Filed as an owner decision, not a defect.
- **🔎 Q-467 and Q-468 re-scoped, not closed.** Both are real code defects; both have **zero
  production exposure**. Nothing has ever been applied, so nothing has ever needed undoing, and no
  `target_id` carries more than one change. Their top-of-queue placement was priced on exposure that
  does not exist yet.
- **🔎 Q-465 refuted in practice — and my first query was wrong.** It reported "45 of 50 check-ins
  entirely empty"; that query tested only the seven evening columns and ignored six morning ones. Re-run
  across **every** answer column: **zero truly-empty rows** (45 morning, 5 evening, all with answers).
  The route will write a hollow row if handed `{}`; nothing in real use has. The false 45/50 is recorded
  in the entry so it cannot be picked up from anywhere it leaked.
- **🔎 Q-460 cannot be adjudicated from production.** 57 of 77 completed sessions (74%) carry no
  `session_rpe` — which looks supportive and **is not evidence**, because a dropped write leaves the
  value in the local store this endpoint cannot see, making it identical to a skipped optional prompt.
  **Do not cite the 74% in either direction.**
- **✅ `error_events` holds nothing new** (the session-start read, done properly). The 30-day table is
  dominated by **5,771** `[pg 21000]` cardinality violations on `POST /api/hr-ingest` — **already
  recorded and already fixed**, with the last occurrence (2026-08-13) being the fix landing rather than
  a fault that stopped unexplained. Everything else is connection-timeout/`aborted` noise mapping to the
  recorded pool and disk-full incidents. Nothing unrecorded in 7 or 30 days.
- **The constraint governing every number above:** `claude_ro` is **row-scoped to one user** and
  `error_events` prunes at 30 days. Every count is *the owner's data, recently* — never "the system's".
  A zero means the owner has never done the thing; other accounts are structurally invisible here.

### [app-shell] 🟡 Nine collapsibles still ship no `aria-expanded` — and it is the third hand-maintained count in `CLAUDE.md` found stale this run (Q-491, 2026-08-18)

- **A named list with a date is checkable, which is the reason to write one.** `CLAUDE.md` names nine
  chevron toggles lacking `aria-expanded`, re-counted 2026-08-09. Re-checked:
  [`docs/reviews/2026-08-18-aria-expanded-collapsibles.md`](docs/reviews/2026-08-18-aria-expanded-collapsibles.md).
- **Still 9, but not the same 9.** `more/profile-tab.tsx` is **fixed** (0 chevrons remain);
  `components/weights-summary.tsx` has the defect and **was never on the list**; `deload-explanation`
  and `signal-sections` have **moved**, so the paths in the rule are stale. The other six are unchanged.
- **One partially compensates:** `weights-summary.tsx` carries `aria-label={collapsed ? "Expand" :
  "Collapse"}`, so state does reach a screen reader — just not through the attribute that also
  expresses the control→region relationship.
- **Severity low and the reason is honest:** no known screen-reader user. Filed because the stated
  direction is a **Play Store listing**, where accessibility is a review surface, and because the
  recommended fix removes a maintenance burden rather than adding one.
- **Prefer the ratchet over the sweep.** Nine attributes are easy to add and will drift again.
  `CLAUDE.md`'s own rule says to prefer Radix `Collapsible`, **which supplies both attributes for
  free**; then a shrink-only Custom Rules count so the list stops needing a human.
- **⚠️ The pattern is worth more than the finding — third stale hand-maintained count this run:**
  Q-480 (repo helpers described as hardcoding a timezone they take as a parameter), Q-490 (*"both
  long-standing memos"* — there are **66**), and this one. **Every ratcheted count is current** — hex
  literals, TTL divergence, component size, doc-index size, backlog pointers. This file already drew
  that lesson for hex literals (*"recorded here as improving and it was not … because this line was
  prose and nothing measured it"*); it applies to its own prose. **A count in prose is a claim with a
  decay date; a count in a script is a fact.**
- **Not verified: no screen-reader testing** — the claim is that the attribute is absent, not that an
  announcement is wrong. Not on the APK, where TalkBack is the relevant reader. `coach-content.tsx`
  was examined and **excluded** (its chevron is a back button).

### [app-shell] ✅ The other four render rules audited — all held, and every mechanical check over-reported (2026-08-18)

- **Completes the render lens** that sweep 26 opened.
  [`docs/reviews/2026-08-18-render-hot-paths.md`](docs/reviews/2026-08-18-render-hot-paths.md). Filed
  nothing; Q-490 remains the only open item in this area.
- **`key={index}` in editable lists — held.** 85 occurrences exist, but filtering to lists that are
  **both editable and deletable** gives **zero**, and the known editable lists key on stable ids
  (`meal.id`, `item.id`, `style.id`, `program.id`). **Reporting the 85 would have been wrong** — index
  keys on a static list are correct React.
- **A 1 Hz timer in the orchestrator — held.** `workout-screen.tsx:797` does hold a `setInterval`, and
  it writes `recordTraceSample(...)` to a module singleton with **no `setState`** — which is the
  pattern the rule wants, and its comment says so.
- **Zustand selector breadth — held.** The orchestrator's `useShallow` pick is **62 fields**, which
  looks alarming and is not: the hot-path *values* (`perSetWeights`, `rpeValues`) are **absent**; only
  their *actions* are picked, and action references are stable. The leaves read the values via their
  own narrow selectors (`active-set-card.tsx:40,44`). **Counting fields in a pick is not the test —
  actions vs values is.**
- **`readCacheSync` in a render body — held, and the grep flagged the rule itself.** 25 hits outside an
  effect/callback; the three in the orchestrator are all false positives, and the first
  (`workout-screen.tsx:264`) is **the comment stating the rule** — *"readCacheSync must never live in
  that path"* — reported as a breach of that rule.
- **The standing lesson, now six sweeps running:** every mechanical check here over-reported. The raw
  counts — 85 index keys, 62 picked fields, 25 bare cache reads — are all defensible, and a review
  that filed them would have produced three wrong entries and one absurd one. **The grep finds
  candidates; the handler decides.**
- **Not verified:** static analysis, no profiler, not on the APK.

### [nutrition][app-shell] 🟡 64 of 66 memos hold; the two that do not re-render every meal row on every keystroke (Q-490, 2026-08-18)

- **`CLAUDE.md` warns that an inline object or arrow "defeats the memo silently" — a defeated memo
  looks optimised and does nothing.** Nobody had checked whether the current ones hold.
  [`docs/reviews/2026-08-18-memo-stability-audit.md`](docs/reviews/2026-08-18-memo-stability-audit.md).
- **The headline is the clean part: 64 of 66 hold, and there are no inline arrows anywhere** in a
  memoised component's props. The discipline the rule asks for is being kept almost everywhere.
- **The two exceptions are one module and one prop.** `MealMacroBars` and `DayMacroTotals`
  (`meal-macro-bars.tsx:58,83`) are called with `target={{ … }}` — a fresh object identity per render —
  from `meal-plan-review-step.tsx` and `meal-plan-edit-sheet.tsx`, in both cases **inside
  `variant.meals.map(...)`**.
- **Why it bites:** the edit sheet holds **9 `useState` hooks** including per-keystroke handlers
  (`setInstruction`, `setRenameText`), so **every keystroke re-renders every meal row's macro bars** —
  exactly what the memo was added to prevent. **Performance, not correctness**, and bounded by the
  handful of meals in a day.
- **Fix:** `useMemo` the object, or better, pass four scalars — for the per-meal site a `useMemo` would
  need one memo per row, so scalars are the cleaner choice.
- **A stale clause worth correcting alongside:** the rule says *"both long-standing memos in the
  codebase were defeated exactly this way"*. There are now **66** memoised components, not two. The
  rule is right; the count is from an earlier era and reads as though memoisation is rare here. Same
  class as Q-480.
- **Not verified: no render counts were measured** — the claim follows from object identity and
  React's shallow compare, not a profiler run. The call-site scan can miss a memoised component
  invoked with deeply nested children in its props; the 66 declarations are exhaustive.

### [platform][readiness] 🟡 Five sites turn an ms offset into a calendar day; in a DST zone three compute "today" for "yesterday" (Q-489, 2026-08-18)

- **`CLAUDE.md` bans this shape and records six copies shipping in one file.** `lib/ai-chat/tools.ts`
  is clean now, but 12 instances remain elsewhere and nobody had sorted the ones that matter from the
  ones that do not. [`docs/reviews/2026-08-18-ms-offset-to-calendar-day.md`](docs/reviews/2026-08-18-ms-offset-to-calendar-day.md).
- **⚠️ Most of the 12 are CORRECT and filing them would be wrong.** The rule's harm is *"ms-offset
  windows straddle two AEST days and merge them"* — that is about **day-bucketed** aggregation.
  `muscle-recovery`, `workout-load-history` and `friends/feed` use a **rolling instant** filter feeding
  consumers that work in hours (`computeMuscleRecovery` reads `ws.startedAt.getTime()`), which for a
  physiological window is *more* correct than a calendar day.
- **Five sites do produce a calendar day, and the failure is measured** in `America/New_York`:
  ```
  ** MISMATCH **  local 2026-11-01 23:30   now-24h → 2026-11-01   true yesterday 2026-10-31
  ```
  On the **25-hour fall-back day**, in its last hour, `now − 24h` lands on **today**. Three of the five
  are computing "yesterday" that way — the `getOuraDailyDerived` range start (an AI-dynamic
  prescription input), the achievements streak comparison, and the periodization signal chain.
- **Severity stated plainly: unreachable today** — every user is `Australia/Brisbane`, no DST — and
  **one hour per year per DST-zone user** when reachable. Filed because it is measured, it is exactly
  the hand-rolled date arithmetic this file bans, and **`shiftDateStr` already exists and is already
  used in this shape** at `slices/oura.ts:1182`. One-line swaps.
- **Q-477 is what makes it reachable at all** — the Profile timezone setting and its auto-detect
  button. Same family; neither urgent.
- **Two clean results:** `lib/ai-chat/tools.ts` carries none of the banned pattern (the 2026-07-06 fix
  held), and the rolling-window uses must not be "fixed".
- **Not verified:** measured with `date-fns-tz` directly, not by driving the app with a DST-zone user
  at that hour — the app cannot be time-travelled here.

### [platform] ✅ Q-488 is the only one — every other write to a local-first domain updates the store (2026-08-18)

- **Answers the question an implementer taking Q-488 has to ask:** is this a handler or a class?
  [`docs/reviews/2026-08-18-local-first-write-coverage.md`](docs/reviews/2026-08-18-local-first-write-coverage.md).
  **It is one handler.** Every mutating write to a local-first domain was audited for a local-store
  call **inside the handler** — `injury-sheet` (PATCH+DELETE), `nutrition-content` (DELETE),
  `quick-edit-log-sheet` (PATCH), `saved-meals-sheet` (DELETE), `manage-supplements-sheet`
  (DELETE+PATCH), `done-activity-screen` (PATCH). **All eight write locally.** Only Q-488's does not.
- **⚠️ The obvious check is unsound, and its own output proves it.** Asking whether the *file* touches
  the local store reports `health-content.tsx` — the Q-488 file — as fine, because it uses the store
  elsewhere and just not in the delete handler. **File-level coverage says nothing about a handler.**
- **Two server-only writers, both clean, one for a reason worth keeping.** The Health Connect metrics
  PATCH arrives via the pull (chain verified in sweep 23). And
  `meal-plan-setup-sheet.tsx:387` creates saved meals server-only — fine, because `saved_meals` is
  **push-only** in the outbox and kept current by **hydrate-on-read** instead
  (`saved-meals-sheet.tsx:111` hydrates from the API; `food-logger-sheet.tsx:196` falls back to it).
  **So "no pull mapping" is not evidence of a gap** — a future audit testing pull coverage alone would
  file that one wrongly.
- **Not verified:** static audit and source reading, not on the APK. The handler-window heuristic reads
  a fixed span around each call site, so a local write further away would be missed — for the eight
  above the call is within a few lines.

### [activity][app-shell] 🟠 Deleting an activity leaves it in the local store, so three other screens keep showing it (Q-488, 2026-08-18)

- **The successor sweep 22 named for itself:** a stale value arising *outside* Q-262's test — a write
  that updates the server without touching the local store.
  [`docs/reviews/2026-08-18-server-only-writes-to-local-first-domains.md`](docs/reviews/2026-08-18-server-only-writes-to-local-first-domains.md).
- **What.** `health-content.tsx:684-700` deletes via `fetch("/api/activity-logs", {method:"DELETE"})`,
  toasts *"Deleted"*, invalidates caches — **and never touches the local store**.
- **The originating screen is correct, which is why this survived.** `refreshDayOverlay` reads
  `cachedFetch('day-log:<date>')`, a **server-read** cross-domain aggregate (the sanctioned
  exception), so the activity vanishes there at once. Nothing on that screen could reveal the problem.
- **The local row is untouched**, and three surfaces read it local-first — session-select's week
  activity, nutrition's calories-burned total, and the activity-history card. `pullDelta` is throttled
  to **5 minutes** un-forced and nothing in the delete path forces one, so the floor is that window
  and the real duration is "until the next natural sync".
- **It self-heals and is not data loss.** The server delete is a **soft** delete with a
  `user_id`-scoped tombstone, and `applyDelta` applies it under the correct `sync_status='synced'`
  guard. Something wrong is shown for a while; nothing is lost.
- **Fix is one call** — delete the local row alongside the API call, as `done-activity-screen.tsx`,
  `exercise-review-sheet.tsx` and `walk-summary.tsx` all already do. Making the delete work *offline*
  is a separate, larger question and should not be folded in silently.
- **The rule it breaks is not written down.** `CLAUDE.md` states the forward direction (*"if a domain
  WRITES to the local store, its UI MUST READ from the local store"*). The inverse is what bites:
  **a domain the UI reads local-first must have every write update the local store — including
  deletes, and including writes made from a screen that itself reads server-side.** Worth adding
  alongside the fix.
- **Three clean results:** the Health Connect metrics PATCH is server-only but its full chain checks
  out (all four fields in the pull mapping *and* `RECONCILE_COLUMNS`); that route is one of the only
  two dynamic routes that validate their UUID (consistent with Q-482); and the delete/tombstone
  mechanism itself is present and correct.
- **NOT reproduced on-device** — `getLocalStore` returns null in the web sandbox, so the local-first
  readers fall through to their API fallbacks and the inconsistency cannot appear there. On-device is
  the only real verification.

### [platform] ✅ Both halves of the staleness test now audited — case (b) clean, and the mechanical test for it does not work (2026-08-18)

- **Completes the lens.** Sweep 21 audited case (a) (`freshWithinTtl`); this audits case (b),
  **seed-only read paths** — the worse half, because a seed-only key never revalidates at all.
  [`docs/reviews/2026-08-18-seed-only-read-paths.md`](docs/reviews/2026-08-18-seed-only-read-paths.md).
- **The naive test over-reports and must not be used.** Differencing `readCacheSync` keys against
  `cachedFetch` keys (51 vs 66) yields five seed-only candidates — `achievements:<userId>`,
  `ai-health-insight:<section>:<date>`, `mood:<date>`, and two `workout-card:*`. **All five
  revalidate. None is seed-only.**
- **Because revalidation happens three ways and `cachedFetch` is only one:** (1) `cachedFetch`;
  (2) a raw `fetch(...)` then `setCached(...)` — `ai-insight-card.tsx`, `workout-screen.tsx`;
  (3) a **local-store read** then `setCached(...)` — `session-select-content.tsx`'s `mood:` path.
  **The third matters most:** for an offline-first domain the local store *is* the source of truth, so
  "revalidate" correctly means reading SQLite, not the network. A test that looks for a network call
  marks the app's most authoritative paths as stale.
- **So the test for seed-only cannot be "`readCacheSync` without `cachedFetch`"** — it is "no
  write-back to the key from any source after the seed", which is not greppable in one pass. Five
  candidates had to be read individually.
- **⚠️ Second time this run a `Q-NNN:` comment read as an open bug and was the fix.**
  `workout-screen.tsx:272` (Q-126, lifetime XP reported as one session's gain) is the fix's rationale,
  not a live defect — as was `session-select-content.tsx:896` (Q-117) last sweep. **In this codebase a
  comment naming a Q number is usually why the code is shaped that way.** Worth knowing before
  grepping `never invalidated` or a Q number and reaching for the alarm.
- **Result: both halves of Q-262's test are audited and clean.** The most repeated bug class in this
  project currently has no live instance that either half of the documented test can find.
- **Not verified:** static audit and source reading; not on the APK or production. A stale-value bug
  arising some *other* way — a write that updates the DB without touching the local store — is outside
  what this test catches and was not looked for.

### [platform] ✅ Every load-bearing cache invalidation audited — no gap, closing an audit `CLAUDE.md` names as never done (2026-08-18)

- **The most repeated bug class in this project (12+ incidents), audited against Q-262's own test.**
  [`docs/reviews/2026-08-18-load-bearing-cache-audit.md`](docs/reviews/2026-08-18-load-bearing-cache-audit.md).
  Q-262 established that a stale entry only survives as a *settled* value when a call site passes
  **`freshWithinTtl: true`** or a read path is **seed-only** — and this file recorded that only
  `invalidateGoalRecommendations` had ever been checked, *"the other groups are not audited."*
- **Case (a) is now audited and clean.** Sixteen `freshWithinTtl: true` sites resolve to **seven keys**,
  all `TTL_LONG` (6 h): `exercise-library`, `activity-types`, `progression-styles`,
  `workout-templates`, `progress-summary`, `workout-data:all`/`workout-card:<id>`. **Every one is in an
  invalidation group, and every client writer of the endpoint behind it calls that group.** No gap.
- **One thing that reads as a live defect and is not.** `session-select-content.tsx:896` says the
  `workout-data` caches are *"never invalidated … for up to 6 hours"* — that is the **comment on the
  Q-117 fix**, and `invalidatePrescriptionChanged()` is the line below it. Recorded so the next person
  to grep `never invalidated` does not reach for the alarm, as I did.
- **A design property, deliberately not filed:** these invalidations are **device-local** —
  `cache-groups.ts` clears the writing client's cache and cannot reach another device. `exercise_library`
  and `activity_types` are **shared** tables, so a change on one device leaves other clients serving the
  old list as a settled value for up to 6 h. Not filed because `TTL_LONG` is documented as *"slow-changing
  config"* and the current user base has no second writer. **Worth knowing when multi-user lands** — the
  answer then is a version/etag or a shorter TTL for shared config, not more invalidation call sites,
  which cannot help across devices.
- **Case (b) is still unaudited** — seed-only read paths (a screen that `readCacheSync`s a key and never
  fetches it, the Q-260 shape). That half leaves no revalidation at all and is the likelier source of a
  stale-value report. Named as the obvious next sweep in this lens.
- **Not verified:** static audit plus local dev; not on the APK. Cross-device staleness was reasoned
  about, not reproduced — this harness has one client.

### [platform] 🟠 Q-475 shipped mid-sweep; the production evidence is about the half its fix did not cover (Q-487, 2026-08-18)

- **This run's fourteen findings checked against production**, the same exercise that corrected four
  findings in sweep 8.
  [`docs/reviews/2026-08-18-production-verification-round-2.md`](docs/reviews/2026-08-18-production-verification-round-2.md).
  Nothing new filed; **six entries amended**.
- **⚠️ Q-475 was implemented while this sweep ran** — `#115` classifies the cause server-side
  (`isRetryableWriteError`), stops the client counting a retryable failure against
  `MAX_MUTATION_ATTEMPTS`, and engages the whole-queue backoff. **The dead-lettering and missing
  backoff are genuinely fixed.** What the evidence below is about is **not**: `reportServerError` is
  called only in the route's *outer* catch, which `pushMutations` never reaches, so a push failure
  still never reaches `error_events`. **Filed as Q-487**, scoped to the observability half.
- **The production shape, and it is an absence:**

  | Route | Faults in `error_events` | Span |
  |---|---|---|
  | `/api/sync/pull` | **69** | 2026-07-19 → 2026-08-13 |
  | `/api/sync/push` | **0** | none, ever |

  Over the same window the database refused connections **125 times across six days** (39 on
  2026-08-12), with one pull row reading `[cause: timeout exceeded when trying to connect]`.
- **The zero is evidence, not absent traffic.** `components/sync-provider.tsx` runs
  `await pushMutations(userId)` at :139 and `pullDelta` at :145 — **push first, same cycle**. Push is
  not less exposed than pull; it runs before it. So the zero means **"push cannot report"**, which is
  precisely what Q-475 describes: `pushMutations` catches per-mutation, returns 200 with the failure
  in the body, and never calls `reportServerError`. **The one table designed to catch faults that
  never reach a human has a blind spot exactly where that finding lives.**
- **Q-482 and Q-483 confirmed never triggered** — zero `22P02` rows ever, so a malformed route id has
  not reached production and the SQL-leaking 500 has never been served. Both were filed low; **do not
  re-price them upward from the local 500s alone.**
- **Q-484 latent confirmed** — `claude_ro.injuries` is **empty**; the route that accepts a 10 MB note
  has stored nothing at all.
- **Q-481 and Q-485 cannot be adjudicated from production, and one of them has a trap.** Water: 4 days
  logged, max 1000 ml — too thin for a double-count to show, so read it as the feature being unused,
  not as the replay not happening. Weight: 35 of 114 rows have steps and a NULL weight, which is **the
  expected shape** (steps daily from the ring, weight only on scale use) and **must not be cited** as
  coerced-away weights — the same trap as Q-460's "74% lack an RPE".
- **The standing constraint:** `claude_ro` is row-scoped to one user and `error_events` prunes at 30
  days. Every count is *the owner's, recently* — a zero means the owner never hit it, never that no
  user did. Push *traffic volume* could not be measured directly; the argument that push runs is from
  the call site, not a counter.

### [workouts][devices] 🟠 The outbox enqueue for a workout is the only write in the app that fails silently — and it is the last line of defence (Q-486, 2026-08-18)

- **Following the pattern sweep 18 named** (*this app validates well and tells you badly*) to its most
  consequential surface: a **write** that fails and reports success.
  [`docs/reviews/2026-08-18-tier-a-enqueue-silence.md`](docs/reviews/2026-08-18-tier-a-enqueue-silence.md).
- **Say the good part first, because it sets the size.** `workout-screen.tsx`'s log path is well
  layered and I nearly mis-read it: `logWorkoutLocally` writes locally first **and logs its own
  failure**; the **primary** send is a direct `POST /api/log-exercise`, deliberately *"independent of
  the on-device outbox / sync-push path (which can fail silently)"*; the outbox enqueue is only the
  **fallback**. This is not a write with no outbox — it is a good write whose last layer is silent.
- **Four sites swallow, and they are the only four in the app that do** — `workout-screen.tsx`
  :1320, :1324 (`workout_log`) and :1527, :1532 (`complete_workout`). All **Tier-A**, the tier
  `lib/local-store/dead-letter-signal.ts` defines with *"a lost workout is the app's worst-case data
  loss."* **26 of ~30** other `queueMutation` sites correctly `await`, so a throw suppresses their
  success toast.
- **It can throw:** `queueMutation` is a bare `runSQL` INSERT, so it fails whenever the local DB is
  unavailable — which this file records as having happened **twice** on Android, plus the
  partial-migration and `disk_full` cases.
- **The sequence that loses a set:** the POST fails (offline — the case the fallback exists for) *and*
  the local store is broken. Then the set is not sent, not queued, not recoverable, **nothing is
  logged**, and `hapticLight()` + `setLoggedCount(c => c + 1)` have already told the user it worked.
- **The inconsistency is the argument:** in the same function the *less* consequential failure
  (`logWorkoutLocally`) is `console.warn`ed and the *more* consequential one is not.
- **Fix shape — do NOT change control flow.** Log it (four lines, matching the warn above), and signal
  the user through the existing dead-letter badge. **Do not convert these to `await`** — they are
  fire-and-forget on purpose so the UI stays instant.
- **NOT reproduced and cannot be here:** inducing it needs a broken local SQLite on a device; in the
  web sandbox `getLocalStore` returns null so the enqueue never runs at all. **On-device is the only
  real verification.**

### [body][platform][devices] 🟡 An implausible weight is refused on web and discarded without trace on the device path (Q-485, 2026-08-18)

- **`CLAUDE.md` says "sync-push must mirror the web route" and the push branch's comment claims it
  does. Nobody had sent the same out-of-range value down both paths.**
  [`docs/reviews/2026-08-18-implausible-value-silent-drop.md`](docs/reviews/2026-08-18-implausible-value-silent-drop.md).
- **Measured** (`weightKg: 10000`, bound 500): web → **400** `{"error":"Too big: expected number to be
  <=500"}`; sync push → **200** `{"processed":1,"errors":[]}` with the row written, `steps` kept and
  `weight_kg` NULL.
- **The drop is invisible in all three places it could be recorded:** `errors: []` so the client
  confirms and deletes the mutation, **no** `console.*` in the coercion block, and **no**
  `error_events` row (verified by query).
- **The bounds are not the problem and must not be "fixed".** Both paths import the same
  `packages/shared/src/validation/body-metrics.ts` — `One Formula, One Place` holding. The comment
  claiming the mirror is accurate about *bounds*; it does not describe *behaviour*.
- **The same function already has the visible behaviour, on 2 of 14 checks.** 12 sites coerce
  silently (weight, bodyFat, calories, macros, steps, distance, RHR, HRV, water, measurements); 2
  throw (`waterMlDelta`, `sleep_session`), which become `errors[]` entries and reach the More-tab
  dead-letter badge. Both throws are defensible; the open question is why **weight** — the headline
  body metric — is in the silent group.
- **⚠️ The fix is NOT "throw everywhere".** A throw quarantines the mutation, which the poison-pill
  rule forbids for a validation failure; twelve new dead-letter paths would trade an invisible failure
  for red badges the user cannot act on. Recommended order: (1) log the coercion server-side — one
  line, no client change, worth doing regardless; (2) a `warnings[]` channel separate from `errors[]`
  that the client can surface without dead-lettering; (3) a per-field product decision on
  incomplete-vs-meaningless, which an implementer should not make in passing.
- **Reachability is low and stated as such:** bounds are generous, so ordinary UI input never trips
  them. The path that reaches it is the one the code comment already names — *"a corrupted local
  payload"* — plus a misreading BLE scale.
- **Not verified on:** the APK; the client half was read from `sync-engine.ts` rather than induced.

### [platform][body][nutrition] 🟡 The create routes nobody gave a schema — a 10 MB note is accepted where the edit path caps it at 1,000 (Q-484, 2026-08-18)

- **`CLAUDE.md` says oversized input is "a rejection, not a skip". Nothing had tested it.**
  [`docs/reviews/2026-08-18-unvalidated-create-bodies.md`](docs/reviews/2026-08-18-unvalidated-create-bodies.md).
- **Measured:** `POST /api/injuries` with a 200 kB `muscleName` + 500 kB `notes` → **201**, both stored
  in full; `POST /api/supplements` with a 300 kB `name` → **201**; and a **10 MB** `notes` → **201**,
  10,000,000 characters stored. No ceiling found below 10 MB.
- **⚠️ Do not quote 10 MB as a storage figure.** `pg_column_size` read ~120 kB because the payload was
  one repeated character and TOAST compressed it; real text would not. What is defensible: the
  transfer and parse cost is unbounded, and stored size is bounded only by what the content compresses
  to.
- **The asymmetry is the finding.** For the same table and fields, `PATCH /api/injuries/[id]` runs
  `InjuryPatchSchema` (`muscleName max(100)`, `notes max(1000)`, `startedDate` regex) while
  `POST /api/injuries` does `const body = await req.json()` and destructures. **`CLAUDE.md` names
  `updateInjury` as the reference for whitelisting a PATCH body** — it is a good reference, and the
  create path beside it has no schema at all, which is probably why nobody looked.
- **The unvalidated `startedDate` also 500s** — `{"startedDate":"not-a-date"}` → 500,
  `{"startedDate":"0001-01-01"}` → 201 accepted. Same class as Q-482, same root cause, fixed by the
  same change.
- **Scope, read carefully: 33 body-bearing routes call `req.json()` with no schema parse — a
  *candidate* count, not a defect count.** Several do hand-rolled checks, several are admin-gated.
  **Two** were confirmed by probe; the other 31 are unaudited and should be treated as neither broken
  nor fine.
- **Severity low today and the reason to fix is not attack** — this app's users are its own account
  holders. It is filed because the session-start **database-size ritual** and the 2026-08-17
  `disk_full` outage exist precisely for unbounded growth, because the stated direction is multi-user
  and a Play Store listing, and because `InjuryPatchSchema` already encodes the intended bounds so the
  fix is a few lines.
- **Two clean results:** the PATCH/PUT edit paths are properly bounded wherever checked; and the
  163-vs-31 `z.string()`-with-`.max()` ratio is **not** a finding and must not be quoted — most
  unbounded `z.string()` under `app/api` are **AI output schemas**, not request bodies.

### [platform] 🟠 A route id that is not a UUID reaches Postgres — and three routes reply with the SQL (Q-482, Q-483, 2026-08-18)

- **The third case, after "another user's id" (protection holds) and "valid but missing" (Q-463):**
  an id that is not a UUID at all. All 30 dynamic route files, every method, called twice — once with
  a well-formed-but-nonexistent UUID as the **control**, once with `not-a-uuid`. 39 pairs.
  [`docs/reviews/2026-08-18-malformed-route-ids.md`](docs/reviews/2026-08-18-malformed-route-ids.md).
- **Q-483 is the sharp one.** `GET /api/workout-sessions/not-a-uuid/recap` answers **500** with the
  stringified driver error — the complete `SELECT` and every column name of `workout_sessions`. It is
  the route's **own** catch (`NextResponse.json({ error: errMsg })` where `errMsg = errorLog(error, …)`),
  and `errorLog` has **no environment check and no redaction**, so it ships in production exactly as
  here. Three routes leak (`workout-sessions/[id]/{recap,energy,timing}`); a fourth
  (`session-explain/insight`) carries the pattern but is guarded upstream today. Disclosure is to an
  **authenticated** user, so not an anonymous hole — but it publishes table structure nothing else
  exposes, and `reportServerError` is already called on the line above, so redacting the response
  costs no diagnostics.
- **Q-482 is the breadth.** 22 of 39 pairs returned 5xx; one is already Q-463, leaving **21 new pairs
  across 14 routes** (coach undo, friends, injuries, food-logs, meal-plans ×3 + review + structure +
  meals, meal-types, saved-meals, supplements ×2 + log ×2, workout-review, and the three
  workout-sessions GETs). Postgres rejects the cast with `22P02`. **Only 2 of the 30 dynamic route
  files validate the id as a UUID at all.**
- **The control is what makes it a finding:** every one of those routes answers a well-formed missing
  id correctly (404, or an idempotent 200/204). Only the malformed id breaks them — a missing input
  guard, not a broken route.
- **Not a security hole.** A malformed id cannot read anyone's data: Postgres refuses the cast before
  any row is touched and every route is `auth()`-scoped. It becomes a disclosure problem only where it
  meets Q-483, which is why that is queued above it.
- **⚠️ Reading the evidence:** a **500 is conclusive**; a **400 is not** — the probe sent `{}`, so a
  body-bearing method may have failed its body schema before the id was used. Routes absent from the
  table are only verified-correct if they are GET or DELETE.
- **Fix shape:** a shared `parseUuidParam(id)` returning 400, the same precedent as
  `normalizeDateParam` for date params, plus a Custom Rules step requiring it in new `[id]` routes.
- **Observability needs no work:** every fault reached `error_events` tagged `[pg 22P02]`, via
  `reportServerError` or `onRequestError`.

### [platform] 🟠 A revoked admin keeps one write for up to 24 hours, and the module docstring says it cannot (Q-479, 2026-08-18)

- **The first sweep to test privilege *revocation* rather than cross-user data isolation.**
  [`docs/reviews/2026-08-18-auth-session-boundaries.md`](docs/reviews/2026-08-18-auth-session-boundaries.md).
- **`lib/admin.ts` holds two admin checks that disagree.** `requireAdmin` takes an `_isAdmin`
  argument and deliberately **ignores** it, reading the row every call — **61 API routes** use it, and
  revocation is immediate on all of them. `isAdminUser` **returns the passed flag** when given one.
  Seven of its ten call sites pass the JWT claim; six are page guards (UI, correct), and the seventh
  is **`app/api/exercises/route.ts:38`**, an API write into `exercise_library` — the catalogue every
  user reads.
- **The claim refreshes once a day.** `ISACTIVE_RECHECK_MS = 24h` in `lib/auth/is-active-refresh.ts`,
  a sound throttle. What is not sound is its docstring: *"This governs the **UI** only: `requireAdmin`
  … never trusts this claim."* That is false, and it is why this was easy to miss — a reviewer who
  reads it stops looking. **The wrong comment is more dangerous than the wrong call, because it
  scales to the next admin route someone adds.**
- **Measured with a control**, admin revoked in the DB with no re-login and cookie rotation persisted
  as a browser does: `POST /api/exercises` → **201** (row created) while `GET /api/admin/errors` →
  **403**, same cookie, same instant. Session claim still read `isAdmin: True`.
- **Severity moderate-low and stated as such:** what a revoked admin gains is rows in a catalogue —
  no health data, no other user's rows, no credentials. It is filed because it is privilege
  persistence with a working proof of concept and the fix is deleting one argument.
- **Five clean results recorded:** all 61 `requireAdmin` routes DB-check; the six page guards are
  genuinely UI and should NOT be "fixed"; `/api/health-connect/ingest` fails closed with its secret
  unset *and* on an empty secret, with an IP limiter before a constant-time compare and an identical
  401 body — the reference implementation for the fail-closed rule; both bearer paths
  (`day-review`, `db-query`) fail closed on partial config; and the claim-refresh module itself is
  careful (a missing row is not deactivation, a failed lookup does not advance the timestamp, a DB
  blip cannot sign everyone out).
- **⚠️ Method note worth more than the finding.** The first run of this test reported revocation
  **working** and was wrong: `curl -b` without `-c` discards the rotated cookie, so every request
  re-sent a token with no `isActiveCheckedAt`, the throttle never engaged, and the DB was re-read
  every time. **A session-staleness test is meaningless unless the client persists cookie rotation.**
- **Not verified on:** the APK or production; `ISACTIVE_RECHECK_MS` is read from source, not observed
  over a real 24-hour window.

### [platform] ✅ The empty account and the n=1 account are clean — and the probe that said so was invalid until it was fixed (2026-08-18)

- **All 126 static GET routes driven twice** — once as an account with zero rows in every domain, once
  after giving it exactly one `body_metrics` row and one `sleep_sessions` row.
  [`docs/reviews/2026-08-18-empty-and-single-datapoint-accounts.md`](docs/reviews/2026-08-18-empty-and-single-datapoint-accounts.md).
- **The method correction is the point of the entry.** The probe grepped response bodies for `NaN`
  and `Infinity`, came back clean twice, and **could not have detected either**:
  `JSON.stringify({x: NaN})` → `{"x":null}`, and the same for `±Infinity`. Both serialise to `null`,
  indistinguishable from a legitimate no-data null. **A numeric-corruption check must never be run
  against a serialised JSON body** — audit the divisions, or use a differential (numeric at n=many,
  `null` at n=1 while its input exists), never a string match on the response.
- **By the correct method — auditing every mean-style division across `app/api`,
  `packages/shared/src` and `lib/health` — there is no unguarded division.** The four that looked
  unguarded from a grep each carry an explicit early return immediately above
  (`health-trends:111`, `cardio-week:24`, `oura/hr-window:61`, `admin/program-export:51`); the rest
  are ternary-guarded at the expression.
- **No route changed behaviour between zero data and one data point** — the useful half of the sweep.
  Status distribution identical across both runs: 76–77 × 200, 33 × 403 (admin-gated), 11 × 400
  (missing required param), 2 × 404, 3 × 5xx.
- **All three 5xx are environmental and unchanged between runs:** `/api/download-apk` 502 (GitHub not
  reachable from the sandbox), `/api/push/subscribe` 503 (VAPID unset), and
  `/api/oura-ble/decoder-constants` 500 with an empty body (the vendored constants are deliberately
  absent from the public repo). The last was **deliberately not filed**: the client's
  `isUsable()` exists precisely to reject an error-shaped payload, and the decoder throws on an absent
  table rather than producing plausible wrong numbers.
- **`onRequestError` verified working.** It caught the bodiless 500 and wrote an `error_events` row
  with the exact message — checked by querying the table after the run. The hook does what its comment
  claims for the ~80 route files with no `catch`.
- **Not verified:** the APK, production, or the dynamic-segment (`[id]`) routes, which were excluded.

### [nutrition][platform] 🟠 A water quick-add replayed by the outbox triple-counts — the one non-idempotent mutation of nineteen (Q-481, 2026-08-18)

- **The gap between sweeps 9 and 10**: concurrent writes were measured, and the outbox under failure
  was measured, but not the same mutation arriving **twice in sequence** — which is what at-least-once
  delivery guarantees will eventually happen.
  [`docs/reviews/2026-08-18-outbox-replay-idempotency.md`](docs/reviews/2026-08-18-outbox-replay-idempotency.md).
- **Measured:** one mutation id pushed three times → `water_ml = 750` for 250 ml logged, every push
  answering `{"processed":1,"errors":[]}`. The server keeps **no record of processed mutation ids**.
- **Reachable by ordinary means on the canonical runtime.** The client wraps its push in
  `try { await fetch(…) } catch { break }`, so a request that **reaches the server and commits** but
  whose response is lost — signal drop, OS killing a backgrounded app, timeout — leaves the mutation
  `pending` with nothing marking it in-flight. The next sync re-pushes it. On a phone on mobile data
  that is routine.
- **The write is correct and must not be "fixed".** `incrementWaterLog` adds inside the upsert and the
  push branch routes to it deliberately (SYNC-P7: *"an increment, not an absolute set … so concurrent
  adds sum instead of last-writer-wins clobbering"*). Atomic-and-additive is right for concurrency and
  is exactly what makes a replay wrong; an absolute total reintroduces the clobber it was written to
  prevent. The fix is **mutation-id dedupe for this one branch**, not a change of semantics.
- **Bounded:** all 19 push branches enumerated, and this is the only non-idempotent one — every other
  domain upserts on `(user_id, date)` or a client-supplied row id.
- **Three clean results, one of them load-bearing:** `complete_workout` replayed 3× → counter = 1,
  which is the **second independent confirmation of the Q-473 fix** and covers the vector its original
  comment named (an outbox mutation re-pushed after its response was lost); absolute `body_metrics`
  is idempotent; and `activity_logs` replayed 3× gives **one** row — which looks like it contradicts
  sweep 9's "5 concurrent → 5 rows" and does not: **different writers**, the web route minting a
  server-side id and the outbox carrying a client-generated one.
- **Not verified on:** the APK. The replay was simulated by re-posting the same envelope (what the
  client does); the client-side trigger was read from source, not induced.

### [platform] ✅ The server side of the timezone problem does not exist — verified at every layer below the routes (Q-480, 2026-08-18)

- **A verification sweep, written up because a clean result is a result.**
  [`docs/reviews/2026-08-18-server-tz-and-rate-limit-verification.md`](docs/reviews/2026-08-18-server-tz-and-rate-limit-verification.md).
  Sweep 11 concluded "the server is correct" by counting `todayInTz()` **inside route files**, which
  is not the whole server — a blameless route can still get a Brisbane answer if the repository
  function it calls defaults the timezone. This sweep went looking for that half. **It is not there.**
- **Checked and clean:** every caller of the three tz-defaulting repository helpers
  (`getCalendarData`, `getRecentTrainedDays`, `getNextSession`) passes the session timezone; all
  **four** timezone-sensitive SQL sites in `lib/data` interpolate a parameter, with **no hardcoded
  zone string anywhere in the repository layer**; and every call site of the shared sleep helpers
  (`nightSessions`, `isNightWindow`, `sleepScoreBaselines`, `sleepDurationTrend`, `sleepScoreTrend` —
  the ones that decide which calendar day a night belongs to) passes `tz`. Zero local re-declarations
  of `DEFAULT_TZ`.
- **This bounds Q-477.** The wrong-timezone problem is **exclusively client-side**; its fix does not
  need to touch `lib/data` or `packages/shared/src/health`.
- **Q-480 is the one finding, and it is a documentation correction.** `CLAUDE.md` says *"Repo
  day-window helpers currently **hardcode** `DEFAULT_TZ`"*. They do not — they take it as a default
  parameter that every caller overrides. The stale line marks the repository layer as known-broken, so
  an implementer taking Q-477 would start there and find nothing. Filed rather than edited directly,
  because `CLAUDE.md` is the contract all five agents read.
- **Rate limiting swept in the same pass, also clean:** all **13** routes calling
  `generateObject`/`generateText`/`streamText` are rate-limited, and **all 104 `rateLimit` keys are
  user- or IP-scoped** — zero global keys, so no route where one user's traffic can throttle another's.
- **Not covered:** whether any limit is set at the right *number*, the client half of rate limiting,
  the APK, or production.

### [app-shell][platform] 🟠 The app run as a user who is not in Brisbane: the server follows their timezone, 100 of 125 client call sites do not (Q-477, Q-478, 2026-08-18)

- **The blind spot `CLAUDE.md` names, entered for the first time.** All 30 user rows in the local DB
  are `Australia/Brisbane`, and ten review sweeps had never moved a user out of the default zone —
  *"invisible while the device sits in the zone the data was recorded in"*, exactly as written. This
  sweep set a user to `Pacific/Kiritimati` (UTC+14), re-logged in so the JWT carried it, and drove the
  app at a moment when three calendar dates were simultaneously live (Midway 08-17, UTC/Brisbane
  08-18, Kiritimati 08-19). [`docs/reviews/2026-08-18-timezone-non-default-user.md`](docs/reviews/2026-08-18-timezone-non-default-user.md).
- **The server is clean and that is worth stating.** `app/api/**` contains **zero** argument-less
  `todayInTz()` calls — 53 `todayInTz(tz)`, 4 from the session, 4 `formatInTimeZone(..., tz, ...)`.
  Live: `POST /api/day-checkin` → `logDate: 2026-08-19`; `GET /api/workout-data` →
  `dataDate: 2026-08-19`. Both correct. Every finding here is client-side.
- **The inversion that sets the severity.** While a user is on Brisbane, client and server agree and
  nothing is wrong — which is why this has never surfaced. **Setting the timezone is what breaks it:**
  the server moves, the client's 91 argument-less `todayInTz()` calls do not.
  `edit-profile-sheet.tsx:190` ships an **"Auto-detect timezone"** button, so the intended one-tap
  action for any user outside Brisbane is precisely the action that desynchronises them.
- **Observed on screen** (Health → Training): the Training Calendar highlights **18** and Training Load
  highlights **Tue**, on a day that was Wednesday the 19th for that user. Source is
  `calendar-widget.tsx:110`, `localDateString()` — the **device's** zone, a *third* answer following
  neither the setting nor the server. `CLAUDE.md` warns of two client "today" sources; there are three.
- **✅ Q-478 SHIPPED 2026-08-18 (v1.324.8) — the sharp, cheap half is done.** `isWorkoutDataToday` and
  `isBodyMetadataFresh` compared a **server-stamped** date to a **client `DEFAULT_TZ`** date, so they
  returned false for |Δoffset| hours a day — **14 hours a day for a New York user** — leaving Health's
  today values unset, the workout screen stripping `loggedTodayInSession` from every exercise, and the
  "Trained today" badge absent. Both now take a `tz`, all nine call sites pass one, and
  `scripts/check-tz-aware-cache-guards.js` fails Custom Rules on a call that does not.
  [`Journal`](docs/overview/entries/2026-08-18-tz-aware-cache-guards.md). Two corrections to the
  original finding, both made in place: session-select's skeleton **does** clear — a second
  unconditional `setMetaLoading(false)` runs after the await, so the cost is a round-trip-long skeleton,
  not a stuck one; and `unwrapToday`/`cachedFetchToday` were deliberately left alone (client-written,
  client-read, self-consistent). **The rest of this row — Q-477 — is still open**, including its
  ratchet on bare `todayInTz()` across client code, which this narrower check does not provide.
- **Nothing is missing except the argument.** `useUserTimezone()` is a context available tree-wide and
  `goals-section.tsx:114` already uses it correctly. In `workout-select-content.tsx`, lines 31 and 32
  sit inside a function that *takes* `tz`: line 32 uses it, line 31 cannot, because the helper has no
  parameter for it.
- **Severity, honestly: latent for the current user base, structural for the stated direction.** No
  user has a non-Brisbane zone today, so nothing is broken in production. It is filed above "someday"
  because the app ships the button that triggers it, this file's 2026-08-02 amendment says explicitly
  not to assume the owner's own device, and a Play Store listing is the stated intent. Recommended
  first step is a **CI ratchet** on bare `todayInTz()`/`localDateString()` in client code, shrink-only,
  the same shape as the hex-literal and TTL-divergence checks — freeze the count at 100 before
  sweeping.
- **Two clean results recorded:** every API route threads the user's timezone, and
  `cachedFetchToday`/`unwrapToday` are self-consistent (client-written and client-read) — mislabelled
  rather than broken, and deliberately not filed as the same defect.
- **Not verified on:** the APK — the 9 `localDateString()` sites read the *phone's* zone there, a third
  value this harness cannot reproduce. Not against production, where all users are Brisbane and the
  symptom does not arise.

### [platform][devices] 🟠 A database outage reaches the sync client as HTTP 200, so it dead-letters the whole outbox instead of backing off (Q-475, Q-476, 2026-08-18)

- **The first sweep to push a real batch at `/api/sync/push`, including one with the database
  stopped.** [`docs/reviews/2026-08-18-outbox-under-failure.md`](docs/reviews/2026-08-18-outbox-under-failure.md).
- **Say the good news first: the poison-pill rule holds.** Five mutations, poison placed third so four
  siblings sit behind it → `processed: 4`, one error keyed by outbox **id**, all four sibling rows
  written. The rule `CLAUDE.md` says cost three production incidents (#47, #74, #82) is genuinely
  enforced at both the route and the adapter. Both findings below are about what happens *around*
  that hardened core.
- **Q-475 — measured with Postgres actually stopped.** The push returns **HTTP 200** with a per-item
  error for every mutation, because `pushMutations` catches per-mutation — the same property that
  makes the poison-pill rule work. So `res.ok` is true, `consecutive5xx` is **reset rather than
  engaged**, the client keeps pushing at full cadence into a server that cannot write, and every
  mutation burns an attempt. Backoff is 30 s → 2 m → 8 m → 32 m before dead-lettering, so **≈ 42.5
  minutes of outage dead-letters every queued mutation** — an ordinary outage length, and this repo
  has recorded two.
- **Not data loss — the design holds there.** Rows are kept (`status='failed'`), the More-tab badge
  reflects them and Tier-A domains toast. The cost is that a user emerges from a transient outage with
  every pending write dead-lettered and a **per-item-only** retry UI (no "retry all"), asked to
  hand-repair a queue that was never broken. The client's own comment already states the principle
  being violated: *"Transport failures … say nothing about the mutation itself."*
- **Q-476 — the worse failure gets the softer handling.** A mutation rejected by the route's
  `MutationSchema` (unknown domain, malformed date) returns `errors: []`, which is how the client is
  told everything succeeded — so the row is **deleted**, with no badge, no toast and no way back. A
  mutation that fails one layer later, inside `pushMutations`, is kept, badged and retryable. Measured
  both ways. **Latent, not live:** all 36 `queueMutation` call sites produce a schema-valid date today,
  and the unknown-domain case needs a domain to be *removed* while devices hold queued rows.
- **The opposite policy is written in the same request path and cannot run.** `pushMutations`'
  `Unsupported domain` branch argues at length against exactly this silent drop — and is unreachable
  behind the route's `z.enum`. The layer that got it right is the one that never executes.
- **Same class as Q-548, filed the same day:** a DB outage surfacing as `{"error":"Forbidden"}` on
  `/api/admin/db-query`. Two independent routes now known to misreport a database outage as something
  else.
- **Four clean results recorded** so they are not re-run: the poison pill isolates correctly; a
  per-item failure never deletes data; an envelope-level 4xx quarantines its chunk and keeps draining;
  and the `id`-keyed confirmation is real, with the `domain:date` fallback reachable only for pre-v13
  clients.
- **Not verified on:** Railway (inducing a production DB outage is not on) or the APK. The client half
  is plain TypeScript with no native dependency.

### [workouts][platform] 🟠 Completing one workout twice at once counted it twice — Q-473 FIXED and re-verified, Q-474 still open (Q-473, Q-474, 2026-08-18)

- **✅ Q-473 shipped in #112 and was re-verified by Review against the original reproduction.**
  `completeWorkoutSession` now returns its affected-row count and `completeWorkoutFromPayload`
  derives `alreadyCompleted` from that write instead of from a read taken before it — the exact
  shape the finding recommended. **Re-measured on the merged code, same harness, four fresh trials
  of four concurrent completes: `sessions_in_phase` = 1, 1, 1, 1** (was 3, 3, 2, 1), workout
  completed exactly once each time. **Q-474 is still open**, so this row stays here rather than
  moving to the resolved archive.

- **The first sweep to actually fire concurrent writes and read the result.** `CLAUDE.md` records a
  real incident in this class (*"5 rapid taps once fired 4 `complete-workout` POSTs"*) and a standing
  **Stored Counters** rule opening *"Every stored counter in this project has drifted"* — naming
  `sessions_in_phase` as fixed three separate times. Three earlier reviews discuss races; none had
  ever measured one. [`docs/reviews/2026-08-18-write-concurrency.md`](docs/reviews/2026-08-18-write-concurrency.md).
- **Q-473 — reproduced in 4 of 5 bursts.** Four concurrent `POST /api/complete-workout` for **one**
  workout session: all four return `200`, `completed_at` is stamped on exactly one row (that UPDATE
  *is* guarded), and `sessions_in_phase` lands on **3, 3, 2, 1** across four trials. The idempotency
  decision is taken from a read that happens *before* the guarded write, so every request that read
  first believes it is first. The function's own comment promises the opposite: *"Idempotent: a
  retried/replayed completion … must not … double-increment the sessions_in_phase stored counter."*
- **Why it is 🔴 and not 🟠:** `sessions_in_phase` advances the periodization phase, so an over-count
  moves the lifter into the next phase — and into a deload — **early, off a session never trained**.
  Nothing reconciles it against `workout_sessions`, and the workout row itself looks perfect, so the
  only symptom is "my programme advanced too soon". The outbox replay path calls the same shared
  function, which is precisely the case that comment names.
- **The fix already exists in the same file's neighbourhood.** `upsertPersonalRecordIfBetter` does the
  same read-then-conditionally-write correctly (`db.transaction` + `SELECT … FOR UPDATE`). Cheaper
  still, and it is `CLAUDE.md`'s own write-path rule (a): return the guarded UPDATE's affected-row
  count and decide from that. The count is currently computed and thrown away.
- **Q-474 — the trap that nearly buried it.** `workout_sessions` carries **two** FKs to
  `program_sessions`: the live `session_id` and a dead `program_session_id` (migration 079, **zero**
  code references, 0 of the owner's 91 prod rows populated). The dead column owns the name the live
  one is used under — `getWorkoutSessionProgramSessionId()` reads `session_id`, and
  `ensureWorkoutSession`'s `programSessionId` argument is written to `session_id`. The first Q-473
  repro populated the dead column, the periodization block silently skipped, and the honest reading
  of that run was *"the race does not exist"*. It does.
- **Four clean results recorded** so they are not re-run: `day-checkin` is idempotent under
  concurrency (5 → 1 row), `completeWorkoutSession`'s own UPDATE is correctly guarded,
  `upsertPersonalRecordIfBetter` is correctly locked, and the phase-`transition` route is idempotent
  by construction. `activity-logs` duplicates freely but every caller holds an in-flight guard, so it
  was deliberately **not** filed.
- **Not verified on:** production (correct — this writes), the APK, or a multi-replica deployment.
  Measured on local `pnpm dev`, a single node; more replicas widen the window rather than narrow it.

### [platform][workouts][cardio][nutrition] 🟠 The AI-usage screen's double-trips traced to cause — the top row is an artefact, two rows are real (Q-469…Q-471, 2026-08-18)

- **First production-data finding of this review run.** The owner supplied three screenshots of
  **More → Developer → AI usage**: 30 days, 268 calls, 651,639 tokens, **$0.09**, 2 failures, and
  **89 redundant calls (33%)** across five sections. Traced through
  [`docs/reviews/2026-08-18-ai-double-trips.md`](docs/reviews/2026-08-18-ai-double-trips.md).
- **Cost is irrelevant here and should stay that way.** $0.09 per 30 days — eliminating every
  redundant call saves a fraction of a cent, and `CLAUDE.md` already records the decision not to
  optimise AI spend. These are filed for **latency and content consistency**, and three of the five
  sections are *generative*, so a repeat returns different content rather than the same answer twice.
- **🟠 Q-471 — the screen's most alarming row is a measurement artefact.** Redundancy is
  `(user_id, section, fingerprint)` repeating within 120 s, and three sections fingerprint on a
  **calorie target alone**. Rerolling a meal is the feature working, and every reroll carries the same
  rounded target — so `meal-plan-generate-meal`'s "32 redundant · 4 distinct" most plausibly reads as
  four slots rerolled ~8 times each. **The reroll path is already correctly guarded**
  (`disabled={rerolling != null}` on every control), so an implementer sent there by the screen would
  find nothing to fix. **44 of the 89 are artefact; 45 are real.**
- **🟠 Q-470 — the prescription regeneration double-fires for real.** It fingerprints on
  `{ programSessionId, today }`, so 14 redundant / 8 distinct is the same logical prescription
  generated twice. `regeneratePrescriptionInBackground` is fire-and-forget from two sites in
  `GET /api/workout-data`, with a rate limit but **no in-flight guard** — and `cachedFetch` always
  revalidates over the network, so every screen open issues a real GET while the triggering condition
  is still true. The rate limit is not the bug and should stay.
- **🟡 Q-469 — `running-plan-explain` re-asks on every card mount.** 31 redundant / 9 distinct, from a
  bare `useEffect` with no cache. The author had already fixed the re-render case (the `gateKey` join);
  mount is the remaining trigger. Not load-bearing — the deterministic rationale renders immediately —
  but the **wording changes between mounts**, so the same run reads differently each visit.
- **✅ Two prior findings corroborated by production, and one reaffirmed.** **Q-295 holds exactly** —
  Coach is 17 of 268 calls (6.3%) and 330,221 of 651,639 tokens (50.7%), ~19,400 tokens/call.
  **Q-170's latency fix is holding** — the 30-day Coach average of 5,840 ms looks like a regression but
  the 7-day window reads **2,307 ms**, better than the 3.5 s the fix claimed; **do not reopen Q-170 on
  the 30-day number**. And the error rate is 2/268 (0.7%), unremarkable on this evidence.
- **Limits:** one user's account over the window shown, and the call sites were read rather than driven
  — nothing here was reproduced locally.
- **Nothing was fixed.** All three are queued.

### [app-shell][workouts][platform] 🟠 The AI Coach's write path reviewed for the first time — apply is exemplary, undo is unreachable and wrong (Q-467, Q-468, 2026-08-18)

- **Never reviewed before.** The Coach appears in eight prior review docs and five backlog entries —
  all about cost, latency, model ID and navigation. **No review document mentions `coach_changes`,
  `applyCoachChange` or the undo mechanism**, verified by grep across `docs/reviews/`. It is also the
  only place an LLM-initiated flow writes to the data deciding what the user is told to lift: five
  domains — `session-exercise`, `goals`, `injury`, `program-phase`, `early-deload`. Full write-up:
  [`docs/reviews/2026-08-18-coach-apply-path.md`](docs/reviews/2026-08-18-coach-apply-path.md).
- **✅ The apply path is a model of how to do this, and is recorded at length so it stays that way.**
  The model is never in the write path (documented, with the reason the SDK's binary tool-approval was
  rejected); `fieldsMatchDomain` stops a model aiming a calorie field at an exercise row; ownership is
  by join where the table has no `user_id`; the boundary is Zod-whitelisted with `CLAUDE.md` rule (b)
  quoted back at itself; creating a shared-catalogue exercise is admin-gated with the policy reason
  written down; a merged-away catalogue row cannot be resurrected; a bad swap fails the whole apply
  rather than half-applying. **Double-apply is refused** — a repeated patch returned `409` with a
  per-field drift report — and **cross-user undo returned 404**.
- **🟠 Q-467 — the Coach can change your programme and nothing in the app can undo it.** The entire
  undo subsystem is built: the route with a well-reasoned "until the next workout started after the
  change" window, `undoCoachChange()`, an `undo()` handler in all five domains, `captureBefore()`
  existing solely for it, the `undone_at` column, and `coach-history.tsx` **already styling undone
  changes** with strikethrough and a "· undone" suffix. **Nothing calls it** — every client fetch to a
  Coach endpoint was enumerated and the undo path appears in none. ⚠️ **Not** the known "no
  user-facing entry point" note: that is about phase 1's *apply* path, which phases 2–3 wired and
  which works. Undo was never wired with it.
- **🟠 Q-468 — and when it is wired, it will restore stale state.** `apply` refuses to write over a
  moved target (`driftAgainst` → 409); `undo` has no equivalent and writes `beforeState` back blindly.
  Measured entirely within the Coach's own flow: apply A (Barbell→Dumbbell), apply B
  (Dumbbell→Incline), **undo A** → the row becomes **Barbell** while `coach_changes` still shows B as
  `NOT UNDONE`, so the history contradicts the data. Then **undo B** → the row becomes **Dumbbell**.
  Undoing *every* Coach change leaves the programme holding a value the user never chose, not the
  original. All five domains share the gap. **Do Q-468 with or before Q-467** — wiring the button onto
  today's undo would ship the defect.
- **NOT device-verified**, web build only. **The model was never in the loop** — every patch was
  hand-written, which is the right way to test a path designed to keep the model out of it, but means
  nothing here says whether the model *proposes* good patches. Only `session_exercise` was driven end
  to end; the other four handlers were read. `/api/coach/preview` was not probed. The local DB was
  restored afterwards.
- **Nothing was fixed.** Both are queued at the top.

### [nutrition][app-shell] 🟢 Printable saved-meal labels shipped (Q-389) — TWO owed checks, both physical (2026-08-18, v1.320.0)

- **⚠️ Owed 1 — the print test, and it is a real gate not a formality.** The code is **25×25
  modules**. **Re-measured 2026-08-18 and finer than first recorded**: the quiet zone is drawn
  *inside* the code box, so the printed pitch divides by 33, not 25 — `band` is **0.369 mm**, not
  0.487. **The default is now `inlineCentred` at 0.401 mm** (Q-399, v1.325.0 — retuned down from a
  briefly-shipped 0.529 that left no room for the ingredient list it promised). **Print the default
  and `band` and scan both**: `band` is the tightest, and the default is what every label uses. Ink
  spread on a home printer merging fine modules is the expected failure, and it will present as "the
  scanner doesn't work" rather than as a print problem. The preview sheet prints the measured
  mm-per-module under the label so the number is visible rather than assumed.
- **⚠️ Owed 2 — the scan-back on device.** QR decoding runs through the Capacitor plugin, which is
  inert in the sandbox, so **the scan branch has never executed against a real camera.** The decode,
  the meal lookup and the logging are unit-tested and the label half is E2E-guarded; the camera path
  is not.
- **Delivery is Web Share, not a Capacitor plugin** — deliberate, because `@capacitor/share` would
  have meant a new APK. `navigator.share({files})` reaches the system sheet (where a print app
  lives); `<a download>` is the browser fallback. **The share path is also device-unverified.**
- The label prints **per-serving** figures and scanning logs **one serving** — asserted against each
  other in one unit test, because that is the pair that would otherwise drift.
- **⚠️ The default drew ZERO ingredient lines for a release** (v1.324.0–v1.324.6) and nothing failed:
  the sheet's "Printing N ingredients" copy was gated on `> 0`, so the one reading worth having
  removed itself, and the only test on that style asserted the code's *size*. Fixed in Q-399
  (v1.325.0) — three wrapped lines, the budget derived from the gaps the painter draws, the line
  count asserted in CI, and a zero now reported loudly instead of silently.
  [`Journal`](docs/overview/entries/2026-08-19-label-line-budget.md).

### [readiness][sleep][heart-rate][body][devices] 🟢 The ingest surface reviewed — auth model and value validation both sound; two schema gaps (Q-464, Q-465, 2026-08-18)

- **Why a different lens.** These five pillars barely expose `[id]` write routes — they are
  read-and-derive, and their writes arrive through **ingest** and **sync**, so the write-surface lens
  used for workouts and nutrition does not reach them. Full method and limits:
  [`docs/reviews/2026-08-18-ingest-and-input-validation.md`](docs/reviews/2026-08-18-ingest-and-input-validation.md).
- **✅ No ingest route accepts a `userId` from the request body.** All ten checked derive identity from
  the session, or — for `health-connect/ingest` — from a shared secret plus `WEBHOOK_USER_ID`; two
  additionally sit behind `requireAdmin`. **There is no route where a caller can name whose data they
  are writing.**
- **✅ Value validation rejects physiologically impossible input and nothing landed in Postgres.**
  Heart rate `-50` and `99999`, mood `999` and `-5`, body weight `99999` and `-40`, and a malformed
  scale frame were all `400`. The weight messages name the bound violated (`"Too big: expected number
  to be <=500"`) rather than saying "invalid". `CLAUDE.md`'s ingest-schema rule is being followed on
  every route reachable here.
- **🟡 Q-464 — request schemas are almost never `.strict()`.** Of **70** files defining a `z.object`
  request schema, only **6** call `.strict()`, so Zod silently drops unknown keys. Demonstrated on
  `POST /api/body-metadata`: `{"date":"2026-08-10","weightKg":81}` wrote weight 81 to **today** and
  returned `{"success":true}` — the route correctly reads `localDate` and defaults to today, and the
  non-strict schema is what turns a wrong key into a silent wrong-day write. **Not reachable from the
  app's own clients**; filed because the repo already lost a full release to this class (the `ai-chat`
  `localDate` regex). Eleven date-bearing write schemas are non-strict — but **`sync/push` needs care**,
  since older-APK outbox payloads may carry fields the current schema does not name.
- **🟡 Q-465 — `POST /api/day-checkin` creates a row from a completely empty body** (201, every metric
  null). **The consequence is unproven and the entry says so**: both consumers were checked and neither
  shows a user-visible bug. Worth closing anyway because the row is indistinguishable from a check-in
  where the user answered nothing, and readiness is the pillar where "told us nothing" and "told us
  neutral" must not collapse.
- **NOT device-verified,** and `health-connect/ingest` was **read but not called** — it is
  secret-gated and its validation is unverified by this sweep. The Oura BLE sample routes were not
  exercised with real frames. Screens for these pillars are not re-reported: all five rendered clean in
  the 2026-08-17 failure-cells sweep.
- **Section coverage is now complete for this run** — every pillar reviewed at least once:
  workouts (Q-460…Q-462) · nutrition/cardio/activity (Q-463) · sleep/readiness/heart-rate/body/devices
  (Q-464, Q-465) · app-shell/platform (Q-450…Q-459). Still open by design: the **device runtime**
  (nothing left the web build), **production data** (`claude_ro` never queried), and the
  **offline/error paths**.
- **🟡 Q-466, found while landing these PRs rather than by the probe:** CI re-downloads the Playwright
  browser on every E2E run with no cache, and a slow CDN turns that into an indefinite stall — observed
  **three times on 2026-08-18**, each costing a cancel-and-re-run cycle on a **required** check. `actions/cache`
  on `~/.cache/ms-playwright` is the standard fix.
- **Nothing was fixed.** All three are queued.

### [platform][nutrition][cardio][activity] 🟠 Nutrition/cardio/activity writes probed cross-user, and the whole write surface measured for one question (Q-463, 2026-08-18)

- **Two halves.** The nutrition/cardio/activity mutations probed cross-user exactly as workouts were;
  then — because the workout sweep's Q-462 looked like it might not be a one-off — **every dynamic
  write route in the app** called with a fabricated UUID to ask one question uniformly: what happens
  when the row you named does not exist? 33 endpoints answered. Full tables and limits:
  [`docs/reviews/2026-08-18-write-surface-not-found.md`](docs/reviews/2026-08-18-write-surface-not-found.md).
- **✅ Cross-user protection holds here too.** Nine mutations by a second live account against the
  owner's real rows, with the owner's rows re-read from Postgres afterwards: the supplement is still
  `Creatine`, the food log still `1.5`, the meal type still `Breakfast`, the activity log still alive.
  **Combined with the workout sweep, every workout, nutrition, cardio and activity mutation reachable
  in this harness has now been probed cross-user, and none leaked or destroyed another user's row.**
  A control ran for every probe — four of them returned bodiless 500s that looked like faults, and the
  controls returning 200 are what established those were genuine rejections rather than my bad payloads.
- **🟠 Q-463 — the not-found answer is inconsistent, and five routes give it as a 500.** `PATCH
  /api/injuries/[id]`, `PUT /api/nutrition/meal-types/[id]`, `PATCH /api/supplements/[id]`, `POST
  /api/supplements/[id]/log` (all four with an **empty body**) and `DELETE /api/phase-sets/[id]` —
  plus `/api/log-exercise`, already filed as Q-462, which this generalises. One cause: **16 bare
  `throw new Error('… not found')`** in the repository layer with nothing mapping them at the route.
  `PUT`/`DELETE` on `phase-sets/[id]` return **400 and 500** for the same condition with the same
  message; neither is 404.
- **Why it is not cosmetic.** A 5xx tells the sync client to **back off and retry** a mutation that can
  never succeed (`CLAUDE.md`'s poison-pill rule classifies by status); an empty-body 500 makes the
  client's `res.json()` throw on top of the original failure; and every correctly-refused request
  writes a stack trace into **`error_events`**, the one fault view nobody watches, which prunes at 30
  days and is read at every session start. `/api/nutrition/meal-plans/*` is the in-repo reference —
  all five of its write endpoints already return a clean 404.
- **✅ Recorded as clean rather than filed:** the seven `DELETE`s returning 200/204 for an absent row
  are **defensible** — `DELETE` is idempotent by convention, the desired end state holds, and the
  outbox is right to treat it as done. That is what distinguishes them from Q-460, where the desired
  end state was a stored RPE and it did **not** hold. Written down so the benign half of the pattern
  is not filed later.
- **✅ The nutrition screen renders and reads correctly** — day totals, the water figure reflecting a
  write made through the API minutes earlier, meal sections and per-meal macros, with zero page
  errors, zero console errors and zero failing `/api/` responses.
- **NOT device-verified.** Web build only. The 12 endpoints that returned 400 did so from body
  validation *before* the id lookup and are **excluded as evidence** rather than counted as correct.
  The meal-plan generation, running-plan write and barcode/scan paths were not exercised.
- **Nothing was fixed.** Q-463 is queued directly above Q-462, the instance it generalises.

### [workouts][platform] 🟠 The workout write path probed cross-user for the first time — protection holds; a silent dropped write and an un-automatable core flow (Q-460…Q-462, 2026-08-18)

- **The lens.** Every prior sweep of this pillar read the model (1RM, RPE, autoregulation, deload) or
  swept `GET`. Nothing had probed the **mutations** — and `exercise_logs` and `set_logs` have **no
  `user_id` column**, so every write that touches them depends on someone remembering to join up to
  `workout_sessions`. Method, limits and the full tables:
  [`docs/reviews/2026-08-18-workout-write-path.md`](docs/reviews/2026-08-18-workout-write-path.md).
- **✅ The headline is the clean one: cross-user write protection holds.** A second live account
  called every workout mutation against the owner's real row ids, and the owner's rows were re-read
  from Postgres afterwards: `PATCH`/`DELETE /api/workout-entry` → **404**, `DELETE
  /api/workout-sessions` → **404**, `/api/log-exercise` → **refused**, `ai-periodization/prescribe` →
  **404**. Nothing crossed accounts. `workout-entry`'s `assertOwnership` is the documented
  join-to-`workout_sessions` pattern done right. **A control was run for every probe** — the same call
  by the owner on their own row returned 200 and actually changed the weights — because a 4xx proves
  nothing if the body was malformed. That control caught one of my own probes being wrong mid-sweep.
- **🟠 Q-460 — the session-RPE route reports success for a write that matched nothing.** A fabricated
  session UUID returns `{"success":true}`. The security half is correct (the UPDATE is user-scoped and
  matched zero rows); the missing piece is the affected-row check. **On device this is worse than a
  wrong status code:** `pushMutations` does `setSessionRpe(...)` then `processed++` unconditionally, so
  an RPE whose session row is absent server-side is **counted as processed and removed from the
  outbox** — local keeps it, the server never gets it, nothing retries.
- **🟠 Q-461 — the workout flow cannot be automated past set 1.** `Start Set 2` carries an infinite
  `animate-bounce`, so Playwright's stability check never passes and the click hangs to the test
  timeout (`animationIterationCount: infinite`; normal click blocked at 8 s; `force: true` clicks and
  advances). **Not a user-facing defect** — a human taps a bouncing button fine. It matters because the
  harness built to catch regressions (Q-249/Q-352) therefore cannot cover the app's core write path,
  and the week's two worst findings (Q-450, Q-451) were exactly the shape an E2E spec catches.
- **🟡 Q-462 — an ownership violation on `/api/log-exercise` surfaces as a 500.** `ensureWorkoutSession`
  correctly refuses the write; the defect is reporting a permanent refusal as a transient fault, with a
  stack trace. Kept low because it is unreachable through the UI **and** the outbox catches per
  mutation rather than retrying forever — both checked, not assumed.
- **Also clean:** the outbox cannot be wedged by one bad workout mutation (per-mutation `try/catch`,
  the `CLAUDE.md` poison-pill rule implemented); and the flow itself runs end to end on the web build —
  select → pre-workout → warm-up → active → set logging, correct rest countdown, RPE capture, live 1RM
  and plate maths, with **zero uncaught page errors and zero failing `/api/` responses**.
- **Two near-misses checked and cleared,** recorded so a later sweep does not re-raise them: the live
  1RM's "▲ +2.00 kg" against a header reading 97.5 is **exact** (the stored PR is 98; the 97.5 is the
  previous session's estimate), and the warm-up ramp labelling 70 kg as "92%" is a fixed target
  percentage with the weight rounded to the loadable plate step, by design.
- **NOT device-verified.** Web build only — `getLocalStore()` returns null, so the device's
  local-write-plus-outbox path was never exercised and the Q-460 outbox half is read from source, not
  run. Fresh local seed, so nothing here speaks to prod drift. Workout mutations only; the
  program/phase-set/template routes were listed and **not** called, and rule (b) (raw bodies into
  `.set()`) was **not** systematically audited.
- **Nothing was fixed.** All three are queued.

### [app-shell][readiness] 🟢 Score presentation audited (Q-281) — the colour-only-state fix is NOT device-verified (2026-08-17)

- **⚠️ Owed: open Home with the "Accent ring" style selected on the S25 and confirm the band word
  reads.** v1.318.10 adds it beside that style's band dot at **7.5 px** — legible in the Playwright
  harness at 412×915, but small type on the real panel is a different question. Contrast unmeasured
  on both themes (Q-282's gap); the word inherits the dot's colour, so it is as contrasty as the dot.
- **Audit:** [`docs/reviews/2026-08-17-score-presentation-audit.md`](docs/reviews/2026-08-17-score-presentation-audit.md)
  — 14 surfaces, **9 render a score with no contributors and no trend**. **Read it before Q-278**: it
  refutes two of that entry's premises with measurement.

### [platform] 🟠 The repo migration reviewed as an architecture change — no credentials leaked, CI posture correct, four leftovers filed (Q-456…Q-459, 2026-08-17)

- **The lens.** Going public was not a hosting change. It altered three architectural properties at
  once: vendor material had to leave the tree (turning build-time imports into a **runtime dependency
  on private object storage**), every configuration and documentation surface silently changed
  audience from one owner to the public, and **CI became triggerable from outside the project**. This
  sweep checked all three plus the leftovers still pointing at the archived repo. Full write-up with
  the method and its limits:
  [`docs/reviews/2026-08-17-repo-migration-architecture.md`](docs/reviews/2026-08-17-repo-migration-architecture.md).
- **✅ The two answers that mattered most are both good.** **No credentials were published** — no
  GitHub/Google/OpenAI-shaped keys, no PEM private keys, no `.env` (only `.env.example`, values all
  empty), no keystores, no tracked build output, and no third-party personal data (the only real
  emails in the tree belong to bundled library authors). And **the CI posture is correct for a public
  repo**: all three workflows trigger on `pull_request`, **not `pull_request_target`**, so fork PRs
  get no secrets; `ci.yml` uses no secrets at all; and the APK publish is gated on
  `github.event_name == 'push'`, which a fork cannot reach.
- **🟠 Q-456 — the owner's production user ID is in 18 committed migrations, and the documented
  process re-publishes it on every schema change.** `fe481797-…` is baked in by
  `scripts/generate-claude-ro-views.js` as the row-scoping predicate. **Not a credential** and not
  exploitable alone (`/api/admin/db-query` needs the secret *and* `requireAdmin`) — but it is one half
  of the `WEBHOOK_USER_ID`/`ADMIN_EXPORT_USER_ID` pairs, cannot be rotated cheaply, and `CLAUDE.md`'s
  "re-run the generator into a **new** migration" rule means every future schema change adds another
  public copy. Fix the generator, not the 18 files.
- **✅ Q-457 FIXED (Lane B, 2026-08-17)** — `lib/github-release.ts` defaulted `APK_RELEASE_REPO` to the
  archived private repo; it now defaults to `nekodas-neko/TrainingAi_Open`, so an unset variable
  degrades to correct rather than to a frozen release failing as "Could not fetch release info".
  **Guarded** by a test on the URL actually requested, which fails when the default is flipped back —
  the fixtures the entry flagged proved nothing about which repo is *asked*. Never a live outage.
- **🟡 Q-458 — `.env.example` is wrong in both directions.** Eight declared keys are read by no code,
  including **`TOKEN_ENC_KEY`, which names a security property the app does not have** (an operator
  will set it and conclude tokens are encrypted at rest; nothing reads it), and five Oura **Cloud**
  keys inviting a contributor to configure the one integration `CLAUDE.md` forbids re-adding. Four
  real config vars are undeclared.
- **🟡 Q-459 — the rolling APK release is delete-then-recreate,** so the advertised public download
  URL 404s during every native merge. Known trade-off in the workflow's own comment; the migration is
  what made it matter, since that URL is now the documented distribution path.
- **Also came back clean:** a fresh clone's test suite genuinely works (synthetic constants are
  committed and `vitest.config.ts` falls back to them when the real `MANIFEST.json` is absent — the
  path CI takes every run, so `NOTICE`'s claim holds); the `AWS_*`/`STORAGE_*` split is a deliberate
  alias chain rather than two competing schemes (**checked and cleared — a near-miss worth recording
  so it is not re-raised**); and `private-paths.json` is well built, down to descriptions deliberately
  written non-specifically so the inventory is not itself a map to what it protects.
- **The one structural gap, noted rather than filed:** `private-paths.json` protects a third party's
  IP and nothing plays that role for **this project's own users' identifiers**. Q-456 is the single
  instance found, and it reached a public repo because no gate was looking. Whether that wants a
  second list or a widening of the first is a design decision, not a review finding.
- **Method limits.** Static inspection of the tracked tree at `8a1bf82`, not a clean clone built from
  scratch; **nothing checked against the deployment**; secret detection was pattern-based, so it is
  strong evidence of absence for conventional formats and not proof for a bespoke one. Git history was
  not swept and does not need to be — the public repo begins at a single snapshot commit with no
  pre-migration history — but that reasoning does not transfer to the archived private repo.
- **Nothing was fixed.** All four are queued.

### [app-shell][devices] ⚠️ Q-532 FIXED — a streaming panel no longer scrolls the page; NOT device-verified (v1.317.6, 2026-08-17)

- **Cause:** `scrollIntoView` on a sentinel inside the log panel's `overflow-y-auto` box. It scrolls
  **every** scrollable ancestor up to the document, so each log line during a drain moved the whole
  `/admin/oura-ble` page — on the one screen where a mistimed tap can hit Clear key. Both call sites
  now use `lib/hooks/use-scroll-to-bottom.ts` (`scrollTop` on the container, which cannot escape it).
  The sibling sweep found a second, unreported instance: the workout-builder AI chat.
- **NOT device-verified and not reproducible here** — the sandbox cannot run a BLE scan, so the
  mechanism is identified but the symptom was never seen to disappear. **Owner check: run a drain,
  confirm the page holds still.**
- **No regression guard exists** — a capability gap: both vitest projects are `environment: 'node'`
  with no `@testing-library/react`, and the route needs admin plus a live radio, so neither a
  component test nor an E2E spec can reach it. Reintroducing the bug would fail nothing.
- Detail: [`entries/2026-08-17-scroll-panel-page-jump.md`](docs/overview/entries/2026-08-17-scroll-panel-page-jump.md).

### [platform][devices] 🔴 Production hit `disk_full` during a full re-sync — and the indexes, not the data, are the bulk (2026-08-17)

**Live fault, mitigated by raising the volume; the underlying sizing is unresolved.** During the
2026-08-17 ring re-sync, `/admin/oura-ble` returned a Server Components render error and two API
routes failed with **`[pg 53100]`** — PostgreSQL's `disk_full`. Both failing queries read
`oura_raw_samples`; one is a `SELECT DISTINCT ON (tag)` over 1.1M rows, which must sort, and with
`work_mem` at 4 MB it spills to temp disk. There was no room. Confirmed in `error_events`
(`GET /api/oura-ble/device-metrics`, `GET /api/oura-ble/samples/summary`).

**Measured at the time of failure:**

| | |
|---|---|
| Database total | **583 MB**, up ~110 MB in one hour |
| `oura_raw_samples` heap | 175 MB |
| `oura_raw_samples` **indexes** | **291 MB** — 1.66× the heap |
| That one table | **80% of the database** |
| `last_autovacuum` / `last_analyze` | **never** — `n_live_tup` reads 0 |

**Three things stack, and only one of them is the archival data.**
1. The volume was full. Owner raised it 500 MB → 5 GB as a temporary mitigation. **That raise is now
   permanent and correct — the "return to stock 500 MB" target is WITHDRAWN (2026-08-18).** Railway
   cannot shrink a volume (*"Down-sizing a volume is not currently supported"*), and bills *"only …
   the amount of storage used,"* not the provisioned size — so 5 GB costs what 500 MB would. Reverting
   would mean a dump/restore onto a fresh volume: real downtime and risk on the database holding the
   ring archive, to save nothing. **Do not attempt it.** What is genuinely lost is the tripwire — 500 MB
   is what made this bloat scream rather than creep — so add a DB-size line to the session-start
   orientation read beside the `error_events` check.
2. **Indexes exceed the table.** The dedup index covers
   `(user_id, ring_timestamp_ds, tag, body_hex)` — it indexes the raw payload itself, so it grows
   faster than the rows do. **291 MB of the 466 MB is index, not data.**
3. **Autovacuum has never run on this table**, so there are no statistics either. The planner has
   been working blind on the largest table in the database; that same `DISTINCT ON` takes 6.5 s
   even with disk available.

**Why (2) matters more than it looks.** Reclaiming index space is *non-destructive* — it does not
touch `body_hex`, so it does not collide with the rule that the server archive is the source of
truth and must never be pruned. Replacing the payload in that index with a hash would preserve
dedup semantics on a fraction of the bytes. That may get under 500 MB without deleting anything,
which is a very different proposition from the retention question.

**⚠️ Correction to (3), measured after recovery — do not chase an autovacuum misconfiguration.** At
08:04 and 08:45 UTC this table reads `last_autovacuum = 2026-08-17T07:57:35Z` and
`n_live_tup = 1,097,626`. **Autovacuum has run, twice, today.** The never/0 reading was taken while
the statistics were still empty: an unclean shutdown makes Postgres discard the stats file on
recovery, and `stats_reset` stays `NULL` because only an explicit `pg_stat_reset()` sets it — so
freshly-zeroed counters look exactly like "never". `error_events` showed the same artifact, reading
`n_live_tup = 0` while holding 6,222 rows. **Every counter on this table is now "since ~07:42", not
lifetime** — which also means index `idx_scan` counts are a short window, not evidence of disuse.

**What actually consumed the space, proven.** `n_tup_ins = 0`, `n_tup_upd = 681,005`,
**`n_tup_hot_upd = 0`**. The re-sync was the *trigger* (a catch-up drain, whose re-POSTed events all
dedup to zero inserts); the *mechanism* is the full-table `measured_at` re-stamp that ops-doc I14/I25
tells the owner to run after one. The table went 360 → 666 MB — and the DB 464 → 771 MB — while live
rows went **down** by 557 and `body_hex`/`event_name` did not move at all. **Zero new data; ~306 MB
of pure bloat.**

**The fourth finding, and the one with leverage.** `measured_at` is indexed, so **no update that
changes it can ever be HOT** — each rewrites a heap tuple plus an entry in all four indexes — and it
is the *only* indexed column such a re-stamp changes. **Dropping `idx_oura_raw_samples_user_measured`
makes the whole operation HOT-eligible**, so it is both a space win and the fix for the mechanism.
Q-46's `IS DISTINCT FROM` guard is present and correct (`adapter.ts:4954`) and **is not the bug** —
it can only skip a re-stamp writing back the same value, and the Q-71/I25 clock fix changed every
row's derived value. The durable hazard: the operations manual prescribes Redecode as the remedy for
**five** failure modes (I12, I14, I19, I20, I25), so the documented fix procedure is a disk-fill
hazard until that index goes and the route gains a free-space pre-flight check.

**Is 500 MB reachable without touching retention? Yes — measured, not estimated.** `VACUUM FULL`
→ ~465 MB; + the index work → ~355 MB; + Q-540 → ~305 MB; + `error_events` self-clearing → ~260 MB.
**The owner chose A+B+C on 2026-08-17 and declined both irreversible options** (Q-542), so the
archival rule stands unchanged. Caveat worth keeping separate: *reaching* 500 MB and *holding* it
differ — vacuum alone re-crosses it in ~5 days, with the index+row work ~7 weeks, and **with Q-541
(repack) ~3 years**. Sequencing, and the owner's own runbook, in
[`docs/superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md`](docs/superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md) §0/§0a.

**Owed:** the sizing work (see the storage research item) must now be framed as *how to get back
under 500 MB safely*, not *whether growth will eventually matter* — it already does. Separately,
**do not run another Full re-sync until this is resolved**; that is what triggered it.

**Progress, 2026-08-18 — part 2.** Q-534's **finding 4 is done**: both readers of the stored
`measured_at` were rewritten to convert their window through the clock anchors and read ds-keyed, and
migration **193** drops `idx_oura_raw_samples_user_measured` — **136 MB**, the single largest
reclaim available without moving a row. It also **removes the outage's mechanism rather than
mitigating it**: with every reader deriving the time, the stored column is dead, so the redecode's
re-stamp — the non-HOT full-table rewrite that filled the disk — is now a no-op. Findings 1–3 of
Q-534 (payload-in-index, autovacuum never having run, `work_mem`) are still open. ⚠️ The 136 MB is
the measured size in production, **not a reclaim that has happened** — the drop runs on the next
deploy's `ensureSchema`, and the space returns to the file only after a `VACUUM FULL`.

**Progress, 2026-08-18.** Q-541 Tasks 0–3 have shipped (v1.318.11–12) — the `oura_raw_packed` table,
the codec, and the two-tier reader every raw-frame read now goes through. **⚠️ None of it has moved a
row**: nothing writes a blob yet, so the database has not shrunk by a byte and the size numbers above
still stand. Re-measured that morning it is **819 MB**, up from 786 the day before, with
`oura_raw_samples` at 699 MB (255 MB heap, **443 MB indexes**). Tasks 4–7 — packer, backfill, prune,
`measured_at` sweep — are what reclaim the space. One cheap win was found and filed rather than
taken: **Q-315**, `error_events` holding 4 live rows in 49 MB, reclaimable by a single `VACUUM FULL`
with nothing at risk.

### [devices][platform] 🔴 An app uninstall destroys the Oura ring key, and nothing warned about it (2026-08-17)

The 32-hex ring key lives **only** in Android SharedPreferences. `OuraBlePlugin.kt` says so in its
own comment — *"the key never leaves SharedPreferences; never logged"* — so it is not on the server,
not in this repository, and not in any log. Correct for a credential, and it means **an uninstall
makes the ring unreachable**: the BLE service logs `no key stored` and refuses to start, while the
Devices screen still shows the ring as healthy because that card reads server data.

Hit live on 2026-08-17. The uninstall was necessary (moving to a stably-signed APK, #19), and the
"what you lose" list given beforehand covered only the JS local store — the native side was never
checked. Recovered from the `key.hex` the original `open_oura` re-key produced; **there is no
other copy**, and if it had been lost the only apparent fix — re-onboarding the official Oura app —
is the one that can force a firmware update and break the reverse-engineered protocol outright.

Documented in `CLAUDE.md`'s APK section and as §0 of
[`docs/oura-ble-operations.md`](docs/oura-ble-operations.md). **Still open** because the mitigation
is prose, not a mechanism: nothing in the app backs the key up, warns before an uninstall, or lets
the owner export it. Worth a backlog entry for an explicit "export/ring key" affordance before
the next device change.

### [workouts][readiness] ✅ An engine-chosen deload prescribed full weights — fixed, device check owed (Q-310, 2026-08-17)

- **Fixed in v1.317.5.** `/api/workout-data`'s ai_dynamic catch-all — two verbatim copies —
  hardcoded `isDeloadActive: false` while title-casing the *same* `aiPeriodizationState.phase` into
  the header label, so an engine-chosen deload (nobody confirms it, so it reaches no earlier branch)
  read "Deload" and prescribed full intensity. Both copies now call `aiDynamicFallbackPhaseStatus()`.
  Detail and evidence: [`entries/2026-08-17-ai-dynamic-deload-fallback-not-flagged.md`](docs/overview/entries/2026-08-17-ai-dynamic-deload-fallback-not-flagged.md).
- **`personal_records` was never corrupted and no migration is needed** — `logExerciseFromPayload`
  gates independently; both production deload sessions carry `max(estimated_1rm) = 0` and no PR row.
  The badge the owner saw was the client's optimistic display. (Owner-scoped `claude_ro` read.)
- **Owed: the device check.** Server/JS only, so it reaches the APK via the Railway deploy with no
  rebuild, but the client half was verified from the route's response, not on hardware. Confirm on
  the S25 at the next engine-chosen deload: header "Deload", reduced weights, no PR badge. Local
  SQLite rows written during the bug window self-heal on the next pull; not observed on device.

### [activity][workouts][app-shell] 🔴 The first sweep to RUN the app since the six-round review — two dead primary actions, one of which loses data (Q-450…Q-455, 2026-08-17)

- **Why this found things six rounds of review did not.** The comprehensive review that closed the
  same morning states its own limit: *"Nothing in six rounds was rendered — no device, emulator,
  browser, or `pnpm dev` run."* This sweep took the **failure-cells** lens — the error path, the
  empty state, the first-run path, the entry point reached out of order — against `pnpm dev` on the
  seeded local Postgres, driven through the repo's Playwright harness at 412×915 and with `curl`
  against a live session cookie. Full write-up, with every query and the reproduction:
  [`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](docs/reviews/2026-08-17-failure-cells-running-the-app.md).
- **✅ Q-450 FIXED (v1.318.2) — `/activity` without a type recorded an activity and discarded it on
  Save**, with no toast, error or network request, because `done-activity-screen.tsx` bailed on
  `!activityType` before the local write, the outbox and the web fallback alike. Reached from the
  Coach handoff, the guided-walk Done button, a cold open or a refresh — and `resetSession()` leaves
  the store untyped after **every** save. It now shows a type picker instead of a recordable blank
  screen, and the bail-out toasts. Guarded by `e2e/activity-untyped-entry.spec.ts`, mutation-checked.
  **Not device-verified** — the web fallback ran, not SQLite+outbox. The spec exposed a second defect
  the bail-out was masking, filed as **Q-351** (Lane A): a sub-3-second activity rounds `durationMin`
  to 0, which `.positive()` rejects as a bare 400. [Journal](docs/overview/entries/2026-08-17-activity-untyped-entry.md).
- **✅ Q-451 FIXED (v1.318.3) — a new account's Workout tab was a ~1,400 px empty card with a dead
  button** whose onClick short-circuited on the missing `currentSession`. Now "No program yet" + a
  **Create a program** CTA; the inert button is gone rather than disabled, and a `programLoaded` flag
  separates "no program" from "still loading" so it cannot flash. **Now guarded** by
  `e2e/first-run-empty-states.spec.ts` against the zero-data account Q-352 added (mutation-checked).
  Home's syntactic sibling is guarded upstream and is not a bug.
  [Journal](docs/overview/entries/2026-08-17-workout-select-empty-state.md).
- **✅ Q-452 HALF-FIXED (v1.318.6)** — the AI insight card ran an LLM over literal `"no data"` strings,
  telling a day-one account *"…shows zero movement… this inactivity creates a significant gap"*.
  `AiInsightCard` now takes a required `hasData` and neither fetches nor renders without it. **Now
  guarded** by `e2e/first-run-empty-states.spec.ts`, which asserts on the *request* (asserting on the
  rendered card passes with the gate deleted). **Prompt half is Lane A's — Q-353.**
- **🟡 Q-453/454/455 — three low-severity ones,** filed mid-low: `/api/training-stress` silently
  answers for *today* on a malformed `date` where its ten siblings all 400; `/api/day-log` and
  `/api/exercise-history` validate params before checking auth (**no data leaks** — verified 401 once
  the param is supplied); and an unhandled throw returns a **bodiless 500** rather than a JSON error.
- **Four areas came back CLEAN and are recorded so the next sweep skips them.** (1) The `[-/]`
  date-separator class — all 11 date-taking routes accept **both** separators live. (2) The
  unauthenticated surface — 122 GET routes, **114 exact 401**, 3 admin 403, 2 deliberately public;
  **no route served user data unauthenticated**. (3) A zero-data account against all 122 GET routes —
  **exactly one route differs**, a clean `404 {"error":"No active program"}`. (4) 51 screen renders
  (30 seeded + 21 zero-data) — **zero uncaught page errors, zero console errors, zero failing `/api/`
  responses**, and the empty states are genuinely well built apart from Q-451.
- **NOT device-verified, and structurally cannot be here.** This is the **web** build:
  `getLocalStore()` returns null, so every offline-first domain took its web fallback and the device
  branch — the canonical runtime — was never exercised. No safe-area, Samsung-WebView, native-plugin
  or native-SQLite claim is made, and a fresh correct local seed cannot speak to prod data drift.
- **Q-450 and Q-451 have since shipped (Lane B, v1.318.1/v1.318.3) and are struck above; the other
  four stay queued** (Q-452's client half shipped too; its prompt half is Q-353, Lane A).
### [devices][heart-rate] 🔴 The ring records SpO₂ and daytime HR permanently — ~3.5× stock battery drain (Q-388, 2026-08-17)

- Owner: stock ring lasts 7 days; on our build it loses ~20% overnight and needs charging every 2
  days. That is ~50%/day against a ~14%/day stock baseline.
- `OuraProtocol.kt:123-127` — `enableMeasurementSequence()` sets **DAYTIME_HR + SPO2 + REAL_STEPS →
  AUTOMATIC** on *every* connect, unconditionally, with **no user toggle**, re-asserted on each
  reconnect. On stock, blood-oxygen sensing is opt-in and the vendor warns it costs battery.
- **Production (owner's rows, 7 days):** `spo2_r_pi_event` is the largest source at **53,412** rows,
  and **~75% of it lands between 22:00 and 09:00** — precisely the window the owner is losing 20% in.
  Green-PPG adds a steady daytime load. Daily totals stepped 5,378 → ~24,000 on **2026-08-04** and
  held; **unexplained, and confounded** — this counts *ingested* events, so better draining looks
  identical to more sensing. Resolving that comes first.
- **Separate latent trap (not today's cause):** `reqBleFastHrMode(false)` and `EXERCISE_HR →
  AUTOMATIC` exist only in `liveHrStopSequence()`; the connect-time sequence resets neither. A
  live-HR session that never reaches `stopLiveHr()` — app killed mid-workout, or the tester's
  **Live HR** button without **Stop HR** — leaves continuous fast-HR sampling on permanently, healed
  by no reconnect or restart. Production shows it is *not* firing now (`ehr_trace` is zero 21:00–08:00).
- **Nothing has measured ring power draw, because nothing records it** — the keepalive polls battery
  every 5 min and `parseBattery` decodes it, but it is never persisted. Everything above is
  code-traced or inferred from event counts. Persisting that poll is the prerequisite for a real fix.
- **Q-388** holds the trace, the hourly table and the fix directions. **Device-gated** — needs an APK
  and a wear cycle. **Not fixed; not started.**

### [nutrition] 🟠 A half-logged day feeds the calibrated maintenance as if it were complete (Q-387, 2026-08-17)

- Owner asked what stops the tuner treating "breakfast + lunch, skipped dinner" as a whole day.
  Nothing does. `adaptive-tdee.ts:96` counts any day with `intakeKcal > 0` as logged, so one apple
  qualifies — it clears the coverage gate *and* enters the mean intake the estimate is built on.
- Measured with the module: 14-day window, weight-stable user whose true maintenance is 2600, six
  partial days → **2086 kcal**, with `daysLogged: 14`, `excludedReason: null`, `confidence:
  'medium'`. 86 kcal of error per partial day, every gate passing, and the 1000 kcal plausibility
  floor never fires. It reaches the **prescription**: `energy-balance-service.ts:180` feeds it to
  `targetFromMaintenance`, so the recommended target carries the error and a cut's delta stacks on it.
- **Two partial-day guards exist and neither covers this** — an unlogged day is a gap, and *today*
  is excluded. The comment at `energy-balance-service.ts:146-150` names this exact trap and solves
  only the in-progress case; an abandoned **past** day never self-corrects. The 2026-08-11 entry
  below presents those two as the whole story, which this corrects.
- **Latent and armed.** Per Q-302 no recent window clears the gate, so nothing wrong shows today; it
  fires when logging gets consistent enough to switch tuning on — on success, not failure.
- **Q-387** holds the trace and an assessment of the owner's two proposed controls (the "% below
  expected" one is circular — do not ship as specified). No device or prod data needed. **Not started.**

### [platform] ✅ PR #1390's red E2E job — cause found, fixed (Q-297/Q-309, closed 2026-08-17)

- **The cause was not environmental and not the specs.** `components/weekly-recap-banner.tsx` POSTs
  `/api/weekly-digest` on every Home mount; that route returns **502 by design** when the model call
  fails, which it always does in CI because the E2E job sets no `GOOGLE_GENERATIVE_AI_API_KEY`.
  `tabs-instant-paint.spec.ts` counts any `/api/` 5xx as a page-load failure, and whether the POST
  returns before the assertion is a race — so the Home tab was one lost race from red on every run.
  Two runs eleven minutes apart on identical code went one each way.
- **Fixed** in `TrainingAi_Open` #5 with a *named* exclusion (`EXPECTED_5XX = ['/api/weekly-digest']`),
  not a blanket "ignore 502" — a 502 from any other route is still a finding, and so is a 500 from
  this one.
- **Correcting the old entry's suggested next step:** downloading the `playwright-report` artifact
  cannot work. `playwright.config.ts` uses the `github`/`list` reporters, which never write that
  directory, so the `if: failure()` upload always produces an empty artifact.
  **What does work:** `actions_get` → `get_workflow_run_logs_url` and download the zip.
  `get_job_logs` genuinely cannot reach the Playwright output — it caps at 5,000 lines and the
  Postgres container dump consumes all of them.
- **The `FATAL: role "root" does not exist` lead was not the cause** and was not pursued further. It
  is present while the suite passes, so it is noise for this purpose rather than a finding — but
  nobody has explained it, and it should not be re-chased as an E2E failure cause.
- Context: [`docs/handoff-2026-08-16-platform-e2e-harness-and-backlog-run.md`](docs/handoff-2026-08-16-platform-e2e-harness-and-backlog-run.md).

### [workouts][readiness] 🔴 An ai_dynamic deload phase reached via the generic fallback branch runs at full weight and can mint a wrong PR (Q-310, 2026-08-17)

- **Owner-reported, live, unfixed.** A session labeled "Pull · Deload" in the header showed weight
  climbing set-to-set, and the exercise summary right after fired a "New Personal Record!" badge —
  during what the app itself called a deload.
- **Root cause, confirmed by reading the code, in two identical copies:**
  `app/api/workout-data/route.ts`'s ai_dynamic generic fallback branch title-cases
  `aiPeriodizationState.phase` into the correct display name ("Deload") but hardcodes
  `isDeloadActive: false` / `phaseType: 'normal'` — so weight prescription and the
  `shouldCountTowardPr` PR gate (`packages/shared/src/workout/log-exercise.ts`) both treat the
  session as normal. This is not the separate `earlyDeloadWeek` mechanism, which already sets the
  flag correctly; it's the AI's own accumulated-fatigue-triggered `phase: 'deload'` falling through
  to a branch that doesn't check for it.
- **Consequence: a genuine `personal_records` row can already have been written from submaximal
  work**, and whatever signal made the AI want a deload never gets addressed since none actually
  happened — plausibly why the owner saw another deload recommended right after this one.
- **Not yet fixed** — queued as Q-310, near the top of `docs/implementation-backlog.md` given its
  severity. Needs a production data check (any already-wrong `personal_records` rows from this
  path) before or alongside the code fix. Full trace:
  [`docs/handoff-2026-08-17-workouts-owner-bug-batch-deload-fallback.md`](docs/handoff-2026-08-17-workouts-owner-bug-batch-deload-fallback.md).

### [platform] ✅ The repo can now run its own app — E2E harness shipped (Q-249, 2026-08-15)

- **466 test files, none of which opened a browser** — until now. `playwright.config.ts`, `e2e/`,
  `pnpm e2e` and a separate `E2E` CI job. One spec: the five tabs must paint real content on a
  repeat visit, which makes the instant-paint rule executable instead of reviewed by eye.
- **Read [`e2e/README.md`](e2e/README.md) before trusting a green run.** It records what the harness
  proves and what it cannot, all measured: it drives the **web** build (`getLocalStore` returns null,
  so every offline-first domain takes its web fallback and the device branch never runs); it uses
  `pnpm dev` because the pg pool forces SSL under `NODE_ENV=production` and the local Postgres does
  not speak it; and its skeleton check covers **only the panel in the viewport**, so a tabbed screen
  like Health is roughly a third covered.
- **The harness was shown to discriminate, and the first attempt to do so failed usefully.** Forcing
  a Training-panel card to stay loading turns Health red. Forcing the Body-tile skeletons does not —
  that panel is off-screen — which is how the viewport limitation was found rather than shipped as a
  false guarantee. A Health "bug" found on the first run was traced, fixed, and then **reverted**
  once the off-screen carousel panel explained it.
- **The per-tab coverage gap is closed for Health** (2026-08-15, Q-297): `e2e/health-tabs-instant-paint.spec.ts`
  drives `?tab=` and asserts the requested tab is *selected* before checking, so each panel is
  actually in the viewport. Verified by the mutation Q-249's spec could not catch — pinning the
  Body tiles' skeleton now fails, and fails only the Body case. **Every other tabbed screen still
  has the gap.**
- **The `E2E` job is not a required status check** and should stay that way until it has a track
  record. Remaining write-path specs and the promotion are **Q-297**.
- Detail: [`docs/overview/history-2026-08-15.md`](docs/overview/history-2026-08-15.md).

### [app-shell][health] ⚠️ Two user-visible goal fixes shipped — NOT device-verified (Q-260, Q-258, 2026-08-16)

- **v1.317.2 (Q-260)** — changing a goal on More now reaches Health. `user-goals` was fetched by
  `fetchProgressHealthData` while the water goal renders in `waterIntake`, a `BODY_GROUPS` card, so a
  value shown on Body was fetched only by a tab the user may never open — and since every tab stays
  mounted for the app's life, nothing re-read it. Measured at the stale moment: server,
  `ta_cache:user-goals` **and** the `ta_water_goal_ml` device copy all held the new value while the
  screen showed the old one for 120 s. Fetch moved to the shared group; the localStorage seed moved
  to `useGoalSeeds`, which re-reads on `tabEpoch`.
- **v1.317.3 (Q-258)** — six goal/body inputs on More now announce their names to screen readers.
- **Neither is device-verified.** For Q-258 the gap is precise: Playwright resolving `getByLabel`
  proves the accessible name is wired, which is the mechanism that was broken — it is **not** the
  same as hearing TalkBack announce the field on the S25.
- **The class behind Q-260 is not swept.** Target weight and target body fat ride the same
  seed/`userGoals` pair and are fixed by the same change, but **any other screen that reads a value
  it does not re-subscribe to has this exact shape** — mount-scoped state on a screen that never
  unmounts. No sweep was done.
- Detail: [`docs/overview/history-2026-08-15.md`](docs/overview/history-2026-08-15.md) ·
  [`docs/overview/history-2026-08-15.md`](docs/overview/history-2026-08-15.md).

### [app-shell][platform] ⚠️ Q-261 FIXED — six button groups on More now have accessible names; TalkBack check still owed (v1.317.4, 2026-08-17)

- **Shipped in v1.317.4.** Fitness Goal, Biological Sex, Activity Level, Weight Units and Food
  Region now carry `role="radiogroup"` + `aria-labelledby` on the visible text, with
  `role="radio"`/`aria-checked` per option — the shape three sites already used. Timezone was not a
  group at all, so `<Label>` went there and its "Auto-detect" button now names what it detects.
- **NOT device-verified, precisely:** `e2e/profile-group-labelling.spec.ts` asserts via Chromium's
  accessibility tree (both assertions proven lethal by mutation), so names and checked state are
  known to be exposed — not the same as hearing TalkBack on the S25, the only thing still owed.
  Layout is unchanged. Arrow-key nav is deliberately absent, matching the three pre-existing
  radiogroups; filed as **Q-350**. [`Detail`](docs/overview/entries/2026-08-17-profile-group-labelling.md).

### [readiness][app-shell] ⚠️ The readiness card now flips on the tap — cause is code-evidenced, NOT device-reproduced (Q-248, 2026-08-15)

- **Shipped in v1.317.1.** Logging Exercise Readiness on Home showed a "Readiness saved" toast over
  an unchanged "How are you feeling?" prompt. The callback that flips the card sat behind
  `await localWrite`, a write already documented as able to queue for ~2 minutes behind a sync
  pull's `applyDelta` on the single Capacitor SQLite connection. It now fires on the same beat as
  the toast; `onSaved` stays behind the invalidation so the prescription refetch keeps its
  session-164 ordering.
- **The entry's step 1 was "reproduce on device with a sync pull in flight before changing
  anything", and that did not happen** — no device in session. What shipped fixes the cause the code
  evidences, not a cause confirmed against the observed failure.
- **The second possible cause is still open.** The screenshot cannot separate "still mid-stall" from
  "`onSaved` never fired at all". If it was the latter, the card will flip now regardless, but the
  local write would still be failing silently. **If the card flips and a day's readiness later turns
  out to be missing from the server, that is the other cause and this reopens.**
- **The device check that would close this:** trigger a sync pull, log readiness mid-pull, and
  confirm both that the card flips immediately and that the log reaches the server afterwards.
- Detail: [`docs/overview/history-2026-08-15.md`](docs/overview/history-2026-08-15.md).


### [devices][platform] 🟠 `oura_raw.db` grows without bound on the phone — now measured: 209,326 rows, **0 rolled up**, 31.2 MB (Q-538, 2026-08-17 · measured 2026-08-18)

The documented "14-day rolling buffer" for on-device raw frames (owner retention decision,
2026-08-02) **has not shipped**. `OuraRawDb.kt` implements `pruneRaw`/`markRolledUp`/`getUnrolledRaw`/
`rawStats` and all four are exposed on the plugin bridge, but **a repo-wide grep finds no caller for
any of them**. Two independent causes, and fixing the first does not fix the second: nothing invokes
`pruneRaw`, and its predicate needs `rolled_up = 1`, which is set only by the WebView rollup consumer
(**D2 Task 5, not built**) — so wiring the prune tomorrow would delete zero rows.

The store has therefore accumulated everything drained since 2026-07-27 at roughly 2–3 MB/day. This
can wedge the drain: ops-doc **I21** holds the cursor on `SQLITE_FULL`.

- ✅ **Measured on device 2026-08-18** — the panel exists and the owner read it: **209,326 total rows,
  `rolled up` = 0, 31.2 MB on disk, `low disk` no.** Zero rolled-up rows means `pruneRaw`'s predicate
  matches nothing, so both causes above are confirmed from the device rather than inferred.
- **31.2 MB is a floor.** The store was wiped by the 2026-08-17 reinstall and rebuilt in ~1.5 days by
  the Full re-sync re-draining the ring's buffer at cursor 0. Forward growth ≈ **3.4 MB/day**
  (~149 bytes/row), matching the ~3.2 MB/day this repo already recorded and the ~1.2 GB/year the
  2026-08-02 retention decision predicted for an unpruned tier.
- **Related, and load-bearing for the D4 decision:** `AndroidManifest.xml:14` sets
  `allowBackup="true"` with no `dataExtractionRules`. Android Auto Backup's cloud quota is 25 MB/app
  and the file now measures **31.2 MB**, so **the device raw store has no working backup** — that was a
  projection when this row was filed and is now a measurement.
- Detail and the five costed options:
  [`docs/superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md`](docs/superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md).

### [platform][devices] 🟢 Q-308 RESOLVED — serialise the sync fan-out; owner-measured RTT settled it (2026-08-16)

The owner measured Railway per-query RTT from the app service — **p50 0.86 ms · p95 1.22 ms · min
0.62 ms** — which was the one thing Q-308 said had to be known before touching anything. Evidence in
[`docs/reviews/2026-08-16-sync-fanout-rtt-verdict.md`](docs/reviews/2026-08-16-sync-fanout-rtt-verdict.md).

With a 1 ms per-query hop simulated against the production pool of 10:

| concurrent syncs | PARALLEL (today) | **SERIAL** | CHUNKED ×4 |
|---|---|---|---|
| 10 | 155 / 161 ms · 210 conn | **95 / 137 ms · 10 conn** | 138 / 145 ms · 40 conn |
| 50 | 588 / 625 ms · 1,050 conn | **356 / 607 ms · 50 conn** | 700 / 744 ms · 200 conn |
| 100 | 1,153 / 1,218 ms · 2,100 conn | **588 / 1,026 ms · 100 conn** | 1,010 / 1,083 ms · 400 conn |

**Serial is faster at p50 AND p95 at every concurrency, with 21× fewer connections** — roughly half
the p50 at 100 concurrent. There is no trade-off to weigh, and chunking beats neither.

**The previous round's "serial and parallel are identical at p95" reading was measured at 0 ms RTT**,
where the two shapes converge because pool queueing dominates. A realistic hop separates them **in
serial's favour** — the opposite of the risk the entry was written to guard against. A parallel
fan-out demands 21 connections from a pool of 10, so each sync's own queries queue against each other
and pay RTT again on every acquisition.

**This re-frames Q-107 and Q-213 without striking them.** Both blame "DB-pool contention"; the pool is
not the constraint, **the fan-out shape is what creates the contention they observed**. A bigger pool
treats the symptom.

**Not exercised:** still local Postgres with a *simulated* hop (`setTimeout`, not a real network),
sync-vs-sync only — production sync also competes with every other route, which makes the
connection-demand argument stronger rather than weaker.

### [workouts][platform] 🟠 The deferred measurements, taken — one escape hatch tested and closed off, one confound ruled out (2026-08-16)

No new Q numbers. This round **answered questions four existing entries told an implementer to answer
first**, and the answers change what two of the fixes are. Evidence in
[`docs/reviews/2026-08-16-deferred-measurements.md`](docs/reviews/2026-08-16-deferred-measurements.md).

**Q-304's escape hatch was tested and did not fire.** The entry allowed that `prescriptionFactor`
might already absorb the high-rep inflation, and said closing it as measured-and-rejected was
acceptable. **28 of the 29 sets at 13+ reps that feed the 1RM carry no `planned_pct`**, so the factor
returns 1 and the raw curve stands. The proxy is exact: `log-exercise.ts:233` writes the same value
the factor consumes. **Q-304 stands — go straight to the fix.**

**Q-300's question is answered: rest is NOT the confound, so Q-289 should not wait on it.** Delta by
rest band at expected-10: on-target **−1.75**, rushed **−2.80**, overlong **−2.33**, unknown
**−2.21** — the shape error survives in every band and clears the 1.5 dead band in all four. Rest is
*a* contributor (on-target is mildest) but not the explanation. **Q-300 is re-scoped to its secondary
half — rest adherence as an unsurfaced coaching signal.**

**⚠️ And a synthesis I retracted before merging, which narrows two entries.** A first draft claimed
the prescribed-vs-unprescribed split showed `prescriptionFactor` working (r 0.30 → 0.50). It is
**confounded**: `planned_pct` only exists from **2026-07-18** (migration
`126_set_log_planned_snapshot.sql` — 0 before, ~100% after), so "unprescribed" means "older data",
and only ~15 unprescribed sets exist post-cutover. **The comparison cannot be made.**
Splitting by **era** instead: post-cutover (n=278) reads **+1.09** at expected-5 — *inside* the dead
band — and **−2.29** at expected-10, which still clears. So **Q-289 is re-scoped to the top of the
range** (heavy prescriptions reading as easy, plus the non-monotonic top that survives both eras),
and **Q-306's headline is weakened**: the emergency-deload trigger is **not** sitting inside the
error band on current data. Q-306 keeps its ACWR-at-three-thresholds half.

**Q-298 is now a one-line fix.** `log-exercise.ts:196` zeroes the 1RM when **either** the AI flag or
**the phase** says deload; **line 264 stores only the AI flag**. Line 264 should store the same
predicate. The file's own comment at 190–191 says both cases must not feed the estimate — they don't;
only one is recorded.

**Q-292 sized: all 117 insights audited.** **7 imperial-unit errors** (all Fahrenheit, all in
`sleep`) and **12 absolute superlatives** — roughly **16% carry at least one**. A second fabricated
superlative is double-confirmed: *"a perfect recovery index"*, for a contributor that scored **21 of
100** that day. (This cited Q-271's "never exceeded 50 on any of 31 scored days"; **Q-500 re-measured
it over 41 days and it is false** — see below. The superlative finding stands on that day's value.) One quasi-medical inference (hedged, benign advice, but
it infers infection from a temperature reading **and states it is advising without a readiness
score**). One regex hit was read and is a **false positive** — recorded so it is not re-raised.

**⛔ Still blocked on the owner:** **Railway per-query RTT**, which Q-308 needs before anyone touches
the sync fan-out, and which cannot be measured from the sandbox.

**Surfaces NOT exercised:** no device, emulator, browser or `pnpm dev`. One user's data. The AI audit
is pattern-match plus read-back, not an independent judgement of every insight. Cell counts at the
extremes are small (expected-10 prescribed is n = 4).

### [platform][workouts][cardio] 🟠 The last four reviews, and the load test finally run — nothing breaks at 100 users (Q-306…Q-308, 2026-08-16)

Fifth and final review. Closes the four items previous rounds listed as *not started*, and answers
the question deferred four times. Evidence in
[`docs/reviews/2026-08-16-multi-user-load-test.md`](docs/reviews/2026-08-16-multi-user-load-test.md).

**✅ Q-298 is RESOLVED.** The five unexplained 2026-08-09 zero-1RM rows all belong to **one `Pull`
session**, and `session_periodization` shows **Pull entered the `deload` phase on exactly
2026-08-09**. `estimateOneRm` was called with `deloaded: true` from the phase and correctly returned
0. **The zeros were never the bug — the defect is that the phase-level deload never stamped
`exercise_deloaded` on the row**, which is precisely why Q-228's filter misses them and why they leak
into prescription. Two small fixes now: stamp the column from the phase, and store `null` not `0`.

**🎯 The load test, finally run.** Two committed harnesses (`scripts/load-test/`), both refusing to
run against a non-local database. Seeded 10 users at the owner's real profile — 10,527 set logs,
20,000 HR rows — and replayed `getSyncDelta`'s 21-query fan-out at production's `poolMax = 10`:

| concurrent syncs | p95 | failures |
|---|---|---|
| 10 | 210 ms | 0 |
| 50 | 778 ms | 0 |
| 100 | **1,562 ms** | 0 |
| 200 | 2,868 ms | 0 |

**Nothing breaks at 10 users. Nothing breaks at 100.** Linear degradation, zero failures; first
failures extrapolate to ~**300 concurrent syncs**, arriving as timeouts. And 10 *users* ≠ 10
concurrent *syncs* — real concurrency is near zero unless devices sync on a shared schedule.

**🟠 Two results that change the diagnosis (Q-308).** **A bigger pool does not help — it is slightly
worse**: at 50 concurrent, poolMax 10 → 778 ms, 20 → 803 ms, 40 → 952 ms. **Q-107 and Q-213 both
attribute production sync failures to "DB-pool contention", and the pool measures as not the binding
constraint.** And **the entire fan-out is 22.6 ms of query work** — so it demands 21 connections to
save ~8 ms. Serialising gives **identical p95 for a 21× cut in connection demand** (10 concurrent:
174 → 180 ms; 100: 1,450 → 1,519 ms). **⚠️ Do not act on that yet**: the harness runs over a Unix
socket where RTT is ~0, and on Railway serial adds 21 × RTT. Q-308's first task is measuring that RTT.

**🟠 The emergency-deload RPE trigger sits 0.07 inside a known error (Q-306).** It fires at
`rpeTrend.delta > 2.0`; **Q-289 measured a systematic +1.93 at expected-5 sets.** Blocked on Q-289 —
the threshold must be re-derived after that calibration, not tuned now. Separately, **ACWR now drives
three behaviours at three thresholds** (1.5 here, 1.2 early-deload, 1.5 activity taper) on a metric
Q-279 already questions. Deload has fired **once in 3.5 months**, so this is not over-firing today.

**🟠 Pace is null on 32 of the 39 activity logs that could compute it (Q-307).** `avg_pace_sec_per_km`
is populated on **7 of 46** while 39 carry both duration and distance. Read from the column, never
derived at render, and written as an explicit `null` at save — the same shape as **Q-230**, and very
likely one fix for pace, steps and calories together.

**Clean results, recorded so they are not re-swept.** **The phase engine is working** — the active
program progresses coherently; five rows that looked like stuck `sessions_in_phase` counters belong
to an **inactive** program (`AI-Phase1`), which is correct dormant state. **Fifth finding to die on
verification across these five reviews.** Muscle balance is push:pull **1.30** — mildly push-dominant,
not alarming, and folded into Q-305 rather than filed separately.

**⚠️ Still open:** the systematic AI-output audit (8 of 117 read), the degradation matrix against a
running app (Q-294, desk-only), and **Railway per-query RTT** — the measurement Q-308 needs, which
cannot be taken from the sandbox.

**Surfaces NOT exercised:** the load test is **local Postgres, raw SQL, one instance** — no Railway
network, no Next request path, no drizzle overhead, no replicas. It answers a contention question,
not a capacity-planning one. Synthetic users are uniform; a single heavy user is not modelled. No
device, emulator, browser or `pnpm dev` in any of the five reviews.

### [workouts][platform] 🟠 Round 3 — the 1RM high-rep gap, volume landmarks nobody sees, and a correction to Q-298 (Q-304/Q-305, 2026-08-15)

Fourth review of the day, taking the items the third listed as *not started*. Two are done;
**four are still not started and are named below.** Evidence in
[`docs/reviews/2026-08-15-workout-model-round-3.md`](docs/reviews/2026-08-15-workout-model-round-3.md).

**🔧 First, a self-inflicted one, fixed in the same PR.** A merge resolution staged with `git add -A`
put **21 conflict markers across four files onto `main`** in #1380. They passed **Lint, Tests, Build,
Migration Check, Custom Rules and E2E** — six green checks — because nothing looks at markdown for
this and `<<<<<<< HEAD` is ordinary prose to every other tool. Resolved, and
`scripts/check-conflict-markers.js` is now a Custom Rules step (**36 of 36**), verified to fail on a
planted marker. No backlog entry — it is fixed.

**⚠️ Q-298 was HALF WRONG as filed, and is amended in place.** It called all ten zero-`estimated_1rm`
rows a defect. The write path calls `estimateOneRm`, and `1rm.ts:158` is
`if (deloaded) return { estimated1rm: 0, … }` — **the five 2026-08-06 rows carry
`exercise_deloaded = true` and are zero on purpose.** Two things survive: **`0` is the wrong sentinel
and should be `null`** (a zero propagates as an estimate *of* zero — that is what read as −100% on a
trend), and **the five 2026-08-09 rows are still unexplained**. Those narrow to a bodyweight-resolution
path (Pull-Up, `weight_kg = 0`), a `useFor1rm`-subset with no qualifying set (Preacher Curl), and
**three rows with real weights, real reps and `use_for_1rm = true` that should compute and do not** —
that is where the work starts. `runningEstimate1RM` already has the empty-result fallback that
`calculate1RM` lacks, and the write path uses `calculate1RM`.

**🟠 29 sets at 13+ reps feed the 1RM estimate on the path that skips the AMRAP correction (Q-304).**
`amrapScaleFactor` exists (0.88 at 13–20 reps, 0.82 at 21+) and is applied by `calcAmrap1RM`;
`estimateOneRm`'s ordinary path calls `calculate1RM`, which does not. **The entry carries an explicit
qualifier that may close it**: `prescriptionFactor` may already absorb the inflation where a style is
present, and how often that holds for those 29 sets was **not measured**. Measure first.

**🟠 The volume landmarks are computed and shown to nobody (Q-305).** `MUSCLE_LANDMARKS` carries
MEV/MAV/MRV per muscle and `program_volume_targets` exists. Last 7 days: **calves 2 sets against an
MEV of 8**, lats 9 vs 10, upper back 7 vs 8, while triceps sit at 17 (above MAV). Nothing surfaces
any of it. Same "computed and discarded" class as Q-278 and Q-302 — worth one shared treatment.
**One week is a small sample**; the durable finding is the missing surface, not this week's numbers.

**A check that came back clean:** `core` is tagged on exercises and absent from `MUSCLE_LANDMARKS`,
which looked like a silent fall-through — but `muscles.ts:17` maps `core: 'abs'` and
`volume-targets.ts:58` normalises before the lookup. **Fourth finding to die on verification across
these four reviews**, which is the process working.

**⚠️ STILL NOT STARTED after four reviews** — deload *policy* (as opposed to its twice-fixed
mechanism), the phase engine, muscle balance / exercise selection, and the cardio pace/HR model
across 47 activity logs. The AI-output audit is 8 of 117. The degradation matrix is desk-only (Q-294).
And **"what breaks at 10 users, at 100" is unanswered for the fourth time — it needs load testing
against a seeded multi-user database, not reading, and will not close by inspection.**

### [workouts][cardio][nutrition] 🔴 Every remaining pillar reviewed for model soundness — 6 findings, and 2 pillars clean (Q-298…Q-303, 2026-08-15)

Third and final review of the day. The owner asked for every pillar to get the treatment the health
scores got: not *is the code correct* but **is the model sound, and does it do anything in
production?** Evidence in
[`docs/reviews/2026-08-15-pillar-model-soundness-review.md`](docs/reviews/2026-08-15-pillar-model-soundness-review.md).
**Heart-rate and body were reviewed and came back clean — no entries filed for either.**

**🔴 Ten exercise logs store an estimated 1RM of exactly zero (Q-298).** Not null — zero — beside real
volume and reps (Sumo Deadlift: 2,062 kg at 6.3 avg reps → e1RM 0). Two clusters: 2026-08-06 ×5, all
`exercise_deloaded = true` (the Q-115/Q-228 date), and **2026-08-09 ×5, all `deload = false`,
consecutive over 37 minutes — one entire session**. **Q-228's fix filters on `exercise_deloaded`, so
the 08-09 cluster passes straight through into prescription.** A zero is a value, not an absence: it
flows into trends, PR detection and the next prescription, and reads as −100% on a trend chart.
**2026-08-09 also logged 1,000 `error_events`** and carries the 0.00 h sleep row from Q-274 — three
domains, one heavy-fault day, pointing at the connection-starvation class (Q-213/Q-107).

**🟠 Autoregulation's missing-data defaults favour adding load (Q-299).** `planned_reps` is recorded
on **176 of 1,009 sets (17%)**, so `repCompletionRate` is usually null — and
`autoregulation.ts` reads null as `missedReps = false` but `metReps = (x ?? 1) >= 1` → **true**.
Missing data *removes* a condition from the increase path and *adds* one to the decrease path. It
compounds **Q-289**, whose measured −2.19 delta at expected-10 already clears the `<= -2` two-rep bump.

**🟠 37% of sets are rushed, and `expectedRpe` has no rest term (Q-300).** Where both are recorded
(n = 276): mean 99 s taken vs 111 s planned; **103 rushed (< 75%)**, 44 overlong. A set at 80% with
60 s rest is not the stimulus the model assumes. **Re-run Q-289's bucket table split by rest
adherence before recalibrating anything** — the confound may be most of the finding.

**🟠 The running baseline is written, empty, and read by nothing (Q-301).** `running_baselines` holds
vo2max / max_hr / threshold_hr / easy_pace. Production: **0 rows**, against 12 `prescribed_runs`.
`saveRunningBaseline` **is** wired at plan creation — but **`getRunningBaseline` has zero callers
outside the repository layer**, so even a full table would change nothing. Third instance of this
class after Q-270 and Q-231.

**🟠 Adaptive TDEE has not fired once in 30 days (Q-302).** Its gate needs 10 logged days per
fortnight; production runs **1–4 per 14**, and **0 of the last 30 rolling windows pass**. The gate is
probably right and should not be lowered — the defect is that `TdeeAdaptationCard` never says it is
dormant or what would wake it. Same class as Q-278, different pillar. And the AI coaches on that
sparse data unqualified — *"bump that protein closer to your 150 g goal"* on a window with 4 logged
days (Q-303).

**What came back clean, recorded so it is not re-swept.** **Progressive overload is working** — 10 of
12 tracked lifts improving over 3.5 months (Bench 84 → 100 kg, Hip Thrust 98 → 157 kg); the two
"regressions" are the Q-298 artefacts. Rep adherence where recorded: **135 of 176 exact**. Nutrition
targets internally consistent (150×4 + 190×4 + 60×9 = 1,900) and the energy model uses Schofield BMR
+ Mifflin factors + Compendium METs. **Heart rate**: 57,494 samples, observed max **168** — independent
corroboration of the figure Q-57 adopted over `220 − age`; `daily_zone_minutes` stores `max_hr`/`resting_hr`
per row, which is the provenance discipline Q-273 asks for elsewhere. **Body**: the 17-vs-68 composition
gap resolved as **benign** (those columns first appear 2026-07-29); the six tape-measure columns at 0 of
108 are **correctly empty**, not broken.

**⚠️ Still open after three reviews** — stated so completeness is not assumed: the 1RM formula question
at high reps (I4) **not started**; deload *policy* (as opposed to its twice-fixed mechanism) **not
started**; volume-landmark adherence, muscle balance and the phase engine **not started**; the cardio
pace/HR model across 47 activity logs **not started**; the AI-output audit partial (8 of 117 read); the
degradation matrix desk-only (Q-294); and **"what breaks at 10 users, at 100" is still unanswered — left
open three times now.**

**Surfaces NOT exercised:** no device, emulator, browser or `pnpm dev` across any of the three reviews.
Every number is one user's via row-scoped `claude_ro` views; the *mechanisms* are user-independent, the
*magnitudes* are not.

### [workouts][platform] 🔴 The RPE model misses by more than the threshold that consumes it, and five other unswept lenses — 12 findings (Q-285…Q-296, 2026-08-15)

The owner asked what twelve review sweeps had never looked at. Six lenses survived a grounding
check: feature usage, account lifecycle, **training science**, AI output, cost, and failure
degradation. Full evidence in
[`docs/reviews/2026-08-15-uncovered-lenses-review.md`](docs/reviews/2026-08-15-uncovered-lenses-review.md);
entries **Q-285 … Q-296**.

**🔴 The headline (Q-289) — `expectedRpe` measured against 569 real production sets.** It drives RPE
autoregulation and the emergency-deload safety net. It predicts logged RPE at **r = 0.348**,
MAE 0.99:

| expected | actual mean | **delta** | n |
|---|---|---|---|
| 5 | 6.93 | **+1.93** | 68 |
| 8 | 7.57 | −0.43 | 288 |
| 9 | 7.90 | −1.10 | 60 |
| 10 | 7.81 | **−2.19** | 52 |

`autoregulation.ts:19` sets `RPE_DEAD_BAND = 1.5` on `actual − expected`; `<= −2` adds **two** target
reps; `emergency-deload.ts:35` fires at `> 2.0`. **At expected 5 the systematic error alone is
+1.93, and at expected 10 it is −2.19** — both clear the trigger before the lifter has done
anything. **120 of 569 sets (21%)** sit in those buckets, so the heaviest prescriptions systematically
read as *"that felt easy, earning the next jump"*. The model is also **non-monotonic at the top**
(expected 9 → 7.90, expected 10 → 7.81), which points at `maxRepsAtPct` rather than a simple offset.
The construction is sound and should not be rewritten — this is calibration. Its ceiling is set by
**Q-290**: logged RPE has **sd 0.87 over range 6–10**, effectively two values, so autoregulation
differences a 1-point signal against a 5-point prediction.

**🟠 A shipped toggle that can never do anything (Q-285/Q-286).** `push_subscriptions` has **0 rows**,
and `sendPushToUser` has exactly one caller in the codebase — `/api/push/test`. So web push has
neither senders nor subscribers. **This is not the native notification work recorded elsewhere in
this file** (`OuraRingService.kt` etc.), which works. It strands a real feature:
`supplements.reminder_enabled` is a live `<Switch>` in `manage-supplements-sheet.tsx:253` that
persists and syncs, and there is no cron layer (`module-map.md` §0) and no push sender — so the
reminder cannot arrive, while looking like it saved.

**🟠 The AI contradicts itself, and stated a false number (Q-291/Q-292).** On 2026-08-06 the readiness
insight said *"Keep your planned exercise intensity low"*; the user did **two** sessions; the same
day's digest said *"Crushing three PRs… Keep that same energy tomorrow!"* Readiness then fell
79 → 76 → 76 → **65**. Separately, the 2026-08-05 activity insight claimed *"a perfect activity
score"* when the stored value was **80**, and a sleep insight prescribed *"65 degrees Fahrenheit"* to
a metric user. `CLAUDE.md` forbids an LLM number *gating an action*; it does not yet cover a number
*displayed as fact*, and it should.

**🟠 Two Play Store gates are unmet (Q-287/Q-288).** No self-service account deletion exists (admin
route only) — required in-app and on web since 2024. And `/api/export` covers **26 of 82 tables**
(re-measured 2026-08-17; the old "27 of 80" counted `goals`, a repository call rather than a table),
silently omitting the user's own profile row, their heart rate, derived scores, AI conversations and
nutrition plans. Deletion is **⛔ owner-sign-off-first**; it is destructive and irreversible.
⚠️ **The route also cannot stream a large table while its comment claims it can** — `exportUserData`
buffers each table via `pool.query`, so closing the coverage gap without fixing that first is an OOM
the moment `oura_raw_samples` (1,098,183 rows / 360 MB) joins the list. Both halves ship together.

**The rest:** `ai_health_insights.context_hash` is NULL on **109 of 117** rows, so the
regeneration-avoidance key is written by one section of fourteen (Q-293). Coach is **8% of AI calls
and 52% of tokens** at 19,400 input tokens and **5.8 s** per call (Q-295) — *latency*, not cost.
`module-map.md` says Coach runs `gemini-3.6-flash`; **production logs all 17 coach calls on
`gemini-3.1-flash-lite`** (Q-296). Four failure cells have undefined intended behaviour, filed as a
note against Q-249 rather than standalone work (Q-294).

**Cost was measured and is a NEGATIVE result — do not optimise it.** 255 calls / 632,639 tokens over
24 days ≈ 26,360 tokens/day, cents per month, ~$6/month at 100× the users. The database remains the
real cost curve and is already tracked.

**Surfaces NOT exercised:** no device, emulator, browser or `pnpm dev`. **Lens L (degradation) was
not executed at all** — no failure was induced, and its table is reasoning from source. The RPE
finding is **one lifter's 569 sets**. Only 8 of 117 AI insights were read closely. The Play Store
requirements in Q-287/Q-288 are asserted from knowledge and should be re-checked against Google's
current policy before building.

### [sleep] 🔴 The sleep row's time range is time-in-bed but reads as time-asleep — the wake moment is stored and never shown (owner report, 2026-08-20)

- **Owner report.** *"That wake up time is way off, I woke up around 6am"* — the row read
  `9:52 pm – 6:44 am`. Then, once sync settled: *"it changed again… and it's still wrong."*
- **The ring is right and the app already knows it.** Decoding the stored `sleep_phase_5_min`
  (`'1'=deep '2'=light '3'=REM '4'=awake`, `packages/shared/src/health/hypnogram.ts`), the night's
  last 8 epochs are `4` — **40 minutes awake at the end**. Session end **06:47** − 40 min puts the
  **last sleep epoch at ≈ 06:07**, which is the owner's *"around 6am"* almost exactly.
- **The defect is the label.** The row renders the **in-bed span** (8.92 h) in a position that reads
  as the sleeping window, while the adjacent figure is time **asleep** (7.75 h) and 1.25 h is awake
  (0.5 h onset latency, ~40 min lying awake at the end). **The wake moment the owner recognises is in
  the stored hypnogram and surfaced nowhere.**
- **Same root as Q-529, which was re-scoped to match (2026-08-20).** Q-529 originally read as a
  missing recompute path; the score **does** recompute (47 → 55 at 06:54:41, after the session settled
  at 06:51:03), so what remains there is a **~9-minute window where a provisional score renders as
  final**. Both are the same defect wearing two hats: **a still-syncing night is displayed identically
  to a settled one.** Both are Lane B.
- **Suggested shape, not a spec:** label the range as time in bed, or show both (*"asleep until 6:07,
  up at 6:47"*). Both numbers are already stored.
- **Why a Known Issue and not a queue entry:** the Tuning Q band (500–529) is **exhausted** at Q-529,
  and a number from another agent's band must not be taken. Give this one a number when the band
  question is settled.
- **Evidence:** [`docs/reviews/2026-08-20-sleep-score-computed-mid-sync.md`](docs/reviews/2026-08-20-sleep-score-computed-mid-sync.md) §5.
- **Also observed, and benign:** the session grew across three reads that morning
  (**4:52 → 6:44 → 6:47 am**, awake 1.17 → 1.25 h) — sync converging, not malfunctioning. It reads as
  instability only because nothing marks a still-syncing night as provisional (see Q-529, Q-520).

### [sleep] ⚠️ Sleep Score recalibrated to use its range — the trend chart has an unmarked step (Q-503, v1.319.0, 2026-08-18)

Sleep averaged **87.4 with 27 of 35 days ≥ 85** and no night between 40 and 69. Recalibrated
(nine curves re-anchored + a `SCORE_CALIBRATION` on the blend): over the same 65 nights it now reads
**mean 69.5, sd 16.6, range 32–99**, every band populated. Two real defects fixed — scoring your own
HRV/HR baseline returned 90/86, and the REM ceiling sat below the owner's median. `LOW_SLEEP_SCORE`
re-anchored 60 → 42 so the rest-day hint fires at its old rate (6%) rather than 26%. Evidence:
[`docs/reviews/2026-08-18-sleep-score-range-recalibration.md`](docs/reviews/2026-08-18-sleep-score-range-recalibration.md).

**Still owed, which is why this is ⚠️ and not ✅:** historical `oura_daily_derived.sleep_score` rows
keep their old values until each day is re-read, so the trend chart shows a **step at the changeover
with older days ~15 points higher for model reasons, not physiological ones** — and sleep stamps **no
`model_version`** (Q-273), so nothing in the data marks where it is. Also **not device-verified**, and
the calibration is fitted to one sleeper's distribution (a per-user rolling calibration is the real
fix). **Readiness has the identical problem and is NOT yet fixed — Q-504.**

### [readiness][sleep][activity][body] 🔴 The five scoring pillars, measured together against production for the first time — 14 findings (Q-271…Q-284, 2026-08-15)

Prior sweeps measured **one** pillar each, in isolation and months apart. The 2026-08-15
comprehensive review measured all five on the same days against the same production rows, and asked
whether they agree with each other. Full evidence and every query in
[`docs/reviews/2026-08-15-comprehensive-app-review.md`](docs/reviews/2026-08-15-comprehensive-app-review.md);
one backlog entry per finding, **Q-271 … Q-284**.

**The five that change what the user sees:**

- **🔴 Readiness is structurally blind to training load (Q-275).** `readiness-payload.ts:329` reads
  the Activity Score's `preTaperScore` *specifically* to avoid double-counting ACWR — but load
  enters the composite nowhere else. Both activity terms (15% combined) are **goal-completion**
  scores, so a 12,000-step rest day and a heavy squat session contribute identically. Garmin's
  Training Readiness takes two load inputs of six. For a resistance-training app this is the largest
  modelling gap in the score.
- **🔴 Fragment "nights" reach the sleep score, and on two dates the fragment is the only record
  (Q-274).** Post-re-key, 10 of 46 `sleep_sessions` rows are under 1.5 h and **three are exactly
  0.00 h**. On 2026-08-11 and 2026-08-13 the fragment is the *entire* record for the date. These feed
  `previousNight` (16% of readiness) and `sleepBalance` (10%). **This is the sweep Q-225 asked for,
  and it found at least one more night sharing 08-13's signature.**
- **✅ The Recovery Index anchor is fixed — Q-500 SHIPPED v1.320.0 (2026-08-18).** Q-271's headline
  ("never above 50, ever", "~2.2 pts/day") was measured over **eight** days and did not survive: over
  41 the contributor exceeds 50 on **13** and costs **0.55** pts/day. The real defect was a systematic
  **−10.2-point** bias, fitted against Oura's own contributor over the 15 nights where both exist —
  zero-bias anchor **4.63 h**, shipped as **5**. The estimator is sound (r = +0.712, beating every
  alternative) and unchanged. Thresholds deliberately not re-anchored: this is a bias correction, not
  a scale change. `READINESS_MODEL_VERSION` → `v3:ri5:2026-08-18`.
  [`review`](docs/reviews/2026-08-17-readiness-calibration.md)
- **🟠 A stored readiness score cannot be re-derived from the inputs stored beside it (Q-501, 2026-08-17).**
  `oura_daily_summary` rows get recomputed; the derived readiness rows built from them do not follow, so
  **5 of 33** persisted `recoveryIndex` sub-scores disagree with their stored hours (worst: 2026-07-20,
  2.32 h should give 39, persisted 4). `model_versions->>'readiness'` is **NULL on all 33 rows**, so a
  past readiness shift cannot be attributed to inputs or model. Same class as Q-273.
- **🟠 Body Battery v5 drains 5× faster than it charges (Q-272).** v5 halved `CHARGE_RATE` to fix
  ceiling-pinning and overshot: charge 10.5/day vs drain 52.4/day, **ends at its daily minimum on 10
  of 12 days**, hits 0 on 3. Across all 40 days it never rises above its waking value on a third of
  them. Garmin's equivalent recovers during waking rest — that is the feature's headline behaviour.
- **🟠 Readiness and Body Battery share no variance (Q-276).** Readiness ↔ battery *anchor* r = +0.93
  (the anchor **is** readiness); readiness ↔ *end value* r = **+0.12**. Two headline numbers both read
  as "how recovered am I", sharing nothing. Needs an owner decision on whether they are different
  questions or one is wrong.

**And one correction to a claim already in this file.** The Body Battery v5 row below records
end-of-day battery vs next-day readiness at **r = −0.06** as evidence the model has no outcome
signal. That number was computed **across four different model versions** (v1/v2/v4/v5 all ran
inside 40 days, with no backfill). Split by version, **v5 alone gives r = +0.67 (n = 11)**. The
deferred re-check that row asked for is done and it answers **in v5's favour** — tune, don't
abandon. That the pooled figure stood for eleven days is itself the finding: **Body Battery is the
only pillar that stamps a `model_version` at all**, so this class of error is undetectable for the
other four (Q-273 — do this one **before** the calibration items, or each creates another
incomparable segment).

**The rest, in brief:** Activity Score still occupies a quarter of its range (sd 5.9 over 19 days)
even though v2 fixed the mechanism Q-137 blamed. **Answered 2026-08-19 and folded into Q-505**
(Q-277 removed from the queue): all six contributors were measured, and **49% of the score's
effective weight cannot vary** — `moveHours` saturated, `zoneMinutes` floored, `activeEnergy` absent,
`strengthFreq` 78% at ceiling by design. The goal fixes did work (stored sd **5.0 → 7.4** across
2026-08-11) but stored history is not back-filled, so most days still show the old model. Scores are absent on 20–52% of days with nothing distinguishing "no data" from a real value
(Q-278). Q-214's duplicate-collapse fix — which stopped a **5,771-hit** `[pg 21000]` fault that was
discarding 5,000-point HR chunks — reached **one of three** same-shaped batch upserts; `upsertOuraBucket`
and `upsertSetHrStats` are still exposed (Q-280). ACWR drives the early-deload card and the activity
taper on evidence the literature has substantially retracted (Q-279). No automated accessibility
check exists anywhere in CI, which is why the 2026-08-08 sweep's contrast finding "could NOT be
measured" (Q-282). Plus score presentation vs the incumbents (Q-281), ~11 MB of never-scanned
indexes (Q-283), and the Oura activity blend now firing on 1 day in 40 (Q-284).

**Surfaces NOT exercised:** no device, no emulator, no browser, no `pnpm dev` run — this was a
docs-only review. Every number is **one user's** data via the row-scoped `claude_ro` views, and
`error_events` prunes at 30 days. Correlations at n = 11 to n = 31 are directional, not conclusive.
The review's own architecture lens (Lens F) is shallower than the rest, and **"what breaks first at
10 users, at 100" is not answered.**

### [nutrition][workouts] ⚠️ Three owner-reported day-screen fixes shipped — NOT device-verified (Q-245, Q-246, Q-247, 2026-08-15) · needs: browser

- **Shipped in v1.317.0.** Nutrition's food-log guard is now scoped to the date the rendered logs
  belong to, so swiping to a past day and back to a fresh today no longer keeps the previous day's
  meals. The weekly Training Load bar draws a deload day at a real height with a striped fill
  instead of the grey "no data" sliver a rest day gets, and a testing-only day now shows "T" rather
  than the "D" it was mislabelled with. The day screen gained an Energy section (eaten / burned /
  net, broken down into workouts, activity, steps and resting), reading the same
  `/api/nutrition/energy-balance` route Nutrition's card uses; activity rows now render the
  distance, calories, pace, HR, steps and elevation the payload already carried.
- **All three were verified on the local dev server and by mutation-verified tests, and none has
  been seen on the S25.** Three specific gaps: the Q-245 repro is a *swipe gesture driving React
  state*, and Playwright's npm package is not a dependency here (only the browsers are installed),
  so the interaction was never driven in a browser — the decision it turns on is unit-tested, the
  wiring around it is not. The deload stripe is a CSS mask (`-webkit-mask-image`), whose rendering
  on Samsung's WebView compositor is assumed rather than observed. And no day-screen section appears
  in server-rendered HTML, so the Energy section and enriched activity rows were verified through
  the route's numbers and their display logic, never *visually*.
- **The device check that would close this:** on the APK, swipe Nutrition back a day and forward to
  today on a day with no food logged yet, and confirm today reads empty; open Health → Training in a
  week containing a deload and confirm the bar is striped and full-height, not grey; open a day with
  a workout and a walk on it and confirm the Energy section reads sensibly and the activity row
  shows its distance/calories/HR.
- **Deliberately not done:** a per-workout kcal estimate in the day screen's Training section. It
  needs `estWorkoutKcal` per session, which is the Q-230 bundle hazard from a client component —
  doing it properly means computing it server-side in `/api/day-log`.
- Detail: [`docs/overview/history-2026-08-15.md`](docs/overview/history-2026-08-15.md).

### [platform][app-shell] 🟠 Editing a goal never busts the goal cache — Health shows the old goal for 30 minutes (Q-240, 2026-08-14)

- Found by the owner-requested UI/flow/caching review,
  [`docs/reviews/2026-08-14-app-ui-flow-ia-review.md`](docs/reviews/2026-08-14-app-ui-flow-ia-review.md) §4.2.
- `components/profile/goals-section.tsx:177-186` fires `PATCH /api/user/goals` and invalidates
  nothing. Its sibling `patchProfile` in the same file (`:123-140`) calls
  `invalidateGoalRecommendations()` after its PATCH — and **that group already contains
  `invalidateCache('user-goals')`** (`lib/cache-groups.ts:176`). The group is right; the call site
  was never wired to it.
- **User-visible:** change your steps / sleep / calorie / water / target-weight / target-body-fat
  goal in More → Profile → Goals, switch to the Health tab, and its goal-driven cards keep rendering
  the **previous** goal for up to 30 minutes (`user-goals` at `TTL_MEDIUM`,
  `app/health/health-content.tsx:454`), and the stale value paints first on the next cold start
  (same key seeded synchronously at `:242`).
- **Not reproduced at runtime** — found by reading source and the invalidation groups. The fix is
  one `await invalidateGoalRecommendations()`. Queued as **Q-240**.

### [platform][body] 🟠 Goals live in two places — `localStorage` and the server — and Health reads three of them from the device copy only (Q-241, 2026-08-14)

- Same review, §4.3. `components/profile/goals-section.tsx:192-235` writes nine `ta_*` goal keys to
  `localStorage` **and** PATCHes the same values to `/api/user/goals`;
  `components/profile/goal-recommendation-sheet.tsx:125-126` writes the device copy too;
  `lib/coach/domains/goals.ts:137-138` is a third reader/writer of the same keys.
- `app/health/health-content.tsx:202-214` reads the **water goal** (defaulting to 2500 ml),
  **target weight** and **target body fat** from `localStorage` only.
- **User-visible:** the device copy never syncs. On a second device, after a re-install, after
  clearing browser data, or between the web surface and the APK, the server holds the real goals
  while the Health tab shows defaults — and the two copies can then disagree indefinitely with
  nothing to reconcile them. Against the *Canonical Runtime* amendment (no surface may assume the
  owner's own device) and against the offline-first rule that the **local store**, not
  `localStorage`, is the local source of truth.
- **Not reproduced on a second device** — the sandbox has one. Queued as **Q-241**.

### [platform] 🟠 83 device-verification rows, now tagged by which capability each actually waits on (re-measured 2026-08-15, Q-249…Q-254)

- **Every row now carries a `· needs:` tag** (Q-254's re-tagging half, 2026-08-15 — see
  [`docs/overview/history-2026-08-15.md`](docs/overview/history-2026-08-15.md)). Re-measured on
  the day Q-249 landed, the 83 rows split **browser 32 · android 26 · data 11 · hardware 13** —
  `grep -cE '^### .*needs: browser' projectOverview.md` and friends are the live count (anchor it to
  the heading, or this paragraph counts itself). The 2026-08-14
  projection below ("~25 need nothing but running the app", "17 Android", "25 hardware") was made by
  reading and is **superseded by this**: the browser bucket is larger than projected and the hardware
  bucket smaller, but the shape of the finding held — roughly 40% of the wall never needed a phone.
- **The tags were assigned from each row's own heading text, not from opening the feature.** A row
  tagged `browser` is a claim about *which gate it is waiting on*, not that it has been verified —
  striking a row still requires an E2E spec that covers it, per "never mark an issue fixed from
  intent". `data` means real accumulated/owner/ring data that no emulator conjures; those rows are
  not unblocked by Q-249 or Q-250.
- Owner asked what access would let agents test more end-to-end, citing the Railway key as the model.
  Measuring the gate first changed the answer. Full working:
  [`docs/reviews/2026-08-14-app-ui-flow-ia-review.md`](docs/reviews/2026-08-14-app-ui-flow-ia-review.md) §7.
- **The 81 rows are five gates, not one:** ~25 need nothing but somebody running the app; **17** need
  an Android runtime (local SQLite, offline, notifications, back button, deep links, PiP); ~10 need
  real data; **25** need real hardware; ~4 are perceived performance.
- **The largest bucket needs no new access.** There are **466 test files and none runs the app** —
  Chromium and Playwright's browsers ship in every session (`/opt/pw-browsers`) but Playwright is not
  a dependency, so there is no harness. Rows like "Bodyweight sets no longer count as zero volume"
  and "Injury workout warning" have sat since v1.45–v1.50 not because they need a phone, but because
  the device-verification rule had **no cheaper tier beneath it** — "cannot verify here" was the only
  truthful thing a session could write. Queued as **Q-249** (build, don't plan).
- **The Android bucket's most valuable line is local SQLite migrations** — the failure that has
  silently killed the local DB twice (#27, #85) and is the root of the recurring "my data
  disappeared" reports. A migration's first real execution is currently on the owner's phone.
  **Q-250** puts it on an emulator in CI first. Verified it cannot run in a session: no `/dev/kvm`,
  no `vmx`/`svm` — Firecracker microVM, no nested virtualisation. GitHub's `ubuntu-latest` has KVM.
- **Owner directed the cluster be implemented before Q-49** (the public-repo migration), and that
  deadline is load-bearing: Q-49's decisions commit to "CI stays offline and holds no credential",
  while Q-252 (error tracking) and Q-253 (device farm) both want one. Easier to settle on a private
  repo than after the cut.
- **~15–18 of the 25 hardware rows are BLE and stay owner-only permanently** — no emulator or device
  farm produces a Ring 5 on our own re-keyed protocol. This cluster shrinks what falls under the
  device gate; it does not remove it. Projected outcome: the owner-gated queue drops from 81 to
  roughly 30. **That is a projection from heading-level bucketing, not a promise** — Q-254 re-tags
  each row properly.

### [app-shell] 🟠 The app's containers are organised by build order, not by convention — 13 findings from the 2026-08-14 UI/flow/IA review

- Owner-requested review of UI and "flow/location":
  [`docs/reviews/2026-08-14-app-ui-flow-ia-review.md`](docs/reviews/2026-08-14-app-ui-flow-ia-review.md).
  The screens are mostly well built; the **container layer** is the problem. Nothing is missing, a
  lot of it is unfindable.
- **The five structural ones:** More → Profile is thirteen kinds of thing in one 845-line scroll
  (**Q-232**, the umbrella — needs a written plan before any of these are built); admin/user
  administration is mixed with developer diagnostics and both hide at the bottom of that scroll
  (**Q-234**); the Program Builder lives in More under a sub-tab *also* called "Workout"
  (**Q-235** — already caused Q-223; ✅ resolved 2026-08-15, and it had caused a second one,
  **Q-256**); four device-pairing cards sit inline with no Devices screen
  (**Q-233**, the other half of Q-111); Nutrition's actions are placed by scroll depth, with
  "End of Day" and "Saved Meals" below every meal card (**Q-237**, feeding Q-112). ✅ **All five
  structural items are resolved (2026-08-15)** — Q-232's own restructure, Q-233, Q-234, Q-235 and
  Q-237; see the status entries above.
- **Two dead surfaces found by reachability grep:** `/overview` is a 543-line screen with **zero**
  in-app entry points, duplicating Home (**Q-236**); Health's card ordering/hiding has live readers
  and **no callers for either writer** (**Q-238** — same shape as Q-180). ✅ **Q-238 is resolved
  (2026-08-14, v1.307.2)** — deleted rather than rebuilt, because git shows the UI was removed
  deliberately in June 2026 and the machinery simply outlived it; see the status entry above. ✅ **Q-236 is resolved (2026-08-15)** — screen, its orphaned readiness card and its
  background palette deleted; the `/sheet/[id]/*` shims kept and their expired rationale filed as
  **Q-255** for the owner. ✅ **Q-255 is resolved (2026-08-16)** — the owner confirmed no external
  link uses a `/sheet/...` URL, so all three shims were deleted.
- **Plus:** six screens reachable from exactly one card each (**Q-239**), water logged from Home
  over-invalidates five instant-paint caches it does not feed (**Q-243**), `day-log:` fetched with
  two different TTL expressions (**Q-242**), and hex literals up 430 → **471** in five days with
  nothing mechanising the theme-token rule (**Q-244**). ✅ **Q-244 is resolved (2026-08-15)** — a per-file
  shrink-only baseline now ratchets it; the 471 are recorded, not swept. ✅ **Q-242 is resolved (2026-08-15,
  v1.307.3)** — and it was three divergent keys, not one; the scan is now a Custom Rules check. See
  the status entry above.
- **What the review confirmed healthy, measured not assumed:** all 33 Custom Rules steps pass; zero
  `invalidateCache()` call sites outside `lib/cache-groups.ts`; 73 cache keys all reachable from an
  invalidation group; one fetch variant per key; every `body-metadata` read guarded by
  `isBodyMetadataFresh`; 204 API routes none caching; every admin route `requireAdmin`-gated; the
  service worker's two-generation retention makes deploy-time cache busting sound.
- **Not checked** (cannot be, in the sandbox): native SQLite/Capacitor paths, safe-area on device,
  Samsung WebView rendering, real device pairing, drifted production data. Every finding is from
  source reading and static analysis; **none was exercised on the S25**.

### [workouts] 🔴 AI prescriptions never expire — `prescriptionExpiresAt` is stored and never checked (Q-229, 2026-08-14)

- **Found investigating Q-228, same live session.** The owner's "Upper" session's AI prescription
  (`session_periodization` row `a4fec65d-95e6-44d2-8091-95c7e35e6003`) was generated **2026-08-06
  22:11:55 UTC**, with `prescription_expires_at` set to exactly 7 days later
  (**2026-08-13T22:11:55Z**, confirmed by direct calculation). Today, 2026-08-14, well past that
  expiry, the app served the owner **the exact same prescription object, unchanged digit for
  digit** — same `pct`/`reps`/`sets` for every one of the 5 exercises — for a live, real workout.
  `updated_at` on that row is **2026-08-13T22:28:18Z, 16 minutes AFTER its own expiry**, meaning the
  row was touched (re-consumed) past expiry without a fresh generation.
- **Root cause, confirmed by reading the only two places `prescriptionExpiresAt` is referenced in
  the whole codebase**: it is written correctly at generation time
  (`generate-prescription.ts:654`, "the last real session wins" pattern), but the ONLY place it is
  ever *read* is `shouldTriggerEmergencyDeload` (`emergency-deload.ts:19`) — and there it gates a
  narrow, unrelated case (suppressing re-offering a *pending* emergency-deload while its own offer
  window is open). **Nothing anywhere compares `prescriptionExpiresAt` against `now` to force
  regeneration of an `auto_applied` prescription once it goes stale.** The only two conditions that
  ever trigger `needsRegenerate` in `reevaluatePrescriptionForToday`
  (`packages/shared/src/ai-periodization/reevaluate.ts`) are an emergency-deload signal
  (overtraining/illness/injury/ACWR) or a whole-session soreness deload — plain calendar expiry is
  not one of them. `reevaluate.ts`'s own doc comment (lines 84-86) states the intended design
  outright: *"A prescription generated after the previous session is consumed up to 7 days
  later... without re-running Gemini"* — the 7-day boundary is real intent, just never enforced.
- **Effect**: any session type not actually re-run within its own 7-day window keeps replaying its
  last AI-generated numbers indefinitely — no new LLM-computed load, set, or rep progression happens
  for that session until an emergency or soreness signal happens to fire for an unrelated reason.
  This is a plain calendar-time gap, not a per-user data issue — it reproduces for any account
  whenever a session type in their split goes unused for more than a week, which ordinary program
  variety (e.g. an Upper/Lower/Push/Pull/Legs split, a missed week, travel) makes routine, not rare.
- **Compounds with Q-228 on today's Incline Bench Press number specifically**: the replayed 83%
  target was computed against Q-228's separately-poisoned 1RM, so that exercise stacked two
  independent bugs into one dramatic-looking jump. Barbell Overhead Press (this entry) shows the
  bug in isolation — its 1RM basis is correct (57.5 kg, matches the Q-115-corrected true max) but
  the replayed 52% (an original deload-era percentage from 2026-08-06) is simply the wrong intensity
  for a live Intensification-phase set 8 days later.
- **Not yet done**: the fix (an explicit `now > prescriptionExpiresAt` check forcing
  `needsRegenerate: true`) and a sweep for how many other users/sessions are currently serving an
  expired prescription. See Q-229.

### [workouts] 🔴 A stray pre-Q-115 deload log is still poisoning one exercise's prescribed weight (Q-228, 2026-08-14)

- **Live, currently affecting the owner's in-progress workout.** Today's Incline Bench Press
  prescription (Intensification phase) showed **72.5 kg** (83% of an 86.25 kg "1RM"), against a
  genuine recent working weight of 62.5 kg × 6-7 reps at 80% (2026-07-30) — an unearned ~11 kg
  overload the owner caught before loading the bar and reported live.
- **Root cause: Q-115's own corrective migration (`168_q115_whole_session_deload_pr_correction.sql`,
  2026-08-07) fixed 4 of the 5 exercises corrupted by the 2026-08-06 whole-session-deload bug, and
  missed the 5th.** All 5 exercises logged in that one corrupted session still show
  `exercise_deloaded = true`; the migration zeroed `estimated_1rm` on 4 of them (Overhead Press,
  Skull Crusher, Preacher Curl, Pulldown) but Incline Bench Press — exercise 1 of that same session,
  logged 21:41 UTC, just before the migration's audited 21:47-22:09 window — was never touched, and
  still carries the original inflated `estimated_1rm: 85.75`. Confirmed directly against production
  via the read-only admin endpoint, not inferred.
- **Deeper structural gap this exposed: `getLastRealOneRmBatch` (`lib/data/postgres/adapter.ts`)
  never filters on `exercise_deloaded`.** It picks the most recent log with `estimated_1rm > 0`,
  relying entirely on the write-time invariant that a deloaded set always stores `estimated_1rm = 0`
  — an invariant this exact row already disproves. The sibling query `reconcilePersonalRecord` in
  the same file explicitly filters `eq(exerciseLogs.exerciseDeloaded, false)` "mirrors
  shouldCountTowardPr's per-exercise deload gate" — `getLastRealOneRmBatch` is the one query in this
  family missing that same defensive filter, so any future write-time regression (or any other
  straggler like this one) silently poisons the very next prescription for that exercise, for every
  user, with no read-time backstop.
- **Scope, confirmed for the owner's account**: exactly one row (`exercise_logs` id
  `c4e3d87d-b357-4f08-8910-dfe3462611ca`) currently has `exercise_deloaded = true AND
  estimated_1rm > 0` — this is not an ongoing leak, just one missed straggler plus a real gap in the
  defense that let it leak into today's prescription. See Q-228 for the fix (read-time filter + a
  Q-115-style corrective migration for this one row).
- **Not yet done**: the code fix and the corrective migration — this is the live-investigation
  finding, queued for an implementer session.

### [devices][platform] ⚠️ The step-decoder table now loads over the network — NOT device-verified (Q-221, 2026-08-13) · needs: browser

`steps_motion_decoder_2_0_0`'s dequantisation table used to be bundled, so it was always present.
It now comes from session-gated `GET /api/oura-ble/decoder-constants` and is cached client-side
(`cachedFetch`, seeded synchronously). **Verified in the bundle** — none of the table's column names
appear in any of the 154 client chunks of a fresh build. **Not verified on the device**, and the
untested path is the one the caching exists for:

1. one online session (fetch + cache), 2. kill the app, 3. relaunch with no network, 4. walk.

`getLocalStore` returns null in the sandbox and the BLE plugin does not run there, so this sequence
is device-only. Until it is run, treat offline ring-cadence as unproven.

**Known and intended:** before the first successful fetch, ring-cadence confirmation and the cadence
tracker do nothing. `runStepsMotionDecoder` throws on an absent table rather than guessing, because
decoding without it produces plausible wrong physical values. On a genuinely first-ever launch with
no network there is therefore no ring cadence until the app has been online once.

### [nutrition][platform] ⚠️ Barcode scanning failed for the owner ~22:20 Brisbane 2026-08-13, recovered on its own, cause UNRECORDED

**Reported live** ("im still unable to scan barcodes"), then **"its working now — about 1 hour ago
it didnt work"**. It is working; that is the whole of what is established. *Something that stopped is
not something that was fixed.*

**What was checked while it was still fresh:**

- **Open Food Facts is up** — a real product lookup returned `status: 1, product found`, HTTP 200 in
  **0.86 s**. So this is not a repeat of the 2026-08-13 OFF outage.
- **Nothing barcode-shaped reached production.** The live deployment (12:01 UTC) had **9 HTTP
  requests total** and **zero** to `/api/nutrition/*`. Either the attempt predates that deploy, or the
  app never got as far as calling the lookup.
- **`error_events` has nothing, and structurally cannot** — see below.

**Why there is no evidence, which is the actual finding:** `/api/nutrition/barcode` caught its OFF
failure, did `console.error`, and returned 503. It never called `reportServerError`, so the failure
left no row in `error_events` and Railway stdout for that window is gone. **Q-218 gave exactly this
treatment to the sibling `/api/nutrition/scan` route and stopped there.** Fixed now — the barcode
route reports — so a recurrence will be diagnosable. The other **12** `app/api/nutrition/*` routes
still do not report; barcode was fixed because it is the one that just failed, not because it is the
only gap.

**The plausible-but-unproven story:** the same event-loop starvation that measured the owner's photo
scan at *200 in 129,073 ms* (Q-213). Q-213 Stage 2 deployed at 12:01 UTC, and `/api/oura-ble/samples`
— the route that was returning 500s after 27.6 s — now measures **76–458 ms** in production. That is
consistent, and it is not proof: a barcode request was never recorded either way.

**Do not close this from the recovery.** If it recurs, `error_events` will now hold the reason.

### [platform][devices] ⚠️ Production stalls — all three Q-213 stages shipped 2026-08-13; production has now confirmed them, the device has not · needs: android

**Stage 1 shipped.** `aggregateOuraRawSamples` re-read, hex-decoded and re-derived a 35-day window of
`oura_raw_samples` on every BLE sync — **984,862 rows against ~37 days of history**, i.e. the whole
table, to absorb the few minutes a sync carried. Runs outlasted the gap between syncs, went
back-to-back, and pegged the single Node main thread for 15–30 minutes, starving everything else on
the process. Measured symptoms: `/api/version` (no DB, bounded to 5 s) at **122,044 ms**; the owner's
food photo scan at **200 in 129,073 ms** — it worked, the phone gave up first.

It now re-derives only the span an ingest touched. **Measured 10,560 ms → 930 ms (11.4×)** on a
seeded 35-day table; production has ~40× the rows and the narrowed cost does not scale with history,
so the real gain is larger. The `hrSeriesCutoffDs` clamp is load-bearing — without it a narrowed run
would delete up to 13 days of HR series it could no longer rebuild — and is mutation-tested.

**Why this stays ⚠️ rather than ✅:**

- **Not device-verified.** The BLE plugin does not run in the sandbox; the ingest path was exercised
  through the route and repository only, against a seeded table 40× smaller than production.
- ~~**The first rollup after each deploy is still a full-window pass**~~ — **fixed 2026-08-13
  (v1.303.2)**, and it was worse than "expected": measured at **six minutes of a pegged main thread**
  (CPU 1.8, memory 2.19 GB, `/api/version` 10–28 s), paid on every one of the day's five deploys. The
  watermark is now persisted in `oura_rollup_state` (migration 184), so a cold start narrows from
  where the last run reached. **The proof is the next deploy** — that plateau should not recur at
  container start.
- ~~**Stage 2 — move the run off the request event loop**~~ — **shipped 2026-08-13.** The ingest route
  dispatches through `runRollupOffLoop` into a `worker_threads` realm with its own `pg` pool
  (`PG_POOL_MAX=2`; a replica running a rollup holds 12 connections, not 20). Measured main-thread lag
  during a rollup: **185 ms of a 262 ms in-process run → 4 ms of a 439 ms worker run**. A missing or
  unstartable worker bundle **falls back to in-process**, i.e. to the prior behaviour — proven by
  deleting the bundle and watching the correctness test still pass. Journal:
  [`docs/overview/history-2026-08-12.md`](docs/overview/history-2026-08-12.md).
- ~~**Stage 3 — the coalescing predicate**~~ — **shipped 2026-08-13.** `frames.length < 255` meant
  "any batch", not "the drain's last batch", so it bypassed its own 8 s window nearly every time. Now
  a trailing-edge debounce with a max-wait (`lib/oura-ble/rollup-debounce.ts`, 3 s / 20 s). Dev:
  three batches in quick succession → three 200s and **one** rollup.
- ~~**The admin redecode route**~~ — **shipped 2026-08-13.** Both phases go through the worker,
  keeping the route's per-phase errors. Journal:
  [`docs/overview/history-2026-08-12.md`](docs/overview/history-2026-08-12.md).
- **Why this stays ⚠️ with everything shipped:** none of it is confirmed by production yet. The one
  number so far is `POST /api/oura-ble/samples` at **76–458 ms** on the live deployment, against 500s
  after 27.6 s during the outage — pointing the right way, over one quiet hour. Both of the outage
  session's confident cost predictions were wrong and only production caught them. Keep watching
  Railway CPU for the sustained 1.0–1.6 plateaus and `/api/version` latency.

**First production evidence, 2026-08-13** — the ring synced at 15:47 after the watermark deployed:

| | duration | CPU | memory |
|---|---|---|---|
| before Stage 1 | 15–30 min | 1.0–1.8 | 0.9–2.2 GB |
| cold start, Stage 1 only (14:45) | 6 min | 1.8 | 2.19 GB |
| seeding pass, with watermark (15:47) | **2 min** | **0.815** | **0.553 GB** |

**But a concurrent ingest still 500'd** at 15:47:33 after 27.6 s, starved by that 2-minute pass. A
non-2xx on `/api/oura-ble/samples` holds the ring cursor and triggers a re-drain. **Narrowing cannot
remove that — only Stage 2 (the worker thread) can**, and that was the hard evidence it was necessary
rather than tidy. Stage 2 has since shipped; **whether it actually holds is a claim about production
and nothing else settles it** — both of the outage session's confident cost predictions were wrong,
and only production caught them.

Keep watching Railway CPU: the sustained 1.0–1.6 plateaus should stop recurring. `/api/version`
latency is the cheapest ongoing probe — it should stay in milliseconds.


**✅ RESOLVED — production has now confirmed it, 2026-08-20.** The whole retained `error_events`
window (2026-07-20 → 2026-08-19; the table prunes at 30 days and is row-scoped to the owner) grouped
by day, counting the two connect fingerprints, this route, and the two fan-out routes:

| day | connect-timeout | `/api/sync/pull` | body-battery + readiness-score | all events |
|---|---:|---:|---:|---:|
| 08-19 | 0 | 0 | 0 | 1 |
| 08-18 | 0 | 0 | 0 | 1 |
| 08-17 | **1** | 0 | 0 | 8 |
| 08-16 | 0 | 0 | 0 | 1 |
| 08-15 | 0 | 0 | 0 | 1 |
| 08-13 | 16 | 1 | 2 | 757 |
| 08-12 | 39 | 0 | 2 | 2,556 |
| 08-11 | 20 | 1 | 0 | 38 |
| 08-10 | 16 | 1 | 0 | 31 |
| 08-09 | 33 | 1 | 3 | 2,615 |

**Every one of the three families stops dead on 2026-08-13**, the day Q-213's stages shipped. The
single connect-timeout since then landed on 2026-08-17, inside the unrelated `disk_full` outage that
day (the same date carries two `[pg 53100]` rows). Six days, one event.

**Two limits on this, stated rather than left implicit.** `claude_ro.error_events` is scoped to the
owner's rows, so this is a claim about the owner's account and not about anyone else's; and it is a
claim that the fault stopped, which the "stopped is not fixed" rule says to hold loosely — except
that here the stop coincides exactly with a shipped fix whose mechanism predicts it, which is the
one case where a silence is evidence. The app was in use throughout: `set_hr_stats` rows were
computed on 08-15, 08-16, 08-17 and 08-19.

**This row stays ⚠️ rather than moving to the archive** for the one gate that is left: none of the
three stages has been exercised on the S25. The BLE plugin does not run in the sandbox, so the
ingest path was only ever driven through the route and the repository, against a seeded table 40×
smaller than production.

### [platform][readiness] A check-in tapped during the local-store init window was silently lost (fixed v1.302.1, 2026-08-13) — NOT verified on device · needs: hardware

- **What happened**: `getLocalStore()` screens out the *dead* store (K4) but not the
  *not-open-yet* one. `_db` is null for the whole of `initSQLite` — versioned upgrade, WAL pragma,
  then a full `reconcileSchema()` pass — which is seconds on the first launch after a release that
  adds a local migration (v25, #1282). A Save landing there hit `if (!_db) return`: nothing
  written, nothing queued to the outbox, `savedLocally = true`, success toast.
- **Confirmed, not inferred**: production has **no `day_checkins` row for 2026-08-13** and no
  client error anywhere to explain it.
- **Fixed in #1292**: `runSQL` waits for an in-flight open and throws on the canonical runtime if
  the DB never opened, so write sites take their API fallback; the morning check-in gained the
  fallback it never had. Reads and cache writes stay soft deliberately.
- **Separately**, both check-in sheets stopped blocking their close on the local write — the
  ~2 minutes of "Saving…" the owner saw was a tap queued behind the sync pull's `applyDelta`
  transaction on the plugin's single SQLite connection. That underlying hold is **not** fixed;
  it is queued as Q-214.
- **Not exercised**: the S25. Native SQLite does not run in the sandbox, so the init window this
  fixes cannot be reproduced here. The on-device check is a force-stop, reopen, and tap Save on
  the readiness sheet within a second or two of the app appearing.

### [workouts] Deload now reduces every exercise, not just prescribed ones (v1.301.0, 2026-08-12) — NOT verified on device · needs: browser

- **What changed**: a branch after the AI prescription block applies `deloadOverrideForGoal` to any
  ai_dynamic exercise the prescription does not cover, when a deload is active. Q-185, owner decision.
- **Expected behaviour change, not a bug**: deload weeks will feel noticeably easier. The owner was
  told this is the largest-change option of the three offered and chose it.
- **Verified end-to-end**: ai_dynamic program, `early_deload_week_start = CURRENT_DATE`, no stored
  prescription. `origin/main` returned all nine exercises at 75% / 3 sets with `deloaded: false`;
  this build returns 50% / 2 sets, `deloaded: true`.
- **Not exercised**: the S25, and the partially-covered case against a *real* model-generated
  prescription (covered by fixture-based unit tests instead).
- **Related open issue**: **Q-211** — a deload week also reduces a *baseline* lift, which the 1RM
  and PR paths both treat as a genuine max effort. Pre-existing, filed not fixed.
### [workouts] Prescription basis changed to the last non-deload session (v1.300.0, 2026-08-12) — NOT verified on device · needs: browser

- **What changed**: `resolveWorkingBasis` returns the last non-deload 1RM outright instead of
  `max(lastLog, seed, allTimePr)`; new `getLastRealOneRmBatch` supplies it and also carries
  `target80`. Q-202, on an explicit owner decision.
- **Expected behaviour change, not a bug**: one light or interrupted session now lowers the next
  prescription. The owner was offered a smoothed "best of the last ~3" variant and declined it. If
  this proves annoying in practice, that variant is a small change from here.
- **Verified end-to-end on the dev server** against a seeded fixture (last real session 72, PR 98):
  `origin/main` returned `estimated1rm: 98`, this build returns 72 with the PR untouched. Adding a
  deload log after it kept the basis at 72 and restored `target80` from 0 to 57.5.
- **Not exercised**: the S25. Nothing here touches safe-area or a native plugin, but the weight
  dial's pre-filled value is a real on-device behaviour and the `target80` half changes it — worth
  confirming the dial opens at a sensible weight on the first session after a deload.
- **Not exercised**: drifted production data. An exercise whose entire history predates the deload
  suppression may carry `estimated_1rm` NULL rather than 0; those are excluded the same way (which
  is correct), but such an exercise falls back to seed/PR rather than to a real session.

### [devices][app-shell] More/Profile ring battery now reads the live BLE poll (v1.290.2, 2026-08-12) — NOT verified on device · needs: hardware

- **What changed**: `components/more/oura-section.tsx` prefers `/api/oura-ble/battery-latest` over
  the frozen Cloud value; `oura-ble-battery-latest` added to `invalidateOuraSync()`; the card's
  tab-show refresh now re-fetches the battery. Q-205.
- **The "Not live" state could not be reproduced locally, in either direction.** It needs the Oura
  Cloud call to *succeed* and return an old timestamp. With no real token the call rejects,
  `batteryLevel` stays null, and the local before-state is **no badge at all** rather than "Not
  live". The fix was verified against that local before-state (no indicator → `68%`); the
  owner-device before-state is established from the code path, not observed.
- **Verified**: seeded `oura_tokens` + one `oura_ble_battery_poll` at 412×915. Fresh poll (12 min,
  68%) → coloured `68%`; aged poll (5 h, 41%) → muted `41%` with
  `title="Ring battery 41%, last seen 5h ago"`. `origin/main` showed no battery indicator in both.
  Seeds deleted afterwards.
- **Not exercised**: the `useRefreshOnTabShow` path (fires on native tab visibility changes), the
  Samsung WebView compositor, and safe-area insets.

### [devices][app-shell] Ring-battery chip removed from Home (v1.290.1, 2026-08-12) — NOT verified on device · needs: hardware

- **What changed**: `OuraBatteryChip` removed from the Home header's right-hand icon cluster;
  `components/oura-battery-chip.tsx` deleted (Home was its only call site). Q-203.
- **Verified in the web sandbox only.** Proven falsifiable first — the local fixture returns
  `{"latest":null}` from `/api/oura-ble/battery-latest`, so the chip renders nothing either way and
  a plain before/after smoke run proves nothing. Seeded one real `oura_ble_battery_poll` row (72%,
  10 min old) and confirmed at 412×915 that `origin/main` renders
  `aria-label="Ring battery 72 percent"` in that cluster and this build does not, with the rest of
  the header byte-identical and no console or page errors. Seed row deleted afterwards.
- **Not exercised**: the Samsung WebView compositor, and safe-area insets (which render as 0 in the
  web sandbox). This is a header layout change, so the header's `pt-safe` clearance is the thing to
  eyeball on the S25 — nothing in the diff touches it, but the row width changed.
- **Also not exercised**: the Health tab's Ring Status card, which is the surface that keeps the
  live battery reading. `OuraSection` early-returns on `if (!data?.connected)` and the local
  fixture has no Oura token, so it could not be made to render here. That it reads the live BLE
  endpoint is established from source, not observed.

### [nutrition] Saved-meal batch servings + local SQLite v25 (v1.292.0, 2026-08-12) — NOT verified on device · needs: android

Journal: [`docs/overview/history-2026-08-12.md`](docs/overview/history-2026-08-12.md) ·
plan: [`plans/2026-08-12-meal-plan-portions-and-editing.md`](docs/superpowers/plans/2026-08-12-meal-plan-portions-and-editing.md)

**The local migration is the risk, not the feature.** Local SQLite v25 adds
`saved_meals.servings` as an `ALTER` that has only ever run against the dev harness — native SQLite
does not exist in the sandbox, and this project has had the local DB die on Android twice from
migration bugs. Needs an app launch on a device already holding a **v24** database as the first
device check. All three parts are in place (ALTER + `CREATE TABLE` body + `RECONCILE_COLUMNS`) and
pinned by tests, but that is the shape being correct, not the upgrade being observed.

Also unexercised on device: offline create/edit of a batch meal, and the cross-device pull of
`servings`.

**Behaviour change worth knowing:** raising a meal's serving count changes what its "Log this meal"
button writes — one portion, not the batch. Existing meals default to 1, so nothing moves until a
count is set.

### [nutrition][app-shell] Ingredient search, gram-level meal editing, sheet close-button clearance (v1.290.0, 2026-08-12) — NOT verified on device · needs: browser

Journal: [`docs/overview/history-2026-08-12.md`](docs/overview/history-2026-08-12.md)

Verified only in headless Chromium at 412×915. Safe-area insets read 0 in the sandbox and Samsung's
WebView renderer is absent, so three things need `docs/device-smoke-checklist.md` on the S25:

- **The `SheetHeader` clearance change is app-wide** (`components/ui/sheet.tsx`), so it touches all
  45 sheet call sites, not just the nutrition ones. Measured correct at 412px; check a few headers
  with right-aligned controls on-device.
- **The grams input** in the meal builder uses a numeric keyboard (`inputmode="decimal"`) that the
  sandbox does not render.
- **Open Food Facts availability is outside our control.** It answered 3/3 probes at ~1.3 s during
  this session but has returned 503 before, which is why the route reports `unavailable: true` and
  the UI says the database is not responding rather than showing an empty list. That failure path
  *was* exercised for real during verification; the success path on a phone was not.

No migration, no schema change and no sync-path change in this release.

### [nutrition] Meal Plan Phase 1 (v1.282.0, 2026-08-11) — NOT verified on device · needs: browser

Journal: [`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md) ·
plan: [`superpowers/plans/2026-08-11-meal-plan.md`](docs/superpowers/plans/2026-08-11-meal-plan.md)

Shipped: build/edit/activate a plan with optional training-rest variants, a six-step setup sheet, a
searchable per-user dietary-restriction picker, the ~4-week review card, the saved-meals uplift, the
`getMealPlan` coach tool, and local SQLite v23 for offline rendering.

**Not verified on device, and the untested surface is larger than usual.** The sandbox reports
safe-area insets as 0 and has no native SQLite, so *none* of the local-store path has run: the v23
upgrade, `getActiveMealPlan`, and the `applyDelta` arms are all unexercised, as is the setup sheet's
real bottom clearance. Needs `docs/device-smoke-checklist.md` on the S25 — specifically an app
launch on a device already holding a v22 database, to prove the upgrade lands.

**The AI does not verify allergens, and no screen claims it does.** Structured capture makes the
restriction reliable; the model's filtering is best-effort. The review step shows ingredients beside
a must-not-contain list and says the plan was written by AI. Do not add a shield, badge or tick to
that screen, and do not let any automatic action depend on the filtering having worked — that is
also why Q-187's prefill must prompt per meal.

**Three gaps in the first cut, fixed in v1.283.0:** the "Save to my meals" switch was decorative,
nothing could deactivate or delete a plan, and "Manage plan" opened the new-plan wizard. Found by
re-reading the shipped code rather than by testing it — worth noting because all three would have
looked fine in a click-through.

**One stale CLAUDE.md entry found, not fixed:** `nutrition/saved-meals-sheet` is listed among the
nine hand-rolled chevron toggles missing `aria-expanded`. It has no chevron toggle at all. Only that
one entry was checked, so the count in CLAUDE.md is left alone rather than decremented on a guess.

**Portions, per-meal reroll, macro bars and a real manage sheet followed in v1.287.0** —
journal: [`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md).
Ingredient weights are now sized in code per variant (`scaleIngredientsToTargets`), so a split plan
no longer shows a permanent shortfall on whichever variant it was not sized for; a single meal can
be rerolled without touching the others; each meal shows a bar per macro against its target; and
meals-per-day / training-time / retarget are editable as instant re-splits.

**The riskiest untested change in that batch is offline, not visual.** A re-split deletes the
server's variants and writes new ones with new ids, and `applyDelta` previously only upserted by id
— a device pulling a 5→3 re-split would have rendered **8** meals. The delete-then-insert-by-parent
fix is in, but it can only be exercised on a device that already holds a plan and then pulls a
re-split. Add that case to the smoke run.

**A saved plan is now editable meal-by-meal (Q-192/Q-193, v1.288.0)** —
journal: [`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md).
Per-meal reroll previously worked only during review, and that was not a UI gap: `meal_plan_meals`
stored a name and four targets and **discarded the ingredients on save**, so there was nothing to
re-scale or replace. Migration 180 persists an ingredient snapshot; Manage plan → **Edit meals**
swaps, rerolls or renames one meal without touching the rest. Setup gained a **Meals you already
eat** step that keeps chosen library meals verbatim (portions resized) and takes free-text steers.

**The v24 local migration is the thing to watch on device.** Unlike v23 (table creation only) it is
ALTER-based, so a device already holding a v23 database is the case that matters, and no local-store
path has ever executed in the sandbox.

**Two near-misses worth remembering when regenerating `claude_ro` views:** capturing the generator
with `2>&1` puts its summary line inside the SQL (migration failed to parse on every boot), and
passing a local `CLAUDE_RO_OWNER_USER_ID` scopes every production view to a user that does not exist
there. Diff a regenerated views migration against its predecessor — the only difference should be
the new columns.

**Typed meals now get looked-up macros, and Saved Meals has a real UI (Q-194/Q-195, v1.289.0)** —
journal: [`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md).
Typing a meal into a plan calls the existing `/api/nutrition/scan` text mode (no new AI route), so it
becomes a keepable meal rather than only a steer. Saved Meals gained a per-ingredient breakdown, a
macro split bar, a delete confirmation, and multi-select delete.

**Prompt lesson worth keeping:** "do not repeat these" did NOT stop the model regenerating a kept
meal into the very next slot. The wording that works — already proven in the per-meal reroll route —
is "the plan ALREADY contains these; everything you return must be genuinely different food". Found
by reading a real generation, not by review.

**Known limitation, not a bug in the plan:** the nutrition-targets screen still lets you save macros
that do not sum to your calorie goal (the seeded account holds 150P/180C/60F beside 1,750 kcal =
1,860). The plan reconciles at read time — calories win, protein and fat kept, carbs refitted — and
says so on the review step, without writing to the saved targets. Enforcing it at source is a
backlog item on the targets editor.

### [nutrition] Energy Balance + calibrated maintenance (v1.280.0, 2026-08-11) — NOT verified on device · needs: browser

Journal: [`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md)

Shipped: the five-band Energy Balance card on Nutrition, Health and (optional) Home; calibrated
maintenance from logged intake vs weight trend; one calorie target across the app; the
`getEnergyBalance` AI tool.

**Root cause of "it was never visible":** the `energyBudget` card's `case` lived in
`renderTrainingSection` while the key is listed only in `BODY_GROUPS`, and no training order
contains it — so it fell through to `default: return null` on both tabs and had **never rendered
anywhere**. Fixed by moving the case to `renderBodySection`.

**Not verified on device.** Rendering was confirmed at the 412×915 S25 viewport in the sandbox
(Nutrition, Health and Home), but the sandbox reports safe-area insets as 0 and has no native
SQLite, so the card's real bottom clearance and any local-store read path are unexercised. Needs
`docs/device-smoke-checklist.md` on the S25.

**Calibration will not engage for ~2 weeks.** Food logging stopped 2026-07-26 (1 logged day in
August, 11 in July), and the estimator needs ≥10 logged days at ≥70% window coverage. Until then
the card shows the Mifflin-St Jeor baseline with a countdown, which is the intended state, not a
fault. Expect it to switch to "measured" around 2026-08-24 if daily logging holds.

**Production still has two different saved targets** (`users.calorie_goal` 1950 vs
`nutrition_targets.calories` 1750) until the first write after this deploy. Both write paths now
mirror, so any target edit — including accepting the Calorie Nudge — converges them. No migration
was written to reconcile the existing rows.

**Latent (not live): `listBodyMetrics` does not filter `deleted_at`.** The column exists on
`body_metrics`, the repo read ignores it, and the calibrated maintenance consumes those rows for its
weight slope — so a deleted weigh-in (e.g. a bad scale reading) would still skew the estimate.
**Currently harmless: no code path soft-deletes a body metric, and production has 0 such rows of the
owner's** (checked 2026-08-11). Not fixed here because the change touches ~10 consumers and
overlaps open PR #1244's soft-delete work. **If a body-metrics delete path is ever added, this must
be filtered in the same PR.**

**Weekly calorie goals convert on the mirror.** `users.calorie_goal` may be a weekly total while
`nutrition_targets.calories` is always daily. Caught pre-merge: mirroring a 13,650 kcal/week goal
straight across wrote 13,650 into the daily macro target. Both directions now convert via
`goalToDailyKcal`/`dailyKcalToGoal` and the user's daily/weekly preference is preserved.

### [platform][nutrition][readiness] ✅ Deleted rows coming back was 96% untested — COVERAGE COMPLETE 2026-08-11; mood logs' missing server filter is still open (2026-08-09)


Review:
[`docs/reviews/2026-08-09-soft-delete-mutation-coverage.md`](docs/reviews/2026-08-09-soft-delete-mutation-coverage.md)
· journal:
[`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md)

The ownership mutation harness, pointed at soft-delete filtering. **113 filters neutralised, 371 of
372 tests still passed** — one test notices, as a side clause. Every slice was at zero except
`programs.ts`. **109 of 113 (96%) provably unguarded**, worse than ownership's 38%, on a class whose
symptom is directly user-visible: *"my deleted workout is back"* is the mirror of the
"my data disappeared" reports already tracked here.

**Shipped:** `repository-soft-delete-filtering.test.ts` — 7 tests over injuries, supplements,
activity logs, fitness tests, food logs and workout sessions, each asserting present-before /
absent-after so a failed seed cannot pass. 7/7 fail under mutation. `adapter.ts` 0 → 6,
`nutrition.ts` 0 → 1.

**~~Deliberately incomplete~~ — finished 2026-08-11.** The remaining 35 (`user-stats.ts` 7 in #1244,
`periodization.ts` 17 in #1251, `oura.ts` 11 after that) all have attributable tests now, each of the
35 verified by individual mutation. **All 113 filters in the original sweep are covered or
accounted for.** Two things the burn-down taught, both worth more than the tests:
`getWeeklySetsByMuscleGroup` is two queries with three filters each and a case deleting only one
side leaves the other three untested — *counting* tests would have called it done; and `oura.ts` was
deferred for a whole entry as "needs a seeded rollup window" when its eleven filters are ordinary
work-list queries over sessions and sets. The estimate came from the slice's name.

**One real gap, filed as Q-178:** `mood_logs` carries `deleted_at` on the server *and* the device,
the local store filters it, and **all three server reads have no filter at all** — the device would
hide a deleted mood log while the server returned it. Latent (nothing server-side writes the column),
so filed rather than fixed: adding the predicate and dropping the column are both defensible, and
that is a product question.

**The static sweep followed, and found a live bug — Q-179.** 129 reads of the 13 soft-deletable
tables, 44 without a filter; most correct (13 are in `getSyncDelta`, which *must* return deleted rows
for tombstones, and only 6 of 13 tables are ever soft-deleted server-side). Two are live in-use
probes, and one reproduces: **delete your only food log for a meal type and the meal type is
undeletable forever**, refused with `MEAL_TYPE_HAS_LOGS` citing a log you cannot see.

**The obvious fix is wrong, and only a two-directional test showed it.** Adding the `deleted_at`
filter makes the probe pass, then the hard `DELETE` fails on `food_logs.meal_type_id -> meal_types`
(**ON DELETE RESTRICT**) — trading a clean domain error for a 500. Reverted. Q-179 lays out four
options; the cheapest destroys the sync tombstone. A decision, not a patch.

**Method note worth carrying:** the first mutator matched only Drizzle's `isNull()` and reported 86
filters, silently missing **27 raw-SQL** `deleted_at IS NULL` predicates. A scanner reporting a
*smaller* number is as suspect as one reporting zero. The mutation also cannot see a **missing**
filter — Q-178 surfaced only because a test written for it failed on clean code, and a systematic
static sweep for that has **not** been done.

### [platform][app-shell] ⚠️ The service worker's `/api/` passthrough changed — NOT device-verified (2026-08-09, v1.276.3) · needs: android

`public/sw-template.js`'s `/api/` branch now sends `cache: "no-store"`, and `cachedFetch` does the
same. This closes a measured bug — the browser HTTP cache sat under the app's own cache with no
invalidation path, so `DELETE /api/supplements/<id>` followed by `GET /api/supplements` kept
returning the deleted row for up to a minute (verified on a route that already ships the header on
`main`, so this was live, not hypothetical).

**The risk is where it was fixed, not what it fixed.** The service worker is the APK's network path
*and* its offline cold-start mechanism, and it deploys automatically (`app/sw.js/route.ts` stamps
the commit SHA into the template). Verified in Chromium — every main screen renders with the SW in
control, no `/api/` 4xx/5xx, and `POST /api/mood` (a write with a body, the case `no-store` could
plausibly break in a SW) returns 200 — but **not on the S25**. Also unexercised: the real offline
path with a populated seed. A service-worker fault on device is not subtle, so this belongs on the
next device smoke run.

### [app-shell][platform] ✅ One of the two sign-out buttons left the previous account's data on the device — fixed 2026-08-10 (Q-172, v1.277.3)

More → Profile signs out through `clearLocalStoreData()` → `clearAllCache()` → `signOut()`.
`components/chat.tsx` has **two** sign-out buttons (`:554`, `:636`) that post a bare
`<form action={signOut}>` and do neither. After signing out that way, `ta_cache:*` and the native
SQLite store still hold the previous account's data, and most cache keys carry no user id
(`weekly-stats`, `readiness-score`, `home-day-timeline`), so the next account paints from them via
`readCacheSync` before any fetch returns.

Invisible today — one account per device — and squarely in the way of the multi-user/Play Store
direction recorded in the Canonical Runtime note. The localStorage half was proven in the browser;
the native SQLite half was inferred from the absent call, not observed.

**Fixed 2026-08-10 (#1235, v1.277.3)** — and the fix was larger than the finding: reading the
sign-out that *did* work found `clearLocalStoreData()` was a hand-written list drifted to 27 of the
schema's 37 tables. See the Current Status entry above and
[`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md).
⚠️ **Still not device-verified:** `clearLocalStoreData()` is a no-op on web, so the local-store half
has never actually run.

### [platform][nutrition] 🟠 90% of the DB suite is blind to a total loss of user scoping (measured 2026-08-09)

Full method:
[`docs/reviews/2026-08-09-ownership-mutation-coverage.md`](docs/reviews/2026-08-09-ownership-mutation-coverage.md)
· journal:
[`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md)

**The scoping is correct today — this is not a live leak.** Q-155 said one cross-user leak passes all
tests; mutation testing turns that into a number. All **246** `user_id` predicates in
`adapter.ts` + slices were neutralised at once and **286 of 317 DB tests still passed**.

- **`nutrition.ts` (22 predicates), `body-battery.ts` (1) and `social.ts` (1) fail ZERO tests** with
  every ownership check removed. Two quartiles of `adapter.ts` (69 predicates) behave the same.
- **Lower bound: 93 of 246 predicates (38%) unguarded.**
- The uncovered set includes ten destructive writes (`deleteInjury`, `deleteSupplement`,
  `deleteActivityLog`, `updateFoodLog`, `deleteSavedMeal`, …) and the bulk mutations
  `applyLbsToKgFix` / `reconcilePersonalRecord`. **`updateInjury` is among them** — the method
  CLAUDE.md calls *"the reference"* for the write-path ownership rule.
- The 31 tests that did fail are weaker evidence than they look: the failing set **varied between
  runs** (14–17 files), because with scoping gone the tests contaminate each other by execution
  order. Only 7 of 71 DB test files set up two users at all.

**Burn-down done across three passes, same day.** `repository-ownership-scoping.test.ts` is now
**36 tests**, each verified to fail under mutation. Re-measured: all-246 detection **31 → 75**,
detecting files **14 → 21**, `adapter.ts` **23 → 44**, slices nutrition **0 → 12**, body-battery
**0 → 1**, social **0 → 2**, and the two dead `adapter.ts` quartiles **0 → 13** and **0 → 7**.
**No quartile and no slice sits at zero.** The bulk mutations that worried me most —
`applyLbsToKgFix`, `previewLbsToKgFix`, `reconcilePersonalRecord` — are covered, two-sided (empty
result *and* the other user's stored rows unchanged).

**Fourth pass — the blind spot, audited statically (Q-174 filed).** Mutation cannot see ownership
enforced by a join or pre-check, so all **50** writes to `user_id`-less tables were classified by
hand. **13 of the 14 parent-id-keyed writes are correct** — `saveProgram`, `saveProgressionStyle` and
`updatePhaseSet` all carry affected-row-count guards citing Q-129, and `activity_types` is a global
catalogue behind `requireAdmin`. The one gap is the **volume-target family**: four methods taking a
`programId` with no `userId`, over a table with no `user_id` column, of which two have zero callers.
Safe today; filed as **Q-174** — and **fixed the same session**:
`listVolumeTargets(userId, programId)` now scopes via an `innerJoin` to `programs`,
`replaceVolumeTargets(userId, programId, targets)` carries an ownership pre-check with a row-count
guard inside the transaction before the DELETE, and the two dead methods were deleted rather than
fixed. Three new tests, mutation-checked, including a **positive** case proving the owner is still
permitted — without it, a guard that rejected everyone would have passed. Read-side over-filtering
was checked on a running dev server: a seeded target returns `{"targets":{"chest":16}}` for its
owner, and a forged `programId` returns 404, not 500.

**Q-155 stays open, and the reason matters.** "No range at zero" is far weaker than "all 246
covered": the quartile bisect bounds rather than attributes, so a range producing 7 failures is not
34 covered predicates. Exact attribution needs ~246 individual runs. Untouched entirely: ownership
enforced by a join or pre-check instead of a `user_id` predicate, and the full ~3,270-test suite —
only the 363 DB tests were measured.

**Carry this into any addition:** **four** assertions in that file could not fail as first written —
`getBodyBatteryHistory` returns a row shape with no `userId`, making `not.toContain(USER_B)`
unfalsifiable; `deleteFitnessTest` is a soft delete, so asserting on an untouched column could never
fail; `deleteMealType` throws `MEAL_TYPE_HAS_LOGS` before reaching the ownership check; and
`listSeasonsWithResults` reads a global table, so a leak attaches B's rank to a season A may
legitimately see rather than adding a row. Every one was caught only by running the new test under
mutation as well as clean. **Do that for each addition before counting it as coverage.**

**Limits:** DB suite only (317 tests), not the full ~3,270 — route/component tests were not measured.
Ownership enforced by a join or a pre-check (`ensureWorkoutSession`) is untouched by this method.
Local Postgres only; no device, no production data.

### [platform][app-shell][workouts] AI Coach — MOSTLY device-verified now; three items still owed (2026-08-09 → 2026-08-18)

**⚠ Partially cleared 2026-08-18 from owner screenshots of a real swap on the S25 — screenshots, not
a full smoke run, so it is evidence rather than a completed checklist.** What those images show
working on the device: the **composer clearing the gesture bar** (the item this row called "the one
that matters"), **header clearance** under the status bar and punch-hole, **Samsung WebView rendering**
of the widget cards including the green result card, and **real touch on the option rows** — the owner
tapped two of them and the swap applied end to end.

**Still owed, and the row stays open for these:** the composer **with the keyboard open**; **offline
behaviour in real airplane mode** (only `navigator.onLine` has ever been exercised); and the
**tier-3 `/coach/confirm/[toolCallId]` screen**, which an exercise swap does not reach — `program_phase`
is the only tier-3 domain, so confirming a swap proves nothing about it.

**This was the device gate for Q-157 phases 1 and 2, recorded because no S25 was available in the
session that built it.** Everything below was verified in Chromium at 412×891 in both themes and
against the local dev database; the phone has now covered the four items named above.

- **A second full-screen surface since this row was written:** `/coach/confirm/[toolCallId]`, the
  tier-3 hold-to-confirm screen, has the same navless bottom-anchored shape as the composer and
  the same unverified inset.
- **The one that matters: composer clearance.** `/coach` is a **navless full-screen route with a
  bottom-anchored composer** — the exact shape that has put a control under the gesture bar 11+
  times. It uses the floored `pb-safe-action-lg` and measures 64px of clearance in the sandbox, but
  the sandbox renders `env(safe-area-inset-bottom)` as **0**, so that 64px is the floor doing all
  the work and the real inset has never been added to it. Also unchecked with the keyboard open.
- **Header clearance** under the status bar / punch-hole (`pt-safe-or-4`).
- **Samsung WebView rendering** of the widget cards (`color-mix` tints, no blur/filter used).
- **Real touch** on the 56dp FAB, the 48dp back/history buttons and the 56dp option rows.
- **Offline behaviour behind the service worker** — airplane mode was not exercised; only
  `navigator.onLine` was.

Run the **AI Coach** section of [`docs/device-smoke-checklist.md`](docs/device-smoke-checklist.md)
and strike this row. Nothing here blocks use of the app — the three entry points and every other
screen are unchanged — but a composer under the gesture bar would make Coach awkward to type into.

**Also in this release, and worth a look on-device:** every `<Switch>` in the app rendered as a
black circle (the global 48px tap-target floor beats Radix's `h-5 w-9`); fixed in the shared
primitive, so the **goal-recommendation sheet** in Profile is the other surface to eyeball.

### [platform][app-shell] Three rules mechanised, one CI blind spot closed, two cache findings queued (2026-08-09)

Journal:
[`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md).
**No app behaviour changed** — CI scripts, workflow config and docs only.

**The pattern behind all of it:** every rule checked this session was either *in CI and holding* or
*written down and drifting*, with nothing in between. `check-timezone-rendering` has kept
device-local rendering at zero since it landed; the sparkline count went 5 → 6 days after it was last
re-verified by hand.

**Shipped (#1192, #1193, #1194):**
- `check-numeric-bounds.js` — an unbounded `z.number()` in a validation schema (Q-164). The
  `activity-log.ts` grandfather row was **deleted 2026-08-09** when that file was bounded in full, so
  the check now holds every schema in `validation/`+`validators/` with no exceptions.
- `check-sparkline-primitive.js` — a `<polyline>` instead of `components/ui/sparkline.tsx` (Q-154),
  six existing copies grandfathered. **Q-154 stays open** — the check stops a seventh, it does not do
  the replacement work.
- `check-local-column-upgrade-path.js` — closes a **real blind spot found by mutation-testing the
  existing checks**: `check-reconcile.js` scans `ALTER TABLE … ADD COLUMN`, so it cannot see a column
  added to a `CREATE TABLE IF NOT EXISTS` body. That column reaches fresh installs and is **missing
  forever** on upgraded devices, throwing on every `INSERT` that names it while tests, the web
  sandbox and fresh installs all stay green — the #85 class. **Zero live instances** across all 41
  commits touching `migrations.ts`, so it ships with no grandfather list.
- Three inline Custom Rules greps widened past `app/ lib/ components/` to include **`packages/`** —
  229 files, 21% of the TypeScript surface, and where `date-utils`, the validation schemas and the
  health formulas live. Verified clean at the new scope.

**Queued, not fixed:** **Q-165** — 171 client GETs use `cachedFetch`, **62 use bare `fetch`** (29
admin/debug consoles that should *not* be swept, 33 user-facing, ~24 genuine render-path reads after
excluding nine with a real reason to stay uncached). ~~**Q-166** — 44 of 124 GET routes carry no
`Cache-Control`, 24 after excluding admin/OAuth/webhook routes.~~ **Q-166 is done (2026-08-10), and
it inverted:** the headers came *off* rather than being added, and the ~13 headerless data routes got
an explicit `private, no-store`. Work Q-165 next; the client side is what the user sees.

**A deliberate non-decision worth keeping:** Q-165 is explicitly filed as *not* a CI-check candidate
yet. With nine legitimate exceptions in 33 cases, the exemption list would be as long as the violation
list — a rule that documents drift rather than preventing it. That is the opposite call from the two
checks above, and the difference is the size of the exception set.

**Not verified on device.** Nothing here touches runtime, but the local-column hazard is device-only
by nature and was confirmed by reading `reconcileSchema()` and by history sweep, never by running an
upgrade on hardware.

### [activity][platform] 🟠 A 69-day walk was accepted — and my own Q-151 was wrong (2026-08-09)

[`docs/reviews/2026-08-08-adversarial-input-review.md`](docs/reviews/2026-08-08-adversarial-input-review.md).

**✅ Q-164 — FIXED 2026-08-09 (v1.275.2).** `POST /api/activity-logs` with `durationMin: 100000`
returned 201 and persisted a single walk lasting 69.4 days. All 28 unbounded numerics in
`activity-log.ts` now carry named upper bounds, and the check's grandfather row is gone.

**Why the existing cross-field refine could not catch it.** Every rate check in
`activityImplausibleReason` divides by `durationMin` and is skipped when it is absent or zero — so a
single field on its own met nothing at all. The two layers are complementary, and the new
single-field ceilings close exactly the hole the rate checks leave. Bounds are **derived** from the
existing rate constants (`MAX_ACTIVITY_DISTANCE_KM = MAX_AVG_SPEED_KMH × 24 h`, and so on) so a
ceiling can never contradict the per-minute check beside it.

**Two of the entry's claims were wrong and are corrected here.** (1) The HR fields were *already*
bounded — the plausibility refine rejects `avgHr: 9999` today, so they were never part of the gap.
(2) The entry said an over-long duration "produces an end timestamp days later and can push an
activity into the wrong day bucket". It does not: `addMinutes` wraps at `% 1440`, so
`addMinutes('08:00', 100000)` returns **18:40 the same day**. That wrap is instead what *justifies*
the 1440-minute ceiling — beyond a day the value is unrepresentable anyway.

⚠️ **The entry's "plausible typo" case is NOT caught, deliberately.** 1000 minutes for 100 is
16.7 hours, which a real ultra reaches; a physiological bound that rejected it would reject a good
day. Pinned as a passing test so the limitation is visible rather than assumed fixed — catching
typos needs a confirmation prompt, not a tighter ceiling.

Closed the way it was opened: **POSTed against the running route.** The four reproductions now
return 400 and a real 90-minute walk still returns 201 (probe row deleted).

**Correctly rejected in the same sweep:** negative durations, a 500-char emoji/RTL title, out-of-range
body fat, and every bad weight. The gap is specifically the *upper* end of otherwise-validated
numerics — a narrower and more fixable statement than "validation is weak".

**❌ My Q-151 was a false positive — refuted by #1184, correctly.** I claimed `/sign-in` carried a live
React #418 and tied it to production's 153-hit series. Zero of 272 production #418s are on `/sign-in`;
the series stopped 19 minutes after Q-73's deploy; it does not reproduce in eight runs across dev and
a production build. **What I actually saw was a dev-mode React hydration warning**, which the
production build does not emit — and I attributed a production count to a route **without checking the
`url` column, while already querying that table**. One `GROUP BY url` would have killed it before
filing. Recorded because the reasoning error generalises: *"I saw an error on page X" and "the counter
for that class is high" are two claims, and joining them needs evidence, not adjacency.*

**✅ Boundary dates clean — zero 500s across four date routes, twelve inputs.** The class CLAUDE.md has
been burned by repeatedly. `2026-02-29` rejected and `2024-02-29` accepted is the strongest signal:
real calendar validation, not a regex that looks right. Slashes accepted, malformed rejected. Q-130's
hardening holds.

**✅ Concurrent duplicate submits — checked, mitigated, NOT filed.** Five identical concurrent POSTs
create five rows (no server idempotency), but the real save paths carry the client guard CLAUDE.md
prescribes: `done-activity-screen.tsx:65,423` (`saving` + `disabled`) and `walk-summary.tsx:55,112`
(a `savedRef`, the stronger ref form). My probe bypassed the UI. Filing it would have been a false
positive — noted rather than queued.

**⚠️ Contrast: third attempt, definitive stop.** This time starting with a self-test — black on white,
expect ~21:1. **It returned 1.96:1**, so the method is broken in a case whose answer is known and no
measurement from it should be believed. The self-test did immediately catch a `clip` key-name bug
(`w`/`h` vs `width`/`height`) that likely caused attempt 2's uniform 1:1 results. Contrast stays
**unmeasured**; the self-test harness is what the next attempt inherits.

### [app-shell] 🔴 The home header shows the WRONG DAY for a non-Brisbane user — OBSERVED live (2026-08-08)

Lens 12 + empty states —
[`docs/reviews/2026-08-08-multi-user-and-empty-state-review.md`](docs/reviews/2026-08-08-multi-user-and-empty-state-review.md).
A second account was **seeded and driven**, not reasoned about.

**✅ Q-163 — FIXED 2026-08-09 (v1.275.1).** Logged in as an `America/New_York` user at **18:52
Saturday their time** (08:52 Sunday in Brisbane), the app showed them header date **"Sunday 9
August"** — a full day ahead — and **"Good morning"** at 6:52 PM. Fourth appearance of the class
after Q-73, Q-144 and Q-148, and the one that finally removed the cause rather than the instances.

**It was six sites, not the four listed.** The two extra were load-bearing: the calendar-day key
built from local-store history (`session-select-content.tsx:376`) has to match the keys the week
strip uses, so fixing one without the other would have shipped a *new* day-off-by-one inside the fix;
and `workout-select-content.tsx:22` held a second independent copy of the same hardcoded helper.
`overview-screen.tsx` also had a bare `todayInTz()` keying a **body-metric write** — the same defect
on a write path.

**The comment was half the bug.** `session-select-content.tsx:99-100` defended the hardcode —
*"the server buckets workout/rest days in AEST regardless of device timezone"* — which **was true
when written and Q-144 (#1161) made false**. It is deleted. `dayKeyInTz(tz, daysAgo, at?)` now lives
once in `packages/shared/src/date-utils.ts` and the `aestDateString` prop was renamed `dayKey`,
because a name asserting AEST is the same trap as the comment.

**Verified with three zones, because two cannot prove it** (the Q-148 lesson: device-local and the
`DEFAULT_TZ` fallback are indistinguishable unless all three differ). User `America/New_York`, device
`Europe/London`, fallback `Australia/Brisbane` — hours 08/13/22 at run time. Rendered: **"Good
morning"**, i.e. the user's own zone. Planting the hardcode back reproduced **"Good night"** for a
user at 08:40 their own time. ⚠️ **Not verified on the S25** — these are all Home-screen surfaces on
the APK.

**✅ Cross-user isolation verified by attack, not by reading.** As user B: four read probes at A's
session (404/401/404/404) and five write probes at A's injury and program (401/401/404/404/404).
**Nothing leaked; A's rows verified unchanged afterwards.** Corroborates the 2026-08-07 read-based
verdict empirically. Minor inconsistency noted, not filed: the same condition returns 401 on injuries
routes and 404 on programs routes.

**✅ Empty states clean — and it kills a standing hypothesis.** Every page driven as a user with no
program, no logs, no ring: all render, zero `pageerror`. Production's unexplained client bursts
(`Cannot read properties of null`, `.reduce is not a function`) were suspected to come from
sparse-data screens. **They do not** — that does not explain them, but it removes the obvious
candidate.

**Onboarding fact worth having:** `users.is_active` defaults to **false** and `middleware.ts:23-26`
sends inactive users to `/pending`. The app is invite-gated by default — a new account authenticates
but reaches nothing until someone flips the flag. Correct today; it is the gate a Play Store
self-service signup would have to change.

**NOT done:** adversarial values, boundary dates, offline, rapid double-tap — all need write flows and
were not reached. No device.

### [app-shell] 🟠 Lens 10 — mobile UI vs Material/WCAG: 7×7 px tap targets, and contrast that could NOT be measured (2026-08-08)

[`docs/reviews/2026-08-08-mobile-ui-standards-review.md`](docs/reviews/2026-08-08-mobile-ui-standards-review.md).
Judged against **Material 3 and WCAG 2.2 AA**, not the repo's own rules — measured in a real browser
at 390×844 with a logged-in session, both themes.

**🟠 Q-160 — the session carousel dots are 7×7 px.** Material wants 48dp; WCAG 2.5.8 AA wants 24×24.
And it is deliberate: the app *has* a 48px floor (`globals.css:538-543`) and the dots opt out via
`.tap-dense` (`:540-544`), whose documented purpose is *"inline text buttons"*. **A carousel dot is
not an inline text button.** Stated fairly, WCAG's *equivalent alternative* exception may apply since
the carousel swipes — but 7×7 on a 6.9" screen fails the intent regardless. The fix is conventional:
keep the dot 7px visually, pad the hit area to 48px. Then audit the other `.tap-dense` users, because
the opt-out is doing more than its comment claims.

**Q-161** — three inputs use a placeholder as their only label (both `/sign-in` fields and the `/chat`
textarea), so the field's identity vanishes exactly while the user types. **Q-161** — six controls
expose no accessible name, including a **Radix Switch** that announces "switch, on" with no indication
of what it toggles. Not a duplicate of Q-133, which covered `aria-expanded` on disclosures.

**⚠️ Contrast was NOT measured, and that is the biggest gap.** Two methods, both invalid. (1)
Computed-style with an ancestor background walk produced ten tidy sub-4.5:1 results that were
**identical in light and dark** — the tell. The theme did switch, but `body` computes to
`rgba(0,0,0,0)` in both, because this app paints via the dynamic-background layer, so the walk fell
back to assumed white **in both themes**. Those numbers are discarded, not reported. (2) Pixel
sampling from a screenshot returned exactly **1:1 for every element**, impossible for visible text.
§4 of the review records what a working method needs. **The `DetailHero` hardcoded-dark case remains
unverified.**

**Also not covered by Lens 10:** `prefers-reduced-motion`, Android text scaling, keyboard/focus order,
per-screen error/empty/loading states, destructive-action confirmation, numeric `inputMode`. No
device, so no Samsung WebView compositing, no real safe-area insets, no actual touch.

### [platform] 🟠 The rulebook is wrong and the test suite is blind to a cross-user leak (2026-08-08)

Lenses 9 and 11 of the deep review —
[`docs/reviews/2026-08-08-claude-md-and-test-suite-review.md`](docs/reviews/2026-08-08-claude-md-and-test-suite-review.md).
Two questions nobody had asked: **is CLAUDE.md true**, and **does the suite actually test anything**.

**🟠 Q-155 — a cross-user data leak passes all 3,270 tests.** Measured by mutation: removing the
`user_id` scope from `adapter.ts:1852` (`getBodyMetricsBaseline`, live on two routes) leaves the
suite fully green — **414 files, 3,270 tests, 0 failures**. Read it correctly: the 2026-08-07 review
certified ownership clean *by reading* and was right, the scope **is** correct today. The gap is that
**nothing would tell you if it stopped being right**, in the highest-severity class this project has.
Supporting signal with its limits stated: 180 of 286 repository methods appear in no test by name —
a crude proxy for *where to look*, not a count. Separately, breaking a `scoreBand()` threshold fails
exactly **1** test, for a formula 18 call sites consume.

**✅ Q-153 — FIXED 2026-08-09.** CLAUDE.md instructed an import that does not compile: nine modules
moved to `packages/shared/src/` and the rulebook still named them under `lib/`. The Timezone
section — which the document itself calls *"a strict rule"* — showed
`import { todayInTz } from '@/lib/date-utils'`, a path **0 files use** against 197 using
`@trainingai/shared/date-utils`. All thirteen occurrences corrected (four of them
`lib/changelog.ts`, which two sessions had already had to grep past), plus the header sentence of
the One-Formula rule, which claimed domain math *"lives exactly once in `lib/`"* and would have sent
a reader to the wrong directory.

**The durable half is the point.** `scripts/check-claude-md-paths.js` now fails CI (Custom Rules) on
any backticked path or `@/…` import specifier in CLAUDE.md that does not exist, with a
`-> moved to packages/shared/src/…` hint when it can work one out. Template filenames
(`<pillar>`, `YYYY-MM-DD`) are skipped, and genuine exceptions — the deliberate *"there is no
`lib/health/score-band.ts`"*, the unbuilt APK artifact — sit in a `DELIBERATE` map that requires a
written reason per entry. It found exactly the nine the review did, independently, and was verified
to fail on the original `@/lib/date-utils` line. **A wrong path in a rulebook is worse than one in
code: nothing compiles it, so it rots silently and gets copied confidently.**

**Q-154 — a sixth inline sparkline shipped days after the rule was re-verified.**
`components/health/day-detail/day-sections.tsx:57` hand-rolls an HR chart instead of using
`components/ui/sparkline.tsx`, arriving in #1136. CLAUDE.md records the count as eight; it is nine.
The finding is as much about the rule as the file — *"replace on touch"* is enforced by reviewer
memory alone, which is to say by nothing.

**Also drifted (improving):** hex literals 455 → **430**; score-band call sites 17 → 18.

**NOT done:** Lens 10 (mobile UI vs external standards) and Lens 12 (multi-user scale) not run; the
rest of the CLAUDE.md audit — rules contradicted by their own code, rules that could become CI
checks, rules now obsolete — not started. No device.

### [workouts][app-shell] 🔴 A same-day mood check-in with zero sore muscles doesn't clear an already-on-screen whole-session Deload recommendation (found 2026-08-09, NOT fixed)

Owner asked why the Lower pre-workout screen recommended a whole-session Deload — "Most of this
session's muscles are still sore (Glutes, Quads, Back, Hamstrings)" — when "there was no training of
those muscles within 48 hours." Traced to source rather than dismissed as an odd recommendation.

**Confirmed real against production data, not a soreness-detection accuracy question.** The
whole-session deload trigger (`computePerExerciseDeload`,
`packages/shared/src/ai-periodization/per-exercise-deload.ts:60`) escalates whenever more than half
a session's exercises match a mood-log self-reported sore-muscle label — it never independently
checks whether a muscle was actually trained within any time window at prescription time, despite
the banner's phrasing reading like automatic detection. Queried `claude_ro.mood_logs` directly:
today's check-in (`log_date` 2026-08-09, `created_at` 22:31:07 UTC = 08:31 AEST — essentially the
same minute as the owner's screenshots) recorded zero sore muscles (`body_state: []`); **yesterday's**
check-in (`log_date` 2026-08-08) listed all four muscles named in the stale banner among its nine.
The server's fallback logic (`todayMoodLog ?? yesterdayMoodLog`, `app/api/workout-data/route.ts:496`)
correctly prefers today's log via nullish coalescing when one exists — so this match is only
possible if the rendered screen held a prescription computed *before* today's check-in was saved.

**Root cause: the mood check-in's save handler never triggers a refetch of the screen showing the
prescription it affects.** `MoodCheckInSheet` has exactly one call site
(`app/session-select/session-select-content.tsx:1438-1443`), wired as
`onSaved={(log) => setMoodLog(log)}` — a purely local state update that only feeds the check-in
card's own display, confirmed unconnected to the `workout-data` fetch by grep. The save handler
does correctly call `invalidateCheckinAffectsPrescription()`
(`components/mood-checkin-sheet.tsx:242`), which clears the right cache groups — the invalidation
half of this pattern is fine. What's missing is the refetch trigger: nothing calls
`fetchWorkoutData()` or bumps `refreshTick` afterward, so the already-rendered screen keeps its
stale in-memory prescription until an unrelated remount or the header refresh button, which already
calls the correct function (`fetchWorkoutData()`, same file, line 1086) — proof the fix is wiring an
existing function to a new call site, not writing new logic.

**Real downstream harm, not cosmetic**: a materially wrong training prescription (a full-session
deload cutting working weight ~50%) directly contradicting the lifter's own same-day self-report,
silently persisting until an unrelated screen action happens to force a refetch.

**✅ Fixed 2026-08-09 (Q-158, v1.275.0).** `onSaved` now refetches and bumps `refreshTick`. One
thing the plan did not anticipate: the sheet fired `onSaved` *before* invalidating, which is
harmless for a callback that only sets state and wrong for one that refetches — the refetch would
have read the stale `workout-data` cache straight back — so the invalidation is awaited first.
Proven both ways in a browser at 412×891: pre-fix a save fires only `POST /api/mood`; post-fix it
also fires `workout-data?tab=meta`, `next-session`, `workout-data?tab=all` and `readiness-score`.
(Filed here as Q-159 while #1187 was open; it landed on `main` as **Q-158**.)

### [app-shell][platform] 🟠 The first review to RUN the app — unauthenticated calls on the login screen (fixed), and a second live hydration bug (2026-08-08)

[`docs/reviews/2026-08-08-running-app-review.md`](docs/reviews/2026-08-08-running-app-review.md).
Step 0 + part of Step 1 of the deep-review prompt — **not** the full twelve lenses. What makes it
worth reading: it was **observed in a running browser**, and two of these had survived 25 read-only
reviews.

**✅ Q-150 — the signed-out login screen no longer calls the API at all. FIXED 2026-08-08 (v1.270.31).**
`components/sync-provider.tsx` guarded `pushMutations`/`pullDelta` on `userId` but not the cache-warm
phase or `maybeSyncOura`, which fired **`POST /api/oura/sync`** — an expensive external sync — before
login. `SyncProvider` sits in the root layout, so it happened on **every** signed-out route.
**Measured, not estimated: the real count is 22, not 12** — phase 3 sleeps 2.5 s then warms all 20
`CACHE_TASKS` in chunks of five, so the review's network-panel read caught roughly the first two
chunks. A scripted browser watching for 12 s after load records 22 before, **0** after; signed in,
the warm cycle and Oura sync still fire with 0 401s. The **four native-only reminder reconcilers**
were swept in the same PR — on the APK they fetched meal types, next session, supplements, readiness
and body battery before login too, which the browser reproduction structurally could not show.
⚠️ **That native half is unverified on device** — the sandbox cannot reach it, so what is proven is
that they cannot fire signed out, not that reminders still schedule correctly signed in on the S25.
Phase 1 (sessionStorage mirroring, no network) and the two BLE radio effects stay ungated on purpose;
a failed step post re-queues in its own retry buffer against a server that dedups, so nothing is
lost. Held by `components/__tests__/sync-provider-auth-gate.test.ts`, a source-text check because the
repo has no jsdom environment — verified to fail on a planted regression.

**⏳ Q-151 — REFUTED 2026-08-08, and it looks like Q-73 did close the class.** Filed as "React #418
is NOT closed — `/sign-in` has a second, independent instance". Three measurements say otherwise
([journal](docs/overview/history-2026-08-07.md)). **(1)** Production has
**never** recorded a #418 on the sign-in page — `0` of `272` rows; all of them are on `/` (234),
`/more` (15), `/health` (13) and four `/workout` URLs. **(2)** The whole series **stopped at Q-73's
deploy**: last occurrence anywhere 2026-08-07 20:53 UTC, #1130 merged 21:12 UTC, nothing since,
against a 1–13/day baseline for the fortnight before. **(3)** It **does not reproduce** — `/sign-in`
signed out in a scripted browser at 412×915, in a dev server *and* a production `next build`, under
four localStorage theme states (the ones that make the inline theme script mutate `<html>` pre-
hydration), gave **zero console messages in all eight runs**; `Meteors`, `Typewriter` and
`GoogleSignIn` were each read and cleared. ⚠️ **One clean day is one day** — *stopped ≠ fixed* — so
the entry survives as a dated re-check, not a deletion. ⚠️ The **signed-in home** path could not be
reproduced locally at all: `NODE_ENV === 'production'` hard-forces SSL in
`lib/data/postgres/client.ts:16` and the local Postgres refuses it, so login fails under
`next start`; home-after-Q-73 rests on telemetry alone. **Re-run the standing `error_events` query
around 2026-08-15**: if #418 is back, the row's `url` names the real route.

**✅ Q-152 — FIXED 2026-08-08.** `ensureSchema` printed a genuine migration failure
(`cardio_sessions_user_id_fkey cannot be implemented`) in the same format as four benign
`already exists` notices, then continued. Now classified by **SQLSTATE**, not message text: six
idempotency codes (`42P07`, `42710`, `42701`, `42P06`, `42723`, `23505`) collapse into one aggregated
info line; anything else — **including a codeless error** — is a `console.error` carrying its code,
plus a `N failed` summary. **Deliberately not fatal**: a migration that cannot apply is usually
permanent, so failing closed would crash-loop every boot rather than surface anything new.

### [app-shell] ✅ Device-local rendering list triaged — 7 benign, 1 real bug fixed, 2 blocked (2026-08-08, v1.270.22)

The `check-timezone-rendering` CI rule shipped earlier the same day with twelve undifferentiated
files. That was honest but not useful — **"calls `toLocale*` without a `timeZone`" is not by itself a
bug** — so every file was read and classified
([journal](docs/overview/history-2026-08-08.md)).

**7 benign, no work needed:** each builds its Date from calendar components or a **local**-anchored
string, so device-local rendering returns the same calendar date in any zone.

**1 real bug, fixed:** `components/health/strength-trend-card.tsx:42` used
`new Date(h.date + "T00:00:00Z")` — **UTC** midnight — then rendered device-local. Correct on the
owner's Brisbane device (10:00 same day); **a day early anywhere behind UTC**. Now uses
`formatDayShort`, the single-source helper whose docstring already warns against that construction.
Visible consequence, stated plainly: labels change from `6 Jul` to `Jul 6`, because that is what the
shared helper emits — keeping the old order meant a second inline copy.

**2 real but blocked (3 at triage time), and this is the finding worth carrying: 🟠 no client component can read the
user's timezone at all.** `users.timezone` is on the JWT and reaches every API route, but every
*client-side* formatter falls back to `DEFAULT_TZ`. Q-144 was fixable precisely because it was
server-side; `exercise-review-sheet`, `chat` and `stats-grid` render absolute instants and are not.
Filed as **Q-148** — **✅ since shipped (v1.270.29): `UserTimezoneProvider` closed the gap and all
three sites are converted.** The entry's note not to "fix" them by passing `DEFAULT_TZ` — that is
what they already did — is what made the plumbing the item rather than the symptoms. **A third file left the list mid-review and showed a limit of the check:** Q-123
(#1167) switched `exercise-review-sheet` to `formatDayShort`/`formatTimeOfDay`, which default to
`DEFAULT_TZ` when no tz is passed — so it escaped a check that matches `toLocale*String` only, while
still not rendering in the user's zone. Improvement, not correctness; both the script and Q-148 now
say the sweep must cover shared formatters called without a tz, not just `toLocale*`.

The script now composes its list from named `REVIEWED_BENIGN` and `BLOCKED_ON_CLIENT_TZ` sets with a
per-file reason, both still shrink-only. **Process correction:** this change also adds the
2026-08-08 DB review link to `docs/domains/platform/README.md`, which CLAUDE.md required in the PR
that added the review and which was missed there.

### [app-shell][platform] Bundle sizes measured for the first time — and they are NOT the navigation lever (2026-08-08)

Never measured in 25 review documents. Numbers now exist
([journal](docs/overview/history-2026-08-07.md)): **105 kB First Load JS
shared by every route**; `/workout` heaviest at **361 kB**; `/` · `/health` · `/nutrition` · `/more`
all at **316 kB while carrying 235 B of their own code** — so the weight is shared-layer, and
screen-level splitting would move almost none of it.

**Recorded as a negative result, on purpose.** The 2026-08-05 S25 capture already settled where
navigation cost lives: **22 navigations, warm 22 · cold 0, not one fetched an RSC payload**, and the
worst sample (1348.7 ms, ~9× median) was entirely client-side render/mount. Transfer size cannot
explain a cost that involves no transfer, so the evidence still points at **rendering** — Q-51's
file-splitting item — not at bundle weight. The point of writing it down is to stop a future session
re-opening and re-measuring a plausible-sounding thread. Same discipline the Q-127 entry earned the
hard way the same day: a real static import chain whose claimed consequence did not reproduce.

**Still genuinely unmeasured: cold app start.** In-app navigation was captured; the boot cost —
when the shared baseline and a screen's First Load are actually paid — never has been. Needs the
device, filed as **Q-147** with an explicit "do not optimise off the baseline" note.

**Correction to an earlier claim this session:** the `@capacitor-community/speech-recognition`
typecheck/build error was called "pre-existing" — it was a **stale sandbox `node_modules`**, not a
repo defect. `pnpm install --frozen-lockfile` clears it and touches neither `package.json` nor the
lockfile.

### [platform][devices] DB/scalability + dev-tooling review, 2026-08-08 — 4 findings QUEUED, 4 CI rules SHIPPED, no app behaviour changed

Full write-up:
[`docs/reviews/2026-08-08-db-scalability-and-tooling-review.md`](docs/reviews/2026-08-08-db-scalability-and-tooling-review.md).
The database layer had never been reviewed — 24 review docs, none covering indexes, query plans,
table growth or connection behaviour — and it is also the only layer currently producing unexplained
production faults. Nothing was fixed inline; everything is queued.

**Q-142 was overtaken mid-session and is now half the size it was filed at.** The review found that
`lib/observability.ts` recorded `message`/`stack` only, dropping the Postgres error on `err.cause` —
why **98 `Failed query` events over 30 days carried no diagnosis**. **PR #1150 (Q-107 first half)
shipped exactly that fix the same day**, independently. What remains is the half it did not touch:
`lib/observability/request-error.ts:55-59` still drops the cause, and per `docs/module-map.md` §14
that `onRequestError` path covers **the 80 route files with no `catch` of their own** — more routes
than the one just fixed. Q-142 was rewritten to that narrower scope rather than closed.

**And the leading hypothesis for the fault itself is probably wrong.** Grouping those 98 by the
second they landed in: **77 are a lone query failing while every other query in flight succeeded**,
12 in pairs, 4+5 in two bursts. Pool exhaustion fails everything competing for a connection at once
— that shape covers 21 of 98. An isolated failure fits a per-connection drop or
`statement_timeout: 15_000` better, which means Q-107's queued `getSyncDelta` batching fix may
address the smaller half. Now that the `code` capture has landed this is settleable by one
production `error_events` read rather than by argument: **read the codes before writing the batching
PR.** Recorded on Q-107; this also amends the `/api/sync/pull` row further down.

**🔴 The DB volume problem is re-accumulating faster than documented.** 205 MB post-REINDEX on
2026-07-21 → **421 MB on 2026-08-08** ≈ **12 MB/day**; `oura_raw_samples` is 73% of the database and
its row count **doubled in 18 days** (432,919 → 881,603). Q-46's guard stopped index *bloat*; the
console actions still queued under Q-30 reclaim bloat too. **At this rate the database alone returns
to the ~924 MB alarm level in roughly six weeks whether or not they run** — only D4
(drop-after-pull) or a retention policy changes the direction. Related doc correction: CLAUDE.md's
~3.2 MB/day for this table describes the **device-local** window and has been read as the server
rate, which is ~3× higher. Q-30 updated in place.

**Multi-user debt, now tracked (Q-144).** Three `TODO(tz)` markers (`adapter.ts:1051`, `:1109`,
`slices/oura.ts:1074`) acknowledge `DEFAULT_TZ` is assumed on read paths — with zero references in
the backlog or here, i.e. an orphaned finding. A user outside Brisbane silently gets Brisbane day
boundaries on windows feeding health aggregation. The "app is AEST-only in practice" premise in
those comments no longer holds. **Q-143 is now ✅ FIXED (2026-08-08)** — the clock-anchor full-table
read (17,045 seq scans / 45.3M tuples, latent but linear in a number that only grows) ran inside
`insertOuraRawSamples`, i.e. on **every ingest batch**, not just the rollup as the entry's title
said. It needed exactly three numbers, and now takes them from two single-row reads
(`getOuraClockEpochHead`, `getNewestOuraClockAnchorByUtc`) issued in parallel; cost is now flat in
anchor count. Equivalence with the reduce it replaced is pinned by
`lib/data/postgres/__tests__/oura-clock-anchor-scoping.test.ts`, verified to fail on a planted
regression that drops the epoch scoping. **Server-side only — not verified on device**; it is the
ring pipeline, so the ingest path deserves an on-device drain before it is called done.
**Q-145 is now ✅ FIXED (2026-08-08)** — errors from the 80 catch-less routes are attributed to a
user again, and the dedup key is user-scoped, so one user's fault no longer hides another's.
**The entry's blocking premise was wrong**: it recorded the fix as "not implementable" because
`onRequestError` is handed only `{ path, method }` — that was the repo's own narrowed local type
being read as if it were Next's. Next's `InstrumentationOnRequestError` passes
`{ path, method, headers }`, and the session cookie is in there. `userIdFromSessionCookie` decrypts
it with `AUTH_SECRET` via `next-auth/jwt`; every failure mode yields null and records exactly as
before, the id is UUID-shape checked, and the INSERT retries with `NULL` if it fails — `user_id`
carries an FK and a token can outlive the row it names, so attribution must never cost the error
report. Proven end-to-end against `pnpm dev`: anonymous → `(null)`, signed in → the seeded user's id,
both recorded 27 s apart with identical url+message (the dedup fix, demonstrated at the same time).
⚠️ **Not verified in production or on the APK**, and the FK-retry branch is reasoned rather than
exercised. Gotcha for the next person: **`instrumentation.ts` registers once at boot and does not
hot-reload** — a dev server started before the edit shows no attribution and looks like a bug.

**Shipped: four `Custom Rules` CI checks**, each verified to pass on the current tree and fail on a
planted violation — `check-migration-numbers.js` (duplicate migration numbers; also prints the next
free number), `check-timezone-rendering.js`, `check-date-param-regex.js`, `check-component-size.js`.
The last three carry **shrink-only** grandfather lists: each fails if a listed file is fixed but left
in the list, so the inventories cannot rot. They corrected two counts Q-130 held by hand — 12 files
call `toLocale*String` with no `timeZone` (not 3), and 11 carried a dash-only date regex (not 7).
**That design proved itself within the session:** Q-130 then shipped (#1148) and widened 7 of the
11, and the check failed the merge with *"these files no longer carry a dash-only date regex —
remove them from GRANDFATHERED"*, naming all seven. A hand-written list would have gone on claiming
eleven. Four remain, all of them ones Q-130 never knew about.

**Checked and clean, so it is not re-derived:** index coverage on every hot table is good; `users`
showing 895k sequential scans and 0 index scans is correct at a handful of rows, not a defect; the
BLE ingest path is properly bounded/coalesced/backgrounded with unbounded reads confined to two
admin diagnostics; rate-limit keys are all user-scoped; module-level server state is user-keyed.

**NOT done:** no `EXPLAIN ANALYZE` — the read-only `claude_ro` role reaches curated views, so query
plans are inferred from scan counters, not observed. No real second account was driven through the
app; the multi-user findings are static analysis. No device/emulator/browser, though nothing here
touches a device path.

### [nutrition][platform] Supplements pull-clobber guard + local schema v22 (Q-124, 2026-08-08, v1.270.7) — NOT verified on device · needs: android

`supplements` was the one offline write domain whose `applyDelta` arm could not gate on
`sync_status`, because the local table had no such column. Local migration **v22** adds
`sync_status` and `deleted_at` (with the matching `RECONCILE_COLUMNS` rows, which are the real
authority after a partial upgrade), `applyDelta` gained the `WHERE supplements.sync_status='synced'`
guard and a tombstone arm, local writes now mark rows `pending`, and the sync engine's confirm loop
flips them back via `markSupplementSynced`.

**Everything that actually matters here happens on device and none of it ran on one.** Native
SQLite does not run in this sandbox (`getLocalStore` returns null), so the v22 upgrade path, the
reconcile fallback if it partially applies, and the offline rename → pull → "did it survive?"
sequence are covered by unit tests and code review only. Local migrations have twice killed the
store outright (WAL pragma inside the upgrade transaction, non-idempotent `ADD COLUMN`), so this is
the exact change class that deserves the device check: install the APK, open the app, confirm
supplements still list, rename one offline, let it sync, confirm the rename survives the next pull.

Two things reduce (not remove) the risk: both statements are plain `ADD COLUMN` with no PRAGMA, and
`reconcileSchema()` carries both columns, so a partial v22 heals on the next open rather than
wedging.

Session journal: `docs/overview/entries/2026-08-08-supplements-sync-and-route-hygiene.md`.

### [app-shell] Day-detail screen behind the training calendar (Q-110, 2026-08-08, v1.270.0) — swipe NOT verified on device · needs: android

Tapping a calendar day now opens `/health/day?date=` — a dedicated screen with the day's sleep and
hypnogram, full body composition, derived scores and a whole-day HR trace, swipeable between days.
Verified against the dev server at 412×891 (renders, calendar tap routes correctly, empty day states,
all tap targets ≥48dp, no page errors).

**The device unknown is the swipe, and it is the one worth checking first.** `useDrag` sits on a
vertically-scrolling page; `touchAction: pan-y` should hand the vertical axis to the browser, but this
app has twice lost a session to gesture conflicts (pull-to-sync) and a mouse drag in Chromium is not a
thumb. Nothing else here is device-sensitive — no blur, filter or backdrop-filter, nothing anchored.

**Two known gaps, deliberate:** days never scored show "—" for readiness/activity (the screen reads
`oura_daily_derived` in one query rather than recomputing via `buildDayAudit`, whose ~13-query fan-out
is the shape Q-107 blames for pool exhaustion — if the gap is common, run the existing backfill rather
than making this screen expensive). The old `day-overlay-sheet.tsx` still exists and is still reachable
from other surfaces; retiring it is its own change.

Session journal: `docs/overview/entries/2026-08-08-day-detail-screen.md`.

### [app-shell][cardio][activity] Navless safe-area utility sweep (Q-118, 2026-08-07, v1.269.1) — NOT verified on device · needs: android

Found by the 2026-08-07 full-app review (§2.4): `activity-screen.tsx` renders `<RunActiveScreen/>`
or `<ActiveActivityScreen/>` from the same parent, same navless `/activity` page, same bottom
Pause/Finish action row — but `run-active-screen.tsx` already used the floored `pb-safe-action-lg`
while `active-activity-screen.tsx` used plain `pb-safe-action`, a divergence within the same
feature. `pb-safe-action` is `max(env, 0.75rem)`; under Capacitor edge-to-edge the inset *replaces*
the gap instead of adding to it — the documented on-device failure class `pb-safe-action-lg`
(`max(env + 2rem, 4rem)`) exists specifically to fix.

Swept all 6 flagged sites onto `pb-safe-action-lg`: `active-activity-screen.tsx`,
`fitness-tests/test-active.tsx` (×2), `guided-walk/walk-active.tsx`, `guided-walk/walk-config.tsx`,
`guided-walk/walk-summary.tsx`, `activity/done-activity-screen.tsx`. Pure Tailwind class swap, no
logic changes; both classes were confirmed to already exist as the correct floored variants in
`globals.css`.

**The web sandbox renders `env()` as 0, which is exactly the value this bug depends on** — the
class change is visible in a screenshot (extra bottom padding, no layout breakage confirmed on
`walk-config`'s "Start walk" button) but real Capacitor edge-to-edge inset behavior cannot be
exercised here at all. Needs the on-device smoke run
(`docs/device-smoke-checklist.md`) — specifically: Pause/Finish during a tracked activity, "End
test early" during a fitness test, and "End walk" during a guided walk, checked against the
gesture bar on the S25. Full detail:
[`docs/overview/history-2026-08-07.md`](docs/overview/history-2026-08-07.md).

### [app-shell] Cardio Hub entry card on the workout screen (2026-08-07, v1.269.0) — NOT verified on device · needs: browser

The workout screen's "Other Activity" row is now a card matching the session card's inset and
radius, tinted via `--accent-cyan`, naming its three destinations; the `/cardio` heading follows the
rename. Verified against the local dev server at 412×891 — renders, aligns, and navigates.

Low device risk by construction: no blur, filter or backdrop-filter, and the row is not
bottom-anchored, so neither the Samsung compositor bug nor the safe-area floor applies. The one
unexercised surface is Samsung WebView rendering of the `color-mix(in oklch, …)` gradient.

Session journal: `docs/overview/entries/2026-08-07-cardio-hub-entry-card.md`.
Design docs: `docs/design/2026-08-07-other-activity-mockups.html`, `…-cardio-hub-fullscreen.html`.

### [app-shell] Fourteen new home score-card styles (2026-08-07, v1.268.0) — NOT verified on device · needs: browser

The four home score buttons (Readiness / HR / Sleep / Activity) gained fourteen selectable looks on
top of the original five — More → Home widgets → Score Card Style. All nineteen render correctly in
Chromium at 412dp with no errors, and every tap target clears the 48dp floor (tightest: Pill at
89×52dp).

**Two carry real Samsung WebView risk and have not been checked on the S25:** `frosted` uses
`backdrop-filter: blur()`, and `duorail` stacks a low-opacity 58px glyph behind live content. Both
are the shape of CSS behind the known compositor bug that wipes sibling gradients in card grids —
Chrome renders them fine, which is exactly why this needs the APK. The other twelve use no blur,
filter, backdrop-filter or gradient at all and are low-risk by construction. Nothing here touches
safe-area (the row is not anchored), gestures, native plugins or an offline-first domain.

Session journal: `docs/overview/entries/2026-08-07-health-metrics-button-designs.md`.
Design galleries: `docs/design/2026-08-07-score-row-mockups*.html`.

Secondary, non-blocking: the picker is now a flat list of nineteen radio options, which wants
grouping or thumbnails rather than a longer list. Not scoped.

### [activity][devices][platform] ⚠️ Q-139 — ring-clock compression FIXED (v1.270.25), **not verified on device**

**Fixed 2026-08-08 in v1.270.25.** Owner decision: **fix forward, no backfill.** Kept here rather
than archived because the device check is still owed, which is what this section is for. Full
investigation, including the measurement traps that make it expensive to re-derive:
[`docs/handoff-2026-08-07-activity-ring-clock-compression.md`](docs/handoff-2026-08-07-activity-ring-clock-compression.md);
session journal `docs/overview/entries/2026-08-08-ring-clock-compression.md`.

**The slope was never the unknown** — the ring's counter ticks at exactly 100 ms/ds by construction,
only the offset is unobserved. `resolveDsToMs` now applies that fixed slope with one offset per
epoch, estimated as the **p10 of anchor lag**: an event cannot be received before it happened, so the
floor of the lag distribution is the honest offset and the tail is receive latency (p0→p10 spans
1.4 min against a 56.2 min full spread). That also makes the mapping monotonic in `ds`, which
interpolation could not promise.

- **Both halves shipped.** `resolveDsToMs` now applies the fixed 100 ms/ds slope with one offset per
  epoch (p10 of anchor lag), which is also monotonic in `ds`. And the sibling gap is closed —
  `mergeStepCounterWithLive` gates **model** windows through `isPlausibleStepWindow`, not just live
  ones (verified in `packages/shared/src/health/step-estimate.ts:176`, whose comment names Q-139).
- **⚠️ What is still owed: the on-device check only.** The consequence shows after the next real
  history drain. Nothing else is outstanding — no code work, no owner decision.
- **Stored history was deliberately not rewritten**, so ~35 days before the deploy read
  inconsistently with everything after. Blast radius is steps + the admin console; sleep and HR use a
  different converter (`measuredAtMs`) and are untouched.

*Rewritten 2026-08-18 (Q-553): this row previously read `🔴 … (found 2026-08-07, OPEN)` and carried
69 lines describing the bug as unfixed, while an `✅ fixed` entry for the same issue already sat in
the resolved archive. Every session's orientation read had shown a red open issue for a bug fixed ten
days earlier.*
### [platform][app-shell] Full-app deep review, 2026-08-07 — 53 findings, ALL QUEUED (nothing fixed)

A whole-app review of saving, caching, performance and domain logic across all **201 API routes** and
**40 pages** — the first comparable sweep since 2026-07-20, roughly 400 commits earlier. Eight code
lenses run in parallel, plus two production passes (`error_events`, and **91 days** of
`/api/admin/day-review`). Full writeup, including the coverage ledger and every clean result:
[`docs/reviews/2026-08-07-full-app-review.md`](docs/reviews/2026-08-07-full-app-review.md).

**Nothing was fixed in that PR — it is docs-only.** Findings landed as **Q-117 … Q-138** plus updates
to three existing entries. The four highest-value outcomes:

1. **Q-73's root cause was found and reproduced** — the home-screen React #418 hydration error (138
   hits, still firing) is `session-select-content.tsx:1063`: `toLocaleDateString` with no `timeZone`.
   Railway runs UTC, the S25 runs Brisbane, so for the 42% of each day between 00:00 and 10:00 AEST
   the server renders yesterday's date. **That entry was marked ⛔ "needs a device capture" — it does
   not.** See the correction below.
2. **The `Failed query` faults are one fault, and it is app-wide.** `getSyncDelta` fires **22**
   parallel queries at a `max: 10` pool. It is not sync-specific — `/api/readiness-score` and
   `/api/body-battery` share the signature, which means the "⚠️ cause NOT diagnosed" row for those two
   routes and Q-107 are **the same issue**. It stayed undiagnosed because `lib/observability.ts:9-10`
   discards `err.cause`, where Drizzle puts the real Postgres error.
3. **Two of the four headline scores carry much less information than they appear to.** Measured over
   91 days: the Activity Score is effectively a step counter (r=0.775; `strengthFreq`, its largest
   weight, has been exactly 100 on **91/91 days**), and the Sleep Score's compression traces to four
   saturated contributors. Both are ⛔ owner decisions — Q-137 and the Q-72 update.
4. **A cross-user data leak** (Q-129) and **an activity date filed in the device's timezone rather
   than the user's** (Q-123c) — the latter is persisted data, so it cannot be corrected after the fact.

**Two corrections to previously-recorded claims, both of which had cost real time:**
- **Q-73 and its Known-Issues row state that `/` mounts all five tabs**, so a mismatch in any tab
  surfaces there. **That is false.** `components/shell/tab-shell.tsx:57-61` initialises
  `mounted: [initialTab]`; the rest mount on first activation, which is client-only and cannot
  hydrate. The search space was always the home tab alone — and that wrong premise is what produced
  two dead-end investigations.
- **SEC-H2 is fixed.** A sweep re-reported that `app/api/oura/webhooks` echoes the HMAC signing key
  (from the 2026-07-06 review). It does not — the route returns `{success: true}` and carries an
  explicit comment forbidding it. The claim was dropped rather than passed on. Do not re-raise it.

**Also worth knowing (clean results, so they are not re-audited):** zero persisted-vs-recomputed score
divergence across 88 pillar-days · auth solid (only 6 of 201 routes unauthenticated, all deliberate;
all 25 admin routes re-read the DB) · zero `JSON.parse` of model text · poison-pill handling correct ·
`RECONCILE_TABLES` machine-checked with zero mismatches · instant-paint genuinely done · **the
2026-07-20 Zustand hot-path finding is fixed** · every safe-area utility exists and is the correct
variant · referential integrity clean · `onset_latency_sec` genuinely fixed (100% → 23% null).

**⚠️ Not verified:** no device, emulator or browser was used. Q-118's on-device magnitude, Q-119's
contrast ratios (reasoned from OKLCH, not measured), Samsung WebView rendering and native SQLite paths
were all unexercised. The dead-route ledger is static analysis.

**Open question for the owner, recorded rather than guessed:** `supplement_logs` (1 row ever, none
since 2026-06-21), `food_logs` (none since 2026-07-26), `step_live_windows` (2026-07-28) and
`oura_accel_chunks` (2026-07-15) have all gone quiet in production. Q-124 gives a plausible mechanism
for the supplements case; the rest need the owner to separate "stopped logging" from "broken".

### [platform][devices] 🟠 Voice logging is broken on the device right now — the APK carrying it was never installed (found 2026-08-07)

`"SpeechRecognition" plugin is not implemented on android` fired three times in production,
2026-08-05 and 2026-08-06, from `/workout`. That is direct evidence that the APK carrying v1.258.0's
native-STT rebuild has **not** been installed on the S25 — the JS half shipped via Railway and is
calling a native plugin that isn't there.

**Still live — re-checked 2026-08-19, and the count was three times what this row claimed:** not 4
but **12**, latest **2026-08-18 23:41 UTC**, the day before the check. Two weeks on, the owner is
still reaching for voice logging and still getting nothing.

**The message changed spelling on 2026-08-17**, which strengthens rather than weakens the diagnosis:
10 reads `"SpeechRecognition" plugin is not implemented` (08-05 → 08-16), the last 2 read
`"SpeechRecognition.then()"` (08-17 → 08-18). The JS half moved again — the call is now awaited —
into a device that still cannot run it. Only installing the `apk-latest` release fixes this, and that
is the owner's action; until then further JS work here is invisible on the device.

**Both counts above are floors** — `error_events` prunes at 30 days and the `claude_ro` view is
row-scoped to one user. That lesson is now a standing rule in `CLAUDE.md`'s session-start ritual
rather than a paragraph inside one device issue, which is where it belongs.

Within that scope, the only other events in 24 hours were one `/api/body-battery` + one
`/api/readiness-score` `Failed query` in **the same second** (2026-08-08 03:26:19) — one transient DB
blip hitting two concurrent queries, not two faults.

**DB health checked in the same pass and is sound.** `oura_raw_samples` is 311 MB growing steadily at
~24k rows / ~570 kB of `body_hex` per day with no acceleration; autovacuum is current and dead tuples
are zero on the two largest tables. One observation short of a finding: `oura_raw_samples` has
autoanalyzed **once**, with ~36k modifications since — the default threshold
(`50 + 0.1 × n_live_tup` ≈ 90k rows) means statistics refresh only about every 3.7 days at the current
ingest rate, so planner stats on its time columns lag by days. **Whether that actually produces a bad
plan was not measured** — no `EXPLAIN` was run, so this is a lead, not a diagnosis.

This makes three ⚠️ rows concrete rather than merely unverified: the voice-logging rebuild
(v1.258.0), the ring + strap notification quieting (v1.259.0), and the scale notification quieting
(v1.257.3) all say "needs the new APK". **This is owner action, not a code fix** — the APK is already
built and published by CI at
`https://github.com/nekodas-neko/TrainingAI/releases/download/apk-latest/app-debug.apk`.

Related and worth doing in the same pass: **90 rows in this file carry a NOT-verified-on-device
marker**. They have accumulated to the point where no one can act on them individually. Installing the
current APK and running `docs/device-smoke-checklist.md` once would clear a large batch of them at
one go.


### [cardio] Running-plan override local-write fix (Q-98 bug-fix half, 2026-08-06, v1.267.7) — NOT verified on device · needs: browser

Fixes a real APK-only bug: `applyOverride` (swipe-to-pick-a-different-run-type after skipping
today's run) only did a bare `fetch`, unlike `markRun` which writes through the local SQLite store
+ outbox. On a device with a real local store, this let the screen's local-first status effect
re-read the stale `'skipped'` row `markRun` left behind and clobber the optimistic `'pending'`
reset back to skipped — permanently defeating the swipe-to-reset-status path, which read to the
owner as "I picked a different run, nothing happened." Invisible on web
(`getLocalStore()` returns `null` there), which is why the bug survived past `pnpm dev` testing.

Fixed by writing the override's server response through `store.upsertPrescribedRun(...)` as
`synced`. **The failing path is structurally unreachable in this sandbox** (no native SQLite here)
— only the unaffected web path was verified (regression-free, since this change's new code never
runs on web). Needs a real on-device swipe-to-pick-a-different-run-type check, after a skip, before
this can be marked confirmed. Full detail:
[`docs/overview/history-2026-08-04.md`](docs/overview/history-2026-08-04.md).

### [sleep] ✅ Sleep analysis counts nights, not rows (Q-76, 2026-08-05, v1.261.0) — two nights still unrecoverable

Eleven read sites called `listSleepSessions` and treated each row as a night. Production stores
**66 rows for 54 nights**: twelve are daytime/evening bouts, and one real night (2026-05-29) arrived
as two rows either side of a wake-up. Measured against the production table, **7 of the 54 dates fed
the wrong sleep duration into the sleep-vs-performance correlation**, six of them by roughly eight
hours — 2026-07-04 was read as **0.11 h instead of 8.22 h** because a `Map` keyed on date let the
nap overwrite the night. The 29 May night read as 4.02 h instead of 6.55 h.

`nightSessions()` (`packages/shared/src/health/sleep-night.ts`) already did both halves of this —
circadian nap/night classification, then gap-merge — so **the `isAnalysableNight()` predicate the
backlog entry proposed was deliberately not built**; a second rule beside the existing one is the
"One Formula, One Place" failure this codebase keeps paying for. The eleven sites now route through
it: sleep-performance-correlation, health-trends `meal-timing`, progress-summary, bedtime-estimate,
ai/health-insight, nutrition-goals/recommend, ai-chat, both ai-chat recovery tools,
`sleepDurationTrend`, and the running plan's short-sleep gate. Four read sites were left on raw rows
**on purpose** and say so in comments — the day timeline, the sleep list, `oura/hr-day`, and the two
daytime-HRV sleep-exclusion windows all want naps included.

`sleepDurationTrend` also stopped counting a duration-less row as **0 hours** — legacy parity that
manufactured exactly the sleep deficit the ratio exists to detect, and the input to the AI-dynamic
0.85 low-sleep gate.

**Still broken, and no read-time rule can fix it:** 2026-06-01 (1.45 h) and 2026-06-04 (3.83 h) are
the only rows on their dates — the rest of each night was never stored. **2026-06-02 and 2026-06-03
have no sleep row at all.** Both need a redecode/backfill from `oura_raw_samples` or the gap stands.

**Not exercised:** the local seed's sleep rows have `sleep_start == sleep_end` and no naps, so the
dev-server pass proved the routes still return 200 with byte-identical payloads (a genuine
no-regression result) and **not** that the nap filtering fires — that was measured separately by
running the real production rows through the helper. Nothing here is device-dependent (no native,
safe-area, gesture or notification surface), so the APK inherits it on the next Railway deploy.

### [heart-rate][devices] 🟠 Health tab's "Live HR" card shows a live reading without the owner tapping "Measure now" — likely tied to reported ~15%/night ring drain (found 2026-08-06, root cause NOT pinned down)

Owner noticed the Health screen's "Live HR" card reading a fresh bpm value despite never tapping
"Measure now," and suspects this is why their ring loses ~15% battery overnight. Traced the
mechanism, but this needs on-device evidence before a fix can be scoped — recorded as an open
investigation, not a confirmed root cause.

**Structurally confirmed**: `MeasureHrNow` (`components/health/measure-hr-now.tsx`) renders
`useLiveHr()`'s `bpm` unconditionally — it does not gate display on whether *this component*
started the stream. `useLiveHr()` (`lib/live-hr/use-live-hr.ts`) is explicitly documented as
"read-only... does NOT start/stop the manager" — it just subscribes to the app-wide `LiveHrManager`
singleton (`lib/live-hr/manager.ts`). So the card showing a live, non-stale reading (opacity-normal,
meaning the sample is under 8s old — a genuinely active stream, not a stale leftover) means
*something else in the app* currently has the manager's workout-grade live path engaged. This is
the correct symptom to chase for a real leak, but on its own doesn't say what's causing it.

**Design intent confirms this shouldn't happen from ring drain alone**: the ring is deliberately
**workout-only**, never ambient (`manager.ts:14-18,89-92`) — explicit comment: "keeps the ring's
battery-costly burst loop from running 24/7." Only the chest strap (if paired) runs in ambient
(all-day) mode by design. So a live ring reading outside an actual workout is a real deviation from
intended behavior, not a documented ambient feature — worth chasing, not dismissing.

**Leak vectors worth checking, most-likely first, none confirmed yet**:
1. A stale/abandoned workout sitting in `store.mode === 'active'` in the persisted Zustand store
   (workout state deliberately survives a refresh, per this file's own Known Issues) — `workout-screen.tsx`'s
   `useEffect` calls `mgr.start()` whenever `liveHrRun` (`mode === 'active' || 'exercise-summary'`)
   is true, with `mgr.stop()` only in the effect's cleanup. A workout left active without ever being
   properly finished/left would keep this engaged indefinitely.
2. The native BLE foreground service surviving an app crash/force-kill without ever receiving the
   JS-side stop call — Android foreground services are independent of the JS/React lifecycle, so a
   killed app mid-workout could leave the ring's native burst loop running all night with nothing on
   the JS side left to tell it to stop.
3. Lower likelihood, worth ruling out: a debug console (`components/oura-ble/live-hr-test-console.tsx`)
   left running — admin-only surface, so unlikely for normal use, but has its own start/stop pairing
   worth double-checking against this same class of leak.

**Not yet fixed — needs on-device diagnostics before a fix is scoped.** Check
`getLiveHrManager().getDiagnostics()`/the ring source's connection state during a period of reported
drain, and check whether the workout store's persisted `mode` was stuck at `'active'` overnight,
before committing to one of the leak vectors above. Backlog entry: **Q-116**
(`docs/implementation-backlog.md`).

### [workouts] 🟢 Manual "Deload" choice on Home had NO effect on prescribed weights/reps for any AI-dynamic session with an active prescription (found 2026-08-06, fixed 2026-08-07)

Owner picked "Deload" from Home's three-way Full/Deload/Rest card before a Legs session; the
resulting pre-workout screen showed the same "AI Prescription · Intensification" numbers as a
normal Full session, with no visible deload treatment.

**Root cause, confirmed real, not a display-only gap:** `handleDeload`
(`session-select-content.tsx:929-932`) routes to `/workout?session=<id>&aiDeload=1`. Server-side,
`aiDeload=1` reached `app/api/workout-data/route.ts:359-378`, which set
`sessionPhaseStatus.isDeloadActive = true` — but that flag only reached the actual prescribed load
through `deloadAwareStylePhase()` (`packages/shared/src/phase-engine.ts:125-134`), a mechanism that
swaps in a lighter phase style and **only applied to the static-progression-style path**. The moment
`aiDrivesLoad` was true — i.e. an AI-dynamic prescription actively driving load, the normal state for
this program — `buildWorkoutExercises` (`packages/shared/src/workout/session-data.ts`) unconditionally
applied `prescriptionStyleForExercise(p)` from the already-generated prescription, with no reference
to `aiDeload` at all. The only per-exercise reduction that could appear was `p.deloaded`, a flag baked
into the prescription **at generation time** by the AI-dynamic engine's own independent, automatic
emergency/per-exercise deload detection — a completely different mechanism from the user manually
asking for a lighter session today.

**Fixed:** `buildWorkoutExercises` now applies `deloadOverrideForGoal(trainingGoal)` — the same
tuned `DELOAD_LOWER_PCT`/`DELOAD_REPS`/`DELOAD_SETS`/`DELOAD_REST` constants the automatic engine
already uses — in a new `else if (aiDeload)` branch, skipped when the exercise was already deloaded
by the automatic engine so the two reductions don't compound. `preDeloadStyle`/`preDeloadSets` are
populated from the pre-deload numbers so the existing revert-to-full-weights UI
(`DeloadInfoSheet`) works for a manual deload too. Setting `deloaded = true` on the returned
`WorkoutExercise` automatically extends the existing `exerciseDeloaded` payload flag and this
session's earlier 1RM-inflation fix (below) to also exclude manually-deloaded sets from PR/1RM
credit, with no additional server-side wiring. Verified via a direct unit test against the pure
`buildWorkoutExercises` function (the local seed program is `phase_mode='manual'`, not `ai_dynamic`,
so a live API/UI verification of this specific path wasn't possible this session — **not
device/live-API verified**, unit-test-verified only).

**Separately, owner-requested UX change — ✅ SHIPPED 2026-08-08 (Q-109-followup, v1.270.28):** the
Full/Deload/Rest choice moved off Home (now Rest/Full only) onto the pre-workout screen, beside the
Quick/Normal/Long duration picker, so choosing Deload happens at the point that actually determines
the session.

### [sleep][devices][platform] 🟠 A sleep session can get stuck on a stale, narrower window with no self-heal (Q-225, found 2026-08-13/14)

Owner reported the previous night's displayed bedtime (1:15am) looked far too late. Not the
anchor-lag bug (Q-71/Q-139, ≤3 min correction) — a 2h35min gap, so traced separately. **Confirmed by
full local reproduction, not inference**: pulled all of that night's real raw samples (11,208 rows)
and clock anchors from production, loaded them into the local dev DB under a throwaway user, and ran
the actual `aggregateOuraRawSamples` function directly against them (both `fullHistory: true` and a
bare incremental call). Both produced the same correct answer — sleep 22:40pm→8:05am (8.5h), onset
10 min, with the neural stager correctly flagging a brief overheating-driven wake bout around
00:50am as `awake` rather than delaying the start — exactly matching the owner's account ("asleep,
woke here and there from overheating"). The live stored row does not match this and fails every
check run against it (no >2h raw-data gap, no bedtime-event override, no stale-decoded-JSONB issue).
Leading theory (not confirmed): the DB-pool-contention pattern amended into the `[platform]` Q-107
row above — the timing correlates, though the causal link isn't proven. **Verified fix**: an admin
Redecode (`fullHistory: true`) deletes the stale row (keyed by wake-day, not `oura_id`) and inserts
the correct one — confirmed by running that exact code path locally. Backlog: **Q-225**
(`docs/implementation-backlog.md`), which also has a reusable local-repro harness for checking
whether other recent nights hit the same bug during the same error bursts.

### [heart-rate][workouts] ✅ Per-set HR now records which device measured it (2026-08-05, v1.260.0)

From the null-rate sweep — the follow-up the gap sweep named as its own blind spot. **847 columns
across 69 tables**, one `count(col)` each: **49 are 100% null in a table that has rows.** Most were
classified out (optional inputs, tombstones, frozen Cloud columns, and columns whose *input* is null
rather than whose producer is missing — each checked against its writer). Two survived:
`oura_daily_derived`'s ten always-null columns, which is the queued **Q-7b** confirmed and its count
corrected from eight; and **`set_hr_stats.source`** — declared in migration 139, never written,
never read, across 582 rows.

`source` now records `chest_strap` / `oura_ble` / `mixed` per set. The data was always there —
`getHrForWindow` selects it and the workout-level summary already used it; it just never reached the
per-set rows. Reads the **working-set window only**, not the rest that follows (that is where the
ring takes over if a strap comes off, and attributing it to the set would be wrong), and stays
**null rather than `'unknown'`**.

Why it matters: *"were those sets ring-only?"* is the first question asked of suspect per-set HR, and
it is exactly what the still-open half of **Q-11** needs to answer about the sessions with zero
attribution. Existing rows fill in via **Admin → Tools → "Backfill per-set HR stats"**.

Seven tests — five on the derivation, two DB round-trips. The round-trip pair earns its place:
`workout_hr_stats` failed at exactly that seam, computed correctly and rejected by the column, while
its unit tests passed.

### [platform] ✅ The rollup tests weren't flaky, they were slower than the limit (2026-08-05, v1.260.1)

CLAUDE.md carried a standing instruction to re-run DB tests alone before believing a red CI, blamed
on connection-pool oversubscription. **That explanation was plausible and never measured.**

Timed alone with zero contention, every file running a full `aggregateOuraRawSamples` pass takes
**3.4 s to 14.6 s** against vitest's **5000 ms** default — `oura-ble-sleep-bedtime-fragment` at
14.55 s, `sleep-fallback` 9.42 s, `staging-rollup` 6.51 s. Three sat within 20% of the limit before
any parallel load. The suite was flaky by construction and the documented workaround was to
disbelieve it — which cost **four false alarms in one session**.

**The v1.259.1 daytime-HRV refit was the obvious suspect and was measured out** — stubbed, the same
files take 5.50 s and 6.11 s vs 6.04 s and 5.86 s. Indistinguishable.

Fixed with a separate `rollup` vitest project at a 60 s timeout; the other ~380 files stay at 5 s so
a genuine hang still fails fast. **Not** a raised global timeout — that would hide real hangs
everywhere, which is the opposite of the point. Full suite now 397 files / 3,136 tests, exit 0, same
file count as before the split.

The CLAUDE.md rule is narrowed rather than deleted: genuine pool exhaustion is still possible and
has a **different signature** (a connection-acquisition failure, not a 5 s timeout), and the
operative line is inverted — a rollup test that times out now is worth believing. **Keep the glob in
step with `grep -rl aggregateOuraRawSamples lib/data/postgres/__tests__/`**; a new rollup test
outside it inherits the 5 s default and becomes the next false alarm.
### [platform] ✅ The audit view was lying — `program_phases` scoped on a column nothing sets (2026-08-05, v1.259.2, migration 167)

The gap sweep reported *"eight phase sets contain no phases"*. **That was the tool, not the data.**
`claude_ro.program_phases` scoped through `program_id`, which is nullable (migration 024 is named
for making it so) and which the modern write path never sets — `createPhaseSet`, `updatePhaseSet`
and the 042 seed all insert with only `phase_set_id`. Measured locally: **573 phases, 0 with
`program_id`, 573 with `phase_set_id`** — the old predicate could return zero rows for any user,
ever.

Fixed by scoping through `phase_sets`, keeping the `program_id` arm for legacy rows, regenerated
into migration **167** (never edit an applied migration — `ensureSchema` tracks by filename). A
DB-backed test pins the scoping and asserts the OR arm doesn't leak across users.

**The lesson is about the tool.** An audit view filtering on the wrong column doesn't fail, it lies
consistently, and every conclusion drawn through it inherits the lie. Treat a zero that no code path
explains as a claim about the *view* until proven otherwise.

Regenerating also picked up **`prescribed_runs.segments` and `exercise_library.merged_into`** —
columns added by migrations 163–166 without re-running the generator, and therefore unreadable under
the default-deny schema. Four migrations had missed that step.

### [readiness][devices] ✅ Q-81 — a query filtered on a column nothing has ever written (2026-08-05, v1.259.1)

The sweep guessed the daytime-HRV model was failing downstream, in the extractor or the fit.
**Wrong — execution never got there.** `getOuraRawSamplesForTags` filtered on `decoded IS NOT NULL`,
and that column is NULL on **all 812,816 rows across all 30 tags**. `body_hex` is the archival
source of truth and every other consumer decodes on the fly; this function was the odd one out, so
it returned an empty array to every caller, always.

**Two victims, one already on the record:** `oura_daytime_hrv_model` empty since the feature shipped
(Body Battery's D5 input permanently absent), and `/api/oura-ble/device-metrics` returning
`{"days": []}` — which the 2026-08-05 navigation entry had recorded as unexplained. Same cause.

Fixed by decoding from `body_hex`, matching the three existing sites in the same file. **Two further
finds while fixing it:** the caller asked for a 60-day window and was being silently clamped to 31
(now an exported constant, so the lie is gone), and the refit's throttle only applied *once a model
existed* — so with an empty table it ran on every rollup, which was free at zero rows and would have
become a ~43k-row / 503 KB read on **every ingest drain** after this fix. Now throttled on attempt.
That was a regression this fix would have introduced, caught by asking what the change costs on the
path it runs on. Both silent bails now report into `stepErrors`.

**Verified:** a DB-backed test drives real production hex through the real repository function to a
model that actually fits (60 rows → 150 samples → finite coefficients); reverting the one-line
filter reproduces the production numbers exactly (0 rows, 0 samples).

**⚠️ Not verified — whether it fits on the owner's real data.** The test proves the chain, not that
31 days of the owner's nights clear `MIN_TRAINING_SAMPLES = 50` with enough variance for a
non-singular system. The refit runs inside the ingest rollup, so this resolves on the next drain.
**Worth re-checking after a day:** `oura_daytime_hrv_model` should have a row, and device-metrics
should stop returning `{"days": []}`. If it still refuses, the new `stepErrors` message names which
reason — which it never did before.

### [platform][devices] ⚠️ Ring + strap notifications quieted with a low-battery exception — needs the new APK (2026-08-05, v1.259.0)

Answers Q-67's open sibling question. The owner's answer improved on it: quiet the ring and strap
ongoing notifications like the scale's, **but surface the battery once it drops below ~35%**.

Two channels, because a `NotificationChannel`'s importance is fixed at creation and cannot be raised
for one notification: the ongoing status channel drops to `IMPORTANCE_MIN` (ids bumped to
`oura-ble-v2` / `polar-ble-v2`, legacy deleted — Android will not retroactively lower an existing
channel), and a separate one-shot `IMPORTANCE_DEFAULT` alert fires on the downward crossing.

**Hysteresis is the feature.** The ring polls every 5 minutes, so a naive threshold check would post
**288 notifications a day**. `DeviceBatteryNotifier.decide` fires once on the way down and re-arms
only above **40%**, not 35 — a single threshold would let a boundary reading alternate and notify
every other poll. Charging both suppresses and clears. Eight JUnit cases including a simulated
day of polls asserting exactly one alert.

**Not verified — native, no APK in-session.** CI compiles the Kotlin and runs the JUnit tests, and
the hysteresis was re-derived independently, but none of that shows how One UI renders
`IMPORTANCE_MIN` (it has differed from stock AOSP before). **On device:** confirm both ongoing
notifications lose their status-bar icons; confirm the low-battery alert fires once when a device is
genuinely under 35% and **does not repeat five minutes later** — that one needs a full day's
watching. Thresholds are named constants, one-line changes if 35/40 turn out wrong.

### [workouts][platform] ⚠️ Voice logging rebuilt on native STT — needs the new APK, unverified until then (2026-08-05, v1.258.0)

Q-64. Two stacked causes, both hit before any speech could be recognised: `RECORD_AUDIO` was never
declared in the manifest (Android silently fails a runtime request for an undeclared permission, so
the WebView's `AUDIO_CAPTURE` request was denied and `onerror` fired in the same tick — the
"turns off instantly" symptom), and an embedded WebView has no speech recognition service anyway, so
declaring it alone would not have produced transcripts.

Now: manifest `RECORD_AUDIO` + an Android 11+ `<queries>` intent for `RecognitionService` (without
it, package-visibility hides the recogniser and `SpeechRecognizer` reports unavailable), and
`@capacitor-community/speech-recognition@7.0.1` wrapping Android's own recogniser. Its peer range is
`>=7.0.0` against our `@capacitor/core ^8.3.4`, so the plan's "Capacitor 8 compatibility TBD" is
resolved. Failure states are now visible instead of silent. The web path is unchanged and stays
logic-free.

**Verified:** the web path in a browser against `pnpm dev` (button renders, no crash, no regression)
and six new `parseVoice` tests. **NOT verified — and it is the actual fix:** whether the recogniser
produces a usable transcript on the S25. No microphone, no Android runtime, plugin resolves to null
off-device.

**On-device:** tap Voice mid-set, grant the prompt, say "eighty kilos five reps", confirm the dial
and reps update; tap again without re-granting; then deny once and confirm it says "Microphone
permission denied" rather than going quiet. **Needs the new APK** (CI builds it; `apk-latest`).

### [platform][devices] ⚠️ Scale notification quieted — needs the new APK, and the sibling services are still loud (2026-08-05, v1.257.3)

Q-67: the scale's ongoing "Connected — listening for weigh-ins" channel dropped
`IMPORTANCE_LOW` → `IMPORTANCE_MIN` (no status-bar icon, collapsed to the bottom of the shade). The
channel id had to change to `scale-ble-v2` — `NotificationChannel` is immutable once created and
Android will not retroactively lower an existing channel, so an upgraded install would otherwise
keep the old one and see no change. The legacy id is deleted on first run. The four one-shot event
channels are untouched.

**Native — a new APK is required** (CI builds it; `apk-latest` after merge). Compile-gated only in
the sandbox, so nothing here is observed working. On-device: check the ongoing notification loses
its status-bar icon (One UI's `IMPORTANCE_MIN` treatment can differ from stock AOSP), that
"Weigh-in logged" still shows normally, and that the scale still connects and logs.

**⚑ Owner question, unanswered on purpose:** the Oura ring and chest-strap services show the same
persistent "Connected" notification, and the plan said not to change them without asking. This
matters more since v1.257.0 — the strap auto-retry restarts the strap's foreground service roughly
every 4 minutes while the app is foregrounded and the strap is off, so "Connecting to strap…" now
cycles rather than sitting still. Quieting that channel the same way is the obvious follow-up if
wanted; the ring's "Connected · 37% battery" line may be genuinely useful.

### [workouts] ⚠️ PiP rest countdown (Q-65) is not device-verified — and structurally cannot be here (2026-08-05, v1.257.1) · needs: android

The exercise-summary PiP branch was a static "Done / tap Next" card that never read
`lastSetRestStartMs`, so backgrounding into PiP during the last set's rest lost the countdown. It
now routes through the same `PipView` the active branch uses, with the identical inputs
`LastSetRestTimer` subscribes to.

**Unverifiable in the sandbox by construction:** `usePipMode()` flips on a `pipModeChanged` window
event, and `grep -rn pipModeChanged` finds exactly one dispatcher —
`android/app/src/main/java/com/trainingai/app/MainActivity.java:578`. No web path sets it, so no
amount of browser driving reaches this branch. Verified by reading, not running.

**On-device check:** log the last set of an exercise to land on the summary screen with the rest
ring counting, then background into PiP. Expect the countdown ring (filling → red `+overtime`),
not "Done / tap Next". **JS-only — ships with the Railway deploy, no APK.**

**Related sandbox limitation, unexplained:** a set cannot currently be logged through `pnpm dev` in
a headless browser — the Log Set button is enabled and clicks without error, but the label never
advances and no `/api/log-exercise` request fires. Not chased to root cause and most likely a
sandbox artefact (the owner logs sets on device daily), but it means the workout-logging path is
not drivable end-to-end in the browser harness.

### [app-shell][devices] ⚠️ Strap auto-reconnect is NOT device-verified (2026-08-05, v1.257.0) · needs: hardware

Two owner-reported faults were fixed in one PR. The first is verified; the second is not.

**Verified — the More tab never refreshed.** All five tabs stay permanently mounted
(`components/shell/tab-shell.tsx`), so a `useEffect(…, [])` fetch runs once per app launch. The
persistent-tab-shell plan wired `epoch` through Home, Health, Workout and Nutrition — and never
covered More, so an app restart was the only way to update profile, stats, season badges, the
friends feed and leaderboard, ring battery/last-sync, outbox health, the update card, and the
scale/strap pairing rows. Fixed with a shared `useRefreshOnTabShow()` hook in
`components/shell/tab-visibility.tsx`. **Confirmed in a real browser** (headless Chromium against
`pnpm dev`, 412×915): first show fetched nothing (module cache warm, correct), and both re-shows
re-fetched `/api/user/profile`, `/api/seasons`, `/api/friends`, `/api/friends/feed` and
`/api/oura/token`. No page errors.

**NOT verified — the strap gave up and never retried.** Both strap paths stop trying by design:
the native foreground service after its ~4 min backoff ladder (`PolarStrapService.kt`,
`MAX_CONSECUTIVE_FAILURES = 6`, then `stopSelf()`), and the WebView fallback after
`RECONNECT_DELAYS_MS` (~17 s). The service's own comment says *"JS restarts it on the next app
open"* — nothing did, because `startAmbient()` is guarded by `if (ambientWanted) return` and
`LiveHrAmbientProvider` mounts once. So a strap put on after launch stayed disconnected until an
app restart, which is exactly what the owner hit. Fixed by adding `retry()` to the source contract
and `retryAmbient()` to the manager, driven by a 60 s foreground tick +
`visibilitychange` + the More tab re-show + a workout starting.

**Why it is unverified:** every path is BLE and native. The sandbox has no Bluetooth, no Polar H10,
and `getPolarBle()` returns null off-device, so the fallback path is the only one that could even
execute here and it has no radio either. Unit tests cover the manager's decision logic (7 cases in
`lib/live-hr/__tests__/manager.test.ts`) — they prove `retryAmbient` calls `retry()` on ambient
sources only, never wakes the ring, is inert unpaired, survives a throwing source, and does not
re-reconcile once started. They prove nothing about whether the H10 actually reconnects.

**What would confirm it, on the S25:** open the app with the strap off and the More → Workout tab
showing the strap card; leave it 5+ minutes so the native service exhausts its ladder and stops;
then put the strap on and watch the card **without restarting the app**. It should flip to
connected within ~60 s. Also worth checking the battery cost of the foreground tick over a day with
the strap deliberately off — the tick is a no-op while connected, but while disconnected it
restarts the service's ladder roughly continuously.

**Note this is a JS-only change** — no APK rebuild needed, it ships with the Railway deploy.

### [app-shell] ⚠️ Navigation speed has never been measured — and that is why Q-1b got closed on the wrong evidence (2026-08-04)

The owner reported navigation feeling not-quite-swift, and clarified it was **not** cold start.
Cold start *was* measured (472 ms, Q-51 Task 3) and is fine. **Navigation has not been measured at
all**, and Q-1b (bundle the shell) was closed against the cold-start number — which does not cover
the question actually being asked. The drop still looks right on cost, but it rests on evidence
about a different thing; say so rather than treating it as settled.

Two behaviours are being conflated and only one is fast:
- **The five bottom tabs** stay mounted; switching flips visibility, no network. Confirmed instant.
- **Everything else** is a real route navigation fetching an RSC payload from Railway. `<Link>`
  prefetches automatically; a **`router.push` from a button does not** (#919) — and most of this app
  navigates by button.

**Shipped:** the four targets that had no prefetch — `done-screen` → `/session-select`,
`done-activity-screen` → `/workout-select`, `workout-select` → `/cardio`, `running-plan` →
`/cardio`. **Effect unverified**: prefetch is client-side and cannot be observed from `pnpm dev` or
a test, only on the phone.

**Left deliberately undone (Q-70):** `session-select` prefetches only the *recommended* session, so
tapping any other one is cold — the app's most-used navigation. The code carries a documented reason
(*"N payload fetches to serve one tap"*), and overturning it needs a measurement. The approach that
avoids the trade is prefetch-on-`onPointerDown`, which covers every session at zero waste.

**A correction worth carrying:** I first reported "42 push sites, ~5 prefetched, ~35 cold
navigations". Counting per file rather than in aggregate, the sweep had **largely already been
done** — the real gap was four. Second time in one session a quoted number did not survive checking.

**Update (v1.255.0) — the instrument now exists; the measurement is still owed.** Rather than carry
this argument into another session, navigation is now measured on the device: every tap that changes
the URL records `urlMs` / `paintMs` / `settleMs` and, critically, **`rscCount` — 0 means the route
was already warm**, which turns "did the prefetch work?" into a per-navigation boolean. Read it in
**More → Admin → Device data capture** (`Reset nav timings` → use the app → `Run all` → Copy).
Verified working end-to-end in a real Chromium against `pnpm dev` — including the query-only
`/workout` → `/workout?session=…` transition, which recorded a cold 243 ms payload fetch and which a
`usePathname` hook would have missed entirely. **What is still not measured is the phone**; until
the owner runs a capture, both the prefetch sweep's effect and the Q-1b bundling drop remain
supported by no navigation evidence. One field, `settleMs`, has never been observed diverging from
`urlMs` (nothing local was slow enough to have a settling phase) — see the journal entry.


### [app-shell] ⚠️ The update banner cannot see a native change that ships without a version bump (2026-08-04, v1.256.0)

**Fixed and verified in the diff (Q-59):** `UpdateCheckCard` now compares the installed APK against
`nativeVersion` — the version of the newest published `apk-latest` release — instead of the server's
`package.json`, and `package.json` is out of the Android workflow's path gate so a version-only bump
no longer republishes an identical APK. Three states now, including a positive **"Up to date"** the
card never had (it rendered `null` when there was no update).

**The residual hole, accepted deliberately:** a native change merged *without* a version bump
republishes the APK at the **same** version, so the card sees no difference and stays quiet — the
owner would never be told a genuine new build exists. Closing it properly means stamping the build's
commit SHA into the APK and comparing that, which needs a Gradle change **and** one bootstrap install
before it can work at all. Judged more machinery than the reported bug warranted. The mitigating
convention is the standing rule that user-visible changes bump the version, which every native change
in this repo's history has followed — but it is a convention, not a gate.

**Not verified:** the card is `Capacitor.isNativePlatform()`-gated, so none of its three states ever
rendered — the decision logic is unit-tested, the markup is not.

**🔴 LIVE DEFECT, found immediately after the merge:** production `/api/version` returns
`"nativeVersion": null`, so the card is currently showing **"Could not check for a newer build"** —
not the up-to-date/update state it was built for. Re-checked after the 300 s fetch-cache window (the
publish step *deletes and recreates* the release, so a lookup in that gap legitimately 404s):
still null, so it is persistent, not the gap. v1.256.1 adds `nativeVersionStatus`
(`ok` / `unconfigured` / `unavailable`) to tell a missing `GITHUB_RELEASES_TOKEN` apart from a
GitHub-side failure, readable from the admin data-capture console. **If it reports `unconfigured`,
the token is unset in Railway — and More → Download APK has been 502ing all along, since it uses the
same token.**


### [app-shell] ✅ React hydration error on the home screen — 283 times (found 2026-08-04) — **FIXED 2026-08-07 (Q-73)**

> **⚑ Read this first — the section below is preserved for its evidence trail, but two of its
> conclusions are wrong.** The cause was found on 2026-08-07 and reproduced without a device:
> `app/session-select/session-select-content.tsx:1063` called `toLocaleDateString("en-AU", …)` with
> **no `timeZone`**. Railway sets no `TZ`, so Node rendered **UTC** while the S25 rendered
> **Australia/Brisbane** — for the 42% of each day between 00:00 and 10:00 AEST the server sent
> yesterday's weekday+date and the client rendered today's (`"Thursday 6 August"` vs
> `"Friday 7 August"`). It was the banned `toLocale*`-without-`timeZone` pattern from CLAUDE.md's
> Timezone section, on the home header.
>
> **Correction 1 — the "all five tabs mount at once" claim below was FALSE**, and it is what produced
> both dead ends. `components/shell/tab-shell.tsx:57-61` initialises `mounted: [initialTab]`; the
> other four mount on first activation, which is client-only and cannot hydrate. **The search space
> was always the home tab alone.**
>
> **Correction 2 — "needs the un-minified error captured on the device" was not true either.** The
> reason it never reproduced in the sandbox is that `pnpm dev` runs the server and headless Chromium
> in the **same timezone**, so both sides format identically. No device was needed; a timezone
> difference was.
>
> **Fixed (Q-73, v1.267.18):** the header date now renders via `formatInTimeZone(new Date(),
> DEFAULT_TZ, "EEEE d MMMM")` — a fixed timezone, not either side's ambient system tz — so server and
> client always compute the identical string. Swept the same banned pattern at three sibling sites
> found by grep: `getGreeting()`'s `new Date().getHours()` four lines above the header fix (same
> file, gated behind a currently-null `displayName` so not yet a live mismatch, but the same class),
> plus the identical bare `toLocaleDateString` on `overview-screen.tsx` and
> `pre-workout-screen.tsx`. Detail:
> [`docs/overview/history-2026-08-04.md`](docs/overview/history-2026-08-04.md),
> [`docs/reviews/2026-08-07-full-app-review.md`](docs/reviews/2026-08-07-full-app-review.md) §2.1.

**Minified React error #418** (`args[]=text` — *"Text content does not match server-rendered HTML"*),
reported by the client error reporter from real browsing. `/` has **283** occurrences with the most
recent on **2026-08-03**, running 1–13 a day with no downward trend. `/health` (17) and `/more` (15)
both stopped 2026-07-14; home did not.

**Established:** it is a *text* mismatch, so the pre-hydration theme script (classes and
`data-brand`) is not the cause. The session-165 lazy-initializer rule is **not** being violated —
`useState(() => readCacheSync…)` returns nothing across `app/` and `components/`. `/` renders
`TabPage`, and the shell mounts **all five tabs at once**, so a mismatch in any tab's content
surfaces on `/` — which explains the ~17× count and widens rather than narrows the search.

**Did not reproduce** on `pnpm dev` (which emits the un-minified error naming the component and both
texts) driven with Playwright at the S25 viewport as the seeded user. So it needs production data,
the WebView, or a specific time — not the sandbox.

**Two leads chased and killed — do not re-chase.** (1) `toLocaleString()` on the steps number: this
Node is full-icu and returns `1,234`, identical to Chromium. (2) DOM nesting (the error's args
`['text','']` read like *"text cannot be a child of <x>"*): there is no table markup anywhere on the
home path. **Next step is the un-minified error captured on the device** — it names the component
and prints both strings, and two rounds of static reasoning have now produced two dead ends. Full
evidence in
[`docs/reviews/2026-08-04-error-events-first-read.md`](docs/reviews/2026-08-04-error-events-first-read.md).

**Worth noting how this was found:** `error_events` had been collecting for a month and nobody had
read it. Two *other* faults in the same table had already stopped on their own before anyone looked,
and the table prunes at 30 days — so a fault that self-resolves disappears unrecorded.


### [sleep] 🔴 The Sleep Score cannot tell a good night from a bad one — measured against 32 rated nights (2026-08-04)

**Measured, not suspected.** Production `sleep_sessions` run through the real `computeSleepScoreSeries`
and paired against the owner's own morning ratings (`day_checkins.sleep_quality_feel`, 1 = best),
longest session per date:

| | value |
|---|---|
| paired nights | 32 (2026-07-03 → 08-04) |
| **Sleep Score** | mean **91.3**, sd **4.4**, range **80–98** |
| owner's feel | mean 2.59, sd 0.78, range **1–5** |
| correlation | r = −0.354 (correct sign, weak) |

**The score never left the 80s/90s across an entire month** while the owner's experience used the
whole scale. A night rated **5 (worst)** scored **80**; a night rated **4** scored **93**; nights
rated **1 (best)** scored 93 and 92. Worst-of-month and best-of-month land within a point of each
other.

**Two things this changes.** Q-3b was marked *"⛔ owner/data-gated — no code without that data"*;
**the data has existed all along** — the morning check-in has been collecting the rating since
2026-07-03 and `/api/admin/sleep-feel-calibration` already reads it. And the owner's suggestion to
"move the calibration to the morning check-in" is **already built**, so no UI work is needed.

**⛔ Not fixed — needs an owner decision.** Re-tuning the Sleep Score changes a number they read
every morning, and "what should a bad night score" is a product judgement. Tracked as **Q-72**.

**🆕 2026-08-06 — a THIRD direction shipped (v1.267.0), not a resolution of this finding.** The
owner explicitly declined both of this entry's original options (rescale the whole model, or make
`sleep_quality_feel` a live input) and asked for an objective awake-time/fragmentation criterion
instead. An awake-time fragmentation cap now ships in `sleep-score.ts` — see the Current Status
entry above and [`docs/overview/history-2026-08-04.md`](docs/overview/history-2026-08-04.md).
This measured 32-night finding (the score's compressed dynamic range) is **still true and still
open** — the cap only fires on awake-time outliers specifically, it does not widen the range for
nights that are bad on other axes (autonomic, short duration). Q-72 itself is not closed.


### [devices][body] ⚠️ Q-56 fixed the step path only — the rest of the ring rollup keeps the unbounded clock (2026-08-04, v1.255.1)

**Fixed and verified in the diff:** `bucketStepInputsByDay` now converts a ring `ds` with
`resolveDsToMs` (nearest/interpolated anchor) and drops any frame resolving past
`now + INGEST_FUTURE_TOLERANCE_MS`. 10 new tests, one of which pins the original defect so the fix
cannot be mistaken for a test that never failed.

**Still open, and it is the larger surface:** `toDate` in `aggregateOuraRawSamples`
(`adapter.ts:4696`) is unchanged — bare `measuredAtMs` from the newest anchor — and it converts ring
time for **sleep session start/end, HR bins, temperature and its own `dayForDs`**. Those paths carry
the same unbounded skew the step path just lost. Not folded in because it would move sleep-session
boundaries across the whole rollup on the same day the owner's wake times were corrected by an
unrelated fix. Queued as **Q-71** with a required before/after measurement against production sleep
rows.

**Never reproduced end to end.** The mechanism is evidenced (production anchor rows, exact
arithmetic) and the code path demonstrably produces the observed dates, but replaying the 2026-07-30
incident needs a drain in flight and the sandbox has no ring. What is proven is that those dates can
no longer be persisted.

**Per-frame epochs are still not threaded** — `oura_raw_samples.epoch` exists but the step queries
don't select it, so every frame resolves against the current epoch. Unchanged from before, not a
regression.


### [platform] ⚠️ 44 MB of dormant Oura weights nobody was watching — and the "87 MB" figure was wrong (2026-08-04)

Measured while scoping Q-49 Phase B. The repository is ~101 MB of git history. Where it actually
goes:

| | size | loaded at runtime? |
|---|---|---|
| `lib/oura-models/weights/` (15 `.weights.npz`) | **44 MB** | **no — all 14 tracked files dormant** |
| `lib/oura-models/onnx/` | 27 MB | partly — 10.7 MB across the 8 required files |
| `lib/oura-models/constants/` | 12 MB | yes (provenance + real constants) |

**Two corrections to what the backlog said.** Q-49 A1's deletion step targets the 8 required `.onnx`
files — that is **10.7 MB, not the 87 MB** repeatedly quoted. And the largest thing in the repo by
far is the weights directory, which **A1 does not touch at all**.

**`scripts/check-oura-models-dormancy.js` was not looking at `.weights.npz`** — its asset filter
covered only `.onnx` and `.constants.json`, so the tool built to find dormant model assets had never
examined the biggest group of them. Fixed; the sweep now reports all 14 as dormant. Nothing loads
them: the runtime path is `.onnx` via `inference/`, and the only references to these filenames are
`"weights_npz"` provenance fields inside constants JSON.

**They are KEPT, not deleted** — re-extracting weights is impossible from this repo, so removal is
irreversible here and is the owner's decision, the same class as Q-50's finding 2. Explicit KEEP
entries now carry that reason, so they are visible and awaiting a decision rather than invisible.

**This is the real question for Q-49 Phase B**, not A1: 44 MB of extracted vendored Oura weights
would become public the moment history is pushed. **Decide before the push — once public, it is
public.**

### [platform] ⚠️ Q-49 A4b has shipped — Oura's material is out of the tree; Phase B (the cut) is what remains

The owner ran `GET /api/admin/model-assets` and it returned **`complete`**, which the backlog, the
admin card and `bucket-report.ts`'s own summary string all described as the gate for deleting the
87 MB of `.onnx` files from git and making the boot check fatal. **All three were wrong**, and
acting on them would have turned CI red.

`complete` proves the *production* half: the bucket really can serve every model. But **the
repo-tree copies are load-bearing for CI, not just a production fallback** — fourteen test files
read `lib/oura-models/onnx`, most via `fs.readFileSync` directly (bypassing `getSession` and its
bucket path entirely), and `inference/__tests__/sleepnet.test.ts` asserts `not.toBeNull()` with a
comment reading *"incl. CI"*. `.github/workflows/ci.yml` has **no bucket credentials at all**.

**Second, independent problem:** `instrumentation-node.ts`'s check verifies files **on disk**, so
flipping it to fatal while deleting the files would fail the boot immediately. It has to be
repointed at the bucket in the same change. And while the local fallback still exists a fatal check
has nothing real to catch — production cannot silently degrade with a working copy sitting there.

**The real gate is a CI model-delivery story nobody has scoped.** The owner has already approved the
availability trade, so the decision is not what is blocking this. Options and the recommended
fatal-on-`incomplete` / log-on-`unreachable` split are recorded on the Q-49 backlog entry.

**Update 2026-08-16 — Phase A is COMPLETE.** The CI story is solved on both halves: the model tests
replay from recorded fixtures, and the constants now fall back to synthetic fixtures (#1384), so the
suite passes with no vendor material and no credential in CI. Both bucket verdicts read `complete`.
The public repo `nekodas-neko/TrainingAi_Open` exists and is empty.

**Update 2026-08-16 — A4b SHIPPED.** All ten private paths are deleted, `.gitignore`d and covered by
`check-private-paths` (which now reports `total tracked: 0.0 MB`); both boot checks ask the bucket
and throw in production; `NOTICE` states that no third-party model weights are included. Guards on
17 test files, not the 16 the handoff measured — see the two rows below for what that count missed
and for what has still never executed.

**Update 2026-08-16 — the snapshot is PUSHED (step 8).** `nekodas-neko/TrainingAi_Open` holds one
commit, `6c072f9`, verified by cloning it fresh and running `check-private-paths.js` there:
`total tracked: 0.0 MB`. The pre-push audit found three real things, all fixed first — the owner's
email in two docs (#1393), a private-path manifest that catalogued what it was protecting (#1396),
and `main` red on E2E for ten hours of every day from a UTC-vs-Brisbane seed bug (#1397). Journal:
[`entries/2026-08-16-public-repo-snapshot-pushed.md`](docs/overview/history-2026-08-15.md).

**What remains is Phase B steps 9–14**, and all but one are the owner's:
[`docs/public-repo-cut-runbook.md`](docs/public-repo-cut-runbook.md). Branch protection on the new
repo cannot be set from a session (no MCP tool for it). Rollback stays available throughout — the old
repo remains a working Railway target until the final step, and that step archives rather than
deletes it.

**Update 2026-08-17 — `main` kept moving after the snapshot, and that is expected, not a problem.**
The pushed snapshot is `main` at `c9df8db`, frozen at that instant. Work on this (old) repo has
continued normally since — including the owner bug-batch session that produced Q-310 (a real
prescription/data-correctness bug, see the Known Issues entry above) and four other queued items.
This repo stays the canonical working copy until the final archive step, so that is correct: new
work belongs here, not in the empty snapshot. **Whoever runs the remaining Phase B steps should
either take a fresh snapshot at archive time (capturing everything landed since `c9df8db`) or
explicitly decide the gap is acceptable** — don't assume the two repos are in sync just because the
first push happened.

**Update 2026-08-15 (#1353):** the CI story is solved — the model tests replay from recorded
fixtures, so the suite passes with all ten `.onnx` files absent, and the constants resolve from the
repo copy in CI without any credential. The `constants` half now has the same bucket delivery the
models have had since A1, plus its own report. **What remains owed is the deletion itself** (A4b):
delete the tree copies, `.gitignore` them, and repoint both boot checks at the bucket in that one
change. Until then a fatal check still has nothing real to catch.

### [platform] ⚠️ The bucket download path for the model constants has never actually run (2026-08-15)

`ensureConstantsAvailable()` (#1353) prefers the repo copy, which still exists — so every execution
so far has taken the tree branch and returned before touching object storage. Session sandboxes hold
placeholder storage credentials that reject with `SignatureDoesNotMatch`, so the download cannot be
exercised here at all; only the pure report-building logic is covered by tests.

Its first real run is on Railway, in the deploy that deletes the tree copies. That is the correct
ordering — a mechanism added *after* a deletion is a mechanism nobody tested — and A4b flipped the
boot check to fatal in the same change, so a failed download fails the deploy instead of silently
serving a half-populated directory.

**Status 2026-08-16: A4b has merged, so that deploy is the one to watch.** A healthy boot logs
`[instrumentation] model constants: bucket — downloaded 34 file(s)` followed by
`[instrumentation] model assets: 8 file(s) in object storage`. Anything else and the process will
not come up; `GET /api/admin/model-assets` answers why, and reverting the deploy restores a tree
that still has the files. **Until those two lines are seen in a Railway deploy log, the download
path remains unexecuted** — merging is not the same as running it.

**Related, and already caught once:** the owner's console upload of the 34 constants landed 33,
dropping `stress_daytime_sensing_1_1_0.tables.json`. `GET /api/admin/model-assets` names the missing
file; re-check it reads `complete` before A4b deletes anything.


### [platform] ⚠️ A failed `REINDEX TABLE CONCURRENTLY` left 42 MB of invalid indexes in production (2026-08-04)

### [platform] ✅ DB index bloat cleared — 176 MB reclaimed, WAL restart still owed (2026-08-04)

Owner ran the corrected procedure. Measured after:

| | before | after |
|---|---|---|
| `oura_raw_samples` indexes | 316 MB | **140 MB** |
| `oura_raw_samples` total | 462 MB | **286 MB** |
| whole database | — | **363 MB** |
| invalid `_ccnew` indexes | 4 (42 MB) | **0** |

**Restart done** (`pg_postmaster_start_time` 02:03:58 UTC). Volume **~890 MB → ~680 MB of 1.00 GB**
— 68%, against the 92% that started this. `max_wal_size` deliberately left at 256 MB: at 68% there
is no case for trading checkpoint I/O for disk on a database already timing out on BLE ingest
batches.

**⚠️ The runway is ~5 weeks, and the trend is unchanged.** `oura_raw_samples` takes **~24,700
rows/day** at ~363 bytes/row with indexes ≈ **9 MB/day**, against ~320 MB headroom → **~35 days**
before this recurs. The reindex bought time; it did not fix anything. The structural fix is
**Q-30** (raw-sample retention / raw-drop-vs-bytea). Re-check in ~3 weeks.

### [devices][platform] ⚠️ Oura BLE ingest fails often — noisy, but verified NOT lossy (2026-08-04)

The device BLE service log carries repeated `ingest POST failed` across 48 hours: `timeout`,
`HTTP 500`, `HTTP 502`, `HTTP 403`, and one `Unable to resolve host`. Counters read
`ingestPosted 72,126` against `ingestStored 49,787`.

**Checked, and no data is being lost.** Server `oura_raw_samples` sits at `ring_timestamp_ds`
25,680,106 against the device cursor 25,680,154 — a **4.8-second** gap, i.e. current. The
posted/stored gap is dedup (`(user_id, ring_timestamp_ds, tag, body_hex)`), not loss: re-sends are
free by design and the cursor only advances past durably-ingested events, so a failed POST is
retried on the next drain. The log says so itself — *"data is safe locally, retries next drain"*.

**What is unexplained is the failure *rate*.** The 502s and the DNS failure are not the app, and the
500/timeout bursts line up with Railway deploy windows (several releases landed on 2026-08-04), so
container restarts explain much of it. That is a hypothesis, not a measurement. `/api/oura-ble/samples`
does call `reportServerError`, yet none of these reached `error_events` — which points at the failures
happening before the handler runs (edge/platform) rather than inside it. Worth a proper look if the
rate does not fall now that deploys have stopped.


### [readiness] ⚠️ Body Battery v5 — inputs corrected, but the model still has no validated target (2026-08-04, v1.253.0)

Q-57 shipped: HRmax for the reserve now comes from the highest corroborated daily peak over 90 days
(**168**) rather than `220 − age` (**190**); `CHARGE_RATE` halved 0.40 → 0.20; sparse days are
flagged rather than rendered as confident flat lines. Backtested over the real 41-day production HR
series: days pinned at the 100 ceiling **14 → 0**, end-of-day mean **71.9 → 49.9**.

**The open risk, stated plainly: these constants are not fitted to anything.** End-of-day battery
vs next-day readiness sits at **r = −0.06** over 18 pairs, so there is no outcome signal to tune
against. They were chosen for distributional plausibility — nothing pinned at either rail, centred
near 50. That is a defensible position for inputs that were wrong on their own terms, and it is
**not** evidence the number now means something. Re-check after ~2 weeks of v5 days
(`docs/body-battery-tuning.md`); if the correlation is still absent, the question is whether
end-of-day battery is the right predictor at all.

> **⚠️ AMENDED 2026-08-15 — that re-check is done, and the r = −0.06 above is not a v5 number.**
> Twelve v5 days have accrued. Split by `model_version`, **v5 alone gives r = +0.67 (n = 11)**
> against −0.12 pooled across v1/v2/v4/v5 — all four of which ran inside the same 40 days with no
> backfill, so any correlation over the full series mixes four models. **The deferred question is
> answered in v5's favour: tune, don't abandon** (**Q-272**), and the versioning gap that made the
> pooled number look authoritative is **Q-273**. Underpowered at n = 11 — re-run at ~30 v5 days.
> Separately, and not visible in the correlation: v5 **drains 5× faster than it charges** (10.5 vs
> 52.4/day) and **ends at its daily minimum on 10 of 12 days**. Evidence in
> [`docs/reviews/2026-08-15-comprehensive-app-review.md`](docs/reviews/2026-08-15-comprehensive-app-review.md) §1.4–1.6.

**Two secondary risks:**
- **The reserve now varies per user and per window.** A user with fewer than 14 recorded peak days
  falls back to the age estimate, so two v5 days are not comparable unless both resolved
  `hrMax.source === 'observed'`. The response carries `hrMax.source`/`peakDays` for exactly this.
- **Not verified on device.** The "Limited data" chip and its explanation were never rendered — the
  seeded local DB has no HR data, so that state is unreachable in the sandbox. Card rendering at
  the S25 viewport is unchecked.

The anchor ("start number") is untouched and still swings with readiness (29–87). Q-42 was the
structural half — **✅ shipped 2026-08-09**, see the Body Battery anchor row below.


### [workouts][cardio][devices][platform][body] Owner bug/feature batch, 2026-08-02/03 (Q-63…Q-69) — triaged and planned, NOT fixed

Seven items reported/requested by the owner across a single session, each traced to source and
queued with an implementation plan, none implemented. **Renumbered twice** (an original Q-52…Q-58,
briefly Q-57…Q-62, now Q-63…Q-69) — Q-52 collided with an unrelated "per-exercise phase hold" plan,
and Q-53…Q-56 collided with the separate cross-domain bug review below; both landed on `main` first:

- ~~**Q-63 `[workouts]`**~~ ✅ **SHIPPED v1.253.3, 2026-08-04.** Both skip buttons now route through
  the existing confirm; the guard moved to `components/workout/leave-guard.ts` so it is testable at
  all (this repo has no component-test setup). Deliberately still conditional on there being work to
  lose — a prompt dismissed by reflex guards nothing. Originally: the workout skip button advances to the next exercise with zero
  confirmation in a normal (non-solo) workout, discarding in-progress set/rest state on one tap.
- **Q-64 `[workouts][devices]`** — voice logging turns itself off instantly on the APK:
  `RECORD_AUDIO` isn't declared in the Android manifest at all, and even fixed, embedded Android
  WebView doesn't reliably implement real speech-to-text the way Chrome does.
- **Q-65 `[workouts]`** — Picture-in-Picture shows a static "DONE / tap Next" placeholder instead of
  the live rest-countdown ring on the exercise-summary screen (the active-mode PiP case already
  solves this correctly via `PipView`; the summary-mode branch never got the same treatment).
- ~~**Q-66 `[cardio]`**~~ ✅ **SHIPPED 2026-08-04.** Treadmill toggle on the walk config; GPS is
  never started in that mode, and the walk saves as `treadmill` with distance/route/pace null.
  Beyond the plan: treadmill walks are now **included** in the fast/slow segment-stats card, which
  filtered to `'walk'` and would have silently dropped them — the aggregate filters nulls per field,
  so they contribute real heart rate and nothing to pace. Originally: guided walk has no
  treadmill/no-GPS mode, so doing the interval walk indoors
  risks polluting pace/distance stats with GPS drift; the manual "Other activity" flow already
  solved this exact problem and guided walk never got it.
- **Q-67 `[platform]`** — the Renpho scale's persistent "Connected — listening for weigh-ins"
  notification runs continuously (foreground service is `START_STICKY` since 2026-08-01) and is
  unwanted noise distinct from the actual "Weigh-in logged" event.
- ~~**Q-68 `[cardio][devices]`**~~ ✅ **SHIPPED 2026-08-04.** The ring-confirm path now runs behind
  the same notify gate AD-1 already used, as a **GPS veto rather than a requirement** — no GPS fix
  still trusts the ring, which is the indoor case AD-2 exists for. Does not touch the AD-2 Hz-band
  calibration issue, which is separate and still owner-blocked. Originally: auto walk/run detection
  still false-positives on ordinary movement.
  Distinct from the already-tracked "AD-2 Hz bands provisional/uncalibrated" issue: the ring-confirm
  path (the one actually active whenever a ring is connected) skips the GPS distance/elapsed notify
  gate the sensor-fallback path already has.
- ~~**Q-69 `[body]`**~~ ✅ **SHIPPED v1.253.2, 2026-08-04** — see the Known-Issues entry above. The
  scale weight trend only ever took the day's *first* confirmed reading; a
  clothed first weigh-in permanently locks in a high trend value with no correction path. Decided
  (after rejecting both a same-day average and a manual override UI) to have the trend use the day's
  *lowest* confirmed reading instead.

Full root causes, decisions, and rejected alternatives (with rationale) in
[`docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md`](docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md).
Plans and branch names in `docs/implementation-backlog.md`. **Do not strike any of these seven
until each is actually implemented and verified** — this entry only records that they were scoped.

### [platform][body] 🔴 `body_metrics` could neither save locally nor pull — BOTH statements were short of columns (fixed v1.252.8, 2026-08-04)

Found in the owner's device console, not by any test. `applyDeltaBody` threw
`Run: 30 values for 32 columns` on every pull. Checking its sibling found the **local write broken
too**: 32 columns against 31 placeholders.

So on device, **every body-metric write failed in both directions** — weight, steps, calories,
macros, water, resting HR, HRV, SpO₂ and the whole scale body-composition set. The ten
body-composition columns added with the scale-BLE work were added to the column lists and the param
arrays but not to the `VALUES` lists.

**The blast radius was wider than "body metrics" — traced 2026-08-04, after the fix shipped.**
`applyDeltaBody` applies `delta.bodyMetrics` in its **first** loop, and `applyDelta` wraps the whole
thing in one transaction (`sqlite-backend.ts:1173`). So a delta page carrying even one body-metric
row threw on its opening statement and rolled back **all 26 domains in that page** — workouts, food,
sleep, programs, everything. With Oura BLE writing body metrics more or less continuously, that is
close to every page. **Incremental sync was dead on the device, not degraded.**

**Nothing was lost, though.** `setLastSyncAt(raw.syncedAt)` sits *inside* the same `try` as
`applyDelta` (`sync-engine.ts:539-545`), so a failed page never advanced the cursor — the server
still holds everything and it re-pulls from the same point. The device needs a restart to pick up
the fixed JS; no repair step, no full resync.

**This also closes out the `BeginTransactionAlready in transaction` error** from the same console
dump, which the fix PR could only call "probably a cascade". It is one: the `catch` at
`sqlite-backend.ts:1181` swallows a failing `rollbackTransaction()`, so the connection stays inside
the aborted transaction and the *next* `beginTransaction()` throws exactly that. Downstream of the
arity bug, not independent — but note the swallow is still there and would re-surface the same
confusing second error behind any future `applyDelta` failure.

TypeScript cannot see the original fault (template-string SQL, plain array params), lint cannot, and
**no test in this repo could have** — `getLocalStore` returns null off device, so nothing that goes
through the store executes these statements at all. It only ever appears as a runtime SQLite error
on the phone.

Guarded now by `lib/local-store/__tests__/insert-arity.test.ts`, which parses the backend source and
asserts column count equals value count for **all 33** INSERTs — confirmed to fail on the original
bug, naming the exact line. It also pins a floor on how many statements it finds, so a reformat that
breaks the parse fails loudly instead of passing vacuously.

**Still open, same console dump — two things this does NOT fix:**
- `/api/body-battery` and `/api/readiness-score` both returned **500** in production — see the
  Known Issue directly below; both now report, but the cause is still unproven.
- A `BeginTransactionAlready in transaction` error also appeared. Most likely a cascade from the
  above (a failed statement leaves the transaction open and the next `applyDelta` cannot begin), but
  that is reasoning, not evidence — re-check on device once the arity fix ships.

### [app-shell][platform] ⚠️ The APK's version was frozen at 1.30.0, so "Update available" was always on (fixed v1.252.7, 2026-08-03) — needs the next APK

`android/app/build.gradle` hardcoded `versionName "1.30.0"` while the app shipped 1.252.x. CI reads
`package.json` for the GitHub release *title*, but never stamped it into the build. `UpdateCheckCard`
(More) compares the installed APK's `versionName` against `/api/version`, so the comparison was
`1.30.0` vs `1.252.6` — permanently "behind". The card claimed an update was available forever,
**including immediately after installing the newest build**, and could never say "up to date".

Fixed by deriving both `versionName` and `versionCode` from `package.json` at Gradle configure time
(so a local build gets the same number as CI, not a CI-only patch). `versionCode` goes 3 →
1,252,006 via `major·1,000,000 + minor·1,000 + patch`; it only ever increases, so installs over the
old APK still work.

**Which surface was NOT exercised:** the Gradle build itself. The sandbox has no Android SDK and the
Gradle download is proxy-blocked, so the file is compile-checked only by CI's Android job — which is
**not a required check**, so it was watched explicitly rather than trusted to the merge gate. And
**the fix cannot take effect until the next APK is installed**, because it lives in the file that
builds the APK: the currently-installed build still reports 1.30.0. Expect the card to keep claiming
an update until then — that is the bug, not a new one.

### [sleep] ⚠️ Last night's own record is still wrong — the sensing-span fix only covers future rollups (2026-08-03, v1.252.8)

The `denseSensingSpan` fix (see Current Status above) stops this class of bug going forward, but it's
a pure function of already-decoded input — it doesn't retroactively rewrite the `sleep_sessions` row
for the 08-03/04 night itself, which still shows `sleep_start` = 00:59 instead of the real ~22:32.
`body_hex` for that night is untouched (archival, per the Oura BLE rules), so the row is recoverable
by re-running the rollup over it (Redecode / a targeted backfill) — that re-run just hasn't happened
yet. Any other historical night with a similar asymmetric mid-night interruption has the same stale
`sleep_start` until the same backfill runs. No backlog entry filed — flag here so it isn't
re-discovered as a fresh bug; do the backfill next time this file is touched for a sleep-domain
session, or on request.

### [cross] Cross-domain bug review 2026-08-03 — 5 findings, ALL QUEUED (fixes not yet shipped)

Review-only session (no code changes): 4 parallel review agents + a direct production DB audit via
the admin read-only endpoint. Full evidence in
[`docs/reviews/2026-08-03-cross-domain-bug-review.md`](docs/reviews/2026-08-03-cross-domain-bug-review.md);
each item queued in `docs/implementation-backlog.md` with its own plan doc. This row is struck
per-item as the fix PRs land.

- **[devices][body][sleep] Q-56 — real sensor data landed on dates up to 5 days in the future.**
  Five `body_metrics` rows + one `oura_daily` row, written in one batch on 2026-07-30, dated 1-5
  days ahead of that write. **Re-checked 2026-08-04: all five have self-healed and there are now
  zero future-dated rows** across `body_metrics`, `sleep_sessions`, `oura_daily`,
  `oura_daily_summary` and `activity_logs`, keyed on the user's local day. **That is the symptom
  expiring, not a fix — do not close it on that basis.** Root cause not proven, but a strong lead is
  now recorded on the backlog entry: the ring-time → wall-clock conversion (`measuredAtMs`) has **no
  future clamp at all** while the scale path does (`INGEST_FUTURE_TOLERANCE_MS`), and the step/day
  path resolves against the single newest clock anchor rather than the nearest-frame resolution
  migration 161 built for exactly this — with production anchors observed re-stamping ~39 minutes of
  ring time in 11 real seconds mid-drain. Plan:
  `docs/superpowers/plans/2026-08-03-future-dated-ble-ingest-rows.md`.
- ~~**[workouts] Q-53 — prescription cache staleness after a mutation.**~~ ✅ **SHIPPED 2026-08-03
  (v1.252.6).** Finding (a) turned out to be worse than filed and the fix is a **deletion**: the
  bare `fetch` in `onPhaseChanged` duplicated the `refreshExercises()` call on the next line, minus
  the `no-store`, the cache write-back, the 404 recovery *and* the request-id guard — so it could
  resolve last and overwrite fresh state with a 60s-stale response. Finding (b) added the missing
  `invalidatePrescriptionChanged` to the `aiPrescriptionPending` trigger. Finding (c) was
  investigated and is **unreachable** — after (a), every remaining reader of that endpoint either
  passes `no-store` or goes through the invalidated cache key — so no code was written for it. See
  [`docs/overview/history-2026-07-30.md`](docs/overview/history-2026-07-30.md).
  **Not reproduced end to end:** the staleness needs a real transition plus a second read inside a
  60-second window, which is not drivable from the sandbox.
- **[workouts] Q-54 — prescription-generation write race under concurrent triggers.** Two
  generation calls for the same session (duration-preset picker vs. standard auto-fire) use
  different dedup keys and can interleave three sequential writes to `session_periodization`,
  leaving `prescriptionStatus` mismatched against the stored content. Source-read finding, not yet
  reproduced — reproduction is Task 1 of the plan:
  `docs/superpowers/plans/2026-08-03-prescription-generation-race.md`.
- ~~**[workouts] Q-55 — bodyweight `target80` rendered as "X kg" in the workout-preview sheet.**~~
  ✅ **SHIPPED 2026-08-03 (v1.252.5)** — `overview-screen.tsx:484` now carries the same
  `exerciseType` guard as the block 70 lines above it. The sibling sweep was re-run and found
  nothing else: every other `target80` render is already guarded, two of them by an earlier
  short-circuit in the same ternary chain rather than an explicit check. See
  [`docs/overview/history-2026-07-30.md`](docs/overview/history-2026-07-30.md)
  — which also records a **new, smaller finding** the fix surfaced: `target80` for a bodyweight
  exercise is 0.8 × a BW_REF(100)-relative index, so it falls *below* BW_REF and inverts to
  "1 reps". Both blocks now agree and neither fabricates a weight, but "1 reps" is a weak reading
  and the right bodyweight target is a product question nobody has answered.
- Also verified clean (no findings): sync-push mirroring (`pushMutations` vs API routes) across
  every write-capable route touched in the last 40 commits; ownership checks on the two most
  recently added mutating routes; nutrition production data integrity (zero orphans, no bad values);
  sleep production data integrity beyond one n=1 edge case noted for awareness only (a 45-minute nap
  stored with all sleep-stage fields zeroed — not filed as a bug).

### [platform] ⚠️ Model-asset bucket report (Q-49 A1 gate, v1.252.3, 2026-08-03) — two of its three verdicts have never run against a real bucket

`GET /api/admin/model-assets` + the **Model asset delivery** card (Admin → Tools → Additional tools)
replace the old "read the deploy logs for eight `[oura-models]` lines" gate, which could not work:
the model loaders are lazy, so those lines only appear once a sleep rollup runs, and their absence is
indistinguishable between "bucket empty" and "nothing asked yet".

**Which surfaces were NOT exercised:** (a) the `complete` and `incomplete` verdicts — the sandbox's
bucket credentials are rejected, so only `unreachable` can be reached here (it *was* reached, live:
`SignatureDoesNotMatch (403)` with an empty missing-list, which is the behaviour the design exists
for). Their logic is unit-tested; the S3 round trip is not. (b) **The card's rendering** — it sits
behind two client-side toggles so it is absent from the server-rendered HTML, and this repo has no
React render-test setup (`vitest` runs in `node`, no `@testing-library`). Both on the owner
checklist. Ships through Railway — no APK needed.

### [activity] ⚠️ Home streak now merges unsynced workouts (Q-41, v1.252.2, 2026-08-03) — the sandbox cannot produce a single overlay row

Home's week strip and streak now merge outbox-pending workouts on top of the server payload at read
time (`mergeCalendarOverlay` + a separate `pendingDays` state), so a **second** workout on a day that
already holds a synced one is no longer masked. A workout on a fresh day already showed — the
backlog entry's stated cause was wrong and is corrected in
[`docs/overview/history-2026-07-30.md`](docs/overview/history-2026-07-30.md).

**Which surface was NOT exercised:** the overlay itself, on any path. `getLocalStore` returns null in
the web sandbox, so `pendingDays` is provably always `{}` there and the merge is a no-op — the dev
server can only demonstrate that the server-only rendering is unchanged (it is, and a test asserts
the merged result is `toEqual` the server payload for an empty overlay). Logging offline and seeing
the streak move before sync needs the APK. On the owner device checklist. Ships through Railway —
no new APK needed to *get* the change, only to verify it.

### [workouts] ⚠️ Auto-applied phase transition (v1.252.0, 2026-08-03) — device-unverified, and one branch not exercised

Auto-apply now calls `advancePhase` for a model-earned transition (fix for four session types stuck
in accumulation since June). Verified end-to-end on the local dev server: `accumulation →
intensification`, status `auto_applied`, phase moved in the DB. **Not verified:** the new rationale
banner and the amended card header on the S25 (Samsung WebView, safe-area). This is a JS/server
change, so it reaches the device through the Railway deploy — **no APK needed**, just a look at the
pre-workout screen.
**Not exercised end-to-end:** the ceiling-forced branch, because the model cannot be made to answer
"stay" on demand while a session cap is tripped; it is covered by `canAutoApplyTransition`'s unit
tests and by reasoning (a forced transition carries the previous phase's clamped loads, so applying
it would advance into a zone too light).

### [workouts] "Lower" has no primary exercise — the load anchor is a secondary (found 2026-08-03)

The active program's Lower session holds 3 secondaries and 2 accessories, no primary.
`capLoadToAnchor` (`role-plausibility.ts:53`) resolves the anchor from roles and caps every
non-anchor exercise at the anchor's pct, so with no primary the absolute role-ordering rule is
degraded on that day — a secondary is acting as the anchor. Every other session (Legs, Pull, Push,
Upper) has exactly 1 primary. Likely a program-config slip rather than an engine bug, but it should
either be corrected in the program or `capLoadToAnchor` should state what it does with no primary.

### [workouts] ✅ Estimated 1RM growth is implausible on several lifts (found 2026-08-03) — MEASURED 2026-08-03, not an estimator fault

Over seven weeks: bent-over row +45.8%, incline bench +38.7%, barbell shrug +37.6%, calf raise
+38.5%. These are not physiological gains — most likely loads ramping from a start well below true
capacity (consistent with the open "starting weights never reach the bar" issue) and/or estimator
drift. It matters because `rm1Trend` gates phase-transition eligibility and autoregulation, so every
prescription rides on these numbers.

**Resolved by measurement — it is the first hypothesis, and there is no estimator drift.** Every one
of the four was traced through production set-by-set. Each starts with a light, very-high-rep
session and progresses to a heavier, lower-rep one; the weight actually on the bar grew *more* than
the 1RM estimate did, in all four cases:

| Lift | first session | last session | bar weight | 1RM estimate |
|---|---|---|---|---|
| Bent-Over Barbell Row | 25 kg × 15 | 60 kg × 9 | **+140%** | +121% (37.5 → 82.8) |
| Incline Bench Press | 30 kg × 20 | 62.5 kg × 7 | **+108%** | +39% (56.8 → 78.8) |
| Barbell Shrug | 50 kg × 15 | 77.5 kg × 10 | **+55%** | +38% (78.5 → 108.0) |
| Barbell Calf Raise | 50 kg × 20 | 92.5 kg × 10 | **+85%** | +39% (94.8 → 131.3) |

So the estimator is **damping** the raw load increase, not inflating it — the opposite of drift. It
is also well-guarded: `repFactor` averages Epley and Brzycki, freezes the Brzycki term past 20 reps
(it blows up toward rep 36), and `REP_CEILING = 30` rejects anything beyond.

Two things follow. **(a) `rm1Trend` is reporting correctly** — those lifts genuinely went up, so the
phase-transition gate and autoregulation are reading real progression, and nothing needs changing
there. **(b) The audit's percentages are inflated by their own baseline.** Each is measured from a
15–20-rep opening set, which is where a rep-max formula is least trustworthy *and* where the lifter
was furthest below capacity. That makes the number a measurement artifact of the starting point, not
a property of the estimator.

**What stays open is the separate, already-known issue** the finding pointed at: *starting weights
never reach the bar*. This measurement corroborates it with four independent cases — a first session
at 25 kg × 15 for a lift that reaches 60 kg × 9 seven weeks later is a start far below capacity. No
new entry filed; it belongs to that issue.

~~Separately, bodyweight movements carry meaningless absolute values (Hanging Leg Raise "128 kg",
Pull-Up "118 kg") which makes their trend unreadable — worth excluding bodyweight lifts from any
stall/trend judgement.~~ **Investigated and partly wrong — corrected 2026-08-03 (v1.252.4).** A
bodyweight `estimated_1rm` is a `BW_REF`(100)-relative index, so its *trend* is readable (monotone in
reps) and must stay in stall/trend judgement; only the absolute number is meaningless, and only where
a surface prints "kg" after it. A sweep of every 1RM render found two that did: the Year in Review
(which also *selected* the wrong PR — a plain `max` over two incomparable units ranked a pull-up
above a 96 kg bench press) and the deload sheet's kg target. Both fixed; `live-1rm-readout.tsx` looks
like the same bug but is unreachable for bodyweight, and the digests were already correct. See
[`docs/overview/history-2026-07-30.md`](docs/overview/history-2026-07-30.md).
**The weighted-lift half above is untouched and still open.**

### [activity] ⚠️ Activity HR for GPS runs/walks (Q-41 finding 2, v1.250.4, 2026-08-02) — not run against a real GPS activity

Runs and walks now save `avgHr`/`maxHr` on the activity row instead of leaving them null; the values
come from the `/api/oura/hr-window` response the screen already fetches for its route-map colouring
and was discarding.

**Which surface was NOT exercised:** a real GPS activity end to end. That needs the whole
activity-tracking flow — location permission and a moving device — which does not exist in the
sandbox. Proven: the endpoint returns `avgHr`/`maxHr`, the effect that fetches them runs for every
activity type, and the save reads them synchronously (so the save stays instant). Unproven: that a
real run or walk finishes with non-null HR on the row. On the owner device checklist.

**Related, measured not fixed:** `cadence_spm` is null on **all 42** production activity rows while
3 carry a `cadence_series` — so Q-41's finding 4 (does the 60 spm floor reject slow walks?) was
unanswerable, and the real question is why the scalar is never written. Re-filed as **Q-47**.

### [devices][heart-rate] ⚠️ Chest-strap link status (Q-40, v1.250.3, 2026-08-02) — Kotlin half needs an APK, labels unproven on a real strap

Q-40 shipped: the pairing card's label now comes from the native service's own state rather than two
booleans (`lib/live-hr/strap-link-label.ts`, 7 tests), a **Connect** button recovers a link the
service gave up on without restarting the app, and `PolarStrapService` emits a final `stopped`
status in both teardown paths instead of dying silently.

**Which surfaces were NOT exercised:**

- **The Kotlin change did not compile locally** — the sandbox has no Android SDK (`npx cap sync
  android` succeeds; `./gradlew compileDebugKotlin` fails with "SDK location not found"). CI's
  Android job is the compile gate and it passed, but that is a build, not a run.
- **It needs a new APK to reach the device.** The JS half (label + Connect button) ships through
  Railway; the give-up-announces-itself behaviour does not.
- **No connected / retrying / stopped label has run against a real strap.** Those states are
  device-only by construction; only the unpaired web state was rendered.

Both device checks are on the checklist in
[`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](docs/handoff-2026-08-02-platform-batch-queue-drain.md).
Do not strike this row on intent.

### [devices][platform] `oura_raw_samples` is 452 MB and ~130 MB of that is index bloat (measured 2026-08-02)

Not a regression — a measurement, taken while re-verifying Q-35 before implementing it. Production:
740,966 rows, 146 MB heap, **306 MB of indexes**. `n_tup_upd` is 1,324,792 with `n_tup_hot_upd` of
**19**, so almost every update rewrites an entry in all four indexes.

The cause was `redecodeOuraRawSamples` re-stamping the **indexed** `measured_at` column over every
row in a page with no `IS DISTINCT FROM` guard — an update that writes back the value already there
still cannot be HOT. ✅ **Fixed in #1003 (v1.250.6)**, with a DB-backed test asserting a second pass
writes zero rows (checked against the un-fixed code, where it writes 40). **The existing ~130 MB is
still there** — that needs the one-time `REINDEX TABLE CONCURRENTLY` on the owner's console
checklist. Doing the REINDEX without this guard would simply have refilled it.

**Q-35 was retired rather than built** as a result: its Finding 1 was already done by Lever 1 (0 of
740,966 rows carry `decoded`) and its Finding 4 — a sha256 generated column for the dedup index —
would have made the table *bigger* (sha256 is 32 bytes; `body_hex` averages 24 characters). Full
numbers in
[`docs/overview/history-2026-07-30.md`](docs/overview/history-2026-07-30.md).

### [platform][devices][readiness] ⚠️ Health Connect tier (Q-43, v1.250.0, 2026-08-02) — never run against a real provider

Q-43 shipped: readiness degrades to the generic tables when there is no ring rollup, the derived
score is persisted so the trend surfaces fill in, `saveSleepSession` writes through the per-field
rank merge with a required `source`, and a Health Connect hypnogram is carried through to
`sleep_phase_5_min`.

**Which surface was NOT exercised:** the Health Connect ingest path itself. The owner has Health
Connect switched off and there is no second device in the sandbox, so nothing here ran against a
real provider. Specifically unproven:

- the Capacitor plugin read path (`lib/health-connect-sync.ts` — browser-only code, `pnpm dev`
  early-returns before it),
- the actual stage strings a real provider emits. The five we map were read out of the pinned
  plugin source (`RecordConverter.kt:390-400`), not from memory, but nothing has confirmed which
  ones Samsung Health / Google Fit actually populate,
- whether any real provider stages a whole night cleanly enough to clear the hypnogram's
  full-coverage requirement. If none do, the fallback is the four stage totals we already had —
  a no-op, not a regression.

Everything else is proven: the DB rank-merge orderings, the route degradation boundaries, the
rasteriser, and a `/api/sync-health` POST landing a row with `source_map` stamped `health_connect`.
Do not strike this row on intent — the device check is on the owner checklist in
[`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](docs/handoff-2026-08-02-platform-batch-queue-drain.md).

**Adjacent finding (Q-45) — ✅ FIXED 2026-08-02 in #1007, v1.250.9.** On the Readiness breakdown a
*provisional* contributor rendered a weight-derived bar value that read exactly like a score —
"Resting heart rate 88" when there was no resting-HR data at all. Provisional factors now show their
weight as `15%` in muted text, fill the bar to that same weight, and sort last instead of
interleaving at their neutral `50` placeholder. See
[`docs/overview/history-2026-07-30.md`](docs/overview/history-2026-07-30.md).

### [activity][platform][workouts][readiness][devices] Owner bug batch reported 2026-08-02 — all 5 shipped, device checks outstanding

Five live production bugs reported by the owner on 2026-08-02. All five were traced to source in
the investigation session and **all five have now shipped** (#987, #988, #995, #996, #997) —
the plan is
[`docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md`](docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md)
with follow-ups Q-41/Q-42 still queued. What remains is **device verification** — see the checklist
in [`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](docs/handoff-2026-08-02-platform-batch-queue-drain.md).

1. ✅ **[activity] A guided walk can never sync, and so never reaches the training calendar (Q-36).**
   Fixed in **#987** (v1.249.5). ⚠️ The owner's stranded walk needs a manual **Retry** tap on the
   sync-health card — a dead-lettered row is never re-attempted on its own.
   `computeWalkSegmentStats` rounds segment mean HR to 1dp (`lib/walk/segment-stats.ts:23`) but
   `WalkSegmentStatSchema.avgHr` is `z.number().int()`
   (`packages/shared/src/validation/activity-log.ts:17`), so one fractional mean rejects the
   **entire** `activity_logs` payload on both write paths → dead-letter after 5 attempts.
   **Reproduced** with a Vitest run against the real schema. The walk still renders in the
   local-first Health list while being absent from Postgres — and `getCalendarData` reads
   `activity_logs` from Postgres, which is why the calendar showed nothing. The owner's device is
   holding one such stranded mutation (Activity — 2026-08-01); the fix has shipped, so the Retry tap
   noted above is all that remains.
2. ✅ **[platform] The local SQLite store fails its version upgrade on every launch (Q-37).**
   Fixed in **#988** (v1.249.6). ⚠️ NOT yet verified on device — see the dedicated Known-Issues row
   below. Three
   faults, each independently able to produce the "Sync failed — will retry automatically" toast:
   the v13 `ALTER TABLE mutations_outbox ADD COLUMN attempts` fails with "duplicate column name"
   every launch because the fallback reopen never stamps the version forward; `PRAGMA
   journal_mode=WAL` is sent through `execute()`, which cannot return rows, so **WAL has never
   actually been enabled** on this device; and a leaked connection registration is misdiagnosed as
   an upgrade fault. Separately, `applyDelta` sits outside `pullPage`'s try block, so a device-side
   schema fault surfaces as the same generic toast as a network failure.
3. ✅ **[workouts] Accepting a phase transition empties the prescription card permanently (Q-38).**
   Fixed in **#995** (v1.250.1). The transition now leaves the slot in the `'consumed'` state
   `isAiPrescriptionPending` keys on, which lights up the "Preparing your AI workout…" placeholder,
   the bounded poll and the regeneration triggers; the unreliable server self-fetch is replaced by
   a client-fired one. Verified end to end at the S25 viewport on the dev server.
4. ✅ **[readiness] The Body Battery anchor flips between readiness and sleep mid-day (Q-39).**
   Fixed in **#996** (v1.250.2). The decision moved into `app/api/body-battery/anchor.ts` and a
   readiness-derived anchor is now frozen for the rest of the day; a sleep anchor is labelled
   provisional and upgrades exactly once. Reproduced on the dev DB (82 → 54 → held at 54) and the
   provisional copy checked at 360px in both themes.
5. ✅ **[devices] The chest-strap card reads "Connecting…" forever (Q-40).** Fixed in **#997**
   (v1.250.3) — the label now comes from the service's own state (`lib/live-hr/strap-link-label.ts`,
   7 tests), a **Connect** button recovers a given-up link without an app restart, and the native
   service announces `stopped` before it dies. ⚠️ **The Kotlin half needs a new APK and none of the
   connected/retrying/stopped labels have run against a real strap** — see the Known-Issues row
   below. Previously: the label was derived
   from two booleans and `active` is true from app start (ambient mode runs all day), so every
   non-`ready` native state collapses into "Connecting…". The native service also calls `stopSelf()`
   after exhausting its backoff ladder **without emitting a final status**, so the WebView holds its
   last-seen state indefinitely.

### [cardio] Run-type carousel + zone-gap recommendation (v1.246.0, 2026-07-30)

Follow-up to the v1.245.0 entry below, same session: the flat pill-row run-type picker became a
real swipeable carousel, mirroring `app/workout-select/workout-select-content.tsx`'s session
carousel shape (one card at a time via the existing `SwipeCarousel` primitive, dot indicators, a
"Recommended" badge whose dot stays visually distinct even off-screen). The recommendation itself
is new: `lib/running/recommend-run-type.ts` deterministically scores each run type by how much of
the week's biggest **open** HR-zone gap it would close (using the same `ZoneQuota` the
Cardiovascular hub shows — no LLM number gates this), so picking Interval when Z4/5 minutes are
still owed is a computed suggestion, not a guess. Z1 never drives it (spec D-10 — passive fill).
Returns no recommendation once every training zone is already complete/not-required.

⚠️ **A second real bug found by testing this, on top of the v1.245.0 GET-recompute fix:** even
with that fix in place, reloading shortly after an override could *still* show the stale
pre-override prescription — this time because `GET /api/running-plan`'s `Cache-Control:
private, max-age=60, stale-while-revalidate=120` let the **browser's own HTTP cache** (not the
app's `cachedFetchToday`/`invalidateRunningPlan()` layer, which was already invalidating
correctly) serve a stale response for up to 60s, invisible to and uninvalidated by the app's own
cache-group system. `lib/sqlite/cache.ts`'s `cachedFetchCore` calls plain `fetch(url)` with no
`cache` override, so it fully honours that header. Fixed: `GET /api/running-plan` now sends
`Cache-Control: private, no-store` — the app's own TTL+invalidation layer already provides real,
correctly-invalidated caching, so the HTTP-cache layer was redundant and actively wrong once
multiple state changes within seconds became routine (the carousel). **Worth a sweep**: any other
route with a `max-age` Cache-Control whose data can change multiple times within that window via
rapid user action (not just occasional writes) is a candidate for the same bug — not audited
this session, flagged for a future pass.

Verified with a `page.waitForResponse`-driven Playwright script (deterministic, not
timeout-based) — pick a type → confirm the override response and rendered card agree → adjust
duration → confirm again → reload and wait specifically for that GET → confirm it still shows the
override instead of reverting. Not device-verified (same caveat as the rest of this domain;
nothing here touches native code).

### [cardio] Skip → choose your run; default session time in plan setup (v1.245.0, 2026-07-30)

Follow-up to the v1.244.0 entry below, same session. The owner wanted skip to offer a real
alternative rather than just leaving, and the session-time picker moved into plan setup:

- **`RunTypePicker`** (new, above the prescribed-run card on `/running`): a ±10 min duration
  stepper + a Recovery/Easy/Long/Tempo/Interval chip row. Selecting either POSTs to the new
  `/api/running-plan/override`, which re-prescribes today's run via `prescribeOverride()`
  (`lib/running/prescription.ts`) — the **same recovery-gate pipeline** as the framework's own
  pick, so a manual choice still can't bypass the interference/readiness/monotony/sleep safety
  checks. "Skip" is unchanged and still available as the no-thanks fallback.
- **`PlanSetupSheet`'s default session length** is no longer gated behind choosing "Fixed time" —
  every new plan now saves `timePerSessionMinutes`, seeding the stepper above.
- **The hub's "How much time do you have?" button is hidden once a running plan exists**
  (`ModalityPicker`, gated on `!hasRunningPlan`) — with a plan, the default time + the new
  per-session adjuster on `/running` cover the same job.

⚠️ **Two real bugs found by testing this feature, both fixed in the same PR:**
1. `GET /api/running-plan` always recomputed the prescription fresh from the framework, so
   reloading right after an override silently reverted the display to the AI's original pick.
   Fixed: GET now checks whether today's persisted row carries the override marker
   (`OVERRIDE_RATIONALE_PREFIX`) and, if so, builds the response from the persisted row instead
   of recomputing. **Caveat:** `gateReasons` (never persisted) come back empty on an overridden
   day — `gateAction` still reflects the gate's outcome, but the explanatory sentences are lost
   until the row resets (next day, or the run completes).
2. A slow initial-load GET could resolve *after* a faster override POST and clobber it back to
   stale data — fixed with a monotonic request-sequence ref (`requestSeqRef` in
   `running-plan-content.tsx`) so only the most-recently-fired request's response is ever applied.

Verified via curl (override → repeated GET, confirms the choice sticks) and a full Playwright
pass against the local dev DB (create plan → pick a type → adjust duration → reload → still
shows the override → skip → "Back to Cardio" still works → hub button confirmed hidden). Not
device-verified — same caveat as everything else in this domain; nothing here touches
native/Capacitor code, so risk is low, but the on-device APK path is unexercised.

### [cardio] Running-screen polish: bests card, daily zone view, skip fix, run leave-guard (v1.244.0, 2026-07-30)

Four small, independently-verified gaps found against the already-shipped cardio redesign (the full
system was designed and phased in `docs/superpowers/specs/2026-07-26-cardio-system-spec.md`, closed
with no open decisions, and Phases 1–6 mostly landed 2026-07-26→30 — this was a gap sweep against
that work, not a new design pass):

- **`/running` now shows an all-time bests card** (best 1K, best 5K, best avg pace, longest run) —
  `GET /api/running-bests`, `computeRunningBests()` in `lib/health/cardio-trends.ts`. Reuses
  `activity_logs.bestEfforts`/`avgPaceSecPerKm`, already computed per-run and previously unrendered
  anywhere. Dev-DB-verified with a seeded run row + Playwright screenshot.
- **The Cardiovascular hub's zone quota now has a Today/This week toggle** — `ZoneQuotaCard` took a
  `dayQuota`/`weekQuota` pair instead of one `quota`; `/api/cardio-week` divides the weekly framework
  target by 7 for the daily row. Steps already had this split; zone minutes didn't (Finding 2 in the
  2026-07-26 redesign brief). Dev-verified both toggle states render correct numbers.
- **Skipping today's run was a dead end** — `RunningPlanContent`'s skipped/completed state had no
  navigation; added a "Back to Cardio" button. Verified end-to-end (skip → button → lands on
  `/cardio`) via Playwright.
- **The run/activity screen had no leave-confirmation guard** — guided walk and workouts already
  confirm before a hardware-back or bottom-nav tab-away mid-session; `/activity` (run, treadmill, any
  GPS/manual activity) had none, so navigating away silently discarded an in-progress recording.
  Added `isActivityActive()` (`lib/stores/activity-store.ts`) + `LeaveActivityDialog`, wired into
  `mobile-auth-handler.tsx`'s backButton listener and `bottom-nav.tsx`'s tab-click guard, mirroring
  the existing `isGuidedWalkActive`/`LeaveWalkDialog` pattern exactly.

⚠️ **The leave-guard is NOT verified on device** — same caveat as every other hardware-back-button
guard in this codebase (`docs/domains/cardio/README.md`); the sandbox cannot generate Samsung's real
back gesture. `TabSwipeNavigator` (edge-swipe) still does not guard walk OR the new activity case —
pre-existing gap, not newly introduced, left as-is to avoid scope creep on an unrelated file.

**Deliberately not built this pass:** D-14's optional "beat-your-last" walk distance goal (closed
decision, but never actually wired into `walk-config.tsx`/`walk-active.tsx` — grepped, no match) —
flagged, not implemented, since it wasn't explicitly requested. The "How much time do you have?"
button's placement on the hub (vs. woven into the Run/Walk/Activity cards) is unresolved — it's
already where the closed spec (D-9) puts it, but the owner's original complaint about its position
was never fully disambiguated.

### [cardio] Guided walk Android status-bar pill (v1.243.1, 2026-07-29) — NOT verified on device · needs: android
`walk-active.tsx` now calls the existing `AndroidRunChip` native bridge (`lib/native/run-status-chip.ts`)
on every guided-walk phase change. No Kotlin was touched — this reuses the bridge already shipped for
the running screen's duration chip. Verified via dev-server Playwright: started a walk with mocked
geolocation, the active-walk screen rendered correctly with no new console/page errors — the bridge is
undefined in the web sandbox so the calls silently no-op, exactly as designed. **Not verified:** the
actual native chip on-device — real promoted-notification rendering in the Android 16 One UI Now Bar,
the phase-to-phase re-anchor, tap-to-reopen, and the countdown→overtime flip. Compile-gated only in
this sandbox (no Android SDK, no APK rebuild available this session).

### [readiness] Nightly temperature now uses 0x75 alone — a defensible measurement, not the ring's behaviour (v1.243.0, 2026-07-30)

Q-2 shipped: the rollup no longer flattens a frame's simultaneous probes into consecutive "samples"
(631 frames had become 2,398 samples on 631 timestamps), and no longer mixes `0x46`/`0x69`, whose
middle value sits on a 0.5 °C grid in 98.3% of 30k rows — the reason 19 of 21 nights read as exact
whole degrees and `tempZ` / readiness's `bodyTemperature` had no discriminative power.

⚠️ **Which decoded stream the ring itself consumes is still unknown.** `nightly_temperature_calculate
@ 0x203520` is an address in the Oura app binary and is not covered by `open_oura`, so the choice of
`0x75` rests on the empirical comparison in the plan (the only variant tested that yields a
non-quantised result), not on protocol. Treat the nightly value as our measurement, not as a
reproduction of Oura's.

⚠️ **The prod comparison could not be re-run in-sandbox** — no reachable prod data, and the local seed
has no `oura_raw_samples`. The first real re-aggregation is the check: nightly values should stop
landing on exact whole degrees. If they don't, the median convention is the first thing to look at.

Note the plan's "needs a redecode pass" is **retracted** — `0x75` already decodes to `temps_c` and is
already in `ROLLUP_TAGS`, so past nights recompute on the next `aggregateOuraRawSamples` run with no
owner-run step.

> **Every heading below is tagged with its domain(s)**, primary first, using the eleven pillar slugs
> from [`docs/domains/README.md`](docs/domains/README.md). To pull just one pillar's issues:
> `grep -n '^### .*\[sleep\]' projectOverview.md`. Counts today — devices 45 · workouts 39 ·
> cardio 36 · platform 30 · app-shell 18 · sleep 14 · activity 14 · heart-rate 12 · readiness 9 ·
> nutrition 6 · body 2 · cross 3. **A new entry must carry its tag(s)** — an untagged heading is
> invisible to every per-pillar sweep. Each pillar's index
> (`docs/domains/<pillar>/README.md`) links back here with that grep.

### [app-shell] Edge-swipe tab navigation stays live on the four health detail screens (2026-07-29)

`activeTabIndex()` (`components/shell/tabs.ts:29`) maps **any** `/health/*` path to the Health tab,
so on `/health/{readiness,heart-rate,sleep,activity}` the bottom nav highlights Health and
`TabSwipeNavigator` treats an edge swipe as a tab flip: a left-edge swipe fires
`navigate(-1)` → Home, a right-edge swipe fires `navigate(1)` → `/workout`. On Samsung gesture
navigation the back gesture *is* an edge swipe, so on these screens the back gesture can be consumed
as a tab change rather than a history pop — two different handlers racing on one gesture.

Found while fixing the dead back button (v1.241.2); **not fixed there** because it is a shell-layer
behaviour, separate from the tap-target bug that was reported, and the correct treatment (should a
non-tab detail screen under a tab prefix disable tab-swipe? does `activeTabIndex` need a
"detail screen" concept?) needs a decision rather than a patch.

**Not reproduced on device** — the sandbox cannot generate Samsung's system back gesture; this is
read off the code path, not observed. It is the leading candidate for the owner's report that back
from a home circle "takes you to home sometimes or health", which the v1.241.2 fixes may or may not
have fully resolved.

### [platform] `/mobile-signin` is behind the auth gate, which likely breaks first-run APK sign-in (2026-07-29)

`components/google-sign-in.tsx:29` opens `https://…/mobile-signin?challenge=<sha256>` in a system
browser to start the Capacitor OAuth flow. But `/mobile-signin` is **not** in `middleware.ts`'s
`PUBLIC_PATHS` — `"/mobile-signin".startsWith("/sign-in")` is `false` — so it is guarded like any
other route.

**Measured** against `pnpm dev`: unauthenticated `GET /mobile-signin?challenge=abc` → `307
/sign-in`, and the `challenge` param is dropped. That is the exact state of a fresh install, where
the system browser holds no Railway session. Without the challenge there is no PKCE binding, so
`/auth-mobile-bridge` is never reached and the `trainingai://` deep link that hands the APK its
session never fires. The flow would only work when the system browser *already* has a valid session
for the Railway origin.

**Not confirmed on device** — the sandbox can't run the APK, and it is possible something about the
real flow (a browser that already carries a session from a previous sign-in) has masked this. That is
also why it may have gone unnoticed: it breaks *first* sign-in, not subsequent ones.

**✅ FIXED 2026-07-30 (v1.242.3)** — `/mobile-signin` added to `PUBLIC_PATHS`. It grants no authority
`/sign-in` doesn't already grant: the page's only action is `signIn("google")` (re-read to confirm
before applying). A/B measured against `pnpm dev`: unauthenticated
`GET /mobile-signin?challenge=abc123` returned `307 → /sign-in` with the param dropped before the
change and `200` after, while a control route (`/health`) still `307`s — so the gate itself is intact.

⚠️ **Still not confirmed on a real first-run install**, which is the only way to prove the whole PKCE
chain end-to-end: a fresh APK install whose system browser carries no Railway session, through Google,
to the `trainingai://` deep link handing the app its session. The middleware half is verified; the
chain beyond it is not.

### [platform] ⚠️ Local SQLite open-path recovery (Q-37) is NOT verified on device (2026-08-02) · needs: android

**Was:** three faults compounding on every launch of the owner's S25, visible in the device console.
(a) `PRAGMA journal_mode=WAL` went through `execute()`, which cannot return rows — the pragma
*returns* one, so the call always threw and **WAL has never been enabled on this device**.
(b) The v13 `ALTER TABLE mutations_outbox ADD COLUMN attempts` failed with "duplicate column name"
on every launch; the fallback reopened at version 1 but never stamped the version forward, so the
poisoned upgrade was retried forever. (c) A leaked connection registration
("Connection trainingai already exists") was misdiagnosed as an upgrade fault and pushed down the
version-1 fallback path. Separately, `applyDelta` sat outside `pullPage`'s try, so a device-side
schema fault surfaced as the same generic "Sync failed" toast as a network failure — and so did a
plain backoff window, which is not a failure at all.

**Now:** WAL is set through `query()` and the resulting mode is checked; a stale registration is
closed before opening; `reconcileSchema()` reports whether it fully succeeded and the schema version
is stamped forward **only** after a clean reconcile (stamping a partial one would retire the repair
path with work outstanding); `applyDelta` failures are caught, logged, and reported as a failed page
so the caller's existing backoff applies; and a backoff window gets its own toast copy.

⚠️ **NOT VERIFIED ON DEVICE — this is the gate this row exists to record.** `getLocalStore` returns
`null` in the web sandbox and `initSQLite` early-returns when the Capacitor plugin is absent, so
**none of this code executes under `pnpm dev`** — the dev-server run only confirmed the app still
compiles and `/session-select` renders. This is the file that has silently killed the local DB twice
(WAL-in-transaction #27, non-idempotent ADD COLUMN #85). What still needs an on-device pass:
WAL actually reporting `wal`; the v13 upgrade no longer failing on launch; `user_version` stamped to
21; and no "Connection trainingai already exists" on a cold start.

The version stamp's safety rests on the `RECONCILE_COLUMNS` mirror test in
`lib/sqlite/__tests__/migrations.test.ts` being exhaustive — it was made case-insensitive in the
same PR, since a lowercase `alter table … add column` would otherwise escape the guard and be
retired unrepaired.

### [platform] Deactivating a user takes effect within ~24h, not instantly (v1.246.2, 2026-07-30)

**Was:** `auth.config.ts` set `token.isActive` only when a `user` object was present — i.e. at
sign-in — so a user deactivated afterwards kept `isActive: true` in their JWT and `middleware.ts:18`
(the only enforcement point) let them through until the token was re-minted, up to 7 days.

**Now:** `auth.ts`'s jwt callback re-reads `isActive` from the DB via `refreshIsActiveClaim`
(`lib/auth/is-active-refresh.ts`), throttled to once per 24h per user. The check cannot live in
middleware — that runs on the Edge runtime and imports the deliberately Node-free `auth.config.ts`
("no bcrypt, no pg") — so it lives in the Node config and middleware reads the claim it refreshes.
It is a claim refresh, not a re-authentication: a continuously-active user is never signed out or
re-prompted (covered by a test that walks a week of hourly use and asserts 7 lookups, claim always
true).

⚠️ **Residual, accepted by the owner:** the window is bounded, not closed — deactivation can take up
to a day to bite. Closing it fully would mean a Node-side re-check at a server choke point (root
layout / a shared `requireActiveUser()`), costing a DB query per server render; judged
disproportionate for a small invited-user app.

⚠️ **The 24h flip was not observed end-to-end.** The refresh logic has 8 unit tests, and sign-in,
guarded routes and the session payload were verified unaffected against `pnpm dev` — but watching a
real token cross the 24h boundary needs either a day or a faked clock, and neither was run. A DB blip
during the re-read leaves the claim untouched and does not advance the timestamp, so it retries.

### [app-shell] Screen transition timing + prefetch (v1.241.1, 2026-07-29) — NOT verified on device · needs: android
The view transition's early-resolve was dead code — `pendingRef` lived on the component that called
`push()`, which unmounts on navigation, so every push fell through to the timeout cap regardless of
how fast the route was (measured: route ready at 51 ms, screen frozen until 184 ms). Commit is now
detected by polling `location.href`, which has no React lifecycle coupling. Plus `router.prefetch`
on the four health score circles and their sibling surfaces, and a sequenced (rather than
simultaneous) cross-fade so two dense screens no longer superimpose mid-animation.

Measured in Chromium at 412×915 under a 150 ms RTT / 4 Mbps CDP throttle standing in for the mobile
link to Railway: time-to-motion 190/213/211 ms → 118/129/118 ms across warm runs, and it now tracks
the route commit rather than a fixed floor. **Chromium is not Samsung's WebView** and the throttle is
a stand-in, not a measurement of the real link — so the felt result on the S25 is unconfirmed. The
25%/40% fade split, the 200 ms duration and the 30 px displacement are all judgement calls made
against a slowed desktop capture and are one-line changes in `globals.css`.

### [cardio] Guided walk per-segment stats (v1.240.0, 2026-07-29) — NOT verified on device · needs: browser
The new `activity_logs.segments` column and the walk-complete screen's HR-zone-colored map/
fast-slow average cards were verified via Playwright against the dev server: a real 10-segment
array with correct per-segment pace/distance saved (`POST /api/activity-logs` → 201), the map and
average cards rendered correctly. Two things weren't exercised: **real HR-zone-colored route
segments** — this sandbox has no live HR samples, so `zoneSegments` correctly fell back to the flat
single-color line rather than actually painting per-run zone colors; and **the native offline-first
path** — `getLocalStore` returns null in the web sandbox, so only the web-fallback save (not
`upsertActivityLog`/local SQLite/`applyDelta` pull-sync) was exercised for the new column.

### [sleep] ⚠️ Two staging changes shipped but NEVER observed on a real night (2026-08-02, v1.251.0 / v1.251.1)

Q-34 item 3 added `spo2Var` — within-epoch SpO₂ spread — as a fourth REM/wake signal in the
heuristic stager (`W_SPO2 = 0.2`). **Two things about it are unknown and only the device can answer
them**, because `aggregateOuraRawSamples` needs real `oura_raw_samples` rows and the local database
has none:

1. **Whether the column is populated at all.** The spread is gated at ≥ 5 valid SpO₂ readings inside
   one 5-minute epoch, and the ring's oximeter cadence over BLE has never been measured against that
   bar. Mostly-blank is a real possible outcome.
2. **Whether it discriminates.** If populated values are weakly bimodal, that is the same negative
   result `brVar` gave in session 246.

**Risk is bounded, not zero.** The term is self-neutralising by construction — a null z-scores to 0,
and a uniform column has no spread for the per-night z-score to read — so a quiet oximeter leaves
staging exactly as it was, and a unit test pins that. What is genuinely unverified is the *populated*
case: if the column is dense but noisy it will perturb REM/light boundaries on real nights before
anyone has looked at it.

What WAS verified in-sandbox: the pure spread function (sample floor, artefact rejection, ranking),
the self-neutralising path, and that the term is genuinely read (a night differing only in its
`spo2Var` column stages differently; the test fails with `W_SPO2 = 0`).

**A second change rides on the same device check: the ultradian cycle prior (v1.251.1, Q-34 item 2).**
Sleep staging now expects REM to recur on a ~95-minute grid rather than ramping linearly across the
night (`W_CYCLE = 0.15`, modulating the existing `W_TIME` term rather than replacing it). Its pure
prior function is unit-tested, but **no stager-level behavioural test ships with it** — three were
attempted and every one passed with the weight zeroed, so none proved anything. Its effect on a real
night is therefore entirely unobserved, and the plan names a concrete failure mode: a fixed period
can fight the Viterbi bout decoder on a fragmented night. The revert is deleting two addends.

Clear this row from the device check on the owner checklist in
[`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](docs/handoff-2026-08-02-platform-batch-queue-drain.md)
— Redecode a night, read the `spo2V` column in the admin debug dump. Do not tune `W_SPO2` before
that answer exists; the verdict belongs in
[`docs/oura-ble-sleep-staging-findings.md`](docs/oura-ble-sleep-staging-findings.md).

### [workouts] Exercise Readiness rework (v1.235.0, 2026-07-29) — NOT verified on device · needs: browser

Driven end-to-end in a real browser at an S25-shaped 412×915 viewport (all four sections render, the
body map tracks the pills, Sick/Unwell warns, Quick rebuilds the plan and the stored estimate fell
38 → 24 min). **But the browser is not the device.** Unverified: Samsung WebView rendering of the
body-map SVG inside a bottom sheet, real safe-area insets, and haptics. The sheet deliberately adds
no `pb-safe` of its own — `SheetContent side="bottom"` owns the bottom inset — but that is reasoning,
not an observation.

Auto-marking WAS exercised against a seeded recent session (chest at 57 % recovered opened pre-marked,
with the in-session warning), but **not against the real multi-week history**. The safety argument —
8 of the last 10 production sessions share zero muscles with the session before, so this usually marks
muscles that aren't trained today and changes nothing — is a measurement of the data, not an
observation of the UI running on it. On the first real check-in, confirm the auto-marked muscles match
what you actually trained, since a marked muscle in today's session lightens those exercises.

Note the `LAGGING_RATIO` and realisation-phase caveats in the role-ordering row below still apply, and
now matter more: the short/long presets are the surfaces where weekly-volume rebalancing is most
visible.

### [devices][body] Scale passive-scan background sync (v1.246.9 → v1.249.1, 2026-07-30/31, 2026-08-01) — persistent connection + dedup fixes, PARTIALLY verified on device
Reworked `ScaleBleService` from a continuous 45s-poll foreground service (always-visible
notification) to a `BluetoothLeScanner`-PendingIntent scan (`ScaleBleScanManager`) that only wakes
`ScaleScanReceiver`/the service when the paired scale actually starts advertising — see the Latest
Feature entry above for the full mechanism.

The retry-storm cooldown (v1.242.0) initially looked confirmed via a `chrome://inspect` capture
(real weigh-in succeeded, a repeat scan match was correctly suppressed, cooldown correctly
suppressed the next wake) — **but the wake episodes kept recurring indefinitely on a steady ~3
minute cycle even hours later**, which an independent BLE scanner (nRF Connect) proved was NOT the
scale: it only appears in a neutral scan while someone is actually stepping on it. The earlier
"scale re-advertises on its own / motion-sensor wake" theory in this entry was **wrong** — root
cause is that Android's `PendingIntent`-based scan can redeliver a stale `ScanResult` well after
the real advertisement stopped, and `ScaleScanReceiver` trusted "the broadcast fired" alone as
proof of a live weigh-in, with no check on when the match was actually seen. Fixed by reading each
`ScanResult.timestampNanos` out of the intent extras and discarding the broadcast unless at least
one result is within `MAX_RESULT_AGE_MS` (5s) of now — **confirmed on-device 2026-07-30**: the
owner rebuilt and the endless-loop bug is gone, every wake now resolves within a bounded couple of
attempts.

That same test surfaced a smaller, real side effect of the v1.242.0 cooldown: the scale genuinely
(not stale-filtered) keeps re-advertising for a short post-use settling period after a real
weigh-in, which triggers one bounded retry cycle that gives up and starts the cooldown — and the
owner's deliberate second weigh-in ~2 minutes later landed inside that 2-minute window and was
silently missed. `GIVE_UP_COOLDOWN_MS` cut to 20s (see Latest Feature) since a real weigh-in always
succeeds on its first attempt regardless of cooldown length. Also added `notifyWeighInLogged()` —
a plain successful weigh-in previously produced no lasting confirmation once the transient
"syncing…" notification disappeared. **Not yet verified on-device** — needs the owner to rebuild
and re-run the back-to-back-weigh-in test.

That rebuild+test surfaced a third bug: the very first connection of a fresh app session could
reach `state=waiting` and then receive zero `FFE1` notifications at all (not even unstable) for the
full 30s timeout, despite the owner standing on the scale the whole time (confirmed via the scale's
own countdown) — the very next connection in the same session worked immediately. Theory (see
Latest Feature): the `FFE1` notify-subscribe write can silently fail to take on a fresh GATT
session without `onDescriptorWrite` noticing, matching this codebase's documented Samsung-BLE-stack
flakiness elsewhere (the Oura ring). **Not a regression from #929/#937** — `ScaleGattClient.kt`
hasn't changed since the original integration (#848); what changed is connection frequency, since
pre-#929 stale-scan replays triggered a real reconnect every ~3 minutes and incidentally kept the
BLE stack warm, masking this cold-first-connection case that #929's fix now exposes as the normal
case. Added an 8s early-data watchdog in `ScaleGattClient` that gives
up and lets the service reconnect with a fresh GATT session if zero notifications arrive that
quickly, instead of waiting the full 30s.

**Owner rebuilt and re-tested (2026-07-30): the watchdog did NOT fix it** — a fresh weigh-in still
timed out at the full 30s with no visible notifications, twice in a row, and the new watchdog's own
log line never appeared. Source confirmed correct (owner's local `main` checkout had the merged
fix). Root cause of the miss, found on review: `onCharacteristicChanged` calls
`cancelEarlyDataTimeout()` unconditionally for *any* `FFE1` notification, including one that then
fails `ScaleProtocol.parseWeightPacket` and hits its own `return` with **no log line at all** (the
"malformed or the auto handshake frame" case the original code comment already knew about). If the
scale sends exactly one such frame right after subscribe — proving the subscribe worked — the
watchdog retires silently, and if no genuine weight packet ever follows, the connection then sits
out the full `WEIGH_IN_TIMEOUT_MS` with a console trace indistinguishable from the original
zero-notification bug. Added a log line for that swallowed case (`fix/scale-ble-handshake-frame-watchdog-log`,
diagnostic only — no behavior change) so the next on-device run can confirm or rule this out.

**Confirmed by owner's next test (2026-07-30, 4 weigh-ins within ~1 minute):** the scale reliably
sends an always-11-byte unparseable frame as the first `FFE1` notification on every connection,
before any real reading. 2 of 4 attempts got real data right after it and succeeded; 1 of 4 got only
that frame and then genuine silence for the rest of the 30s — the exact bug, now proven rather than
theorized. (The 4th attempt failed a different way — `connectionStateChange status=19`, the scale
itself terminating the connection mid-measurement — logged as a separate, not-yet-investigated
failure mode; the existing 2-attempt-then-cooldown retry policy already absorbed it correctly.)
Real fix: `onCharacteristicChanged` now re-arms the early-data watchdog when it sees an unparseable
frame instead of retiring it for good, so a connection that stalls right after the handshake frame
still bails within `EARLY_DATA_TIMEOUT_MS` of *that* frame rather than sitting out the remaining
~22s. The outer `WEIGH_IN_TIMEOUT_MS` runs as an independent, never-reset timer, so this can't push
a stalled connection past the original 30s ceiling regardless of how many junk frames arrive.
**Device-verified 2026-07-30.** Owner rebuilt and retested: a real weigh-in registered normally
(handshake frame, then immediate unstable → stable data). Separately, the scale's own post-weigh-in
settling re-advertisement triggered a fresh connection that got only the handshake frame and then
genuine silence — and this time it printed `"no data within 8s of request — notify subscribe likely
failed, retrying"` and bailed after 8s, instead of the old 30s `weigh-in timeout`. That's the fix
firing exactly as designed, live on-device, not just in theory.

**Reframed root cause (2026-07-30), from the owner's actual test procedure:** step on the scale →
wait for its own display to say "complete" → check the phone → nothing yet → step back on → that's
when a reading landed. Combined with the handshake frame appearing in **100% of captures so far**
(success and failure alike), this points away from "notify-subscribe sometimes silently fails" and
toward a race: the scale's local measurement cycle finishes faster than the phone's full BLE
pipeline (scan-detect → connect → discover services → subscribe → write the request), so the
request often goes out after the person has already stepped off, with nothing new to report. Two
follow-up changes in `ScaleBleService.kt`: `notifyWeighInFailed()` (new low-priority notification —
"Weigh-in not captured — step on the scale again" — fires when a wake exhausts all attempts; this
path previously notified nothing at all, so a failed weigh-in and a successful one looked identical
from the notification shade), and `MAX_ATTEMPTS` bumped 2→3 with the retry notification text changed
to "Retrying — stay on the scale…" (one more bounded ~8-30s cycle to catch a delayed
re-engagement, explicit user tradeoff — accepted a longer worst-case wake for better odds of
catching it). **Not yet verified on-device.** Still open: the `connectionStateChange status=19`
mid-measurement disconnect (separate failure mode, no grounded theory yet), the `ScaleBootReceiver`
reboot re-arm, the two-phone household scenario, and whether the race theory should also drive a UI
change (explicit "stay on the scale a few seconds" guidance) rather than just service-level tuning.
Separately raised by the owner: whether the scale buffers recent readings for later pull (like the
official Renpho app appears to show). A real, independent third-party open-source client for this
exact scale family (`ronnnnnnnnnnnnn/renpho-escs20m`) confirms such a mechanism genuinely exists on
this scale family (`_OP_STORED_MEASUREMENT`, query commands documented) and, as a bonus, resolves
what our own always-11-byte unparseable frame actually is — their `_OP_UNIT_REQUEST = 0x12` opcode
matches our own Phase 0 note about a "handshake-identification packet... marker `0x12`" exactly, so
it's a display-unit request, not a stored-measurement record. Their command opcode family
(`0x20`/`0x22`-prefixed) doesn't match our own scale's confirmed, 4-times-verified live-measurement
opcode (`0x13`-prefixed) — different firmware/scale variant — so it isn't verified against our
hardware. **Update (v1.246.9): implemented anyway, as an explicit owner-authorized bet** (see the
Latest Feature entry above and `docs/superpowers/plans/2026-07-30-scale-stored-measurement-drain-
and-scan-latency.md` for the full reasoning) — written to fail silently if the guess is wrong, with
no server-side changes needed (reuses the existing `/api/scale-ble/samples` `measuredAt` field).
Backlog Q-36 removed since the "concrete next step" it described has now been taken; whether it
actually works is an open question for the owner's next on-device test, not a backlog item.

**Continued (2026-07-31 – 2026-08-01), owner-directed on-device iteration, no separate planning
PR — same arc, ten more rounds (#965–#974):**

- **False positive matches (#965, device-confirmed).** `ScaleBleService`'s FFE0 service-UUID scan
  filter matches any nearby BLE peripheral built on the same generic Bluetooth-serial module
  (fitness bands, LED controllers, OBD adapters, etc. all share the FFE0/1/2/3 pattern), not just
  the paired scale — confirmed on-device connecting to something that wasn't the scale at all,
  producing a misleading "step on the scale again" failure with nobody near it. Both the live
  (`ScaleForegroundScanner`) and background (`ScaleScanReceiver`) scan paths now additionally
  check the matched result's own MAC against the paired scale's stored `device_id` before acting.
- **Stale toast bleed-through (#966, device-confirmed).** Sonner's toast-update-by-id merges the
  old toast object into the new one; `toast.success/warning/error`'s `data` type omits `jsx`, so
  it could never clear the progress-bar `jsx` set by the in-progress toast — a frozen "Weighing
  you…" bar was rendering underneath the real result text. Fixed by rendering every weigh-in toast
  state (progress **and** result) via `toast.custom()`, so each call always sets a fresh `jsx`.
- **Scan latency tuning (#967)** — `MATCH_MODE_AGGRESSIVE`/`MATCH_NUM_ONE_ADVERTISEMENT` on the
  live Home-screen scan (safe now that scan is scoped to Home-screen dwell, not all-day), plus a
  diagnostic-only `scan_source` tag (live vs. background) to settle which scan path actually wins
  the race, next time it's needed.
- **FFE3 request-write back-and-forth (#968–#971), same-day reversal.** Raw hex logging (#968) of
  the previously "harmless" unparseable handshake frame surfaced a real disagreement with an
  earlier note, prompting closer investigation. #969 re-enabled the previously-disabled speculative
  stored-measurement drain write as a genuine second attempt. #970 made the live-measurement
  request (`FFE3`) write a *fallback* — subscribe-and-wait first, only write if nothing arrives
  within `EARLY_DATA_TIMEOUT_MS` — on the theory the write itself was resetting the scale's
  in-progress reading. **#971 reverted that the same day**: on-device testing showed deferring the
  write made the common case *worse* (stopped producing the sometimes-instant weigh-ins earlier
  iterations had), stronger evidence than the correlation that motivated the defer. Net effect:
  request-write timing is back to "write immediately after subscribing," same as the original
  integration, with `EARLY_DATA_TIMEOUT_MS` simplified back to a single-tier watchdog armed once
  per connection instead of twice.
- **Persistent connection, modeled on the Polar strap (#972, architecture change).** Previously
  each wake ran a bounded connect-attempt-then-disconnect cycle (`CYCLE_BUDGET_MS`, 12–16s). On-device
  testing kept finding "instant" weigh-ins only when a connection was *already* open (via nRF
  Connect, the official app, or a prior run of this app) and never torn down — i.e. this app was
  discarding a working link every time and paying the full reconnect cost on the next wake, not
  missing a handshake. `ScaleBleService` now holds the GATT connection open indefinitely once
  linked (`START_STICKY`, no auto-disconnect after one reading) and reports every weigh-in that
  happens on it, the same pattern `PolarStrapService` already uses for the chest strap.
  `MAX_ATTEMPTS` bumped 3→5 since a successful first link now pays off for the whole session
  instead of being thrown away after one reading.
- **Scoped to the Home screen (#973)**, since the connection is no longer self-bounding: the
  persistent link (and the aggressive live scan from #967) now stops outright when the owner
  leaves Home (`setHomeScreenActive(false)` calls `stopService`), and a background scan hit is
  ignored unless `ScaleForegroundScanner.isHomeScreenActive()` — keeping the new architecture's
  battery cost bounded to actual dwell time rather than "the app is open anywhere."
- **Two bugs that were direct consequences of going persistent (#974, NOT yet device-confirmed).**
  The scale itself retransmits an identical stable-weight packet up to 3× before going idle; with
  the connection no longer closed after one reading, each repeat was being treated as a brand new
  weigh-in and re-posted to ingest — `ScaleGattClient` now drops a stable reading matching the last
  one it reported within a short window. Separately, the scale disconnects on its own after a
  reading and `ScaleBleService`'s background reconnect was forwarding its
  CONNECTING/PREPARING/WAITING transitions to JS exactly like a fresh weigh-in, reopening the
  "weighing you…" toast with nothing left to weigh (and firing a spurious failure notification if
  that reconnect then timed out) — state forwarding and failure notifications are now suppressed
  for background reconnects following a capture, and only a genuine `onUnstableReading` reopens the
  cycle.

**Net effect of this round:** weigh-in reliability should be meaningfully better (persistent
connection catches readings the old bounded-cycle model was structurally likely to miss, false
device matches are gated out, duplicate postings and stuck toasts from the new architecture are
fixed) — but **the persistent-connection redesign itself (#972–#974) has no on-device confirmation
recorded**, unlike every earlier step in this arc which was explicitly rebuilt-and-retested before
the next theory was tried. This entire round is native Kotlin (`android/app/.../scale/*.kt`) —
compile-gated only in the sandbox, requires `npx cap sync android && ./gradlew assembleDebug` to
reach a real device. Per the Canonical Runtime device-verification gate, treat as **NOT verified**
until the owner rebuilds and runs a normal weigh-in, a back-to-back double weigh-in (the #974 dedup
case), and a Home→Settings→Home screen transition (the #973 scoping case).

**First real on-device rebuild (2026-08-01), via `chrome://inspect`:** a normal weigh-in captured
correctly (71.75 kg + impedance), and the #974 duplicate-reading dedup **is confirmed working** —
two repeat stable frames from the same weigh-in were correctly logged as "ignored — scale repeated
the same frame it already reported." But the stuck-toast fix was only half-effective: the scale's
post-reading disconnect (`status=19`) triggered a background reconnect through `onFailure()`'s
retry branch, which broadcasts `scaleStatus=retrying` **unconditionally** — that path was never
covered by the `hasCapturedThisWake` guard #974 added to `onState()` (guards a different call
site), so the JS toast reopened as "Still trying — stay on the scale…" right after a successful
capture, the same user-visible bug in different wording. Fixed by extending the same guard to the
`retrying` broadcast (and to the paired "Retrying — stay on the scale…" foreground-notification
update) in `onFailure()`. **Not yet re-verified on device** — needs another rebuild + the same
back-to-back weigh-in test to confirm the toast now stays on the success state through a
post-capture reconnect.

**Second rebuild (2026-08-01): the retrying-suppression fix is confirmed.** Same test — capture,
dedup-ignored repeats, `status=19` disconnect, `RETRY_GAP_MS`-timed reconnect — but this time with
no `state=retrying` line and no toast reopening. Separately, the owner raised a different concern
from the same test: connect/detect speed feels noticeably worse than the very first integration
(#848), describing a "prime the connection by stepping on once, then it's instant ~30s later"
workaround. Two responses, both native-only, not yet device-tested:
- **Restored the stored-measurement-drain request** (`ScaleProtocol.REQUEST_STORED_MEASUREMENTS_CMD`,
  `0x22 0x04 0x15`), which turned out to have been silently dropped: #969 (2026-08-01 08:19) added
  the write, #970 (2026-08-01 11:36, "defer FFE3 to a fallback path") rewrote `onServicesDiscovered`
  and dropped it as a side effect while doing something unrelated, and #971's revert of #970 never
  noticed it was gone. The receive side (`parseStoredRecord`/`onStoredReading`/`postStoredReading`)
  was never removed, so this was dead code with nothing left to trigger it. Restoring the write is
  the most direct fix for the owner's actual complaint — a missed live connection window currently
  just loses that reading instead of it being recoverable on the next connect.
- **Added stage-timing diagnostics** to `ScaleGattClient`, logging elapsed ms (from `connectGatt()`)
  at gatt-connected, services-discovered, notify-subscribed, measurement-requested, and
  first-FFE1-notification. Purpose is purely diagnostic — comparing a "cold" first connect's log
  against a "primed" one should show which specific stage the latency is actually in, rather than
  guessing between Home-screen-scoping races, GATT service-discovery caching, or something else.
- **On-device timing captured (2026-08-01), analysed, findings written up:** see
  [`docs/scale-ble-connect-latency.md`](docs/scale-ble-connect-latency.md). Headline: the entire
  ~950ms gap between a cold connect (2206ms to link-alive) and a warm one (1270ms) lives in raw
  GATT connection establishment, not in anything our own discover/subscribe/request code does. The
  "priming" the owner described is already what #972's persistent-connection design provides
  (holding the link open indefinitely once linked); the remaining constraint — the scale doesn't
  advertise at all while idle — is a hardware limit no app can pre-connect around. **Still open:**
  the captured "warm" sample was an automatic same-session reconnect after a peer-drop, not the
  originally-reported "walked away, came back 30s later" scenario, so that comparison is still
  needed; a parked idea to decompile the Renpho app's APK for connection-parameter differences
  (bonding, PHY/interval) is blocked pending the owner supplying the file.
- **Found from the same on-device session: the persistent connection produced a false "Weighing
  you…" toast on every Home-tab visit.** Confirmed from the captured log — a connection linked at
  `08.887` sat idle for 22s before the first real reading at `30.946`, with the toast showing the
  whole time. Root cause: `setHomeScreenActive` stops/restarts `ScaleBleService` on Home-tab
  focus/blur to bound its now-persistent battery cost to Home-screen dwell time, and a return to
  Home can re-link while the scale is still finishing its own post-use re-advertising — with
  nobody actually on it. `onState()`/`onFailure()` broadcast CONNECTING/PREPARING/WAITING/RETRYING
  to JS unconditionally on any such reconnect, with no way to tell "just re-linking" apart from "a
  real weigh-in in progress". **Fixed:** added `hasSeenActivityThisWake`, set only by
  `onUnstableReading` (real proof someone is on the plates) — gates the progress toast, the
  "Retrying…" state, and the `notifyWeighInFailed()` give-up notification, all previously keyed off
  bare connection state. Trade-off, accepted: a genuine step-on whose connect fails before ever
  receiving a real weight packet now also fails silently (no "Didn't catch that") — there's no BLE
  evidence to distinguish that case from a spurious reconnect, and the spurious case is far more
  common in practice. Kotlin-only (`ScaleBleService.kt`), no JS changes needed. **Not yet
  on-device tested** — needs a rebuild, then repeated Home-tab navigation with nobody on the scale
  (should show nothing) and a real weigh-in (should still show the toast, with a real-world
  imperceptible ~1s-or-less delay vs before, since it now waits for the first unstable reading
  rather than bare connection state).

### [cardio] Guided walk GPS/pace (v1.233.0, 2026-07-29) — NOT verified on device · needs: hardware
Live GPS tracking, the route map, and pace-primary UI in the guided interval walk were only
exercised via Playwright against the dev server with `navigator.geolocation` mocked — that drives
`lib/activity/gps-tracking.ts`'s **web** fallback (`navigator.geolocation.watchPosition`), never
the native `@capacitor-community/background-geolocation` path real devices use. End-to-end save
was confirmed real (a `POST /api/activity-logs` with real computed route/pace fields returned
201), and the no-GPS-fix degradation (indoor/treadmill walk, today's HR-primary layout) was also
confirmed to render without a crash. What's unverified: the native background-location permission
flow, whether GPS keeps reporting fixes with the screen off during a real walk, and real ring/strap
cadence running concurrently with real GPS movement.

### [workouts] Role ordering (v1.232.0 + v1.233.1, 2026-07-28/29) — clamp now observed firing; two knobs untuned

**Update (v1.233.1):** the earlier note here said the clamp had never been seen to fire. It has now.
The live Upper shape (accessory `5×7 @77.5 %` vs primary `4×7 @76 %`) was seeded into the local DB and
read back through the periodization route as **`4×7 @76 %`**, with the stored row unchanged — so both
the load cap and the set ceiling bind, read-side, without a write.

Also fixed in v1.233.1: the generation-time rule could not reach prescriptions **already stored**, and
production's Upper plan (generated 6 days before the rule shipped) was still serving the bad numbers.
Role caps now apply on read via `normalizeStoredPrescription`. Note the read path applies only the two
*absolute* rules (per-role set ceiling, anchor load cap) — **not** the anchor set cap, whose
lagging-muscle exception needs weekly-volume data the read path lacks.

Still worth watching rather than assuming:
- **`LAGGING_RATIO = -0.25` is an untuned guess.** It decides how eagerly role order breaks on volume.
  If accessories start routinely out-setting compounds, it is too close to zero.
- **The realisation-phase case is tested but not observed.** A realisation primary is deliberately
  low-set (3×2) beside legitimately high-volume isolation work; the lagging exception is what stops the
  rule stripping that volume. Covered by a unit test, not yet by a real realisation block.
- **`workout-data`'s weight-bearing output was not watched end-to-end** — the local seed has an empty
  `baseline_1rm`, so no weights are computed there. Same helper, same role map as the verified path.

Server-side only — no native surface, so no device verification is required for these changes.

### [workouts] Q-5 personal records vs starting weights (v1.231.0, 2026-07-28) — two known gaps
`personal_records` is now log-derived only; the starting 1RM typed in the builder lives in the new
`exercise_estimates` and finally reaches the bar via one shared `resolveWorkingBasis`. Verified
end-to-end on `pnpm dev`: a typed 100 kg produced `estimated1rm: 100` where it was previously null,
with `personal_records` confirmed untouched.

**Gap 1 — historical rows are still wrong.** 5 `personal_records` rows disagree with the best
surviving log (Barbell Bench Press 90.8 vs a real 96.0, Barbell Front Squat 67.5 vs 73.8, plus three
whose values appear in no log), and 5 near-duplicate spellings still split one exercise's best
across two rows. Correcting them **rewrites real user data**, so it is queued as **Q-5b** for
owner confirmation rather than merged here. New drift is prevented from today either way.

**Gap 2 — no offline mirror yet.** `exercise_estimates` has no local-store table, so offline an
exercise with only a typed estimate (no log) still resolves to null. Online-first flow, so the
common path is unaffected, but it is a real offline-first gap.

Also deferred: `computeInitialWeights` still has its `return 60` fallback. The resolver makes it
unreachable for any exercise with a log, PR or estimate — what is left is the genuinely-nothing
case, and changing what the weight input renders with no value wants an on-device look.

### [workouts][platform] Local exercise-library mirror (v1.234.2, 2026-07-29) — NOT verified on device · needs: browser
The on-device store now mirrors the exercise catalogue, so an offline read can tell a bodyweight
movement from a weighted one instead of assuming `weighted` (Q-20). Hydrated from the
`/api/workout-data` response; falls back to `weighted` for an exercise the mirror has not seen.

**Not device-verified, and that is the entire surface this change lives on.** `getLocalStore`
returns null in the web sandbox, so the v20 migration, the accessors, the hydration write and the
offline read all went unrun natively — only the pure logic and the server half were exercised.
Requires an APK rebuild.

Owner check: open the app once online so the mirror populates, then go offline and open a session
containing a bodyweight exercise (e.g. Pull-Up) — it should render a rep target, not a kg weight.
Also confirm no dead-store banner on first open after the v20 upgrade.

### [workouts] AI prescription silent auto-dismiss + generation moved to pre-workout (v1.247.0, 2026-07-30)

Owner noticed a phase-transition recommendation on a real "Upper" session showed
`AI Prescription · Accumulation · Dismissed` despite never having tapped Move or Skip. Traced via
`POST /api/admin/db-query` against production: the prescription was generated 2026-07-22, its 7-day
`prescription_expires_at` lapsed 2026-07-29 with nobody having acted on it (the owner hadn't reopened
that specific session in the interim), and the very next open — `GET
/api/ai-periodization/session/[id]` — silently flipped `pending` → `dismissed` with no prompt. Root
cause: two auto-dismiss-on-expiry code paths (that GET route, and `workout-data`'s equivalent) existed
specifically so a stale phase decision couldn't linger — but "linger" was resolved by silently
deciding *no* on the owner's behalf, which is worse than lingering.

**Fix (three parts, one PR):**
1. **No auto-expiry, anywhere.** Removed both auto-dismiss-on-expiry blocks
   (`app/api/ai-periodization/session/[sessionId]/route.ts`, `app/api/workout-data/route.ts`) and the
   matching `expired` gates in `app/api/next-session/route.ts` and
   `app/api/next-session/prescription/route.ts` that mirrored them. A `pending` prescription — phase
   transition, deload, or otherwise — now only ever changes status on an explicit Move/Skip/Accept/
   Dismiss. `prescriptionExpiresAt` is still stored (harmless) but nothing reads it for gating anymore.
2. **Generation moved from session-end to pre-workout-open**, closing the staleness problem at the
   source rather than papering over it with an expiry: `regenerateNextPrescription` and its two callers
   (`app/api/complete-workout/route.ts`, the offline-outbox `complete_workout` branch in
   `lib/data/postgres/adapter.ts`) are deleted. `completeWorkoutFromPayload` just marks the slot
   `consumed`; the existing `isAiPrescriptionPending` on-open trigger (previously the Gemini-outage
   retry path) is now the only generation trigger, so a prescription is never more than minutes old by
   the time it's acted on. This reverses the 2026-07-20 "generate at session end" decision — see that
   entry's history for why it existed (a blank "Auto" chip on the Health card) — because the owner
   confirmed that chip distinction is redundant (auto-apply is a single program-wide toggle) and asked
   for a more useful stat instead.
3. **`AiPeriodizationStatusCard`** (Health → Training) replaced the Auto/Ready/New status dot with
   "Nd ago" / "Yesterday" / "Trained today" / "Never trained" per session
   (`app/api/ai-periodization/program-overview/route.ts` now returns `lastTrainedDaysAgo` via the
   existing `getRecentSessionsOfType`, no new repo method).

**Verified:** full test suite green (2 new/updated test files, one pre-existing DB-test env quirk
unrelated to this change — see the DB-test note above), `tsc` clean, lint clean (pre-existing warnings
only), both Custom Rules checks pass. Exercised against `pnpm dev` on local Postgres with the exact
production shape reproduced (pending + `transition_recommended`, expired 2 days, `auto_apply_
prescriptions = true`): confirmed the GET session route and `workout-data` both leave it `pending` and
still drive load off it; confirmed completing a workout leaves the slot `consumed` with no eager
regeneration; confirmed reopening a `consumed` session sets `aiPrescriptionPending: true`; screenshotted
the Health → Training card showing "9d ago" / "7d ago" / "No data" in place of the old chip.

**NOT exercised:** the S25 APK — this is a server/web-route + React-card change with no
Capacitor/native/safe-area/gesture surface, so there is nothing native-specific to verify, but the
real on-device render has not been looked at.

### [workouts] AI prescription review (v1.230.0, 2026-07-28) — NOT device-verified; HR list never rendered with real data · needs: data

Everything shipped was exercised against `pnpm dev` on the local Postgres with the program flipped to
`ai_dynamic` and the production bad state seeded verbatim — real Gemini generation at all three
duration presets, a stored no-op transition normalising on read, a post-first-read soreness check-in
deloading and reverting, and the picker swapping live in a real browser at 412 px in both themes.
None of it has run on the S25 APK.

- **Per-exercise HR recovery is unit-tested only.** The local dev DB has no heart-rate readings, so
  `aggregateHrRecoveryByExercise`'s rendering (done screen + day-overlay sheet) has never been seen
  with real data. Eight unit tests cover the aggregation, including the negative-recovery case that
  motivated it (a set whose HR *rose* rendered as "↓-9 bpm/min ✓").
- **The done-screen cache-seeding is an APK surface** — `workout-recap:` / `workout-timing:` /
  `workout-energy:` / `workout-hr:` seeds and their invalidation need the on-device smoke run.
- **A `long` session fills only to the per-role set ceilings** (primary 6, secondary 5, accessory 4),
  so a small session tops out well under 90 min. Deliberate — deepening the AI's shape, not
  redesigning it. Adding exercises would be a separate feature.
- **Set-count plausibility across roles is not checked.** Production had Upper prescribing Skull
  Crusher 5×7 @77.5 % against Incline Bench 4×7 — an accessory outranking the primary on volume.
  Real, but it needs a role-ordering rule that doesn't exist yet; the effort-floor layer only
  partially governs it.
- **A short session doesn't re-balance the rest of the week.** Volume skipped today isn't
  redistributed to the remaining sessions; the weekly-MAV trim priority recovers most of it
  implicitly (what's skipped is under-target next session), but nothing does it explicitly.
- **RETRACTED — the "possible soft-delete" was a mid-sync read, not data loss.** The original note
  claimed the 2026-07-28 Push session showed 5/5 exercises and 14 sets on device while a
  `deleted_at IS NULL` query returned 4 and 12. Re-checked against production: **5 exercise rows and
  14 set rows, none deleted**. The discrepancy was entirely timing — the last exercise (Tricep Cable
  Combo, 2 sets) has `updated_at 08:54:14` and the query ran ~08:52, while the owner was still on
  the done screen. 5 − 1 unsynced = 4; 14 − 2 = 12, exactly. Offline-first behaved correctly: the
  device held the truth and Postgres caught up ~90 s later.
  **Method lesson for the data-quality review session** (`docs/data-quality-review-charter.md`): a
  query issued while the owner is actively training reads a moving target. Any device-vs-DB row-count
  gap must be re-checked after sync settles, and compared against `updated_at`, before it is written
  down as a finding.
- **`GET /api/ai-periodization/session/[id]` runs the full `aggregateSignals`** (~12 sequential DB
  waves) on every prescription-card load *and* every ~3s poll tick, though the card only consumes
  `signals.exercises`. A significant share of the "few seconds before the AI numbers appear" the
  owner reported. Not addressed here — trimming the payload is its own change.


### [devices][heart-rate] Ring de-escalation when the strap covers (v1.229.3, 2026-07-28) — NOT device-verified · needs: hardware
`lib/live-hr/manager.ts` now skips starting the Oura ring's aggressive live-HR loop during a
workout whenever the chest strap is already connected, with a 10s periodic re-check so a strap
that connects/disconnects mid-workout escalates/de-escalates the ring automatically. Pure JS —
`tsc`/`eslint`/the full unit suite are green, including rewritten and new manager tests exercising
the gating and the periodic re-check with fake timers. **What can't be verified in the sandbox:**
whether the ring's actual on-device battery drain changes, since that requires a real strap + ring
pair and a real workout. Owner should confirm on the S25: start a workout with the strap connected
and worn, and check (via the admin BLE console or just observed battery drain over a session) that
the ring's live-HR burst loop doesn't fire while the strap is covering.

### [cardio] Run status-bar chip (v1.227.2, 2026-07-27) — native chip NOT verified on device · needs: android
`RunChipBridge` (`MainActivity.java`) and the JS wiring were verified as far as this sandbox
allows: braces balance, every `@JavascriptInterface` signature matches what
`lib/native/run-status-chip.ts` calls, `RunActiveScreen` renders correctly with the chip effects
active (Playwright, injected active-run state, no new console errors), and the new "Run in Status
Bar" preference toggle persists across a reload. **The actual chip appearing in the Android status
bar / One UI Now Bar during a real run has never been exercised** — no Android SDK/Gradle in this
sandbox (proxy-blocked), so `./gradlew compileDebugJavaWithJavac` couldn't even compile-check it.
Needs an owner APK rebuild + on-device smoke test: start a distance-goal run and confirm the pill
shows live "X.XX / Y.YY km" text ticking on GPS fixes; start a duration-goal or freeform run and
confirm the pill counts down/up like the existing rest-timer chip; pause/resume and confirm the
chip clears then reappears with a correctly-shifted target; tap the chip and confirm it reopens the
app to `/activity`.

### [heart-rate] Max-HR resolver consolidation (v1.226.3, 2026-07-28) — target screens NOT verified on device · needs: browser
Max HR was resolved three different ways (`hrMaxFromAge`, `resolveMaxHr`, `estimateHrMax`); they
agreed only because the observed max sat below the age prediction, and the first reading above it
would have split them silently. `resolveHrProfile` is now the only resolver, and every observed
value is corroborated through `computeObservedHr` — previously two producers took a bare
`Math.max` over raw readings and one **persisted** it, so a single motion artefact became a
permanent ceiling that raised every Karvonen target with no way back down.

It returns two named numbers on purpose: `maxHr` (effort ceiling, never falls below the age
prediction) and `targetAnchorMax` (reachable targets, does use a lower observed max — anchoring
walk blocks on 220−age put the fast block out of reach without jogging). Collapsing them to one
would have regressed that.

**Not device-verified.** The two screens whose targets change — guided interval walk and the
fitness-test protocols — were not run on the S25; there is no live HR source in the sandbox. The
change is JS/server-only (ships via Railway, no APK rebuild) and the target math is unit-tested
plus proven end-to-end against seeded `oura_heartrate` rows on `pnpm dev`, but the on-device read
of the new anchors is unverified. Owner check: start a guided walk and confirm the fast/slow
targets are still reachable and haven't jumped.

**Known-by-design:** `body_battery_daily.hr_max_observed` rows written before this change are
still raw maxima. Nothing reads them as a max-HR override any more, so no value depends on them,
but they are not retroactively corrected — a future consumer must not treat historical rows as
corroborated.

### [devices] Chest-strap notification cap + battery readout (v1.226.2, 2026-07-28) — NOT device-verified · needs: hardware
`PolarStrapService` now gives up (stops itself, clearing the ongoing notification) after 6
consecutive connect failures instead of retrying at the 120s ceiling forever — the strap isn't
worn all day, so an unreachable strap almost always just means it isn't on, and the ring already
covers HR. It also reads the standard Battery Service once connected and shows `Connected · X%
battery` in the notification (mirrors the Oura ring service's pattern), exposed in `getStatus()`
too. **Native — requires an APK rebuild to take effect; nothing here ran against a real H10 or
Android's BLE stack.** Owner should confirm on the S25: the notification stops nagging after ~4
min when the strap is out of range/not worn, and shows the battery % once actually connected.

### [cardio] Elevation profile chart (v1.225.0, 2026-07-27) — local-SQLite sync path and real GPS elevation data NOT verified
Verified via a manually-seeded `activity_logs` row (`psql`) that the chart renders correctly on the
activity detail sheet. The local-SQLite write→outbox→sync→pull round-trip (Task 5 of the plan) was
only exercised via `tsc`/the offline-sync unit suite, never a real native SQLite write on-device —
and no real GPS route with elevation data has been recorded, since the sandbox has no device GPS.

### [cardio] Dedicated run execution screen (v1.222.0, 2026-07-27) — live HR NOT verified on-device
The new `RunActiveScreen`'s live HR + zone hero was verified end-to-end in the web sandbox (renders
correctly in its "waiting" state, no console errors), but live HR requires a real Polar strap or
Oura ring — not reachable in the sandbox. Also inherits `ActivityRouteMap`'s pre-existing,
out-of-scope limitation that the map viewport doesn't auto-recenter as new GPS points stream in
(react-leaflet's `bounds` prop is effectively mount-time-only).

### [devices][platform] D2 Task 1 — local-store Oura accessors (2026-07-27) — now has a caller path ahead of it
Added `LocalStore` read/write accessors for the on-device Oura tiers (`oura_daily_summary`,
`oura_daily_derived`, `oura_bucket`, `oura_heartrate`). Still inert — Tasks 2+3 above build the
raw store and the bridge that feed them, but the on-device rollup writer that will actually call
them is Task 6. No user-visible behaviour changed, so no version/changelog bump.

### [heart-rate] D5 own daytime-HRV (v1.220.1, 2026-07-27) — cold-start gate + NOT device-verified · needs: browser
Two distinct, real gates, not formalities:
1. **Cold start.** The model only exists after its first successful refit, which needs
   `MIN_TRAINING_SAMPLES` (50) night-time `0x5d` HRV buckets — realistically a few days of real
   overnight ring wear post-merge. Until then `getDaytimeHrvModel` returns null and daytime-stress
   contributes nothing to Body Battery, identical to today's behaviour — not a regression, but also
   not yet doing anything.
2. **Not device-verified.** The actual validation gate — a real H10 spot-check (wear both ring +
   strap, run **Admin → Oura BLE → own daytime-HRV vs Polar H10**) — hasn't happened, and can't
   until gate 1 clears (no model → nothing to compare). The design decision to gate the regression
   on MET rather than fit it as a feature, and the ±10ms tolerance band, are both first-principles
   choices pending this real-data check, not validated ones.
Owner action once gate 1 clears (a few days out): run the spot-check console and confirm the two
sources roughly agree.

### [cardio] Baseline anchors + push sessions (v1.218.0, 2026-07-27) — real push cadence and on-device NOT verified
The every-5th-session push detection and the 2%-beat-your-best distance bump were verified by
seeding 4 completed `prescribed_runs` rows (with GPS-bearing `activity_logs`) via `psql` and
backdating the plan's `created_at` so they fall within its lifetime — confirmed the 5th
`GET /api/running-plan` call correctly returns `isPushSession: true` with the bumped distance and
rationale, and that the "PUSH" badge renders on `/running`. Never exercised against a real 5-session
history built up over genuine calendar time. No native/offline-sync code paths touched (no new field
goes through the `prescribed_run` mutation domain), but the on-device (S25) smoke run per
`docs/device-smoke-checklist.md` hasn't been done.

### [cardio] Density-progression running framework (v1.217.0, 2026-07-27) — multi-week growth and on-device NOT verified
The framework's distance target grows `1.03 ** weekIndex` — confirmed correct via unit tests and a
manually backdated `running_plans.created_at` row, but never exercised against a real multi-week
user history (the local dev seed can't fast-forward calendar time). The completion round-trip (Start
→ active → Finish → Save → `prescribed_runs.status = 'completed'`) was verified end-to-end via
Playwright + `psql`, but this PR touches no native/offline-sync code paths, so the on-device (S25)
smoke run per `docs/device-smoke-checklist.md` hasn't been done.

### [devices] 🔴 Ring calibration captures were scoped wrong — fixed v1.216.1, prior ring data suspect
The console scoped a capture's ring windows as `ds >= newestDs − captureDs`, which assumes the
**newest window sits at the capture's END**. That holds only if a drain lands as the capture
finishes. In the owner's 150 bpm capture the drain arrived **16 s into a 147 s capture**, so the
filter reached 147 s *backwards* from a window near the start — roughly **87% of the "in-capture"
windows predated the walk entirely**, and the scatter they showed (81 / 115 / 139 / 159 spm) was
pre-capture history, not a ring failure at running cadence.

**This is the third time drain timing has corrupted a ring conclusion**, and the second time a
fix for it was itself wrong. Fixed by (a) requesting a drain **on capture stop** and waiting for
the burst, and (b) scoping by reconstructed **occurrence time** — anchoring `(newest ds ↔ its
arrival time)`, since a drain replays history *up to the present* — rather than by a ds offset.
Exports now carry `ringCoveredToSec` / `ringCoversCapture` so a partly-seen capture can never
read as a complete one.

**Consequence:** every ring number from a capture before v1.216.1 is only trustworthy if its
drain happened to land near the end. The 120 bpm capture qualifies (drain at 80% through) and its
ring/strap agreement stands; the 150 bpm capture does **not**, and says nothing about the ring.

### [cardio][devices] 🟡 Ring cadence is octave-ambiguous, not flat — still gated off (2026-07-27)
**Supersedes an earlier, wrong entry** that read "the ring DOES NOT track cadence". A
metronome-referenced capture overturned it: at a set **120 bpm** the ring's capture-scoped
windows were tight at **1.952 Hz → ×60 = 117.1 spm**, against a strap reading of **117.5** —
agreement to **0.4 spm** between two sensors that share no hardware and no code.

The signal is therefore not flat. Fitting all three counted captures against step-rate and
stride-rate (half) shows it locks onto **either**:

| counted | ring Hz | vs step rate | vs stride rate |
|---|---|---|---|
| 64 spm | 0.98 | −8% ✅ | +84% |
| 114 spm | 1.02 | −46% | **+7% ✅** |
| 120 spm | 1.952 | **−2% ✅** | +95% |

The 64 and 114 captures landed on **opposite sides of an octave split**, which is what made the
signal look flat when the two were compared directly. Same failure mode the strap DSP has, and
`bandAutocorrPeak` already corrects for it there.

**Still gated** (`RING_CADENCE_VALIDATED = false`) — one clean capture is not enough, and an
uncorrected octave error ships a number that is wrong by 2×, which is worse than none. The path
is now concrete: octave-correct the ring the way the strap already is, then re-validate across
counted cadences. `unpack27` column order remains a *possible* contributor but is **no longer
the leading suspect** — a wrong column would not track cadence at all, and here it does.

### [cardio] Cardio trends surface (v1.216.0, 2026-07-27) — only single-week/single-run data exercised; two trend views deferred
`/api/cardio-trends` (5 unit tests for the pure aggregation functions) and the Trends card's three
chart.js views are dev-server + Playwright verified against real local data (the same synthetic
GPS activity inserted for the session-visuals item's verification pass): the zone-stack, efficiency,
and cadence charts all render with correct colours in both light and dark theme, no console
errors. **What is NOT verified:** the seed only produced one week of zone data and one run, so the
zone-stack chart's cross-week rendering (multiple stacked bars side by side) was only confirmed via
chart.js config, not visually with >1 week of non-zero data; on-device Samsung WebView paint, same
caveat as every prior cardio-hub surface. **By design, not a gap:** "distance/pace vs anchor" and
"PR history" trend views are deferred until the baseline-anchor system (backlog item "Density-
progression engine") exists. Entry:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).

### [cardio][devices] 🟡 Ring cadence is octave-ambiguous, not flat — still gated off (2026-07-27)
**Supersedes an earlier, wrong entry** that read "the ring DOES NOT track cadence". A
metronome-referenced capture overturned it: at a set **120 bpm** the ring's capture-scoped
windows were tight at **1.952 Hz → ×60 = 117.1 spm**, against a strap reading of **117.5** —
agreement to **0.4 spm** between two sensors that share no hardware and no code.

The signal is therefore not flat. Fitting all three counted captures against step-rate and
stride-rate (half) shows it locks onto **either**:

| counted | ring Hz | vs step rate | vs stride rate |
|---|---|---|---|
| 64 spm | 0.98 | −8% ✅ | +84% |
| 114 spm | 1.02 | −46% | **+7% ✅** |
| 120 spm | 1.952 | **−2% ✅** | +95% |

The 64 and 114 captures landed on **opposite sides of an octave split**, which is what made the
signal look flat when the two were compared directly. Same failure mode the strap DSP has, and
`bandAutocorrPeak` already corrects for it there.

**Still gated** (`RING_CADENCE_VALIDATED = false`) — one clean capture is not enough, and an
uncorrected octave error ships a number that is wrong by 2×, which is worse than none. The path
is now concrete: octave-correct the ring the way the strap already is, then re-validate across
counted cadences. `unpack27` column order remains a *possible* contributor but is **no longer
the leading suspect** — a wrong column would not track cadence at all, and here it does.

### [cardio] Cardio session visuals (v1.214.0, 2026-07-27) — touch-drag scrub unverified on-device; elevation profile deferred
The hero HR/pace scrub chart, pace-per-km bars + best-efforts callout, zone donut, and dense
splits table are dev-server + Playwright verified against synthetic seed data (a GPS-tracked
activity log + matching HR readings inserted directly into the local Postgres instance for this
pass, since the base seed has zero `activity_logs` rows): the hero chart renders both HR and pace
lines, dragging the pointer across it moves a marker on the route map (confirmed by a Leaflet
marker-count change, 3→4→3, not just the unit tests), the non-GPS fallback (plain HR-only chart)
renders without crashing, and both light and dark theme show visible gridlines/text (the exact
canvas-colour hazard this item's Task 3 fixed elsewhere). **What is NOT verified:** (1) a real
Samsung WebView touch-drag gesture over the hero chart — the `touch-none` class is meant to stop
the drag from scrolling the sheet instead of scrubbing, untested outside desktop Chromium pointer
events; (2) populated real-world data — all verification used synthetic single-session seed rows,
not a real multi-week GPS history. **By design, not a gap:** a full elevation-vs-distance profile
chart is not included — `encodeRoute` drops the per-point `ele` field, so only the aggregate
gain/loss numbers persist; a real profile needs a new stored series + migration + sync-mirroring,
tracked separately as `feat/cardio-elevation-profile`. Entry:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).

### [cardio][devices] Cadence: slow-walk capture found 3 bugs; D-2 now supported at TWO cadences (v1.213.2, 2026-07-27)
Owner capture at 1.5 km/h, counted **64 spm** — the first below the old band floor. Three distinct
defects, all fixed:

1. **AD-2's walk/run bands were gating cadence.** `classifyGait`'s walk band starts at 1.4 Hz
   (~84 spm), so a real 64 spm walk classified **`idle`** and every window of it was discarded.
   Correct for "is this a walk worth detecting", wrong for "what is this cadence". Cadence now gates
   on **motion** (`hasGaitMotion`, new export) plus its own plausibility bounds; the band verdict is
   kept for reporting only. AD-2's bands are untouched.
2. **One octave mis-lock skewed the saved average.** A single window doubled to 140.8 among readings
   clustered at ~64; the **mean** reported 73.6 (+9.6), the **median** 63.8 (−0.2). `summarizeCadence`
   now uses the median — a mean has no defence against a single bad window.
3. **The console judged the capture against 19 minutes of unrelated history.** A drain replays the
   ring's whole backlog, so a 3.4-minute capture arrived with 19 min attached (mostly earlier, faster
   walking). The "locomotor median" reported **140.8 spm for a 64 spm walk** — the wrong walk
   entirely. Now filtered to the capture's own span using the ring's monotonic `ds` clock.

**D-2 (×60) is now supported at two very different cadences**, with errors bracketing zero rather
than sharing a sign — which is what noise around a correct factor looks like:

| truth | capture-period median | ×60 | ×120 |
|---|---|---|---|
| 96 spm | 1.7233 Hz | **103.4 (+7.7%)** | 206.8 |
| 64 spm | 0.9834 Hz | **59.0 (−7.8%)** | 118.0 |

Still short of confirmation (two points, both walking, ±8%). The remaining gap is a **high-cadence
(150+ spm)** capture — untested, and the regime where octave error is most likely.

### [cardio][devices] ⚠️ D-2 NOT closed — ×60 indicated by ONE window; an earlier entry over-claimed it
A 2026-07-27 entry declared the `stride_frequency` units resolved (steps/second, ×60) on the
strength of a single treadmill capture. **That was premature and is retracted.** The next capture
appeared to contradict it, and the reason is instructive:

| capture | truth | reported strideHz | window verdict | ×60 | ×120 |
|---|---|---|---|---|---|
| 2.7 km/h | 96 spm | 1.7233 Hz | **walk** (locomotor) | 103.4 | 206.8 |
| 4.0 km/h | 114 spm | 1.0739 Hz | **idle** — not the walk | 64.4 | 128.9 |

Read naively the second inverts the relationship (higher cadence, lower stride frequency). It does
not: 1.0739 Hz is below `WALK_HZ_MIN` (1.4), so that window is **idle** and describes whatever the
ring was doing then, not the walk. The console only ever showed the *newest* window, and the newest
is frequently a non-walking one — so the 30 locomotor windows that capture actually contained were
invisible.

**So exactly one locomotor window supports ×60.** Suggestive, not conclusive. Closing this needs
several captures at DIFFERENT counted cadences whose *locomotor* windows track the change.
**Fixed:** the calibration console now exports every ring window with its gait verdict
(`ringWindows`) plus the median stride-Hz across locomotor windows only
(`ringLocomotorMedianHz`, with both candidate conversions). AD-2's Hz bands and step_counter trust
remain gated on this.

**Ring accuracy** cannot be characterised until the above is settled — the earlier "~+7% high" figure
also rested on that single window.

### [cardio][devices] Cadence: strap band-pinning bug found on-device (v1.213.1, 2026-07-27)
**Second owner capture exposed a confidently-wrong strap reading.** A real 102 spm walk came back
as **71.4 spm, identical in every bin** — and an unvarying number is the tell, since real gait varies.
Root cause: `CADENCE_MIN_HZ` was 1.2 Hz = **72 spm**, sitting *above* the 60 spm `MIN_PLAUSIBLE_SPM`
floor, so any cadence below 72 was unreachable by the search and the autocorrelation argmax pinned to
the band edge — which was then reported as a measurement. Fixed two ways: the band now lies strictly
outside the plausibility bounds at both ends (0.9–3.9 Hz), so a reading is rejected for being
implausible *for a person* rather than for falling outside where we happened to look; and
`bandAutocorrPeak` now **rejects an argmax sitting on a band edge outright**. Regression-tested.

**The first capture passing (99.4 vs 102) did not catch this** — that walk was fast enough to sit
inside the band.

**Third capture (same session, fixed 2.7 km/h treadmill, 96 spm truth) is the good one:** strap mean
**99.6 (+3.6)**, final 96.6 (+0.6), 160 readings over 172 s, and the series now *varies* (96.2–103.1)
instead of pinning — measurement behaviour, not an artifact. Ring and strap differed by 6.8 spm,
inside the 8 spm agreement threshold, so the two independent derivations cross-validate. Both read
slightly high, which may be a shared bias or a slightly-low manual step count; more captures needed.
**Still unproven: running pace** (where octave error is most likely) and battery cost over a full
session.

**Ring: still no usable window, and my instrumentation hid why.** `ringWindowCount: 0` alongside a
non-null `ringStrideHz` was contradictory: the counter was incremented *after* the idle branch, so it
counted locomotor windows rather than windows delivered — collapsing "the ring sent nothing" and
"sent windows, none locomotor" into an identical 0, which is exactly the distinction it exists to
make. Now counted before the branch, with a separate locomotor count and the classifier's verdict
surfaced. The observed 1.127 Hz matched neither ×60 (67.6) nor ×120 (135.3) against a 102 spm truth —
but every window was `idle`, so it was not from the walk. **D-2 (the `stride_frequency` units
question) remains OPEN.**

**Diagnostic gap closed:** captures now export the **raw accelerometer magnitudes** plus per-reading
rhythm confidence, so a wrong reading can be replayed against the DSP offline. The 71.4 pinning was
only diagnosable because the number happened to equal the band floor exactly — that is luck, not a
strategy.

### [devices][body] Direct-BLE Renpho scale integration (v1.228.0, 2026-07-27) — ✅ device-verified 2026-07-28
Plan: `docs/superpowers/plans/2026-07-27-renpho-ble-direct-scale.md`. Server-side (migration 157
— 145, 153 and 155 were already taken by other PRs on `main` by the time this merged; `/api/scale-ble/*`
routes, the BIA composition formula, local-SQLite/sync mirroring) is fully sandbox-verified —
smoke-tested end-to-end against the local dev DB with `curl` using the real byte values captured
from the owner's actual scale: confirmed writes land correctly in `body_metrics` with per-field
`source_map='scale_ble'`, the >15% weight-anomaly gate correctly stages a reading as `pending`
without touching `body_metrics`, and both `dismiss` (archives, never writes) and `confirm`
(retroactively computes composition + writes) work. **Device-verified 2026-07-28:** the owner
rebuilt the APK, paired the scale, and confirmed a real weigh-in with background sync on landed
correctly end-to-end — `ScaleGattClient`'s GATT connect/handshake/decode, `ScaleBleService`'s
foreground-service reconnect loop, and the ongoing "Watching for scale…" notification all worked
on-device as designed. **Bug found in that same session (v1.231.5 fix):** weighing in with socks
on broke foot-plate contact, and the scale reported impedance as 0 rather than omitting the
packet — dividing by that zero floored the body-fat estimate at its 3% clamp along with every
other composition field, while the weight itself (a load-cell reading, contact-independent) was
correct. Fixed: `hasValidImpedance()`/`MIN_VALID_IMPEDANCE_OHMS` (`lib/scale-ble/composition.ts`)
now rejects a no-contact reading before the formula runs — weight still saves, composition is
skipped rather than clobbered with a wrong number, and the native service fires a one-shot
low-priority notification explaining why. **Still open:** the household's two-phone scenario
(both partners running background sync against the same physical scale) hasn't been exercised —
expected an occasional missed reading on whichever phone loses the BLE connection race, not a
data-integrity issue, per the plan's Risks section. **Also open (design question, not yet
decided):** the background-sync foreground service polls every 45s and keeps its ongoing
notification visible the entire time it's on, for a scale that's actually used ~10s/day — a
PendingIntent-based passive BLE scan (no persistent notification, lower battery, wakes only when
the scale actually advertises) would fit the usage pattern better but is a real rework of the
connection strategy, raised 2026-07-28, not yet scheduled.

### [cardio] Cardio session picker (v1.213.0, 2026-07-27) — recommendation heuristic unvalidated against real usage; no cross-modality gate by design
`recommendSession()` (7 unit tests) and the time-picker sheet are dev-server + Playwright
verified: the sheet opens, all three options render and stay tappable regardless of the
recommendation, and the walk recommendation correctly identifies the biggest-remaining
**training** zone (Z1 excluded, matching D-10). **What is NOT verified:** (1) the seed has no
active running plan, so the `run` branch of the recommendation (a pending prescription fitting
the time budget, plus the softened-gate note) has never been exercised against a real plan —
only the walk/activity branches were observed live; (2) the heuristic itself ("recommend the
zone with the most remaining minutes") is a first cut, not validated against what actually feels
like a good suggestion over real usage — expect it to want tuning once the owner has used it a
few times; (3) on-device paint/safe-area of the new sheet, same caveat as Phase 1 below (desktop
Chromium, not the canonical S25 WebView). **By design, not a gap:** walk and Other activity never
carry a recovery-gate note — `recovery-gate.ts` has no modality-agnostic equivalent, and building
one was explicitly scoped out of this item (see the plan). Entry:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).

### [cardio] Cardiovascular hub Phase 1 (v1.212.0, 2026-07-27) — NOT verified on device / on real zone data · needs: data
New `/cardio` screen + `GET /api/cardio-week` + the workout-select IA split. The quota logic
(`computeZoneQuota`, 7 tests) and the route are dev-server verified — 200 with all 5 zones, Z5
correctly `not-required` for the seed's `zone2-base` framework — and a real Chromium render
(Playwright) confirmed the zone-bar fill actually scales with percentage, not just renders at
0%. **What is NOT verified:** (1) the local seed has no `oura_heartrate` rows, so every zone
shows `doneMin: 0` — a genuinely non-zero quota from real ring/strap wear has not been observed;
(2) Samsung WebView paint of the zone bars and safe-area clearance on the new screen (the
sandbox render is a real desktop Chromium, not the canonical APK WebView); (3) the plan-driven
quota-size path — the seed user has no active running plan, so the quota always falls back to
the framework default rather than a plan's personalised `weeklyBaseMinutes`. Device smoke: open
`/cardio` on the S25 after a day of ring/strap wear and with a real running plan set up; confirm
non-zero zone minutes, the bars render and clear the status/gesture bars, and the quota total
reflects the plan's actual volume rather than the 150-min floor. Entry:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).
### [readiness] 🔴 Nightly temperature treats one frame's simultaneous probes as consecutive samples (found 2026-07-27, OPEN)
Same audit; **description rewritten twice** — first after re-verifying against full production
history, then again after the `open_oura` source answered the protocol questions. `open_oura` decodes
`0x46`/`0x69`/`0x75` with one shared decoder as a **flat probe vector** of centi-°C, so the repo's
`decodeTemperatures` is already correct and the earlier "three interleaved channels" framing was
wrong. The defect is entirely in the rollup: a frame's probes are **simultaneous**, but
`adapter.ts:4861-4869` stamps every value with the frame's single `ds` and feeds them to
`nightlyTemperatureCentiC`, a *temporal* median-7 pipeline — 631 frames become 2,398 "samples" on 631
real timestamps. Running the shipped path over one real night reproduces production's stored
**36.00 °C** exactly. Collapsing each frame to one value does **not** fix it (per-frame median →
37.00 °C): `0x46` frames hold three values with the middle on an exact 0.5 °C grid in 98.3% of 30,135
rows, so the median *is* the quantised probe. Of the 21 nights with a value, **19 are exact whole
degrees**, range 34.00–37.00 °C, σ = 0.743 °C, and the baseline's own spread converges to **2.63 °C**
— leaving the illness radar's `tempZ` and readiness's `bodyTemperature` contributor with no
discriminative power. Queued as backlog Q-2; preferred remedy (use `0x75` alone) is justified
empirically. One question stays open and needs the **Oura app binary**: which stream
`nightly_temperature_calculate` actually consumes.

### [sleep][devices] 🟠 Sleep/HRV/breathing metrics changed scale at the BLE re-key with no conversion (found 2026-07-27, OPEN)
Same audit. Four `sleep_sessions` columns shifted regime on 2026-07-07/08 while keeping the same
column and the same scoring curves: ~~`restless_periods` **230.6 → 2.5**~~ (**Q-3 fixed in v1.223.0**
— see below), `respiratory_rate` **13.11 → 9.32 rpm** (written from an estimator its own docs call
"not calibrated, display/debug only"), `average_hrv_ms` **27.5 → 49.0**, `lowest_heart_rate`
**65.1 → 56.7**. These have **non-overlapping** ranges. No baseline, trend or z-score may span
2026-07-07 without a documented conversion. Still queued as backlog Q-4.

### [sleep] ✅ `restless_periods` was two quantities in one column — now unscored (v1.223.0, 2026-07-27) — NOT verified on device · needs: browser
Q-3. The column holds Oura's restlessness measure on Cloud nights (**138–330**) and `model.awakenings`
on BLE nights (**0–5**); one curve, topping out at 50, was applied to both. Measured over the full
history: **every Cloud night clamped to the maximum 32-point penalty** while BLE nights drew ≤2.5, so
restfulness read **48.6 vs 86.3** across the eras — a 37.7-point gap that was purely units, depressing
every pre-cutover score by ~2.6 points. The term is **dropped rather than re-scaled**: a count of
movement periods and a count of wake events are different quantities, so any conversion would be
invented. `efficiency` and the awake fraction are unit-stable and carry the signal. Useful discovery:
the era is already recorded per-field in `sleep_sessions.source_map`, so no new column was needed.
Remainders (a calibrated awakenings penalty; the chronic-stress consumer, whose score is populated on
**0 of 70 rows**) queued as **Q-3b**. Journal:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).

### [sleep] ✅ Sleep Score gained an autonomic axis (v1.215.0, 2026-07-27) — NOT verified on device · needs: browser
Owner-directed, from the case study of the night of 2026-07-25
([`docs/reviews/2026-07-27-night-2026-07-25-case-study.md`](docs/reviews/2026-07-27-night-2026-07-25-case-study.md)).
That night was rated **5/5 "Terrible"** and scored **80**: normal on every contributor the model had,
abnormal only in autonomic state (HRV −2.76 σ, overnight HR +10 bpm) and a 2 h-early wake. Shipped:
one shared baseline derivation every caller uses (four of six previously passed none, so the same
night scored 82 on some surfaces and 80 on others), a new `hr` contributor, a directional `schedule`
contributor (only a late bedtime or early wake is penalised), and rebalanced weights putting
autonomic state at 28 of 110 rather than 12 of 100. **That night now scores 71 — 2nd lowest of 20 and
5 clear of the 3rd — where it used to sit 5th and indistinguishable from ordinary nights.** The top
of the range is unmoved (best night still 98) and a perfect night still reaches 100, pinned by a test.
**What is NOT verified:** the sleep-detail contributor chart gains two bars and has not been seen on
the S25; only a dev-server run against a seeded local Postgres was possible. **Historical scores
change meaning** — any night with a mature baseline now scores differently than when it was
persisted. Both remainders have now shipped — Q-16 in v1.220.0 and Q-17 in v1.221.0 (both below).

### [readiness] ✅ Body Battery: an evening nap was throwing away the whole day (v1.221.0, 2026-07-27) — NOT verified on device · needs: hardware
Q-17, and **the finding was filed with the wrong cause**. It read as *"consumes nothing on a
**ring-only** day"*; nothing in the route filters on `source`. The real cause is the **F-1
nap-vs-night bug in a fifth place** — the wake anchor was `sleepSessions` sorted by `sleepEnd`
descending, first element. On 2026-07-26 production holds two rows: the night ending **05:54** and a
45-minute evening nap ending **18:09**. The nap won, and since the walk keeps only HR at or after
`wakeTime`, the whole day was discarded: **164 ring samples sat unused**, and the 18:09→19:39 window
held exactly the **0** that was stored. Ring-only days merely showed it, because a strap day's ~1,500
workout samples happened to land after the nap. Fixed by using the shared night selection scoped to
today, plus a fallback when the recorded wake is in the future, and the response now reports the
anchor the curve actually used rather than re-deriving it. Journal:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).
⚠️ Server-side only, but the card has not been re-checked on the S25.

### [sleep] ✅ Sleep Score vs how it actually felt — a calibration view (v1.220.0, 2026-07-27) — NOT verified on device · needs: browser
Owner decision on Q-16: `sleep_quality_feel` stays **out** of the score and becomes something to look
back on when tuning. `GET /api/admin/sleep-feel-calibration` + a card atop Admin → Day Review pair
each night's model score with the next morning's rating and report rank agreement, the range each
side uses, mean score per rating, and the worst disagreements; the single-day audit gained
`context.morningCheckin` so one day reads "scored 91 · you said Terrible" in place. Comparisons are
**rank-based on purpose** — the rating spans 1–5 while the model's real range is 81–98, so a raw
difference would be meaningless. Against production (24 rated mornings) it says **Spearman +0.42**,
and surfaces three concrete targets: the model uses 15 points where the owner uses the whole scale,
"Good" nights average *higher* (92.5) than "Great" ones (91.0), and 2026-07-21 was rated **Poor**
while scoring **92**. Nothing here changes a score. Journal:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).
⚠️ Admin-only surface, not seen on the S25.

### [workouts] ✅ AI no longer quotes bodyweight 1RMs in kilograms (v1.224.0, 2026-07-27) — NOT verified on device · needs: browser
Q-19. `app/api/ai-chat/route.ts` tells the model *"Quote them exactly — NEVER recompute a 1RM"*, so a
Pull-Up read back to the user as "118 kg" — the exact misreading Q-12 removed from the UI. Every
surface whose text reaches the **user** is fixed: the ai-chat context and its two 1RM-bearing tools,
the prescription card's rationale bullets (`exerciseType` threaded through following the existing
`equipmentById` pattern), both digests' PR lines (via a new shared `describePersonalRecord`), and a
guard on the kg achievement milestones — `prFor` matches by **substring**, so a bodyweight "Pistol
Squat" would have unlocked Century Squat at its `BW_REF` value. Proven end-to-end on `pnpm dev`:
*"what is my pull-up PR?"* → **"6 reps (bodyweight)"**, while bench still answers "98kg". Three
model-input-only builders remain (never quoted at the user) — queued as **Q-19b**. Journal:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).

### [workouts] ✅ Bodyweight sets no longer count as zero volume (v1.227.0, 2026-07-27) — NOT verified on device · needs: browser
Q-13. The same sets were priced at `BW_REF + added` for the 1RM and intensity but at the **raw**
weight for volume, three lines apart, so 208 real reps (19 Pull-Up / 93 reps, 13 Hanging Leg Raise /
115 reps) read as 82–88% intensity and zero work done — missing from `user_stats`,
`computeVolumeAcwr` (which gates early deload), weekly volume and the prescription engine's volume
budget. Owner decision: price a rep at **real body weight × a per-exercise fraction** (Dempster/Winter
segmental masses — Pull-Up 1.00, Hanging Leg Raise 0.32), deliberately *not* `BW_REF`, which would
have added 20,800 kg and made pull-ups a top-3 volume contributor instead of the **8,856 kg** (~3.5%)
this adds. Isometrics stay unpriced on purpose — their "reps" are seconds. Migration 152 backfills the
13 historical logs. ⚠️ **This deliberately breaks an invariant the first audit verified:**
`exercise_logs.volume` no longer equals Σ(`set_logs.weight_kg` × reps) on bodyweight rows, because the
set records the *bar* and volume records work *done* — any future check must exempt bodyweight rather
than "correct" it back. Journal:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).

### [workouts] ✅ Bodyweight sets no longer record a prescription they were never given (v1.227.3, 2026-07-27) — NOT verified on device · needs: browser
Q-14. `planned_pct` stored the progression style's nominal percentage while `intensity_pct` is
BW_REF-relative, and for a bodyweight movement that percentage is never a load target —
`resolveBodyweightStyle` turns it into a **rep** target. So every bodyweight set recorded a phantom
14–18 pp overshoot (Pull-Up planned 75.0 / actual 88.5; Hanging Leg Raise 68.0 / 83.9 ×3); all eight
≥2 pp deviations in production were this, while weighted exercises deviate by ≤2.3 pp of real
autoregulation. Owner decision: NULL `planned_pct` where no %1RM was prescribed and record the
prescribed rep target instead — `planned_reps` is written for **every** exercise type, not just
bodyweight. Migration 153 adds the column to `set_logs`/`set_hr_stats` and clears the 6 historical
rows; `planned_reps` is left NULL on them rather than reconstructed from a 1RM that has since moved.
`sync-helpers` now replays the *prescribed* reps, not the performed ones. Journal:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).

### [workouts] 🔴 `personal_records` is not the all-time best, and "starting weights" never reach the bar (found 2026-07-27, **enlarged 2026-07-28**, OPEN)
Same audit. `POST /api/personal-records/seed` uses the unconditional upsert (no `IfBetter` gate, no
validation, `achievedAt = now`), bypassing the correct paths; its only caller is the workout-builder
review screen, so reviewing a program rewrites PRs. **5 of 36 rows disagree with the best surviving
log** — Barbell Bench Press shows **90.8 kg against a real 96.0**, Barbell Front Squat **67.5 against
73.8**, and four PR values appear in no exercise log at all. Separately, PRs are keyed on exercise
*name*, so five near-duplicate spellings split one exercise's best into two rows.

**Tracing the seeded value on 2026-07-28 found worse.** (a) The builder's *"Enter your 1RM for each
main lift to pre-seed working weights"* **does not do that**: `session-data.ts:226` reads
`lastLog?.estimated1rm ?? null` and never consults the PR map, so with no prior log
`computeInitialWeights` falls through every branch to a hardcoded **`return 60`** — 60 kg on the bar
for any new weighted lift, whatever you typed. (b) **Two weight paths disagree**:
`/api/next-session/prescription` uses `max(lastLog, PR)` and shows real kg on the done-screen "next
workout" card, while the workout screen uses the last log alone — so the preview and the session it
previews can show different weights. (c) Deleting the seed route (the literal form of the owner's
"derive from logs only" decision) would break `ai-periodization/baseline/complete`, which 400s with
`no_prior_data` when no PR exists, making "skip the AMRAP baseline" unreachable for a new user.

Decision stands — PRs derived from logs only — but delivered by giving the user-entered starting 1RM
its **own** store, plus one shared basis resolver used by both weight paths (which kills the magic
60). Queued as backlog Q-5, **plan-first**.

### [devices] ⏳ Ring clock anchors are now append-only observations (2026-07-29) — phase 1 of 2, inert
`oura_ble_clock_anchors` held **exactly one row**, created at the 2026-07-07 re-key and mutated
forward on every ingest, applied to **every `ds` in the database**. It doesn't stretch time
(ring-vs-ring intervals were always fine) but it **offsets every ring timestamp by that one row's
lag** — hours, by the redecode route's own notes. Hence Q-23 §1 (ring rows interleaved with
chest-strap wall clock), sliding day boundaries under the steps rollup's one-way max-merge, and
Q-22 §2: a ring clock **reset was silently fatal**, since the forward-only update meant post-reset
frames mapped weeks into the past and fell below the rollup cutoff, contributing zero forever.
**Landed:** migration 161 (`epoch`/`observed_source` on anchors, `epoch` on `oura_raw_samples`),
`lib/oura-ble/clock.ts` (`resolveDsToMs` — nearest observation, interpolating, epoch-isolated,
`null` rather than a guess), and append-only ingest with reset detection.
⚠️ **No timestamp has changed yet — every read still uses the single newest anchor.** Phase 1 only
starts *recording* the observations phase 2 needs. **Phase 2 (queued, Q-23)** switches the ~11 read
sites to `resolveDsToMs`; it wants a few days of accumulated observations first so the improvement is
measurable rather than assumed, and is deliberately kept apart from the step backfill. Plan:
[`plans/2026-07-29-ring-clock-anchor-epochs.md`](docs/superpowers/plans/2026-07-29-ring-clock-anchor-epochs.md).
Journal: [`docs/overview/history-2026-07-28.md`](docs/overview/history-2026-07-28.md).

### [activity] 🟠 Step backfill preview computed; three days materially inflated (2026-07-28, OPEN)
Recomputed all 20 ring-era days: stored **106,902** → recomputed **104,458** (net **−2,444**). Most
days barely move; **07-24 −1,719**, **07-27 −1,059**, **07-28 −3,326**; two rise (07-12 +2,696,
07-13 +1,327). ⚠️ **Indicative only** — it buckets by `measured_at` while the rollup buckets by
`dayForDs` via the mutable clock anchor, which has moved since; the two rising days are the likely
artefacts. Run `/api/oura-ble/samples/step-backfill-preview` (rollup's own bucketing) before any
destructive backfill — and note Q-22 §3: that preview is a hand-copied duplicate of the rollup block
and should be collapsed into one function first.

### [activity] 🟠 Three days hold inflated step totals that cannot self-correct (found 2026-07-28, OPEN)
The v1.228.5 guard stops new inflation but the rollup's max-merge (`> existingSteps`) means a stored
day can only ever rise. Verified against production by re-running the guarded merge over each day's
real frames: **2026-07-24 7,691 → 5,972**, **2026-07-27 6,981 → 5,922**, **2026-07-28 4,903 →
1,578** (−6,103 total). Correcting them is destructive and already has an owner-gated lever
(`?allowStepsDecrease=1` on the redecode route, with a read-only preview at
`/api/oura-ble/samples/step-backfill-preview`) — awaiting an explicit decision. Note the wider
ring-era history is also suspect: phone-sourced days (to 07-08) averaged ~2,300/day against ~5,300
for ring-sourced days, and the retired flat-30 estimate that produced 2026-07-09→22 is documented
in-code as over-counting.

### [activity] ✅ The Activity Score is persisted (v1.228.4, 2026-07-28) — NOT verified on device · needs: browser
Q-7. It was computed on every `/api/readiness-score` call and then discarded, while
`/api/health/trends` fell back to `oura_daily.activity_score` — NULL every day since the 2026-07-07
re-key, because the Cloud stopped scoring. Activity Score v2 (v1.207.0) therefore shipped with
**0 of 20 days** of trend. Now written as a third compute-and-persist block beside the existing
readiness and sleep ones: today's date key, only the `activity_*` columns (never the shared
`source`/`model_versions`, which the upsert replaces wholesale), best-effort so a persist failure
never fails the read. `oura_daily_derived.activity_score` is a COALESCE column, so the on-device
rollup's eventual push fills or overwrites the same field without conflict — persisting now costs no
future device work.

### [devices][readiness] 🟡 Eight device-owned `oura_daily_derived` columns have no producer (found 2026-07-27, **re-diagnosed 2026-07-28**, OPEN)
Same audit. The finding said the device "has never pushed" these. Tracing the chain found the
opposite: **nothing on the device could push them.** There are **zero** `queueMutation` call sites
for `oura_daily_derived`/`oura_daily_summary` anywhere; the local table's only live writer is
`applyDelta`, which hardcodes `sync_status='synced'` and so can never create an outbox row; and
`lib/oura-ble/rollup/` **does not exist** — `lib/sqlite/migrations.ts:1030` says so outright
(*"the rollup that writes them isn't built yet"*). The push loop and server branch are correct and
need no change. `worn_hours_ble`, `active_calories_est` and `pwv` are written *only* inside the
device-push branch, so they are unreachable by construction. This is Phase-1 Task 5/6 + Phase-2 Task
A2 — planned and entry-gate-cleared, not started. Queued as backlog **Q-7b**, which exists mainly to
stop a future session "fixing" a sync layer that is already correct. Related: `/api/oura/sync` still
writes a daily `oura_daily` row containing nothing but `non_wear_time_sec`, so "Oura sync succeeded"
is a false-positive health signal.

### [heart-rate][workouts] 🟡 Only ~20% of logged sets have usable HR (found 2026-07-27, measurement only)
Same audit. Of 550 `set_hr_stats` rows, **436 (79%) have `coverage_ok = false`** and **370 (67%) have
a NULL `peak_bpm`**, so v1.197.0's "Heart & Recovery" card trends over roughly one set in five;
`workout_hr_stats` holds 0 rows. Likely cause (strap disconnection / ring power-gating during
lifting) leaves no trace in Postgres — **this needs the device smoke checklist, not more SQL.** Queued
as backlog Q-11.

### [sleep] ⚠️ Only 12 of 57 nights have a persisted derived score — tooling shipped, **not yet run on prod** (v1.222.0, 2026-07-27)
`oura_daily_derived` scores are written as a side effect of loading `/api/readiness-score`, which only
ever persists *today*, so historical nights are unscored and calibration work over that table reads a
~21% sample. F-2 shipped the fix: `POST /api/admin/backfill-derived-scores?from=&to=&dryRun=`
recomputes through `buildDayAudit` and persists **exactly** what the live route would write (via a new
shared `PillarAudit.persist` field, so the two can't drift — including the subtlety that the stored
readiness is the composite *before* illness suppression, not the displayed score). Dry-run by default,
31 days/call, sequential, idempotent. **The remaining work is operational:** nobody has paged through
production with `dryRun=false` yet, so coverage is still 21%. Journal:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).

### [platform] ⏰ Claude read-only prod-DB access is approved FOR BETA ONLY — revisit on beta exit (2026-07-26)
Owner approved standing read-only production-DB access for Claude sessions for the duration of beta
(*"until we move out of the 'beta' phase and know everything is wired up correctly"*), accepting the
§9 risk that a leaked `CLAUDE_DB_QUERY_SECRET` exposes the full health history. Plan:
[`docs/superpowers/plans/2026-07-26-claude-readonly-prod-db-access.md`](docs/superpowers/plans/2026-07-26-claude-readonly-prod-db-access.md).
**This row exists so a temporary decision cannot decay into a permanent one by default.** On beta exit
— first non-owner user with real data, or the owner declaring beta over — either unset
`CLAUDE_DB_QUERY_SECRET` in Railway, or consciously re-approve after re-reading §9. If re-approved,
decision 8.1 (views unscoped across all users) must be revisited: it is defensible only while this is
a single-user app, and stops being so the moment a second user has data. Emergency stop at any time:
`REVOKE ALL ON SCHEMA claude_ro FROM claude_readonly;` (immediate, no deploy).

### [cardio][devices] Cadence: strap CONFIRMED on-device; ring path blocked by the hourly drain (v1.211.2, 2026-07-27)
**First real treadmill capture (owner, 102 spm counted ground truth) — strap PASSES, ring produced
nothing.**

**Strap ✅ validated on real hardware.** `frameType: 0x01` — the H10 emits **raw** PMD frames, not
delta. That was the genuinely disputed part of the protocol (sources disagree; both conventions
were made to decode and the observed type surfaced rather than guessed), and it is now settled.
50 Hz granted as requested. Accuracy vs 102 spm: first 10 s bin **103.1 (+1.1)**, mean 99.4 (−2.6),
final 98.5. Inside the ±3–5 spm bar. The mean reads low because the capture ran 33.5 s while the
counted 51 steps spanned ~30 s — the start/stop edges drag it down. **Still unproven: running pace**
(where octave error is most likely) and battery cost over a full session. n=1, walking only.

**Ring ❌ no data — my design error, now fixed.** `ringStrideHz: null`. Two causes:
(1) one gait window needs a *pair* of 0x7e/0x7f frames spanning ~30 s, so a 33 s capture yields at
most one; (2) decisively, `OuraRingService.kt` drains ring history **hourly**
(`DRAIN_INTERVAL_MS = 3_600_000`) and gait frames largely reach JS with that drain. A short capture
therefore *cannot* produce ring cadence. The console now shows a gait-window count and a **Sync
ring** button (`drainHistory`, an existing plugin method — JS only, no APK rebuild) so the ring is
testable on demand. **The `stride_frequency` units question (D-2) remains OPEN** — the capture that
answers it has not yet been taken.

**Bug found while root-causing that, fixed in v1.211.1:** `cadence-tracker.ts` stamped every ring
window with `Date.now()`, so an hourly drain's burst — an hour of history arriving at once — looked
like ~120 live readings, jittering the display and flooding the saved activity average. Now
deduped on the ring's own `ds` and rate-limited to one recorded reading per ~25 s, with later
(newer) windows in a burst *superseding* the earlier ones rather than the first-arriving (oldest,
hour-stale) window being the one kept. Regression-tested (`cadence-tracker.test.ts`).

### [cardio] Cadence metric (v1.211.0, 2026-07-27) — strap now confirmed (above); other surfaces still device-gated
Everything that actually produces a cadence number is BLE-bound and inert in the sandbox. **The
strap path is Kotlin and requires a rebuilt APK** — CI publishes one to the rolling `apk-latest`
release on merge (`/releases/download/apk-latest/app-debug.apk`), so no local Gradle build is
needed. Sandbox-verified: full gate green (2035 tests, tsc, lint, check-reconcile,
check-push-mutations), migration 140 applied, a dev-server `POST /api/activity-logs` with cadence
round-tripping through Postgres to `GET`, an implausible value rejected 400, and a Playwright pass
at 412×915 confirming the detail sheet paints "CADENCE · 168 spm avg · strap" with its sparkline
and the admin console renders both unit interpretations.
**Unproven until the treadmill run:** (1) whether the H10 delivers a PMD stream at all and in which
frame encoding — both conventions decode and the observed frame type is surfaced in the console,
because a silent zero looks identical to standing still; (2) real accuracy vs the treadmill for
either source; (3) **the ring's `stride_frequency` units (the open D-2 question)** — the conversion
is deliberately left as one of two principled values (×60 steps/s or ×120 strides/s) with both
rendered against ground truth, rather than guessed; (4) battery cost of a sustained 50 Hz stream
over a full run, and that HR streaming is unaffected; (5) safe-area / Samsung-WebView rendering of
the new readouts. Owner action: **Admin → Tools → Cadence calibration**, walk a known cadence on
the treadmill, and check which stride interpretation matches — that single capture also unblocks
the AD-2 Hz bands and step-counter trust, which depend on the same answer.

### [heart-rate][devices] D6 comparison harness (v1.212.1, 2026-07-27) — NOT device-verified; ±5bpm band unvalidated · needs: data
The admin route/console/DB path were exercised end-to-end against local Postgres (401 anon, 200 +
real bucketed comparison for an admin), and the pure merge/scoring function plus the minute-bucketing
helper are unit-tested. **What has NOT happened:** a real H10 spot-check — wearing both the ring and
the strap simultaneously for ~15 min and running the console against that window. Per the plan's own
gate, that run is the point of D6, not a formality: it's the first real signal on whether the ring's
own HR is trustworthy, and the ±5bpm tolerance band is a first guess to be tuned from that data, not
a validated threshold. Owner action: **Admin → Oura BLE → Comparison harness**, wear both devices for
a short burst, run it, and confirm the two sources roughly agree (or don't — either result is useful
data for D5, which is gated on this).

### [cardio][platform] `localToActivityLog` drops display fields for unsynced activities (found 2026-07-27, pre-existing)
`components/health/activity-history-card.tsx` has a second, hand-written row mapper that silently
drops fields. Cadence was added to it in v1.211.0, but it **still drops** `routePolyline`, `splits`,
`bestEfforts`, `paceSeries`, `avgPaceSecPerKm`, `elevationGainM/LossM` and `notes` — so a *pending*
(offline/unsynced) activity opened from that card shows a detail sheet missing its route, splits and
elevation until the server copy lands. Exactly the "update every row→object mapper" class in
CLAUDE.md. Not fixed in v1.211.0 because it is pre-existing and outside that change's scope; low
severity (transient, resolves on sync).

### [readiness] Readiness composite is persisted under the wrong day (found 2026-07-26 by Admin → Day Review) — OPEN, not yet fixed
The new Day Review tool's drift flag fired on its first real run: **stored 36 vs recompute 40** for
the same date. Root cause is pre-existing, in `app/api/readiness-score/route.ts`: the compute-and-persist
block writes the composite to `oura_daily_derived` keyed on **`latestSummary.date`** — the most recent
night that has an `oura_daily_summary` row, which is not necessarily today. So *today's* check-in,
today's activity score and today's illness inputs get persisted into a row **labelled with an earlier
date**, and any later read of that row (analysis, trends, the audit's `stored` comparison) attributes
them to the wrong day. The sleep-score persist immediately below it already does the right thing —
it keys on `lastSleep.date`, the actual wake day of the scored night.
**Deliberately not fixed in v1.210.0** — the correct key is a real behavioural decision (is that row
"the day the signals are about" or "the night the baselines came from"?), and changing it rewrites how
existing `oura_daily_derived.readiness_*` rows are interpreted. Needs an owner call before a fix, plus a
decision on whether historical rows get corrected. Reproduce: Admin → Day Review, pick a day whose
summary row is older than today, look for the amber "differs from this recompute" line.

### [platform] Admin → Day Review (v1.210.0, 2026-07-26) — NOT verified on device or against real ring data · needs: data
Admin-only, read-only, no offline-first domain, no native plugin, no new safe-area surface (it renders
inside the existing `/admin` shell). Verified in-sandbox: full gate green, dev-server exercised
end-to-end (200 on both date separators, 400 on an invalid calendar date, 401 unauthenticated),
contributions proven to sum to the score each model reports, and a Playwright pass at the 412×915 S25
viewport (tab renders, date stepper navigates, pillars expand, no console errors).
**Two things the sandbox can't prove:** (1) the local seed has **no `oura_daily_summary` or
`oura_heartrate` rows**, so the readiness composite and the zone-minutes/move-hours paths were exercised
by inserting synthetic summary rows and deleting them afterwards — the Activity zone-minutes and
move-hours contributors have never run on real data here; (2) whether the numbers are **sane against the
owner's real history**, which is the entire purpose of the tool. First device action: open Admin → Day
Review on a day that felt clearly wrong and check the contributor breakdown against how the day actually
felt. Known fidelity limit (surfaced in the payload, not hidden): sub-scores are exposed rounded, so a
rebuilt `contributionSum` can sit up to a point off the score — each pillar says so inline.

### [cardio] Guided walk uplifts (v1.208.1, 2026-07-23) — hardware back-button guard NOT device-verified · needs: android

The new confirm-exit dialog's hardware/gesture back-button path (`mobile-auth-handler.tsx`,
mirrors the existing workout-screen guard) can only be exercised on the APK — the web sandbox
has no Capacitor `App.addListener('backButton', ...)`. The in-screen "End walk" button and the
bottom-nav tab-away guard were both verified working via a live dev-server Playwright pass.

### [cardio][devices] AD-2 ring-cadence walk/run detection (v1.208.0, 2026-07-23) — Hz bands provisional, NOT device-verified · needs: data

The whole confirmation path (`classifyGait`/`gait-confirm`) is BLE-gated and inert in the sandbox
by design (no ring). Two things need an owner APK rebuild + on-device pass before this can be
called fully trusted: (1) the walk/run Hz bands are physiological-prior estimates, not calibrated
against a real captured walk/run/lifting session (the shared D-2 units question); (2) the
probe-phase backdating (route not clipped to the ~90s-later confirm instant) needs a real walk to
confirm. Run `docs/device-smoke-checklist.md`: a garage lifting session must never confirm; a
real walk must confirm within ~90s with the correct backdated start/route; a run must classify
as run; removing the ring mid-walk must fall back to the GPS/AD-1 path without crashing.

### [app-shell][activity] Core score-cards + Activity overhaul (v1.204.0 → v1.209.0, four rounds, 2026-07-23/26) — NOT verified on device / real ring data · needs: data
Home cards redesigned (W-A), sleep recalibrated + overnight HRV (W-C), readiness recalibrated + check-in
(W-D), and Activity Score v2 (W-B) — **all four workstreams now fully shipped** across four rounds, each
after live owner review of screenshots/mockups.

**Round 4 (v1.209.0, visual only — no scoring change):** the round-3 fixed-accent-tick ring was replaced
after another two mockup rounds. Landed on four options, offered as a real **user-selectable
preference** ("Score Card Style" in More → Home Widgets, `lib/home/home-prefs.ts`) — the owner's own
idea mid-review, rendered as a **vertical list with a checkmark** (the owner asked for a list once a
third option made the original 2-button toggle too cramped): **Default** (plain closed circle),
**Open ring**, **Perforated ring** — each with the coloured accent moved from the ring onto each card's
**icon** (readiness blue, HR red, sleep purple, activity orange) and the dot removed, circles sized up
(114px default/open-ring, 94px perforated — perforated keeps its own tuned size since it needs denser
dots at a smaller diameter to read as texture; the two plain-stroke styles share the larger size) — plus
**Accent ring**, added in a follow-up clarification to keep the round-3 fixed-accent-tick design
(white icon + coloured dot + coloured arc, 80px) selectable rather than discarded outright. For the
three newer styles, **home-row state (good/moderate/low) is no longer shown visually at all** now that
both the arc and the dot are gone — carried only in the `aria-label` and via the number/detail-screen
tap-through; this tradeoff was flagged to the owner during the mockup rounds and accepted (Accent ring
keeps its original dot).

**Round 5 (same PR, v1.209.0):** asked to brainstorm further, six new frame concepts were mocked up
(gradient sweep, plate-rim dashes, double hairline, soft halo, compass ticks, no frame) — the owner
rejected five outright and rated **Halo** only "average," but chose to add it as a fifth selectable
style anyway rather than keep guessing blind. Halo drops the stroke entirely for a soft blurred glow
(CSS `radial-gradient` + blur, not an SVG frame) in the card's identity colour behind the icon/number,
sharing the 114px size. Sandbox-verified: `tsc` clean, full suite 1952 passing, Playwright screenshots +
DOM-structure checks confirmed all **five** ring styles render at their correct sizes/content model and
the settings list switches between them correctly (both via a direct localStorage flip and via a real
click on a list row, confirmed the stored preference updates).

**Round 3 (v1.207.0):** the round-2 progress-fill ring ("still not what I am after — a progress bar
doesn't work for HR") was replaced after two mockup rounds (13 concepts total, shown to the owner before
any code) with **"M — fixed accent tick"**: a thin white ring + one fixed-position, fixed-length arc in
each card's own identity colour (the same hexes each metric's detail-screen sparkline already uses —
`#60a5fa`/`#f87171`/`#818cf8`/`#f97316` — not new colours). Same length/position on every card regardless
of score, so it can't be misread as a percentage; state still lives only in the dot. Also added **active
minutes** to Activity Score v2 — zone-minutes (WHO moderate/vigorous, vigorous double-counted) and
move-every-hour (an HR-elevation proxy, since there's no hourly step data), both computed from the
intraday HR series already fetched for the HR card (`todayHrRows`) — the "device-gated" deferral in the
original plan was overcautious, nothing new was needed. New gauges on the Activity detail screen. A
duplicate `ageFromDob` (accidentally created in round 1) was found and deleted in favour of the existing
canonical one in `lib/date-utils.ts`.
**Sandbox-verified (round 3):** `tsc` clean, full suite 1927 passing (17 new). Synthetic `oura_heartrate`
rows inserted directly into the local dev DB (then deleted) to prove the zone-minutes/moved-hours
computation end-to-end, since the seed has no intraday HR data by default — confirmed correct values and
sub-scores. Playwright screenshots confirmed the new ring (arc + dot, no text) and the new gauge card
render correctly.
**Round 2 (v1.206.0):** the Activity detail screen's contributor chart + "how to improve it" guide were
found silently empty (wired to the permanently-null frozen Oura field) — fixed to serve the Activity
Score v2's own components; added a goals-vs-actual gauge card; fixed `/api/ai/health-insight`'s activity
section, which read the same frozen fields and always said "activity data is missing" even with a real
score showing.
**Caveats still open (all rounds):** (1) Samsung WebView render of the new ring — non-intersection at the
real S25 width, safe-area, colour rendering against the true blue-gradient hero (sandbox renders a plain
fallback background since the weather-driven hero has no network path here — the ring/dot/arc behaviour
was still clearly correct against it); (2) real-ring scores — the seed lacks ≥14-night baselines /
overnight HRV / a mature composite / real intraday HR, so the sleep-HRV term, the +1.5σ readiness terms,
zone-minutes/moved-hours, and a real "great day → ~100" are unproven on real data. **Deliberately not in
scope this round:** the "yesterday-completed" home display (circle shows today's live score) and an
hourly move-nudge notification. Anchors/weights are tunable starting values. Run
`docs/device-smoke-checklist.md` on the S25.

### [cardio][platform] Auto walk/run "Activity detected" notification gate (v1.204.1, 2026-07-23) — NOT verified on device · needs: android
The passive walk/run detector fired the "Activity detected · Recording your walk or run" ping on the
**first** GPS point clearing 0.8 m/s, before the end-of-session save gates ran — so indoor GPS drift
during stationary garage training posted a false ping every session (the session was still correctly
discarded, nothing saved). Fix (`lib/activity/auto-detection-service.ts`): the ping is now held behind
a **sustained-movement latch** — fires at most once per session, only once the live session has covered
`NOTIFY_MIN_DISTANCE_M` (200 m) over `NOTIFY_MIN_ELAPSED_SEC` (90 s), via the pure `shouldNotifyActivity`
predicate. Detection/session-start and the save-path quality gates (`detection-thresholds.ts`) are
unchanged. **Sandbox-verified:** 6 unit tests on the gate predicate + all activity/auto-detection-store
suites green (1867 tests pass; the one failing suite is the pre-existing `onnxruntime-web` sandbox dep
gap, unrelated). **NOT verified on device (APK-only path):** the significant-motion sensor → GPS →
Capacitor local-notification chain does not run in the web/dev sandbox. Owner action (device smoke): on
the S25 APK, (1) do a stationary garage weight session → confirm **no** "Activity detected" ping; (2) take
a real ≥200 m walk → confirm the ping fires once (~90 s / 200 m in) and the walk still saves as before.
Plan: `docs/superpowers/plans/2026-07-22-activity-detection-notification-gate.md`.

### [heart-rate][workouts] Per-set HR metrics "Heart & Recovery" card (v1.199.0/.200.1, 2026-07-21/22) — card paint NOT verified on device · needs: browser
New per-set HR snapshots (`set_hr_stats`, migration 139) + the exercise-history "Heart & Recovery" card
(`components/workout/exercise-hr-trend-card.tsx`) + a `getWorkoutHrTrends` AI-chat tool. **The data path
is fully sandbox-tested** (formula, DB round-trip, `computeWorkoutHr` integration, trend aggregator, chat
tool — 24 tests) **and dev-server verified** (trend route 200 + correct aggregation; recap route actually
persisted a per-set row). **Accessibility fix (v1.200.1):** the card was shipped **unreachable** — the
only entry points were `session-select`/`/stats`, which the owner reported don't surface it. Now tapping
an **exercise in the Health → Training calendar day-overlay** opens its history sheet (wired
`onExerciseTap` on `day-overlay-sheet.tsx` → `ExerciseHistorySheet` in `health-content.tsx`, with a `›`
affordance). **Playwright-verified in dev** that the tap opens the correct sheet (screenshot) and both
`/api/workout/exercise-hr-trend` + `/api/exercise-history` return 200 with data — **but the sheet's
content paint could not be confirmed in the dev harness** (nested bottom-sheet showed persistent loading
skeletons behind successful 200s; believed a turbopack dev-compile/timing artifact since it's the same
sheet that ships elsewhere). **NOT verified on device:** the card's actual paint + look/safe-area inside
the bottom sheet and Samsung-WebView SVG sparkline rendering. No risk to existing data — reads only.
Owner action: on Health → Training, tap a trained day → tap an exercise (one with monitored sets) → scroll
to "Heart & Recovery"; existing sessions inside the 180 d window populate via Admin → Tools → Additional
tools → "Run backfill" (`POST /api/workout/backfill-set-hr-stats`, oldest-first, resumable). Plan:
`docs/superpowers/plans/2026-07-21-per-set-hr-metrics.md`.

### [workouts][app-shell] Workout & health UX batch (v1.198.0, 2026-07-22) — capture paths NOT device-verified · needs: browser
Owner-directed batch (see `docs/overview/entries/2026-07-22-workout-screen-fixes.md`): workout
category/intensity pills, home deload "why" panel, per-factor health deep-dives across the 4 pillars,
AI-prescription card refreshing in place (no app reopen), and an end-of-workout Time Summary
(setup/work/rest actual-vs-planned). Logic + endpoints are `tsc`/lint/test green and dev-server
verified. **NOT exercised in-sandbox:** the **timing capture** (new `prep_time_sec` bar-load time +
the last-set rest) only runs during a real device workout — the seed has no set-timing, so the card
logic is proven but on-device capture is not; **Readiness per-factor scores** are null until BLE
daily-summary history exists (deep-dives render guide text without a live score); category badges +
prescription-card refresh only hit their real paths on an `ai_dynamic` program. Migration 138 is
additive/nullable. Run `docs/device-smoke-checklist.md` on the S25. Follow-up: planned *work* time
could use the user's measured pace when history exists (currently standard pace, labelled as such).

### [platform] AI usage observability panel (v1.197.0, 2026-07-21) — panel render NOT eyeballed on device
All 15 `@ai-sdk/google` call sites now route through one instrumentation wrapper (`lib/ai/instrument.ts`)
that logs metadata (section/model/tokens/latency/ok/fingerprint) to `ai_call_log` (migration 136),
surfaced in a new **Admin → AI Usage** tab (calls by section, tokens, est. cost, over-time, double-trip
detection). Instrumentation + admin route are **dev-server verified end-to-end** with a real Gemini key
(all three wrapper shapes log real token counts; 403 for non-admin; double-trip detection works) — a
circular-import bug that silently dropped all logs was found and fixed there. **NOT verified:** the
panel's pixel render at the S25 viewport / both themes (admin-only surface, no browser in sandbox; uses
theme tokens + CSS bars, no chart.js). Est. cost uses approximate Flash-Lite pricing (labelled an
estimate). Foundation for the B3 double-trip-reduction work. Audit: `docs/reviews/2026-07-21-ui-responsiveness-audit.md`.

### [devices][platform] Oura raw-on-device: local v18 schema (2026-07-21) — NOT verified on device · needs: hardware
Local SQLite is at **v18**: v17 added four calculated-form tables (`oura_bucket` tier store,
`oura_daily_summary`, `oura_daily_derived`, `oura_heartrate`) + Oura columns on local `sleep_sessions`
(via reconcile); **v18 is corrective** — it drops+recreates `oura_bucket`/`oura_daily_summary`/
`oura_daily_derived` to fix the `oura_bucket` PK (re-keyed on `bucket_start_ms`) + type/column drift.
Additive/nullable, not yet read or written by any code (the on-device rollup that populates them lands in
a later PR). Verified in-sandbox: `check-reconcile` green, and **every migration version + the reconcile
pass applied cleanly to a real in-memory SQLite, including the idempotent re-run of the reconcile ALTERs
(the partial-upgrade path that has killed the local DB twice)**. NOT verified on device: the Capacitor
SQLite plugin's actual v16→v18 upgrade transaction on the S25 — open the app once and confirm the local DB
loads (no dead-store banner) per `docs/device-smoke-checklist.md`. Part of the Oura raw-on-device
architecture (`docs/superpowers/plans/2026-07-21-oura-raw-on-device-*.md`); the data-requirements map
(`…-oura-data-requirements-keep-cull-calculate-matrix.md`) is the foundation for what these tables hold.

### [platform][devices] D1/F3: restore pull endpoint live server-side (2026-07-22) — full restore flow device-gated
`GET /api/sync/pull?mode=restore` now unclamps the 90-day floor (`getSyncDelta(windowDays=null)` → full
history) and the previously-unlimited pull route gained rate limiting (separate `sync-pull` 60/min vs
`sync-pull-restore` 120/min buckets). **This server half is fully sandbox-verified** (route test 6/6 +
the F1 DB-backed window test). **NOT reachable / NOT verified end-to-end:** no client calls `?mode=restore`
yet — the restore driver loop (`pullDelta` outer `hasMore`, seed-cursor-to-epoch-once-then-loop,
loop-until-`hasMore===false`) lives in `lib/local-store/sync-engine.ts` where `getLocalStore` is null on
web, so it ships with the device-gated client batch and is proven only by the RST **wipe→restore** smoke on
the S25 (full sleep/HRV/RHR/score history returns, not a 90-day slice). Until then the endpoint is dormant
infrastructure.

### [platform][devices] D1/Track-B: dedicated timeseries pull endpoint live server-side (2026-07-22) — dormant, client-gated
`POST /api/sync/oura-timeseries` (`getOuraTimeseriesDelta`) serves `oura_heartrate` + coarse `oura_bucket`
on a single pooled connection with an exact keyset `(updated_at,id)` cursor, outside the shared
`getSyncDelta` fan-out. **Server half fully sandbox-verified** — DB-backed drain/stall-safety/concurrent-pool
tests (10 concurrent restore drains stay ≤ pool max:10, no leak) + a pure-mock route test, all green.
**NOT reachable / NOT verified end-to-end:** nothing calls it yet. The client drain-loop consumer, the
`oura_heartrate`/`oura_bucket` local tables + `applyDelta` mapping, the push registration
(SYNCED_MUTATION_DOMAINS + pushMutations branches) and B3 replace-by-day outbox are all device-gated /
D2-blocked (`getLocalStore` null on web) and ride the client batch + the RST wipe→restore S25 proof.
**Bucket pull returns empty until the device push lands** (the server `oura_bucket` table is greenfield —
no writer yet). Accepted bounded behaviour: the server HR rollup restamps ~14 days of `updated_at` per run,
so a synced client re-pulls that span — removed by the C1 single-writer flip, not before.

### [devices][sleep] D1 client batch pt.1: sleep restore widening + oura_daily guard (2026-07-22) — NOT verified on device · needs: hardware
The `applyDelta` pull path now carries the 12 Oura sleep columns (HRV/RHR/stages) through to the local
`sleep_sessions` table (was stripped to stage-hours — review R6 data-loss), clobber-guarded; and `oura_daily`
gained a local `sync_status` column (RECONCILE) with its `INSERT OR REPLACE` converted to a clobber-guarded
`ON CONFLICT(day)` upsert (D4). **Verified in sandbox by compile + mock-SQL unit tests only** —
`getLocalStore` is null on web, so native SQLite never runs here. **NOT verified on device:** (1) the RECONCILE
add of `oura_daily.sync_status` on the S25's existing local DB (the partial-upgrade path that has killed the
local store twice — open the app once, confirm no dead-store banner + history intact), and (2) the durability
payoff — a wipe→restore returning **sleep with HRV/stages intact** (not stripped), per `docs/device-smoke-checklist.md`
+ the RST proof. Until the S25 smoke runs, treat this as not-device-verified. The rest of the client batch
(F3 restore driver loop; summary/derived local persistence; the D2-blocked F4 arms + device write helpers +
Track-B push/B3) is still pending. **Update 2026-07-23:** an on-device attempt found `sleep_sessions`/`oura_daily`
unaffected — the transaction failed one domain later, on `oura_daily_summary`; see the RECONCILE_COLUMNS
schema-drift fix in the "Restore from cloud" row below. **Update 2026-07-26:** F4 mark-synced arms shipped
(see the D0/D1 Oura on-device backlog note) — device write helpers + Track-B push/B3 remain D2-blocked.

### [platform][devices] D1/F3 "Restore from cloud" driver + button (v1.200.0, 2026-07-22) — real on-device bug found + fixed 2026-07-23
`pullDelta` gained a `restore` param (`&mode=restore` → server full-history unclamp) and now surfaces
`hasMore`; the new `restoreFromCloud` driver seeds the cursor to epoch once then drains restore pulls until
`hasMore=false` (resumable), fronted by a "Restore from cloud" button under More → profile. Restore applies
**all four** day-grained finished-form domains locally — sleep, `oura_daily`, `oura_daily_summary`,
`oura_daily_derived` (readiness/illness/resilience/body-comp + EMA baselines), clobber-guarded.

**On-device attempt (2026-07-23) found a real bug, now fixed:** plain "Sync now" failed with a generic
toast; two follow-ups (surface the real error, then unmask a rollback that was hiding it) isolated the true
cause: `no such column: hrv_baseline_mean_x8` on `oura_daily_summary`. Root cause — **#725** extended
`CREATE_OURA_DAILY_SUMMARY_LOCAL`/`CREATE_OURA_DAILY_DERIVED_LOCAL` with 30 baseline/derived columns behind
a **v18 corrective DROP+CREATE**, but a versioned migration only runs once per device; any device already
past v18 before #725 shipped keeps the old (pre-#725) schema forever, and the new columns were never
registered in `RECONCILE_COLUMNS` (the mechanism that actually self-heals — it runs on every open, not once
per version). Exactly the "17 tables once missing from reconcile" bug class CLAUDE.md warns about. **Fixed**
by registering all 13 missing `oura_daily_summary` columns + 17 missing `oura_daily_derived` columns in
`RECONCILE_COLUMNS`, self-healing on the next app open — no wipe, no version bump, no APK rebuild needed
(confirmed **not** a stale-APK/Capacitor-version issue — the owner rebuilt the APK and the error persisted
unchanged, which is what pinned this to a JS/schema bug rather than the native plugin).
**NOT yet re-verified:** owner needs to retry Sync/Restore once this fix deploys and confirm it succeeds —
that closes out the RST durability gate for the day-grained domains. Three known, lower-priority, non-blocking
warts from the same incident (documented, not yet fixed): (1) `illness_flag`/`illness_score`/`resilience_level`
kept their pre-#725 column type on drifted devices (SQLite's loose typing means read/write still works, just
without a corrective ALTER); (2) `oura_bucket`'s PK correction (the other half of #725/v18) likely also never
applied on an affected device — moot today since nothing writes local buckets before D2; (3) Track-B
time-series restore (`/api/sync/oura-timeseries`) still needs its own client driver (not wired).

**Round 2 (2026-07-23), same investigation:** after the RECONCILE_COLUMNS fix deployed, the missing-column
error was gone but retrying Sync surfaced a **new, deeper** bug at the same site: `SQL failed [COMMIT]: Run:
Cannot perform this operation because there is no current transaction.` Root cause: `applyDelta`/
`logWorkoutLocally` managed their transaction with literal `'BEGIN'`/`'COMMIT'`/`'ROLLBACK'` **SQL text**
through `runSQL()`, but `@capacitor-community/sqlite`'s `run()` defaults its own `transaction` param to
`true` — every individual `.run()` call auto-wraps itself in its own begin+commit unless told otherwise, so
the manual sequence never was one atomic transaction: the first write's auto-commit silently closed
whatever the literal `BEGIN` opened, every later write auto-committed itself in isolation (data still landed,
just non-atomically), and the final literal `COMMIT` found no transaction the plugin's bookkeeping still
considered open. **Fixed** by using the plugin's real `beginTransaction()`/`commitTransaction()`/
`rollbackTransaction()` methods (first-class API, not raw SQL text), gated through a module-level flag in
`sqlite-service.ts` so every write's `runSQL()` call gets `transaction:false` while a manual transaction is
open — zero change to the dozens of individual write call sites. **NOT yet re-verified** — same as above,
owner needs to retry Sync/Restore once this deploys.

**Round 3 (2026-07-26):** owner tapped "Restore from cloud" on-device (without wiping local data first) as
a sanity check — got a "Restored 0 records from cloud" **success** toast. Investigation (re-ran the
server-side `getSyncDelta(epoch, windowDays:null)` query against the local seeded DB — returned real
history correctly, ruling out a server regression) found the real bug in the client driver:
`restoreFromCloud` treated a failed pull page (dead network, expired session, rate limit) identically to
"genuinely nothing to restore" — both returned `{ synced: 0 }`, so a transient failure silently rendered
as a success toast. An existing unit test even encoded this as expected behavior. **Fixed**: `restoreFromCloud`
now returns `{ synced, failed }`; the UI shows an error toast on `failed:true` instead of a false-positive
success. **NOT yet re-verified on-device** — owner should retry "Restore from cloud" once this deploys and
confirm it now reports a non-zero count (their history is substantial — months of data, 14+ backfilled step
days). This does not change the D1 durability gate's real remaining requirement: a true wipe-then-restore
test is still the outstanding owner checklist item.

### [workouts] Workout screen 3-card redesign (v1.193.0) — REVERTED in v1.195.1 (2026-07-21)
The #718 3-card rewrite (Workout / Run / Activity) shipped a `RunCard` that called `.reduce` on
`zoneTargets` — a `WeeklyZoneTargets` **object**, not an array — so `/workout-select` threw
"reduce is not a function" and would not load for any user with a real running plan (the seed had
none, so it passed dev/CI). On-device QA hit it immediately. **v1.195.1 restored the original
full-height swipe carousel** (the owner also missed it) and added a Run + Log-Activity button row
beneath it; `run-card.tsx` deleted. The 3-card redesign is shelved — revisit only if re-attempted
with the correct `zoneTargets` shape. Round-2 health refinements (Body Battery diagrams, ACWR
monotony/strain graph, Heart & Recovery visual cohesion, Trends pill-swipe gesture) are queued.

### [app-shell] Health UX device-gated batch (v1.192.0, 2026-07-21) — NOT verified on device · needs: browser
The #2/#4/#7/#9a items shipped web-verified (tsc/lint/test/build + dev-server 200) but their
device-specific behaviour is unconfirmed in the sandbox: the redesigned detail-screen back button
(safe-area + back-stack), the moved standalone "Measure HR now" card (live HR from ring **or** Polar
strap, safe-area), the live direct-BLE ring battery (`/api/oura-ble/battery-latest` reads `null` until
the native service posts a keepalive poll — verified endpoint, not real telemetry), and the Heart &
Recovery range scales (need real multi-day data). Also the energy-budget card (v1.191.0) was not
exercised with a logged day (seed has no food/goal today). Run `docs/device-smoke-checklist.md` on the
S25 to confirm. **~~Follow-up: activity energy in the budget~~ ✅ SHIPPED v1.194.0 (strength) →
v1.195.0 (all movement)** — the energy budget's "burned" now folds in strength workouts + logged
activities (walk/run/cycle/…) + passive steps, all via the shared MET/Schofield estimator
(`lib/health/daily-energy.ts`, 9 unit tests). Double-counting is handled: the budget bases on a
**resting** floor (BMR×1.2) and adds movement explicitly (rather than an inflated activity multiplier
that already assumes exercise); steps below a 3,000/day baseline don't count; and steps inside a logged
outdoor walk/run are subtracted from the passive total. Verified 624 kcal active energy for a lift +
30-min run + 12k-step day. **On-device look of the budget with a real day still wants the S25 smoke run.**

### [platform] 🔴 Postgres volume approaching 1 GB for one user (2026-07-21) — HANDOVER, structural fix pending
Railway postgres-volume hit **92% of 1 GB**. Immediate crisis de-escalated by an owner-run `REINDEX`
of `oura_raw_samples` (~105 MB of index bloat from the migration-115 `measured_at` backfill reclaimed;
DB 320→205 MB) + a WAL cap/restart to flush ~180 MB of WAL. **Root problem unsolved:** `oura_raw_samples`
raw-BLE archival (`body_hex`) is 91% of the DB and grows ~50 MB/week unbounded, so the volume refills
in ~3-4 months. Long-term fix (owner decision) is likely **(a) store `body_hex` as `bytea` not hex TEXT
= instant ~50% cut** and/or **(b) S3 cold-storage of aged raw events**. Full data + query outputs +
plan captured in **[`docs/db-volume-cleanup-handover.md`](docs/db-volume-cleanup-handover.md)** — read
that first when picking this up. Also note a perf flag: `oura_raw_samples` takes 15.2 K seq scans (may
need an index).

### [devices][platform] Oura-BLE rollup DB-pool fix (v1.188.1, 2026-07-21) — server-side, needs on-device 499-check
Fixed the home "Sync failed" toast, root-caused to the Oura-BLE ingest: `aggregateOuraRawSamples` ran
**inline** on every `/api/oura-ble/samples` POST and fanned reads over **10 of the 10 pool connections**
for 12–30 s — starving the outbox sync and blowing the native client's 30 s timeout (→ 499 → cursor-held
re-drain retry storm → prod `NO_SOCKET`/`TCP_INVALID_SYN`). Now the rollup reads via **one** connection
and is **time-boxed** (`ROLLUP_RESPONSE_DEADLINE_MS = 10 s`) so the POST returns 2xx promptly and the rollup
finishes in the background, with a per-user in-flight guard. **Verified:** full suite (1901 tests) + real-HTTP
`pnpm dev` exercise of the 200/rollup/deadline branches. **NOT device-verified** — `getLocalStore`/the native
POST path don't run in the sandbox, so the actual 499→2xx improvement on a real ring drain is unconfirmed.
Ships via Railway (no APK rebuild). **Device-smoke:** pull-to-sync on the S25 while the ring drains; confirm
`/api/oura-ble/samples` returns 2xx quickly (no 499 in Railway HTTP logs) and no "Sync failed" toast. Row I19
in `docs/oura-ble-operations.md §1`.

### [nutrition] Offline saved-meal create/edit/delete (v1.188.0, 2026-07-21) — new sync domain, NOT device-verified · needs: android
Saved meals became a full offline-first write domain: new SQLite v16 tables (`saved_meals` +
`saved_meal_items`), local-first read hydrated from the page's server fetch (clobber-gated on
`sync_status`), and an outbox `saved_meals` domain whose `pushMutations` branch replays create/edit/
delete idempotently (`writeSavedMeal` upserts on the client-minted id). No Postgres migration or
getSyncDelta change — cross-device convergence rides the existing `cachedFetch` refresh. **Entirely
APK-only** (`getLocalStore` null on web → unchanged online-only fallback, no web regression); the local
mirror, outbox replay, and clobber-gate only run on the S25. Scope: existing library foods only —
"add a new food from scratch" stays online-only with a needs-connection message. **Device-smoke:**
airplane-mode → create/edit/delete a meal from logged foods, confirm instant list update + pending
count in More→sync-health, then reconnect and confirm all three land server-side and pending clears.

### [nutrition] Offline food search (v1.187.0, 2026-07-21) — APK-only, NOT device-verified · needs: android
Food-library search, the build-a-meal ingredient search, and the "recently logged here" quick-pick
now read the local `food_items` store first (new `searchFoodItems`/`getRecentFoodItemsForMeal` local
methods) so re-logging a usual food works offline. `getLocalStore` returns null on web, so this path
is dead in `pnpm dev` (web = unchanged server fetch, no regression) and only runs on the S25 native
SQLite. **Device-smoke:** airplane-mode, open the food logger, confirm My-Foods search + build-a-meal
ingredient search + the recent-for-meal quick-pick return previously-logged foods with no signal.
Saved-meal *view + logging* were already offline (cachedFetch persistence + food-log outbox); only
saved-meal *create/edit while offline* remains a gap (deferred, owner decision).

### [workouts] Deload badge on exercise history (v1.186.0, 2026-07-21) — badge absent offline until fetch lands
Exercise-history Session Log rows now show an amber "Deload" pill when `isDeload` is true. The flag is
server-computed and already on each entry; no plumbing added. **Known limitation (pre-existing):** the
offline local-seed path in `exercise-history-sheet.tsx` stubs `isDeload: false` (the local store doesn't
carry the phase flag), so the badge is transiently absent when seeded offline and only correct once the
server fetch resolves. Fixing that needs the deload flag persisted in the local store — deferred.
Builder-review row keys were also made stable (`clientId`) in the same PR; no visible change.

### [workouts] Workout-screen open-flash / zoom-lock / prescription-at-session-end (v1.185.1–v1.185.3, 2026-07-20) — NOT device-verified · needs: browser
Three WebView/pipeline fixes from this session, none reproducible in the web sandbox:
(1) **Open-flash** — the pre-workout screen no longer replaces the painted exercise list with the
full-screen "Preparing your AI workout" takeover (heading swaps in place instead). Pure render change,
verified in `pnpm dev`, but the `aiPrescriptionPending` branch needs an ai_dynamic program mid-regeneration
to see on-device. (2) **Zoom-lock** — viewport now sets `maximum-scale=1, user-scalable=no` to stop the
app reopening stuck-zoomed after minimize/reopen; the stuck-zoom state only manifests in the Android
WebView, so **needs an on-device minimize→reopen check**. (3) **Prescription-at-session-end** — the next
AI prescription is generated in-process at completion (new `lib/ai-periodization/generate-prescription.ts`)
instead of via the unreliable self-origin `fetch(.../prescribe)` on next open; full test suite + tsc green,
but the **Gemini end-to-end path is not testable in-sandbox** (local seed is a `manual` program, no API
key) — needs real-data/on-device confirmation that finishing an ai_dynamic session queues the next
prescription and the card shows "Auto". Note the completion-time regeneration threads the just-completed
session as `excludeSessionId` so it can't self-trigger the emergency deload (reconciled with the W5 fix on merge).

### [cardio][workouts] Run-explain narration + prescription volume pills (v1.185.0, 2026-07-20) — NOT device-verified · needs: browser
Two new UI surfaces (owner chose to surface, not delete, the W4 §5 dead fields): the prescribed-run
card now shows an AI one-liner from `running-plan/explain` (falls back to the deterministic rationale
on failure/offline), and the AI-prescription card shows per-muscle weekly-volume pills. Both render
fine in `pnpm dev` but are APK surfaces (running screen, workout prescription card). **Device-smoke:**
confirm the run AI sentence renders and degrades to the plain rationale offline, and the volume pills
render + sum sensibly on the S25.

### [workouts][app-shell] Workout-screen render-perf (W2, 2026-07-20) — perceived responsiveness NOT device-verified · needs: browser
The 2026-07-20 audit (§2.1) flagged the workout orchestrator's broad `useShallow` pick as re-rendering
on every weight-dial tick. Re-verification found the premise wrong — the dial mutates `perSetWeights`,
which the orchestrator never subscribed (it was already isolated by design). The real dial-tick hot path
was the **814-line `ActiveWorkoutScreen`** (it subscribed the whole `perSetWeights` array and fed
`SetCard`/warmup/live-1RM by value). Fix: extracted self-subscribing memoized leaves (`ActiveSetCard`,
`SetsGrid`) + leaf-ified `Live1rmReadout`/`PipView`, so a dial detent re-renders only those small leaves;
the parent now reads just `perSetWeights[0]` (working-weight header + warmup). Also narrowed the
orchestrator pick (reps/setWeights/lap/rest moved to leaves + `getState()` in handlers). **Pure
render-optimization — the same values render, only *which* component re-renders changed** (trivially
revertible). tsc/lint/tests/build green. **NOT verified:** the actual perceived-smoothness improvement is
web-sandbox-invisible — needs the S25 APK active-workout smoke (log several sets across exercises: no
dropped dial ticks, no stale displayed weight/reps, rest ring + lap/rest counters still update, live-1RM
+ warmup update as set-1 weight changes) per `docs/device-smoke-checklist.md`.

### [readiness] Chronic-stress rollup wiring (Chunk 1, 2026-07-20) — score is null in-sandbox; NOT device-verified on real ring data · needs: data
`cumulative_stress_1_2_2` (ChronicStress) is now wired into `aggregateOuraRawSamples` (`chronic_stress`
step) via `lib/health/chronic-stress-assembly.ts` + a new per-5-min HRV series (`lib/health/hrv-5min.ts`,
ported from the preserved `sleepstaging_2_6_0` source per the owner's unblock). The golden model test is
unaffected and a synthetic-full-data unit test proves the assembly produces a non-null score. **What is
NOT verified (and can't be in-sandbox):** (1) a real **non-null** score — the model's 21-day gate means
nothing renders until ≥21 nights of real ring data with granular hypnogram/HRV/temp-skin signals exist,
and the seed DB has none; (2) whether the score is *sane vs Oura's own historical ChronicStress* — owner
/ on-device only. Two documented approximations pending owner calibration: the **fever-deviation limit**
(`TEMP_DEV_FEVER_LIMIT_C = 1.0`°C, biased against over-masking so the 21-night gate isn't starved; the
`highestTemp > 38°C` branch is the primary fever gate) and the **30-sec hypnogram** (up-sampled 10× from
the 5-min stager since the Ring 5 emits no native 30-sec phase events, making SFI transition-counting
coarser). No surface yet — a Health ChronicStress card (Chunk 2) is deferred until the owner confirms a
plausible on-device value. First score also needs a wide/full rollup pass covering ≥21 nights (the
in-memory history is built from that pass's stashed signals).

### [workouts] `active-workout-screen.tsx` has grown past the 800-line component-size guidance (found 2026-07-20)
The 2026-07-20 wiring/caching-perf audit (`docs/reviews/2026-07-20-wiring-caching-perf-audit.md`
§2.5) found `components/workout/active-workout-screen.tsx` is now 814 lines — a new hotspot not on
CLAUDE.md's named list (`session-select-content.tsx`, `workout-screen.tsx`, `config-screen.tsx`,
`health-content.tsx`/`health-sections.tsx`, `program-editor-sheet.tsx`). Advisory only — no single
extraction was obviously correct at audit time, so no plan was written for it (per the "no
orphaned findings" rule, recording it here instead). Watch it: new features should extract into
`components/workout/` children rather than appending further, and it's a candidate for a split
plan once a natural seam appears (e.g. the rest-ring/lap display vs. the exercise-list body).

### [workouts] Warm-up / bar-load status-bar chip counts DOWN + red/negative over-run (v1.181.0) — NOT device-verified · needs: android
Owner report: the green Android Now Bar prep pill counted up; they want a countdown, and at 0 it should
turn red and show how far over target it is. Both prep UIs already render a fixed target
(`WARMUP_GOAL_SEC=600`; bar-load `transitionSecForEquipment`), so the chip now passes a **future finish
anchor** and the native chip counts down, flipping to a red negative `−M:SS` over-run at the boundary.
- **This is a NATIVE change (`MainActivity.java`) — the Railway WebView deploy alone is NOT sufficient.**
  The JS half (`workout-screen.tsx`, the future anchor) is coupled to the native half: a future anchor
  renders wrong on the old native. It requires an **APK rebuild** (`npx cap sync android &&
  ./gradlew assembleDebug`, install on the S25) to take effect.
- **On-device smoke:** start a workout → warm-up pill counts down from 10:00; enter a barbell set's
  get-ready → counts down from 4:00; let one run past 0 → stays green→**red**, ticking `−0:15`, no
  "Start set" action fires. Kotlin is compile-checked only by the Android CI job (no Android SDK in the
  sandbox); `tsc`/lint green.

### [devices] Phase 2: native chest-strap foreground service (v1.180.0) — NOT device-verified · needs: hardware
Shipped for on-device testing at the owner's request. New `com.trainingai.app.polar` native package
(foreground service + GATT client + Capacitor plugin) that holds the Polar H10 connection all day so
strap HR streams with the screen off / app backgrounded (Phase 1 was foreground-only).
- **Kotlin is compile-checked only** — the Android CI job runs `assembleDebug` + the `0x2A37`
  JVM decoder test (`PolarProtocolTest`). There is no Android SDK in the sandbox, so **all runtime
  BLE / foreground-service / background behaviour is APK-only**: real all-day + screen-off streaming,
  connect/reconnect-backoff, worn-gating, and the native `/api/hr-ingest` POST using the
  `CookieManager` session cookie. On-device smoke on the S25 is the real gate
  (`npx cap sync android && ./gradlew assembleDebug`, install, wear the strap through a day of
  intermittent walks with the phone pocketed; confirm HR lands + the ring battery is unaffected).
- **Separate foreground-service chip** — Android requires one notification per foreground service,
  so this adds a "TrainingAI · Chest strap" chip alongside the Oura ring's. Consolidating both into a
  single "Sensors" notification is a deferred follow-up (needs one service to own a shared chip).
- **Mid-session pairing** still needs an app restart to activate the service (mount-time gate,
  inherited from Phase 1).

### [devices][heart-rate] Always-on chest-strap HR + "activity detected" notification (v1.177.0) — NOT device-verified · needs: hardware
Shipped to `main` for on-device testing at the owner's request; all JS, deploys via Railway (no APK rebuild).
- **Always-on strap + strap-preferred HR all day (Phase 1):** the strap now connects and wins precedence
  over the Oura ring app-wide (ambient mode), not only during workouts. Unit tests prove **ambient never
  starts the ring's burst loop** (ring-battery-safe in logic) and that ambient persistence is thinned to
  ~1 sample/30 s. But **no BLE runs in the sandbox** — real strap connect/stream, the ring battery holding
  over a full day, and actual `oura_heartrate` write-volume are **APK-only**. **Foreground-only:**
  background/screen-off all-day capture needs the native foreground service (**Phase 2**, still on the
  backlog). A strap paired **mid-session** needs an app restart to go ambient (mount-time gate). No off
  toggle yet (default-on when paired, per owner).
- **"Activity detected" notification + reworded GPS chip:** `LocalNotifications` no-op on web, so the
  one-off heads-up firing at the confirmed-walk (`probing→tracking`) transition and clearing when GPS
  stops, plus the reworded "TrainingAI · Activity / Tracking your walk or run" foreground chip, are
  **APK-only**. Verified in-sandbox: tsc, lint, build, 1715 tests (10 new live-hr/store).

### [cross] Deep app review 2026-07-19 — 1 critical + 6 high verified findings, ALL QUEUED (fixes not yet shipped)
Full-system audit (`docs/reviews/2026-07-18-deep-app-review.md`: 13 review agents, adversarial
verification of every critical/high, empirical dev-server probes; ~100 raw findings). Everything
below is **live on `main` right now** and queued in `docs/implementation-backlog.md`
(▶ Deep-review batch, plans P1–P5); this row is struck per-item as the fix PRs land.
- ~~**CRITICAL — new-food logs never reach the server (D-1):**~~ ✅ **FIXED v1.171.1**
  (`fix/s1-food-items-sync-envelope`). `food_items` added to the push envelope; the enum and the
  local-store `PendingMutation` type now both derive from one canonical `SYNCED_MUTATION_DOMAINS`
  list, and a source-scan test (D-2) fails CI if any `queueMutation` domain literal is missing from
  it. A one-shot `requeueStrandedFoodItems` heal (run before each push) re-queues the item + re-opens
  any log already dead-lettered by this bug. Server path verified on local Postgres; **the on-device
  native-SQLite heal itself is NOT device-verified** (`getLocalStore` returns null in-sandbox — the
  final gate is an APK smoke: log a new food online, confirm it appears server-side).
- ~~**HIGH — Time-in-Zone feature dead since ship (J-8):**~~ ✅ **FIXED v1.172.0** (P2) — additive
  `normalizeDateParamIso` (dash) revives the day iterator; zone-cache also invalidate-on-HR-rewrite +
  canonical profile + profile stamp. ⚠️ **Zone *values* not device-verified** — sandbox seed has no
  `oura_heartrate`, so only iteration/persist/cache-stamp are proven; real zone minutes need the S25.
- ~~**HIGH — Training Stress (OTS) route 500s in prod / never persists (J-9):**~~ ✅ **FIXED v1.172.0**
  (P2) — dash-form date; route now 200s and OTS persists on a good read. ⚠️ **Not device-verified** —
  gates `no_readiness` in-sandbox (no BLE-derived readiness); real OTS + the J-6 gappy-day grid need
  the S25 + ring data.
- ~~**HIGH — AI layers blind to live readiness (F8=E2-1+E2-12):**~~ ✅ **FIXED v1.176.0** (P3) — new
  canonical `lib/health/live-readiness.ts` (`liveReadinessByDay`/`liveReadinessForDay`/`getLiveReadiness`:
  own BLE composite wins, pre-re-key Cloud fills gaps, frozen post-re-key Cloud withheld) reads across
  prescribe signals, chat context/tools, weekly digest, health insight, and next-session. Also E2-8
  (provisional≠absent), E2-11 (prescription-retry guard widened to `consumed` alone), F9 (resilience+OTS
  surfaced to chat/digest), F6/F7 hygiene. ⚠️ **Not device / real-token verified** — no real ring data in
  sandbox; composite-vs-frozen precedence is unit-tested + seeded-smoked, S25 end-to-end freshness is device-gated.
- ~~**HIGH — BLE rollup statement-timeout cliff ~Sep–Oct 2026 (C-1=H-2):**~~ ✅ **FIXED v1.174.0** (P4
  efficiency half) — the rollup is now O(window): 35d bounded reads + an incremental daily-summary fold
  seeded from the persisted checkpoint (byte-identical to full replay) + window-scoped upsert, coalesced
  per-drain (+0x50 trigger), with K6 failure telemetry. ⚠️ **Not device-verified on real ring data** —
  admin ingest/redecode routes + real drain throughput need the S25 (rollup logic covered by 32 DB-backed
  test files on the windowed path).
- ~~**HIGH — per-workout HR stats erased by the 180d prune + rr_intervals unbounded (H-3, H-1/G-6):**~~
  ✅ **FIXED v1.177.0** (P4b retention half, `fix/s2-ble-retention`) — Lever W persists a durable
  `workout_hr_stats` snapshot (mig 135) on first recap view (COALESCE fuller-wins) with a fallback when
  the raw series thins + an admin backfill; Lever R adds the 90d `rr_intervals` write-path prune (safe
  once workout-HRV is snapshotted). ⚠️ **Not device / real-token verified** — APK recap render of the new
  snapshot summary, real strap-RR prune, and the admin backfill (seed user non-admin, `requireAdmin`→403)
  are unit/DB-tested, not on-device; the backfill must be run before ~2027-01 (first BLE workout hits 180d).
- **HIGH — native drain cursor hole-jump race (R-1):** a batch succeeding after a failed batch
  confirms past the failed span (`OuraRingService.kt` non-volatile `drainIngestFailed`, never
  re-checked in `confirmStored`) — silent permanent loss of ~one ≤255-event history batch per
  incident. Kotlin fix + owner APK rebuild (native pen).
- ~~**HIGH — dead local store silently no-ops writes (K4):**~~ ✅ **FIXED v1.172.0**
  (`fix/s1-error-surfacing-standard`). A failed native init now sets a dead-store flag →
  `getLocalStore` returns null, so writes take the online API fallback (the same path web uses — no
  risky global `runSQL`-throw) instead of no-op'ing behind a success toast; plus an amber
  "Local storage unavailable — saving online only" banner and one `error_events` telemetry row. This
  also realises R3 Task 4.2's intent (that plan's `runSQL`-throw approach is now superseded).
  **The dead-store path itself is APK-only (native SQLite) — NOT device-verified.**
- Also verified then downgraded to medium (**all FIXED v1.172.0 except where noted**): chat's
  body-weight regex auto-log (F1, still open — Stream 1 Task 5), fitness-test
  HRR1 deterministically null (E2-9, Stream 2), ✅ workout-screen infinite-skeleton path + dead error toast
  (K2), ✅ zero signal at dead-letter time (K3), `daily_zone_minutes` compute-once-forever cache
  (J-1, latent until J-8 lands). Positive: 14/17 sampled prior "fixed" claims verified
  still-fixed; admin gating, Zod coverage, ownership checks, safe-area utilities, S7 signal
  consistency, and the formula library all held up.

### [platform][app-shell] P5 error-surfacing (v1.172.0, 2026-07-19) — APK-only surfaces NOT device-verified · needs: android
Shipped the §K standard; the JS/server logic is unit-tested (cachedFetch `onError` channel,
dead-letter signal) and server-render smoked (authenticated /workout, /more, /health/heart-rate all
200, no error boundaries). These surfaces run only on the canonical APK runtime and could not be
exercised in the web sandbox — flagged per the Canonical Runtime rule:
- **Dead-store banner + write-rerouting (K4):** `getLocalStore` only returns null-on-dead when
  `isSQLiteAvailable()` is true (native + plugin). Requires a real APK with a forced init failure to
  observe the banner render, the telemetry row, and a food/body-metric save actually taking the API
  fallback. The web fallback path (which the fix reuses) IS exercised by `pnpm dev`.
- **Dead-letter toast + More-tab badge (K3):** the toast fires from `reconcileDeadLetters` after a
  real 5×-failed outbox push (native SQLite outbox); the badge is `useSyncExternalStore`-driven.
  Logic is unit-tested; on-device appearance at an actual quarantine transition is unverified.
- **Chest-strap HR re-buffer (K5):** BLE-only; the re-buffer on a failed `/api/hr-ingest` POST needs
  a paired strap on a flaky connection to observe. Pure buffer-cap logic is straightforward but
  device-unverified.
- Web-observable pieces (K2 workout error-with-retry, K9 card retry states, K1/K8 telemetry, K7
  pull-to-sync toast) are covered by the render smoke + unit tests, but the literal error UI only
  appears under a live 500/429, which was simulated in unit tests, not click-driven in-session.

### [workouts] §E1 workout-flow batch (v1.172.1, 2026-07-19) — two APK-only surfaces NOT device-verified · needs: android
The server/logic pieces are unit-tested (rehydrate reset) and DB-verified (E1-2 `loggedAt`, E1-6 `achievedAt`
against local Postgres), and `/workout` renders 200 with `allTimePr1rm` in the route payload. Two surfaces run
only on the canonical APK runtime:
- **E1-4 rehydrate reset:** the full workout-identity reset on a stale/date-rolled session fires from zustand's
  `onRehydrateStorage` at app reopen. The pure `applyRehydrateFixups` is unit-tested (a stale/warmup/date-rolled
  session fully clears; a recent session keeps its identity), but the actual app-kill-and-reopen-days-later
  behaviour needs an on-device run.
- **E1-5 offline id-only seed:** the strict-id resolution + offline reselect path only runs when `getLocalStore`
  is non-null (native SQLite) and the network fetch fails — not reproducible in the web sandbox.

### [workouts][platform] PERF-9 workout-data `?tab=all` batch (2026-07-18) — shipped, `ai_dynamic` batch branch NOT runtime-verified
- The `?tab=all` batch was dev-server verified for **byte-identical** per-session output vs the single-tab
  path (exercises/phaseStatus/aiPrescriptionPending/dataDate), zero prescribe calls, zero write POSTs — but
  only on the local **`manual`**-mode Push/Pull/Legs seed. The batch's `ai_dynamic` derivation (AI-prescription
  override, expiry-stops-driving-load, `aiPrescriptionPending`, baseline/deload phase-status) ran its empty
  paths only. It is a line-for-line mirror of the single-tab path minus the writes, and shares the same
  `buildWorkoutExercises` helper (so the exercise mapping cannot drift), and `deload-reverts` unit-tests the
  payload — but a real `ai_dynamic` program's batch output has not been compared against its single-tab output
  at runtime. Low risk (structural parity + shared helper); flagged per the verification-disclosure rule.
- Not exercised on-device: native SQLite `setCached` of the per-session seeds + Samsung WebView paint. The
  client change is a like-for-like swap of an existing `cachedFetch`+`setCached` seed pattern.

### [workouts] R4 workout-flow hygiene — WK-13 / WK-16 (v1.170.2) — shipped, both APK-only surfaces NOT device-verified · needs: android
- **WK-13 (day rollover while foregrounded):** the `rolloverDay` store action is unit-tested and the
  `visibilitychange` listener was confirmed to attach + fire without error on the dev server. The actual
  bug it fixes — an app held open **across local midnight** dropping yesterday's ticks/Complete button —
  can only be observed on a real device kept foregrounded past midnight. NOT verified on-device.
- **WK-16 (one timezone basis for the completion flow):** server date behaviour is provably unchanged
  (`normalizeDateParam` already discarded the payload's datetime suffix and fell back to the server's own
  `todayInTz(tz)`), and the optimistic calendar stamp now uses the same `YYYY/MM/DD` user-tz format
  `getCalendarData` keys with. The divergence it fixes is only observable on a device whose OS clock is set
  to a **non-`Australia/Brisbane`** timezone near midnight — the dev sandbox tz is Brisbane (device == user
  tz), so it's unobservable here. NOT verified on-device.
- **Deferred (item 8 backlog notes, not regressions):** WK-15 (re-key phase counting off `session_id` —
  needs a backfill migration for the nullable column; renaming a session still resets phase progress) and
  WK-18 calendar_event outbox (a failed Google Calendar add still drops silently).

### [workouts] Goal-aware accessory intensity (v1.170.0) — shipped, owner's live program NOT device-verified · needs: data
- The math (`pctForExpectedRpe` inverse, goal-aware bands, the prescribe + workout-data apply points)
  is fully unit-covered (16 tests + regression sweep) and `tsc`/lint/full-suite/build green; dev-server
  verified the manual path is untouched and an ai_dynamic accessory moved 75%→66% at 12 reps (RPE-8
  strength target).
- **NOT verified on-device:** the fix is visible only where an accessory flows through an **AI-dynamic**
  path; the owner's live "RPE 6 → RPE 8" change is confirmable only against their production program on
  the S25 (open an accessory, confirm the slider reads ~RPE 8 and the prescribed weight rose). Run
  `docs/device-smoke-checklist.md` or treat this row as the not-yet-device-verified marker.
- **Out of scope (flagged follow-ups):** a stored **static** accessory style % on a **non-AI-dynamic**
  program is per-user DB data, untouched (retro-fixing needs re-generation or a confirm-first migration);
  **per-muscle-group** intensity profiles were explicitly deferred by the owner. `ACCESSORY_SPEC` target
  RPEs are starting points — tunable per goal if the owner wants more/less.

### [platform][readiness] On-device health-anomaly alerts (v1.169.0) — shipped, native delivery NOT verified
- The pure decision logic (`computeHealthAlertActions` — illness/stress/readiness fire/skip, dedup,
  precedence) is fully unit-covered (11 cases) and `tsc`/lint/full-suite/build green; the two dependency
  constants (`STRESS_HIGH_LEVEL`, `STRESS_HIGH_DAY_THRESHOLD_MIN`) and the `body-battery.stress.highMinutes`
  field are confirmed live on `main`.
- **NOT verified on-device (owner APK smoke pending):** `Capacitor.LocalNotifications` no-ops in the web
  sandbox, so the **actual notification delivery** — scheduling, the `health-alerts` channel auto-create,
  the mount/resume firing from `sync-provider.tsx`, the per-day dedup persistence, and the tap-through
  route (`/health/readiness`) — is APK-only and unexercised here. Client/JS only (ships via Railway, no
  APK rebuild), so the code reaches the device on next WebView load; only the native transport needs the
  smoke run.
- **Scope, by design:** delivers the offline-first 90% — the anomaly fires the next time the app is
  opened/resumed that day. True closed-all-day-unsynced push needs the deferred FCM-native endgame.

### [cardio] Running Prescription Coach Phase 1 (v1.167.0) — shipped, offline-first + device paths NOT verified
- The engine (`lib/running/`, 22 tests), persistence (`running_plans`/`prescribed_runs`, mig 132, SQLite v15),
  `GET/POST /api/running-plan` + `PATCH runs/[id]` + `explain`, and the `/running` UI are sandbox-verified:
  full suite (1698) / `tsc` / lint / `check-push-mutations` / `pnpm build` green, and a dev-server round-trip with
  real auth exercised create → gate-aware prescription → `rest` on seeded low readiness → complete/skip →
  no-clobber re-GET → real Gemini `explain`.
- **NOT verified on-device (owner APK smoke pending):** the **offline-first completion path** — native SQLite
  (`getLocalStore` is null in-sandbox), so the local-first read of today's status, the `prescribed_run` outbox
  push, the `pushMutations` mirror, and the `applyDelta` pull clobber-gate only ran via the web API fallback here;
  the SQLite **v15** table create + reconcile need the APK. Also **safe-area insets** (`/running` header + `pb-safe`
  Start button render as 0 in-sandbox) and the **guided-activity hand-off round-trip** (Start → `/activity` →
  `activity_logs` row → `activity_log_id` link → next prescription). JS/server ships via Railway with no APK rebuild;
  the local SQLite table is created by the existing JS migration runner on next open.
- **Adaptive re-prescription is Phase 1 only** — the plan is regenerated each `GET` from current signals but the
  weekly base volume does not yet grow from logged runs, and there is no multi-week look-ahead (Phase 2, backlogged).

### [app-shell] App icon → dumbbell (v1.166.3) — launcher + notification icon NOT device-verified · needs: android
- Replaced the blank white launcher placeholder with a green dumbbell (candidate B): Android adaptive
  foreground/background + a new `<monochrome>` themed-icon cutout across all densities, legacy
  `ic_launcher`/`ic_launcher_round`, a new `ic_stat_dumbbell` notification silhouette (Oura foreground-service
  notification now uses it, `OuraRingService.kt`), and the PWA `app/icon.tsx`/`apple-icon.tsx` refreshed to
  match (manifest cache-bust `?v=3`, version 1.166.3).
- **Verified in-sandbox + CI:** the PWA icon routes render valid PNGs (`/icon?v=3` 512×512, `/apple-icon`
  180×180, both 200/image-png), lint clean, and CI's "Android (Kotlin tests + debug APK)" job compiled the
  Kotlin change + resources. **NOT verified on-device:** the *visual appearance* of the native launcher icon,
  themed-icon cutout, and notification small-icon only takes effect after an **owner APK rebuild** (`npx cap
  sync android && ./gradlew assembleDebug`) — the home-screen icon won't change until that rebuild. The
  in-app/browser icon updates immediately via Railway.

### [cardio] Cardio Baseline Fitness Tests (v1.166.0) — shipped, on-device flow NOT verified
- The guided-test flow (`/baselines`), the offline-first `fitness_tests` domain (mig 131, SQLite v14, full
  outbox/sync mirror), the VO₂max equations (`lib/health/fitness-tests.ts`, unit-tested), and
  `/api/fitness-tests` (GET/POST/DELETE, dev-server round-tripped against local Postgres) are all
  sandbox-verified; `tsc`/lint/`check-push-mutations`/full suite (1669) green.
- **NOT verified on-device (owner APK smoke pending):** **live HR** (`useLiveHr` shows `—` in the sandbox —
  ring/strap sources are APK-only), **GPS distance** (`navigator.geolocation` yields no fix in-sandbox, so a
  real 6MWT/Cooper VO₂max is only obtainable on-device outdoors, screen-off), the **native SQLite offline
  path** (`getLocalStore` is null in-sandbox → local write/outbox/`pullDelta`/offline-render only run via the
  web API fallback here; the SQLite v14 create, the pull-clobber `sync_status` guard, and cross-device delete
  propagation need the APK), **safe-area insets** on the four full-screen test surfaces, and **haptics** on
  finish. JS/server ships via Railway; the SQLite v14 migration + native paths require an APK rebuild.

### [cardio][heart-rate] HR/cardio baseline bug fixes (v1.173.2) — shipped, guided-HRR + safe-area NOT device-verified · needs: android
- **What changed (3 owner-reported bugs):** (1) 6MWT VO₂max was ~half of reality — switched from the
  clinical-population Ross 2010 distance-only equation to the **Burr 2011** healthy-adult multivariable
  equation (weight/sex/RHR/age threaded through `app/baselines/page.tsx`), Ross kept only as a
  missing-data fallback; (2) Resting HR + Recovery now runs a guided rest→effort→recovery phase machine
  (`TestHrrGuide`) and measures the 1-min drop from a deterministic `recoveryStartMs` (was measured
  from end-of-capture → always blank); (3) fitness-test screens moved off floorless `pb-safe` to the
  floored `pb-safe-action`/`-lg` utilities. CLAUDE.md Safe-Area section rewritten so the doc no longer
  prescribes the floorless utility for anchored controls.
- **Sandbox-verified:** `tsc`/lint green; 16 fitness-test unit tests (Burr + Ross fallback, phased-HRR
  recovery computation, phase helpers); `/baselines` renders authenticated (200) against local Postgres.
- **NOT verified on-device (APK smoke pending):** the guided-HRR recovery drop depends on **live BLE HR
  samples** arriving through the recovery minute (sandbox shows `—`), **GPS** distance for a real Burr
  VO₂max, native SQLite save, **safe-area** clearance on the four test surfaces (insets render 0 in web),
  and phase-transition haptics. JS/server ships via Railway; no migration/native change, so no APK rebuild.
- **Cooper 12-min run confirmed unaffected** (correct Cooper 1968 equation, shares no code with the bugs).

### [workouts] Stale-session-id fix / strict id-only identity (v1.171.0) — shipped, NOT verified on-device
- **What changed:** `/api/workout-data` now resolves sessions **by id only** (removed the
  `find by name` and `sessions[0]` fallbacks) and returns `{ sessionNotFound: true }` for an unknown
  id; the 3 card-prefetch callers pass `sess.id`; program save force-re-syncs the offline mirror
  (`pullDelta(userId, true)`), and `pullDelta` gained `fullResync` (since=0); the workout screen
  recovers a stale id via an id-based full re-sync + a "reopen the session" reselect screen; exercise
  ids round-trip through the editor; prescribe self-heals a valid-but-stateless session.
- **Highest risk — removing workout-data's name fallback.** Audited every `workout-data?tab=` caller
  (all pass id or `meta`; chat's `sessionType` feeds WeightsPanel, not a session load) and full
  suite/build are green, but a missed name-based caller would now 404 as `sessionNotFound`. **On-device
  smoke required:** open each session (Push/Pull/Legs/Upper/Lower), confirm exercises + AI card load;
  edit a program → reopen → confirm the AI prescription regenerates (no "couldn't generate"); confirm
  a genuinely stale link shows the reselect screen and recovers after reselect.
- **Device-only unverified paths:** the native SQLite mirror write on save, `fullResync` rebuild,
  the `sessionNotFound`→re-sync→reselect flow, and baseline-1RM preservation across an edit — none run
  in the web sandbox. JS/server-only — live via Railway on merge, no APK rebuild.
- **Owner recovery for the currently-stuck device:** after deploy, opening the broken session
  force-re-syncs the mirror; then reopen it from the session list (correct id). A reinstall also works.

### [activity] Step-counter real-data console — shipped, step count NOT owner-validated on-device
- The real-data pipeline (`lib/oura-ble/step-counter-pipeline.ts`: stored `0x7e/0x7f` → `unpack27` →
  `runStepsMotionDecoder` → `runStepCounter`) is wired, exposed by admin-gated
  `GET /api/oura-ble/step-counter-export`, and surfaced by `StepCounterExportConsole` on `/admin/oura-ble`.
  The wiring is unit-tested (pair → dequantize → step_counter over synthetic frames), the authed route
  happy-path was exercised on the dev server against the local DB (seeded anchor + 8 paired frames →
  valid JSON: paired windows, decoded stride-frequency summary, step_counter total, Tier-1 gate estimate),
  and the admin page renders. `tsc`/lint/full suite (1657) green.
- **The step_counter TOTAL is NOT a trusted count yet** — two things are unconfirmed and are exactly what
  the console exists to validate against a phone: (1) that `unpack27`'s 27-column order matches
  `steps_motion_decoder`'s `data_columns` order (Sub-plan D-2), and (2) the `0x47` → step_counter 8-column
  motion mapping (`regular_motion` isn't decoded → NaN→0; motion is often absent daytime → the stream is
  zeroed). Trust the **golden-verified decoded stride-frequency** (~1.5–3 Hz walking) and the **Tier-1 gate
  estimate** as the physical cross-checks meanwhile. Owner validation: do a counted walk, sync the ring, run
  the console, compare the total to the phone. JS/server-only — ships via Railway, **no APK rebuild**.

### [sleep] BDI reclaim (breathing-disturbance index) — shipped, real-night value NOT device-verified · needs: data
- The moonstone SleepNet apnea head (a free byproduct of the nightly staging pass) is now captured as
  `bdi_derived` (disturbed asleep-epochs/hour) and persisted to `oura_daily_derived` in the rollup, with a
  read path. The BDI math (`bdiFromApnea`) is unit-tested (disturbed-count, awake-epoch drop, no-sleep zero),
  the read path is DB-integration-tested (round-trip + COALESCE no-clobber), and the rollup plumbing is
  typecheck + full-suite green.
- **NOT trustworthy until on-device validation:** the neural stager and its apnea head only run against
  synthetic vectors in the sandbox — a real-night number requires the owner to run the admin SleepNet dump on
  a worn-overnight drain (`components/oura-ble/sleepnet-dump-console.tsx`) and confirm a sane value (the
  per-beat IBI-timestamp reconstruction feeding the model is itself an unproven device assumption). This is
  why the **user-facing display is deferred** (backlog follow-on) and no Health surface ships in this PR.
  Observational, not a diagnosis. JS/server-only — ships via Railway, **no APK rebuild**.

### [readiness] Stress-resilience (v1.163.0) — shipped, rollup compute path NOT device-verified end-to-end · needs: data
- The `stress_resilience_2_2_1` TS port is **golden-verified** against the captured `.pt` vector (all 13
  outputs within 1e-3); the orchestrator's provisional-contributor gating, band cut-points, `<5`-valid-day
  null gate and confidence are unit-tested. The read path is dev-server verified: seeding
  `oura_daily_derived.resilience_*` and hitting `GET /api/readiness-score` returns
  `ownResilienceLevel/Band/Confidence` (4 → "solid" → 1.0), and nulling the level hides the tile with **no**
  frozen-Cloud fallthrough.
- **Unverified on device:** the rollup `resilience` step (`aggregateOuraRawSamples`) builds the daytime
  stress series from raw BLE temp/met/hr and runs one ONNX pass per 30-min bucket — the sandbox has no raw
  BLE samples, so the per-night index computation + level fit can only be exercised via the seeded read
  path, not end-to-end. A real level also needs ≥14 nights of mature `oura_daily_summary` baseline **and**
  ≥5 days with ≥4 h of daytime-stress coverage (the ring power-gates when worn-idle at a desk), so live
  resilience is only observable on-device after history accrues. Also the tile rendering at ≤640px in both
  themes (self-hides while null). JS/server-only — ships via Railway, **no APK rebuild**.

### [cardio] Training Stress Score (OTS) + VO₂max (v1.162.0) — shipped, OTS `ok` path NOT device-verified end-to-end · needs: data
- VO₂max derivation + the OTS core port are **golden-verified** against the captured `.pt` vector
  (parity within 1e-3) and the assembly/gating is unit-tested. The route (`GET /api/training-stress`)
  runs the full chain on the dev server and correctly gates.
- **Unverified on device:** the raw `0x50` MET-stream decode → 1-min series (native BLE ingest) — the
  sandbox has no real MET data, so the route's `ok` path (a live OTS number + persistence) can only be
  exercised with the golden MET series in unit tests, not end-to-end. On a real worn day the ring must
  yield ≥720 minutes with ≥360 valid (≥0.9 MET) for OTS to compute. Also the done-screen badge / health
  line rendering at ≤640px in both themes (they self-hide while gated, so appear only with live MET).
  JS/server-only — ships via Railway, no APK rebuild.

### [devices][app-shell] Frozen-Cloud display honesty (v1.161.2, item 21) — shipped, NOT visually verified at S25 viewport / both themes
- New display markers/date-stamps: readiness-card temp row "Pre-re-key" chip on the Cloud fallback;
  heart-rate page VO₂ max / vascular age "as of \<date\>" stamps; RHR/HRV/SpO₂ tiles append the
  reading's date when it isn't today's; admin tester drops the dead Battery stat (live plugin
  battery strip unchanged). All server/JSON contracts + route SSR verified on the dev server
  (readiness-score new fields present / `resilienceLevel`+`sleepTimeStatus` gone / 10c derived
  stress preserved; VO₂ date-stamp via a seeded pre-re-key row; health-insight + ai-chat 200).
- **Unverified:** the pixel-level appearance of the new chips/date lines at ≤640px in **both**
  dark and light themes — no browser in the sandbox (Playwright unavailable). JS/server-only change
  (no native/safe-area/gesture/offline-first surface), ships via Railway, no APK rebuild. Give the
  markers an on-device eyeball on the next APK build.

### [workouts] "Preparing your AI workout" pre-start gate (v1.156.0, poll fix v1.165.2) — UI device-confirmed; generation-success still to verify
- New behavior: while an ai_dynamic non-baseline prescription is regenerating (`consumed` + null),
  the pre-workout screen shows a "Preparing…" state (Start held) and bounded-polls workout-data
  (~10 × 3s = 30s) until the AI numbers land, then swaps them in; on timeout it reveals the base
  numbers with a note. Server flag (`isAiPrescriptionPending` + `aiPrescriptionPending` in
  `/api/workout-data`) and the helper are unit-tested.
- **Device-CONFIRMED (owner screenshots, 2026-07-17):** the "Preparing…" card + Start-gating render,
  and the timeout→base-fallback note renders. Those halves of #584 are verified.
- **v1.165.2 fix:** the poll was re-firing `/prescribe` every tick (cachedFetch always revalidates →
  workout-data re-fires generation), bursting ~8 Gemini calls in 24s and rate-limiting itself into
  the 502 → base-fallback the owner hit. Poll now sends `?poll=1` to read-only-check (no re-fire);
  generation fires once per screen-open + on manual refresh.
- **Still to verify on-device:** that a real generation now **succeeds** (preparing → moderated numbers
  swap in) rather than falling back — the rate-limit was the suspected cause but can't be reproduced
  in the sandbox. If it still falls back after v1.165.2 with only one generation firing, the failure
  is a deeper `/prescribe` error (Railway logs needed).

### [devices][heart-rate] Polar H10 chest-strap live HR (v1.154.0, this session) — shipped, NOT verified on-device
- The whole BLE half is device-only: pairing via the OS picker, streaming, the worn-gate
  fallback (unclip → ring takes over in ~15 s, re-clip → strap reclaims), reconnect retry, and
  two-device coexistence with the ring's own GATT connection. The web sandbox exercises none of
  it (`@capacitor-community/bluetooth-le` is native; the source degrades to inert `disconnected`).
- **Requires an owner APK rebuild first**: `npx cap sync android && ./gradlew assembleDebug`
  (new native plugin — self-registers, no `MainActivity` edit). JS/server halves are live via
  Railway on merge.
- Sandbox-verified: parser/merge/rMSSD unit tests (16), `/api/hr-ingest` +
  `/api/oura/hr-data?sessionId` live-route smokes against the local DB (RR beat-time
  reconstruction exact; seeded ±25 ms alternation returned rMSSD 25), full suite green,
  `pnpm build` clean.

These are the **open** risks — mostly features that shipped but were only verifiable in the web
sandbox, never on the Samsung S25 (no Capacitor/native SQLite/safe-area insets in the sandbox).
Run `docs/device-smoke-checklist.md` as the concrete on-device verification step.

### [sleep][devices] Neural SleepNet stager now primary (v1.151.0, this session) — assembler validated on 3 real nights; production 5-min output not yet eyeballed on-device
Oura's `sleepnet_moonstone` model (ONNX, onnxruntime-node, server-side in the rollup) replaced the
heuristic stager as primary; the heuristic stays the automatic fallback when inference/preprocess
can't run. Validated via the admin dump on 3 real nights (07-14/15/16): sane inputs (HR ~62–66 bpm,
full-night beat span) and REM 21.6–25.9% (in/near the Cloud band 23–28%), vs the heuristic's erratic
17.6–24.2%. **Open:** the production path downsamples the model's 30-s hypnogram to the 5-min grid
(majority vote) — the resulting `sleep_sessions` %s haven't been compared against the admin dump's
30-s %s on-device yet. After deploy, cross-check the Health tab sleep card vs `/admin/oura-ble` →
SleepNet dump for the same night. Also `spo2=0` on all dumps (the ring isn't feeding SpO₂ to the
assembler — minor, REM is right without it; tag mapping TBD). Perf: runs one ONNX inference per night
in the aggregate — negligible for a normal sync, ~adds up over a full-history redecode.

### [platform] Admin console G-1 domain-section skeleton — ① Data section device-verified (owner, on S25 APK)
`oura-ble-debug.tsx` was re-sliced into the six domain `CollapsibleSection`s. Every BLE lever was moved
**verbatim with its handler** (state stays at the top level of the component, so wiring is preserved by
construction), and it's tsc/lint clean + builds. **✅ Owner confirmed on-device (screenshots, real S25
APK + production data):** the ① Data·Ingestion·Retention chevron renders and expands correctly, and its
G-2 footprint card + **Lever 1b backfill button work end-to-end against real data** (see the dedicated
Lever 1b entry below). **Remaining to spot-check:** the other five domain sections (Sleep,
Steps·Activity·Energy, Recovery·Readiness·Illness, Cardio·Body-comp, Cloud-legacy) — chevron
render/toggle and that a moved lever in each still fires (Sync/Drain, a HR lever, Enable steps, Dump
sleep frames, Battery soak). Hand-rolled chevrons in `sample-inspector.tsx` / `time-audit-card.tsx` /
`admin-content.tsx` are not yet converted (deferred).

### [readiness] Illness radar advisory render (v1.150.0, this session) — shipped, NOT verified on-device
The radar logic + readiness-route suppression are verified end-to-end on the dev server (a +3σ
skin-temp night → `fever`, readiness 85→22). The **advisory line** in the readiness detail
(`components/health/health-score-detail.tsx`) is a plain bordered text card (Lucide icon + flag label +
copy) inside an existing scroll container — no safe-area/fixed/gesture surface, so low device risk — but
its Samsung WebView render was not checked on-device. Verify the advisory shows on a real elevated/fever
night. Also not yet persisted to `oura_daily_derived` (analysis record deferred to the readiness-persist PR).

### [workouts] Next-workout prescription card on the done screen (v1.149.0, session 295) — shipped, NOT device-verified · needs: browser
Server/JS only (no APK rebuild), but the plan's own gate is on-device: complete a workout on
the APK, tap "Show" on the new "Next workout" card, and confirm the previewed per-set
weights/reps/rest match what `/workout` actually opens with for that next session. Web `pnpm dev`
verification only proves the endpoint returns a well-formed response and the card renders it —
it cannot prove the previewed loads agree with the live workout screen's own computation for a
real AI-dynamic prescription, since the seeded dev-DB user's exact periodization state wasn't
independently cross-checked set-by-set.

### [workouts] Rest-timer status-bar chip (v1.147.0 → v1.166.0, session 292) — CONFIRMED working on-device
Android 16 promoted ongoing notification (One UI Now Bar / status-bar pill) showing a live rest
countdown during a workout, tap-to-reopen. Native-only: an `AndroidRestChip` JavascriptInterface
bridge in `MainActivity.java`, `POST_PROMOTED_NOTIFICATIONS`, `ic_rest_timer` drawable, a guarded
`lib/native/rest-timer-chip.ts` bridge (no-op off-device), start/stop wiring in `workout-screen.tsx`,
Profile → Preferences toggle (`ta_pref_rest_chip`, default on).
**CONFIRMED on-device (owner APK 2026-07-16): the pill shows with the ticking countdown.** Two
device-only gotchas that took the debugging: (1) Samsung gates third-party Now Bar behind
**Developer options → "Live notifications for all apps"** (off by default) — must be on; (2) the app's
**PiP window suppresses the pill** — while the app shows PiP, Samsung hides its status-bar chip.
Promotion mechanism: `NotificationCompat.Builder` + `setRequestPromotedOngoing(true)` (androidx.core
1.17.0, added 1.17.0-alpha01) + `CATEGORY_STOPWATCH`; the hand-written raw extra (v1.147.0) did NOT
promote — NotificationCompat does.
**v1.155.0 follow-ups (native, MainActivity — NOT yet device-verified):** (a) **suppress PiP during
rest** so the pill is the leave surface (PiP still opens for the active set) — gated on `restChipActive`
in `onUserLeaveHint`; (b) **overtime persistence** — a `Handler` re-posts the chip counting UP at the
rest boundary (`setChronometerCountDown(false)`, `setWhen` now in the past) instead of `setTimeoutAfter`
clearing it at 0:00 (which let another app's chip steal the slot); safety timeout extended to 30 min;
(c) **"Start set" notification action** reusing the PiP `ACTION_LOG` broadcast (pipReceiver moved to
onCreate→onDestroy so it's delivered while backgrounded — no app open, no new JS). **On-device smoke
after rebuild:** home-out during rest → pill (no PiP); let it hit 0:00 → flips to count-up overtime,
doesn't vanish; tap "Start set" from the notification → next set starts; home-out during a set → PiP
still works. **CONFIRMED on-device (owner APK 2026-07-17): pill-during-rest + overtime count-up both
work.**
**v1.165.3 (native, NOT yet device-verified):** overtime tints the pill **red** — `builder.setColor(0xFFEF4444)`
(the app's overtime red) on the count-up re-post only; the Now Bar chip follows the notification's
accent colour, so the countdown pill keeps the system-default blue and the overtime pill goes red. If
the chip doesn't pick up the colour on-device, the fallback is a red variant of `ic_rest_timer` (the
chip always tints its icon by `setColor` even when it won't recolour the pill background).
**v1.166.0 (green warm-up/prep pill — native + JS, NOT yet device-verified):** the pill now also shows
during the two "prep" periods it previously skipped, tinted **green** (`WARMUP_COLOR = 0xFF22C55E`):
the whole-workout warm-up (`store.mode === 'warmup'`) and the pre-set get-ready / bar-load screen
(`mode === 'active' && !timerStarted`). The bridge gained a `mode` arg (`"rest" | "warmup"`);
warm-up/prep **counts up** from its start anchor (green, no overtime), a working-set rest still counts
down (blue → red). Anchors: warm-up = `workoutStartMs`; get-ready = `workoutStartMs +
readyElapsedBaselineSec*1000` (survives a background remount). No "Start set" action on the green pill.
PiP is already suppressed while the chip is active, so these prep periods now show the green pill
instead of PiP too. Colour model: **green = preparing, blue = resting between work sets, red =
overtime.** On-device smoke: warm-up screen → green count-up pill; get-ready/bar-load before a set →
green; start the set → clears; between working sets → blue; past 0:00 → red.

### [workouts] Rest timer on the "All sets done!" screen (v1.146.0) — shipped, NOT device-verified · needs: browser
After logging the last set of an exercise, the rest countdown ring now stays on the "All sets
done!" screen (`active-workout-screen.tsx`, extracted into `components/workout/rest-ring.tsx`)
instead of being replaced by a static card — the rest period was always running (beep +
notification already scheduled; the last set IS awarded `progressionStyle[last].restSec`, 90s
fallback), only the ring was hidden. Tests/lint/`tsc` green, `/workout` compiles + renders 200 in
`pnpm dev`. **NOT verified on the APK** — reaching the all-sets-done state requires driving the
full log-all-sets flow, and the ring is a visual change on the workout screen. Safe-area untouched
(ring is in the existing centre flex zone). On-device smoke: log every set of an exercise, confirm
the ring counts down on the done panel and rolls into red "Overtime" if you wait.

### [heart-rate] Live-HR beat-median smoothing (v1.145.1, 2026-07-14) — shipped, NOT verified on-device
Owner-reported spiky in-workout/rest HR readings. Root cause: the live path decoded a *batch* of
beats per BLE frame but surfaced only the single newest one (`latestBpmWithTsFromFrames` →
last-array-element), so instantaneous beat-to-beat HRV read as jumpy and a lone motion/decode
artifact showed unfiltered. Fix (pure TS, JS-only — ships via Railway, **no APK rebuild**, no
native/burst-cadence change): `decode-live-hr.ts` now exposes `smoothedBpmFromFrames()` which
medians the most-recent `HR_AVG_WINDOW_BEATS = 10` fresh beats (reusing the shared `median()`),
applied at the decode source so the live number, exercise trace, and sparkline all inherit it; the
near-live freshness/dedup guard is preserved and the `latest*` newest-beat functions were removed.
Also added an admin **Live HR test console** (`components/oura-ble/live-hr-test-console.tsx`, mounted
on `/admin/oura-ble`) that surfaces the manager diagnostics (frames/HR-frames/decode-hits), the raw
within-batch beat spread the median smooths over, and a rolling log of surfaced readings with deltas.
Unit tests (median-not-newest, artifact rejection, window bound, freshness guard, `allBeatsFromFrames`)
+ `tsc`/`eslint` clean; the full local `pnpm build` fails only on the pre-existing sandbox-absent
`@capacitor/splash-screen` module (CI installs it). **NOT verifiable in the web sandbox** (no BLE
frames — `getOuraBle()` is null): the on-device smoothness of the rest-window readout. On device:
during a workout rest (or via the new console's Start/Measure), confirm the surfaced bpm tracks
smoothly with no single-beat spikes while `decodeHits` advances, and that the batch-spread row shows
multiple beats per burst. If bursts prove sparse, `HR_AVG_WINDOW_BEATS` is the single tunable.

### [app-shell] Persistent tab shell (v1.145.0, session 298) — shipped, NOT verified on-device
Instant tab switching via a persistent client `TabShell` that keeps all five tab trees mounted
and flips visibility instead of navigating routes (`components/shell/tab-shell.tsx` +
`tab-page.tsx` + `tab-visibility.tsx` + `lib/shell-nav.ts`). **Verified in the web sandbox**
(Playwright vs `pnpm dev`): every tab tap — first activation and revisit — issues zero
RSC/document requests, URL syncs per tab, scroll position and sub-tab/date state survive
switches, deep links work. `pnpm lint`/`tsc`/tests (1294)/`build` green. **NOT verified on the
S25**, and several load-bearing behaviours only exist on-device: (a) the actual *feel* and paint
timing in the Samsung WebView (the whole point of the change); (b) memory/GC pressure with all
five heavy trees kept alive at once (`content-visibility:hidden` skips their *rendering*, not
their JS state — if this janks on-device, the fallback is to unmount the least-recently-used
hidden tab, but that costs its keep-alive); (c) the Android hardware back button now exits the
app from a tab instead of unwinding tab history (intended, `replaceState` not `pushState` — but
confirm it doesn't strand a mid-workout leave-dialog); (d) `inert`/`content-visibility` WebView
rendering; (e) the Nutrition cross-midnight rollover (only reproducible by rolling the device
clock). Run the "Persistent tab shell" section of `docs/device-smoke-checklist.md` on-device.

### [app-shell] R7 UI Polish & Accessibility (v1.143.7, session 287) — shipped, PARTIALLY verified
Chart black-bar fix, double-inset sheet fix, `DismissibleBanner` primitive + two banner
rewrites, `aria-expanded` sweep, and palette-literal→token/emoji→icon swaps (see Current Status
above for the full list). `pnpm lint`/`tsc`/tests/build all green, and most of it was verified
live via Playwright in both light and dark theme. **NOT verified live: the workout-load-
comparison chart's black-bar fix inside the actual Day-in-Review sheet** (`day-review-sheet.tsx`
→ `workout-load-comparison-chart.tsx`) — the verification pass couldn't get the sheet to expand
past its collapsed header in headless Playwright, and the seed data had no day with an actual
comparison chart to render. The fix is the same `resolveColor()` pattern already verified working
elsewhere (the R6 PR's HR-recovery-chart fix, and `trend-sparkline.tsx`'s long-standing use of
it), so risk is low, but it hasn't been observed rendering. Also **not exercised: the Oura
stale-sync amber+warning-icon indicator** (`more/oura-section.tsx`) — the seed data's Oura Ring
was never connected, so the stale-sync branch never renders. A follow-up pass should open the
Day-in-Review sheet on a day with real workout-load history and confirm the "today" bar is
brand-coloured (not black) in both themes, and separately confirm the Oura section's stale-sync
line shows amber + a warning icon when `lastSyncedAt` is old.

**Also found during this pass, not fixed (out of scope, noted for a future backlog entry):** a
reproducible React hydration mismatch on Home's week-strip "today" cell — SSR renders a muted,
non-"today" `aria-label`/styling; the client re-renders it brand-coloured/bold with "today" in
the label immediately after hydration. Root cause looks like the today-check running with a
different date server-side vs client-side (the classic `todayInTz()` SSR/client boundary drift
this project's CLAUDE.md already has a standing rule about).

### [app-shell] R6 Performance & Paint, Chunks 1/2/3/5 (v1.143.6, session 287) — shipped, PARTIALLY verified
Bundle-size, hydration, and render-hygiene batch (see Current Status above for the full list).
Every change is either a pure import-strategy swap (dynamic-with-skeleton → static, static →
dynamic), a `useMemo`/leaf-component extraction with no logic change, or a data-fetch
consolidation/split verified against the Network panel — `pnpm lint`/`tsc`/tests/build all
green, and the majority was verified live via Playwright (Home reload, all 3 Health tabs,
Nutrition's 6-date swipe — see Current Status for specifics). **NOT verified live: the Warm Up
screen's memoized `MuscleHeatmap` (PERF-2 fix in `warmup-screen.tsx`)** — the verification
pass's workout-entry point wasn't reached in the time available. The fix is a direct,
minimal `useMemo` wrap copying an already-shipped identical fix in the sibling
`active-workout-screen.tsx:176-181`, so risk is low, but this hasn't been observed rendering.
A follow-up pass should start a workout, open the Warm Up screen, and confirm the muscle
diagram renders correctly and does not re-render every second (a temporary `console.count` in
`MuscleHeatmap` during the check, removed after).

### [workouts] Workout-system hardening Chunk 5 (v1.143.5, session 287) — shipped, PARTIALLY verified
UI/UX polish + in-workout HR theming sweep across nine workout files (see Current Status above
for the full list). All server/client logic is either pure-function-driven (weight snapping, RPE
re-tap) or a mechanical color-token/icon swap with no new branching — `pnpm lint`/`tsc`/tests/build
all green. **Verified live via Playwright:** `/workout-select`'s carousel dots and card layout
render correctly in both light and dark themes at the 384×832 viewport. **NOT reached live** (ran
out of time mid-verification): the active-workout screen's header buttons and set-card borders,
the exercise-summary screen's chevron/1RM-arrow icons, the done-screen PR-card color / share-icon
visibility / HR error-retry state, and the weight-dial's check/recommended-dot icons — these were
verified via code review and the full build/lint/tsc/test gate only, not observed rendering. A
follow-up on-device or Playwright pass into an actual active workout should confirm these render
as intended (theme-token borders visible, icons showing, no broken layout).

### [devices][platform] Admin Oura BLE debug UI cleanup (v1.143.3, session 297) — shipped, NOT verified on-device
Pure UI reorganisation of `/admin/oura-ble` (owner-requested — the screen had grown a single giant
"Advanced (raw protocol)" panel cramming ~25 raw buttons + four large tester cards together). Now:
raw commands grouped by function under one collapsible (`Raw protocol commands`), and each tester
(Step calibration, Live step test, Continuous capture, Battery soak, Sleep epochs) is its own
`CollapsibleSection` (new shared primitive `components/ui/collapsible-section.tsx`). The log console
gained Copy + Clear buttons (new shared `lib/use-copy.ts` hook, WebView-first execCommand path)
so logs no longer need screenshotting; the four tester cards' duplicated copy logic was folded onto
the same hook. **No functionality was removed** — all handlers preserved; this is layout only.
`tsc`/`eslint` clean. **APK-only screen — the native OuraBle plugin is inert in the web sandbox, so
the collapsibles/copy could only be checked to compile, not exercised with real ring data.** On
device: open `/admin` → Tools → Oura BLE debug, confirm each section expands/collapses, the raw
buttons still fire (watch the Log section), and the log Copy button lands the full text on the
clipboard. Candidates for outright removal (kept this pass because in-use status couldn't be
confirmed from the sandbox): Step calibration and Live step test are the pre-production step-count
spikes now superseded by Continuous capture; Battery soak was a one-off measurement.

### [sleep][devices] BLE sleep-timing fixes (v1.143.2 → v1.144.1, sessions 292–293) — verified on real data; window clamp hardened
Three owner-reported sleep-timing fixes across two nights.
**(1) Future wake time (v1.143.2):** the sleep detail could show a wake a few minutes in the future when
opened right after waking; `lib/sleep/actual-window.ts` now anchors the end to the ring's recorded wake
(`phaseWindowEnd ?? sleepEnd`). Verified on-device (07-14 read `10:14 pm – 6:07 am`, no future wake).
**(2) Bedtime too early (v1.143.2, then hardened v1.144.1):** the night window included evening
wind-down before real sleep. v1.143.2 clamped to the 0x72 sleep-accelerometer span (fixed 07-14: 8:42 pm
→ 10 pm). But 07-15 defeated it — a short dense-but-AWAKE burst at 19:53–20:03 (elevated HR + movement)
made the accelerometer "start" ~2h early, so bedtime showed 8:28 pm. v1.144.1 reworks the clamp
(`lib/sleep/sensing-span.ts`) to key on HR-sample **density** per epoch (the ring spot-checks HR while
awake but streams hundreds of beats/epoch continuously only while asleep), clamping to the span of
substantial dense runs — dropping a short evening burst while still spanning a genuinely split night.
Pinned to both owners' per-epoch dumps (07-14, 07-15) + a DB-backed end-to-end regression; the 07-09
split-night merge test stays green. **Server-side — ships via Railway, retroactive on a redecode; no APK
rebuild.** ⛔ v1.144.1 NOT yet confirmed on real data: after deploy, redecode `2026-07-15` and check
bedtime snaps to ~10 pm (was 8:28 pm) and other recent nights' durations didn't shift unexpectedly.
**(3) Debugger timeout fixed (2026-07-21):** the per-night sleep-epoch dump 500'd with a gateway
"upstream error" because it re-decoded every stored sample + re-aggregated all history (`debugDate`
forced `fullHistory`). Added a `?dump=1` lightweight path (skip re-decode, keep the 35-day bound via a
`dumpOnly` flag), applied to BOTH the "Sleep epochs" button and the "SleepNet neural stager" dump
console (which had the same timeout + a bare `res.json()` that crashed on the plain-text error). Admin-tool only.
**(4) Evening-activity burst pulled into the night (v1.184.5):** the owner's 07-21 dump (via the fixed
debugger) showed it was NOT an orphan — a 6-epoch dense evening-activity burst at 17:19–17:44 (~4h before
real sleep) got spanned into the night by the density clamp's "first-to-last substantial run" logic →
window 17:19–06:44, ~13h, bedtime ~5:53 pm, and SleepNet staged the sparse evening in between as sleep.
Fixed in `lib/sleep/sensing-span.ts`: anchor the span on the LONGEST substantial run and fold in only
comparable-length neighbours (≥ 0.5× longest), so the tiny burst drops and the night starts at real onset
(~21:39); a genuinely split night stays whole (07-09 merge test green). Pinned to the 07-21 dump structure.
**⛔ v1.184.5 NOT yet confirmed on real data:** after deploy, redecode `2026-07-21` and check bedtime snaps
to ~10 pm (was 5:53 pm) and the duration is ~8–9h.

### [activity][devices] Battery-soak tester for the continuous-streaming step counter (v1.141.0, session 291) — shipped, NOT verified on-device
`lib/oura-ble/battery-soak.ts` + the "Battery soak" card on `/admin/oura-ble`. Everything it
does is BLE (feature toggle, accel stream, watchdog re-arm, reconnect handling, measurement
restore) — inert in the sandbox, so it shipped unverified by design; the owner's daytime soak
run is itself the verification. Specific risks to watch on the first run: (a) the guaranteed
restore — after Stop, tap Feature status and confirm DAYTIME_HR/SPO2/REAL_STEPS are back ON;
(b) WebView background throttling stalling the JS re-arm timers with the screen off (stalls
are logged in the exported JSON — that data feeds the Chunk 3 native decision); (c) the
reconnect path re-applying REAL_STEPS-off fast enough to keep the stream alive. An app kill
mid-soak self-heals (the native service re-enables all measurements on every connect).

### [activity][devices] Ring step count over-counts on full days; step data auto-refresh unverified on-device (session 290) — over-count open, fix shipped-but-unverified
Two parts. **(a) Over-count — OPEN.** The ring's own step estimate (col14 walk gate,
`lib/health/step-estimate.ts`) reads ~16,800 vs ~11,260 (Garmin)/~10,500 (Samsung) on a full day.
The gate was only ever calibrated on isolated short walks; across a full day, non-walk activity
(driving, gym, cooking, gestures) trips scattered low-col14 windows that each add 30 steps. The
prior "accurate" totals were Samsung Health Connect (now off), so the ring's full-day estimate has
never actually been validated. **Direction decided (session 291):** col14 is unfixable (can't
separate walking from rhythmic hand motion) and is being replaced by the gait-gated accel counter —
see `docs/superpowers/plans/2026-07-13-ring-accel-step-counter.md` (REVISION section) and backlog
item 1; col14 retires in that plan's Chunk 2. Additional additive risk to fold into the fix:
`body-metadata` adds `activity_logs`
(treadmill) steps on top of `body_metrics.steps`, and `mergeStepSources` adds non-overlapping live
windows on top of the gate estimate. **(b) Auto-refresh fix — SHIPPED (v1.138.1), NOT verified
on-device.** `sync-provider.tsx` now invalidates Oura caches when the native ring service's
autonomous (hourly/on-connect) drain lands new data, so steps update without a manual pull-to-sync.
Native/BLE — traced and reasoned in-sandbox (no ring), only truly confirmable on the S25 APK: leave
the app an hour with the ring connected and confirm today's steps update on their own.

### [nutrition] Nutrition quick-edit sheet (NUT-1/2/3) fixes — shipped, interactive verification blocked in the sandbox this session (v1.139.10, session 287)
`QuickEditLogSheet`'s stale-quantity fix (added `key={editingLog?.id}`), its synchronous
cache-invalidate/callback restructure, and `SavedMealsSheet`'s `logDate` threading all shipped
in `fix/nutrition-fixes-chunk1`. Live Playwright verification of these three (open the sheet by
clicking the pencil icon on a logged food row) repeatedly failed in this session's sandbox — the
click handler visibly fired (a `DialogContent` a11y warning appeared in the console) but the
sheet's content never rendered in the DOM, across a fresh dev-server restart and several click
strategies (locator click, raw mouse click, direct `onClick` invocation). A sibling fix in the
same PR (NUT-4, a plain API 400) verified live without issue on the same page in the same
session, so this looks like an environment-specific rendering/timing quirk rather than a defect
in the fix — but it was never actually confirmed working. **Gate: manually open the quick-edit
sheet on two different food logs in a row** (web `pnpm dev` is sufficient — this is pure React
state, not device-gated) and confirm the second log doesn't show the first log's stale quantity,
before trusting this fix in production.

### [nutrition][platform] Supplement/meal-type reminder cancellation (NUT-5) — shipped, NOT verified on-device (v1.139.11, session 287)
`computeSupplementReminderActions` now emits `cancel` for inactive/reminder-disabled supplements
instead of silently dropping them, and the manage-sheet handlers + meal-type deletion call
`cancelSupplementReminder`/`cancelMealReminder` directly. Verified only via unit tests — the
actual `LocalNotifications.cancel` OS call is native-only and no-ops in this sandbox
(`Capacitor.isNativePlatform()` is `false`). Gate: on the S25 APK, enable a supplement reminder
2 min out, then disable/delete it before it fires — the OS notification must not appear; delete
a meal type with reminders on and confirm its reminder doesn't fire either.

### [nutrition] Nutrition hygiene pass (NUT-10/NUT-11) — shipped, interactive verification blocked in the sandbox this session (v1.139.13, session 287)
R5's final chunk: removed the dead "save to my food library" toggle from the scan review screen
(`ReviewStep`), threaded a `region` hint into the AI-correction refine call, clamped quantity
inputs (`QuickEditLogSheet`/`AssignStep`/`SavedMealsSheet`) to a sane range, gated `AssignStep`'s
"today after logging" projection off for past-day logs, moved `meal-type-manager.tsx`'s
drag-reorder PATCH out of the `setMealTypes` state updater, and bumped touch-target padding
(`p-1.5`/`p-2.5` → `p-4`, ≥44px) plus an emoji→Lucide swap and a hex-literal→token swap across
`saved-meals-sheet.tsx`/`meal-type-manager.tsx`/`meal-card.tsx`/`manage-supplements-sheet.tsx`/
`water-log-sheet.tsx`. These are pure client-side changes, **not device-gated** — the gate is a
plain `pnpm dev` check, not an APK smoke run. But this session hit the same Sheet-rendering
sandbox limitation as the NUT-1/2/3 row above (click handlers fire — confirmed via a
`DialogContent` a11y console warning — but sheet content never renders in this session's headless
Playwright/Turbopack combination), so none of the Sheet-gated pieces above were interactively
confirmed; only the meal-types reorder PATCH endpoint and the scan route's `region` acceptance
were verified live via direct API calls. **Gate: manually exercise each surface via `pnpm dev`**
— open the scan review screen and confirm the save-to-library toggle is gone, type an
out-of-range quantity into the quick-edit/assign/saved-meal sheets and confirm it clamps, log
against a past day from the day-detail sheet and confirm the "today" projection is hidden,
reorder meal types twice in a row (React 19 StrictMode is on in dev) and confirm only one PATCH
fires per drag, and eyeball the touch-target sizes are visibly larger. The `p-4` touch-target
bump is code-only per CLAUDE.md's unconditional ≥44px rule — not yet confirmed against a real
48dp on-device measurement.

### [app-shell] Home/Nutrition/More bounded-shell fix (v1.138.13, session 294) — shipped, NOT verified on-device
Switched the three tab screens from `min-h-screen` (page body scrolled under the fixed tab bar) to
the bounded `h-screen` shell Health already uses, so the inner container scrolls and the nav can't
overlap bottom content. Verified only in the web sandbox (safe-area insets render as 0 there); the
on-device gate is that the last card and the rest-day streak banner clear the tab bar — including the
raised center Workout button, which pokes ~16px above the nav while `pb-nav-safe` gives ~12px
clearance (so the banner's bottom-center could tuck a few px under the button; the banner's own
padding keeps its text clear). Also note the class of bug: the static safe-area CI checks are
grep-based and can't detect a correctly-classed container that isn't the actual scroll context.
Run `docs/device-smoke-checklist.md` on the S25.

### [platform] Dependabot remediation (2026-07-27) — cleared from 24 alerts down to 1 accepted residual
Superseded the session-287 entry above (that one predates `gh`-less alert access being worked
around via `pnpm audit` + reading GitHub's own push-time advisory summary). Two PRs cleared the
standing threshold item:
- **#803** — bumped `next` (App Router Server Actions DoS/SSRF/cache-confusion advisories) and
  `sharp` (libvips CVEs), plus pnpm overrides for transitive advisories (`js-yaml`, `tar`,
  `postcss`, `brace-expansion`). Deliberately left `next-auth`/`@auth/core` out — auth/session
  changes need their own sign-off gate per CLAUDE.md, filed separately rather than riding in on a
  routine dependency bump. `pnpm audit` count: 24 (3 critical/13 high/8 moderate) → 11 (3
  critical/4 high/2 moderate); the remaining `pnpm audit` count is a different accounting than
  GitHub's own dependency-graph scan (see below), and does not by itself mean 11 GHSA alerts.
- **next-auth bump to `beta.32`** — separate PR fixing the auth-check-fail-open CVE, run through
  the auth-change confirmation gate rather than folded into #803.
- **Residual, accepted, documented (not silently dropped):** two `sharp` copies below 0.35.0
  remain out of our direct control — one bundled inside `next@15.5.22` itself (Next pins its own
  `sharp` for the Image Optimization API; overriding it risks breaking Next's image pipeline in
  ways untested upstream, so this waits for Next's own bump) and one inside `@capacitor/assets`'s
  dev-only CLI (never invoked at runtime, never exposed to external input). GitHub's own scan
  reports this residual as **1 high** alert as of this write-up (confirmed via the advisory link
  GitHub prints on every push to `main`, since this sandbox has no `gh` CLI/Dependabot-alerts API
  access). **Next implementer session:** no action needed below the ≥5 high/critical threshold —
  re-check when `next` bumps its bundled `sharp` past 0.35.0, or opportunistically if touching
  `@capacitor/assets`.

### [app-shell][platform] Home-day-timeline reads server-only (R3 SYNC-R3, session 287) — known limitation, documented exception
`components/home-day-timeline.tsx` renders today's Home timeline (workouts, food, mood,
activity, supplements — all individually local-first domains) from `/api/day-timeline` only. It
merges several already-local-first domains into one cross-domain, server-assembled aggregate,
so it doesn't cleanly fit either "trivially local-first" or the sanctioned cross-session-
aggregate exception list — a real client-side timeline assembler was judged out of scope for the
R3 batch that found it (see the plan's Task 2.2, `docs/superpowers/plans/2026-07-09-r3-offline-first-integrity.md`).
**Effect:** a same-day offline log (food/mood/activity/workout) won't appear on the Home
timeline until the next sync, even though the underlying domain writes are already
local-first-safe and not lost. Documented as a sanctioned exception in CLAUDE.md's Offline-First
read-site status list. Revisit if this becomes a live user-reported pain point.

### [app-shell] Perceived latency / More-tab cache-wipe (v1.133.0, session 277) — shipped, NOT verified on-device
Both structural-latency findings from the 2026-07-11 offline-feel review shipped in full: tab
taps no longer do a network RSC round-trip on revisit (`experimental.staleTimes`, empirically
verified zero-network against `pnpm dev`), app open serves the cached document stale-while-
revalidate instead of blocking network-first, and More's pull-to-sync no longer calls
`invalidateCache('')` (replaced with targeted domain-flag invalidation) or fires the frozen Oura
Cloud sync unconditionally (now BLE-freshness-gated). Review:
`docs/reviews/2026-07-11-offline-feel-performance-review.md`; plan
`docs/superpowers/plans/2026-07-11-instant-nav-and-app-open.md`. P4 (bundle the shell into the
APK) remains the unqueued Track A endgame bullet. **Superseded (tab-tap half):** the persistent
tab shell (v1.144.0, session 298) took the RSC round-trip off tab switching entirely — warm tab
taps no longer touch the router at all, so the `staleTimes` router-cache behaviour now only
matters for *cold* route entries (app open, deep links, back from `/profile`/`/admin`). **What's
NOT verified:** real cold-open timing and the splash screen (`@capacitor/splash-screen`,
compile-gated only — needs an owner APK rebuild to take effect). See
`docs/device-smoke-checklist.md` §8.

### [platform][app-shell] Offline shell availability (v1.130.0, session 271) — shipped, NOT verified on-device
Fixed in full: the service worker now precaches every `_next/static` asset + an unauthenticated
`/offline` fallback page per build, retains the current + previous cache generation across
deploys instead of wiping, and falls back to the exact cached document or `/offline` (never a raw
Chromium error) on a failed navigation fetch. Verified via a genuine offline repro in-sandbox
(dev server killed outright, not `context.setOffline`) — see session 271's journal entry for the
before/after. **What's NOT verified:** the plan's own stated merge gate is on-device Samsung
WebView airplane-mode behaviour (`docs/device-smoke-checklist.md` §2b) — whether the WebView
actually keeps the SW registered and persists Cache Storage across a real deploy + reopen, real
airplane-mode radio behaviour, and native `@capacitor/network` events. No physical device was
available in this sandbox. Also unverified: the true `next build && next start` production path
(blocked on local Postgres SSL — see session 271's journal for the mechanism); verification ran
on `next dev` instead, which shares the identical SW/cache code path.

### [devices] Oura BLE derived metrics (v1.120.0) — verified with synthetic frames only, not real ring data
The SpO₂ R/PI→% calibration, the 5-min binned HR series (`oura_heartrate` source `ble`), and the
signal-density wear time all shipped verified end-to-end against synthetic frames in the sandbox —
real-ring unknowns remain: whether/how often the Ring 5 emits `0x86 aohr` daytime HR (the daytime
half of the HR chart; sleep HR from IBI is proven), whether the 15-min-bin density yields a
wear-time figure comparable to Oura's (~23 h/day on the owner's old chart), and how close the
gen4-coefficient SpO₂ estimate sits to Oura's reported values. **Owner:** after deploy tap
**Redecode**, then compare the Health cards/charts against pre-re-key Oura app history (backlog
has the validation item). If aohr turns out absent, daytime HR needs the on-demand-measurement
path instead — a follow-up, not a fix to this.

### [devices] Oura direct-BLE: drained history could be silently lost (BLE-1) — FIXED in two layers; needs APK rebuild + Full re-sync
Found in the session-217 review and **confirmed live the same day** (ring delivered
`green_ibi_quality×1520, ibi_and_amplitude×360, spo2_r_pi×103, temp×520, hrv×2`; the DB kept
12 IBI events and zero of three metric types). Fixed in two layers: **v1.117.5** decoupled
the cursors — the persisted resume cursor only advances via `confirmStored(ds)` after the
server 2xx's (durable, but only while the tester screen is mounted to forward frames);
**v1.119.0** makes it set-and-forget — the native service POSTs each drained batch itself
(shared-CookieManager session cookie) and drives `confirmStored` internally, drains auto-run
on connect + hourly, and a failed batch skips all later confirms so the cursor never jumps a
hole. **Owner actions:** (1) rebuild + install the APK (`npx cap sync android && ./gradlew
assembleDebug`, or take the new Android CI job's `app-debug-apk` artifact); (2)
`/admin/oura-ble` → Advanced → **Full re-sync**, then the data-integrity runbook in
`docs/oura-ble-operations.md` §4 — frame counters and stored per-event counts must agree for
every biometric type. Do the re-sync promptly: events the ring's finite buffer has already
overwritten are unrecoverable. Kotlin is compile-gated by the new Android CI job but NOT yet
verified on-device (incl. the native cookie-auth POST path).

### [devices][app-shell] Health screens frozen since the ring re-key (BLE-3/4, found session 217) — mapping SHIPPED v1.118.0; cutover SHIPPED v1.128.1; overnight verification remains
The ring left the Oura ecosystem on 2026-07-07 (Option A re-key), so the Oura Cloud has no
data after that date. **v1.118.0 closed the mapping gap:** `aggregateOuraRawSamples` now
rolls raw BLE samples into `sleep_sessions` (bedtime window, stages, efficiency, sleep
HR/HRV) and `body_metrics` (HRV/RHR/SpO₂ per wake day) automatically after each biometric
ingest — verified live against local Postgres with captured frames. **The Cloud-sync cutover
shipped v1.128.1 (session 268):** app-open/resume and Health-tab auto-syncs skip the frozen
`/api/oura/sync` when BLE data is <48 h fresh (`GET /api/oura-ble/freshness`), and the More-page
ring status reads the BLE timestamp instead of the permanently-empty Cloud sync. **Still open:**
verify against a real overnight drain on-device, `source` provenance and the per-epoch clock
anchor (both remain on the data-mapping item — backlog item 5), and the tester decoded-field
inspector. The 0–100 readiness/sleep/activity scores return with the Phase-5 own-scores work.

### [sleep][devices] Sleep hypnogram/stages over BLE — believed impossible, now corrected; rollup wired but UNCONFIRMED on-device (session 221)
Earlier journal rows (v1.119.4/.5) state the Ring 5 emits "no sleep-phase (0x4b/0x4e/0x5a)
events" and that stages are "null by design". **That was premature** — checked against
`open_oura` (the sanctioned source): the ring **does** emit its own hypnogram over BLE
(`sleep_phase_*` tags carry DEEP/LIGHT/REM/AWAKE; observed on a real Ring 5), and there's no
sleep feature to enable. Same pattern as the REAL_STEPS "can't enable → actually can"
correction. **Shipped this session:** the rollup now assembles `sleep_phase_5_min` + stage
hours from these events (single-tag-longest to avoid triple-counting; dormant until events
arrive), and the Health hypnogram was redesigned into a banded ribbon. **Still open (on-device,
backlog):** we've captured **zero** phase events so far, so a clean *worn-overnight →
next-morning* drain is needed (and a check that the sync cursor isn't skipping the staging span)
before the 30 s-epoch / single-tag / timestamp assumptions can be validated against a real
captured vector. Full analysis: [`docs/oura-ble-sleep-staging-findings.md`](docs/oura-ble-sleep-staging-findings.md).

### [devices] Oura direct-BLE Phase 2 plugin (v1.116.4, session 216) — RESOLVED on device by v1.117.x; connect-failure history retained below
**Resolution (2026-07-07, v1.117.1–.4):** clean scan → bond → MTU 247 → `auth: SUCCESS` →
READY in ~4.7 s, feature-enable acked, full multi-thousand-event history drain, real
biometrics decoded and stored (HR 82 bpm / temp 37.00 °C) — the go/no-go this row tracked
has passed. The paragraphs below are retained as the diagnostic record of the
connect-reliability rounds (status 133/147/135, Samsung `autoConnect` misbehaviour), which
remain the reference if a new failure signature appears.
The native Kotlin `OuraBle` plugin + `OuraRingService` foreground service + `/admin/oura-ble`
debug screen shipped **compile-gated only in the sandbox**: there is no Android SDK here, so the
gradle build + JUnit tests (`./gradlew :app:testDebugUnitTest`) and **every** on-device BLE
behaviour are unrun. **v1.116.1 fixed a real on-device bug found immediately after merge:** the
debug screen hung forever on "Checking native plugin…" — `getOuraBle()` (`lib/oura-ble/plugin.ts`)
returned Capacitor's `registerPlugin()` Proxy directly from an `async` function; since that Proxy's
`get` trap answers *any* property access (including `then`) with a callable, JS's promise-resolution
algorithm treated it as a thenable and called `plugin.then(...)` as a native method, which the bridge
rejected as unimplemented (`"OuraBle.then() is not implemented on android"`) — an unhandled
rejection that never let the outer promise settle. Fixed by wrapping the plugin in a plain
`{ plugin }` object, matching the pattern the codebase's only other `registerPlugin()` caller
(`gps-tracking.ts`) already used. Diagnosed via real `chrome://inspect` remote-debug console output
against the production APK — this is genuine on-device signal, not sandbox-inferred. Owner
verification still required for everything past this point: (1) confirm the fix loads (JS-only fix,
ships via Railway — no APK rebuild needed, just reopen the app); (2) run the plan's on-device spike
protocol (`docs/superpowers/plans/2026-07-07-oura-ble-phase-2-onphone-spike.md` §"On-device spike
protocol") — first connect + auth (record time-to-connect and the RE8 bonding behaviour), live
accel/battery/SyncTime/Live-HR (the RE10 0-beats retest), history drain, and a 2–3-day persistence
soak (connects/drops, Samsung battery-optimisation kills, wedge-guard). The **reconnection-UX
go/no-go** from that soak gates Phases 3–5 (decoder port → `oura_raw_samples` offline domain → our
own `lib/health/*`). **v1.116.2 addendum:** the owner's first real connect attempt showed the
scan/match logic working (found `Oura Ring 5`, correct mfr-id match, valid RSSI) but hit two
distinct generic Android GATT connect failures — status 133 (from a duplicate-start race, now
guarded) and status 147 (`GATT_CONN_FAIL_ESTABLISH`, mitigated with a connect-settle delay). The
owner then tried a Bluetooth-stack reset (toggle off/on) hypothesizing a wedged radio, but saw the
identical failure on the *old*, unpatched build — consistent with it being the reproducible code
race, not a stack-level wedge. **v1.116.3 addendum:** after rebuilding with the v1.116.2 fixes, the
race was confirmed genuinely fixed (a single clean scan→connect sequence), but a clean attempt
still hit status 133 ~10s after connecting — a different, well-known flaky spot in Android's BLE
stack unrelated to any app race. Added a bounded same-device connect retry (up to 2 extra attempts)
before falling back to a full re-scan, bumped the settle delay to 500ms, and fixed a genuine
off-by-one in the retry backoff schedule (`scheduleRetry()` was indexing `BACKOFF_MS` after
`consecutiveFailures` was already incremented, so the first retry fired at 10s instead of 5s —
confirmed against the on-device log). **v1.116.4 addendum:** tried switching `connectGatt()` to
`autoConnect=true` (handing connection establishment to Android's background BLE mechanism, the
standard fix for this failure class) with a bounded 15s timeout given the ring's rotating address.
On-device this was **worse, not better**: an instant, deterministic status-135 failure on every
attempt, including after a full Bluetooth toggle and a full phone reboot (ruling out accumulated
stack state) — since `autoConnect=true` is supposed to fail slowly/silently, this pattern points to
Samsung's BLE stack not honouring `autoConnect` the way stock Android does. Reverted back to a
direct connect (`autoConnect=false`) with the same-device retry restored, keeping the connect
timeout as a generic safety net. **These native fixes require an APK rebuild to take effect**
(`npx cap sync android && ./gradlew assembleDebug`) — no successful `auth: SUCCESS` has been
observed yet, so the actual ring auth handshake on-device remains unconfirmed. App-level races,
phone Bluetooth-stack state, Windows PC interference, and autoConnect-vs-direct-connect have all
now been ruled out or tried without success; recommended the owner capture a Bluetooth HCI snoop
log (Developer Options → "Enable Bluetooth HCI snoop log") on the next attempt for real
protocol-level diagnosis rather than continued guessing.

### [cross] Full app overview review (2026-07-06, session 213) — ~90 verified findings pending planning
A nine-dimension audit (caching, offline-sync, performance, UI, security, dates/formulas,
workouts, nutrition, APK/BLE readiness) is written up in
**`docs/reviews/2026-07-06-full-app-overview-review.md`** — every finding verified with
file:line. The findings are grouped into plan batches (R1–R8 + APK/BLE Tracks A/B) and
registered in `docs/implementation-backlog.md` § "Not yet queued" for planning sessions to
pick up. Highest-impact (see the review's executive summary): the
unverified-rowcount/mass-assignment ownership bug class (SEC-1..3/6), workout deletes never
reaching the device local store (SYNC-C1 — deleted sessions resurrect), the
`progress-summary` cachedFetch/cachedFetchToday variant clash (CACHE-F1), the quick-edit
food sheet stale-quantity corruption (NUT-1), `advance()`'s stale closure losing
single-exercise completions (WK-1), and offline food logging of new items failing entirely
(SYNC-O2). Also verified **fixed/clean** during the review: readiness-score TTLs, legacy
`ta_*` seeds, the training-load inline ACWR copy (gone), auth coverage on all 149 routes,
AI-route schema/rate-limit discipline, local migration/reconcile registration (all 26
tables), and poison-pill outbox handling.

### [platform] Dual-path read-fallback divergences (2026-07-06 audit) — deferred, fix-on-touch
Found while planning the APK-canonical-target work
(`docs/superpowers/plans/2026-07-06-apk-canonical-target-implementation.md`); the write-path
drift and two quick read fixes are queued (backlog item 2), these three heavier read-side
duplications are deliberately deferred to fix-on-touch:
- **Strength trend computed twice:** `app/health/health-content.tsx:413-444` re-implements
  per-exercise 1RM/gain% client-side for the device seed while web delegates to
  `/api/strength-trend` — two implementations of the same trend math that can disagree during
  the seed window. Converge on touch (shared lib fn or seed from the same route shape).
- **Exercise history device path stubs `isDeload:false`** and re-derives `rpeDelta`
  (`components/exercise-history-sheet.tsx:31-50`) — server overwrite makes the divergence
  transient, but the deload flag is always wrong until the fetch lands.
- **Nutrition `calsBurnedToday` has two sources:** device sums local activity logs
  (`app/nutrition/nutrition-content.tsx:192`), web reads `/api/body-metadata` — one number,
  two derivations.

### [workouts][heart-rate] Workout HR/UI polish (v1.143.1, session 296) — shipped, NOT verified on-device
- Follow-up to the Live HR rework (below), owner-reported on-device: (1) the workout-phase action bars sat
  flush against the 3-button nav bar. `pb-safe-action-lg` used `max(env, 4rem)`, which let the
  edge-to-edge inset eat the intended clearance (~16px above nav); changed to
  `max(calc(env + 2rem), 4rem)` so the inset is *added* to the gap (web/no-inset look unchanged at
  4rem). **Consistency sweep:** warmup, pre-workout, exercise-summary and done screens were on plain
  `pb-safe-action` (0.75rem floor → button flush against the nav bar on-device) and now all use
  `pb-safe-action-lg` — every full-screen workout action bar clears the nav bar identically. (Bottom
  sheets keep `SheetContent`'s baked inset per the safe-area rules.) (2) The in-workout Live HR card
  now renders in a `compact` variant (44px trace vs 72px) so it no longer squishes the fixed-height
  rest-timer zone; the summary card keeps the full-height chart + set lines. (3) The done-screen HR
  Recovery chart (`hr-recovery-chart.tsx`) now passes its 30s buckets through `rollingMedian` (window
  5) + higher line tension, so the spiky trace reads as a clean recovery curve (display-only — the
  per-set bpm/min recovery numbers come from `hr-analysis`, unchanged).
- **NOT verified on-device:** the safe-area clearance in particular is invisible in the web sandbox
  (insets render as 0), so the nav-bar gap must be checked on the S25 APK. `tsc`/lint/tests green,
  full `pnpm build` clean.

### [heart-rate][workouts] Live HR — rest-only in-workout + full-exercise summary replay (v1.143.1, session 296) — shipped, NOT verified on-device
- Owner-reported (on-device) rework of the session-295 full-exercise chart: (1) during a workout the
  Live HR card now shows **only in the rest phase** (`sinceMs={restStartMs}`) — the set-phase PPG
  reads poorly under grip/motion, so the mid-set trace dropped then ramped in rest and read as
  inaccurate; and only genuinely-live readings feed it (held/stale values no longer fabricate a moving
  line). (2) The **exercise-summary card** now replays the *whole* exercise's HR with dotted per-set
  markers — previously it mounted a fresh chart with no carried-over samples and showed a flat line.
- Mechanism: a shared, non-persisted per-exercise HR trace singleton
  (`lib/live-hr/exercise-trace.ts`) recorded once by the workout orchestrator's 1 Hz tick across
  set+rest; `LiveHrChart` is now a pure reader of it (active card filters to the current rest window,
  summary shows the full trace + set lines). Set boundaries are captured at log time because
  `commitExerciseSummary` clears the store's set-timing arrays the instant the summary opens. Trace
  logic unit-tested (`lib/live-hr/__tests__/exercise-trace.test.ts`, 7 tests).
- **NOT verified on-device:** the live trace, rest-only gating, summary replay, and set-boundary lines
  all require the real Oura BLE stream (`getLiveHrManager().getCurrent()` is null in the web sandbox,
  so both cards only show their empty state). Web smoke: `tsc`/lint/tests green, full `pnpm build`
  clean, `/workout` route compiles and serves. Owner to verify on the S25.

### [app-shell] UB1 deep-link cold-launch redirect (v1.124.9, session 256) — NOT verified on device · needs: android
- The admin-bounce latency fix (Chunk 2) is verified end-to-end on the local dev DB. Chunk 1 —
  the actual reported bug (a deep-link cold-launch with an existing WebView session yanking the
  user back to home mid-navigation) — is APK-only: `Capacitor.isNativePlatform()` is false in the
  web sandbox, so `App.getLaunchUrl()` never returns a deep-link URL and the fixed code path never
  runs there.
- **Needs on-device confirmation:** sign in fresh (first-ever exchange) → lands on home as before.
  Sign in again so the process cold-launches from the deep link with a session already in the
  WebView jar; as soon as home paints, navigate to `/admin`; wait out the exchange → **stay on
  `/admin`** (this is the UB1 repro). Warm re-auth from `/sign-in` still lands on home correctly.

### [platform] R3 offline-first integrity, Chunk 1 local-store surfaces (v1.124.7, session 254) — NOT verified on device · needs: android
- Server-side soft-delete (SYNC-C1) and its ~35 read-site guards are verified end-to-end on the
  local dev DB. Three sub-tasks are APK-only and unverified: the local-store mirror on history
  edit/delete (SYNC-R4, `deleteExerciseLogLocally`/`updateExerciseLogLocally`), Home's body-metric
  tile local-first seed (SYNC-R1, `session-select-content.tsx`), and the `food_items` outbox
  domain's push ordering (SYNC-O2) — `getLocalStore` returns `null` in the web sandbox, so none of
  these can be exercised without the APK.
- **Needs on-device confirmation:** delete a synced workout on-device, force a pull on a second
  device/after clearing app data → it doesn't resurrect; edit a past set offline → the Stats/Health
  list reflects it immediately and survives a restart before sync; go offline, scan/add a
  brand-new food → it logs, appears in the day list, survives restart, and dedups correctly once
  reconnected (no duplicate `food_items` row).

### [workouts] Workout leave-confirmation on Android hardware back button (v1.82.0, session 182) — NOT verified on device · needs: android
- The hardware/gesture back button now checks `isWorkoutActive()` and shows the shared
  `LeaveWorkoutDialog` (previously it bypassed every "leave workout?" guard). Verified via
  Playwright in the web sandbox for the pre-workout back chevron and bottom-nav tabs.
- **Needs on-device confirmation** that a real hardware back-press / edge-swipe mid-workout
  shows the dialog, and "Leave" still triggers `App.minimizeApp()`/`window.history.back()`.

### [cardio] GPS background-location walk detection (v1.80.1, session 181) — NOT verified on device · needs: hardware
- Root cause: `@capacitor-community/background-geolocation`'s `addWatcher` only requests
  foreground location, never `ACCESS_BACKGROUND_LOCATION`, so a backgrounded GPS start is
  silently refused; the error was discarded with no logging/UI. Fixed with a native
  `window.AndroidLocation` bridge, a Profile/More status card, and errors routed into
  `useAutoDetectionStore.detectionError`.
- **Needs on-device confirmation** that the card renders, "Open Settings" opens the right
  screen, the card flips to "Enabled" after granting "Allow all the time", and a real
  backgrounded walk is detected end-to-end.
- **Open question:** Android 12+ may block starting a *new* foreground service from the
  background even with the permission granted — a persistent lightweight foreground service
  may be needed as a follow-up.

**Update 2026-07-11 (session 272), owner-reported:** the open question above is now confirmed
live impact, not theoretical — auto walk/run detection has stopped presenting walks, and the
GPS watcher appears to be the source of a reported phone battery drain. Root cause traced to the
watcher's off-switches (probe timeout, stall) running in WebView timers that Android
throttles/suspends with the screen off while the native GPS foreground service keeps running
underneath — reachable precisely because this section's original fix got "Allow all the time"
granted. Both detected-walk sources are also dead (Oura-Cloud froze at the 2026-07-07 re-key;
background sessions rarely finalize). Fix planned:
`docs/superpowers/plans/2026-07-11-ring-triggered-walk-detection-gps-battery.md` (**backlog
item 1**) — a timer-independent GPS watchdog, then the ring's walk-specific gate as the GPS
trigger (battery win), then a deferred native pipeline. Until it ships: a persistent "Tracking
your activity" notification while not walking indicates a wedged watcher; force-killing the app
clears it.

### [platform] Offline-sync protocol hardening (Batch A, v1.76.0, session 177) — NOT verified on device · needs: android
- Shipped: mutation-id-based outbox confirms, dead-letter quarantine after 5 attempts +
  `sync-health-card.tsx` retry/discard UI, `applyDelta` pull-clobber guards on every domain,
  server-authoritative `personal_records`, workout-log replay idempotency, `applyDelta` in a
  real transaction, bulk `saveProgram` inserts, and a paginated sync-pull cursor.
- **Not exercisable in the sandbox** (`getLocalStore` returns null there) — verified via unit
  tests + one DB-level replay-idempotency check. **Needs an on-device pass:** local SQLite v13
  migration applies cleanly, a failed mutation quarantines after 5 attempts with working
  Retry/Discard, and a pull no longer reverts a pending offline edit.

### [nutrition] Supplement reminders (v1.50.0) — NOT verified on device · needs: android
- `reconcileSupplementReminders()` on app open/resume; `cancelSupplementReminder()` on toggle-off.
- **Risk — ID collision:** IDs 8500–8699 (200-ID range) hash from `supplementId`; two supplements
  could collide (unlikely with <10 supplements). **Risk — timezone:** `reminderTime` (`"HH:MM"`,
  no tz) compared against local device time; a timezone change fires at the wrong time until the
  next reconcile.

### [workouts] Injury workout warning (v1.50.0) — NOT verified on device · needs: browser
- Amber banner in `active-workout-screen.tsx` when an exercise's muscles overlap an active injury.
- **Risk:** custom exercises with no muscle assignments never trigger it; matching is string
  equality between `injury.muscleName` and `exercise_library.muscle_groups` — casing/naming drift
  (e.g. "Quads" vs "Quadriceps") misses. Verify `MUSCLE_OPTIONS`/`MUSCLE_TO_SLUG`/`muscle_groups`
  all agree.

### [workouts][platform] Workout reminder notifications (v1.45.0) — NOT verified on device · needs: android
- Channel `workout-reminders`, ID 8000. Only fires for weekly/rotation schedule modes (disabled
  for auto-schedule). Cancelled by `cancelWorkoutReminder()` on workout start.

### [workouts] Per-session phase tracking (v1.42.x) — data-quality risk
- Phase counts recompute from `workout_sessions.session_name` via `GROUP BY session_name`.
  Inconsistent historical name casing (`"push"` vs `"Push"`) would split counts and produce wrong
  phase resets. No normalisation migration was written — watch if users report unexpected resets.

### [devices] Oura Ring integration — mostly shipped, expansion pending
- ✅ SpO2 re-auth done (scope fixed `spo2Daily`→`spo2`; user reconnected, `spo2_pct` populates).
- **Data expansion available but unbuilt:** many synced `oura_daily` fields aren't displayed yet
  (sedentary/non-wear time, temperature deviation, stress/recovery, resilience, vascular age,
  VO2 max, ring battery). Full reference in `docs/oura-ring-data-reference.md`.

### [workouts][platform] AI periodization (v1.54.0) — ops dependency
- Tier 5 refinements shipped (accumulation ceiling, deload auto-advance, low-confidence
  explain/confirm); exercise-swap UI dropped. Muscle-group weekly volume targets now auto-seed
  (v1.72.0) so the engine no longer runs unconstrained — a manual *editing* UI is still a
  nice-to-have.
- **v1.104.6:** volume targets now use real per-muscle MEV/MAV/MRV landmarks (not a large/small
  binary), and the time-budget trimmer is volume-aware (cuts the muscle furthest over its MAV
  first, can cross role tiers for a severe outlier). Also fixed a live-reproduced bug where
  Gemini's occasional 0-1 `pct` fraction 502'd the whole prescription.
- **Known gap:** the model can drop a `session_exercise_id` from its response entirely (observed
  live, not fixed) — that exercise silently gets no prescription for the session rather than an
  explicit sets=0/skip signal.
- **Ops note:** requires `GOOGLE_GENERATIVE_AI_API_KEY` in Railway env vars — without it the
  prescribe route 502s (emergency deload still works, it skips AI).

### [cross] Recently resolved (full detail in the session journal)
- ✅ **AI workout prescription "couldn't generate" every session** — client now fires `POST …/prescribe` directly + `?poll=1` made `no-store` (v1.173.2/.4); device-confirmed 2026-07-19.
- ✅ **AI chat "Invalid input" (localDate slash vs dash)** — `chatSchema` regex relaxed to accept both separators (v1.173.2); permanent CLAUDE.md rule added.
- ✅ **Culling Lever 1b (historical decoded backfill)** — device-verified end-to-end on the S25 APK against real prod data (2026-07-15); `body_hex` untouched.
- ✅ **Live HR — DHR on-demand burst** — true-live in-workout HR verified working on-device (v1.122.11, owner-confirmed 2026-07-09).
- ✅ **Home week-strip rest-day hydration mismatch** (found 2026-07-06, session 208) — root-caused
  as `session-select-content.tsx`'s week-strip building "today" from the device's local timezone
  (`Intl.DateTimeFormat().resolvedOptions().timeZone`) while the server buckets workout/rest days
  in AEST; the two disagreed whenever they diverged, producing exactly the server-vs-client
  "today"/rest-day mismatch this issue described. Fixed as part of R8 (Dates & Formulas
  Consolidation) by rebuilding the week strip on `todayInTz()`/`startOfWeekInTz()`/
  `todayDayOfWeek()`/`shiftDateStr()` — all server-tz — instead of the device tz.
- ✅ **Local SQLite never opened on-device** — v4's `PRAGMA journal_mode=WAL` inside the upgrade
  transaction; WAL moved post-open (#27) + missing v8 columns (#28). Confirmed on S25 (v1.68.0).
- ✅ **Sleep duration discrepancy** — Oura row authoritative for duration in `mergeByDate` (v1.62.0/.1).
- ✅ **Activity walk detection** — distance/speed/duration filters on Oura + timeline routes (v1.62.0).
- ✅ **AI "Baseline needed" stuck** — "Use prior data →" advances from existing PRs (v1.62.0).
- ✅ **Feedback screenshot size** — route rejects `screenshotData` > 500 KB (v1.56.0).

---

## 📋 What's Left To Do

> **Ready-to-build work is queued in [`docs/implementation-backlog.md`](docs/implementation-backlog.md);
> open uplift ideas are in [`docs/planned_upgrades.md`](docs/planned_upgrades.md).** The list below
> is the residual legacy backlog — mostly ✅/🚫 — plus the device-only verifications that can't be
> exercised in the sandbox.

**Next free Postgres migration number: 167.** (**Corrected 2026-08-02** — 166 was claimed and used
the same day by `166_sleep_sessions_oura_id_user_scope.sql` (#1004). Previously said 166; before
that, "next: 127"
and was 38 migrations stale; on disk through 165 now. Known same-number collisions: 081, 087, 146,
161 — apply order between each pair is ambiguous but independent, per CLAUDE.md's migration-number
rule; do not rename an applied migration. Local SQLite is at **v20**. Claim any new number against
both the directory AND open plan docs before writing a migration — this line drifts fast because
multiple parallel sessions claim numbers; treat it as a hint, verify with `ls lib/data/postgres/migrations/`
before trusting it.)

### 🔴 Security
- ✅ **AI SDK CVE bump done.** `@ai-sdk/google ^3.0.86` (+ `@ai-sdk/openai`, `@ai-sdk/react`,
  `@ai-sdk/provider-utils@4.0.33`), `package.json`/`pnpm-lock.yaml` in sync. No open security items.

### ✅ Local-first reads — operational on-device
The headline goal (every screen paints from local data instantly, then revalidates) works since
session 166's SQLite-open fix. Remaining server-only reads are cross-session aggregates
(`weekly-stats`, `weekly-muscle-sets`, `weights-summary`, `muscle-recovery`), server-computed by
design — they stay on `cachedFetch`.

### 🟡 Derived-score read paths (v1.158.1) — known limitation + prod check
The Readiness/Sleep sparklines (`/api/health/trends`), the Body Battery morning anchor
(`/api/body-battery`), and the Sleep contributor bars (`/api/readiness-score`) now coalesce our own
`oura_daily_derived` scores over the frozen post-re-key Cloud columns (data-efficiency S1/S2/S6, item 3a).
**No backfill** — `oura_daily_derived` only has rows from each persist's start date, so sparklines fill
in from ~2026-07-15 (readiness) / this release (sleep) **forward**; derived `activity_score` stays
Cloud-only-then-null until P-D writes it (the coalesce is already in place for it). **Prod check after
deploy** (the local seed is Cloud-shaped + always fresh, so the frozen-vs-live split can't repro in the
sandbox): open Health → Sleep/Readiness, confirm today-forward sparkline points appear and the
contributor bars render on a BLE night; confirm Body Battery no longer opens at a flat 50.

### 🔵 Device-only (cannot test in the sandbox — requires Samsung Galaxy S25 Ultra)
- [ ] **GPS background-location walk detection** (v1.80.1, APK rebuild): confirm the status card
  renders, "Open Settings" works, the card flips to "Enabled" after "Allow all the time", and a
  real backgrounded walk is detected end-to-end (may be blocked by Android 12+ foreground-service
  restriction — see Known Issues). **Update 2026-07-11:** end-to-end background
  detection is known-broken and owner-reported — the fix is planned as backlog item 1
  (`2026-07-11-ring-triggered-walk-detection-gps-battery.md`); its on-device soak supersedes
  this checklist line.
- [ ] **Android App Links for mobile auth** (APK rebuild): replace the custom
  `trainingai://auth-complete` scheme with a verified `https://…/auth-complete` App Link
  (`android:autoVerify="true"` + `/.well-known/assetlinks.json` with the release-cert SHA-256).
  Defence-in-depth only — the shipped PKCE binding already makes an intercepted token unredeemable.
- [ ] **Offline-sync on-device pass** (Batch A + local-first): v13 migration applies on a fresh
  APK launch; body-weight/supplement/injury writes round-trip through the outbox offline;
  `pullDelta` populates on first open; rest-timer reconciles after suspend mid-rest; a failed
  mutation quarantines after 5 attempts with working Retry/Discard.
- [ ] **Notification verification:** supplement reminder fires at `reminderTime` and cancels on
  toggle-off; workout reminder fires on training days only and cancels on workout start; injury
  amber banner fires when an exercise overlaps an active injury.
- [ ] **Guided interval walk — on-device (v1.158.0):** the config→active→summary flow and the
  server page + save path are dev-verified (authed page 200; a `walk` `activity_log` persisted via
  the web fallback), but the client interaction and the two device-only behaviours are unverified in
  the sandbox. Confirm on the S25: (a) live HR + the fast/slow zone verdict update during the walk
  (sandbox shows "—", no ring); (b) the background interval cues (`lib/walk/walk-cues.ts`) fire with
  sound/vibration at each transition while backgrounded / screen-off (local-notification exact timing
  under Doze can drift a few seconds — acceptable for cues); (c) the walk lands in activity history
  through the local-store path (`getLocalStore` is null on web). Open via Log Activity → Interval walk.
- [ ] **Set-log planned snapshot — native local-store leg** (2026-07-17, migration 126): the
  server + web write paths are dev-DB-verified, but the on-device sync chain (raw SQLite insert,
  `mapSetLog`, `applyDelta`, `RECONCILE_COLUMNS`) runs only on the APK (`getLocalStore` is null in
  the sandbox). Confirm: log a set offline on the S25 → kill/reopen → the set still renders and,
  after reconnecting, the row round-trips with `planned_pct`/`planned_rest_sec` intact through
  `pushMutations` and back via `getSyncDelta`/`applyDelta`; plus a cross-device pull of a web-logged
  set carrying the snapshot. Columns are write-and-store (no UI), so nothing is user-visible.
- [ ] **Run/activity leave-confirmation guard (v1.244.0):** confirm hardware back and bottom-nav
  tab taps mid-run/mid-activity on the S25 show "Leave activity?" and discard on confirm, keep
  recording on cancel — mirrors the already-verified guided-walk/workout equivalents, but this is a
  new call site (`/activity`) never exercised on a real back gesture before.
- 🔄 **Health Connect is no longer dormant** (corrected 2026-08-02). This line used to read "HC is
  dormant… verification items are parked". Q-43 (v1.250.0) made HC a **first-class tier-2 source**:
  it is how every non-Oura user gets sleep, and `saveSleepSession` now stamps provenance through the
  ranked merge. The Tasker ingest route is still the unexercised part. **The HC device check is
  owed** — see the owner checklist in
  [`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](docs/handoff-2026-08-02-platform-batch-queue-drain.md);
  nothing in the HC path has ever run against a real provider.

### 🟢 Nice-to-have
- **Body Battery model tuning** (v1.66.0): the charge/drain constants are heuristic. A
  `body_battery_daily` snapshot table (migration 100) records daily end value / min-max /
  charged-drained / RHR-HRmax inputs / observed peak HR / sample count / `model_version`. After
  ~1–2 weeks of data, correlate end-of-day battery vs next-day readiness/HRV, swap `220−age` for
  observed max HR, retune constants, bump `MODEL_VERSION`. Methodology: `docs/body-battery-tuning.md`.
- **Manual per-muscle weekly-volume-target editing UI** in program config (the engine already
  auto-seeds targets — Batch 1 in `planned_upgrades.md`).

---

## 🗂️ Document Map

`projectOverview.md` is the lean index (current status + Known Issues & Risks + What's Left). The
append-only session journal and the batched archives live under `docs/`:

| File | Contents |
|------|----------|
| `docs/overview/known-issues-resolved.md` | **Completed Known Issues** — entries archived out of this file once nothing was still owed (53 moved 2026-08-13). Grep it before concluding something has never been looked at. Striking an issue means *moving* it here — see `CLAUDE.md` Session Wrap-Up step 2 |
| `docs/implementation-backlog.md` | **Upcoming (ready)** — priority-ordered queue; implementers take the top item |
| `docs/planned_upgrades.md` | **Upcoming (ideas)** — open uplift findings, batched by data/structure |
| `docs/overview/uplift-archive.md` | **Completed** — shipped uplift batches split out of `planned_upgrades.md` |
| `docs/overview/entries/` | **Recent journal (uncompacted)** — one file per PR/session (`YYYY-MM-DD-<slug>.md`); read these + the newest history file for "what happened lately". Folded into the batched history by the compaction sweep — see the README there. **Corrected 2026-07-30:** this line said "near-empty (compacted 2026-07-20)" but the directory holds ~179 files from 07-20→07-29 — the compaction sweep is overdue; a future session should run it. |
| [`docs/agents/README.md`](docs/agents/README.md) | **The standing agents** — the four roles, their authority, the two-lane file-ownership contract, the Q-number bands, and the handoff protocol. Cold-start prompts in `docs/agents/prompts/`, live batons in `docs/agents/state/` |
| `docs/overview/status-archive.md` | The 157 dated status notes that had accumulated in this file's Current Status section, archived 2026-08-17. Superseded by the journal; do not add to it |
| [`docs/overview/history-2026-08-18.md`](docs/overview/history-2026-08-18.md) … `history-2026-07-17.md` | **Completed journal (batched)** — ten files covering 2026-07-17 → 2026-08-18, folded from 498 + 41 loose entries by the 2026-08-17 and 2026-08-18 compaction sweeps, oldest-first within each. Every entry keeps a `<!-- from: … -->` marker naming the PR file it came from. `history-2026-08-18.md` was started because `history-2026-08-15.md` had passed the ~250 KB rule at 300 KB |
| `docs/overview/history-2026-07-20.md` | **Completed journal (batched)** — the 2026-07-17 → 2026-07-20 loose entries, compacted 2026-07-20, newest at top |
| `docs/overview/history-2026-07-16.md` | **Completed journal (batched)** — sessions 2026-07-16 → 2026-07-17, newest at top |
| `docs/overview/history-current.md` | Sessions ~287 → 2026-07-16 (closed batch) |
| `docs/overview/history-newer.md` | Sessions ~217–286 (closed batch) |
| `docs/overview/history-newest.md` | Sessions ~209–216 (closed batch) |
| `docs/overview/history-latest.md` | Sessions ~177–209 (closed batch) |
| `docs/overview/history-recent.md` | Sessions ~105–176 + roadmap / version-history tables |
| `docs/overview/history-past.md` | Sessions ~51–104 |
| `docs/overview/history-early.md` | Sessions ~1–50 + legacy architecture appendix |
| `docs/superpowers/plans/archive/` | All completed implementation plans (shipped) — reference |
| `docs/superpowers/specs/archive/` | All completed design specs (shipped) — reference |
| `docs/reviews/` | Full review write-ups that seed backlog items (source material) |
| [`docs/domains/`](docs/domains/README.md) | **Per-pillar entry point — read this first when working in one area.** Eleven indexes (`sleep`, `readiness`, `heart-rate`, `cardio`, `activity`, `workouts`, `nutrition`, `body`, `devices`, `app-shell`, `platform`), each gathering that pillar's code locations, reference docs, open issues, handoffs and gotchas. Its `README.md` holds the boundary rules and the `[domain]` tag convention used by the Known-Issues headings above and by handoff filenames |

**Reference docs:** `docs/module-map.md` (**what shared module/infrastructure already
exists and where** — read before building any new feature or helper; documents the
no-cron-layer scheduling patterns), `docs/oura-ring-data-reference.md` (Oura v2 field
reference), `docs/device-smoke-checklist.md` (on-device verification steps),
`docs/owner-action-required.md` (**everything left that the sandbox can't do** — owner-run
device/APK/data/decision items, grouped by action type; read when asking "what's left"),
`docs/body-battery-tuning.md` (Body Battery model methodology),
`docs/sleep-system.md` (**sleep reference** — staging pipeline, scoring, what's
reliable vs approximate, tuning discipline, open levers; read before any sleep work),
`docs/public-launch-checklist.md` (**things deliberately deferred because the app is
personal-use-only** — read when asked "what needs fixing before going public").

**Runbooks:** `docs/runbooks/db-backup-restore.md` (manual `pg_dump`/`pg_restore`
against Railway, disaster-recovery walkthrough), `docs/runbooks/account-recovery.md`
(password reset via `scripts/reset-password.js` when locked out of both
credentials and Google OAuth).

**When adding a session note:** write a **new file** in `docs/overview/entries/` named
`YYYY-MM-DD-<branch-slug>.md` — do **not** prepend to a shared `history-*.md` (that shared-line edit
was the most frequent multi-PR merge conflict; per-entry files take it to zero). See
[`docs/overview/entries/README.md`](docs/overview/entries/README.md) for the convention and the
compaction chore. Keep this index to current status, Known Issues & Risks, and What's Left. The
compaction sweep folds loose entries into the newest `history-*.md`, starting a new one when it
approaches ~250 KB and adding it to this table.

# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-09-08 · **By:** the twenty-third Lane B run · **Next ID:** `LB-65`

> **A mistyped ID in this file silently advances the whole lane's numbering.** A previous baton wrote
> an `LB-` number in the hundreds where it meant a `BF-` one, and
> `grep -rhoE '\bLB-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` — the command CLAUDE.md tells you to
> allocate with — dutifully returned it. **Check the max it reports is an entry that actually exists**
> (`grep -c '^### .*LB-64'`). This note does not spell the bad id out: writing it here would keep it
> winning the sort.

## Now

**Merged this run:** LA-62 (#949), LA-75 (#950), Q-112d (#951), LB-61's measurement (#952), Q-112e's
split (#953), LB-63 (#954). **Open:** #958, Q-278's surface half. `main` is at **v1.438.2**;
`pnpm check:rules` read **Ran 70 of 70** throughout.

**Filed this run:** LB-63 (shipped same night), LB-64 (Lane A — the weekly recap has no numbers to
draw), plus evidence onto LB-52, LB-56 and PS-39.

**READY (0) is the real state, and it is not the same as "nothing to do".** After #958 lands the
queue is **0 READY · 13 KEEP · 43 VERIFY (42 device) · 49 PARKED · 1 UNCLASSIFIED**. Everything left
is gated on the owner (LB-61), the device, or Lane A. **PS-4 is the UNCLASSIFIED one and stays that
way by design** — do not try to classify it again.

**Nothing has been near a device.** ~42 VERIFY entries are owed a look, and for BF-94, BF-105,
BF-110 and BF-111 the device is the whole verdict rather than a formality.

**⚠ BF-84 reads startable and is not.** Its `Keep:` says "the surface, Lane B's, safe to ship second"
— but **BF-94 supersedes its shape** and BF-94 is `Gate: device` on BF-61's fast-tap check. Building
BF-84's greyed two-button row would ship something BF-94 deletes; BF-84's own entry says so. This is
the trap an empty READY list pushes you toward.

### Waiting on the owner

- **LB-61 — should an on switch be brand-coloured or stay near-white?** Counted and proposed
  2026-09-08: 25 switches, 14 files, recommendation `--brand`, the argument against named. `Gate:
  owner`. One yes or no unblocks it.
- **LB-47: on a real session-level deload the intensity toggle vanishes silently**, and a real "run
  at full intensity" path needs a regeneration `/prescribe` cannot do. Lane A plus the owner.
- **Q-407's remainder is Lane A's**: the coach does not open by stating what it already knows.
- **Does the app's own QR scanner need LB-38's rotation tolerance?** The e2e helper is fixed; the
  in-app scanner uses a different decoder and was never audited.

## The lessons this run actually cost something

### 1. Never write "suite green" without having run it

Cost a red CI on #954, a PR whose entire diff is one `className`. `check:rules`, `check-component-size`
and `build` were run; `pnpm test` was not, and the claim went into the PR body and the journal anyway.
**The failure was real and caused by the change.** Run the full suite before every push. The
temptation is exactly proportional to how small the diff looks.

### 2. A source guard breaks in three ways that have nothing to do with what it guards

All three hit this run, in one file each:

- **An exact-marker anchor.** `goal-baseline.test.ts` slices on `indexOf('{/* Sleep Goal */}')`;
  lengthening that comment returned −1 and the guard silently stopped guarding.
- **A proximity window.** `sleep-provisional-surfaces.test.ts` pins `href: "/health/sleep"` and
  `provisional: sleepProvisional` within **120 characters**, deliberately. A line inserted between
  them breaks it. **Move your line, do not widen the window** — the tightness is what makes it work.
- **Self-matching prose.** A comment explaining *why* there is no `RecommendedValue` here contains
  the word and fails the assertion documenting it. Four instances this run. **Strip comments in the
  guard** (`scripts/lib/strip-comments`), as the sibling case in that same file already did.

### 3. An entry is often wrong about its OWN code — read the code before believing it

Two more this run, both caught before building. **Q-112e** asked for the weekly recap to get Q-112d's
trends; `/api/weekly-digest` computes a full weekly picture, spends every number on the model's
prompt and returns prose, over 14 days rather than the month the plan names — so the surface it asked
for had no data behind it, and the entry was split rather than half-implemented. **LA-75** claimed the
water formula "lands nowhere near 2500 for any real body weight"; a 76 kg sedentary profile is
recommended 2,508. The fix did not depend on it, but the claim was in the entry as settled fact.

### 4. A harness artefact looks exactly like a product defect

Six taps on Nutrition's "End of Day" button did not open the sheet, reproducing on unmodified `main`
— which read as a serious bug in the app's main door to the day review. A probe then showed **zero**
click events reaching *any* button on the screen while a programmatic `el.click()` worked: a
hand-rolled Playwright context, not the app. **Before filing, check whether the mechanism is broken
for everything or only for the thing you are looking at.** Nothing was filed.

Its twin: `/session-select` **redirects to `/workout`**, and `SessionSelectContent` is rendered by
`components/shell/tab-shell.tsx` on the **Home tab at `/`**. A grep scoped to `app/` finds no importer
and makes a live component look dead.

### 5. `next-item.js` reads FIELDS, not prose

Unchanged and still true. Used deliberately this run: LB-61 got `Gate: owner` so it stopped printing
as startable when what it needs is one decision. Q-278 flipped `Lane: B → A` when its surface half
shipped and its remaining half became route work — **the lane follows the open path**, which is the
rule working rather than churn.

## Do not re-litigate

- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**`,
  `lib/cache-groups.ts` are Lane A** — the **path**, not the nature of the edit. `scripts/**` is the
  Orchestrator's, except a shrink-only baseline line the check itself demands.
- **A Lane B half needing a Lane A argument is TWO entries.** Q-112e/LB-64 is this run's instance.
- **`components/workout-screen.tsx` is a shrink-only hotspot at ~1833 lines and you will hit it.**
  Derive further down rather than adding to it.
- **An e2e spec that stubs an `/api` route needs `test.use({ serviceWorkers: 'block' })`**, or the
  worker re-issues the request and the stub applies only sometimes. Custom Rules catches it.
- **`locator.click()` does nothing on Nutrition** — the date-swipe `useDrag` swallows it; use
  `tapCentre`. On More and Health, `.click()` is fine.
- **An e2e spec CAN talk to Postgres** and CAN intercept a route while preserving the real response:
  `const real = await r.fetch()`, then fulfil with the fields you want changed. That is how a screen
  is driven into a state the seed does not have without a statement about fixtures.
- **`hydrateUserPreferences` NEVER deletes a key the bag lacks**; `min-h-[Npx]` does nothing on a
  `<button>` (a bare `globals.css` element selector beats it — drive height with padding); `/more`
  SSRs a skeleton, so `curl` finds no tab content and that is not a bug.

## Claimed paths

None held. #958 touches `components/health/**` and `components/oura-score-chip-row.tsx`; released
when it merges.

## Gotchas worth carrying

- **`npx tsc --noEmit` TYPECHECKS NOTHING UNDER `__tests__`, and CI's `Build` job does.** The gate is
  **`node scripts/check-test-typecheck.js`** (per-file baseline — currently *320 errors across 90
  files*). `e2e/` **is** covered by plain `tsc`. Both vitest projects run `environment: 'node'`, so a
  `.tsx` cannot be imported: anything asserted directly rather than by source-scan lives in a `.ts`.
- **⚠ E2E IS ADVISORY, NOT REQUIRED — the previous baton said the opposite and it is wrong.** It
  claimed "wait for SIX checks, not five" per LA-22. LB-52 records four PRs merged with E2E
  `in_progress`, and **#954 merged that way on 2026-09-08** while E2E ran. `merge_pull_request`
  validates against real branch-protection state and would refuse a genuinely required check.
  **Whether to wait is a judgement, not a rule:** wait when the PR changes app code or adds a spec;
  merging on five is right when E2E already passed on that exact app code and everything landed since
  touches only `lib/__tests__/`, `scripts/` and docs. Check the diffs before deciding.
- **The doc-size baseline is the rebase tax and it does not scale with your diff.** #954 needed
  **four** base re-merges and five CI cycles for one `className`, every conflict on
  `docs/doc-size/docs/implementation-backlog.md.size`. **Recompute from the merged file** — read the
  number the check itself reports rather than computing `wc -l`. Only the *delta* survives a rebase;
  the absolute belongs to whatever `main` is at merge time. Evidence is on **LB-52**, which is
  `Gate: owner`.
- **`git merge origin/main` failing with `refusing to merge unrelated histories` is the shallow-clone
  graft**, not a real divergence. `git fetch origin --deepen=500` fixes it; it recurs every few
  fetches.
- **`docs/doc-size-baseline-history.md` is APPEND-ONLY** — a conflict is two *additions*, keep both.
  The per-role baton `.size` files are separate (LA-33), so a baton-only PR conflicts with nothing.
- **Rebuild `package.json`/`changelog.ts` from `git show origin/main:…`; never splice a hunk.**
- **`get_check_runs` lags.** To tell a slow job from a stale read, use `actions_get`
  `get_workflow_job` and look at **step-level** `started_at`/`status` — a step still `in_progress`
  with later steps `pending` is genuinely running. `405 has merge conflicts` means `main` moved.
- **Playwright needs `DATABASE_URL` prefixed in**; the session-start hook unsets it. A local
  full-suite failure that will not reproduce is usually that, not a defect.
- **`pnpm build` OOMs if `pnpm dev` is still running.** Kill it by PID — `pkill -f "next dev"` matches
  the tool call's own command line and kills the shell instead (exit 144).
- **The check:rules count is `Ran N of N` and moves** — never hardcode it, never quote "pass". It was
  **70 of 70** for this entire run.

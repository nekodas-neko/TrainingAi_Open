# 📖 Review Agent — baton

> **Successor sessions are titled `📖 Review Agent 🟢`** — exactly, both emoji included. The **leading**
> emoji is the role and never changes; the **trailing light** is that session's own status (🟢 live,
> 🔴 handed on) and is the only part that moves. A session self-titles 🟢 on its first instruction and
> flips itself to 🔴 as the last step of its handoff, after the baton and every PR have landed.

**Updated:** 2026-09-21 · **By:** fifty sweeps (2026-08-17 ×2, 2026-08-18 ×37, 2026-08-20 ×1,
2026-09-03 ×6, 2026-09-05 ×2, 2026-09-06 ×1, 2026-09-18 ×1, 2026-09-20 ×1, 2026-09-21 ×1) · **Next ID: `RV-103`.**

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

One trap: `docs/agents/README.md` and the backlog carry **`RV-31` as a prose example**, not an entry.
Follow the lookup anyway — skipped numbers cost nothing. Legacy `Q-` numbers stay valid, never renumbered.

## Still open — do not re-file these

From sweeps 29–39
([record](../../handoff-2026-08-20-platform-review-sweeps-29-39.md); 10 of its 13 findings shipped):
**Q-499** (self-fetching cards vanish on a failed fetch — its ten unverified candidates are a
*worklist*, not a defect count), **Q-555** (offline, a tab tap is a silent no-op before the service
worker claims the page). **Q-556 was listed here and is CLOSED** — it shipped on
`/api/activity-logs`, which now answers 404, verified live in sweep 47. From sweeps 41-42: **RV-37** and **RV-39**, both needing the device.

## Now — sweep 52 filed (2026-09-21). **Next ID: `RV-103`.**

**Sweep 52 was a visual sweep, angles self-chosen** — formatting drift, 384px layout,
empty/zero/error states, colour/contrast. [Write-up](../../reviews/2026-09-21-sweep-52-what-the-owner-sees.md)
· **RV-84…RV-102** · batches `error-state-onerror` (2), `layout-384` (5).

**RANK VISUAL FINDINGS BY THE RESUME TELEMETRY, NOT BY TASTE.** `error_events` `bf110 resume
dom-intact` rows carry the URL: **Home 22 · Nutrition 14 · Health 11 · More 7 · Workout 2**. That
query is the cheapest prioritisation evidence this repo has — reuse it.

**RV-84 is systemic and the highest-leverage:** `cachedFetch` **cannot reject** (its network section
is inside `try/catch/finally`), so every `.catch()` chained onto it is dead — 16 sites, and the error
states behind them unreachable. One rule, one-line test → a check script, not a re-sweep.

**Home carries three failure-vanish bugs** (RV-85/86/87). The one to read is RV-85: `fetchWithRetry`
exists — per its own header — so a blip does not leave widgets "blank until the app is restarted",
and it then retries 3× and gives up *silently*, with no error channel, landing on that exact blank.

**The lens that worked, third sweep running:** treat a claim in a comment, prompt or helper name as
a *hypothesis* and find its counter-example — RV-84 (a `.catch` that cannot fire), RV-85 (a helper
that does not do what its header says), RV-97 (a colour contradicting its own label), RV-89 (a
shared helper half-used).

**Production content beats invented worst cases.** The layout findings are measured against real
rows — 130 of 337 food items exceed the diary's 22-char budget; the owner's lower-back injury is
**live**, so the chip that eats the mid-set title renders for real. Query the content before sizing
a truncation finding.

**Carried from sweep 51:** a backlog conflict of a **third kind** the rules do not name — Lane A
*updated* an entry while I added entries above it, so neither two-deletions nor two-additions
applied. Read the headings; keep mine plus their newer version.

**Sweeps 47–51 closed.** **Their durable rules:** a 4xx is not evidence the guard fired (read which
field it names); pair every refusal with a one-field control; `claude_ro` is **the owner's rows
only**. **Owed:** RV-37/39 device; RV-38/41/43 owner decision.

## Carried from sweep 40 ([write-up](../../reviews/2026-08-20-non-workout-write-surface-ownership.md))

- **✅ All three write-path ownership rules now have evidence.** (b) sweep 40, (c) RV-32, (a) sweep 43.
- **A cheap contrast beats a long argument**, used nine times — *six routes say 200, three say 404*;
  *this key is in 0 groups, its sibling in 4*. Find the surface that already does it right.

## Next — in the order they are worth doing

**Not this:** the status-mapping lens — sweep 47 finished it. Twelve of thirteen routes map, the
one gap is filed, and the remaining hand-rolled catches were each checked for `try` scope. And not
the documentation-integrity seam. Sweeps 34–37 were four consecutive passes over it and
left three CI checks behind (`check-known-issue-duplication`, `check-index-doc-paths`,
`check-module-map-symbols`). Pick a lens that runs the app.

- ~~The workout/device FK half~~ — CLOSED clean by the checkpoint (CASCADE edge refuses cross-user).
- **The POST surface, the only verb left.** Sweeps 47 and 48 covered `DELETE` and `PUT`/`PATCH`; no
  sweep has asked what a `POST` answers when its body references a row that does not exist or is not
  the caller's. Same method — a malformed-id control beside a well-formed one, then read the row back.
- **A clean clone, actually built** — `git clone` into an empty container, `pnpm install && pnpm build
  && pnpm test`. Settles `NOTICE`'s claim outright; Q-313 is why it is worth doing.
- **The sync/outbox under a server that fails mid-push, on the device half.** Sweep 10 drove the
  server half; the local SQLite outbox has never been exercised, and it needs hardware.
- **`/api/coach/preview`, still unprobed** after three Coach sweeps — and **whether the model proposes
  sane numbers**, untouched because every patch has been hand-written. RV-41 raises its stakes.
- **Q-452's siblings.** The rendering half is swept (22 routes, honest bar RV-38). Untouched:
  `weekly-digest` and the coach, which produce nothing for a zero-data account — they need a
  **partial**-data fixture, which does not exist yet.

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

- **A malformed id and a well-formed missing one are each other's control** — two statuses for two
  ids differing only in format means one is wrong; no fixture needed.
- **"Reports success" is not a finding without a POSITIVE control** — `200 {ok:true}` for a ghost id
  says nothing until the same call with a real id is shown to move the database. Where the table was
  empty, sweep 48 wrote *not established* rather than asserting or dropping it.
- **Check for the offline-first upsert before filing a create-on-update.** `saved-meals` writing a
  row at a client-supplied UUID looks like the ownership class and is the opposite: one shared
  upsert with `setWhere` on the owner, so a device can mint ids offline.
- **A prior review's DECISION is a claim too — find its boundary, do not reverse it.** Sweep 47's
  seven routes were considered and deliberately not filed on 2026-08-18; that argument is right for
  the case it tested and false for the one it did not. The finding is the boundary.
- **Two identical responses are two failed probes.** Ghost and malformed both returning
  `400 Invalid body` read as "it rejects everything"; both had missed the handler (wrong param shape).
- **A malformed id is the cheapest control for a dynamic route** — `400 Invalid id` proves the route
  matched and its guard ran, for one extra request and no fixture.
- **A one-call-site helper is not automatically unreached** — `isRetryableWriteError` has one site,
  placed where it covers every branch. Check where the site *sits* before counting it.
- **Test what the repo says about itself.** A comment, a doc header or a prior review's praise is a
  claim with a worked example in it; send it. Four of this session's findings came out of that.
- **Pair every refusal with a control**, and **assert the payload beside the rendered text**. A 4xx
  usually names a *different* missing field; "the card shows 50" is not a finding but "the route says
  `hasData: false` and the card shows 50" is.
- **Choose fixtures hostile to the arithmetic, and sweep the input range.** A 100 kg starting 1RM puts
  every common percentage on a plate boundary and reports zero drift for a mechanism that moves 13%.
- **Count requests by the DATE they carry, not how many there are.**
- **Ask what the READ joins before calling a stored cross-user reference a leak** (RV-32 vs RV-42).

- **The zero-data account reaches a state nothing else can** — the seeded user has data for
  everything, so a fabrication is invisible there. Re-run it whenever a scoring surface changes.
- **Import the shipped module; never re-implement the formula you are auditing.** A throwaway vitest
  file inside the package is the way in — there is no build output, `npx tsx` is absent, and vitest
  swallows `console.log`, so write to a file and `cat` it.

- `pnpm install --frozen-lockfile` first if `node_modules` is missing (`@sentry/nextjs` failing to resolve
  is the tell), then `pnpm db:local`, then **`env -u DATABASE_URL -u DATABASE_SSL pnpm dev`**. Both vars are
  pre-set to production in the container and Next will not let `.env.local` override an already-set
  `process.env` var — without the `env -u` the dev server silently tries production and fails.
- Launch the dev server with `nohup … &` through a **background** Bash call. A `(cmd &)` subshell gets
  reaped when the tool call returns.
- API sweeps: sign in with `curl` via `/api/auth/csrf` → `/api/auth/callback/credentials`
  (`test@local.dev` / `testpass123`) into a cookie jar. A second account is two minutes — copy the
  seeded `password_hash` onto `zero@local.dev` with `is_active = true`; **without `is_active`,
  sign-in 302s to a null session**, which reads like broken login and is the invite gate working.
- Screens: temporary specs in `e2e/`, run against the already-running server with
  `E2E_BASE_URL=http://localhost:3000` **and `DATABASE_URL=…` set** (`zero-data.setup.ts` fails loudly
  without it, before your spec runs). **Delete the spec and `test-results/` before committing.**
- **This container's clone is SHALLOW.** *"refusing to merge unrelated histories"* and an empty
  `git merge-base` mean the fetch did not reach past the shallow boundary, not divergence.
  `git fetch --unshallow origin` fixes it. Never `--allow-unrelated-histories`.
- **`get_check_runs` returning `total_count: 0` has a third cause, and it is the likeliest one here.**
  `CLAUDE.md` names a stale base; the PR field to read is **`mergeable_state`**. `dirty` means a merge
  conflict, and **GitHub runs no PR checks at all while it cannot compute the merge commit** — so a
  conflicted PR looks exactly like CI that never fired. Sweep 40 lost fifteen minutes to this with a
  base that was provably current (`git merge-base --is-ancestor origin/main HEAD` passed). Resolve the
  conflict and the checks start within seconds; `unstable` means mergeable with checks still running.
  **Check `mergeable_state` before waiting on anything.**
- **Crossing local midnight is one Playwright call** — `page.clock.install({time})`, `fastForward`,
  dispatch `visibilitychange`. `faketime` neither helps nor is needed.
- **`page.goto()` is a HARD navigation and makes every screen look broken:** React cleanup never
  runs, so nothing saves its scroll offset. Drive a real in-app click, and assert the precondition —
  a screen with nothing to scroll fails identically to a broken one.
- **Assert every probe reached a real route.** Next's HTML 404 for an unmatched path is indistinguishable
  from an access-control rejection by status alone — the tell is the body, HTML vs JSON. A 405 means the
  route is real and the verb is wrong; check the handler before concluding anything.
- **Read the row back out of Postgres.** A 2xx cannot distinguish "did it" from "ignored it safely";
  a body echoing your input proves nothing about what was stored. This is what produced RV-45.
- **Expect your probe to be wrong in the direction of your hypothesis.** Sweeps 36–39 produced four
  measurement errors, each plausible and publishable as written. **Corroboration between two weak
  signals is not evidence when they can fail for the same reason.**
- First-visit renders are confounded by Turbopack compile time; re-check warm before believing sparse.
- **Before the docs compaction chore, check the open-PR list** — whole-directory, done in duplicate
  twice. Cite the review/handoff doc, never the loose journal entry.

## Where the earlier sweeps live

All eleven pillars have been reviewed at least once. Read the write-ups by *subject* through
`docs/domains/*/README.md`, not in sweep order.

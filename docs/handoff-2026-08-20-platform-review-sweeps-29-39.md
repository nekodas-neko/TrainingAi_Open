# Handoff — 2026-08-20 · Review sweeps 29–39: the prose-decay class, and five wrong measurements

_Domain: `platform` (also touches `app-shell`, `devices`, `activity`) · Branch: `review/session-wrapup-sweeps-29-39` · PR: see below_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/platform/README.md`, then `docs/agents/state/review.md` (the baton — it is the
> live state; this file is the narrative). This covers only what sweeps 29–39 did.

## Goal

Continue the standing Review sweep: run the app, file what it finds, end at a docs-only PR. Eleven
sweeps ran. The run produced one durable structural change (three new CI checks) and one
methodological result that is worth more than most of the findings.

## Current status

- **Build/test:** `pnpm check:rules` **43 of 43** at the time of the last merge (now 50 of 50 on
  `main` after other agents added more). All eleven PRs merged CI-green.
- **Device-verified:** **no.** Nothing in any of these sweeps left the web build. Every offline-first
  claim verified here is the **`localStorage` seed path**, not the native SQLite store that is the
  APK's real source of truth.

## What shipped

Eleven PRs, **#140–#151**. Findings **Q-492…Q-499** and **Q-552…Q-556**.

| PR | Sweep | Finding |
|---|---|---|
| #140 | 29 | **Q-492** — 7 of 9 hand-typed counts in `CLAUDE.md` stale; all 3 script-backed ones current |
| #141 | 30 | **Q-493…Q-496** — the secret-gated ingest route, driven for real |
| #142 | 31 | **Q-497** — a 31-day range makes two admin routes loop forever |
| #143 | 32 | **Q-498** — three unauthenticated routes buffer an unbounded body |
| #144 | 33 | **Q-499** — cards cannot tell "no data" from "fetch failed"; two lenses clean |
| #145 | 34 | Q-499 reproduced in a browser; **Q-552** — the Q-band ledger was wrong |
| #146 | 35 | **Q-553** — a Known Issue in both lists at once + the check that prevents it |
| #147 | 36 | **Q-554** — orientation indexes named paths that do not exist |
| #148 | 37 | module map's `path → symbol` claims all hold (110/110) + ratchet |
| #149 | 38 | **Q-555** — offline paths work; a tab tap is a no-op before the SW claims |
| #150–151 | 39 | **Q-556** — cross-user isolation holds; one route reports a success it did not perform |

**Three CI checks added** (Custom Rules 40 → 43), each guarding a documentation fact nothing checked:
`check-known-issue-duplication.js`, `check-index-doc-paths.js`, `check-module-map-symbols.js`.

## Where the findings stand now — verified in source on 2026-08-20, not assumed

**10 of 13 shipped.** Checked against `main`, not taken from the queue's silence:

| | State | Evidence |
|---|---|---|
| Q-492 | ✅ fixed | the `**471**` prose count is gone from `CLAUDE.md`; the script reports 428 |
| Q-493 | ✅ fixed | #235 "Derive the rate-limit client IP from the trusted hop" |
| Q-494 | ✅ fixed | `resolveIngestDate` imported in the ingest route — **the recommended fix, not a bespoke bound** |
| Q-495 | ✅ fixed | zero `z.coerce.number` remain in that route |
| Q-496 | ✅ fixed | date now routed through `resolveIngestDate` |
| Q-497 | ✅ fixed | `shiftDateStr` pads the year: `String(y).padStart(4,'0')` — and someone found Q-329 in the same function while there |
| Q-498 | ✅ fixed | all three unauthenticated routes now use `readJsonLimited` |
| Q-552–554 | ✅ | fixed in their own PRs |
| **Q-499** | **open** | cards vanish on a failed fetch |
| **Q-555** | **open** | offline tab tap is a silent no-op before the SW claims |
| **Q-556** | **open** | `DELETE /api/activity-logs` reports success for a row it did not delete |

## Deliberately NOT done

- **No code was written.** Review ends at a docs-only PR; the three CI checks are the one exception,
  and they are guards on documentation, not app behaviour.
- **Q-499's ten unverified candidates were not promoted to a count.** Two were hand-verified and one
  reproduced in a browser; the other ten remain a **worklist, not a defect count**.
- **`PATCH /api/activity-logs/<id>/metrics` was never reached** — the probe payload was rejected by
  Zod first, so that route's ownership check is **still unverified**.
- **The device runtime.** It is the only surface on the baton's open list that genuinely needs hardware.

## Key decisions (with rationale)

- **Filed a null result as a result** (sweep 37, 110/110 symbol claims hold). It *bounds* the Q-554
  worry rather than leaving it open — an unreported null result gets re-investigated.
- **Kept Q-139 and Q-81 in the live Known-Issues list rather than the archive.** Both name an
  outstanding check, and the rule permits a move only when nothing is owed. The premature archive
  copies were cut instead.
- **Scoped Q-556 as low, not a security finding.** The row was verified intact in the database; a 2xx
  cannot distinguish "ignored it safely" from "did it", so it was checked.
- **Made every new count a script citation, not prose** — that is the run's thesis and the reason for
  the three CI checks.

## Gotchas / what did NOT work

**Five measurements were wrong, and every one produced a plausible result in the direction I
expected.** This is the most transferable output of the run:

1. **A 429 experiment whose independent variable was never applied** — `/api/weights-summary` has no
   rate limiter, so all 90 requests returned 200 while the results table printed a clean-looking
   `baseline=1 under429=1`.
2. **"38 broken paths"** contradicting a check merged an hour earlier — the *probe* omitted the
   `lib/…` → `packages/shared/src/…` remap.
3. **"No offline page on any surface"** — the reload ran while the service worker was still
   uncontrolled. **Registration is not control**; one registration was already present on the failing
   load.
4. **"38% of cached `/health` survived offline"** — the click never navigated, so the home page was
   measured against a `/health` baseline. **And the corroborating marker failed the same way**:
   `Sleep|Readiness` are home-page widget labels.
5. **Eleven clean cross-user probes that proved almost nothing** — six hit routes that do not exist,
   and Next's HTML 404 reads exactly like an access-control rejection. **The tell was in the body, not
   the status.**

> **The keeper: corroboration between two weak signals is not evidence when they can fail for the same
> reason. Prefer one signal that cannot be faked over two that agree.**

**Other traps, all cost real time:**

- **The first version of every check over-reports.** Nine consecutive instances, including three where
  the over-reporting script was one just written to catch over-reporting. Budget the triage *as* the
  sweep.
- **A document that says a path is absent still contains that path** — my own path checker tripped on
  my own fix twice, the second time in the sentence describing the trap.
- **`git clean`/`git rm` under a running Playwright test kills it.** Deleted a spec mid-run twice.
- **`git rm` fails on the current session's own journal entry** (still untracked), so a fold silently
  duplicates it. Exclude it.
- **The compaction chore was done in duplicate — twice** (#130, and again here against #152). It is a
  *whole-directory* operation, so concurrent sessions are guaranteed to collide. Check the open-PR
  list before starting it. (PR #263's new Orchestrator role now owns this.)

## Files to look at

- `docs/agents/state/review.md` — the baton. **The live state; read it before this file.**
- `scripts/check-known-issue-duplication.js`, `check-index-doc-paths.js`,
  `check-module-map-symbols.js` — the three checks this run added; their headers carry the reasoning,
  including the narrowings that were *earned by running them*, not designed.
- `docs/overview/entries/README.md` — carries the journal-floor measurement and the lever
  (**cite the review/handoff doc, never the loose journal entry**).

## Open questions / blockers

- **Three findings remain open**: Q-499, Q-555, Q-556. None is urgent; all are filed with a stated fix.
- **The ID scheme changed under this run.** Bands are gone; IDs now count up from `RV-`. This session's
  band claim (552–601) is superseded — and the baton records that its warning about block-claiming was
  correct, since following the old instruction literally would have collided with fourteen live numbers.
- **Nothing here is device-verified**, and Q-555 in particular should be re-checked on device where the
  worker's install timing and the WebView lifecycle differ.

## Pickup prompt

```
You are the Review Agent 📖 for the TrainingAI repo. Keep that exact session title, emoji included.

Read in this order before doing anything:
1. projectOverview.md — current status and the live Known Issues list.
2. docs/agents/README.md — the six-role contract (an Orchestrator role was added in PR #263).
3. docs/agents/state/review.md — your baton. This is your live state; trust it over any narrative.
4. docs/handoff-2026-08-20-platform-review-sweeps-29-39.md — the previous run's record.

Your role: sweep the app for bugs, write each finding up in docs/reviews/YYYY-MM-DD-<topic>.md,
file it in docs/implementation-backlog.md, and end at a docs-only PR. You do not fix what you find.
Docs-only PRs merge without asking once CI is green.

IDs: bands are gone. Take the next free ID counting up from RV- :
  grep -rhoE '\bRV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1

Your core mandate is to RUN THE APP, not read it. Three surfaces the baton had recorded as
"structurally unreachable" all dissolved in minutes once tried — the secret-gated ingest route
needed one env var, the offline paths needed context.setOffline(true), and a second account was
already sitting in the e2e harness as a zero-data user. Only the device runtime genuinely needs
hardware. Before writing a surface off, spend ten minutes trying.

Expect your own measurements to be wrong. Five were wrong in the previous run, each producing a
plausible result in the direction expected. Before believing a probe:
  - print the independent variable and confirm it was actually applied;
  - check the response BODY, not just the status (an HTML 404 means the route does not exist);
  - prove an async mechanism is live before testing it (registration is not control);
  - prefer one signal that cannot be faked over two weak signals that agree.
The first version of any check you write will over-report. Budget the triage as part of the sweep.

Three findings are open and unfixed: Q-499 (self-fetching cards vanish on a failed fetch — ten
candidates remain a worklist, not a count), Q-555 (offline, a tab tap is a silent no-op before the
service worker claims the page), Q-556 (DELETE /api/activity-logs reports success for a row it did
not delete). Do not re-file them.

Suggested first action: pick a lens that requires running the app rather than reading it, and that
is NOT documentation integrity — the previous run did four consecutive doc sweeps and added three
CI checks there, so that seam is well covered. The device runtime is the one genuinely open surface;
if no device is available, the strongest untried web-reachable lens is the sync/outbox behaviour
under a server that fails mid-push (the server half was driven in sweep 10; the on-device half was
not).

Constraints that will otherwise be rediscovered:
- Nothing in the previous eleven sweeps left the web build. On web, cachedFetch falls back to
  localStorage, so any offline-first claim you inherit covers the seed path, NOT the native SQLite
  store that is the APK's real source of truth.
- claude_ro is row-scoped to one user and error_events prunes at 30 days. Write every production
  count as "the owner's, recently" — never "the system's".
- Never use bash curl against api.github.com; the token is a non-authenticating placeholder. Use the
  GitHub MCP tools.
- Do not run the journal compaction chore without checking the open-PR list first. It is a
  whole-directory operation and has now been done in duplicate twice.
```

# Handoff — Q-49 is done; the repository is public

**Date:** 2026-08-17 · **Domain:** platform · **Repo:** you are already in the right one

The public-repo migration is complete. This repository — `nekodas-neko/TrainingAi_Open` — is what
Railway deploys and where all development happens. The private `nekodas-neko/TrainingAI` is
**archived and read-only**.

---

## The single most important thing

**Do not open pull requests against the old repository.** It is archived, so they cannot merge, and
five that were open when it was archived had to be rescued by hand (#8, #9). Every PR number in the
documentation below roughly **#1250 and under refers to that archived repo**; numbering restarts
from #1 here. Both index docs say so at the top.

The archived repo is kept rather than deleted for exactly one reason: its git history is the only
remaining copy of the excluded third-party material and the two extraction-related documents. Never
delete it.

---

## What shipped, and what proves it

| Runbook step | Evidence it worked |
|---|---|
| A4b — delete the vendored material | `check-private-paths` reports `total tracked: 0.0 MB` |
| 8 — push the snapshot | fresh clone of this repo, gate run *there*, every row "already removed" |
| 9 — CI + branch protection | six required checks, all green, merging through the rule |
| 10 — logged-out APK download | owner downloaded `app-debug.apk` in a private window |
| 11 — repoint Railway | production served `ta-6c072f9bfca7`, this repo's snapshot commit |
| 12 — `ADMIN_EMAIL` | set; a no-op on the existing row, which is already admin |
| 13 — collect the winnings | #4 — the release token is no longer required |
| 14 — archive the old repo | read-only since 2026-08-17 |

**The bucket download is proven.** It had never executed anywhere before the A4b deploy — every
earlier run took the repo-copy branch, and no session can authenticate to storage. Both boot checks
are now fatal in production, so a running production process *is* the proof: it cannot come up unless
34 constants downloaded and 8 models verified. It has come up twice, including once built from this
repository.

---

## Three things found along the way that are worth more than the migration

**1. A green `publish-dry-run` did not mean what everyone read it as (Q-306).** A3 was recorded as
having made the model constants a runtime-only dependency, on that evidence. It had not: `next build`
imports every route to collect page data, so seven module-scope loader calls across six modules still
opened the files at build time. Deleting them failed the build at `/api/achievements` — which would
have been a failed Railway deploy. **The dry-run runs no build gate and structurally could not have
caught it.** Fixed by making those modules read on first use, with parity re-proven either side.

**2. `seed.sql` had the project's own banned UTC-date bug, in SQL (#1397).** Every seeded date came
from `current_date` — the Postgres server's date, UTC in CI — while the app reads "today" in the
user's timezone (Brisbane, UTC+10). After 14:00 UTC the newest seeded row is yesterday as far as the
app is concerned, so `goal-invalidation.spec.ts` could not pass **for ten hours of every day**. It had
landed in the morning, which is why it went green then. `main` was red for eight hours before anyone
looked.

**3. An AI route's by-design 502 made the Home tab spec a coin flip (#5).**
`weekly-recap-banner.tsx` POSTs `/api/weekly-digest` on every Home mount; the route returns 502 when
the model call fails, which it always does in CI (the E2E job sets no `GOOGLE_GENERATIVE_AI_API_KEY`).
The spec counts any `/api/` 5xx as a page failure, and whether the POST returns before the assertion
is a race. Two runs eleven minutes apart on identical code went one each way. Fixed with a **named**
exclusion, not "ignore 502".

The pattern connecting all three: **each was a green signal that meant less than it appeared to.**
Verify what a check actually covers before trusting it.

---

## Open work

**Queued and specified** — next free Q number is **311**:

- **Q-306** — give `publish-dry-run.js` a `next build` gate. Cheap partial worth having regardless: a
  Custom Rules check that fails on a module-scope call to any `lib/oura-models/constants` getter.
- **Q-307** — the synthetic MET fixtures carry values below 1.0, which is physiologically impossible
  (1 MET *is* rest), so `estWorkoutKcal` returns null and **nine tests are guarded off in CI** that
  have nothing to do with vendor magnitudes. Constraint: fixtures can only be regenerated on a machine
  holding the vendor's files, which since A4b is not a session.

**Two owner decisions from 2026-08-12 are recorded but unimplemented** —
[`owner-decisions-2026-08-12.md`](owner-decisions-2026-08-12.md): prescribe from the last non-deload
session, and lighten *every* exercise during an ai_dynamic deload. Read that file before touching
either; the owner was offered a smoothed middle on the first and explicitly chose the strict version.

**Unverified, and honestly so:**

- The **update card** in More should now show a version for the first time since 2026-08-04 (#4 fixed
  a token requirement that had silently disabled it). Nobody has looked.
- `periodization-soft-delete.test.ts > getWeeklySetsByMuscleGroup` fails **locally** (3 of 21) and
  passes in CI on a fresh database. Not root-caused. The tell is its shape — `expected undefined to
  be 1`, a missing row rather than a duplicated one.
- Nothing in this migration was device-verified. It touched no native code, so the APK is unaffected
  and no rebuild is needed — but that is a reasoned claim, not an observation.

---

## Traps specific to this repository

- **Test specs need a real tree.** A clone with a symlinked `node_modules` cannot start Next's dev
  server — *"Symlink node_modules is invalid, it points out of the filesystem root"* — and Playwright
  reports that as `webServer exited early`, which reads like a spec failure.
- **`git apply -3` can silently roll back a whole patch** while printing "applied cleanly" for
  individual files. Check `git status`; apply file by file if it does.
- **`get_job_logs` cannot reach the Playwright output.** It caps at 5,000 lines and the Postgres
  container dump consumes all of them. The `playwright-report` artifact is always empty, because the
  config uses the `github`/`list` reporters, which never write that directory. Use
  `actions_get` → `get_workflow_run_logs_url` and download the zip.
- **CI has six required checks**, and the Android workflow is path-gated — a JS-only PR produces no
  Android run at all, which is correct rather than a failure.

## Pickup prompt

```
You are working in nekodas-neko/TrainingAi_Open — the public repository, which is what Railway
deploys. The private nekodas-neko/TrainingAI is archived and read-only; never open a PR there.

Read in this order: projectOverview.md -> docs/domains/<pillar>/README.md for whatever you are
touching -> docs/implementation-backlog.md.

The public-repo migration (Q-49) is COMPLETE. Do not re-verify it. Read
docs/handoff-2026-08-17-platform-public-repo-migration-complete.md only if something about the
repo split, the excluded model assets or the boot checks confuses you.

Take the top item off docs/implementation-backlog.md, following the protocol at the top of that
file, and re-verify the entry against main before implementing it — entries go stale while they
sit in the queue. Next free Q number is 311.

Constraints you would otherwise rediscover:
- PR numbers below ~#1250 in the docs refer to the archived repo, not to this one.
- publish-dry-run.js runs no `next build` gate (Q-306). If you change what the published tree
  contains, run `next build` yourself; its green does not cover you.
- Nothing bucket-shaped can be exercised from a session — sandbox storage credentials reject
  with SignatureDoesNotMatch. Only a deploy tests it.
- get_job_logs cannot reach Playwright output past the Postgres dump; download the run-logs zip
  via actions_get -> get_workflow_run_logs_url instead.
- A clone with a symlinked node_modules cannot run the E2E suite at all.
```

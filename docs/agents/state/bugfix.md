# BugFix Intake Agent 🪲 — baton

> **Successor sessions are titled `BugFix Intake Agent 🪲`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

The standing intake role. Owner reports (screenshots, descriptions, "why is this doing that")
come in; each leaves as a traced backlog entry in `docs/implementation-backlog.md`, landed and
merged in a docs-only PR. **This role does not fix.** A fix that skipped the queue is one nobody
else can see coming.

Rewrite this file **in full** — never append — before the session ends or context runs out.

---

## Standing facts for this role

- **Entry IDs are `BF-<n>`, counting up forever.** Bands and the shared pointer are both gone (see
  `docs/agents/README.md` §3). Find your next number with
  `grep -rhoE '\bBF-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`. Legacy Q-387…449 stay valid
  where already used.
- **No migration numbers.** Intake never claims one. If an entry needs a corrective migration, say
  so in the entry and leave the number to the implementer.
- **Docs-only PRs, opened and merged without asking** (CLAUDE.md Standing Instructions). CI still
  has to be green; a markdown-only PR does run the full pipeline, because the `pull_request`
  trigger has no `paths-ignore`.
- **Entry model to copy: Q-310** (`docs/implementation-backlog.md`). Owner report verbatim +
  screenshot described in words + traced file/line + why it is one bug with N symptoms + fix
  direction + what to verify. That is the bar.
- **Dedup before filing.** `grep` the backlog *and* `projectOverview.md`'s Known Issues (253
  headings, newest first, from line ~3383). If it's already filed, amend that entry in place with
  the new evidence — don't file a second number.
- **Escalate loudly, don't just file**, if a report reveals something destructive already happening
  in production: data loss, a security hole, auth breakage.

## Tools available for tracing

- `pnpm dev` against seeded local Postgres (port 5433, `.env.local`; `DATABASE_URL`/`DATABASE_SSL`
  must be unset in the shell first — the session-start hook does this).
- `pnpm e2e` — the E2E harness (Q-249).
- `POST /api/admin/db-query` over the `claude_ro` views for production. **Row-scoped to one user
  and pruned at 30 days** — every count from it is "the owner's, recently", never "the system's".
  Write findings that way.

## Framework docs — resolved 2026-08-17

The previous version of this baton recorded that `docs/agents/README.md` did not exist, and that
orientation had to come from `projectOverview.md` and `CLAUDE.md` instead. **It exists now** — the
operating model landed the same day. Read it: §1 defines this role, §2 is the authority table, §4
is the handoff ritual this file is part of. The cold-start prompt for the role is
[`docs/agents/prompts/bugfix.md`](../prompts/bugfix.md).

The band this baton used to record is gone; IDs now come from the `BF-` prefix.

---

## Session log

### 2026-08-17 — first session under this role

- Read: `projectOverview.md` (structure + Known-Issues index), `CLAUDE.md`,
  `docs/implementation-backlog.md` (protocol, queue headings, Q-310 as the format reference).
- Created this file. `docs/agents/` did not exist.

**Filed: Q-387** — `[nutrition]` adaptive-TDEE counts a partially-logged day as complete.
Owner asked what stops the tuner treating "breakfast + lunch, skipped dinner" as the whole day;
the answer is nothing. Traced to the `intakeKcal > 0` filter at `adaptive-tdee.ts:96`, measured
with the real module (6 partial days of 14 → 514 kcal low, all gates passing, `confidence:
'medium'`), and the error reaches the recommended calorie target via
`energy-balance-service.ts:180`. Latent today because the Q-302 gate is not passing.
Queued below the three live user-facing bugs (Q-450/451/452) and above the tooling items, since
it is a prescription-correctness bug that is not firing *yet*. Known-Issues row added.

**Filed: Q-388** — `[devices][heart-rate]` ring battery drains ~3.5× stock (owner: 20% overnight,
charge every 2 days, vs 7 days stock). `enableMeasurementSequence()` (`OuraProtocol.kt:123-127`)
sets DAYTIME_HR + SPO2 + REAL_STEPS → AUTOMATIC on every connect, unconditionally, no user toggle.
Production confirms SpO₂ is the largest event source (53,412 rows/7d) and ~75% of it falls
22:00–09:00, matching the reported overnight window. Filed above Q-387. Known-Issues row added.

**Method note that paid off, and a correction I had to make mid-investigation.** The first
hypothesis was a stuck live-HR mode — `reqBleFastHrMode(false)` and `EXERCISE_HR → AUTOMATIC` exist
*only* in `liveHrStopSequence()`, so a session that never reaches `stopLiveHr()` leaves fast-HR
sampling on forever. That is a real defect and it is in the entry. But it is **not** what is
draining the battery: an hour-of-day query showed `ehr_trace_event` at exactly zero from 21:00 to
08:00, which a stuck live mode could not be. **Query the distribution before believing a
mechanism** — the tag totals alone would have supported the wrong answer, and the hourly breakdown
both refuted it and pointed at SpO₂. Also: event counts from `oura_raw_samples` measure *ingestion*,
which is sensing **and** drain success — an unexplained 2026-08-04 step change is in the entry as an
open question for exactly that reason, not as a finding.

**Filed: Q-389** — `[nutrition][app-shell]` printable food labels for saved meals, scannable back
into the app. Owner feature request, not a defect. The intake value was in tracing half two: the
app **already** reads QR — `CapScanner.startScan()` is called with no format restriction
(`components/nutrition/barcode-scanner.tsx:82`) and the web fallback is `BrowserMultiFormatReader`
— so a QR carrying the saved-meal id makes "scan it back" exact and free, versus the
photo/OCR path the owner assumed. Entry also steers away from `lib/exercise-image-gen.ts` for the
label itself: an image model cannot be trusted to render exact macros. Mockups delivered as a design
canvas (four directions at true print size); **not committed to the repo** — they live in the
session scratchpad, so re-seed from the artifact if they are needed again. No projectOverview row:
Known Issues is for defects and risks in shipped features, and a feature request is neither.

**When a report is a feature request, not a bug:** still file it (it would otherwise be lost), but
say so in the entry and point at the planning-session requirement — intake does not write the
implementation plan. Q-389 is the shape to copy.

**`check-doc-index-size.js` will fail every intake PR you write — plan for it.** New as of
2026-08-17: a shrink-only ratchet on `projectOverview.md`, `docs/implementation-backlog.md` and
`CLAUDE.md`. Intake adds an entry per report, so it trips every time. The precedent set by the
other lanes (read the comments above `BASELINE`) is to **raise the baseline in the same PR** with a
written justification, because queue entries and Known-Issues rows are what these files are *for* —
the growth it exists to catch is narrative and dated notes. But treat the failure as a real signal
first: Q-387's first draft was 24/48 lines over and trimming it to 18/27 cost nothing an implementer
needed. Budget ~30 lines per queue entry, ~15 per Known-Issues row. Run `pnpm check:rules` locally
before pushing — it caught this and quotes its own count (**38 of 38** on 2026-08-17); nothing else
counts as the custom-rules gate.

**Rebase note for next time:** `main` moved twice during a single ~30-minute intake. Q-310 shipped
and left the queue, and Q-306 was renumbered to Q-313, both inside the window between reading the
file and committing. The rebase conflicted on the renumbered heading I had anchored to. Resolution
that worked: `git checkout --ours <file>` to take `main` whole, then re-insert the new entry by
script against a *fresh* anchor. Do not hand-splice these two files — queue position is priority,
so a bad splice silently reprioritises someone else's work.

**Two things learned that are worth reusing:**
- The probe pattern is cheap and much stronger than argument: import the real shared module in a
  scratch `.ts`, run it with `npx vite-node <file>` from the repo root, print a table. `tsx` is not
  installed; `vitest run` ignores a file that has no test in it. Write the probe **inside** the repo
  (imports resolve) and delete it before committing.
- When a module already has a guard against a *related* case, read that guard's comment before
  assuming it covers yours. Both Q-387 protections were real, deliberate and documented — and the
  documented rationale is what proved the gap, because it named the trap and then handled only the
  self-correcting half of it.

**Nothing mid-triage. Nothing received-but-unfiled. Nothing blocked.**

Next intake session starts at **`BF-1`** (no band, no ceiling).

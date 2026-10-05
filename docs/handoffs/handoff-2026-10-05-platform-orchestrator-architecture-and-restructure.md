# Handoff — 2026-10-05 · Orchestrator: ingest architecture, and the restructure review

_Domain: `platform` (also touches `devices`, `readiness`) · Branch: `neko/adoring-ritchie-pnfwwj` · PR: #2055 (open, the restructure adoption) · also #2037 (open, DV queue corrections)_

> **Read first:** `projectOverview.md`, then `docs/domains/platform/README.md`, then
> [`docs/architecture/ingest-and-scoring.md`](../architecture/ingest-and-scoring.md) and
> [`docs/superpowers/specs/2026-10-05-release-train-design.md`](../superpowers/specs/2026-10-05-release-train-design.md).
> This file covers only what the Orchestrator session did on 2026-09-28 → 10-05 and what it leaves behind.

## Goal

Two things ran in parallel and now have to be reconciled: an **ingest/scoring architecture change**
(raw stays on the device, only scored values reach the cloud) and the owner's **release-train
restructure** (tags, GitHub Issues, 4 roles). This session produced the first, reviewed the second,
and corrected both.

## Current status

- **Build/test:** docs-only throughout. No product code was written. `check-backlog-pointers`,
  `check-doc-links` and `check-doc-index-size` were run clean before every push.
- **Device-verified:** N/A — nothing in this work reaches the device.
- **NOT exercised:** no `pnpm dev` run, no tests, no device pass. Every production figure below is
  a **read-only** query over the `claude_ro` views, which are **row-scoped to the owner** — so every
  count is "the owner's", never "the system's".
- **Freeze is in force** (peer session, owner-approved 2026-10-05). No new work started.

## What shipped

| PR | What |
|---|---|
| #2032 | Orchestration review: every lane stopped 2026-10-01; four approved PRs had decayed |
| #2034 | Stopped Lane A deploying a migration under a live device sitting |
| #2035 | Split `RV-65`/`PS-28`/`PS-36` — the three briefs owed turned out to be mis-gated |
| #2037 | DV's six queue corrections (**open**) |
| #2039 | Trimmed `LA-173`'s Ask — `TN-56` was answered and merged five days earlier |
| #2045 | `OR-213` filed with the measurement |
| #2047 | `OR-214` connector framework; the owner's three answers |
| #2048 | `OR-215` score basis |
| #2051 | [`docs/architecture/ingest-and-scoring.md`](../architecture/ingest-and-scoring.md) draft v1 |
| — | Revisions to the release-train spec on this branch (session model, local/cloud, decisions 9/11/12/13) |

## Key decisions (with rationale)

- **Canonical resolution is finest-available per source, tagged** — never resampled on arrival.
  Downsampling later is reversible; discarding is not, and a 5-minute bin dressed as 1 s is a
  number the app would trust more than it should.
- **Which source wins an interval is decided by rank**, reusing the existing ranked per-field
  health-write merge. **The loser is kept**, so the ranking stays revisitable.
- **Store `(score, coverage)`, never a pre-shrunk score.** See the identity below — this is the
  single most load-bearing decision in the architecture.
- **Permanent roles, bounded context** (owner, reversing "one task, one session"). What costs money
  is context held at turn time, not session lifetime. **Compact before going idle, not when full.**
- **Local vs cloud is a hardware test**: needs the phone/USB/Docker/APK → local; reads production
  and writes issues → cloud. No judgement call left in it.
- **The ingest architecture waits for the workflow, except its Phase 0** — it is five phases of
  multi-sitting work, and the model that would carry it is the one being replaced.

## The coverage identity — the result worth not re-deriving

The owner proposed giving a missing signal a **neutral default** so a new device visibly moves the
score. The code instead **excludes absent contributors and renormalises**
(`renormalisedContributors`, `packages/shared/src/health/score-audit/`). **These are the same
number.** With weights `wᵢ` summing to 1, present set `P`, coverage `C = Σ_P wᵢ`:

- renormalised `R = (Σ wᵢsᵢ) / C`
- neutral-imputed `N = Σ wᵢsᵢ + ν(1 − C)`
- therefore **`N = R·C + ν·(1 − C)`**

So the neutral default **is** the renormalised score shrunk toward `ν` by the missing weight.
**Store `R` and `C`; `N` is free at render.** The reverse fails — `R` is not recoverable from `N`,
and storing `N` fixes one `ν` that cannot change without re-scoring history.

**Do not impute at the storage layer.** `TN-57`/`TN-58`: *"a neutral stored as though it were an
answer is the defect TN-57 just fixed"*; `Q-499`: a card that cannot tell "no data" from "the fetch
failed". Coverage keeps that distinction; imputation destroys it.

## Measurements taken (production, read-only, 2026-09-29 → 10-05)

| What | Figure |
|---|---|
| Database total | 263 MB · raw/sample **182 MB (73.3%)** · ops+logs 54 MB (21.8%) · **calculated 12 MB (4.9%)** |
| Implied by the architecture | ~263 MB → **~12 MB per user, about 22×** |
| `oura_raw_packed` | 28 MB · 1.8 M frames · **the only re-decodable copy** |
| Growth | +2 MB in 5 days (**0.4 MB/day**) — retires `OR-203`'s 4.8 MB/day alarm |
| Faults | **zero** non-`bf110` events in 7 days; 137 of 143 rows are `bf110` instrumentation |
| `rr_intervals` | nothing since 2026-09-28 — **explained**: the owner has not worn the strap |
| Lane B | **0 READY** against 113 entries, 83 of them `Keep:` owed a device look |

## Deliberately NOT done

- **No product code, no storage move, no normaliser built.** The spec says explicitly not to move
  storage before the source contract exists, or the ambiguity is relocated rather than removed.
- **The 525 entries were not re-cut** against the architecture. Another session's triage
  ([`2026-10-05-backlog-triage.csv`](../superpowers/specs/2026-10-05-backlog-triage.csv)) covers
  them; what is owed is a **re-check against the architecture spec, not a re-triage**.
- **`CLAUDE.md` and the GitHub structure untouched** — they encode rules that follow from the spec.
- **The signal catalogue is not written.** It should be seeded from the five existing integrations
  plus Health Connect's record types, not invented.

## Gotchas / what did NOT work

- **I was wrong twice, and both corrections are in the docs rather than only here.**
  **(a)** I advised triaging *after* the architecture spec; the objection assumed a per-entry
  migration, and the triage **folds** its big buckets (148 device rows → 12 area issues), so the
  rework I predicted could not happen. **(b)** I told the owner most of the 34 owner-gated entries
  were probably not his; reading six in full found **five correctly gated**. The baton carries both.
- **A gate names one item and parks the whole entry** — six examined, five split. But the inverse is
  also true (five of six correctly gated), so **split, never bulk-ungate**.
- **A recorded ✅ owner decision inside an entry says nothing about whether its gate is stale** — the
  gate usually names a *different* question. This cost a reverted edit on `PS-41`.
- **`next-item.js` and `parseEntries` disagree** about what counts as a field: a backticked
  `Gate: owner` in prose parked `LB-53` in one and not the other (`OR-212`). It **resolves itself**
  when those scripts retire under the restructure — worth closing rather than fixing.
- **Auto-merge does not resolve conflicts.** Four approved PRs decayed to `dirty` while unwatched.
- **The backlog conflict is usually two deletions, but not always** — one here was two *insertions*
  at the same queue head, where keeping both sides is correct. Read the headings before choosing.

## Files to look at

- `docs/architecture/ingest-and-scoring.md` — the four layers, D1–D5, the coverage identity, phasing.
- `docs/superpowers/specs/2026-10-05-release-train-design.md` — the restructure; §5 (session model),
  §9 + §9.1 (decisions, including the two I corrected).
- `docs/superpowers/specs/2026-10-05-backlog-triage.csv` — what the Phase 3 migration will create.
- `packages/shared/src/health/score-audit/contributors.ts` — `renormalisedContributors`, the function
  the coverage identity is derived against.
- `lib/data/postgres/slices/oura-raw-pack.ts` — `HOT_WINDOW_DS = 7 days`, already the owner's
  proposed retention; the work is relocating it to the device.

## Open questions / blockers

- **Owner actions, none started:** mint fresh S3 keys (the `AWS_*` secret does not match its key id,
  and `AWS_*` **wins** over `STORAGE_*`, so adding a correct second set changes nothing); supply the
  `.constants.json` set; the `PS-44` strap week; `TN-33`'s sleep ratings.
- **#1499** (auth, read-only pivot) is the only PR genuinely held for the owner. Its Build is red at
  the test-typecheck gate.
- **Where the raw archive lives** once past tuning — the owner's own machine is the stated interim
  and is not a multi-user answer.
- **Upload cadence** — *"instantly"* × N users against a `max: 10` pool that `CLAUDE.md` marks
  load-bearing. Must be batched and bounded per user.
- **Ops/logs are 54 MB (21.8%) and do not shrink** under this architecture; they are shared rather
  than per-user and need their own retention decision.
- **`OR-213` is typed as a single `chore` issue in the triage CSV.** A five-phase programme cannot
  live in one issue — it needs a milestone or an epic, and the CSV is what the migration reads.

## Pickup prompt

```
You are the Orchestrator on the TrainingAI repo (nekodas-neko/TrainingAi_Open).

Check out `neko/adoring-ritchie-pnfwwj`. Read in this order:
1. docs/handoffs/handoff-2026-10-05-platform-orchestrator-architecture-and-restructure.md
2. docs/superpowers/specs/2026-10-05-release-train-design.md — the restructure that is being adopted
3. docs/superpowers/specs/2026-10-05-backlog-triage.md and its .csv — what Phase 3 will create
4. docs/architecture/ingest-and-scoring.md — the parallel architecture change

A FREEZE is in force (owner-approved 2026-10-05): start no new work, file no new backlog
entries, open no new PRs except to land what is in flight. The backlog file is being replaced
by GitHub Issues, so do not add entries to it.

First concrete action: work through the release-train spec's Phase 1 with the owner, and fix the
one gap already identified — the triage CSV types OR-213 as a single `chore` issue, but it is a
five-phase programme and needs a milestone or an epic with the phases beneath it. The CSV is the
input to the Phase 3 migration, so it must be right before that runs.

Constraints that are otherwise re-discovered:
- Every `claude_ro` view is row-scoped to the owner. A zero means "none of the owner's".
- Auto-merge waits for checks, not for conflicts; an unwatched approved PR decays to `dirty`.
- A `Gate: owner` usually names one item while parking a whole entry — split, never bulk-ungate.
  But five of six examined were correctly gated, so read the entry, not just the field.
- Do not move storage before the source contract exists, and do not drop the server raw archive
  before a restore from the local copy is PROVEN. It is the only re-decodable copy and the ring's
  buffer only moves forward.
- Open PRs: #2055 (restructure adoption), #2037 (DV corrections), #2040, #1499 (auth, owner-held).
```

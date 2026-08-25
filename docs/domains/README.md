# Domain Map — the 11 pillars, and where each one's knowledge lives

This folder is the **per-pillar entry point** to the documentation. If you are about to work on
one area of the app — the readiness card, the sleep score, the step pipeline, the workout
prescription engine — read that pillar's index first. It gathers, in one place: what the pillar
owns, where its code lives, every reference doc written about it, its open known issues, its
backlog items, and the handoffs and reviews that already covered it.

It exists because the documentation is otherwise organised by **document type** (plans, specs,
reviews, journal entries, handoffs) rather than by subject, so knowledge about one pillar is
spread across a dozen folders and ~800 files. The type-based folders stay as they are; these
indexes are the subject-based view over them.

## The 11 domains

| Slug | Owns | Does **not** own |
|---|---|---|
| [`sleep`](sleep/README.md) | Sleep sessions, stages/hypnogram, Sleep Score, naps vs nights, sleep timing/anchors, breathing during sleep (BDI) | The readiness score computed *from* sleep → `readiness` |
| [`readiness`](readiness/README.md) | Readiness composite, Body Battery, stress & resilience, chronic stress, temperature deviation, illness radar, recovery bands | The sleep metrics it consumes → `sleep`; HRV capture → `heart-rate` |
| [`heart-rate`](heart-rate/README.md) | Live HR, HR zones, max-HR resolution, HRV/RHR as metrics, per-set HR, HR-recovery profiles | The radios that produce HR → `devices`; zone-based run pacing → `cardio` |
| [`cardio`](cardio/README.md) | Runs and walks as sessions, GPS/pace/elevation, cadence & gait, VO₂max, training stress (TSS/OTS), cardio tests, running prescription, guided walk | Daily step totals → `activity` |
| [`activity`](activity/README.md) | Daily step counts and the step pipeline, Activity Score, daily movement totals, activity auto-detection | A detected run/walk once it becomes a session → `cardio` |
| [`workouts`](workouts/README.md) | Programs, sessions, exercises, set logging, PRs/1RM, the prescription engine, Exercise Readiness, deload, phase tracking | Cardio sessions → `cardio` |
| [`nutrition`](nutrition/README.md) | Food logs, macros, saved meals, food search/scan, supplements and their reminders | — |
| [`body`](body/README.md) | Body weight, body composition, weigh-in handling | The scale radio itself → `devices` |
| [`devices`](devices/README.md) | Oura direct-BLE pipeline and protocol, on-device Oura models, Polar H10, Renpho scale, Health Connect, native plugins and foreground services | Interpretation of what they measure → the health pillars |
| [`app-shell`](app-shell/README.md) | Home layout, tab shell and navigation, screen transitions, UI primitives/theme, safe-area, perceived performance and paint | Server/data performance → `platform` |
| [`platform`](platform/README.md) | Offline sync/outbox, local store, Postgres/migrations, auth & security, AI infrastructure, notifications transport, admin surfaces, CI and deps | Any one pillar's feature logic |

## Routing rules — when a topic could sit in two places

1. **Capture vs meaning.** The thing that reads a sensor belongs to `devices`; the thing that
   interprets the reading belongs to the health pillar. "The ring's step counter under-reports"
   is `devices`; "the Activity Score is wrong" is `activity`.
2. **Session vs daily total.** A discrete run/walk is `cardio`. A whole-day movement figure is
   `activity`.
3. **Score vs input.** A score belongs to the pillar that *publishes* it, not the pillars that
   feed it. Readiness consumes sleep and HRV but is `readiness`.
4. **Feature vs infrastructure.** If the bug would exist for every domain equally (sync wedged,
   cache missed, migration drift), it is `platform`.
5. **Still genuinely two?** Tag both, primary first. Multi-tagging is normal and expected —
   about a fifth of the known issues carry two tags.

## The `[domain]` tag convention

Domain tags are written as bracketed slugs and are **greppable** — that is the whole point.

- **`projectOverview.md` Known Issues** — every `###` heading carries its tags:
  `### [sleep][devices] 🟠 Sleep/HRV/breathing metrics changed scale at the BLE re-key`.
  To get every issue for a pillar: `grep -n '^### .*\[sleep\]' projectOverview.md`.
- **Handoff docs** — the domain is in the filename:
  `docs/handoff-YYYY-MM-DD-<domain>-<title>.md`. To get every sleep handoff:
  `ls docs/handoff-*-sleep-*.md`. A handoff spanning several pillars uses its **primary**
  domain in the filename and lists the rest in the doc header.
- **`cross`** is the escape hatch for genuinely app-wide items (a full-app review, the
  "recently resolved" roll-up). Use it sparingly — three items carry it today.

## Adding to a pillar

- **New reference doc for a pillar** → link it from that pillar's index in the same PR. The
  index is only useful while it is complete.
- **New pillar-specific finding** → a `projectOverview.md` Known-Issues row with the domain tag
  (per CLAUDE.md's "No orphaned findings"), or a backlog entry.
- **New shared module** → still gets its `docs/module-map.md` row; the pillar index points at
  module-map rather than restating it, so there is one authority for "where does this live".
- **Do not copy content into an index.** These files are maps. A map that restates the
  territory drifts from it.

## Global docs — not owned by any one pillar

`projectOverview.md` (status + known issues) · [`docs/module-map.md`](../module-map.md) (what
exists and where) · [`docs/implementation-backlog.md`](../implementation-backlog.md) (the queue)
· [`docs/planned_upgrades.md`](../planned_upgrades.md) (open ideas) ·
[`docs/device-smoke-checklist.md`](../device-smoke-checklist.md) (the on-device merge gate) ·
[`docs/owner-action-required.md`](../owner-action-required.md) ·
[`docs/public-launch-checklist.md`](../public-launch-checklist.md) ·
[`docs/overview/entries/`](../overview/entries/) (session journal) ·
[`docs/runbooks/`](../runbooks/) (ops).

## Two moves that were considered and decided against (Q-27, 2026-08-04)

The owner delegated the call — *"your decision. I don't read docs — so if it's better for you then
go for it"* — and the answer to both was no. Recorded here rather than in the queue, because this is
where someone would arrive before re-proposing either.

**Moving the ~25 loose `docs/` root reference docs into their pillar folders — no.** The problem it
solves is already solved by this file and the eleven indexes it points at: they carry **55 links** to
those exact documents, which *is* the subject-based view the migration was meant to create. Moving
the files breaks all 55, plus every reference in `CLAUDE.md`, `projectOverview.md` and the backlog,
to buy physical colocation that nothing navigates by. `oura-ble-operations.md` alone is referenced
from `CLAUDE.md`, several plans, a skill and multiple journal entries.

**Splitting `projectOverview.md`'s Known Issues into per-pillar files — no.** That file is what a
fresh session reads first to orient. Splitting it means rewriting the orientation convention in
`CLAUDE.md` and every agent prompt so a session knows to read eleven files instead of one, and the
`[domain]` tags on each heading already make the per-pillar view a `grep` away
(`grep -n '^### .*\[sleep\]' projectOverview.md`).

**What did ship, and is the reason either move would now be survivable:**
`scripts/check-doc-links.js` (2026-07-30) walks every `.md` under `docs/` plus the three root docs
and fails on any relative link that doesn't resolve. It strips fenced and inline code first — a
regex literal or a quoted markdown example reads exactly like `[text](path)` otherwise, and both
occur in this repo's review docs. It found 42 broken links beyond the 16 an ad hoc pre-check had
caught. So a botched rewrite is now caught immediately; the decision above is about value, not risk.

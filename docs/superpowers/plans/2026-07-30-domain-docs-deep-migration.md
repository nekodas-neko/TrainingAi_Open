# Plan — finish the per-domain documentation migration

**Written:** 2026-07-30. **Status:** partly done in the PR that added this plan; the rest is queued
as backlog **Q-27**.

**Shipped in that PR:** the taxonomy, the eleven pillar indexes, `[domain]` tags on every
`projectOverview.md` Known-Issues heading (166) **and** every heading in
`docs/implementation-backlog.md` (16), and the domain segment in handoff filenames.

**Task 1 below (tag the backlog) is therefore DONE.** It was written as deferred work when the
backlog was 3,056 lines with ~60 queue items; a parallel session compacted it to 460 lines with 16
headings mid-PR, which turned a large mechanical pass into a ten-minute one, so it was folded in
rather than queued. The method it describes is retained because Tasks 2–3 should reuse it.

This plan covers what remains.

## Why this remains

The pillar indexes answer "what do we know about sleep?" by *pointing* at material that still lives
in type-based folders. That is a genuine improvement and it cost no link breakage — but three things
still make an agent work harder than it should:

1. **The Known Issues section is one 2,700-line list.** Tags make it greppable, which was the
   point, but `grep` returns headings, not context. An agent working on `readiness` still reads a
   file where 94% of the content is about other pillars, and the file is edited by nearly every PR,
   so it is also the project's most conflict-prone doc.
2. **The ~25 loose reference docs at `docs/` root are unsorted.** `sleep-system.md`,
   `body-battery-tuning.md`, `gait-movement-domain.md`, the six `oura-ble-*.md` files and the rest
   sit in one flat directory. The indexes link them, so they are findable — but the directory itself
   teaches an agent nothing about which pillar owns what.
3. **No CI check protects any of it.** Every pointer in the indexes is a relative link, and nothing
   fails a build when one rots. The ad-hoc checker written for the shipping PR found 16 long-dead
   links in the backlog on its first run.

## Tasks, in the order they should be done

### Task 1 — tag the backlog ✅ DONE in the shipping PR (method retained for Tasks 2–3)

All 16 headings in `docs/implementation-backlog.md` now carry `[domain]` tags, so
`grep -n '\[sleep\]' docs/implementation-backlog.md` answers "what backlog work is queued for
sleep". The convention is documented at the top of that file.

**The method, for reuse:** extract the headings, classify them by hand into an explicit
line-number → tags table, apply with a script that **asserts** every target line is a heading and is
not already tagged (so it fails loudly rather than double-tagging or shifting), then verify
per-domain counts and grep for any heading left untagged. Initiative sections (`## ▶ …`) each carry
one dominant domain — tag the `##` heading, and tag nested items only where they diverge from their
parent.

### Task 2 — sort the loose reference docs into their pillars

Move the pillar-owned reference docs to `docs/domains/<pillar>/`, leaving genuinely global docs
(`module-map.md`, `implementation-backlog.md`, `planned_upgrades.md`, `device-smoke-checklist.md`,
`owner-action-required.md`, `public-launch-checklist.md`, `data-quality-review-charter.md`) at
`docs/` root.

Proposed mapping — confirm against the indexes before moving:

| Doc | Destination |
|---|---|
| `sleep-system.md`, `oura-ble-sleep-staging-findings.md` | `domains/sleep/` |
| `body-battery-tuning.md` | `domains/readiness/` |
| `gait-movement-domain.md` | `domains/cardio/` |
| `prescription-intensity-matrix.md` | `domains/workouts/` |
| `oura-ble-operations.md`, `oura-ble-feature-playbook.md`, `oura-ble-remaining-work.md`, `oura-ble-open-oura-audit-*.md`, `oura-ring-data-reference.md`, `oura-models-*.md`, `oura-on-device-handover.md`, `oura-ondevice-hybrid-*.md` | `domains/devices/` |
| `app-responsiveness-investigation.md` | `domains/app-shell/` |
| `db-volume-cleanup-handover.md` | `domains/platform/` |

**This is the risky task and it must be done with `git mv` plus a link sweep in the same commit.**
`oura-ble-operations.md` alone is referenced from `CLAUDE.md`, several plans, the `oura-native-ble`
skill and multiple journal entries. Method:

1. `git mv` one doc at a time.
2. `grep -rn '<old-basename>' --include='*.md' --include='*.ts' --include='*.tsx' .` and rewrite
   every hit, including relative-path depth changes (`../` → `../../`).
3. Re-run the grep and confirm zero stale references before committing.
4. A CI-time link check would make this safe to repeat — consider adding one first (Task 4).

Judgement call worth making explicitly: **doing nothing here is defensible.** The indexes already
make these docs findable, and moving them buys tidiness at the cost of a large link-rewriting diff.
Do Task 1 regardless; treat Task 2 as optional and only worth it if the flat `docs/` root is
actively causing confusion.

### Task 3 — split the Known Issues per pillar (only if Task 1 doesn't relieve the pain)

Move each Known-Issues entry into `docs/domains/<pillar>/known-issues.md`, leaving
`projectOverview.md` with per-domain counts and links.

Do **not** start this without deciding two things:

- **Where does a two-domain entry live?** Duplicating it means two copies that drift; picking the
  primary means the secondary pillar's file is incomplete. The workable answer is: the entry lives
  in its primary pillar's file, and the secondary pillar's file carries a one-line stub with a link.
  That is more machinery than it sounds.
- **How do parallel PRs not conflict?** Splitting one hot file into eleven warm ones genuinely
  reduces conflicts, which is an argument *for* doing it — but the migration commit itself will
  conflict with anything in flight, so it needs a quiet window.

The tagged status quo may well be good enough. Re-read the pain before paying this cost.

### Task 4 — a docs link check in CI (makes Tasks 2 and 3 safe)

A script that walks every `.md` under `docs/` and the repo root, extracts relative links, and fails
on any that do not resolve. Add it to the Custom Rules check. ~50 lines; it pays for itself the
first time a doc moves, and it would have caught the dead `HANDOFF.md` pointer in the
context-usage hook before that was found by hand.

**Do this before Task 2**, not after.

## What "done" looks like

- `grep '\[sleep\]' docs/implementation-backlog.md` returns every sleep queue item (Task 1).
- Every pillar index shows real backlog counts rather than a bare grep command (Task 1).
- CI fails on a broken relative link in any doc (Task 4).
- Tasks 2 and 3 are explicitly optional and each has a written go/no-go decision recorded in the
  backlog entry rather than being silently skipped.

## Constraints inherited from the shipped work

- The eleven slugs are fixed: `sleep`, `readiness`, `heart-rate`, `cardio`, `activity`, `workouts`,
  `nutrition`, `body`, `devices`, `app-shell`, `platform`, plus `cross`. Adding a twelfth means
  re-tagging, so don't — the routing rules in `docs/domains/README.md` exist to absorb edge cases
  instead.
- Tag format is `[primary][secondary]` immediately after `### `, primary first.
- The indexes are **maps, not content** — a migration must not turn an index into a copy of the
  material it points at.

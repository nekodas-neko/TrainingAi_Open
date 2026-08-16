---
name: find-skills
description: Route a task to the right skill, slash command, or doc before starting work — and find gaps where a skill should exist but does not. Use at the start of any non-trivial task, when unsure which skill applies, when the user asks "is there a skill for this", "what skills do we have", "which docs should I read for X", or when about to hand-roll a procedure that might already be captured somewhere.
version: 1.0.0
---

# Find Skills

Skills only pay off if they fire. This repo carries eleven local skills, five slash commands, a
domain index, a module map and a backlog — and the default failure is not a missing skill, it is a
present skill nobody invoked.

**Run this before starting a non-trivial task, not after getting stuck.**

## Routing table — task to entry point

Match the task, then read or invoke the entry point *before* touching code.

| Task | Entry point |
|---|---|
| Starting any session | `projectOverview.md` (always first), then the pillar index |
| Working in one area of the app | `docs/domains/<pillar>/README.md` |
| Building a new feature or shared helper | `docs/module-map.md` — check what already exists |
| Designing or reviewing UI | **`ui-ux-pro-max`** skill |
| Greenfield mobile mockups and flows | `mobile-app-ui-design` skill |
| iOS/Android platform conventions | `mobile-app-design-standards` skill |
| A vague or under-specified request | **`grill-me`** skill — resolve decisions before building |
| Anything creative or new-behaviour | `/brainstorming` |
| Turning a spec into a plan | `/writing-plans` → writes to `docs/superpowers/plans/` |
| Executing a written plan | `/executing-plans` |
| Any bug, test failure, or surprise | **`/systematic-debugging`** — before proposing a fix |
| About to claim something works | **`/verification-before-completion`** |
| Writing any prose the repo ships | **`stop-slop`** skill |
| Session wrapping up | **`handoff`** skill, then `task-observer` |
| Capturing what the session learned | `task-observer` skill |
| Oura Cloud API, endpoints, OAuth, webhooks | `oura-api` skill |
| Direct-BLE ring work, protocol, decoders | `oura-native-ble` skill + `docs/oura-ble-operations.md` |
| Polar H10, chest strap, PMD/ECG, RR intervals | `polar-h10-ble` skill |
| Reviewing your own working diff | `/code-review` |
| Reviewing a GitHub PR | `/review` |
| Security review of branch changes | `/security-review` |
| Quality cleanup of changed code | `/simplify` |
| Charts, graphs, dashboards | `dataviz` skill |
| Creating or improving a skill | `skill-creator` skill |
| Hooks, permissions, settings.json | `update-config` skill |
| Claude/Anthropic API, model ids, pricing | `claude-api` skill |
| Recurring/interval task | `/loop` |

## Local skills — `.claude/skills/`

Committed to the repo, so they are present in every ephemeral session. This is the important
property: **a user-level plugin install does not survive the container.** If a skill matters to this
project, it belongs here, in the repo, not in a personal install.

- `find-skills` — this router.
- `grill-me` — interrogate a plan one question at a time until every open decision is resolved.
- `handoff` — write `docs/handoff-YYYY-MM-DD-<domain>-<title>.md` so the next session starts cold.
- `mobile-app-design-standards` — platform-level iOS/Android convention reference.
- `mobile-app-ui-design` — greenfield mobile screens, flows, mockups.
- `oura-api` — full Oura v2 Cloud API spec.
- `oura-native-ble` — reverse-engineered direct-BLE protocol for the Ring 5.
- `polar-h10-ble` — Polar H10 HR service, PMD/ECG streaming, RR intervals.
- `stop-slop` — strip AI writing tells from docs, PR bodies, commit messages, UI copy.
- `task-observer` — convert session lessons into rules, backlog entries and CI checks.
- `ui-ux-pro-max` — design and audit UI against this app's own system, S25 APK as the target.

Slash commands in `.claude/commands/`: `/brainstorming`, `/executing-plans`,
`/systematic-debugging`, `/verification-before-completion`, `/writing-plans`.

Environment-provided skills (`dataviz`, `skill-creator`, `update-config`, `claude-api`, `simplify`,
`pdf`, `docx`, `xlsx`, `pptx`, and others) come from the harness, not the repo. They may vary
between sessions — check the available-skills list rather than assuming one is present.

## Docs routing — the bigger win

Most "is there a skill for this" questions are really "where is this written down". This repo's docs
are organised by *document type*, so knowledge about one subject is scattered. Two indexes fix that:

- **`docs/domains/<pillar>/README.md`** is the subject-based view: what the pillar owns, where its
  code lives, every reference doc, its open Known Issues, and the handoffs and reviews that already
  covered it. Pillars: `sleep` · `readiness` · `heart-rate` · `cardio` · `activity` · `workouts` ·
  `nutrition` · `body` · `devices` · `app-shell` · `platform`.
- **`docs/module-map.md`** is the "what infrastructure already exists" index — dates, cache, sync,
  repository, auth, formulas, AI, notifications, UI primitives, and how scheduled work is done
  (there is no cron layer; see its §0).

Domain tags are greppable on purpose:

```bash
grep -n '^### .*\[sleep\]' projectOverview.md   # open issues for a pillar
ls docs/handoff-*-sleep-*.md                     # every handoff for a pillar
ls docs/superpowers/plans/                       # queued and past plans
```

## Finding a skill for an unfamiliar task

1. **Grep the local skills first** — the answer is usually already committed:
   ```bash
   grep -rli '<keyword>' .claude/skills/ .claude/commands/
   ```
2. **Check the docs indexes** — `docs/module-map.md` and `docs/domains/README.md`.
3. **Check the harness skill list** for an environment-provided skill.
4. Only then consider that no skill covers it.

## When no skill covers it

Two occurrences of the same multi-step procedure is the threshold for writing one. One occurrence is
just a task — resist building a skill for it.

If the bar is met, use the `skill-creator` skill and put the result in `.claude/skills/`, committed.
Then add a row to the routing table above in the same PR, or the new skill will not fire either.

Before writing one from scratch, check whether it already exists upstream —
[anthropics/skills](https://github.com/anthropics/skills) and the community marketplaces carry a lot.
**Adapt rather than vendor verbatim.** A generic skill that contradicts CLAUDE.md is worse than no
skill: `ui-ux-pro-max` upstream ships a 161-palette database that would recommend hex literals this
repo's CI and conventions reject, which is why the local version keeps its rule structure and drops
its palette database.

## Gap signals

Note these for `task-observer` rather than acting on them immediately:

- A procedure re-derived from scratch that a previous session clearly also did.
- A skill that exists but was not invoked — a description problem, not a content problem. Fix the
  `description` frontmatter so it names the trigger phrases a user would actually type.
- A rule in CLAUDE.md that keeps being violated. If it is grep-able, it wants to be a CI check in
  `.github/workflows/ci.yml` or `scripts/check-*.js`, not more prose.

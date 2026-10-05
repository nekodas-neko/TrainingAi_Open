# Handoff — 2026-10-05 · Review sweeps 54–64: security, AI-to-logic, and the device design loop

_Domain: `platform` (also touches `app-shell`, `nutrition`, `workouts`, `sleep`, `devices`) ·
Branch: `review/close-sweeps-54-64-session` (docs-only, this closing commit) · PR: this one; every
earlier PR is merged._

> **Read first:**
> 1. `projectOverview.md`;
> 2. `docs/agents/state/review.md` (the Review baton, current to this close);
> 3. `docs/implementation-backlog.md` (`node scripts/next-item.js --lane DV` for RV-220).
>
> This file covers only what this session did and left behind.

## Goal

This was the standing **📖 Review Agent** session, from 2026-09-23 to 26, closed on 2026-10-05. It
swept the app on the owner's briefs, filed findings as `RV-` entries routed to the lane that builds
them, and set up a device-screenshot loop with the Device Verification (DV) agent. Review writes no
product code.

## Current status

- **Every PR is merged.** The last were #1686 (sweep 63), #1707 (sweep 64), #1709 (routing) and
  this closing PR.
- **No routines or check-ins belong to this session.** It owns no worktrees or open branches.
- **Gates on each PR:** `pnpm check:rules` passed (79/79 at the last count), the script tests passed
  (416), and `check-backlog-pointers` was OK.
- **Device-verified:** only what DV ran in sweeps 4a/4b. Review never touched the phone.

## What shipped (all docs-only)

| Sweep | PR | What |
|---|---|---|
| 55–58 | earlier | Device-verification debt, production census, the rules and performance pass. RV-180 (clock sort) and others shipped through the lanes. |
| 59 | #1559 | Queue re-read against code. **DV-14 root-caused:** the Railway build ran out of memory, with Sentry's webpack wrapper as the driver. RV-188 got deploys working again (#1564). |
| 60 | #1561 | Security and privacy: RV-190 to RV-199. The local-DB repro showed that one query could change the admin query endpoint's pooled-session settings. Kept free of exploit detail because the repo is public. |
| 61 | #1657 | AI to logic: RV-200 to RV-204. The owner's 30-day usage was 121 calls and about 235k tokens, which is cents, so the case rests on offline use and correctness. |
| 62 | #1667, #1680 | DV probe checklist Parts D and E (P23–P41), RV-205 and RV-206, and the private-Artifact screenshot channel. |
| 63 | #1686 | A design review from 69 web screenshots plus a static audit of 559 files: RV-207 to RV-215. |
| 64 | #1707 | DV's device gallery read: RV-216 to RV-220, plus corrections to sweep 63. |
| close | #1709, this PR | RV-221 (owner items for the Orchestrator), RV-220 made the single DV pass, and the baton rewritten. |

Write-ups are in `docs/reviews/2026-09-24-sweep-55…` through `2026-09-26-sweep-64-…`, with journal
entries in `docs/overview/entries/`, some since folded.

## Status of what this session filed (re-read 2026-10-05)

- **Shipped:**
  - security: RV-190, 192, 193, 194, 195, 197;
  - RV-201;
  - RV-207 (5 of 7; the rest went to LB-162 and a Lane O mockup);
  - RV-213 to RV-217, and RV-219;
  - RV-221 (answered).
- **Still queued:**
  - security: RV-191, RV-196, RV-198 (remainder);
  - AI to logic: RV-200 (part), 202, 203, 204;
  - design: RV-208, 209, 210, 211, 212, 218;
  - DV: **RV-220**.

## Deliberately NOT done

- **No product code**, by role.
- **No production probes for security.** Mechanisms were proven on the local DB only.
- **P33 (reach) was not filed.** Moving segment tabs is a layout change with weak upside.
- **Ambient "meteor" animations were not filed as a defect.** Only the hidden-tab half is a defect,
  and it is on RV-220's list.

## Key decisions (with rationale)

- **Screenshots travel by private Artifact, never the repo.** The repo is public. The owner
  narrowed DV's "no images off-machine" rule for this channel only.
- **Run a web screenshot pass first, and let the phone correct it.** It found real bugs cheaply.
  The device then overturned two of its readings, so a web-only visual finding is a DV target,
  not a fact.
- **Owner questions are `Lane: O` entries with an `Ask:` line, never chat lines.** RV-221 is the
  model.
- **Structural calls are Review's to make** (owner, 2026-09-22). His calls are data destruction,
  money, auth and secrets, scoring calibration, and product preference.

## Gotchas / what did NOT work

- **The doc-size check no longer tracks the backlog (#1666).** A conflict script that recreated
  `implementation-backlog.md.size` blanked a history note before it was caught.
  **Resolve backlog conflicts by reading the markers:** keep `main`'s deletions and both sides'
  additions.
- **DV galleries can lie quietly.** Byte-identical captures mean the scroll never moved. One Health
  set was the phone's launcher. Check sizes before reading.
- **`claude_ro` views omit some columns,** `feedback_submissions.screenshot_data` among them, and
  `;` in a regex trips db-query's single-statement guard.

## Files to look at

- `docs/agents/state/review.md` — the baton: state, method notes, how screenshots reach Review.
- `docs/device-agent-probe-checklist.md` Parts D–E — the probes DV runs for Review.
- RV-220 in `docs/implementation-backlog.md` — the next DV pass and its five steps.

## Open questions / blockers

None for this role. The next sweep starts on the owner's brief, or when RV-220's gallery lands.

## Pickup prompt

```
You are the 📖 Review Agent on TrainingAI. Title the session `📖 Review Agent 🟢`.
Check out `main` (git fetch --unshallow origin; confirm .git/shallow is absent).
Read in order: projectOverview.md → docs/agents/state/review.md (your baton) →
docs/handoffs/handoff-2026-10-05-platform-review-sweeps-54-64.md.
First action: run the session-start production reads in CLAUDE.md (error_events, DB size), then
`node scripts/next-item.js --lane DV --all` and read RV-220. If its Result line carries a gallery
URL, read the gallery with the Artifact tool (`read`, then `paths` for images) and check for
byte-identical captures before trusting it. File findings as RV- entries from the next free ID
(grep rule in the baton; ignore RV-999).
Otherwise wait for the owner's review brief, and do not start a sweep unprompted.
Constraints: docs-only PRs; never commit images (public repo); security entries carry no exploit
steps; never probe production; owner questions become `Lane: O` entries with an `Ask:` line;
backlog is not size-tracked; merge by attempting `merge_pull_request` and re-arming a send_later
check-in on refusal.
```

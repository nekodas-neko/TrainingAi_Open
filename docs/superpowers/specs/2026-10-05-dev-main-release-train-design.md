# Dev → Main release train: how we work from here (proposal)

**Status:** proposal, written 2026-10-05. **Nothing in this file is live yet.** The decisions that
are yours are in §9; everything else is a recommendation an agent can carry out once you say go.

---

## TL;DR

1. **Two long-lived branches.** `main` is production and the only thing Railway deploys. `dev` is
   where all agent work lands and gets tested locally. You promote `dev` → `main` **once a week**
   through one release PR, and you merge that PR yourself. Urgent fixes take a `hotfix/*` branch
   straight to `main`.
2. **GitHub Issues replace `docs/implementation-backlog.md`.** One issue per piece of work, labels
   for type and area, a **milestone per weekly release**. You choose what goes in a release by
   putting issues in its milestone. That choice is where your control comes back.
3. **Four agent roles instead of seven.** The Orchestrator takes over Tuning, Review and release
   prep. BugFix keeps intake. One local implementer, which can run Docker and drive the phone,
   does the building and the release testing. Device Verification becomes a mode of that local
   agent.
4. **Sessions become short and disposable.** State lives in GitHub (issues, PRs, milestones), not in
   batons, journals and a 2.7 MB backlog. So a session starts, reads about 6k tokens of rules plus
   one issue, does the work, opens a PR and ends. No 4-hourly routines and no 2–3 minute check-ins.
5. **CI keeps running on PRs into `dev`, but nobody watches it.** On a public repo, Actions minutes
   cost nothing. What CI costs here is agent tokens spent polling, rebasing and babysitting.
   Auto-merge into `dev` removes that cost. The heavy, slow jobs move to the weekly release PR.
6. **Do it in six phases, starting with a freeze.** Your friend's three steps are Phases 0 and 1.

---

## 1. Where things stand (measured 2026-10-05)

| What | Number | Source |
|---|---|---|
| Commits to `main` since 1 Sep | **1,266** in 35 days, peak **113** on 28 Sep | `git log` |
| …of which docs-only | **519 (41%)**, and each one still triggered a Railway deploy | `git log --name-only` |
| Activity since 1 Oct | ~0. Every lane stopped (recorded in #2032 / OR-207) | `git log` |
| App version | `1.486.11`, so 486 minor bumps. `changelog.ts` is **718 KB** | `package.json` |
| Backlog | **523 entries**, 2.7 MB of markdown | `next-item.js --all` |
| …actually startable | READY **143** (Lane A 40 · **Lane B 0** · O 63 · DV 17 · T 23) | ″ |
| …shipped, only a residue owed | KEEP **171** + VERIFY **49** (45 of them a device look) | ″ |
| …parked | **121**: ~70 waiting on another entry, 28 on the device, 25 on you | ″ |
| …reference docs posing as entries | **36** | ″ |
| Open PRs | **5**: #2037, #1849, #1790, #1762, #1499 | GitHub |
| Branches besides `main` | **52**, of which **47 have no open PR** | GitHub |
| Open GitHub issues | **0** | GitHub |
| Routines firing into this repo | Lane A check every 4 h, Lane B check every 4 h, inbound-GitHub watch daily | `list_triggers` |

**Reading done before an agent writes a line of code** (a Lane B session, for example):

| File | Size |
|---|---|
| `CLAUDE.md` | 121 KB |
| `docs/agents/README.md` | 54 KB |
| Lane B baton (`docs/agents/state/implementation-lane-b.md`) | 61 KB (Tuning's is 65 KB) |
| `projectOverview.md` | 18 KB |
| Role prompt | 8 KB |
| **Total** | **≈262 KB ≈ 65,000 tokens** |

Every subagent also gets `CLAUDE.md`, so it pays the 30k-token share again.

### What it actually costs, honestly

- **GitHub Actions: close to nothing in money.** The repo is public, and standard runners are free
  on public repos. "CI on every PR" is not a bill. It costs time, plus the tokens agents spend
  waiting for CI, polling it, and rebasing when `main` moves underneath them (every ~8 minutes at
  peak).
- **Railway: one deploy per merge.** That was 1,266 deploys in 35 days, 519 of them for markdown.
  Each deploy restarts production and runs migrations on cold start. RV-188 (22 merges that never
  deployed) is what that churn looks like. I don't know whether your Railway plan bills build time;
  your usage page will say. The stability cost is real either way.
- **Tokens: the biggest cost by a distance.** It comes from four places: the 65k-token reading list,
  long-running sessions that resend a huge context every turn (cached tokens are cheaper, not free),
  12 routine resumes a day, and the per-PR paperwork. Every PR edits 5–7 shared files (backlog,
  journal entry, `projectOverview.md`, changelog, `package.json`, baton, doc-size baseline). Those
  shared edits are what made conflicts nearly guaranteed, and conflicts cost more CI and more
  tokens.

---

## 2. How development teams actually run this

| Model | Who uses it | How it works | Fits here? |
|---|---|---|---|
| **Trunk-based + continuous deploy** | Most web SaaS, Google | Every merge ships, risky work hides behind feature flags, very strong automated tests | This is roughly what you have now, minus the flags. It is the model you're leaving. |
| **GitFlow** | Older enterprise, versioned products | `develop` + `main` + `release/*` + `hotfix/*` + `feature/*` | Release branches are ceremony one owner doesn't need |
| **Release train** (light GitFlow) | **Most mobile app teams** | Work merges continuously into an integration branch *with CI*. A release is cut on a schedule, tested as a whole, then promoted. Hotfixes bypass the train. | **Yes.** One production, one owner, a weekly rhythm, device testing |

**Recommendation: the release train**, with `dev` as the integration branch and no `release/*`
branches.

One thing real teams almost never do is **skip CI on PRs into the integration branch.** If you do,
`dev` breaks quietly, and the weekly release turns up a pile of failures nobody can attribute. That
is the classic GitFlow pain ("integration hell"). Teams make CI *cheap* instead: path filters, cached
installs, auto-merge, and nobody sitting watching it.

You already run a lighter version of this on another project: a short rules file, issues as the work
channel, and a local agent that picks up issues and acts on reviews. This proposal brings
TrainingAI closer to that.

---

## 3. The pipeline

### 3.1 Branches

```
 feature branches                      dev (default branch)                main (production)
 fix/… feat/… chore/…  ──PR, squash──▶  integration, tested    ──weekly──▶  Railway deploys
                         (auto-merge     locally + on the phone   release    only this
                          when CI green)                          PR, merge
                                                                  commit,
                                                                  YOU merge
 hotfix/…  (cut from main) ─────────────────────PR, you merge─────────────▶ main
                              ◀──────────────── back-merge PR (merge commit) ──┘
```

- **`dev` becomes the default branch.** New PRs target it without anyone remembering to.
  `Closes #N` closes the issue when the PR lands in `dev`. Cloud sessions clone it. The nightly
  scheduled test run follows it automatically, because schedules run on the default branch.
  Dependabot gets `target-branch: dev`.
- **Feature PRs into `dev` squash** (one commit per change, as today).
- **The release PR `dev → main` uses a merge commit, never squash.** Squashing it would give `main`
  a commit `dev` doesn't have, and every later release PR would re-show or conflict on old work.
  This means the `ProtectMain` ruleset must **allow merge commits**. Today it allows squash only.
- **Hotfix:** branch from `main`, PR into `main`, you merge it, then a back-merge PR `main → dev`
  (merge commit) so `dev` doesn't lose the fix.

### 3.2 What runs where

| Event | Jobs | Required to merge? |
|---|---|---|
| PR into `dev` | Lint · Custom Rules · Build (includes type check) · Tests (4 shards) · Migration Check | Yes, then auto-merge |
| PR into `dev` that touches only docs | Every heavy job **skips itself** (`if:` on a changes-detection job) | Skipped counts as passing |
| Nightly, on `dev` | Full Tests (the existing schedule moves to `dev` by itself) | n/a. Red means `dev` is broken |
| Release PR `dev → main` | Everything above + **E2E** + **Release source** check + Android build if native paths changed | Yes, and **you** press merge |
| Push to `main` | Deploy check (existing) · tag + GitHub Release (new) · APK publish if native (existing) | n/a |
| PR into `main` from anything except `dev` or `hotfix/*` | **Release source** check fails | Blocks it |

Two details that matter:

- **Skip docs with a job-level `if:`, never a workflow-level `paths:` filter.** When a whole workflow
  is skipped, its required checks sit at "Expected" forever and the PR can never merge, which is why
  `ci.yml` runs on docs today. A *job* skipped by `if:` reports success.
- **A PR opened by a GitHub Action using `GITHUB_TOKEN` does not trigger CI.** So the release PR
  is opened by the Orchestrator (through the GitHub tools, which act as your account) or by you
  with one click on "Compare & pull request". It is not opened by a scheduled workflow.

### 3.3 The weekly release

1. **During the week**, agents merge into `dev`. Each merged PR carries `Closes #N`, so its issue
   closes and stays in the milestone.
2. **Release prep** (Orchestrator, on the day you pick):
   - Runs the three production reads. Today those run at every session start; they move here.
   - Opens one small PR into `dev` that bumps the version once (minor for a release, patch for a
     hotfix) and writes the single changelog entry, generated from the milestone's merged PR
     titles.
   - Opens the release PR `dev → main`. Its body is a checklist: what's in it, grouped by type;
     **⚠ needs your eyes** (migrations, anything dropping data, auth/session/security, secrets);
     device checks owed; known risks.
3. **Release test** (local agent): checks out `dev`, runs the full suite against a local Postgres,
   restores a recent production snapshot locally if the release carries migrations, runs `pnpm dev`
   through the changed flows, and does the device pass (§3.6). It writes VERIFIED / FAILED /
   COULD NOT CHECK on the release PR.
4. **You** read the release PR, take a verified production snapshot if it carries a migration, and
   press merge. Railway deploys once.
5. **After merge**, a workflow tags `vX.Y.Z` and creates the GitHub Release with the notes. The
   Orchestrator closes the milestone and opens the next one.

**What this does to the "confirm before merging" carve-out.** Today a data-dropping migration or an
auth change has to stop and ask before it merges, because merging *is* deploying. Once `dev` is not
production, those can merge into `dev` on green CI like anything else. The question moves to the
release PR, which is the one place you look each week. One review point instead of a scatter of
"[owner confirm]" PRs going stale (#1849 and #1499 have been waiting since September).

### 3.4 Hotfix (production is broken now)

- Only for a bug in production that can't wait for the train. The `hotfix` label marks it.
- Branch from `main`, keep the fix minimal, open a PR to `main`. Full CI runs. **You merge it.**
- The same agent then opens the back-merge PR `main → dev` with a merge commit.
- No version-bump PR in advance: the post-merge workflow tags a patch release.

### 3.5 Railway

- Confirm the production service deploys from **`main` by name**, not "the default branch". This
  must be checked **before** `dev` becomes the default branch.
- Turn on **Wait for CI**, so Railway deploys only after `main`'s checks pass.
- Optional: **watch paths**, so a hotfix touching only docs doesn't deploy. Less important once
  `main` only takes releases.
- **No staging environment needed.** `dev` is tested on your machine. A Railway staging service
  deployed from `dev` is the alternative if you ever want to test untethered from the laptop. It
  would mean a second service and database running all the time.

### 3.6 Testing `dev` locally, including on the phone

**The server half is ready now.** The local agent runs `pnpm dev` against Docker Postgres on `dev`.
The suite, the custom rules and the `claude_ro` tests all run there today.

**The phone half needs one piece of engineering.** The APK's WebView loads production
(`capacitor.config.ts` → `server.url`). So to run `dev` code on the phone:

- **Recommended: a second app, "TrainingAi Dev"**, built as an Android product flavor with
  `applicationIdSuffix ".dev"`. Its server URL is the laptop, reached over USB with
  `adb reverse tcp:3000 tcp:3000`. Because it has its own app ID it **installs beside the real app
  and never replaces it**. It has its own local SQLite and its own login against the local database.
  The driver in `scripts/device/` drives it the same way. This is a Lane A job (Gradle and Capacitor
  config, then an APK cycle) and is Phase 2's only native work.
- **What it can't test:** the Oura ring and the scale are paired to the real app, so BLE changes
  still get their device check on production after release. That is a short, named list in the
  release PR, not a gap anyone has to discover.
- **Until that flavor exists**, device checks happen on production right after each release, and a
  failure becomes a hotfix. That's no worse than today, where every merge is a release.

> **⛔ Never point the real app at a `dev` server.** You could do it by navigating its WebView over
> DevTools, or by building it with another URL. The real app's local store is the source of truth,
> and its outbox would push your real unsynced writes to the laptop's database. Those writes would
> be acknowledged and dropped there, and never reach production. Separately, **never install
> anything over the real app or uninstall it**: that destroys the ring key, which can't be
> recovered. The `.dev` app ID is what makes both mistakes impossible.

---

## 4. GitHub Issues replace the backlog file

### 4.1 The structure

| GitHub feature | Replaces | Notes |
|---|---|---|
| **Issue** | A backlog entry | Title in plain words. Body: what was seen, the code path, what would prove it fixed. The issue number replaces the letter IDs (`LA-`, `BF-`, `RV-`…), so there's no more ID allocation, collision checking or `entry-id.js` |
| **Milestone** `Release YYYY-MM-DD` | Queue position + "what's next" | **You pick a release's contents by adding issues to its milestone.** Agents build only what's in the open milestone |
| `type:` labels: `bug` `feature` `chore` `tuning` `question` `device-check` | Entry kinds, `Lane: T`, `Lane: DV` | Also group the release notes (`.github/release.yml`) |
| `area:` labels: the 11 pillars | `[sleep]`-style tags | Same pillars as `docs/domains/` |
| `needs: owner` · `needs: device` · `blocked` | `Gate: owner` · `Gate: device` · `Needs:` | Write "Blocked by #N" in the body. Phased work (BF-199 → b → c) becomes **sub-issues** |
| `lane: engine` · `lane: surface` | `Lane: A` · `Lane: B` | Only matters when two implementers run at once |
| `hotfix` | n/a | Marks the train-bypass path |
| Linked **draft PR** | "Claimed" in a baton | An agent opens a draft PR with `Closes #N` when it starts, and the issue page shows it |
| **Issue templates** (`.github/ISSUE_TEMPLATE/`) | Entry-format rules in `CLAUDE.md` | Bug · feature · owner question · device check · tuning proposal |
| **PR template** | Journal entries | What changed, why, how it was tested (local / device / not device-verified), migration yes/no |
| **GitHub Release** | `docs/overview/entries/` + per-PR changelog | One set of notes per release, generated from merged PRs |

A Projects board is optional and for your eyes only. The GitHub tools the agents use can't read
Projects, so agents stay on labels and milestones. Milestone filtering goes through `search_issues`
(`milestone:"Release 2026-10-12"`). Both are supported today.

### 4.2 Your control points

1. **What gets built:** you add issues to the milestone. Agents may suggest something for the next
   release in a comment. They don't add to the milestone themselves.
2. **What you're asked:** a `type: question` issue with the decision brief already written
   (recommendation first, as `CLAUDE.md` asks today). You answer in a comment and close it.
   Questions then live in one filterable list, not in queue position 15 of lane O.
3. **What ships:** the release PR, merged by you.
4. **Anything urgent:** you label it `hotfix`.

### 4.3 What happens to the 523 entries

Not a bulk copy. Most of the file isn't open work.

| Today | Count | Becomes |
|---|---|---|
| READY | 143 | Triaged. The live ones become issues, stale ones are noted and archived |
| PARKED: waiting on another entry | ~70 | Issues with "Blocked by #N", or sub-issues of their parent |
| PARKED / WAITING: on you | 25 + 2 | `type: question` issues, one each, with the brief. Many are probably stale; the triage says which |
| PARKED: on the device | 28 | Folded into device-check issues grouped by area (one per sitting, not one per row) |
| VERIFY (shipped, look owed) | 49 | The same device-check issues; 4 are yours to look at |
| KEEP (shipped, residue owed) | 171 | Triaged: a real follow-up becomes an issue, a device look joins a device-check issue, a "watch it later" becomes one tracking issue or is dropped |
| REFERENCE | 36 | Moved into `docs/` as reference material, since they aren't work |

**How:** the Orchestrator writes a triage table (one row per entry: migrate / fold / archive) and you
skim it. Then a **one-off GitHub Action** (manual trigger, with a dry-run option) reads the existing
parser's output and creates the issues and labels. That costs no agent tokens per issue. The
markdown file is then frozen as `docs/archive/implementation-backlog-2026-10.md`, and
`next-item.js`, `check-backlog-pointers.js` and `entry-id.js` retire.

---

## 5. The agents after the change

| Role | Where | Model | What it does | Replaces |
|---|---|---|---|---|
| **Orchestrator** | Cloud, prompted | Sonnet | Release prep and release PR · production reads · triage of new issues · owner questions written as issues · **Review mode** ("sweep nutrition") · **Tuning mode** (calibration proposals) | Orchestrator, Review, Tuning |
| **BugFix** | Cloud, prompted | Sonnet | Your reports, in-app feedback, inbound GitHub issues and PRs → well-traced issues. **May fix small, local bugs straight into `dev`** (recommended, §9) | BugFix |
| **Implementer** | **Local** (Docker + phone) | Opus | Builds issues from the open milestone, tests locally, opens PRs to `dev` with auto-merge on | Lane A, Lane B |
| ↳ **Release-test mode** | Local | Opus | Runs the release test (§3.3 step 3), including the device pass | Device Verification |

Optional: a second, cloud implementer for parallel work. The `lane:` labels keep the two out of
each other's files.

**Session model: one task, one session.** A session gets an issue number, reads the lean rules and
that issue, does the work, opens a PR and ends. Nothing needs carrying over, because the issue, the
PR and the milestone hold the state. That retires batons, handoffs-as-routine, the "one continuous
session per role" policy and the 4-hourly routines. It's cheaper per turn, too: a long-running
session resends its whole accumulated context every turn, and a fresh one starts at a few thousand
tokens.

---

## 6. What gets cut, and the token budget

| Item | Today | After |
|---|---|---|
| `CLAUDE.md` | 121 KB, mostly incident history | **≤15 KB**: the rules as one-liners, each pointing to the doc and the CI check that enforces it. The ~100 CI steps already enforce most rules, so prose doesn't have to |
| `docs/agents/README.md` + 8 prompts + 8 batons | ~330 KB | One short roles page + 4 prompts of ~2 KB each, **no batons** |
| Reading before work | ≈65k tokens | **≈6–8k tokens** (lean rules + the issue) |
| Per-PR paperwork | backlog edit, journal entry, `projectOverview.md`, version bump, changelog entry, baton rewrite, doc-size baseline | **The PR description.** Version and changelog once per release. `projectOverview.md` updated at release only |
| Production reads | Every session start | Once per release (Orchestrator) |
| Routines into this repo | 12 resumes a day + daily watch | **None.** You prompt the agents. Optionally one daily inbound-GitHub check |
| CI monitoring | 2–3-minute self check-ins, merge-queue babysitting | **Auto-merge into `dev`, then the session ends.** A red PR gets picked up next session |
| Process-only CI checks | backlog pointers, doc-index size baselines, journal runaway limit | Retired with the files they police. Code-rule checks all stay |
| Shared lines every PR edits | 5–7 files | ~0, so concurrent PRs mostly stop conflicting |

---

## 7. Safety: what's enforced and what's only agreed

**The constraint to know first: every agent acts as your GitHub account (`nekodas-neko`).** GitHub
can't tell agent from owner, so "only the owner may merge to `main`" **can't be enforced by
identity** with today's setup. The protection is layered instead:

| Layer | Stops | Enforced by |
|---|---|---|
| `dev` as default branch | Accidental PRs to `main` | GitHub, structurally |
| **Release source** required check | Any PR into `main` from a branch other than `dev` or `hotfix/*` | GitHub ruleset |
| `ProtectMain`: full CI required, no force-push, no deletion | A red or rewritten `main` | GitHub ruleset (Active since 2026-09-25) |
| `ProtectDev`: PR required, fast CI required, no force-push, no deletion | A broken `dev` | GitHub ruleset (new) |
| A `PreToolUse` hook in `.claude/settings.json` | An agent opening a PR to `main` from a feature branch, or calling `merge_pull_request` on a PR whose base is `main` (the hook looks the base up, and refuses if it can't) | Claude Code, in every session that loads this repo |
| Rule in the lean `CLAUDE.md` | An agent merging the release PR | Instruction only |
| *Optional, later:* a separate GitHub account for agents | Everything above, by identity | GitHub. Then `main` can require your approval for real |

**Batched migrations are the new risk** a weekly release adds: several schema changes reach
production in one deploy. Mitigations: the release PR lists every migration under "⚠ needs your
eyes". The release test runs them against a restored production snapshot locally. You take a
verified snapshot before merging. A data-dropping migration ships in a release with nothing else
risky in it.

**Bigger releases are harder to bisect.** Each PR in `dev` stays a single squashed commit, so a bad
release can still be bisected on `dev`. A hotfix covers the urgent case.

**The freeze is reversible.** Pausing routines and telling sessions to stand down deletes nothing.

---

## 8. Rollout

Each phase ends with something you can check. Phases 2–4 land together before anything is
unfrozen, so no agent ends up following half the old rules and half the new.

### Phase 0: Freeze and wrap up (your friend's step 1)

- **You:** pause the **Lane A** and **Lane B 4-hourly routines** and the daily **inbound GitHub
  watch**. Leave the Gmail sweep and the other project's review watch alone; they aren't this repo.
- **You, or an agent with your OK:** tell every live standing session to file nothing new and finish
  or park what's in flight. Someone opened #2037 today, so at least one session is still active.
- **The five open PRs**, each decided rather than left to decay:
  - #2037 (DV queue corrections, docs): merge if green, or close. Migration will supersede it.
  - #1849 (drop four dead columns, data-dropping): your call. Merge as-is under the old rules, or
    hold it for the first release.
  - #1499 (read-only endpoint scoped to a feedback filer, auth): your call, same choice.
  - #1790, #1762 (queue-routing docs): close as superseded by the move to issues.
- **Delete the 47 branches with no open PR.** Under your 2026-09-26 rule they're sweepable, and an
  agent diffs each against `main` first, per the "never trust a name match" rule.
- **Done when:** no routine fires into this repo, no PR is left without a decision, and only branches
  with an open PR remain.

### Phase 1: The state, and what's blocked (your friend's steps 2 and 3)

- **Orchestrator:** writes the triage table for all 523 entries (§4.3) and a one-page list of
  everything **planned but blocked**, grouped by what unblocks it: you, the device, another piece of
  work, or "stale, drop it". Appendix A below is the starting list.
- **You:** skim the triage. Answer or drop the owner questions; most should be quick or obsolete.
- **Done when:** every entry has a migrate / fold / archive verdict you've seen.

### Phase 2: GitHub and CI plumbing

- **You, in GitHub settings** (agents can't change rulesets or repo settings):
  1. Check `ProtectMain` targets `main` **by name**. If it targets "default branch", change it
     first, or switching the default branch moves protection off production.
  2. Check Railway deploys from `main` by name, and turn on **Wait for CI**.
  3. Create `dev` from `main`. Add a `ProtectDev` ruleset: PR required, required checks, squash and
     merge-commit allowed (merge commits are for back-merges), no force-push, no deletion.
  4. On `ProtectMain`, allow **merge commits**, and later add **Release source** as a required check.
  5. Set the default branch to `dev`.
- **Agent, one PR into `dev`:** `ci.yml` (triggers on `dev` and `main`, docs-skip via job `if:`, E2E
  on release PRs, Release-source job), a post-release tag-and-Release workflow,
  `.github/release.yml`, issue templates, PR template, a labels file plus a sync workflow,
  `dependabot.yml` → `target-branch: dev`, the `PreToolUse` hook, and the `.dev` Android flavor
  (native, so it needs an APK cycle).
- **Done when:** a throwaway PR into `dev` runs the fast checks and auto-merges; a docs-only PR
  skips the heavy jobs and still merges; a PR from a feature branch to `main` is blocked.

### Phase 3: Backlog to issues

- **Agent:** the one-off migration Action, run in dry-run mode first. You glance at the dry-run
  output, then it runs for real. Freeze the markdown file into `docs/archive/`.
- **Done when:** the open milestone holds the issues you picked for the first release, and no agent
  instruction mentions `implementation-backlog.md`.

### Phase 4: Rewrite the rules (one PR, you read it)

- Lean `CLAUDE.md` (≤15 KB), a short roles page, four short prompts, and the docs moved out of the
  hot path: incident history goes to `docs/`, batons, journal-entry folder and doc-size baselines are
  retired. Every code rule (timezone, cache groups, offline-first, migrations + `claude_ro`, Oura
  BLE, AI output, security, write-path ownership) stays, as a one-liner with its pointer.
- This is the constitution, so **you read this PR**, even though it's docs.
- **Done when:** a fresh session given only "work issue #N" finds everything it needs.

### Phase 5: First release, then a retro

- Run one week on the new flow. The Orchestrator preps the first release, the local agent tests it,
  you merge it.
- After it lands: what was slow, what you had to chase, what token use looked like. Adjust.

---

## 9. Decisions for you

Each comes with a recommendation. Anything not listed here is structural and an agent decides it.

1. **Release day and cadence.** *Recommend:* weekly, prepped on the day before you want it live, so
   the local test and device pass have a day. Hotfixes any time. *Alternative:* every two weeks,
   which means fewer deploys but bigger, riskier releases. *Reversal cost:* none, it's a calendar
   choice.
2. **CI on PRs into `dev`.** *Recommend:* keep it, on auto-merge. It costs nothing on a public repo,
   and it's the only check that doesn't depend on an agent's word. *Alternative:* local checks only
   on `dev` PRs, with CI only on the release PR. That saves CI time, but a broken `dev` surfaces
   once a week as a pile. *Reversal cost:* one workflow edit.
3. **`dev` as the default branch.** *Recommend:* yes, for the reasons in §3.1. *Alternative:* keep
   `main` as default. Then every agent must remember to target `dev`, and issues don't auto-close.
   *Reversal cost:* one setting.
4. **Roles 7 → 4** (§5). *Recommend:* yes, including **BugFix fixing small bugs directly into
   `dev`**. A one-line fix today costs an intake session, an entry, and an implementer session, and
   `dev` isn't production. *Alternative:* keep BugFix as intake-only. *Reversal cost:* a prompt
   edit.
5. **Device testing of `dev`.** *Recommend:* the `.dev` side-by-side app over USB (free, tethered).
   *Alternatives:* a Railway staging environment (untethered, costs a second service and database),
   or no pre-release device test (verify on production, hotfix if needed). *Reversal cost:* low.
   Building the flavor doesn't commit you to using it.
6. **Backlog migration scope.** *Recommend:* triage first and migrate only live work (§4.3).
   *Alternative:* migrate all 523 and close later. That's faster to start, but it floods the issue
   list with 220 shipped-residue rows. *Reversal cost:* issues can be closed in bulk.
7. **Release PR merge rights.** *Recommend:* you merge, every time. Agents prepare, test and open it.
   *Alternative:* the Orchestrator merges after your 👍 comment, which is less clicking and less
   control. *Reversal cost:* a rule edit.

---

## Appendix A: planned work that's blocked (starting list for Phase 1)

**Waiting on you right now (2):** LA-173 (five things Lane A needs: fresh S3 storage keys in Railway
plus merge yeses), OR-115 (keep / hide / delete the unused admin cards).

**Open PRs held for your confirmation (2):** #1849 (drops four dead columns, data-dropping), #1499
(read-only endpoint scope, auth).

**Parked on an owner decision (25):** OR-170, TN-70, LB-172, RV-65, TN-41, PS-41, PS-44, PS-45,
PS-46, LB-157, TN-33, LA-95, PS-28, LA-71, PS-36, BF-106, TN-2, LB-53, Q-551 (stay on Railway or
leave), Q-513, Q-250, Q-49, Q-1a, Q-1b, Q-30. Several are old Q-numbers and probably stale. The
triage confirms which.

**Lane O, READY (63):** mostly orchestration chores and owner questions. Questions near the top
include LA-180 (one calorie number), LA-185 (how the ring shows an assumed meal), LA-178 (the
session-length estimate), LB-152 (the accent-token retune) and LB-167 (does the meal tile read as a
failed image).

**Owed a device look (45 VERIFY + 28 parked + 17 DV READY):** this is what unblocks Lane B
entirely. It has 0 startable entries; 31 of its rows are shipped work waiting on a look, and 47 more
are shipped with some residue. It becomes a few device-check issues grouped by area, worked in the
first release test.

**Waiting on other entries (~70):** chains such as BF-203a → b → c and BF-199 → b → c. They become
sub-issues.

## Appendix B: what's running now

| Routine | Schedule | Phase 0 |
|---|---|---|
| Lane A queue check (silent) | every 4 h | Pause |
| Lane B queue check (silent) | every 4 h | Pause |
| Inbound GitHub watch (not ours) | daily 08:56 AEST | Pause until Phase 3, then point at issues or drop |
| Weekly Gmail inbox sweep | weekly | Not this repo, leave alone |
| The other project's PR review watch | daily | Not this repo, leave alone |

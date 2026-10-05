# Release train: how we work from here

**Status:** **agreed 2026-10-05.** The owner answered every decision (§9) the same day, and Phase 0
(the freeze) started that day. Phases 1–5 are not live yet. Revised the same day to release from
**tags** rather than a second branch (§3.1 says why).

---

## TL;DR

1. **Merging to `main` stops deploying.** `main` remains the one branch everyone works on, and CI
   still runs on every PR. Production changes only when **you approve a release**: a version tag
   such as `v1.487.0`, placed on the exact commit that was tested locally. Roughly once a week, plus
   hotfixes. Rolling back means redeploying the previous tag.
2. **GitHub Issues replace `docs/implementation-backlog.md`.** One issue per piece of work, labels
   for type and area, a **milestone per weekly release**. You choose what goes in a release by
   putting issues in its milestone. That choice is where your control comes back.
3. **Four agent roles instead of seven.** The Orchestrator takes over Tuning, Review and release
   prep. BugFix keeps intake. One local implementer, which can run Docker and drive the phone,
   does the building and the release testing. Device Verification becomes a mode of that local
   agent.
4. **Roles are permanent; contexts stay small.** The agents stay open and the Orchestrator wakes
   them from a schedule — permanence is what carries work spanning several sittings. What is
   bounded is the *context*, not the session: an agent compacts **before going idle**, so it wakes
   near 6–8k tokens rather than cold-reading whatever it was holding. State lives in GitHub
   (issues, PRs, milestones, releases), not in batons, journals and a 2.7 MB backlog. No 4-hourly
   resume routines and no 2–3 minute check-ins.
5. **CI keeps running on PRs, but nobody watches it.** On a public repo, Actions minutes cost
   nothing. What CI costs here is agent tokens spent polling and rebasing. Auto-merge removes that
   cost. The slow jobs (E2E, APK publishing) move into the release.
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

**What long-running sessions add up to.** The platform's usage figure per session (priced at API
rates) for the five cloud standing sessions alive on 2026-10-05: Lane B **$10.1k**, Orchestrator
**$10.0k**, Tuning **$9.9k**, Review **$9.8k**, BugFix **$4.8k**. That's about **$45k** between them,
each holding 430k–780k tokens of context. The Lane A session archived on 2026-09-27 reads **$10.0k**
on its own. Whatever the subscription actually bills, these figures say where the volume goes: very
long sessions resending very large contexts.

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
| **Merge = deploy** (continuous deployment) | Web SaaS with strong tests and feature flags | Every merge ships | What you have now, without the flags. The model you're leaving |
| **GitFlow** | Older enterprise, versioned products | `develop` + `main` + `release/*` + `hotfix/*` | Two long-lived branches to keep in sync. More ceremony than one owner needs |
| **Trunk + release tags** | Most modern teams, many mobile apps | Everyone merges to one branch with CI. A release is a tag on a tested commit, and only tags deploy. Hotfixes branch from the last tag | **Yes.** It gives the same weekly rhythm with less machinery |

**Recommendation: trunk + release tags.** It's a release train without a second branch.

One thing real teams almost never do is **skip CI on the PRs into the shared branch.** If you do,
it breaks quietly and the weekly release turns up a pile of failures nobody can attribute. Teams
make CI *cheap* instead: path filters, cached installs, auto-merge, and nobody sitting watching it.

You already run a lighter version of this on another project: a short rules file, issues as the work
channel, and a local agent that picks up issues and acts on reviews. This proposal brings
TrainingAI closer to that.

---

## 3. The pipeline

### 3.1 One branch, releases as tags

```
 feature branches                     main (default)                        production (Railway)
 fix/… feat/… chore/…  ──PR, squash──▶  every agent PR lands here  ──release──▶  runs ONLY a released
                         (auto-merge     merging deploys NOTHING     vX.Y.Z on    commit, and only
                          when CI green) tested locally + on phone   the tested   after you say
                                                                     commit       "approve" to the
                                                                                  Orchestrator
```

**Why tags rather than a `dev` branch.** This was decided on your friend's suggestion, and it wins
on every point that matters here:

| | `dev` branch | Tags (chosen) |
|---|---|---|
| Branches to keep in sync | Two, plus back-merges after every hotfix | One |
| What ships | `dev`'s head *at the moment of merging*, which may include commits that landed after the test | **The exact commit that was tested**, pinned by the tag |
| Rollback | A revert PR, then a deploy | **Redeploy the previous tag** |
| Setup | New branch, default-branch switch, merge-commit exception on `main`, a check blocking stray PRs to `main` | A release workflow and a Railway token |
| Agent rules to change | Every agent must learn to target `dev` | Agents keep targeting `main` |
| Release notes | Built by hand into a release PR | GitHub generates them from the tag |
| What it costs | n/a | `main` no longer means "what's live". The latest GitHub Release and `/api/version` tell you that instead |

### 3.2 What runs where

| Event | Jobs | Gate |
|---|---|---|
| PR into `main` | Lint · Custom Rules · Build (includes type check) · Tests (4 shards) · Migration Check | Required, then auto-merge. **Deploys nothing** |
| PR into `main` that touches only docs | Every heavy job **skips itself** (`if:` on a changes-detection job) | Skipped counts as passing |
| Nightly on `main` | Full Tests (the existing schedule) | Red means `main` is broken |
| **Release workflow** (manual trigger, given a commit and a version) | Full suite + E2E on that commit → deploys that commit to Railway → creates the tag and the GitHub Release → deploy check → publishes the APK if native code changed | Started by the Orchestrator **only after your "approve"** (§3.3) |

Two details that matter:

- **Skip docs with a job-level `if:`, never a workflow-level `paths:` filter.** When a whole workflow
  is skipped, its required checks sit at "Expected" forever and the PR can never merge, which is why
  `ci.yml` runs on docs today. A *job* skipped by `if:` reports success.
- **The release workflow starts from a button, not from a tag push.** The workflow creates the tag
  *after* the deploy succeeds, so a stray tag deploys nothing. The Orchestrator presses the button
  once you've said "approve". You can also press it yourself from the Actions tab.
- **The APK publishes at release, not on merge.** The APK loads its pages from production, so native
  code published ahead of the server it talks to is a mismatch waiting to happen.

### 3.3 The weekly release

1. **During the week**, agents merge into `main`. Each merged PR carries `Closes #N`, so its issue
   closes and stays in the milestone.
2. **Release prep** (Orchestrator, on the day you pick):
   - Runs the three production reads. Today those run at every session start; they move here.
   - Merges one small PR that bumps the version once (minor for a release, patch for a hotfix) and
     writes the single changelog entry, generated from the milestone's merged PR titles.
   - Picks the **release candidate**: the commit on `main` right after that PR.
   - Writes a **release issue** ("Release 2026-10-12") holding the checklist: the candidate commit,
     what's in it grouped by type, **⚠ needs your eyes** (migrations, anything dropping data,
     auth/session/security, secrets), device checks owed, known risks.
3. **Release test** (local agent): checks out the candidate, runs the full suite against a local
   Postgres, restores a recent production snapshot locally if the release carries migrations, runs
   `pnpm dev` through the changed flows, and does the device pass (§3.6). It writes VERIFIED /
   FAILED / COULD NOT CHECK on the release issue.
4. **The Orchestrator gives you the release summary** in its session, and posts the same text on the
   release issue. It's short enough to read on the phone, in this shape:

   > **Release v1.487.0: ready for your OK**
   > **New for you:** 2–5 plain-English lines, user-visible changes only
   > **Fixed:** one line each
   > **Behind the scenes:** one line, or "nothing worth your time"
   > **⚠ Needs your eyes:** migrations (and whether any drop data), auth/security, secrets, or "none"
   > **Tested:** suite ✓ · local run ✓ · device: N checks VERIFIED / FAILED / COULD NOT CHECK
   > **Not in this release:** anything held back, and why
   > **If it goes wrong:** roll back to v1.486.x (a migration isn't undone by a rollback, so a snapshot is taken first)

5. **You read it and reply "approve" in the Orchestrator's chat.** Only then does the Orchestrator
   take the snapshot (if there's a migration) and start the release workflow on the candidate. The
   workflow runs the slow checks and deploys to Railway once. The tag and the GitHub Release appear,
   and the deploy check confirms production serves that commit. The Orchestrator tells you when it
   has landed.
6. The Orchestrator closes the milestone and opens the next one.

Anything merged to `main` after the candidate was picked simply isn't in this release. It goes in
the next one, and nothing untested slips in.

**What this does to the "confirm before merging" carve-out.** Today a data-dropping migration or an
auth change has to stop and ask before it merges, because merging *is* deploying. Once a merge
deploys nothing, those can merge on green CI like anything else. The question moves to the release
issue, which is the one place you look each week. One review point instead of a scatter of
"[owner confirm]" PRs going stale (#1849 and #1499 have been waiting since September).

### 3.4 Hotfix (production is broken now)

- The fix merges into `main` by a normal PR, labelled `hotfix`.
- **If everything on `main` since the last release is safe to ship**, run a release now from
  `main`, with a short test.
- **If not**, branch `hotfix/v1.487.1` from the last release tag, cherry-pick the fix onto it, and run
  the release workflow on that branch's commit. Delete the branch afterwards. Nothing unreleased
  rides along.
- You approve it through the Orchestrator, with a shorter summary, like any release.

### 3.5 Railway

- **Turn off Railway's auto-deploy from `main`.** This is the single switch that makes merges stop
  reaching production. Do it *after* the release workflow has deployed once successfully.
- The release workflow deploys with the Railway CLI, using a Railway project token stored as a GitHub
  secret on the `production` environment. **You create the token**, because secrets are yours.
- If CLI deploys misbehave, there's a fallback: Railway watches a `production` branch that only the
  release workflow moves to the released commit. Nobody works on it; it's a pointer.
- **No staging environment needed.** Unreleased code is tested on your machine. A Railway staging
  service is the alternative if you ever want to test away from the laptop. It would mean a second
  service and database running all the time.

### 3.6 Testing unreleased code locally, including on the phone

**The server half is ready now.** The local agent runs `pnpm dev` against Docker Postgres. The suite,
the custom rules and the `claude_ro` tests all run there today.

**The phone half needs one piece of engineering.** The APK's WebView loads production
(`capacitor.config.ts` → `server.url`). So to run unreleased code on the phone:

- **Chosen: a second app, "TrainingAi Dev"**, built as an Android product flavor with
  `applicationIdSuffix ".dev"`. Its server URL is the laptop, reached over USB with
  `adb reverse tcp:3000 tcp:3000`. Because it has its own app ID it **installs beside the real app
  and never replaces it**. It has its own local SQLite and its own login against the local database.
  The driver in `scripts/device/` drives it the same way. Building it is Gradle and Capacitor config
  plus an APK cycle, and it's Phase 2's only native work.
- **Fully automated (owner, 2026-10-05: "as much automation as possible").** Your whole part is
  plugging the phone in. One script, run by the Implementer Agent:
  1. Fetches the latest Dev APK. CI builds it and publishes it as a rolling `apk-dev` release, so
     your machine needs no Android SDK. The script keeps a local copy and only re-downloads when CI
     has a newer one.
  2. Installs or updates the **`.dev` package only**. The script refuses any other package name, so
     it can't touch `com.trainingai.app`.
  3. Sets up `adb reverse`, starts Docker Postgres and `pnpm dev`, and signs the Dev app in with the
     local seeded test account. No Google sign-in is needed.
  4. Runs the device checks through `scripts/device/`, then posts VERIFIED / FAILED / COULD NOT
     CHECK on the release issue.

  One-off setup on the phone: USB debugging (already on for the device agent), and accepting the
  first install of the Dev app.
- **What it can't test:** the Oura ring and the scale are paired to the real app, so BLE changes
  still get their device check on production after release. That is a short, named list in the
  release issue, not a gap anyone has to discover.
- **Until that flavor exists**, device checks happen on production right after each release, and a
  failure becomes a hotfix (or a rollback to the previous tag). That's no worse than today, where
  every merge is a release.

> **⛔ Never point the real app at a local server.** You could do it by navigating its WebView over
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
| **Release issue** (one per milestone) | Release PR / handoff | The checklist you read before approving (§3.3) |
| `type:` labels: `bug` `feature` `chore` `tuning` `question` `device-check` | Entry kinds, `Lane: T`, `Lane: DV` | Also group the release notes (`.github/release.yml`) |
| `area:` labels: the 11 pillars | `[sleep]`-style tags | Same pillars as `docs/domains/` |
| `needs: owner` · `needs: device` · `blocked` | `Gate: owner` · `Gate: device` · `Needs:` | Write "Blocked by #N" in the body. Phased work (BF-199 → b → c) becomes **sub-issues** |
| `lane: engine` · `lane: surface` | `Lane: A` · `Lane: B` | Only matters when two implementers run at once |
| `hotfix` | n/a | Marks the off-schedule release path |
| Linked **draft PR** | "Claimed" in a baton | An agent opens a draft PR with `Closes #N` when it starts, and the issue page shows it |
| **Issue templates** (`.github/ISSUE_TEMPLATE/`) | Entry-format rules in `CLAUDE.md` | Bug · feature · owner question · device check · tuning proposal |
| **PR template** | Journal entries | What changed, why, how it was tested (local / device / not device-verified), migration yes/no |
| **Tag + GitHub Release** | `docs/overview/entries/` + per-PR changelog | One set of notes per release, generated from merged PRs |

A Projects board is optional and for your eyes only. The GitHub tools the agents use can't read
Projects, so agents stay on labels and milestones. Milestone filtering goes through `search_issues`
(`milestone:"Release 2026-10-12"`). Both are supported today.

### 4.2 Your control points

1. **What gets built:** you add issues to the milestone. Agents may suggest something for the next
   release in a comment. They don't add to the milestone themselves.
2. **What you're asked:** a `type: question` issue with the decision brief already written
   (recommendation first, as `CLAUDE.md` asks today). You answer in a comment and close it.
   Questions then live in one filterable list, not in queue position 15 of lane O.
3. **What ships:** the release, which reaches production only when you approve it.
4. **Anything urgent:** you label it `hotfix`. If a release goes wrong, you roll back to the previous
   tag.

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
| **Orchestrator** | Cloud, prompted | Sonnet | Release prep, release issue, **release summary for your OK**, then starting the release workflow · production reads · triage of new issues · owner questions written as issues · **Review mode** ("sweep nutrition") · **Tuning mode** (calibration proposals) | Orchestrator, Review, Tuning |
| **BugFix** | Cloud, prompted | Sonnet | Your reports, in-app feedback, inbound GitHub issues and PRs → well-traced issues. **May fix small, local bugs itself** (§9) | BugFix |
| **Implementer Agent** | **Local** (Docker + phone) | Opus | Builds issues from the open milestone, tests locally, opens PRs with auto-merge on, and runs the Dev-app automation (§3.6) | Lane A, Lane B |
| ↳ **Release-test mode** | Local | Opus | Runs the release test on the candidate (§3.3 step 3), including the device pass | Device Verification |

Optional: a second, cloud implementer for parallel work. The `lane:` labels keep the two out of
each other's files.

**Local vs Cloud is decided by hardware, not preference (owner, 2026-10-05).** An agent runs
**local** when its work needs something physically attached — the phone over USB, Docker, the real
APK. It runs **cloud** when its work is reading production and writing issues, docs and PRs. That
puts Implementer and its release-test mode local, Orchestrator and BugFix cloud, and it leaves no
judgement call: if a task needs the phone it cannot run in a container, and if it does not, a
container is the cheaper place for it.

**Session model: permanent ROLES, bounded CONTEXT — revised 2026-10-05 (owner).** An earlier draft
said "one task, one session" and treated session lifetime as the thing to control. That was the
wrong variable.

**The agents are permanent and stay open.** Each has a name, a queue and a schedule; the
Orchestrator checks what is outstanding and wakes the others. Permanence is what carries work that
spans sittings — a five-phase programme does not fit in one issue, and batons carried that badly
rather than unnecessarily.

**What actually costs money is not how long a session lives. It is how much context it is holding
when it takes a turn, and whether that context is still cached.** Two consequences, and they point
the same way:

- Compaction already bounds a long session: it does not carry 780k tokens forever, it summarises
  and drops back down. So permanence on its own is not the expense the §1 figures suggest.
- **But a scheduled agent is the one pattern where a large held context costs most.** If the wake
  interval is longer than the prompt-cache TTL, every wake is a *cold* read of whatever the session
  happens to be holding. An agent woken every four hours carrying 300k tokens pays a full 300k read
  to do ten minutes of work, and does it again four hours later.

**So the rule is: bound the context you WAKE WITH.**

| Situation | Rule |
|---|---|
| Working continuously, wake gap inside the cache TTL | Keep going. Normal compaction is enough; the cache is doing its job |
| Woken on a schedule, wake gap beyond the cache TTL — **the model above** | **Compact before going idle, not when full.** The agent finishes its task, compacts down to the lean rules plus its queue position, *then* sleeps |

The second line is the load-bearing one. Compaction triggered by *filling up* leaves an agent
asleep holding whatever it happened to have; compaction triggered by *going idle* means every wake
starts near the ≈6–8k floor in §6. Same permanence, none of the cold-read cost.

**⚠ Not yet measured.** The mechanism is sound but the numbers are not ours: the cache TTL and
what a cold wake actually costs should be measured on one real agent over a week before the
schedule intervals are fixed. The §1 figures are cumulative session usage, which is evidence about
long fat contexts, not about permanence.

**What this retires is unchanged:** batons, handoffs-as-routine, and the 4-hourly resume routines.
State still lives in the issue, the PR and the milestone — that is what makes a small wake context
sufficient.

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
| CI monitoring | 2–3-minute self check-ins, merge-queue babysitting | **Auto-merge, then the session ends.** A red PR gets picked up next session. A merge deploys nothing, so nothing is urgent |
| Process-only CI checks | backlog pointers, doc-index size baselines, journal runaway limit | Retired with the files they police. Code-rule checks all stay |
| Shared lines every PR edits | 5–7 files | ~0, so concurrent PRs mostly stop conflicting |

---

## 7. Safety: what's enforced and what's only agreed

**The constraint to know first: every agent acts as your GitHub account (`nekodas-neko`).** GitHub
can't tell agent from owner, so no GitHub setting can say "only the owner". The protection is built
around who may start a release, and around the Railway token living in exactly one place.

| Layer | Stops | Enforced by |
|---|---|---|
| Railway auto-deploy off | A merge reaching production | Railway setting |
| **Only the Orchestrator starts a release, and only after your "approve" in its chat** (owner's choice, 2026-10-05) | A deploy you haven't read about | Instruction only. Every other role's prompt says it never starts a release |
| `production` environment holding the Railway token | The token leaking into any other job. Only the release workflow's deploy job can read it | GitHub |
| *Optional hard lock:* add yourself as required reviewer on `production` | Any deploy without a tap from you in GitHub, whoever starts it | GitHub. One setting, if you ever want it |
| Tag ruleset on `v*`: no moving, no deleting | A release tag silently pointing at different code | GitHub ruleset |
| `ProtectMain`: required CI, no force-push, no deletion | A red or rewritten `main` | GitHub ruleset (Active since 2026-09-25) |
| *Optional, later:* a separate GitHub account for agents | Everything above, by identity | GitHub |

Since merges no longer deploy, the `PreToolUse` hook from the first draft isn't needed.

**Batched migrations are the new risk** a weekly release adds: several schema changes reach
production in one deploy. Mitigations: the release issue lists every migration under "⚠ needs your
eyes". The release test runs them against a restored production snapshot locally. You take a
verified snapshot before approving. A data-dropping migration ships in a release with nothing else
risky in it. **Rolling back to the previous tag does not undo a migration**, which is why the
snapshot comes first.

**Bigger releases are harder to bisect.** Each PR stays a single squashed commit on `main`, so a bad
release can still be bisected between two tags. Rollback covers the urgent case.

**The freeze is reversible.** Pausing routines and telling sessions to stand down deletes nothing.

---

## 8. Rollout

Each phase ends with something you can check. Phases 2–4 land before anything is unfrozen, so no
agent ends up following half the old rules and half the new.

### Phase 0: Freeze and wrap up (your friend's step 1)

**Progress, 2026-10-05:** ✅ the three routines paused (Lane A, Lane B, inbound GitHub watch). ✅ The
freeze message sent to all seven standing sessions; most were already wrapping up. ✅ #1790 and
#1762 closed as superseded. **Held for release 1** (owner): #1849 and #1499. **Left to its own
session to land:** #2037. **Still to do:** the branch sweep, and each session's one-line "still in
flight" reply.

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

### Phase 2: Release plumbing

- **You** (secrets and settings are yours):
  1. Create a Railway project token.
  2. In GitHub, create a `production` environment and store the token there as a secret. A required
     reviewer is optional (§7); by default approval happens in the Orchestrator's chat.
  3. Add a tag ruleset for `v*` that blocks updates and deletion.
- **Agent, one PR into `main`:**
  - the release workflow
  - the docs-skip in `ci.yml`
  - E2E, deploy check and APK publishing moved into the release
  - `.github/release.yml`
  - issue templates and a PR template
  - a labels file plus a sync workflow
  - the `.dev` Android flavor (native, so it needs an APK cycle)
- **First release, still with auto-deploy on:** run the workflow on `main`'s current commit. Railway
  deploys the same commit twice, which is harmless. This proves the token and the workflow.
- **You, then:** turn off Railway's auto-deploy from `main`.
- **Done when:**
  - a code PR merges without production changing
  - a release deploys the chosen commit only after you say "approve", then tags it and publishes notes
  - a dry-run rollback to the previous tag works

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
  you approve it in the Orchestrator's chat.
- After it lands: what was slow, what you had to chase, what token use looked like. Adjust.

---

## 9. Decisions (answered by the owner, 2026-10-05)

| # | Question | Answer | Notes |
|---|---|---|---|
| 1 | Branch or tags | **Tags on `main`** | The owner's friend's suggestion; §3.1 has the comparison |
| 2 | Release cadence | **Weekly**, hotfixes any time | Prepped the day before it goes live |
| 3 | CI on PRs | **Full CI on every PR, auto-merge, nobody watching** | The owner's concern was Railway deploys, which tags solve. Actions cost nothing on a public repo, so per-PR CI stays as the safety net. Reverting to local-only checks is one workflow edit |
| 4 | Roles | **4 roles; BugFix may fix small bugs** | The local agent is renamed **Implementer Agent** |
| 5 | Device testing before release | **Side-by-side "TrainingAi Dev" app over USB, fully automated** | §3.6. The owner's part is plugging the phone in |
| 6 | Backlog migration | **Triage first, migrate live work only** | §4.3 |
| 7 | Release approval | **The owner, through the Orchestrator**: a concise summary, then "approve" in its chat | §3.3 steps 4–5. Enforced by instruction; GitHub's required-reviewer tap is an optional hard lock (§7) |
| 8 | Bundled shell (v2) | **Later**, as its own milestone after 2–3 clean releases | §10 |
| 9 | #1849 and #1499 | ⚠ **#1849 ALREADY MERGED — corrected 2026-10-05.** #1499 still held | #1849 landed as `7574d06e75`, four commits after the PR that recorded it as held, and **merges still deploy until Phase 2, so it went to production**. Its guard meant it could not drop a value, so no harm — but the hold did not hold. #1499 (auth) is the only one genuinely waiting |
| 11 | Permanent agents vs disposable sessions | **Permanent roles, bounded context** | Reverses the earlier "one task, one session". §5 has the rule and the one thing still to measure |
| 12 | Where the ingest architecture (`OR-213`/`214`/`215`) sits | **After the workflow lands, as the first epic — except its Phase 0** | Delegated to the Orchestrator. Reasoning below |
| 13 | Backlog triage: before or after the architecture spec | **After, in one pass** | Delegated to the Orchestrator. Reasoning below |

### 9.1 Decisions 12 and 13, reasoned (Orchestrator, delegated 2026-10-05)

**The ingest architecture is a second restructure running in parallel with this one**, and neither
document referenced the other until now. This one changes *how we work*; `OR-213`/`214`/`215` and
[`docs/architecture/ingest-and-scoring.md`](../../architecture/ingest-and-scoring.md) change *how
data flows* — raw stays on the device, only scored values reach the cloud, measured at **263 MB →
~12 MB per user, about 22×**.

**#12 — the architecture waits, with one exception.** It is five phases of work spanning many
sittings. The model that would have to carry it is the one this spec is replacing, and that model
demonstrably failed: **every lane stopped on 2026-10-01 and nobody noticed for three days.**
Starting a multi-phase programme under it repeats that. So it becomes the first epic once the new
workflow is live.

**The exception is its Phase 0 — export the Oura raw archive and prove a restore — which should
run during the freeze.** It is one session, it blocks nothing, and it is the only step that cannot
be undone: `oura_raw_packed` is **28 MB / 1.8 M frames and today the only re-decodable copy**, and
the ring's buffer only moves forward, so a row deleted before a restore is proven is gone for good.
Waiting on a workflow change to protect it is the wrong risk to take.

**#13 — triage after the architecture spec, in one pass.** §4.3's two largest buckets are KEEP
(171) and the device ones (28 + 49) — **about 48% of the file** — and they are exactly what the
architecture change supersedes most of. Triaging them first means triaging them twice, which costs
more than the wait. The architecture spec is days from settled, not weeks.

| 10 | Start Phase 0 | **Yes**, started 2026-10-05 | §8 Phase 0 progress |

---

## 10. Not in this change: bundling the shell into the APK (v2)

Asked 2026-10-05: should moving the UI into the APK (Q-1a's client half plus Q-1b) ride along with
this restructure? **Recommendation: no. Do it after this, as its own v2 milestone.**

- **One big change at a time.** The shell move changes auth (a token held on the device instead of a
  cookie), how UI reaches the phone (every UI change needs an APK instead of a Railway deploy), and
  all 43 page routes; 32 UI files check auth on the server today (counted on `main` 2026-10-05,
  up from the plan's 21). Landing it during the first releases of
  a new pipeline means any failure has two suspects.
- **The measurement hasn't changed.** It buys about 0.44 s on cold open only, and you deferred it
  three times with "v2" as the trigger. None of the conditions set for reopening it has occurred:
  the app feeling slow, leaving Railway (Q-551), or offline-first-on-open.
- **This restructure makes the shell move cheaper later.** Releases already build the APK from the
  tag, so server and UI ship as one versioned unit. The `.dev` flavor already gives the app a
  configurable server URL and its own app ID. The server half of bearer auth shipped on 2026-09-18.
  And a weekly release already produces an APK, so "every UI change needs an APK" stops being a new
  cost.
- **What to do now:** during Phase 3, file it as a **v2 milestone** whose sub-issues are bearer
  client, `apiUrl()` across fetch sites, static-export split, then bundling. Each sub-issue ships on
  its own while the app still loads from Railway. Phase 4's lean rules describe "UI ships through
  Railway" as how it works today, not as a permanent rule. Start the milestone once two or three
  releases have run cleanly. That includes deciding how UI updates reach the phone: a new APK each
  release, or an over-the-air bundle.

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
| Lane A queue check (silent) | every 4 h | ✅ Paused 2026-10-05 |
| Lane B queue check (silent) | every 4 h | ✅ Paused 2026-10-05 |
| Inbound GitHub watch (not ours) | daily 08:56 AEST | ✅ Paused 2026-10-05. After Phase 3, point it at issues or drop it |
| Weekly Gmail inbox sweep | weekly | Not this repo, leave alone |
| The other project's PR review watch | daily | Not this repo, leave alone |

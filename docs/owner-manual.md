# Owner's manual — the release train

How to run TrainingAI from here: what you do once to finish the switch-over, what you do every
week after it, and what to do when something goes wrong. Written to be followed top to bottom,
not read once.

The design and the reasons behind it are in
[`superpowers/specs/2026-10-05-release-train-design.md`](superpowers/specs/2026-10-05-release-train-design.md).
This file is only the steps.

**How to read it:**
- ☐ is yours. 🤖 is the Orchestrator's, listed so you can see what the next ☐ is waiting for.
- **You should see** says what success looks like. If you see something else, stop and paste it
  into the Orchestrator's chat — the steps are ordered so that stopping is always safe.

---

## Contents

- [Part 1 — The switch-over (once)](#part-1--the-switch-over-once)
- [Part 2 — Renaming the repository (optional, once)](#part-2--renaming-the-repository-optional-once)
- [Part 3 — Bringing in a second person](#part-3--bringing-in-a-second-person)
- [Part 4 — Every week](#part-4--every-week)
- [Part 5 — When something goes wrong](#part-5--when-something-goes-wrong)
- [Part 6 — Who does what](#part-6--who-does-what)
- [Part 7 — Things still waiting on you that are not part of this](#part-7--things-still-waiting-on-you-that-are-not-part-of-this)
- [Appendix — what does NOT need doing, and why](#appendix--what-does-not-need-doing-and-why)

---

## Part 1 — The switch-over (once)

### Already done

- ✅ Railway project token, scoped to the Railway `production` environment.
- ✅ GitHub environment **`release`** holding it as **`RAILWAY_TOKEN`**, no required reviewer.
- ☐ On that same environment, an **environment variable** (not a secret) **`RAILWAY_SERVICE`** = the
  app service's name exactly as Railway shows it. The project holds several services (the app and
  its database at least), and the CLI refuses to guess which to deploy — found on the first real
  release, 2026-10-05. **Settings** → **Environments** → **release** → **Environment variables** →
  **Add variable**.
- ✅ Ruleset **`protect-release-tags`** on `v*`: restrict updates, restrict deletions. Creations open.
- ✅ Branch sweep (52 → 3, with `archive/*` tags for the three worth keeping).
- ✅ The freeze: all seven old agents wrapped up, routines paused.

### Step 1 — 🤖 The plumbing PR merges (#2057)

The release workflow, labels, issue templates, PR template, the triage marker. Nothing for you to
do. The Orchestrator tells you when it has merged.

**Merging it does NOT change how production works yet.** Railway still deploys every merge until
Step 4.

### Step 2 — ☐ Check the labels arrived (1 minute)

1. GitHub → the repository → **Issues** → **Labels**.
2. **You should see** 26 new labels alongside GitHub's defaults: six `type:`, eleven `area:`,
   `needs: triage` / `owner` / `device`, `blocked`, `agent: bugfix`, `agent: implementer`,
   `lane: engine`, `lane: surface`, `hotfix`.
3. If they are missing: **Actions** → **Sync labels** → **Run workflow** → `main` → **Run**. If that
   fails, paste the log to the Orchestrator.

GitHub's own defaults (`bug`, `enhancement`, …) stay. Don't delete them; they just go unused.

### Step 3 — ☐ The first release, with auto-deploy still on (≈10 minutes, mostly waiting)

This proves the token and the workflow while the old way is still there to fall back on. Railway
will deploy the same commit twice — once from the merge, once from here. That is harmless.

1. Ask the Orchestrator for **the version to use**. It is whatever `package.json` says on `main`
   right now; the workflow refuses if you give a different one, deliberately.
2. GitHub → **Actions** → **Release** (left sidebar) → **Run workflow** (right).
3. Fill in:
   | Field | Value |
   |---|---|
   | Use workflow from | `main` |
   | version | the number from step 1, **without** a `v` — e.g. `1.486.11` |
   | sha | leave blank |
   | rollback_to | leave blank |
   | dry_run | **tick it the first time** |
4. **Run workflow.** **You should see** only *Verify the commit is releasable* go green, and
   everything else skipped. That proves the inputs and the checks without touching production.
5. Run it again, same values, **dry_run unticked**.
6. **You should see**, in order, each going green:
   1. *Verify the commit is releasable* — seconds.
   2. *Deploy to production* — a few minutes. (It does **not** stop to wait for approval: the
      `release` environment has no required reviewer, because you approve in chat. If it ever
      says *Waiting*, someone added a reviewer in **Settings → Environments → release**.)
   3. *Production serves this commit* — up to 20 minutes allowed; measured at about 3½.
   4. *Tag and publish notes* — seconds.
   5. *Attach the APK* — about 6 minutes.
7. Check the result: **Code** → **Releases** (right sidebar). **You should see** `v<version>` with
   notes and an `app-v<version>.apk` attached.

**If *Deploy* fails:** no tag was created — that ordering is the point. Paste the log to the
Orchestrator; once fixed, re-run with the same version.

**If *Production serves this commit* fails:** production did not pick up the build within 20
minutes. Nothing was rolled back, and no tag was created. Check Railway's deploy log for the
service, then paste both to the Orchestrator.

**If *Attach the APK* fails:** the release and tag are fine; only the APK is missing. Not urgent.
Retry just that half: **Actions** → **Android** → **Run workflow** → `main`, **release_tag** =
`v<version>`. It rebuilds from the tag and attaches `app-v<version>.apk`.

**If *Tag and publish notes* fails after the tag was created:** production is already serving the
release and the tag is permanent, so only the release page is missing. **Code** → **Releases** →
**Draft a new release** → **Choose a tag** → pick the existing `v<version>` → title `v<version>` →
**Generate release notes** → **Publish release**. Then retry the APK as above. (This happened on
the very first release, 2026-10-05: with no earlier `v*` tag, GitHub tried to summarise the whole
history and refused it as too long. The workflow now names the previous tag explicitly.)

### Step 4 — ☐ Turn off Railway's auto-deploy from `main`

**Only after Step 3 is fully green.** This is the one switch that makes merges stop reaching
production.

1. railway.com → the **Training-Ai** project → the app service (the one serving the site).
2. **Settings** → find **Source** (or **Deploy** → **Triggers**, depending on Railway's current
   layout).
3. Turn off automatic deploys on push to `main`.
   **Leave the GitHub repo connected.** Disconnecting it is not needed and can break the CLI
   deploy's link to the service. Only the trigger goes.
4. ☐ **Tell the Orchestrator it's done.** Step 5 waits for that sentence.

### Step 5 — 🤖 Stop watching merges for deploys

A one-line PR that removes the deploy check's `on: push` trigger. Before Step 4 it would leave real
deploys unwatched; after Step 4 every merge would report a deploy that never happened. So it goes
exactly here.

### Step 6 — ☐ Prove it worked (≈15 minutes)

Three checks. All three should pass before Step 7 starts.

**6a. A merge no longer changes production.** The Orchestrator merges any small PR and tells you.
Open the app → **More** → the version line. **You should see** the *released* version, not the
merged one. (Or ask the Orchestrator to read `/api/version` for you.)

**6b. A release still deploys.** Repeat Step 3 for whatever has merged since (the Orchestrator
gives you the version). It should go green end to end, and this time Railway deploys only once.

**6c. A rollback works — before you ever need it in anger.**
1. **Actions** → **Release** → **Run workflow**.
2. **version** blank, **sha** blank, **rollback_to** = the release from Step 3 (e.g. `v1.486.11`).
3. **You should see** *Verify* → *Deploy* → *Production serves this commit* green, and *Tag* and
   *Attach the APK* **skipped** — a rollback redeploys a tag that already exists; it never makes a
   new one.
4. Then run 6b's release again to go forward. Production is now back on the newest release.

### Step 7 — 🤖 then ☐ Backlog → GitHub Issues (Phase 3)

1. 🤖 The Orchestrator re-runs the triage against today's backlog and runs the migration in
   **dry-run** mode. It posts what *would* be created: roughly 245 issues, grouped.
2. ☐ **Glance at the dry run** — you are checking it looks like a list of real work, not reading
   every row. Say "go" or say what's wrong.
3. 🤖 It runs for real, then moves `docs/implementation-backlog.md` into `docs/archive/`.
4. ☐ **Pick the first release's contents.** **Issues** → **Milestones** → *Release YYYY-MM-DD* →
   add the issues you want in it. Anything not in the milestone does not get built. That is the
   control point — it is how you decide what happens each week.

### Step 8 — ☐ Read the new rules before they merge (Phase 4)

The Orchestrator opens **one** PR: the short `CLAUDE.md` (≤15 KB, from 121 KB), the four-role page,
four short prompts, and `CONTRIBUTING.md` for the second person. **This is the one docs PR you
read**, because it is what every agent obeys. Comment on it, or reply in chat; the Orchestrator
merges it only after you say so.

### Step 9 — ☐ Turn the agents back on (new names)

After Step 8 merges. Start each from its prompt in `docs/agents/prompts/` (the Orchestrator gives
you the exact text). The titles below are the **proposal** Step 8's PR carries; whatever that PR
settles is what you use:

| Session title | Where you start it | When |
|---|---|---|
| `🪐 Orchestrator 🟢` | Cloud (claude.ai/code) | Already running — this one |
| `🪲 BugFix Agent 🟢` | Cloud | When there are reports to process |
| `🚧 Implementer Agent 🟢` | **Your machine**, in the local clone, phone on USB for device work | When the milestone has work in it |

The old Lane A, Lane B, Review, Tuning and Device Verification sessions **stay archived**; their
work is absorbed as described in Part 6.

The three paused routines stay paused. The only automation that comes back is the inbound-GitHub
watch (one daily check for new issues), and only once you say so.

### Step 10 — ☐ One week on the new flow, then a retro (Phase 5)

Run Part 4 for one real week. Afterwards the Orchestrator writes a short retro: what took longer
than it should have, what you were asked that you shouldn't have been, what it cost.

---

## Part 2 — Renaming the repository (optional, once)

`TrainingAi_Open` → `TrainingAi`. Safe; **do it after Part 1 Step 6 and before Step 7**, so the
issue migration creates its links under the final name.

GitHub redirects the old name for the web, the API and git. Nothing breaks at the moment of the
rename — the steps below remove the reliance on that redirect, which disappears if anything is ever
created under the old name again.

### Before

☐ **Railway** → the service → **Variables** → add `APK_RELEASE_REPO` = `nekodas-neko/TrainingAi` →
redeploy is not needed yet (it takes effect on the next release).
*Why:* the app's "update available" card looks up the newest APK by repository name
(`lib/github-release.ts:30`). It is the only place running code depends on the name, and the
variable is read before the built-in default. Setting it first means there is no window where the
two disagree — the redirect makes the new name correct even before the rename happens.

### Rename

☐ GitHub → the repository → **Settings** → **General** → *Repository name* → `TrainingAi` →
**Rename**.

### Straight after

☐ **Railway** → the service → **Settings** → **Source**. If it shows the old name or a warning,
reconnect it to `nekodas-neko/TrainingAi`. (Normally it follows the rename on its own.)

☐ **Tell the Orchestrator.** 🤖 It opens one PR updating the built-in default, the test fixtures,
the label-sync default and the ~39 docs links.

☐ **Your local clone** — do **not** delete it, and do not re-clone. In a terminal:

```bash
cd path/to/TrainingAi_Open           # wherever your local copy lives
git remote set-url origin https://github.com/nekodas-neko/TrainingAi.git
git remote -v                        # both lines should now end in TrainingAi.git
git fetch origin
git status                           # should be unchanged from before
```

Renaming the **folder** is optional — git does not care what it is called. If you do rename it:

```bash
cd ..
mv TrainingAi_Open TrainingAi
cd TrainingAi
```

…and then update anything holding the old absolute path: your editor's recent-workspace entry, any
shell alias or script pointing into it, and the device scripts' config if you set one. Claude Code
on your machine just needs to be started from the new folder.

**Why not delete and re-clone:** a fresh clone loses every local branch, stash and uncommitted
change, and buys nothing the one command above does not.

☐ **Bookmarks** — the old URLs redirect, so nothing breaks; update them at leisure.

---

## Part 3 — Bringing in a second person

Do this after Part 1 Step 8, so `CONTRIBUTING.md` exists when they arrive.

1. ☐ GitHub → **Settings** → **Collaborators** → **Add people** → their username → role **Write**.
   *Write*, not *Maintain* or *Admin*: they can push branches, open PRs and manage issues, but
   cannot change settings, rulesets or the `release` environment's token.
2. ☐ Send them the link to `CONTRIBUTING.md`. It covers how to pick up an issue, branch naming,
   what CI checks, and that **you** merge their PRs.
3. ☐ Optionally tag a few issues `good first issue`.

**Who merges what, now that there are two people:**
- **Agent PRs** → the Orchestrator merges, on green CI.
- **Their PRs** → **you** merge. Agents may review, comment and approve their PRs, never merge
  them. (Two standing rules would otherwise collide: "only the Orchestrator merges" and "never
  merge a PR we did not write". This split is how they fit together.)
- **Releases** → only ever on your "approve".

**One thing they will notice:** every agent acts through *your* GitHub account, so a review from an
agent looks like it is from you. Agent comments end with a *Generated by Claude Code* footer — that
is how to tell them apart. Mention it to them up front.

---

## Part 4 — Every week

### Asking for work

**Anything you want built or fixed → an issue.** **Issues** → **New issue** → pick *Bug*, *Feature
or change*, or *Chore*. Fill in the form; leave the labels alone. It arrives marked `needs: triage`.

Or just tell any agent in chat — it files the issue for you. Either way, the issue is the record.

**What happens next**, without you:
1. 🤖 The Orchestrator triages it: adds `area:`, `type:`, `lane:` and **`agent: bugfix`** (small,
   local, BugFix may just fix it) or **`agent: implementer`** (real work), and removes
   `needs: triage`.
2. If it is something only you can decide, it becomes a `type: question` issue with the
   recommendation written in it.
3. It waits for you to put it in a milestone (below). BugFix's small fixes are the exception —
   they can go straight in.

### Answering questions

**Issues** → filter `label:"type: question" is:open`. Each one opens with a recommendation, the
alternatives and why each lost, and what reversing it would cost. **Answer in a comment and close
it.** A one-word "yes, recommendation" is a complete answer.

### Choosing what gets built

**Issues** → **Milestones** → the open *Release YYYY-MM-DD* → add or remove issues. The Implementer
builds only what is in the open milestone. This is your steering wheel — the one place that decides
what happens next.

### Release day

1. 🤖 The Orchestrator bumps the version, picks the candidate commit, opens a **release issue**
   with the checklist, and has the Implementer run the release test (full suite, local run of the
   changed flows, the device pass).
2. 🤖 It sends you the **release summary** in chat, and posts it on the release issue:
   > **Release v1.487.0: ready for your OK**
   > **New for you:** …
   > **Fixed:** …
   > **Behind the scenes:** …
   > **⚠ Needs your eyes:** migrations (and whether any drop data), auth/security, secrets — or "none"
   > **Tested:** suite ✓ · local run ✓ · device: N VERIFIED / N FAILED / N COULD NOT CHECK
   > **Not in this release:** …
   > **If it goes wrong:** roll back to v1.486.x
3. ☐ **Read it. Reply "approve"** — or ask about anything. **Look hardest at "⚠ Needs your eyes"**:
   that line is what used to be a separate "confirm before merging" PR for every risky change,
   now collected in one place once a week.
4. 🤖 It takes a database snapshot if the release has a migration, runs the release workflow, and
   tells you when production is serving it.
5. ☐ **Update the APK only if the summary says the native app changed.** Most releases don't — the
   app loads its code from Railway, so they reach your phone on their own. When it does: **Code**
   → **Releases** → the new `v…` → download `app-v….apk` → install **over** the existing app.
   **Never uninstall first** (see Part 5).

---

## Part 5 — When something goes wrong

### Production is broken right now

1. ☐ **Roll back first, investigate second.** **Actions** → **Release** → **Run workflow** →
   **rollback_to** = the previous release (e.g. `v1.486.11`), everything else blank. Typically
   5–10 minutes: a rebuild plus the wait for production to serve it.
2. ☐ Tell the Orchestrator what you saw. It files a `hotfix` issue.
3. 🤖 The fix ships as a hotfix release: from `main` if everything merged since the last release is
   safe to ship, otherwise from a `hotfix/v…` branch cut from the last tag carrying only the fix.
   (That branch is made by the Implementer on your machine — cloud sessions can only push their own
   working branch.) You approve it like any release, with a shorter summary.

**⚠ A rollback does not undo a migration.** The code goes back; the database stays as the new
release left it. That is why a release with a migration takes a snapshot first, and why the
summary flags migrations under *Needs your eyes*. If a migration is what broke, say so — that is
a restore from the snapshot, which is confirm-first and the Orchestrator walks you through it.

### CI is broken and nothing can merge

The ruleset requires five checks, and nobody can bypass it — including you, by design. If CI
*itself* is what's broken, the fix cannot merge either.

1. ☐ **Settings** → **Rules** → **Rulesets** → **ProtectMain** → **Bypass list** → **Add bypass** →
   yourself (**Repository admin** role).
2. 🤖 The Orchestrator gives you the fix PR; **you** merge it.
3. ☐ **Remove the bypass straight away.** An exception left in place stops being an exception —
   the same ruleset once sat switched off for five weeks (17 Aug – 25 Sep) without anyone noticing.

### A check is "Expected" forever and the PR never merges

Usually a stale base, not a broken check. Tell the Orchestrator; it merges `main` into the branch
and the checks start.

### The app on the phone

- **⛔ Never uninstall the app, and never install anything that would make you uninstall it.** It
  destroys the Oura ring's pairing key, which cannot be recovered from anywhere.
- An APK that "won't install over the existing one" means it was signed with the wrong key. **Stop
  there** and tell the Orchestrator — do not uninstall to get past it.
- **Never point the real app at a local server.** Its unsynced data would be pushed to the laptop's
  database and lost. Testing unreleased code on the phone uses the separate *TrainingAi Dev* app,
  once it exists.

### A secret has leaked

Revoke it at its source first (Railway, Google, AWS), then replace it in Railway and in the
`release` environment, then tell the Orchestrator. Secrets are never committed, so the repository
itself needs nothing.

---

## Part 6 — Who does what

**Seven sessions become three, plus a mode.**

| Agent | Runs | What it does | Absorbs |
|---|---|---|---|
| **🪐 Orchestrator** | Cloud | Triages every new issue and assigns it to BugFix or the Implementer · writes your questions as issues · prepares each release and gives you the summary · runs the release on your "approve" · production reads · merges agent PRs · on request, a **review sweep** ("look over nutrition") or a **tuning proposal** | Orchestrator, Review, Tuning |
| **🪲 BugFix** | Cloud | Your reports and the in-app *Report an Issue* inbox → well-traced issues · fixes small, local bugs itself (`agent: bugfix`) | BugFix |
| **🚧 Implementer** | **Your machine** (Docker, phone on USB) | Builds issues from the open milestone · tests locally · opens PRs with auto-merge on | Lane A, Lane B |
| ↳ **release-test mode** | Your machine | Runs the release test on the candidate, including the device pass, and writes VERIFIED / FAILED / COULD NOT CHECK on the release issue | Device Verification |

**Why local vs cloud:** an agent runs on your machine only when its work needs something physically
attached there — the phone, Docker, the real APK. Everything else runs in the cloud. No judgement
call involved.

**How the Orchestrator directs the others:** through labels and milestones, never by messaging
them. A new issue arrives `needs: triage`; the Orchestrator reads it and sets `agent: bugfix` or
`agent: implementer`; whichever agent you start next looks for its label in the open milestone.
Nothing has to be awake at the same time, and nothing lives only in a chat.

**What you still decide, and only this:** what goes in a milestone · `type: question` issues ·
"approve" on a release · anything that destroys data, money, auth/secrets, scoring calibration, and
genuine product preferences. Structural and engineering calls are the agents', written down with
the reason.

**What goes away:** batons, handoff docs as a routine, the 4-hourly routines, the 2.7 MB backlog
file, the per-PR journal entries, and most of `CLAUDE.md`.

---

## Part 7 — Things still waiting on you that are not part of this

Independent of the switch-over; none blocks it.

| What | Why it's yours | What to do |
|---|---|---|
| **Fresh S3 keys** | Secrets are yours. Tested across three regions and three endpoints: the stored secret doesn't match its key id | Mint a new key pair in AWS/your storage provider → in Railway replace **`AWS_ACCESS_KEY_ID`** and **`AWS_SECRET_ACCESS_KEY`** (these win over `STORAGE_*`, so adding a second correct pair changes nothing) → same in your local `.env.local` → tell the Orchestrator so it can verify |
| **`.constants.json` values (TN-2)** | Calibration numbers only you have | Send them in chat; the Orchestrator files them |
| **One week wearing the chest strap (PS-44)** | Needs you to wear it | Wear it daily for a week; nothing to report until it's done |
| **Sleep ratings (TN-33)** | Your own judgement of how nights felt | Rate the nights it asks about, in the app |
| **PR #1499** (auth, read-only pivot) | Auth is yours, and it is held for the first release | Decide at release 1; its build is currently red at the type-check step, which the Implementer fixes once it's in a milestone |

---

## Appendix — what does NOT need doing, and why

These look like they need a setting changed. They don't.

**"Give the workflow permission to create tags."** Already allowed. The release workflow pushes
tags with the token GitHub issues for each run, and it declares `permissions: contents: write`,
which is what lets that token write tags. Your `protect-release-tags` ruleset restricts **updates**
and **deletions** only. **Do not tick "Restrict creations"** — it would block the workflow, and the
only way round it would be a bypass entry, which defeats the ruleset.

**"Point tags at Railway."** There is nothing to point. Railway does not watch tags. The release
workflow **pushes the build to Railway itself** using the token, waits until production is serving
it, and **only then** creates the tag. That order is deliberate: tags are permanent under your
ruleset, so a tag made before a deploy succeeded could never be withdrawn. The only Railway change
in the whole switch-over is *removing* the auto-deploy trigger (Part 1 Step 4).

**"Restrict the `release` environment to `v*` tags."** Don't. At deploy time the tag does not exist
yet — the deploy runs from `main` and the tag comes after. Restricting it would block every release.

**"Add a required reviewer to the `release` environment."** Not needed — you approve in the
Orchestrator's chat. A required reviewer would also block you when you run a release or a rollback
yourself, which is exactly when you are in a hurry. It remains available as a hard lock if you ever
want one.

**"A staging environment."** Unreleased code is tested on your machine by the Implementer. A
Railway staging service would mean a second service and database running all the time.

# Release-train cutover — the owner's checklist

Everything the owner has to do by hand to finish the release train, in the order it has to happen.
The design is [`docs/superpowers/specs/2026-10-05-release-train-design.md`](superpowers/specs/2026-10-05-release-train-design.md);
this is only the list of steps, and it is written to be worked top to bottom.

**Steps marked 🤖 are the Orchestrator's** and are listed only so the ordering is visible — they
need no action, but the step after one of them waits for it.

---

## Done already

- ✅ Railway project token created, scoped to the `production` Railway environment.
- ✅ GitHub **`release`** environment created, holding the token as **`RAILWAY_TOKEN`**.
  No required reviewer: the owner approves in chat, and a required reviewer would block him when
  he is the one releasing.
- ✅ **`protect-release-tags`** ruleset on `v*`: *Restrict updates* and *Restrict deletions* on,
  creations left open.
- ✅ Branch sweep: 52 branches down to 3, with `archive/*` tags for the three worth keeping.

---

## 1. Tag permissions — nothing to change, and here is why

The release workflow creates tags using `GITHUB_TOKEN`, the token GitHub mints for the run. It can
push a tag because:

- the workflow declares `permissions: contents: write`, which is what lets that token write refs
  at all; and
- the `protect-release-tags` ruleset restricts **updates** and **deletions**, not **creations** —
  so a new `v1.487.0` is allowed, while moving or deleting one is not, by anybody, including the
  owner.

**Do not tick "Restrict creations" on that ruleset.** It would block the release workflow, and the
only way back would be a bypass entry — which defeats the point of the ruleset. If a tag ever does
have to be removed, the honest route is to add a bypass temporarily, remove it, and take the
bypass back off.

**Nothing to do here.** The step exists because it is the one that looks like it needs a
permission grant and does not.

---

## 2. Pointing tags at Railway — also nothing, and this one is a correction

Tags do not trigger the deploy. The release workflow **pushes the build to Railway itself**, with
the Railway CLI and the token in the `release` environment, and only tags **after** production is
confirmed serving that commit. So there is no "Railway watches `v*`" setting to configure, and
there should not be: a tag that is created before the deploy succeeds would be permanent and
wrong, because the ruleset blocks deleting it.

The one Railway-side change is step 5 below, and it is a removal rather than a connection.

---

## 3. 🤖 Merge the plumbing PR (#2057)

The release workflow, the callable deploy check, the APK-on-release build, the labels, and the
issue and PR templates.

---

## 4. The first release — with auto-deploy still on

This proves the token and the workflow while the old path is still there to fall back on.

1. GitHub → **Actions** → **Release** → **Run workflow**.
2. Leave **sha** blank (it uses `main`'s current head).
3. Put the current `package.json` version in **version**, without the `v` — the workflow refuses if
   the two disagree, which is deliberate: it is what stops a release shipping a build whose in-app
   version does not match its tag.
4. Watch it. Expect: *Verify* → *Deploy to production* → *Production serves this commit* (up to
   20 minutes, measured at ~3.5) → *Tag and publish notes* → *Attach the APK*.

Railway deploys the same commit twice here — once from the merge, once from the release. Harmless.

**If the deploy step fails:** no tag was created, which is the whole reason for the ordering. Fix
and re-run with the same version.

---

## 5. Turn Railway's auto-deploy off

Only after step 4 has gone green end to end.

Railway → the `Training-Ai` project → the service → **Settings** → **Source** / **Deploy triggers**
→ turn off the automatic deploy from the `main` branch. Leave the GitHub connection itself in
place; only the trigger goes.

Tell the Orchestrator when this is done — the next step waits on it.

---

## 6. 🤖 Drop the deploy check's push trigger

A one-line PR, once step 5 is confirmed. Until then the check still runs on every merge, because
merges still deploy. Afterwards it would be checking for a deploy that never happens.

---

## 7. Confirm the cutover worked

Three things to see, in any order:

- a code PR merges and **production does not change**;
- a release deploys the chosen commit **only after** the owner says "approve", then tags it;
- a **rollback dry run**: run the release workflow again with the *previous* tag's commit and a new
  version number. The point is to prove the path works before it is needed in anger. The tag for
  the old version is not reused — it cannot be, and that is correct.

---

## 8. 🤖 Phases 3 to 5

The backlog-to-issues migration, the rules rewrite (which the owner reads before it merges), then
one week on the new flow and a retro.

---

## Renaming the repository to `TrainingAi`

Safe to do, and best done **between** releases rather than mid-flow — after step 7, before Phase 3.
GitHub redirects the old URL for web, API and git, so nothing breaks the moment it is renamed; the
work below is removing the reliance on that redirect.

### What actually depends on the name

One thing in running code: `lib/github-release.ts:30` resolves the APK download, defaulting to
`nekodas-neko/TrainingAi_Open`. It reads `APK_RELEASE_REPO` first, so the environment variable is
the safe way to move it. Everything else is test fixtures, a script default, and about 39 docs
files with links.

### The order

1. **Before renaming:** in Railway, set `APK_RELEASE_REPO=nekodas-neko/TrainingAi` on the service.
   The redirect means this is correct both before and after the rename, so setting it early
   removes the window where the two disagree.
2. **Rename on GitHub:** Settings → General → *Repository name* → `TrainingAi` → **Rename**.
3. **Check the two integrations that hold the name rather than the id:**
   - Railway's GitHub connection — reconnect if the service shows the old name.
   - Any browser bookmark or the `apk-latest` download link people have saved; both redirect.
4. **🤖 Then one PR** updating the hardcoded default, the test fixtures, the script default and
   the docs links, so the repo stops depending on a redirect that exists at GitHub's discretion.

### The local clone — do not delete anything

A rename does not invalidate the clone. One command fixes it:

```bash
cd <your local TrainingAi_Open folder>
git remote set-url origin https://github.com/nekodas-neko/TrainingAi.git
git remote -v        # confirm both lines say TrainingAi
git fetch origin
```

The folder can keep its old name, or be renamed — git does not care. If it is renamed, anything
holding an absolute path to it needs updating: the device-verification scripts under
`scripts/device/`, any editor workspace file, and any shell alias. Nothing else.

**Do not delete and re-clone.** A fresh clone loses any local branch, stash or uncommitted work,
and buys nothing the one command above does not.

### If the old name is ever reused

GitHub's redirect stops the moment a new repository is created with the old name. Nothing plans to,
but that is the reason step 4 exists rather than leaving the redirect to carry it.

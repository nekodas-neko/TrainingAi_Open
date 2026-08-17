# Runbook — cutting the public repo

_Created 2026-08-10. The step-by-step for Q-49. Each step says **who** does it and **how you know it
worked** — a step with no check is a step you cannot trust._

**Read this first:** nothing here is irreversible until step 14, and the one genuinely irreversible
act (deleting the old repo) is not in this runbook at all. It is archived, never deleted, which is
what keeps every earlier step recoverable.

---

## Phase A — before anything is published

### ☑ 1. Merge PR #1234 · **owner** — MERGED 2026-08-13

The inventory, the CI mechanism, the hygiene pass and the dry-run. Needs a deliberate sign-off
because it changes how the `isAdmin` session claim refreshes.

**Check:** all five CI checks green, and the PR body's §3 read.
**Not verified by anyone yet:** `bootstrapAdmin` against a genuinely fresh database. On the existing
one it is a no-op — that row is already admin.

### ☑ 2. Rotate credentials · **owner** — DONE 2026-08-13

A history-free public repo does not un-leak a secret that was already exposed. At minimum the
`AWS_SECRET_ACCESS_KEY` noted as pasted into a chat on 2026-07-21.

**Check:** the app still serves exercise gifs and the hypnogram after the rotation — both read the
bucket with those credentials.

### ☑ 3. Confirm `exercises-dataset` is public · **owner** — DONE 2026-08-13

`packages/shared/src/exercise-gif-matcher.ts` fetches from
`raw.githubusercontent.com/nekodas-neko/exercises-dataset`, which only serves public repos.

**Verified 2026-08-13:** both `data/exercises.json` and a `videos/*.gif` returned 200 over an
unauthenticated request. The gifs survive the cut.

### ☐ 4. *(Optional)* Archive the private paths · **owner**

```bash
node scripts/archive-private-paths.js --check   # what would upload
node scripts/archive-private-paths.js           # upload + verify
```

Redundancy, not a prerequisite — the old repo is archived rather than deleted, so its git history
holds every private path, and the `.pt` originals these were derived from are already in the bucket.

**Check:** the script's own last line. It refuses to say "archived and verified" unless every path
round-tripped.

### ☑ 5. A3 — the constants runtime loader · **agent** — DONE 2026-08-13

The last engineering blocker. Plan:
[`superpowers/plans/2026-08-10-constants-runtime-loader.md`](superpowers/plans/2026-08-10-constants-runtime-loader.md).
Two independent halves — the MET table replacement can go first and makes the other simpler.

**Done:** `--all` is green on all six gates with the full 81.2 MB removed. Be precise about what
that proves — **nothing in the published tree needs these files at build time.** Production still
needs them at runtime, from the bucket, which is step 6.

### ☑ 5b. A3c — stop shipping the step-decoder table to the client · **agent** — DONE 2026-08-13 (#1323)

Owner rule, 2026-08-13: *nothing from Oura is published unless we have made it our own.*
`steps_motion_decoder_2_0_0.constants.json` was in the browser bundle because ring step frames are
decoded on the device, and it cannot be transformed — it is the ring's quantisation spec, so any
change decodes wrong values. It is now served from `GET /api/oura-ble/decoder-constants` and
injected into the decoder, which throws rather than defaulting when the table is unset.

**Verified in #1323:** none of the table's field names appear in any client chunk of a real
`next build`. ⚠️ **Still not device-verified** — the offline path (one online session → relaunch with
no network → walk) has never been run. There is a Known-Issues row for it.

### ☑ 5c. Put the constants in the bucket · **owner** — DONE 2026-08-16, VERIFIED

The models went to object storage in A1; the constants only became movable in A3. Nothing can be
deleted until they are up, because the boot-time downloader has no other source. Kept here for the
re-do case — **either** run the script from a machine with the real credentials:

```bash
railway run node scripts/upload-model-assets.js --constants --check   # dry run
railway run node scripts/upload-model-assets.js --constants           # upload + read-back verify
```

**or** upload by hand through the bucket console: create a folder `oura-model-constants` at the
bucket root and drop in all 34 top-level `.json` files from `lib/oura-models/constants/` — flat, no
subfolder, **not** `constants/specs/` (17 more files nothing reads at runtime; the archive covers
those). Keys must come out as `oura-model-constants/<filename>.json`.

**Verified 2026-08-16:** `constants.bucket.verdict: "complete"`, `missing: []`, `empty: []`, all 34
files, with sizes matching the local copies byte-for-byte. The first upload landed 33 — the owner's
clone was stale and did not contain `stress_daytime_sensing_1_1_0.tables.json`; a `git pull` and one
more drag fixed it. Two extras (`README.md`, `index.ts`) rode along and are inert.

**How to re-check:** `GET /api/admin/model-assets` as a logged-in admin. `constants.bucket.verdict`
must read `complete`, with `missing` and `empty` both `[]`. The manual route skips the script's
checksum read-back, so this is the only verification it gets — it proves presence and non-emptiness,
not that the bytes are right. The bytes get proven at step 6, when the tree copy is gone and the
downloaded set is what actually runs.

### ☑ 5d. Test constants, so CI survives the deletion · **agent** — DONE 2026-08-16 (#1384)

The blocker the dry-run was hiding: its green comes from `OURA_CONSTANTS_DIR` pointing at the real
directory, which models production but not CI. Without a substitute, deleting the constants fails
~24 files. Synthetic fixtures now cover it with no credential in CI.

**Still owed before step 6:** `skipIf(!hasRealConstants())` guards on the 16 files listed in
[`handoff-2026-08-16-platform-public-repo-cut-a4b.md`](handoff-2026-08-16-platform-public-repo-cut-a4b.md).
Guard per `describe` — a blanket regex over every top-level `describe` was tried and backed out
because it over-guards pure-function tests.

### ☑ 6. A4b — remove the private paths, add the `NOTICE` · **agent** — DONE 2026-08-16

All ten paths deleted and `.gitignore`d, both boot checks repointed at the bucket and made fatal in
production, `NOTICE` written. Guards on **17** test files (the handoff measured 16 — it moved the
constants aside but not the `.onnx`, which costs one timing assertion in
`oura-ble-rollup-worker.test.ts`).

**Checked:** `publish-dry-run --all` green with the files *actually* deleted, `check-private-paths`
reporting `total tracked: 0.0 MB` and zero dangling comment references, `next build` clean, the full
suite at 3,864 passed / 75 skipped, `pnpm check:rules` at 36 of 36.

**One thing this step turned out to include, and the next person should know why.** A3 was recorded
as having made the constants a runtime-only dependency, on the evidence of a green `--all`. That was
wrong, and the dry-run could not have seen it: it runs no `next build`, and `next build` imports
every route to collect page data — so six modules reading a constant at *module scope* were still
opening the files at build time. Deleting them gave `ENOENT` at `Failed to collect page data for
/api/achievements`, which would have been a failed Railway deploy. Those six now read on first use;
parity against the real vendor values was re-proven before and after. Queued as **Q-313** (add a
build gate to the dry-run) and **Q-312** (the synthetic MET table).

**Still unexecuted:** the bucket *download*. Merging is not running it — see step 11's check and the
`projectOverview.md` row.

---

## Phase B — the cut

### ☑ 7. Name and create the new repo · **owner** — DONE 2026-08-16

**`nekodas-neko/TrainingAi_Open`** — public, empty, default branch `main`. This is the name to use for
`APK_RELEASE_REPO` at step 11.

### ☑ 8. Push the snapshot · **agent** — DONE 2026-08-16

`nekodas-neko/TrainingAi_Open` now holds one commit, `6c072f9`, 3,253 files / 45 MB, taken from
`main` at `c9df8db` via `git archive` (tracked files only). Not a history rewrite.

**Checked, the way this step specifies:** cloned fresh into a scratch directory, and
`check-private-paths.js` there reports every row "already removed" or 0 files, `total tracked:
0.0 MB`. Also audited before the push: no `.env`/`.pem`/`.key`/`.keystore`, no credential-shaped
literals, and zero occurrences of either the owner's email or the provenance detail — both of which
were live findings, not hypotheticals, and are recorded below.

**Three things this step turned up.** None were in the plan, and all three had to be fixed *before*
the push, because after it they are public:

1. **The owner's email was in two historical docs** (#1393). Migration 006's hardcoded admin address
   had been removed during this migration for exactly that reason; the sweep missed the two doc
   mentions.
2. **`scripts/private-paths.json` catalogued what it was protecting** (#1396) — including, for the
   most sensitive entry, a restatement of the substance of the file. The *same description* had been
   copied into a journal entry, so trimming only the manifest would have achieved nothing. Owner
   instruction: vague to an outsider, still usable by an agent.
3. **`main` was red on E2E, and had been since 14:00 UTC** (#1397). `seed.sql` built every date from
   `current_date` — the server's UTC date — while the app reads today in the user's timezone
   (Brisbane, UTC+10). After 14:00 UTC the newest seeded row is yesterday as far as the app is
   concerned, so `goal-invalidation.spec.ts` could not pass for ten hours of every day. It had landed
   in the morning, which is why it went green then. Unrelated to the migration, and it would have
   blocked step 9's throwaway PR too.

**The commit is authored `nekodas-neko <nekodas-neko@users.noreply.github.com>`** — GitHub's noreply
form, deliberately, so the one permanent commit does not republish the address that #1393 redacted.

### ☐ 9. CI and branch protection in the new repo · **owner + agent**

Both workflows reference only `secrets.GITHUB_TOKEN`, so there is no secret migration. Re-establish
protection on `main` with the same **six** required checks — Lint, Tests, Build, Custom Rules, Migration Check and E2E (E2E was added 2026-08-16 and is not yet trustworthy; it has flaked once).

**Check:** open a throwaway PR and watch all six report.

### ☐ 10. Verify the APK release works unauthenticated · **owner**

This is the whole point of the exercise.

**Check:** open the `apk-latest` download URL in a **logged-out** browser and get a file. If it 404s,
stop — the private-repo friction has not actually been removed.

### ☐ 11. Repoint Railway · **owner** — *first genuinely risky step*

Change the existing app service's GitHub source to the new repo. Keep the service: the domain is
load-bearing, `capacitor.config.ts` hardcodes it, and keeping it means installed APKs keep working
with no rebuild.

Add `APK_RELEASE_REPO=<new owner/repo>`. Without it the update card keeps reading the archived
repo's release, which still returns 200 and whose version never changes again.

**Check, against production:** a rendered hypnogram (proves the model fetch runs), daily steps, and a
workout write that round-trips. If any fail, the old repo is still a working rollback target — that
is why step 14 is last.

### ☐ 12. Set `ADMIN_EMAIL` · **owner**

Only strictly needed for a fresh database, but set it now so the admin bootstrap is exercised where
you can see it.

**Check:** deploy logs say `admin granted to ADMIN_EMAIL`, or nothing at all if the row was already
admin — both are correct.

### ☐ 13. Collect the winnings · **agent**

Drop `GITHUB_RELEASES_TOKEN` from Railway and the header from `app/api/download-apk/route.ts`; fix
the `CLAUDE.md` contradiction about the release URL needing a login; add the document-map note that
PR numbers below ~#1250 refer to the archived repo.

### ☐ 14. Archive the old repo · **owner** — *last, and never delete*

**Check:** it is read-only and still reachable. The docs cite hundreds of PR numbers against it, and
its history is the backstop for every step above.

---

## If something goes wrong

| Symptom | What it means | Action |
|---|---|---|
| Hypnogram or steps missing after step 11 | The model fetch is not reaching the bucket | Check the storage env vars carried over; `GET /api/admin/model-assets` answers directly |
| Update card frozen on one version | `APK_RELEASE_REPO` unset — reading the archived repo | Set it; no deploy needed beyond the restart |
| CI green locally, red in the new repo | Usually a missing env var in the Build job | Compare against `.env.example`, which is now complete |
| A private path reappears | Someone added an import | `check-private-paths` names the file; it runs in Custom Rules |

**Rollback for steps 7–13:** repoint Railway at the old repo. It stays a working target until step
14, and step 14 does not delete it.

# Review — 2026-08-17 · the public/private boundary as an architectural property

_Lens: **the repo migration**. Not "did the cut succeed" — it did — but what the cut changed about
the app's architecture, and what still assumes the repository is private._

_Findings: **Q-456 … Q-459**. Six areas came back **clean** and are recorded at the bottom, including
the two that matter most: **no credentials were published, and the CI posture for a public repo is
correct.**_

## Why this lens

On 2026-08-16/17 the project moved from the private `nekodas-neko/TrainingAI` to the public
`nekodas-neko/TrainingAi_Open`. That is not a hosting change. It changed three architectural
properties at once:

1. **Vendor material had to leave the tree**, which turned build-time imports into a **runtime
   dependency on private object storage** (`lib/oura-models/constants-delivery.ts`).
2. **The audience of every configuration and documentation surface changed** from one owner to the
   public — `.env.example`, `NOTICE`, the release URL — without those surfaces changing.
3. **CI became triggerable by people outside the project**, which makes workflow triggers and secret
   exposure a live concern rather than a theoretical one.

This sweep checks all three, plus the leftovers that still point at the archived repo.

## Method, and what it does not establish

Static inspection of the tracked tree at `8a1bf82`, plus the workflow definitions. Specifically:
`git ls-files`-scoped greps for credentials, keys, `.env` files and personal identifiers (so
untracked local build output could not produce a false positive — an early `.next/` hit was exactly
that and was discarded); a UUID sweep across `.md`/`.ts`/`.js`/`.json`; an env-var reconciliation
computed by differencing every `process.env.X` read under `lib app packages scripts instrumentation*`
against the keys declared in `.env.example`; and a read of the three workflow files' triggers and
secret references.

**What this does not establish.** It reads the tree, it does not run a clone — I did not do a clean
`git clone` into an empty container and build it, so the fresh-clone claims below are argued from the
committed fixtures and CI's behaviour rather than observed end to end. **Nothing here was checked
against the deployment**: I cannot see Railway's environment, so where a finding depends on whether a
variable is actually set in production (Q-457), it says so and stops. **Git history was not swept**
— it does not need to be for this repo (the public repository begins at a single 2026-08-16 snapshot
commit; there are 33 commits total and no pre-migration history came across, which is what bounds the
exposure question to the snapshot's contents), but that reasoning does not transfer to the archived
private repo, which was not examined. Secret detection was pattern-based (`ghp_`, `AIza…`, `sk-`,
PEM headers, non-local Postgres URLs, Slack tokens); it is strong evidence of absence for
conventional formats and **not proof** for a bespoke or high-entropy-but-unpatterned credential.

---

## Q-456 — the owner's production user ID is published in 18 committed migrations, and the documented process re-publishes it on every schema change

**Severity: medium. Not a credential; a permanent, unrotatable identifier for a real person.**
`[platform]`

`fe481797-4114-4f59-824d-223e0281823e` is the owner's production `users.id`. It appears in **18
tracked files**: every `NNN_claude_ro_views*.sql` migration, `claude-ro-readonly-role.test.ts:41`
(`OWNER_ID`), and one plan doc that spells out `CLAUDE_RO_OWNER_USER_ID=fe481797-…`.

That is not an accident, it is the design: `scripts/generate-claude-ro-views.js` bakes the owner's id
into the view definitions as the row-scoping predicate, and the generated SQL is committed. While the
repo was private this was invisible. It now isn't.

**What it is not.** It is not a credential and it grants nothing on its own — `/api/admin/db-query`
requires `CLAUDE_DB_QUERY_SECRET` *and* `requireAdmin`, and every other route is `auth()`-scoped. No
health data, no email, no name is exposed with it.

**Why file it anyway.** Three reasons, in order:

1. **It is one half of a credential pair.** `WEBHOOK_USER_ID` (with `HEALTH_CONNECT_INGEST_SECRET`)
   and `ADMIN_EXPORT_USER_ID` (with `ADMIN_EXPORT_SECRET`) both resolve to a user id that is almost
   certainly this one. If either secret ever leaks, the attacker no longer has to guess the other
   half. Defence in depth is exactly what you want on an ingest route.
2. **It cannot be rotated cheaply.** Changing the id means a migration touching 18 files and the
   production row it identifies.
3. **The process re-publishes it.** `CLAUDE.md` instructs that adding a table means re-running the
   generator **into a new migration number** — so every future schema change adds another public file
   containing it, indefinitely. That is the part worth fixing, because it is the part that compounds.

**Fix shape (implementer's call).** The generator could read the owner id from the environment at
*apply* time rather than baking it at *generate* time — e.g. emit views scoped on
`current_setting('app.claude_ro_owner')` or a single-row private lookup table seeded out-of-band, the
same way the `claude_readonly` role's password is already kept out of committed migrations. That
would make the whole class disappear rather than scrubbing 18 files once. **Lane A owns this** — it
is migrations.

---

## Q-457 — `lib/github-release.ts` still defaults to the archived private repo

**Severity: medium. A silent, already-precedented failure mode on a user-visible surface.**
`[platform][app-shell]`

`lib/github-release.ts:24`:

```ts
const APK_RELEASE_REPO = process.env.APK_RELEASE_REPO ?? 'nekodas-neko/TrainingAI'
```

The fallback is the **pre-cut, archived, private** repository. That default was correct before the
migration and is wrong after it, in two different ways:

- **For the deployment:** if `APK_RELEASE_REPO` is ever unset, cleared, or missed on a new
  environment, the app reads releases from an archived repo whose APK will never change again — and
  it reads it *successfully-looking*, because the failure is a 404 that surfaces as "Could not fetch
  release info", not as a misconfiguration error. **This exact surface has already been dead for two
  weeks once**, over the related `GITHUB_RELEASES_TOKEN` question (`CLAUDE.md`), which is why the
  silent-failure shape matters more than the probability.
- **For anyone who clones the public repo:** the default points at a repository they cannot read at
  all, so the update card and More → Download APK are broken out of the box with no indication why.

I could not check whether `APK_RELEASE_REPO` is currently set in Railway — that is outside what this
session can see, and `CLAUDE.md` asserts it is set to the public repo. So this is about the default
being a trap, not about a live outage.

`lib/__tests__/github-release.test.ts:49,58` pins the old repo's URL in its fixtures too, so the test
suite would not notice the flip.

**Fix shape:** default to `nekodas-neko/TrainingAi_Open` and update the two test fixtures. One line
plus two strings.

---

## Q-458 — `.env.example` is the public configuration contract and it is wrong in both directions

**Severity: medium-low, with one sharp edge.** `[platform]`

Computed by differencing every `process.env.X` read under `lib app packages scripts instrumentation*`
against the keys declared in `.env.example`.

**Declared, but read by no code — 8 keys:**

| Key | Why it is dead |
|---|---|
| `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, `OURA_REDIRECT_URI`, `OURA_WEBHOOK_CALLBACK_URL`, `OURA_WEBHOOK_VERIFICATION_TOKEN` | The Oura **Cloud** integration was deleted 2026-08-13 |
| `GEMINI_API_KEY` | Retired at Q-189; `CLAUDE.md` already records that nothing reads it |
| `TOKEN_ENC_KEY` | Nothing reads it |
| `AUTH_URL` | Nothing reads it |

**The sharp edge is `TOKEN_ENC_KEY`.** It reads as the key that encrypts stored tokens. An operator
setting up a deployment will generate one and set it, and reasonably conclude that tokens are
encrypted at rest. Nothing reads it, so nothing is. A dead variable that *names a security property*
is worse than a dead variable.

**The second edge is the five Oura Cloud keys.** `CLAUDE.md` is emphatic that the Cloud integration
must never be re-added — re-onboarding the official app risks a firmware update that breaks the
reverse-engineered BLE protocol. The public onboarding file currently invites a contributor to go
obtain credentials for precisely that. The file that says "here is how to configure this project"
contradicts the file that says "never do this".

**Read by code, but undeclared — the ones that are real configuration** (excluding test/script knobs
`OURA_CONSTANTS_DIR`, `RECORD_MODEL_FIXTURES`, `CHUNKS`, `RTT_MS`, `SERIAL`):
`CLAUDE_RO_OWNER_USER_ID`, `LOCAL_DATABASE_URL`, `PG_POOL_MAX`, `RAILWAY_GIT_COMMIT_SHA`.

**Fix shape:** delete the eight, add the four, and consider a Custom Rules step that differences the
two automatically — this drifted silently precisely because nothing measured it, which is the same
argument that produced the hex-literal and TTL-divergence ratchets.

---

## Q-459 — the rolling APK release is delete-then-recreate, so the advertised public download URL 404s on every native merge

**Severity: low.** `[platform][devices]`

`.github/workflows/android.yml:122-127`:

```bash
gh release delete apk-latest --yes --cleanup-tag 2>/dev/null || true
gh release create apk-latest android/app/build/outputs/apk/debug/app-debug.apk …
```

Between those two commands the tag and release do not exist. `CLAUDE.md` advertises
`…/releases/download/apk-latest/app-debug.apk` as *"always the newest `main` build, non-expiring, and
genuinely no login required"*, and `/api/download-apk` resolves it via `/releases/tags/apk-latest` —
which returns 404 in that window, surfacing to the user as "Could not fetch release info".

The comment explains the choice honestly (`gh` cannot overwrite an existing asset of the same name in
place). The window is short and native merges are infrequent, which is why this is low. It is filed
because the migration is what made it matter: while the repo was private nobody could use that URL,
and now it is the documented distribution path.

**Fix shape:** upload the new asset under a temporary name and swap, or delete only the *asset*
rather than the release and tag, so the release id and tag survive.

---

## Clean — six areas checked and found sound

Recorded so the next sweep does not re-cover them.

**1. No credentials were published.** Across all tracked files: no `ghp_`/`github_pat_`, no `AIza…`
Google keys, no `sk-…`, no PEM private-key headers, no Slack tokens, no non-local Postgres URLs with
embedded passwords. No `.env` (only `.env.example`, whose values are **all empty**). No keystore,
`.jks`, `.p12`, `.pem` or `.key`. No tracked build output or source maps (`.next/` is gitignored;
an early hit was my own local dev build, untracked). Pattern-based, so see the method caveat.

**2. No third-party personal data.** The only real email addresses in the tree belong to third-party
library authors and licence headers (`dswitkin@google.com`, `sindresorhus@gmail.com`, …) — bundled
dependency documentation, not project data. No user emails. Of the UUIDs in the tree, all but the
Q-456 one are BLE service UUIDs (`0000xxxx-0000-1000-8000-00805f9b34fb`), obvious placeholders, or
Oura's own published API-spec examples.

**3. The CI posture for a public repo is correct — this is the one that could have been bad.** All
three workflows trigger on `pull_request`, **not `pull_request_target`**, so a fork PR runs without
access to repository secrets. `ci.yml` references **no secrets at all**. `android.yml`'s secret use
(`ANDROID_DEBUG_KEYSTORE_B*`, `GITHUB_TOKEN`) sits behind steps gated on
`github.event_name == 'push'`, which a fork cannot trigger. There is no `issue_comment` or
`workflow_run` trigger to escalate through.

**4. A fresh clone's test suite genuinely works.** `vitest.config.ts:46-49` points `OURA_CONSTANTS_DIR`
at `lib/oura-models/__fixtures__/constants` whenever the real constants directory has no
`MANIFEST.json` — and the synthetic fixtures **are committed**. That is not a fallback that might
work; it is the path CI takes on every run, and the path this sandbox takes. `NOTICE`'s claim holds.

**5. The storage credentials are coherent, and I was wrong to suspect them.** `AWS_*` and `STORAGE_*`
looked like two competing schemes; they are a deliberate alias chain
(`process.env.AWS_ENDPOINT_URL ?? process.env.STORAGE_ENDPOINT`, `lib/exercise-storage.ts:4-24`), and
`constants-delivery.ts:74` reuses that same module rather than introducing its own. Declaring only
`STORAGE_*` in `.env.example` is therefore sufficient, not a gap. Recorded because the near-miss is
the kind of thing a later sweep would otherwise re-raise.

**6. The private-material machinery is well built.** `scripts/private-paths.json` is a single source
of truth with a stated `kind` and `reason` per entry, an `excludes` list so our own code beside vendor
material stays public, an `archive` field recording where each thing went, and — the part worth
copying — **descriptions deliberately written to be non-specific**, on the reasoning that an inventory
of what is being protected is itself a map to it. `scripts/check-private-paths.js` enforces it as
Custom Rules step 35, pinned by `scripts/__tests__/private-paths.test.ts`.

## The gap behind Q-456, stated once

`private-paths.json` protects **a third party's intellectual property** and does it well. Nothing
plays the same role for **this project's own users' identifiers and data**. Q-456 is the one instance
this sweep found, and it is minor on its own — but the reason it reached a public repo is that no
gate was looking for it, and the same absence would not catch the next one. Whether that deserves a
second list or a widening of the existing one is a design decision, not a review finding, so it is
noted here rather than filed as its own entry.

# 2026-09-24 — RV-198: pin the two actions that carry third-party risk

**Lane A** · branch `lane-a/rv198-ci-supply-chain`

Three of the entry's four items shipped. The fourth is half done, and the half left undone is the
point of this note.

## What shipped

**SHA-pinned the third-party actions** — `pnpm/action-setup@v5` (×7) and
`reactivecircus/android-emulator-runner@v2` (×1), across all three workflows, each keeping its
version as a trailing comment.

Both SHAs are the **current** commit behind the moving major tag, resolved with `git ls-remote` and
**dereferenced through the annotated tag** (`v5^{}` → `fc06bc12…`, `v2^{}` → `a421e438…`). That
dereference is the easy thing to get wrong: `refs/tags/v5` is the *tag object*, not the commit, and
pinning it would fail. So this pins today's behaviour rather than upgrading anything.

`actions/*` are deliberately left on tags: they are GitHub's own, the entry does not ask for them,
and pinning 18 more call sites would bury the two that actually carry third-party risk.

**Added the `github-actions` dependabot ecosystem.** This is what makes the pin safe rather than a
liability — a tag silently follows upstream security fixes and a SHA silently does not, so pinning
without it trades a supply-chain risk for a staleness one.

**`permissions: contents: read` on `ci.yml`.** Nothing there writes to the repository; the only
token-bearing step is `actions/upload-artifact`, which uses the Actions **runtime** token rather than
`GITHUB_TOKEN`. Verified by the PR's own CI, which is the honest test for this.

**The signing keystore is off PR runs** — one line, `if: github.event_name == 'push'`. A PR run now
falls back to a per-runner key, which is exactly the path already taken when the secret is unset, and
PR APKs are never published.

## What I did not do, and why

The rest of item 3 — splitting `android.yml` so PR runs also get `contents: read` — is **not done**.

GitHub does not accept an expression in `permissions:`, so making it per-event means duplicating the
build into two jobs. A mistake there breaks **APK signing on `push`**, which surfaces only after
merge, and which nothing in this sandbox can test: there is no Android SDK and Gradle is
proxy-blocked. Against a residual risk the entry itself rates low — fork PRs get nothing,
collaborators already have write access — taking that blind was the wrong trade.

It is the entry's `Keep:`, with the note that whoever takes it has to confirm a signed APK still
publishes on `push` *after* merging, because CI on the PR cannot prove that half.

## Not exercised

`android.yml` and `android-emulator.yml` did not run here — the emulator workflow is
`workflow_dispatch`-only, and the Android build needs an SDK this container does not have. What the
PR's CI does prove is that `ci.yml` still works under a read-only token and that the pinned
`pnpm/action-setup` SHA resolves and installs. The keystore gating is verified by reading, not by a
run: its `push` branch cannot fire on a pull request by construction.

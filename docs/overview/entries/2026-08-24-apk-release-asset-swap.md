# 2026-08-24 — the rolling APK release swaps its asset instead of delete-then-recreate (Q-459)

**Branch:** `claude/implementation-lane-a-setup-p3f5zk` · **Lane A** · workflow-only, no app code.

`.github/workflows/android.yml`'s publish step ran `gh release delete apk-latest --yes
--cleanup-tag` immediately followed by `gh release create apk-latest …`. Between the two commands
the release and its tag did not exist at all, so `/releases/tags/apk-latest` — what
`/api/download-apk` resolves against, and the URL `CLAUDE.md` advertises as "always the newest
`main` build, non-expiring" — 404'd for the duration of the `gh` round-trip. Harmless while the
repo was private (nobody could reach the URL); it became a real window once the repo went public
and that URL became the documented distribution path.

## What shipped

The publish step now checks whether the release exists first (`gh release view apk-latest`):

- **If it exists:** swap only the asset — `gh release delete-asset` the old `app-debug.apk`, `gh
  release upload` the new one, `gh release edit` the title/notes. The release id and tag are never
  touched, so the tag lookup `/api/download-apk` uses never 404s. There is still a brief gap
  between the delete-asset and upload calls where the *direct download link* would 404 if hit at
  that exact instant, but that's a far smaller and rarer window than the previous release-and-tag
  gap, and it doesn't affect the tag-resolution path at all.
- **If it doesn't exist** (first-ever publish): fall back to `gh release create`, same as before.

## What is NOT verified, and why

The publish step only runs `if: github.event_name == 'push'` on a merge to `main` touching a
native path — a PR run (this session's only way to exercise the workflow) never reaches it. The
new `gh release delete-asset`/`upload`/`edit` sequence has not been observed running against a
real GitHub release. YAML syntax is validated (`python3 -c "import yaml; yaml.safe_load(...)"`)
and the subcommands are the documented `gh` CLI release subcommands, but this is read-and-reasoned
verification, not an execution one — `gh` isn't installed in this sandbox. Recorded as a `Keep:` on
the projectOverview.md row rather than closed outright: confirm on the next native merge to `main`
that the swap actually completes (watch the workflow log, or check `gh release view apk-latest`
before/after).

## Verified

- `pnpm check:rules` — 55 of 55.
- YAML parses (`python3 -c "import yaml; yaml.safe_load(...)"`).
- This PR's own diff touches `.github/workflows/android.yml`, which is in the workflow's own
  `paths:` gate, so the Android job's build/compile steps will run on this PR (though not the
  publish step, per the trigger condition above) — that at least confirms the file doesn't break
  the job's YAML or step ordering.

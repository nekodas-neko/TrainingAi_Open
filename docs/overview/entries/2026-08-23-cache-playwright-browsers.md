# 2026-08-23 — CI re-downloaded Chromium on every E2E run (Q-466)

**Branch:** `ci/cache-playwright-browsers` · **Lane A** · CI only

`setup-node`'s `cache: 'pnpm'` caches the pnpm store and nothing else. Playwright's browsers live in
`~/.cache/ms-playwright`, so every E2E run pulled ~150 MB of Chromium afresh.

That costs nothing when the CDN is healthy. When it is not, **E2E is a required check**, so the run
does not degrade — it blocks the merge. Observed three times on 2026-08-18 across roughly 8–10 runs:
the step sat `in_progress` for 6–22 minutes with every other job green, and the only recovery was
cancel-and-re-run, which then finished the same step in under a minute. The tell is distinctive:
`Install Chromium` running while `pnpm e2e` is still `pending` means the download, not the specs.

## Three decisions worth not re-deriving

**The cache key is the *resolved* Playwright version, not the range and not the lockfile hash.**
`^1.62.1` in `package.json` does not change when the lockfile moves to a new build, so a cache keyed
on it would serve the previous browser indefinitely. Hashing `pnpm-lock.yaml` works but throws the
browsers away on every unrelated dependency bump — which is most bumps. A step resolves
`require('@playwright/test/package.json').version` after install and feeds it to the key.

**No `restore-keys`.** A prefix match would restore a different build's binaries, which the install
step then replaces — paying the download it was meant to avoid, and saving a mixed directory under
the new key.

**The install step stays, and must.** `--with-deps` installs apt packages that live outside
`~/.cache` and cannot be cached here. On a cache hit it finds the browser present and skips only the
download, which is the whole saving.

`playwright.config.ts` is untouched. Its preference for the sandbox's `/opt/pw-browsers/chromium`
when present, falling back to Playwright's managed download elsewhere, is why CI needs the install
at all — the backlog entry flagged it as a thing not to "simplify away", and it was not.

## Verified

`pnpm check:rules` 53 of 53 (which parses this workflow, so a YAML error would surface there), and
the step list re-read from the parsed file to confirm ordering: resolve → cache → install → e2e.

**Not verified: the saving itself.** A cache is only observable across two runs — the first is a
miss by construction. This PR's own E2E run is that miss; the next PR's is the measurement. The
failure mode if the key is wrong is a permanent miss, which is exactly today's behaviour, so the
downside is bounded at "no worse than before".

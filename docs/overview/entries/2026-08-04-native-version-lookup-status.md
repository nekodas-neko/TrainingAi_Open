# 2026-08-04 — Say *why* the native-version lookup failed (Q-59 follow-up)

**Branch:** `fix/native-version-lookup-status` · **Domain:** app-shell · **Version:** 1.256.1

## Why

Q-59 (#1065) shipped an hour earlier and was verified against `pnpm dev`, where the lookup correctly
falls through to "could not check" because the sandbox has no `GITHUB_RELEASES_TOKEN`. Checking
production after the deploy:

```
{"version":"1.256.0","nativeVersion":null,...}
```

Null. Re-checked after the 300 s fetch-cache window in case it was the publish gap — the workflow
**deletes and recreates** the release on every publish, so a lookup landing in that window
legitimately 404s. Still null. So it is persistent, and the update card is currently showing
"Could not check for a newer build" in production rather than the state it was built to show.

The problem with shipping that as-is: **a bare null is undiagnosable.** It could be a missing token,
GitHub being unreachable, a rate limit, or the recreate window — and only one of those is something
the owner can fix, in a minute, in the Railway dashboard.

## What changed

`lookupLatestApkRelease()` returns a status alongside the release:

| status | meaning |
|---|---|
| `ok` | version read |
| `unconfigured` | `GITHUB_RELEASES_TOKEN` is not set — the repo is private, so no request is even attempted |
| `unavailable` | the request was made and did not produce a release (404 / rate limit / network / timeout) |

Surfaced as `nativeVersionStatus` on `/api/version`, and as a new **App + native APK version** probe
in the admin data-capture console, so the owner can read it in the panel they already use.

`fetchLatestApkRelease()` stays as the thin wrapper, so `/api/download-apk` is unchanged.

## The one judgement call

`/api/version` is `Cache-Control: public` and unauthenticated, and now reports whether an optional
integration is configured. That is a small piece of config disclosure. The alternative — varying the
body by session — is worse: varying a publicly-cached response by auth is a cache-poisoning footgun,
and what is being disclosed is "an optional integration is not set up", not a secret. Taken
deliberately rather than by omission.

## Verification

Locally, with no token set, `/api/version` returns `"nativeVersionStatus":"unconfigured"` — exercised
against `pnpm dev`, not inferred. A test pins that the unconfigured path returns before spending a
request (spying on `fetch` to prove no call is made).

## Not verified — and this is the point of the change

**Which status production actually reports.** That is the whole reason this shipped: the answer
arrives with the deploy. If it says `unconfigured`, `GITHUB_RELEASES_TOKEN` needs setting in Railway
and the More → Download APK button has been returning 502 all along, since it uses the same token.
If it says `unavailable`, the token exists and the failure is GitHub-side — a different investigation.

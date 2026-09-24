# 2026-09-24 — Review sweep 60: security and privacy

**Branch:** `review/sweep-60-security-privacy` · **Agent:** Review · **Docs only.**

- **Nine Lane A entries**, placed directly under RV-188 (whose deploy fix every one of them waits on):
  - **RV-191** (HIGH), first: the feedback screenshot is unchecked and the admin panel opens it as
    a URL.
  - **RV-190**: admin query session settings persist on the pooled connection. Reproduced locally.
  - **RV-192**: unverified registration plus Google auto-linking.
  - **RV-193**: the refresh token is in the client-readable session.
  - **RV-194**: Sentry scrub gaps.
  - **RV-195**: three low auth and social gaps.
  - **RV-196**: the native plugin can reveal, clear or redirect the ring key. Needs an APK.
  - **RV-197**: the CSP allows WebSockets to any host.
  - **RV-198**: CI pinning and token scope.

  Every one that touches auth or security is marked for the owner to confirm before merge.
- **RV-199** (Lane O, `Ask:`): three privacy questions for the owner.
  - The clinical baseline doc in the public repo.
  - The personal email on commits.
  - Android backup rules.
- **OR-138** now says to build RV-190 first.
- **The Dependabot standing entry** records the new `adm-zip` high advisory and its fix, still
  below threshold.

Write-up: `docs/reviews/2026-09-24-sweep-60-security-and-privacy.md`. Exploit mechanisms were tested
on the local database only. Nothing was probed on production, and the repo being public, the
entries omit exploit steps.

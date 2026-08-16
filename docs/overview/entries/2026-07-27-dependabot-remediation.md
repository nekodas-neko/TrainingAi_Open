# 2026-07-27 — Dependabot vulnerability remediation

PRs: #803 (`security/dependabot-remediation-2026-07-27`), next-auth `beta.32` bump

## Why

24 open Dependabot alerts (3 critical, 13 high, 8 moderate) crossed CLAUDE.md's ≥5 high/critical
standing-item threshold. A stale Known Issues entry from session 287 had marked this "deferred" on
the theory that `gh` CLI access was required to see which packages were flagged — worked around
this session by cross-referencing `pnpm audit`'s package-level detail with the advisory summary
GitHub prints on every `git push` to `main`, rather than needing the Dependabot API directly.

## What shipped

- **#803**: `next` `^15.5.20` → `^15.5.22` (App Router Server Actions DoS, SSRF via Server Actions
  and rewrites, cache-confusion, unbounded Edge payload advisories); `sharp` `^0.34.5` → `^0.35.3`
  (libvips CVEs — this app's own direct image-processing call sites); pnpm overrides for
  transitive advisories (`js-yaml`, `tar`, `postcss`, `brace-expansion`). `next-auth`/`@auth/core`
  deliberately excluded — auth/session changes get their own confirmation gate per CLAUDE.md,
  filed separately rather than riding in on a routine dependency PR.
- **next-auth → `beta.32`**: separate follow-up fixing an auth-check-fail-open CVE, run through
  that same confirmation gate rather than folded into #803.

## Residual (accepted, documented)

Two `sharp` copies remain below 0.35.0, both outside this repo's direct control: one bundled
inside `next@15.5.22` itself (Next pins its own `sharp` for the Image Optimization API — forcing
an override risks breaking Next's image pipeline in ways untested upstream), and one inside
`@capacitor/assets`'s dev-only icon-generation CLI (never invoked at runtime, never exposed to
external input). GitHub's own scan reports this as 1 high alert as of this write-up. Below the
remediation threshold — no action needed until `next` bumps its bundled `sharp`, or
opportunistically if `@capacitor/assets` is touched for other reasons.

## Verification (from #803)

- `tsc --noEmit` clean, `pnpm lint` 0 errors, full suite 2219/2219 passing, custom-rules scripts
  clean, `pnpm build` clean.
- `pnpm dev` against local Postgres: unauthenticated redirect, `/sign-in` 200, `/api/version` 200,
  full credentials-login flow verified end-to-end (confirms the `next` bump didn't regress
  auth/session even though `next-auth` itself was untouched in that PR).
- `pnpm audit` re-run after: 24 advisories → 11 (all residual, documented above).

## Gap this entry fixes

Both PRs merged without a journal entry or a `projectOverview.md` update — this entry and the
Known Issues row correction are written retroactively so the fix is discoverable instead of
silently superseding a stale "deferred" note.

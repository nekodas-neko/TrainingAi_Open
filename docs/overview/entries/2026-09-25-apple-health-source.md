## apple-health-source: additive aggregate import support

Status: proposed in this branch, not deployed or device-verified.

The aggregate sync endpoint accepts an optional source restricted to apple_health or health_connect. Omitted source remains health_connect. Daily and sleep writes carry this source; Apple Health shares Health Connect priority below direct/manual sources. Workout provenance and sample-level deduplication are outside this PR.

Validation: 28 focused Vitest tests passed; changed-file ESLint and application
typecheck passed. Route tests mock repository calls, so they verify the API handoff,
not PostgreSQL execution. No live local API/database, physical device or production
verification has been performed. No release version bump: this is a draft API change.

The full custom-rules run executed 78 of 78 checks on Windows through Git Bash,
with failures in export-coverage parsing and existing backlog checks. These are
recorded as limitations, not a green gate. Database/runtime verification and CI must
be completed before this draft is considered ready to merge.

The same three custom-rule failures reproduce on the untouched base checkout.
Direct test typechecking reports the existing 320 errors in 90 files, with no
counts above the recorded baseline and no errors in the new tests. The Windows
wrapper itself cannot launch npx.cmd; this is a direct compiler/baseline comparison.

## health-active-calories: additive aggregate import support

Status: proposed in this branch, not deployed or device-verified.

The aggregate sync endpoint accepts dailyMetrics[].activeCalories in kcal and forwards it to existing active_calories storage. Zero and fractions are retained. Legacy caloriesBurned is total energy from Android TotalCaloriesBurned and is not reinterpreted as active energy or food intake. No migration is needed.

Validation: 22 focused Vitest tests passed; changed-file ESLint and application
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

## 2026-08-17 — the local SQLite migrations finally run on real Android (Q-250, partial)

**Branch:** `claude/docs-review-agent-setup-3ocl7m` · **Domain:** `platform`, `devices` · CI only,
no application code.

### What shipped

`.github/workflows/android-emulator.yml` and `scripts/ci/emulator-local-db-smoke.sh`. An emulator
boots on `ubuntu-latest`, the debug APK installs, and the job asserts the local SQLite store opened
at the version the source says it should.

The assertion is **`PRAGMA user_version` read off the device**, not a log line. A log can be written
by code that then fails; `user_version` is the database's own record of which upgrade actually
committed, and it is the same value `sqlite-service.ts` trusts on the next open. The job also fails
if `reconcileSchema()` had to repair a column or if the versioned upgrade threw — a repaired schema
reaches the right version while the migration that should have produced it is quietly broken, so
"arrived at 26" is not the same as "got there cleanly".

This is the failure that killed the local DB twice (#27, the WAL pragma inside the upgrade
transaction; #85, a non-idempotent `ADD COLUMN` rolling back the whole version). Both left every
local read returning empty, and both are the root of the recurring "my data disappeared" reports.
Until now a migration's first real execution was on the owner's phone.

Path-gated on `lib/sqlite/**` and `lib/local-store/**` as well as the native paths — which is why
it is a separate workflow rather than a job inside `android.yml`. The migrations it exists to
exercise are TypeScript and touch none of the native paths, and adding them to `android.yml` would
have republished the rolling APK release on every JS change, which that file's own comment warns
against at length.

**Non-required**, matching `android.yml`. A flaky emulator must never block a merge.

### The entry's suggested shape was wrong in a load-bearing way

Q-250 said "install the debug APK the existing job already builds". That APK is a WebView loading
`capacitor.config.ts`'s `server.url`, which is **hardcoded to production**. Installing it would have
pointed CI write traffic at the real database — and connection-pool exhaustion there has taken the
app down twice (Q-107, Q-308).

So the job builds its own APK against `http://10.0.2.2:3000` (the emulator's host-loopback alias),
with a seeded Postgres and a local Next server, reusing the shape the E2E job already established.
The rewrite step **fails closed**: if the production URL stops matching the pattern, it refuses to
build rather than silently shipping an emulator pointed at production. That guard was mutation-
tested — the URL was changed so nothing matched, and it fired.

The useful consequence is that this needs **neither production nor a staging environment**, which
decouples Q-250 from Q-251 entirely. That coupling was real when both entries were written.

### Q-251 rescoped, after the owner pushed back and was right

The entry was written around standing up a second Railway service. It should have been written
around the **data**. What closes the ~10 data-gated rows and makes a migration rehearsable is a
prod-shaped database to run against, and that does not require a second deployed service: a
scrubbed `pg_dump` restored into the local Postgres gets most of the value at no recurring cost, and
plugs into the `pnpm dev` + Playwright setup that already exists. The second service buys real
HTTPS, the service worker under a real origin, and an APK target that is not production — a minority
of the value for all of the cost. Both shapes are now written up, cheapest first.

A test account on production was raised as an alternative and is recorded as **not a substitute**:
migrations still run against production first, a fresh account has none of the real sleep/HR/program
data those rows need, and its writes land in the production database.

### Agent session titles are now fixed

The five standing sessions have canonical titles — `Implementation Agent (A) 🚧`, `Implementation
Agent (B) 🚧`, `BugFix Intake Agent 🪲`, `Tuning Agent 🎶`, `Review Agent 📖` — carried in the
README's handoff section, in each prompt, in each baton's own header, and in `CLAUDE.md`. Every
handoff now states its successor's title outright rather than leaving it inferred from a filename.
The title is how five concurrent sessions stay tellable apart, so a renamed successor is a lost
thread even with a perfect baton.

### Not exercised — read this before trusting a green run

**None of the emulator job has been executed.** It cannot run in a Claude session: `/dev/kvm` does
not exist and `/proc/cpuinfo` reports neither `vmx` nor `svm`, because the sandbox is a Firecracker
microVM. What *was* verified here is narrow and worth stating exactly: the workflow YAML parses, the
shell script passes `bash -n`, the expected-version extraction returns 26 against the real
`migrations.ts`, and the `capacitor.config.ts` rewrite both works and fails closed when mutated.

Everything else is unproven until it runs on a real runner — in particular whether the WebView boots
far enough to create the database within the 90-second poll, whether `run-as` can read the file on
this API level, and whether `loggingBehavior: 'none'` suppresses the `console.warn` lines the
reconcile check greps for. **Expect this to need a few CI rounds.** It is non-required precisely so
that costs nothing while it settles, and a first red run is information rather than a regression.

The remaining Q-250 scope — sign-in, offline cold start, service-worker passthrough, deep links, the
back-button guard, notifications, PiP — is untouched and needs the app driven through real flows,
which is a Maestro/Espresso job rather than a shell script.

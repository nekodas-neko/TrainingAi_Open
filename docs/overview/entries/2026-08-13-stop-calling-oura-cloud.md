# 2026-08-13 — the app stops calling the Oura Cloud (owner decision)

**Branch:** `claude/trainingai-backlog-v0abea`

Owner, verbatim: *"yes get rid of oura cloud references we dont use it."* This removes the two
**automatic** calls — the ones that fired on their own and could never succeed. The rest is filed as
**Q-224**, because one part of it is a trap.

## What was removed

**Every workout completion pulled a Cloud HR window first.** `syncAndAttributeSessionHr`
(`lib/workout/post-completion-hr.ts`) called `syncHrForSession` before attributing HR to the session
and its sets. Since the 2026-07-07 BLE re-key the stored Cloud credential is dead, so that call spent
a request earning a 401 and a log line on every completed workout, forever. Attribution now runs
directly against `oura_heartrate` — the same rows it always read, written by the BLE ingest pipeline.

**The app-open / native-resume Cloud sync** in `components/sync-provider.tsx` is gone (62 lines). It
already self-suppressed whenever BLE data was fresh (`isBleDataFresh`), which is the detail worth
noticing: the only times it actually reached out to Oura were the times BLE was stale — i.e. exactly
when the user most needed the app responsive.

Both are background paths. Nothing that renders changed.

## What was deliberately left, and why it is not tidiness

**`components/more/oura-section.tsx` is mixed.** `OuraConnectionSection` renders the **live BLE ring
battery** — `/api/oura-ble/battery-latest`, the freshness gate, the whole Q-203/Q-205 result — *and*
the Cloud connect/sync/disconnect controls, in one component. Deleting the file to "remove Oura
Cloud" would silently remove the ring battery display. It needs surgery, not deletion. There is also
a second, differently-scoped component with nearly the same name:
`components/health/oura-section.tsx`.

**Historical Cloud data is not the Cloud integration.** `oura_daily`, `oura_daily_summary`,
`oura_daily_derived` and the Cloud-era rows in `sleep_sessions`/`body_metrics` are the owner's health
history from before the re-key, read by health-trends, day-timeline, More and the sync engine. "We
don't use Oura Cloud" is a statement about the *integration*; deleting the history would be a
different and destructive act. Every row stays.

The remaining surface — 7 routes, ~8 lib files, the UI surgery, the repository token methods — is
measured and written into **Q-224**, including the fact that `retention-throttle.ts` imports
`sync-throttle` and has to be untangled first, and that `lib/oura/types.ts` may be reached by the BLE
path.

## Verified

`tsc --noEmit` clean, lint 0 errors, `pnpm check:rules` 33 of 33. The workout-completion suites
(`app/api/complete-workout`, `lib/workout`) pass unchanged, which is the meaningful signal: the
completion path still attributes HR without the Cloud pull in front of it.

**One test failed on the first full run, correctly.** `sync-provider-auth-gate.test.ts` asserted that
the Oura Cloud sync effect was auth-gated (Q-150) — an effect this change deletes, so the assertion
had nothing to find. Rather than dropping the case, it now pins the **absence**: `sync-provider.tsx`
must not reach `/api/oura/` at all. That keeps the owner's decision from being quietly reverted, and
the file's general invariant (every networked effect consults `userId`) still covers a re-added
effect that forgets its guard. Mutation-verified — re-adding a `fetch('/api/oura/sync')` effect fails
it.

**A second full-run failure was environmental, and diagnosed rather than dismissed.**
`migration-test-lock.test.ts` failed with `expected 1 to be +0` — **1 test file failed with 0 failing
tests**, which is the tell that it is a hook and not an assertion. Its `afterAll` checks that no
advisory lock is still held; several suites had been stacked concurrently in this session and a
second run was holding it. `pg_locks` was empty immediately after, and the file passed 3/3 alone. It
touches nothing in this diff. The trap is now in `CLAUDE.md` next to its siblings, along with the
detail that `pkill -f vitest` also kills the monitors watching the run and makes a killed run's 143
look like a failure.

**Not exercised:** a real workout completion on the device. The attribution half is unchanged code
reading unchanged rows, and the removed half could only ever return a 401 — but the S25, native
SQLite and the Capacitor plugins do not run here.

**One consequence worth stating:** the manual "Sync Now" Cloud buttons still exist in the UI until
Q-224 lands, and they will still fail. They fail today too; nothing regressed. What stopped is the
app calling Oura on its own.

## Also confirmed this session, from production rather than prediction

- **The rollup worker is genuinely live.** A ring sync at 13:20:25 logged
  `[oura-ble] rollup worker ready — rollups run off the request loop` — the handshake, not the
  fallback warning. Q-213 Stage 2 does what it claimed in production.
- **The Q-217 fix holds.** The v1.304.3 deployment's entire boot log is 13 lines, all `info`, zero
  errors — where the previous one opened with `[token-crypto] TOKEN_ENC_KEY unset` twice at error
  severity.

# 2026-07-29 — the `oura-ble-sleep-window-union` flake was a globally-unique `oura_id` collision

Branch `claude/trainingai-data-quality-review-ttuz7z`. Closes backlog **Q-21**.

## What it was

`sleep_sessions` carries two unique constraints:

```
sleep_sessions_user_id_sleep_start_key  UNIQUE (user_id, sleep_start)
sleep_sessions_oura_id_key              UNIQUE (oura_id)      ← global, no user column
```

The BLE rollup derives `oura_id` as `` `ble:<startDs>` `` directly from the ring counter, with **no
user component**. Four rollup tests each began their night at ds `1_000_000`, so all four derived the
identical `ble:1000000` — for four *different* test users.

The rollup's insert arbitrates on `(user_id, sleep_start)`, which does not cover `oura_id`. When the
suite ran two of those files concurrently and their rows briefly coexisted, the second insert hit an
**unhandled** unique violation on `oura_id`. `aggregateOuraRawSamples` isolates each write step and
files the error into its returned `stepErrors` rather than throwing, so the failure was swallowed and
the table simply came back empty — reaching the test as a bare `expected 2, got 0`.

## Why it stayed unexplained for so long

The backlog entry recorded *"Ruled out: test-user collision (`…c105` appears in no other file)"*. That
is correct for `user_id` and was never the problem. What it missed is that the id **derived** from the
shared ds base is not user-scoped at all. Every subsequent hypothesis (connection exhaustion, worker
state leaking, hour-dependence) was chasing the wrong resource.

The entry's later correction — *"the shared-Postgres-state theory is probably wrong"*, argued from a
non-DB cookie test flaking under the same conditions — rested on a coincidence. That test
(`oura-oauth-state`, "rejects a tampered or garbage cookie") had an unrelated root cause: it tampered
the **last** character of a base64 signature, which can decode to identical bytes. #896 fixed it by
tampering the middle. It was never evidence about this failure.

Both claims are corrected in the backlog in this PR rather than left to mislead the next reader.

## The fix

Two commits:

1. **`034de3a`** — assert the rollup's own report *before* reading the table:

   ```ts
   expect(result.stepErrors).toEqual([])
   expect(result.sleepSessions).toBe(2)
   ```

   Reading `sleep_sessions` first collapses three genuinely different failures into one
   uninformative count: a swallowed write error, a missing anchor / empty window set (which leaves
   `stepErrors` clean, so that assertion alone would not catch it), and a real miscount. The sibling
   rollup tests — `oura-ble-step-rollup`, `oura-ble-step-backfill`, `oura-ble-sleep-anchor-drift` —
   already assert `stepErrors`; this file was the outlier. **This is what exposed the root cause on
   the first reproduction after it was added.**

2. **`41ad848`** — give each rollup test a distinct ds base, spaced 10M apart. The `2_000_000`
   (3 files) and `3_000_000` (2 files) clusters carried the same latent collision and were separated
   too, rather than left to surface as the next flake. Every anchor is derived from its file's own
   base, so shifting preserves the ds→UTC mapping and every asserted date is unchanged.

## Evidence

| | union test |
|---|---|
| before, full suite | 2 failures in ~6 completed runs (~1 in 3) |
| after, full suite | **0 failures in 8 runs** |

At the prior rate, eight consecutive clean runs is roughly 4 % likely by chance. The sweep also
watched for *any other* `oura-*` rollup test failing, to catch the collision being relocated rather
than removed — none did.

The nine shifted files also pass together in isolation (17 tests), confirming the date arithmetic
survived the shift.

## The part that is NOT fixed — a real product exposure

`ble:<ds>` is unique per **ring**; `sleep_sessions.oura_id` is unique **globally**. Genuine Oura Cloud
ids are globally unique so the constraint suits them — the synthetic BLE ids do not.

**If a second user ever wears a BLE ring, their nights collide with the owner's**, and because
`step()` swallows the write error, that user's sleep data would silently stop landing with nothing
surfaced. Latent today (one BLE ring) but production holds several real accounts. Recorded as a
Known-Issues row; the fix is either scoping the id (`ble:<userId>:<ds>`) or moving the constraint to
`(user_id, oura_id)`, both of which touch the Cloud dedup key and want their own change.

## Not exercised

Server + test-infrastructure only — no device path, no APK rebuild, no migration, no user-visible
change (hence no version bump or changelog entry). The `claude-ro-readonly-role` tests fail in this
sandbox throughout, before and after: the `claude_readonly` role is created out-of-band and does not
exist here. Unrelated to this change.

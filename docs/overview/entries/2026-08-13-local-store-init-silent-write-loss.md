# 2026-08-13 — a check-in lost to the local-store init window, and a production fault still open

**PR:** [#1292](https://github.com/nekodas-neko/TrainingAI/pull/1292) · **Version:** 1.302.1 · **Branch:** `fix/local-store-init-silent-write-loss`

The owner reported saving "not working" on the S25, first thing in the morning. It was two
unrelated faults arriving together, and only one of them is fixed.

**The fixed one.** `getLocalStore()` screens out the *dead* store (K4) but not the *not-open-yet*
one. `_db` stays null for the whole of `initSQLite` — the versioned upgrade, the WAL pragma, then a
full `reconcileSchema()` pass with a `PRAGMA` per reconciled column — which is seconds on the first
launch after a release that adds a local migration, and v25 shipped in #1282. `initSQLite` is
awaited in a `useEffect`, so the sheets are interactive throughout. A Save landing in that window
hit `if (!_db) return` in `runSQL`: nothing written, nothing queued to the outbox, `savedLocally`
set true, success toast. Production has **no `day_checkins` row for 2026-08-13** and no client
error to explain it.

`runSQL` now waits for an in-flight open and throws on the canonical runtime if the DB never
opened, so a write site's catch takes its API fallback instead of reporting a save that reached
nothing. Reads stay soft — an empty result degrades a screen to its API fallback where a throw
would blank it — and cache writes stay soft for the same reason. The morning check-in gained the
API fallback it never had.

Separately, both check-in sheets stopped blocking their close on the local write. "The local write
is fast" held only while nothing else was using the DB: the Capacitor plugin has one connection, so
a tap landing during the sync pull's `applyDelta` transaction queues behind the whole delta — the
~2 minutes of "Saving…" the owner photographed. The sheets now close on the tap. The underlying
hold is untouched and queued as Q-214.

**The open one.** Midway through, production began intermittently refusing to answer at all:
`/api/version`, which touches nothing, went 0.47 s → 3–14 s → seven minutes of silence → 5–11 s. It
is the app, not Railway and not Postgres — an admin query whose DB time was 353 ms took 14 s end to
end, and `numbackends` sat at exactly the pool's `max: 10`. Not diagnosed; blocked on Railway
deploy logs, which need a fresh session to pick up the token the owner added. Q-213, first in the
queue, with the evidence in
[`docs/handoff-2026-08-13-platform-production-connection-starvation.md`](../../handoff-2026-08-13-platform-production-connection-starvation.md).

The finding worth keeping past the incident: **`claude_ro.error_events` cannot see a fault of this
shape**, because the app has to reach the DB to write an error row. Thirteen rows across the ninety
minutes covering the worst of it. The session-start orientation read is quieter than production,
not equal to it.

Neither half is device-verified — native SQLite does not run in the sandbox, so the init window
this fixes cannot be reproduced here.

# 2026-08-18 — Review: the last line of defence for a workout, failing silently

**Agent:** Review 📖 · **Branch:** `claude/review-silent-failure-surfaces` · **Docs-only.**
**Filed:** Q-486 · **Review:** [`docs/reviews/2026-08-18-tier-a-enqueue-silence.md`](../../reviews/2026-08-18-tier-a-enqueue-silence.md)

## Why

Sweep 18 named a pattern worth chasing — *this app validates well and tells you badly* — and the most
consequential form of that is a **write** that fails and reports success. `CLAUDE.md` names the smell:
*"any POST reachable offline must queue a mutation or visibly fail; `fetch(…).catch(() => {})` is the
smell."*

## What is right, because it sets the finding's size

`workout-screen.tsx`'s log path is well layered and I nearly mis-read it. `logWorkoutLocally` writes
locally first **and logs its own failure**. The **primary** send is a direct `POST /api/log-exercise`,
deliberately *"independent of the on-device outbox / sync-push path (which can fail silently)"*. The
outbox enqueue is only the **fallback**. This is not a write with no outbox.

And the correct shape is the norm elsewhere: **26 of ~30** `queueMutation` sites `await` it, so a
throw reaches a `try` and the success toast never fires. `metric-log-sheet.tsx:96` is the reference.

## The finding

Four sites swallow — `workout-screen.tsx:1320`, `:1324` (`workout_log`), `:1527`, `:1532`
(`complete_workout`) — and they are the **only four in the app**. All are **Tier-A**, the tier
`dead-letter-signal.ts` defines with *"a lost workout is the app's worst-case data loss."*

`queueMutation` is a bare `runSQL` INSERT, so it throws whenever the local DB is unavailable — which
`CLAUDE.md` records as having happened **twice** on Android, plus partial-migration and `disk_full`.

To lose a set both layers must fail: the POST (offline, the case the fallback exists for) *and* the
local store. Then the set is not sent, not queued, not recoverable, **nothing is logged**, and
`hapticLight()` + `setLoggedCount(c => c + 1)` have already told the user it worked.

**The inconsistency is the argument:** in the same function the *less* consequential failure is
`console.warn`ed and the *more* consequential one is silent. The warn above shows the intent.

## Three "do not"s, carried in the entry

Do not undo the layering. Do not convert the four to `await` — they are fire-and-forget so the UI
stays instant. Do not treat this as reproduced.

## Not verified — and it cannot be here

Inducing this needs a broken local SQLite on a device. In the web sandbox `getLocalStore` returns
null, so `store_?.` short-circuits and the enqueue never runs at all. That `queueMutation` throws on a
dead local DB is read from `sqlite-backend.ts:2669`, not observed. On-device is the only real
verification.

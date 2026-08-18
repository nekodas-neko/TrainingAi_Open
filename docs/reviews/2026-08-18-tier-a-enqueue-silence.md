# Review — the last line of defence for a workout, failing silently

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** swallowed failures on write paths
**Findings filed:** Q-486 · **Clean results recorded:** three

## Why this lens

Sweep 18 named a pattern worth chasing: *this app validates well and tells you badly*. The most
consequential form of that would be a **write** that fails and reports success. `CLAUDE.md` names the
smell exactly: *"Every user-visible write needs an outbox domain — any POST reachable offline must
queue a mutation or **visibly fail**; `fetch('/api/…').catch(() => {})` is the smell (complete-workout
once shipped this way)."*

## First, what is right — because it changes the finding's size

`components/workout-screen.tsx`'s log path is well built and I nearly mis-read it:

1. `logWorkoutLocally(...)` writes to the local store first, and its failure **is** logged
   (`.catch(err => console.warn('logWorkoutLocally failed:', err))`).
2. The **primary** send is a direct `POST /api/log-exercise` — the comment says so and gives the
   reason: *"Reliable when online and independent of the on-device outbox / sync-push path (which can
   fail silently)."*
3. The outbox `queueMutation` is the **fallback**, used only when that POST fails.

So this is not "a write with no outbox". It is a well-layered write whose *last* layer is silent.

And across the codebase the correct shape is the norm: of roughly 30 `queueMutation` call sites,
**26 `await` it**, so a throw propagates to the caller's `try` and the success toast never fires.
`components/health/metric-log-sheet.tsx:96` is the reference — `await store.queueMutation(...)` and
then `toast.success(...)`, in that order.

## Finding (Q-486) — the four that swallow are the four that matter most

```
components/workout-screen.tsx:1320   queueMutation({domain:'workout_log'}).catch(() => {})
components/workout-screen.tsx:1324   queueMutation({domain:'workout_log'}).catch(() => {})
components/workout-screen.tsx:1527   queueMutation({domain:'complete_workout'}).catch(() => {})
components/workout-screen.tsx:1532   queueMutation({domain:'complete_workout'}).catch(() => {})
```

These are the **only four** `queueMutation` call sites that swallow, and all four are **Tier-A**
domains. `lib/local-store/dead-letter-signal.ts` defines that tier and says why it exists: *"a lost
workout is the app's worst-case data loss."*

### It can actually throw

`queueMutation` is a bare `runSQL` INSERT into `mutations_outbox`. It throws whenever the local
database is unavailable — and `CLAUDE.md` records that as having happened, twice: *"The local DB has
been silently dead on Android **twice** from migration bugs … each time every local read returned
empty"*, plus *"assume any local migration can partially apply"* and the 2026-08-17 `disk_full`
outage.

### The sequence that loses a set

Both layers must fail: the POST fails (offline, which is the normal case this fallback exists for)
**and** the local store is broken. That is exactly the twice-documented Android condition. When it
happens:

- the set is **not** sent, **not** queued, and **not** recoverable;
- **nothing is logged** — unlike `logWorkoutLocally` two lines above, which `console.warn`s;
- and the user is told it worked. `hapticLight()` and `setLoggedCount(c => c + 1)` fire
  unconditionally, before and independent of any of this.

### The inconsistency is the argument

Within the same function, the *less* consequential failure is logged and the *more* consequential one
is not. `logWorkoutLocally` failing costs a cache entry; `queueMutation` failing costs the workout.
The `console.warn` on the first shows the authors' intent — the second looks like an oversight rather
than a decision.

### Fix shape

Small, and it should not change control flow. Replace `.catch(() => {})` with a catch that logs and
signals:

1. **Log it** — `.catch(err => console.warn('queueMutation failed:', err))`, matching the line above.
   One line ×4, and it makes the condition diagnosable at all.
2. **Tell the user**, because this is the case where a lost workout is unrecoverable — a toast, or
   route it through the existing dead-letter signal so the More-tab badge lights. The mechanism is
   already built (`lib/local-store/dead-letter-signal.ts`); nothing needs inventing.

**Do not** convert these to `await`. The surrounding code deliberately fires them without blocking so
the UI stays instant (the `Saves feel instant` rule), and awaiting would put a SQLite write in front
of the haptic.

## Clean results

- **The layering is correct** — local write, then a direct POST as primary, then the outbox as
  fallback. That ordering is deliberate and documented in the file.
- **26 of ~30 `queueMutation` sites are correctly awaited**, so their failures reach a `try` and
  suppress the success toast. `metric-log-sheet.tsx:96` is the reference shape.
- **`logWorkoutLocally` and `completeWorkoutLocally` both log their failures** — the intent to make
  local-store failures visible is already present in this file.

## Not verified

Local `pnpm dev` and source reading. **Not reproduced** — inducing it needs a broken local SQLite on a
device, which this sandbox cannot do (`getLocalStore` returns null on web, so the `store_?.` optional
chain short-circuits and the enqueue never runs at all here). The claim that `queueMutation` throws on
a dead local DB is read from `sqlite-backend.ts:2669` (a bare `runSQL`), not observed. **On-device is
the only real verification**, per the Canonical Runtime rule.

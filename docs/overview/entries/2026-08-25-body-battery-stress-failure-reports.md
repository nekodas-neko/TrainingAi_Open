# 2026-08-25 — the guard that swallowed the signal another investigation was waiting on (TN-7)

**Branch:** `fix/body-battery-stress-failure-reports` · **Lane A** · one line in
`app/api/body-battery/route.ts`, plus the test that proves it. No user-visible change.

TN-4's fix is correct and stays: a stress-model failure now costs the stress strip rather than
500ing the whole Body Battery card. Its catch, though, ended at

```ts
console.error('[body-battery] daytime stress series failed, continuing without it:', err)
```

**`console.error` reaches no table.** Verified rather than assumed: `reportServerError`
(`lib/observability.ts`) is what writes `error_events`, via `repo.insertErrorEvent`, and nothing
bridges the console to it. The route imports that function and uses it in the *outer* catch, but not
here. So from TN-4's deploy onward a recurrence of `daytime-stress: constants not set` — the fault
that fired **31 times between 10:37 and 20:59 UTC on 2026-08-23** — produced no row anywhere.

## Why that mattered to something else

LA-20's Known-Issues row is waiting on exactly that count. Its `Keep:` reads *"the check is
`error_events` after this deploys … the count must be zero across a window where `/api/body-battery`
was actually called."* After TN-4 the count is zero **whether or not the root cause is fixed**, so
the condition could no longer fail and no longer distinguished anything. The row was not wrong; it
had been quietly made unfalsifiable by a change made for good reasons somewhere else.

## What shipped

```ts
reportServerError(err, { userId, url: '/api/body-battery#stress' })
```

beside the log, not instead of it. The `#stress` fragment is what makes the row attributable to the
stress strip rather than to the outer catch, which reports the same route without it.

**Scoped to this one catch, deliberately.** The route has two other `console.error`-only catches —
line 218 (on-demand readiness, which falls back to sleep) and line 346 (the fire-and-forget stress
persist). Neither was swept, for a reason written into `reportServerError` itself: *"Adopted in the
catch blocks of the highest-risk routes only … not a blanket sweep."* Line 274 is the one that
produced a production fault and the one another entry's verification depends on; the other two are
designed fallbacks that have produced none. `error_events` is also **49 MB, 27% of the database**
(Q-315), so reporting volume is not free.

## The park was overridden, and here is the reasoning

`next-item.js` had TN-7 **PARKED** on `Needs: TN-4`, and the field rule is that a `Needs:` clears
when its target leaves the queue. TN-4 will not leave: its residue is *why* the constants were unset
for ten hours, on a fault that stopped by itself and whose `error_events` evidence prunes on
**2026-09-22**.

So TN-7 was parked behind an investigation that TN-7 is the prerequisite for — the signal stays off
while the thing that needs the signal waits. TN-7's own text settles what the dependency meant: *"a
follow-up to what TN-4 shipped, not a criticism of it."* It needed TN-4's catch block to exist. It
does, on `main`. Blocked in the tool, satisfied in substance.

## Verified

- `stress-failure-does-not-500.test.ts` — **2 passed**. The new case asserts a row lands in
  `error_events` with `url = '/api/body-battery#stress'` and a message containing
  `daytime-stress: constants not set`, against the real table.
- **Mutation-proven.** Deleting the `reportServerError` line fails the new case and leaves the
  existing 200 case passing, so the two are independent and neither is standing in for the other.
- The assertion **polls**, because `reportServerError` is fire-and-forget by design and the row lands
  after `GET` resolves. That is BF-18's lesson from the other direction, shipped an hour earlier
  today: asserting an async effect with no wait passes on an idle machine and fails on a loaded
  runner.
- `pnpm check:rules` **Ran 56 of 56**. `tsc --noEmit` clean. `pnpm lint` 0 errors.

## Not exercised

- **Nothing on the device, and nothing in production.** The report path is proved against the local
  Postgres only.
- **This does not fix TN-4** and must not be read as doing so. Why the constants were unset for those
  ten hours is still unknown; TN-4 stays in the queue for it. What changes is that a recurrence is
  now visible before the evidence prunes.
- **LA-20's row is falsifiable again but not yet satisfied.** Its clean window starts at *this*
  deploy. Every zero between TN-4's deploy and this one is silence from the guard rather than
  evidence, and the row now says so — striking it on those days would be striking it on nothing.

## The shape worth naming

A hardening change that turns a loud failure into a quiet degradation also removes the evidence a
*separate* open investigation was relying on. When a fix turns a 500 into a fallback, check whether
anything is waiting on that 500 — and carry the signal across.

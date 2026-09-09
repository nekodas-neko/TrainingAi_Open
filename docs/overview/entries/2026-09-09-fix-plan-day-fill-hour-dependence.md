## 2026-09-09 — `plan-day-fill.spec.ts` was red for one hour every day (Lane B)

**What this was.** `#1037`'s E2E job reported a hard failure in
`e2e/plan-day-fill.spec.ts` — a file that PR did not touch. Rather than assume it was unrelated,
the failure was reproduced locally at `e676d6c547`, the commit *before* `#1037`, where it fails
identically. So it is pre-existing and `#1037` did not cause it. `#1037` was merged on the five
required checks before the advisory E2E job finished, which is why it landed with this red.

**The fault.** The spec stubs a plan with two meals — one behind the clock and one ahead — and
asserts the offer counts exactly one. It placed them at `nowHour` and `nowHour + 1`, read from the
real clock and clamped into `00–23`:

```ts
const past = Math.max(0, Math.min(22, nowHour))
const future = Math.min(23, past + 1)
```

At `nowHour === 23` that clamp collapses the pair onto `22:00` and `23:00`. `fillableMeals` bounds
on `hour <= nowHour`, so **both** are already past, the button reads *"Log the 2 meals so far"*, and
the assertion for *"…1 meal…"* fails. It fires 23:00–23:59 Brisbane (13:00–13:59 UTC) — one hour a
day, on every branch including `main`, which is why it looked like a change had broken it.

This is the repo's documented hour-dependent-test class, in the flavour where the fixture *cannot*
be expressed against the real clock at all: there is no "an hour from now" at 23:00.

**The fix.** Drive the boundary instead of waiting for it. The page clock is pinned with
`page.clock.setFixedTime()` to noon in the user's zone on today's date, and the two meals sit at
fixed `11:00` and `13:00`. `setFixedTime` rather than `install` — the app only needs `Date.now()` to
be a known hour, and faking the timers too would stop the screen's own timeouts. The **date** stays
today's, so the day the tab opens on and the rows the spec writes are unchanged, as is the
`afterAll` cleanup that deletes them by name.

**Verification.** Run at 23:4x Brisbane — inside the exact window that used to fail — and green;
the served day was still `2026-09-09`, confirming only the hour is controlled. Mutation-checked:
dropping the `hour <= nowHour` bound in `components/nutrition/plan-day-fill.ts` fails the spec
again, so the assertion still bites. `pnpm lint` clean (0 errors), `pnpm check:rules` **Ran 70 of
70**.

**Not exercised.** Test-only change — no app code, so nothing reaches the device and no APK is
involved. The three non-Brisbane-hour paths of the old fixture are gone rather than retested,
which is the point.

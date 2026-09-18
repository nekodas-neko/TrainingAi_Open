# 2026-09-18 — RV-55/56: two ways a client error became a server fault

**Branch:** `lane-a/rv55-56-route-input-500s` · **Lane A** · batch `route-input-500s-sweep50` · one PR · no migration · unversioned

Both entries describe the Q-496 shape: input the route should have refused reaches the driver, which
answers **500 with an empty body** and writes an `error_events` row. The caller learns nothing and
the fault table fills with client mistakes.

## RV-55 — the vial `id`, dropped rather than conflict-scoped

`POST /api/supplements/[id]/vials` accepted `id: z.string().uuid().optional()` and the adapter
inserted it unguarded. The **parent** was ownership-checked; the id was not — so re-posting another
user's vial UUID raised `23505`. No cross-user write occurred, but it was an existence oracle plus
fault-table noise.

The entry left the shape of the fix open: *"Decide first whether `id` should be accepted at all… If
it does, scope the conflict… If it does not, drop the field."* Answered by reading the callers:

- The only client POST is `components/nutrition/reta/vial-sheet.tsx`, sending `{ ...draft, openedOn }`
  where `draft` is `{ strengthMg, waterMl, syringeUnitsPerMl }` — **no `id`**.
- The local vial mirror is **read-only** (`lib/local-store/index.ts:155`, OR-102a) and there is no
  outbox push for vials, so **no replay needs to choose an id**.

So the field is gone, from the schema, the adapter and the repository interface. **Dropping beats
scoping** because it removes the oracle rather than changing its status code — with `.strict()`, a
request carrying `id` is now a 400 before anything runs.

## RV-56 — shape is not calendar validity

Three routes carried the correct **separator** regex `^\d{4}[-/]\d{2}[-/]\d{2}$` and no calendar
check. Verified: `grep -c` for `isCalendarDate` or `normalizeDateParam` returned **0** in all three.
`2026-02-31` is the sharper case — a real month with a plausible day, which any hand-rolled guard
would wave through; `2026-13-45` is the one people think of.

All three now `.refine(isCalendarDate, …)` after the regex. `isCalendarDate` normalises separators
itself, so the regex stays for the clearer shape error and the two compose.

## The fixture bug, and why it is the part worth recording

The first run of the mutation pass showed **4 failures, not 6** — both manual-bedtime cases passed
against the *unfixed* route. Not a sign the fix was unnecessary: my test sent `sleepStart`, and the
route's body key is `at` under a `.strict()` schema, so those cases were getting their 400 from an
**unknown key** rather than from the date.

A test that is right for the wrong reason is worse than a missing one, because it reads as coverage.
Fixed the fixture, and added the control that proves the point: a **real** day with the same body
returns **404** — validation passed and the handler ran on to the missing-night branch. 404 rather
than 400 is what separates "the date was accepted" from "the body was rejected".

This is the third fixture of the day that passed for the wrong reason, all caught by running the
mutation pass rather than by reading. The pattern: a fixture that does not reach the code under test
still produces a plausible-looking result.

## Verification

`app/api/__tests__/rv55-56-route-input-500s.test.ts`, **10 passing**. Against the unfixed routes,
**6 fail and 4 pass** — and the four are the controls:

| passes either way | why it is there |
|---|---|
| a vial with no `id` is still created (201) | a change that broke creation outright would pass the id case |
| a real day `2026-09-10` is still accepted | the refine must not reject real days |
| the slash form `2026/09/10` is still accepted | `localDateString()` emits slashes; the separator regex stays for a reason |
| manual-bedtime 404s on a real day | proves the date passed validation rather than the body being rejected |

Gates: full suite, Custom Rules **75 of 75**, `tsc --noEmit` clean (real exit code captured — an
earlier `&& echo TSC_OK` in this session reported success off `head`'s exit status, not `tsc`'s),
`check-test-typecheck` none above baseline.

## Not exercised

- **The S25 device.** Server-side only; reaches the phone through a Railway deploy with no APK.
- **`error_events` in production.** The claim that these no longer write fault rows follows from
  answering 400 before the driver is reached; no production row was re-counted to confirm it.
- **The other 68 routes the entry swept.** RV-56 states only these three matched and that
  `app/api/water-log` clamps its `localDate` instead; that sweep was not re-run here.

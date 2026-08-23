## 2026-08-23 — two same-named sessions in a day get their own durations, and one of the three surfaces turned out to be unreachable (Q-362b)

**Branch:** `fix/day-surfaces-session-identity` · **v1.333.2** · user-visible bug fix.

Q-362a (Lane A) added `workoutDurationsById` to `/api/day-log` beside the legacy name-keyed
`workoutDurations`, **additively** — so the coordinated-merge window my entry warned about never
existed, and these consumers could move whenever. Moved.

| surface | was | now |
|---|---|---|
| `components/health/day-detail/day-sections.tsx` | grouped by id, looked the duration up by **name** → same duration on both cards | id both ways |
| `app/session-select/components/week-day-sheet.tsx` | grouped by **name** → one merged block, one chip | grouped by id |
| `components/health/day-overlay-sheet.tsx` | grouped by **name**, and loaded one session's HR under a card listing both | grouped by id, `expandKey` off the name — **but see below** |

**Observed, not inferred.** Against `pnpm dev` with two `Push` sessions on one Brisbane day,
`/api/day-log` returns `workoutDurationsById` carrying `8:00am→8:32am · 32 min` and
`5:00pm→6:22pm · 82 min` while the legacy record still collapses to the single 82-minute entry. The
day screen now prints both.

**Guarded by `e2e/same-named-sessions-one-day.spec.ts`**, which seeds the two sessions itself and
cleans up after. Two things about how it asserts:

- **On the durations, not the card count.** Two cards appeared before the fix as well — `day-sections`
  already grouped by id (Q-391) — and both showed 82 minutes. Counting cards would have passed
  against the bug.
- **On minutes, not clock times.** A duration is the same number in every timezone; "5:00pm" is not,
  and asserting on it would tie the spec to the seeded user's `Australia/Brisbane`.

Mutation-checked: restoring `data.workoutDurations[sessionName]` makes `32 min` disappear and the
spec go red.

### The finding: `DayOverlaySheet` cannot be opened, and a comment said it could

Item (2) above — the wrong-heart-rate bug, the one I filed as *"worse than the duration collision it
was filed for"* — **is not reachable by a user.** `dayOverlay` starts `null` and every
`setDayOverlay` call in the repo is either a `prev => prev ? … : null` updater, which no-ops while
the state is null, or `null` itself. Nothing constructs a non-null value, so the sheet never renders.

Q-110 repointed Health's calendar tap at `/health/day` and left a note saying *"the same overlay is
still opened from other surfaces"*. That was already false when written, and it is what kept ~300
lines of dead UI alive through two sessions of people fixing bugs in it — including mine. The note
is corrected in place; retiring the file is **LB-1**, filed rather than done here because it is a
large deletion and needs one check first: whether `/health/day` still lacks an edit/delete affordance
the sheet had, in which case it is a feature gap and not dead code.

The fix to that file is kept anyway — it is already written, and leaving a known-wrong grouping in a
file someone may re-wire is worse than the four lines it costs.

### Two corrections to my own work, both from the same root

**`check-backlog-pointers.js` accepted an unknown `[domain]` tag** as long as one valid tag sat
beside it. I tagged LB-1 `[app-shell][health]` — there is no `health` pillar — and it passed. One
pre-existing entry (Q-499) had the identical mistake. The check now fails on an unknown tag,
mutation-checked by reinstating Q-499's `[health]` and watching it fire. Both entries retagged.

**Today is 2026-08-23, and I dated this work 2026-08-20** — the session resumed three days on. Caught
by the failing `goal-invalidation.spec.ts`: `/api/body-metadata` reported `"date": "2026-08-23"` with
`steps: null`, which is the aged-local-seed failure the Lane B baton documents, and my earlier
"today's row has steps=8000" reading was the **08-20** row. Not a regression, it fails identically on
clean `main`, and topping today's row up clears it. The changelog entry and this file are dated
correctly; the E2E fixture pins a fixed past day, so it is unaffected either way.

**Verification.** Full local Playwright suite green after the seed top-up (the one failure was the
above, reproduced on clean `main` before and after). `pnpm check:rules` — **Ran 51 of 51**, all
passed. `pnpm lint` 0 errors. `tsc --noEmit` clean. `check-component-size` OK — the comment
correction first pushed `health-content.tsx` 4 lines over its shrink-only baseline and was trimmed to
fit rather than raising it.

**Not exercised.** Nothing on the S25. The E2E harness drives the **web** build. The overlay sheet's
change cannot be exercised at all, by anyone, for the reason above — it is compiled and typechecked
only.

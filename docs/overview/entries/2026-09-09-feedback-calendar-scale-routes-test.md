# 2026-09-09 — the three routes that hand something out of the app (PS-39, 43 → 40)

**Branch:** `test/feedback-calendar-scale-routes` · **No product change.** One finding filed as
**LA-85**.

17 cases over `feedback`, `log-calendar-event` and `scale-ble/pending` — the last of the
user-facing routes on the PS-39 list.

## The finding: the calendar route's scope check may not match what Google throws

`log-calendar-event` sorts a failed insert two ways, and the split is load-bearing in **both**
directions. A **403 `CALENDAR_SCOPE_MISSING`** is a consent state the user has not given, so it is
deliberately kept out of `reportServerError`; anything else is a fault and goes in. Getting it wrong
either buries real faults in `error_events` or hides them from it.

Read from the pinned `gaxios@7.1.4` source rather than from memory:

- `GaxiosError` sets `.code` only from an underlying `cause.code`, or from the body's `error.code`,
  which for Google is the **number** `403`. The route tests `errCode === 'ERR_HTTP_403'` — a strict
  compare against a string — which matches neither.
- The HTTP status lands on `.status`, which the route never reads.
- The message for a scope failure is *"Insufficient Permission"*; the `reason` field
  (`insufficientPermissions`) is **not** joined into it. That message contains none of `403`,
  `forbidden`, `insufficientpermissions` or `calendar`.

If that holds at runtime, a genuinely missing scope answers **500** and is recorded as a fault —
the opposite of the route's own decision. The other half of the same classifier is too **wide**: a
bare `includes('calendar')` means any failure whose text names the API is answered as "grant
permission" *and* kept out of `error_events`. Invisible in both directions at once.

**Not fixed**, and that is deliberate: I have not observed a live Google 403 from here, and
narrowing an error classifier on a guess is what the external-API rule exists to stop. Both
behaviours are pinned by tests that say outright they are recording current behaviour, and LA-85
carries what has to be captured from the device to settle it — `message`, `code`, `status` and
`String(err)` from one real failure in each direction.

## The other cases

- **`feedback` caps the screenshot below the body cap** (500 KB against 600 KB), so an oversized
  image is refused as an image. The fixture sits at 520 KB — *between* the two — because a larger
  one would be caught by the body guard and the screenshot check would never run.
- Title is trimmed **then** cut to 200; a whitespace-only description is stored as `null`, not as an
  empty string that renders as a blank field.
- **`log-calendar-event` authorises on the refresh token, not on `user.id`** — a signed-in user who
  never granted Google access has a session and still cannot write.
- A set with a weight but no rep count renders `× ?` rather than being dropped, so the calendar
  entry cannot quietly disagree with the app.
- **`scale-ble/pending` still lists a row whose decode failed.** The route exists because the
  owner's partner uses the same scale, so a pending row is something needing a human decision;
  hiding the undecodable ones leaves them staged forever with nothing on screen to act on.

## Mutation pass

**18 of 19 caught.** The survivor is an equivalent mutant planted as a control — a no-op TypeScript
cast. The two calendar mutations worth naming: reporting the consent state as a fault, and failing
to report a real one, are both caught, which is what makes the split above actually tested.

## Not exercised

The repository and `googleapis` are both mocked — no database, and no live calendar call, which is
exactly why LA-85 cannot be closed from here. Web/Node only: no device, no native, safe-area,
gesture or notification surface.

# 2026-08-31 — BF-78: a PATCH that was a PUT, and the second half the entry did not see

**Branch:** `lane-a/next` · **Lane A** · server + two Lane B call sites the entry places in the same
change. No APK.

`updateUserProfile` wrote display name, height, date of birth and weight goal unconditionally as
`?? null`, so any body omitting them erased them. One caller already sent a one-field body — accepting
an activity-level recommendation — so a single tap would have taken height with it, and height feeds
the BMR fallback, so the loss would have reached the calorie model rather than stopping at the
profile screen.

**Confirmed latent, not an incident.** Production still reads a display name, height, a date of
birth and a weight goal. *(The entry says height 160; it is **158**, which matches the 158.1 cm on
the DEXA printout. Corrected here because I quoted it.)*

## The half the entry missed, and why fixing only its half would have been worse

The entry's fix was "make the four conditional, the same way the other four already are". That is
the adapter. **The route destroys the distinction before the adapter can act on it:**

```ts
heightCm: heightCm ?? undefined,      // an explicit null becomes undefined
sex: sex !== undefined ? sex : undefined,   // …except this one, which is correct
```

So `{"heightCm": null}` and a body that never mentions height arrived identically. Guard the adapter
alone and the result is a route where **no field can ever be cleared** — trading a wipe-everything
bug for a clear-nothing bug. `sex` was already right, and its `!== undefined` test is the shape the
other seven now follow: the route forwards only keys that are actually present, derived from
`ProfileSchema.shape` so the list cannot drift from the schema.

**Timezone is the one column a null must not clear.** It keys every day window in the app; a user
with no timezone has no "today". Absent and null both leave it alone, and that is now stated in code
rather than being a side effect of a truthy check.

**An empty `set` had to be handled too** — Drizzle rejects `.set({})`, so a body naming no known
field returns the current row instead of throwing.

## The workarounds are deleted, not left

Both defensive resends are gone, which is the part that stops the next reader re-deriving the bug:

- `edit-profile-sheet.tsx` sent five fields it does not edit, with a comment explaining that the
  route was not a true partial update. It now sends the three it owns.
- `goals-section.tsx` sent the whole profile. **That one was a second hazard, not just redundancy:**
  it resent `displayName` and `weightGoalKg` from a possibly stale `user` prop, so saving a goal
  could overwrite a name changed elsewhere in the same session.

## Verified

- **5 DB-backed tests**; **3 mutations killed** — restoring the unconditional four (fails 3 of 5),
  weakening the timezone guard to a presence check, and removing the empty-set guard.
- Full suite **687 files / 5,759 tests** · `pnpm check:rules` **Ran 65 of 65** · `tsc` clean.
- **Exercised through the real route** on `pnpm dev`:

  | PATCH body | Result |
  |---|---|
  | `{"activityLevel":"moderate"}` | only `activity_level` changed; name, height, DOB, goal, tz intact |
  | `{"heightCm":null}` | height cleared, everything else intact — **impossible before this change** |
  | `{"timezone":null}` | timezone unchanged |
  | `{}` | 200, no-op, no 500 |

**`check:rules` caught my own test**, which asserted a date with `toISOString().slice(0,10)` — the
banned UTC-slicing pattern. Right to refuse it: the assertion compares an instant now.

## Not exercised

The two edited sheets are Lane B UI and were not run — their change is a smaller request body, and
the route behaviour behind it is covered above. Device, safe-area and WebView paths do not apply.

## Also updated

Three references to BF-78 in the profile-consolidation entry, including its `Needs:` line, which is
now unblocked. Its claim that the split "is what makes BF-78 dangerous" is rewritten: the danger is
gone, the mess it describes is not.

## 2026-09-07 — The scale stopped inventing a body it had no measurements for (PS-33)

**Branch:** `fix/scale-composition-placeholder` · **Lane A**

### What shipped

**1. An incomplete profile means no composition, not a guessed one.** Both scale ingest routes ran
`heightCm ?? 170` and `ageFromDob(...) ?? 35`, then stored the resulting body fat, BMR and metabolic
age under source `scale_ble` as measured readings — live at the checkpoint, 22 % body fat and a
metabolic age of 37 on a profile with no date of birth in it. A default is right for a display
preference and wrong for an input to a measurement: nothing downstream can tell the fabricated
reading from a real one.

`resolveCompositionInputs(user, ageYears)` in `lib/scale-ble/composition.ts` is now the one place
that decides. It returns null when height, age *or* sex is missing, and both routes fall through to
the weight-only path they already had for an invalid-impedance reading.

**`sex` is in that list although the entry named only height and DOB** — same defect, same two
lines. The estimator reads `sex === 'male'`, so an absent value silently applied the female
Deurenberg and Mifflin-St Jeor terms rather than declining. On the same weight and impedance that is
worth more than 5 percentage points of body fat, which the test pins.

**2. A re-sent weigh-in stops doubling the archive.** `scale_raw_samples` has no unique key
(migration 157's two indexes are both non-unique), so byte-identical bytes inserted a second row —
unlike `oura_raw_samples`, which dedups on `(user, timestamp, tag, body_hex)`.
`insertScaleRawSample` now matches the same three fields and returns the existing id, which matters
because a pending reading is staged by that call and confirmed by the id it hands back.

`compositionSkipped` widens from `!impedanceValid` to `composition == null`. The wire name is kept —
the installed APK reads it — and a new `compositionSkippedReason` (`'impedance' | 'profile'`) says
which it was, so a later APK can stop showing bare-feet copy for a profile gap.

### Verification

- `lib/scale-ble/__tests__/composition-profile-gate.test.ts` and
  `lib/data/postgres/__tests__/scale-raw-sample-dedup.test.ts`, plus the existing scale suites:
  42 passed.
- **Mutation-checked:** removing the dedup's early return fails "the same bytes at the same instant
  archive once"; removing its `user_id` predicate fails the two-accounts case, which exists because
  two people share this scale and a match that ignored the user would hand one person's row id to
  the other.
- The gate tests do not only assert null-returns: they compute the composition both ways and show
  the removed placeholders move body fat by more than a point and change BMR outright. If the two
  agreed, this would be a rounding question rather than a fabrication.
- `pnpm check:rules` — **Ran 68 of 68**. `tsc --noEmit` clean, ESLint clean (the one warning in
  `adapter.ts` is a pre-existing unused `_userId` at :5856, far from this change).
- `pnpm dev`: both changed routes return 401 rather than 500, so the modules load.

**Not exercised:** the device. This is server-side ingest reached through Railway, no APK involved,
but no real weigh-in was posted — the routes were not driven end-to-end with a session.

**No corrective data work was needed or possible.** The owner's profile is complete in production
(height 158, DOB and sex present, read 2026-09-07), so their 99 archived readings were computed from
real inputs. The 22 %/37 reading the checkpoint saw is not on the owner's row, and `claude_ro` is
row-scoped, so no other account's rows can be seen or corrected from here.

### Deliberately not done

**LA-71** — the unique index that would make the dedup a constraint rather than a pre-check. Two
simultaneous posts of the same bytes can still both insert. `CREATE UNIQUE INDEX` cannot be added
blind: the build fails the deploy if any account holds a duplicate, so the migration must delete
duplicates first, and a row-deleting migration is confirm-first under the standing rule. The owner's
99 rows hold 99 distinct pairs — zero duplicates — but other accounts cannot be counted from here,
which is the whole reason it is not shipped on an assumption.

**Version:** 1.436.38 (patch).

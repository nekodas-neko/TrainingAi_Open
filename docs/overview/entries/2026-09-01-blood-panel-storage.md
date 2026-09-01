# 2026-09-01 · Lane A — blood panels, stored (BF-1, engine half)

Branch `lane-a/blood-panel-storage`. Migrations **250** (tables) and **251** (`claude_ro` views).
No native change. **Not device-verified.**

## The schema comes from a real report, and that is the whole method

BF-41's rule is that a schema be written from an actual document rather than a description, and
`docs/clinical-baseline-2026-08-27.md` — the owner's de-identified 2026-04 panel, 58 analytes — is that
document. Four shapes in it break a simpler design, and each one is a column here:

| shape in the report | what a simpler schema does | what this does |
|---|---|---|
| `<0.2` growth hormone | `'<0.2'` as text is uncomparable; `0.2` alone is **wrong** | `value_num` + `value_operator` |
| ranges `2.5–8.0`, `<25`, `>59`, absent | one column and a convention | `ref_low` / `ref_high`, both nullable |
| the date is a **month** | every panel lands on the 1st and lies | `collected_on` + `date_precision` |
| *"Normal (athletic)"* on a creatinine in range | a boolean read off the flag | flag stored verbatim, **verdict derived** |

## The verdict is computed, and `unknown` is a real answer

`rangeVerdict` in `packages/shared/src/health/analyte-keys.ts` decides from the bounds.
CLAUDE.md forbids showing a self-reported judgement as fact, and this report is exactly why: a
creatinine of 109 against 60–130 is flagged *"Normal (athletic)"* and a urea of 9.2 against 2.5–8.0
is *"High (likely protein intake)"*. Those are a clinician's reading. The words are displayed; the
bounds decide the colour.

**And a bounded result against a bound on the same side does not decide.** `>59` with a ceiling of
100 could be 60 or 600, so the answer is `unknown` rather than `in` — returning `in` there would be
the same failure the entry is about, one layer down. Asserted both ways: `<0.2` against a floor of 1
**is** resolved (`low`), because it is below the floor whatever the true value is.

## Six keys were missing and the slug hid it

`ANALYTE_KEYS` named 52 of the report's 58 analytes. The other six — MCHC, RDW, platelets, MPV, WBC,
neutrophils — fell through to `slugAnalyte`, which for those six happens to produce exactly the key
the table would have. Accidental correctness, and indistinguishable from the real thing until one of
them slugged badly. The fix is the six entries; the guard is that the coverage assertion now reads
the labels **out of the report** rather than from a list retyped in the test, because a hand-copied
list moves whenever the table moves and can only ever agree with itself. Verified by deleting a key:
the test names the analyte it can no longer find.

**Found by cross-checking a number, not by reading the code.** Three docs said the panel had 63 rows
and the plan said 41; it has 58. Counting it to correct the prose is what surfaced the gap.

Fifteen rows of the real panel are asserted individually — urea, ALT, cholesterol, LDL, non-HDL and
the total/HDL ratio out; creatinine, eGFR, HDL, triglycerides, glucose and growth hormone in; MCH
low. The plan named creatinine as the one to get right and it is.

## A leaf module, for the reason the last two were

`analyte-keys.ts` imports nothing. `energy-baseline.ts` exists because a client component importing
a constant dragged a node builtin into the bundle and took the Nutrition tab to a 500 — twice, with
two different builtins. A card asking *"is this value out of range"* is exactly that shape of
caller, so the module it asks has no dependencies at all.

## Two guards that fired, and both were right

**The `claude_ro` generator refused to emit a view.** `blood_analytes` has no `user_id`, and the
generator will not guess a scoping path — it fails rather than emitting an unscoped view. The fix is
one line in its `VIA` table, through `blood_panels`, which is the only FK the table has. That is the
fail-closed design doing its job on the first new table since it was written.

**`check-dead-repo-methods` rejected `latestAnalytes`.** It was declared for a consumer this PR does
not contain, and the check exists because that has shipped three times. Removed — it arrives with
the reader that needs it rather than sitting uncalled. Everything left is reached: `saveBloodPanel`
by POST, `listBloodPanels` by GET, `deleteBloodPanel` by DELETE.

## De-identification is a property of the schema

No column here can hold a name, a date of birth or a provider's patient reference, and the route's
body schema is `.strict()` — a body carrying `patientName` is a **400**, verified live, rather than
a field nobody noticed. A test asserts the only identifier-shaped column in either table is
`lab_name`, which is instrument metadata.

This does not replace the crop-before-upload step: extraction sends the document to Google, so
redacting after extraction is too late. That step is Lane B's and is still owed.

## Re-saving replaces

The manual path is the confirm target of a correct-then-save flow: extraction prefills, the owner
fixes a misread decimal, and saves again. Appending would leave the wrong row beside the right one
under the same key, and the unique constraint would then reject the **corrected** one. Asserted.

`saveBloodPanel` branches on an existing row rather than using `onConflictDoUpdate`, because the
unique index is on `COALESCE(lab_name, '')` — a functional index Drizzle cannot name as a conflict
target, and reaching for raw SQL would put the ownership scope in a string.

## What is not built

The extraction route (`POST /api/blood-panel/scan`) and the recommendation consumers are Lane A's
and still owed; the crop step, upload UI and review form are Lane B's. Building the manual write
path first is what makes the extraction call optional rather than load-bearing — the plan says so,
and it is now true.

Verified: full suite **720 files / 6,155 tests**, `pnpm check:rules` **Ran 67 of 67**, and the route
exercised on `pnpm dev` — slash dates normalised, `<0.2` round-tripped with its operator, an unknown
label slugged to `vitamin_d_25_oh` rather than being dropped, `patientName` rejected 400, impossible
date 400, unauthenticated 401, DELETE 200.

**Not exercised:** no UI exists yet, so nothing has been seen on a device; and no image path is built,
so the crop-before-upload rule is stated rather than tested.

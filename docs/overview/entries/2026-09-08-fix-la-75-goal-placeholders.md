## 2026-09-08 — The goals form stops suggesting numbers it cannot recommend (LA-75)

**Branch:** `fix/la-75-goal-placeholders` · **Lane B**

### What shipped

Four placeholders on `components/profile/goal-targets-section.tsx` now name a **unit** instead of a
number: `steps per day`, `hours per night`, `ml per day`, `kcal per day`.

LA-75 named two of them — the water field's `2500` and the calorie field's `e.g. 2500`. Both sit
directly above a `RecommendedValue` control holding the app's own computed figure with a button that
applies it, and the two disagreed. **Measured on the seeded profile rather than argued:** the
recommender produced **3,022 ml** and **2,261 kcal** on the same screen where the placeholders
claimed 2,500 for each.

The two the entry did not name were fixed in the same PR, because the defect is identical and a form
where two fields suggest numbers and two do not is worse than either. The steps field suggested
10,000 — `STEP_GOAL_BY_ACTIVITY.moderate`, so it contradicts its own recommendation for any user who
is not moderate (a sedentary profile is recommended 7,000, which is the exact drift BF-101 was filed
on). The sleep field suggested `8`, which nothing contradicts because there is no sleep recommender
at all — it was changed for consistency, not correctness.

**Where this matters most is where `RecommendedValue` renders nothing.** It returns `null` on an
incomplete profile — it hides rather than guess — so the placeholder is then the only figure on the
screen, with no recommendation beside it to correct the impression. That case is already covered by
`e2e/recommended-goal-values.spec.ts`, which clears the activity level and asserts the affordance
disappears.

### One correction to the entry's own reasoning

LA-75 (quoting the comment on `DEFAULT_WATER_GOAL_ML`) says `weightKg * 33 + bump` lands "nowhere
near 2500 for any real body weight". That is an overstatement — a 76 kg sedentary profile is
recommended 2,508. The fix does not depend on it: a static number in a goal field reads as advice
whether or not it happens to be near someone's, and the argument for removing it is that the real
advice is already on screen.

### Also filed

**LB-63** — the Sleep field is drawn as a different kind of control from its three siblings
(`border-0 bg-transparent p-0 h-auto` against their `border-border bg-muted/60`), so it renders as an
unbordered strip in a column of boxed inputs. Pre-existing, and visible in the screenshot taken to
verify this change. Deliberately **not** fixed here: restyling a control is a design judgement and
this was a copy fix, so mixing them would have made both harder to review.

### Verification

- Rendered on a local `pnpm dev` at the 412 px S25 viewport, signed in as the seeded user, and read
  back off the DOM: all four placeholders are the new strings, and both empty fields (sleep, calorie)
  show them on screen beside the recommendations quoted above.
- `pnpm check:rules` — **Ran 70 of 70**. `tsc --noEmit` clean, lint 0 errors (the two warnings in
  `lib/session-icon.tsx` are pre-existing), full unit suite green.

**Not exercised:** the APK. This is placeholder copy in a WebView-rendered form, so the device path
is the same code as the web path and a Railway deploy carries it with no rebuild — but the rendering
was confirmed at the S25 *viewport*, not on the S25. No test asserted these strings before or after;
no spec selects by placeholder on this form, which is what makes the change safe rather than what
makes it verified.

Patch bump — user-visible copy.

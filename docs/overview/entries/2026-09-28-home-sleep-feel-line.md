# 2026-09-28 — LA-136: Home shows the sleep rating he actually gave

**Lane B.** Branch `feat/home-sleep-feel-line`. v1.479.0.

## What shipped

The sleep line returns under the mood card, built to
[`docs/design/2026-09-27-four-screen-mockups.html`](../../design/2026-09-27-four-screen-mockups.html)
§LA-136 as approved 2026-09-27 — divider, purple moon, his own word, five dots and `N/5` at the
right edge, captioned *"Your rating, not a score"*.

- **`lib/hooks/morning-sleep-feel-scale.ts`** (new) — the pure stored-1–5 → label/dot mapping.
- **`lib/hooks/use-morning-sleep-feel.ts`** (new) — the local-first read.
- `userId` threaded `session-select-content.tsx` → `HomeCardWidget` → `SleepFeelLine`, because a
  local-store read needs the store's owner. A stable string, so the widget's `React.memo` is intact.
- **`components/home/sleep-feel-line.tsx`** (new) and one call site in `home-card-widget.tsx`.

**The cost the entry called non-optional is paid — and the entry understated it.** Home is in the
persistent tab shell and never unmounts, so a hand-rolled `useEffect(() => { cachedFetch(…) }, [])`
paints once and holds that value until the app is killed (Q-402, twelve times in this repo).
Something must ask for a new value when a write clears the old one.

**But the entry prescribed `useCachedValue`, and that would have been the wrong half of the rule.**
`day_checkins` is a **local-first domain**: `morning-checkin-sheet.tsx` writes
`store.upsertDayCheckin` + `queueMutation` before it ever reaches the network. A rating given
offline — and a morning with no signal is the ordinary case for this question — exists on the device
and nowhere else until the outbox drains, so a `useCachedValue` read shows **nothing** until then and
blanks again on restart. That is the inverse of offline-first this repo has a strict rule about, and
it is exactly the Q-488 shape: a write that updates the local store behind a UI that reads the
server. So the read is local-first (`store.getDayCheckin(today, 'morning')`, API as the fallback for
a store that is unavailable or unhydrated), which `useCachedValue` cannot own — hence the documented
escape hatch, **`useInvalidationRefetch`**, plus a synchronous `readCacheSync` seed in an effect for
instant paint.

It subscribes to the **existing** `day-checkin:` prefix that the sheet's own
`invalidateCheckinAffectsPrescription()` clears — so "registration in every write group touching
`day_checkins`" is satisfied by reuse rather than by adding a key to each group, and because that
group is called whether or not the push succeeded, the **offline** save refreshes the line too.
`:morning` is required: `day-checkin:<date>` is already the EVENING payload's key. TTL is
`TTL_SHORT`, its sibling's own expression, so no TTL divergence is introduced.

## ⛔ The thing the entry did not say, and the line would have been wrong without it

**The morning sheet writes a neutral `3` for a scale he never tapped.** `NEUTRAL_SCALES` in
`morning-checkin-sheet.tsx` seeds both scales at 3 and saves them unconditionally, with
`sleepQualityFeelTouched: false` recording that he did not answer. So a raw column read puts

> OK · 3/5 · *Your rating, not a score*

on Home for a value nobody gave — **the fabricated `Sleep: OK` this entry exists to undo, down to
the string.** `answeredMorningScales` is the repo's one place that decides "did they answer?", and
its own header records four earlier readers that took the column directly and were calibrating,
plotting and displaying **78 values nobody gave**. This read goes through it. The e2e control that
removes the gate fails with *"an untouched seed reached Home as a rating"*.

**And the scale is stored inverted while its labels are not** — `1 = slept great … 5 = terrible`
against `MORNING_SCALES.labels` running worst → best in *screen* order. `storedOrderLabels` is the
repo's own reverse of that. Getting it backwards tells him he slept terribly after his best night,
which is worse than showing nothing, and no source-matching guard can tell `6 - stored` from
`stored` — hence a unit test that calls the mapping.

## A stated deviation from the drawing

The mockup labelled 4/5 *"Slept well"*; the shipped line says **"Good"**, the word on the scale he
actually taps. This entry exists because Home told him something he never said — showing a rating
back to him in different words than the one he chose is a smaller version of the same thing. The
caption, which the entry names as part of the approval, is unchanged.

## Verified

- **`lib/hooks/__tests__/morning-sleep-feel.test.ts`** — 6 tests. The direction is asserted by
  **calling** the mapping at every point on the scale and against the sheet's own label array
  (derived, not restated), plus the untouched-seed case through `answeredMorningScales`.
- **`e2e/la136-home-sleep-feel-line.spec.ts`** — 2 tests at 384 px dark: a rating he gave renders his
  word, four filled dots (counted by computed colour), `4/5` and the caption, inside the mood card
  and below its content; an untouched neutral 3 renders **nothing**.
- **Control-run three ways, each mutation asserted as applied:** unwire the component →
  *"the sleep line never rendered for a rating he gave"*; drop the touched gate →
  *"an untouched seed reached Home as a rating"*; flip `6 - stored` → the label and position
  assertions fail. Restored, 4 passed.
- Rendered at 384 px dark and compared against the approved drawing.
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean.

## Two things that cost a run each

1. **The e2e locator went strict-mode ambiguous, twice.** *"Exercise Readiness"* labels both the mood
   **widget** and a separate readiness **prompt** banner, and both are clickable — so neither the text
   nor the role separates them. The **element** does: the widget is a `div[role="button"]`, the
   prompt a real `<button>`. Both failures read *"the mood card never painted"* while the card was on
   screen the whole time; the error's own accessible-name dump is what showed it.
2. **The pure mapping could not be unit-tested where it first lived.** Importing the hook pulled the
   `.tsx` timezone provider into the unit project and the file failed to transform. Splitting the
   mapping into its own React-free module fixed it and is the better shape anyway.

## Deliberately not done

The entry's **nutrition-prompt half** is not built — it changes what the model is *told* about him
rather than what a screen shows, and `app/api/**` is Lane A. Filed as **`LB-182`** with the
`answeredMorningScales` requirement stated, so it cannot repeat the untouched-seed bug in a prompt.

## Not exercised

Not device-verified. Rendered in Chromium at 384 px, the width the mockup was approved at, which is
not a Samsung WebView. The morning check-in payload was **stubbed at the route**, so the real
`/api/day-checkin` response shape was not exercised — and **neither was the local-first path, which
is the one that matters most here**: `getLocalStore` returns null in the web sandbox, so every run
above took the API fallback. The offline case this rewrite exists for (rate sleep with no signal,
see it on Home immediately, still there after a restart) is **reasoned from the write path, not
observed** — it needs the APK. The live invalidation (answer the sheet, watch the line update
without leaving the tab) is likewise reasoned from `useInvalidationRefetch`'s subscription. No offline-first, native, safe-area,
gesture or notification surface is touched.

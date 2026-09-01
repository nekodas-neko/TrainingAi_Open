# 2026-08-31 · Lane A — a night that is still filling, and a builder that knows you are injured

Branch `lane-a/sleep-provisional`. Three items, no migration and no sync-push change, so the whole
batch reaches the device through a Railway deploy — **no APK needed**.

## BF-83 — the engine half: `provisional` on every sleep row

The owner sent two screenshots of the **same night four minutes apart**: 6 h 15 m at 6:44 and
7 h 40 m at 6:48, with every derived number moving, including the 30-night average it was being
compared against. Nothing distinguished the first reading from a finished one.

**The entry listed two candidate mechanisms and the answer was a third.** It proposed either "the
night was still draining" or "the client painted a stale cache", and said `updated_at` could not
separate them. The client half was already ruled out from code. Production settled the rest: the
batch covering 4:46 → 6:38 was **recorded at 6:42**, two minutes before the 6:44 screenshot. The raw
data was there; the *row* was stale, because the rollup had not re-derived from it yet.

That reversed the design. The obvious measure — is the newest ingested sample close to this night's
end? — would have called that night settled four minutes before it grew by 85 minutes.
`getSleepCoverageEnd` reads the **rollup watermark** instead, resolved through the clock anchors:
it only advances when a run *completes*, so it answers "how far has the derivation reached" rather
than "how far has ingest reached", and covers both mechanisms.

- `lib/sleep/provisional.ts` — `isNightProvisional(sleepEndMs, coverageEndMs)`.
  `PROVISIONAL_COVERAGE_MARGIN_MS` is **imported from the sensing-span bridge gap**, not chosen: a
  night can still grow while coverage sits within one bridgeable gap of its end, and a hardcoded
  60 minutes would silently stop being right if that constant moved.
- `getSleepCoverageEnd` on the repository; `/api/sleep-sessions` returns `provisional` per row.
- Computed per request, never stored — the thing it describes changes without the row changing, so
  a stored flag would be stale exactly when it mattered.

Measured against production: last night sat **97 minutes** past coverage and every older night
**1516 minutes** or more, so the margin separates them with a wide gap rather than a fine one. On a
normal morning the badge clears roughly half an hour to an hour after wake.

**Lane B owes the badge and — the half worth not forgetting — excluding a provisional night from
the recent-nights average it is compared against.** That moving baseline is in the owner's
screenshots.

## BF-68 — the program builder now knows you are injured

`injur` appeared **zero times** in the entire builder path: a `.strict()` 13-field wizard payload
with no injury data and no free-text field, so a sore lower back could not reach it.

The important choice is *where* the constraint is applied. Both routes now filter the **candidate
list** with `excludeInjuredExercises`, extracted out of `injurySafeAlternatives` — so the builder
uses the same predicate the mid-workout swap sheet substitutes by, and cannot program an exercise
the swap sheet would then offer to replace. An exercise that is not in the list is one the model
cannot return; an instruction not to program deadlifts is advice. The test that shows the difference
is Good Morning: a hamstring exercise by name, loading the injured back in a secondary role.

`formatInjuryContext` (`packages/shared/src/workout/injury-context.ts`) is the shared line the entry
asked for, exported for **BF-44** to import rather than write a second one.

**Not done, and why.** The builder chat does not *create* an injury record: it is a `generateObject`
route with no tools, and converting it to a tool-calling flow would restructure the builder's whole
response contract. It tells the user to log it under Health → Injuries instead — which is also what
makes the constraint outlive the conversation, the entry's actual complaint. The wizard UI half is
Lane B.

**New behaviour to know about:** when every candidate for the chosen equipment and muscles involves
an injured area, generation **refuses with a 400** naming the muscles rather than programming
through the injury.

## Two findings recorded rather than acted on

- **BF-80** — read the Capacitor source: `BridgeWebViewClient` already forwards
  `onRenderProcessGone`, and `WebViewListener`'s default returns `false`, the documented "kill the
  app" answer. So the missing piece is a listener, not a `WebViewClient`, and the fix is correct
  whether or not the renderer-death hypothesis holds. Left for the next **native** batch — it needs
  an APK, and this one does not.
- **BF-84** — gated on the owner. Its own text says the fact-vs-hint question must be settled before
  scheduling, and the engine half is a row plus a sync domain plus the inference path; that was
  transcribed into a `Gate: owner` field, since `next-item.js` had it at #2 of READY with nothing
  saying it was waiting.

## Tooling

`scripts/lib/keep.js` could not see a `Keep:` stated inside a blockquote banner — neither the match
nor the continuation loop, which *breaks* on a `>`. BF-67 and BF-81 wrote their residue that way and
read as unstarted work at the top of Lane A's READY list the day after they shipped, which is the
exact failure that file exists to prevent.

## Not exercised

Native SQLite / Capacitor plugins, safe-area insets, Samsung WebView rendering, and the on-device
APK path — none of this batch touches them. The sleep flag and both builder routes were exercised
against the local dev Postgres and by prompt-capture tests; **no on-device run**. The Gemini calls
themselves are mocked, so what is pinned is the prompt the model receives, not what it returns.

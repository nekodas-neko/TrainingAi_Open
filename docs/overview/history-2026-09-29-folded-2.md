# Session journal — batch folded 2026-09-29

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-28-movement-balance-palette-clash"></a>

# 2026-09-28 — RV-208 ③: the movement categories stop borrowing session colours

**Lane B.** Branch `fix/movement-balance-palette-clash`. v1.480.1.

## The defect, and it was worse than the entry said

Health → Training's calendar and load legend colour sessions by **position** (`SESSION_PALETTE`,
`packages/shared/src/session-palette.ts`), so "Pull is green" is the owner's session *order*, not a
name map. Two cards down, Movement Balance coloured the same three words from its own map — and two
of the three were session colours outright:

| row | token | nearest session hue |
|---|---|---|
| `legs` | `--accent-green` | session green, **0°** |
| `pull` | `--accent-purple` | session purple **10°**, session indigo **20°** |
| `push` | `--accent-cyan` | session blue, 45° |

The entry recorded the collision; the `20°` to indigo it did not. So the same three words carried two
colour maps within a thumb's scroll — and for the owner's stated order, *transposed* rather than
merely different.

## Why "add two new hues" was not available

The entry's proposed fix was *"adding two to `app/globals.css` with contrast checked there"*. That
assumes two comfortable hues exist. **Scanned rather than judged** — a category hue must clear
**two** systems, `SESSION_PALETTE`'s six Tailwind hues (red ≈27°, amber ≈70°, green ≈145°, blue
≈255°, indigo ≈275°, purple ≈305°) *and* this app's four `--accent-*` tokens. Nine constraints on a
360° wheel:

- at **40°** separation the only free band is **~345–347°** — room for **one** hue, not two;
- at **35°** — `340–352` plus slivers at `105–110` and `180–220`;
- at **30°** a three-hue set exists (≈115 / 177 / 346), but `115` sits wedged *exactly* 30° between
  amber and green.

There is no good four-colour answer while sessions own six hues by position.

## So the colour stopped carrying the identity

It never had to. Every row already renders `PATTERN_LABEL[row.pattern]` beside its own bar, stacked
and individually labelled — hue was **redundant encoding**. One accent for all three:

- cannot collide with a session colour, by construction;
- stays correct when the owner reorders his sessions, which the old map could not;
- spends none of the thin free hue space.

**`other` stays muted, and nothing is green or red.** These are four categories, not a scale. A
lightness ramp was considered and rejected for the same reason the card's own comment gives for not
colouring push green: it would imply an ordering this card deliberately refuses to assert.

## Verified

- **`components/health/__tests__/rv208-movement-category-hues.test.ts`** — 4 tests asserting the
  **arithmetic**, not the literals: it parses the `--accent-*` hues out of `app/globals.css` (both
  themes) and the tokens out of the card's own `PATTERN_COLOR`, then requires ≥25° from every
  `SESSION_PALETTE` hue. It also fails a raw Tailwind session colour name, and any `accent-green` /
  `accent-red` / `destructive` in that block. A first assertion guards the parse itself, so the test
  cannot pass by matching nothing.
- **Control-run three ways, each mutation asserted as applied:** the palette exactly as it was on
  `main` → *"accent-purple (295°) is 20° from session indigo (275°)"* and *"accent-green implies a
  verdict this card does not make"*; only the subtler `pull` half restored → the 20° failure alone;
  a raw `bg-indigo-500` → *"PATTERN_COLOR uses the session colour "indigo" directly"*.
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean · `check-contrast` unchanged (no token added).

## Also done: a Lane A item that was invisible

`RV-208` ① had been marked *"NOT Lane B"* in prose and left sitting inside a `Lane: B` entry — so
Lane A was never going to see it, because **the lane field is what routes work**. It is now
**`LB-183`** (`Lane: A`): the fourth live time-of-day form (`formatTime12h` → `6:40am` against
`formatTimeOfDay`'s `6:40 am`, one character in `packages/shared`), plus the two minutes-of-day
formatters that need a new shared helper before Lane B can convert their call sites.

## What is left on RV-208

② shipped but **owes a render** — the seeded account has no weights on any of the eight load
surfaces, so the added space was never seen at 412 px; the residual risk is a wrap in two tight
cells, not a wrong value. ④ dates and ⑤ brand-in-food-name are **copy decisions** and remain
untouched. With ① moved out and ③ shipped, nothing buildable by this lane remains.

## Not exercised

Not device-verified. The card was not rendered on the seeded account either: it needs logged
workouts across push/pull/legs in the window, which that account does not have, so **the change was
verified by the hue arithmetic and by source, not by looking at it**. The risk that carries is
aesthetic, not functional — three bars now share a hue and are told apart by their labels — and it
is the kind a device pass or the owner's eye settles. No offline-first, native, safe-area, gesture or
notification surface is touched.

<a id="2026-09-28-prescribe-excludes-completed-session"></a>

# 2026-09-28 — LA-177: the completion-time prescribe call excludes the session that just finished

**Lane B.** Branch `fix/prescribe-excludes-completed-session`. v1.478.3.

## What shipped

`components/workout-screen.tsx` — the post-completion `POST /api/ai-periodization/session/<id>/prescribe`
now sends `{ excludeSessionId: wsId }` with a JSON content type, via a new pure helper
`components/workout/prescribe-request.ts`. Tests: `components/workout/__tests__/prescribe-request.test.ts`
(4 behavioural cases) plus 2 wiring cases in `components/__tests__/workout-completion-surface.test.ts`.

**`workout-screen.tsx` ends 9 lines SHORTER than it started**, which is how this landed at all — see
*The size check refused the append* below.

## The defect, verified rather than taken on trust

Every claim in the entry checked out against `main`:

- The completion call sent `{ method: "POST" }` and no body (`workout-screen.tsx`, in `completeWorkout`).
- `signals.ts:335` — `last5.find(s => s.completedAt != null && s.id !== excludeSessionId)`. With no
  exclusion the newest completed session *is* the one that just finished, so `hoursSinceLastSession`
  reads about 0.
- `emergency-deload.ts:34` — `hoursSinceLastSession !== null && hoursSinceLastSession < 36 && soreMusclesInSession.length >= 3`.
  So a lifter who logged three sore muscles is offered an emergency deload for their **next** session.
- The route has always accepted it (`prescribe/route.ts:43`, `excludeSessionId: z.string().optional()`)
  and its own comment states the contract: *"excluded from the hoursSinceLastSession gap so a fresh
  completion can't self-trigger the emergency deload (W5 §4.2)"*. The client stopped honouring it when
  the trigger moved off the server.
- The deload is built without the model, so no `ai_call_log` row records that it happened.

## One correction to the entry's fix

It prescribed `body: JSON.stringify({ excludeSessionId: wsId })` flat. **`workoutSessionId` is `string`,
initialised to `''`** (`lib/stores/workout-store.ts:149`, reset at `:240`) — not `null`. So the literal
form would not 400; it would send `""`, and that is worse than it looks:

- `signals.ts` compares `s.id !== ''`, which matches every real session, so the exclusion does nothing.
- `generate-prescription.ts:286` keys its dedup cache on `${excludeSessionId ?? ''}`, so `""` produces
  **the same key as the no-body open path** — losing the separation the entry itself calls correct
  (*"a completion-path plan is not interchangeable with an open-path one"*).

So the field is **omitted** when there is no id, not sent empty. That is also the repo's standing rule
for a different reason (`.optional()` rejects `null`; clients omit rather than send empty), and here it
is load-bearing for the dedup key rather than merely tidy.

## What was deliberately not touched

The **open-time** prescribe call (the `aiPrescriptionPending` effect) stays bodyless. At open time the
newest completed session genuinely is in the past, so the gap it measures is the real one and excluding
it would discard the signal. Only the completion path needs the exclusion. The guard asserts both, so a
future change that "consistently" adds the body to the open path fails.

## The size check refused the append, and the extraction was the right answer

`check-component-size` failed: `workout-screen.tsx` went to 1854 against an 1833-line baseline. Its
message is *"this file is a known hotspot; extract, do not append"*, and the baton already carried the
lesson that trimming comments to squeeze under is the wrong response.

Two extractions, both owed independently of this fix:

- **`prescribe-request.ts`** — the request-init logic and the reasoning behind it. This also made the
  test better: the shape is now checked by *calling* the helper rather than by matching source text.
- **`beep.ts`** — `playBeep`, 17 lines of `AudioContext` with no component state, called from one
  timer. It had no business in the orchestrator.

Final: **1824 lines**, under the baseline, a net reduction of 9. The file got smaller while gaining a
fix, which is what that check exists to produce.

## Verified

- **16/16 across the two files, control-run four ways with each mutation asserted as applied**: making
  the helper send `''` instead of omitting fails 2; dropping its content type fails 1; reverting the
  completion call to the bodyless literal fails 1; giving the OPEN-time call the exclusion too fails 1.
  Restored, 16/16.
- **⚠ Two earlier controls passed, and both times the control was at fault rather than the guard** —
  recorded because it is invisible from the result. One mutation removed the *first* `Content-Type`
  header in `workout-screen.tsx` rather than the one under test; there are **four**. Correcting it
  exposed a real weakness it had been masking: asserting that header as a bare substring was satisfied
  by one of the other three fetches, so the guard was checking less than it claimed. That is what
  pushed the shape assertions out of source-matching and into the helper's own unit test. **A control
  that does not change the file proves nothing, so the mutation is now asserted (`assert new != s`)
  before the run.**
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean.

**Not exercised:** not run on the device, and **no spurious deload was observed** — the entry says so
too, and it cannot be reconstructed because `session_periodization` is overwritten in place rather than
kept as history. What is established is the code path, not a count of times it fired. The fix is a
request-body change on a client fetch, so no offline-first, native, safe-area, gesture or notification
surface is touched; the deload UI itself is unchanged.

<a id="2026-09-28-request-bugfix-owns-inbound-pr-review"></a>

# 2026-09-28 — BugFix reviews inbound PRs itself; the handoff to Review is removed

**Branch:** `request/bugfix-owns-inbound-pr-review` · Orchestrator

Owner, after reading how an inbound PR was routed: *"I think bugfix should be able to review PR's
right? and update the PR/issue in github without sending to Review."*

## He is right, and the handoff was the defect

Yesterday's design had BugFix **watch** the channel and Review **read** the diff. That split was
added in good faith — reviewing a patch against repo rules looked like Review's competence — and it
put the first visible response behind a **weekly sweep**. The contributor's complaint was precisely
that: *"from his end it just goes silent."*

Fixing ownership on 2026-09-27 did not fix the silence, because the handoff replaced it. **One
role, one channel, one response.** BugFix already traces a symptom to `file:line` and already knows
the recurring bug classes from `CLAUDE.md`; reading a patch against those same rules is the same
competence, not a new one.

## What changed

- **`docs/agents/README.md` §1** — BugFix owns GitHub end to end: monitors, reads the diff, posts
  the review, may approve, never merges.
- **§ Review** — no longer owns inbound PRs. The section says so explicitly rather than being
  deleted, because it asserted the opposite yesterday and a silent reversal is how a contract drifts
  from what people remember.
- **Both pickup prompts** — BugFix's now says review-and-answer, not acknowledge-and-hand-over.
  Review's says inbound PRs are not its own and warns against taking them back or double-reviewing.

## One narrowing I added, flagged so it can be struck

**A PR touching auth, sessions, secrets or a migration still gets a second, deeper read** — a
`/security-review` pass or a `Lane:` to Review — **after BugFix has already responded, never
instead of it.** Those are the owner's own carve-out categories; an intake-depth read is the wrong
depth for a second credential path, and `#1607` is exactly that shape. The author never waits on
the escalation, so it costs nothing in response time — which was the whole point of the change.

This is a narrowing of a direct instruction, so it is recorded here plainly: if the owner wants
BugFix to be the only reader on those too, strike the escalation paragraph in §1 and the matching
line in both prompts.

## Still true

**Never merge an inbound PR.** Unchanged, and now attached to "the reviewing agent" rather than to
Review by name, since the reviewing agent is normally BugFix.

**Not exercised:** documentation only. Gates: `Ran 83 of 83` Custom Rules,
`check-doc-links: OK (898 files)`.

<a id="2026-09-28-request-owner-answers-round-3"></a>

# 2026-09-28 — eight more owner answers, and three of them refused the question

**Branch:** `request/owner-answers-round-3` · Orchestrator

Eight decisions put to the owner in two rounds. Five were straightforward; three replaced the
question with a better one.

| Entry | Answer |
|---|---|
| `LA-126` | Delegate the tap to Device Verification — **and the tap should not exist** |
| `BF-137` | **Refused the date.** Make the estimator supplement-agnostic instead |
| `Q-4` | Wearing the Polar H10 tonight |
| `Q-222` | Add confirm/reject to a detected activity |
| `LA-61` | Normalise on the way in, plus the functional index |
| `LA-65` | Five exercises fit the hour — **and he wants mixed set counts** |
| `RV-119` | Redraw the lost Home-banner mockup and re-approve |
| `RV-161` ⑤ | PS-17 moves up. Entry fully closed |

## `BF-137` — the date was the wrong question, and the data already exists

He refused to supply the GLP-1 vial start date: *"Try incorporate supplements usage with other
factors. We want it to be supplement agnostic essentially."*

**Checked, and it is buildable from what is already stored.** `supplement_logs` (`schema.ts:1149`)
holds a dated log per intake with a `doseText` snapshot — kept deliberately so that titrating
2 mg → 4 mg does not rewrite history. That is exactly the series a maintenance estimator needs:
what, at what dose, from when. And `grep supplement` across `packages/shared/src/health/**` and
`lib/health/**` returns **nothing** — the estimator cannot see any of it.

So the entry was blocked since 2026-09-16 on a date that was derivable the whole time. Re-laned
`T`: it changes a computed number he reads daily, so a Tuning proposal comes first.

## `LA-126` — a target the app can compute should not wait on a tap

He delegated the tap to the device agent, **explicitly overriding this entry's own line** that
nobody may run it for him. Recorded as his authorisation rather than as an agent deciding it was
acceptable.

His second sentence is the larger one: *"this should be calculated by us rather than manually
set."* Filed as **`OR-201`**, and it is the same change `OR-191` asks for from the other end — a
number defined by a formula cannot also be a number he sets by hand. Building either alone leaves
the contradiction standing, so they work together.

## `LA-65` — the answer closes the entry and opens a requirement

Five exercises are fitting the hour *"at 2 sets per one"*, so the two errors that cancel at five
are doing no harm and the constant stays. The entry becomes a `Reference:` whose job is stopping
someone "fixing" them into the overrun he originally reported.

His second sentence — *"might need to mix and match to get 3 sets where needed"* — makes the
sessions non-uniform. **Checked before filing:** `duration-model.ts` costs time per **set**
(`SET_SETUP_SEC`, `SECONDS_PER_REP`), not per exercise, so mixed counts price correctly with no
change. What is **not** established is whether the prescription generator will actually produce
them, or whether BF-128's "five exercises" carries an implicit uniform-2. Lane A's to verify. It
also raises the stakes on `BF-201`'s p75 margin, since a 5×3 session is materially longer than a
5×2.

## Still owed

The `RV-119` redraw is the Orchestrator's next piece of work. `Ask: owner` is **21 → 13**.

**Not exercised:** documentation only. Gates: `Ran 83 of 83` Custom Rules, `check-doc-links`,
`check-backlog-pointers` — clean by exit code.

<a id="2026-09-28-request-owner-answers-round-4"></a>

# 2026-09-28 — four more answers, and a write that now needs sequencing

**Branch:** `request/owner-answers-round-4` · Orchestrator

`Ask: owner` **8 → 6**. All four entries are re-laned to whoever builds them.

| Entry | Answer | Now |
|---|---|---|
| `OR-191` | **Apply 1,618 kcal** — the 09-14 recommendation was meant to land | Lane A |
| `LA-169` | **Prescribe reps only** on bodyweight movements | Lane A |
| `LA-172` | **Type from time AND from an explicit tag** | Lane A |
| `TN-82` | **Announce the estimate, correct in one tap** | Lane B |

## `LA-172` was wider than the option offered

Asked whether to derive a meal type from the suggested time *or* match by log window, he answered:
*"Give it a type by its time; as well as what its tagged with."* So both — the type resolves
**tag → derived-from-time → none**, with the time as the default and an explicit tag winning. That
keeps a wrong derivation visible and correctable rather than silently wrong, which is the failure
the window-matching option had.

## `OR-191` creates a sequencing hazard worth naming

Applying 1,618 is a write to his live nutrition targets. So is `LA-126`, where the device agent
accepts the post-`RV-66` recommendation — and `OR-201` says a computable target should not need a
tap at all. **Three things now want to set the same field.** Recorded on `OR-191`: do not apply the
number by hand *and* have DV accept a recommendation; whoever goes first states which number
landed. All of it follows the standing production policy — snapshot, affected rows against
prediction, stop on mismatch.

## `TN-82`'s cost is carried into the entry, not waved off

Announcing an estimate shows him the app's guess before he corrects it, which is the anchoring that
contaminated 62 days of `energy_level`. It does not vanish here — it **changes shape**: a correction
is a stronger signal than a rating because he only acts when the app is wrong, but silence then means
either *"right"* or *"never looked"*.

So the build must distinguish an explicit accept from an untouched default, using the `touched` flag
convention `sleepQualityFeel` already has (`TN-57`). Without it every unopened morning reads as
agreement, and the validation problem returns wearing this feature's clothes. Written into the entry
rather than left in this journal.

## `LA-169` will move a number he reads

23 of September's 49 unplanned sets are bodyweight, so adherence changes the day this ships. Named
on the entry: say so when the first figure moves, or it reads as a regression.

**Not exercised:** documentation only. Gates: `Ran 83 of 83` Custom Rules, `check-doc-links`,
`check-backlog-pointers` — clean by exit code.

<a id="2026-09-28-rv103-inflight-join-serves-prepush-body"></a>

# 2026-09-28 — RV-103's stale card is the in-flight join, not a dead subscription

**Lane B.** Branch `docs/rv103-inflight-join-serves-prepush-body`. Docs only — no code, no version bump.

## What the entry owed, and what it guessed

`RV-103`'s failure line and Retry shipped and PASSED on device (sweep 4a). One follow-on remained:
deleting a food immediately after a Retry left the card on **1,454** for 16 s+ while the server said
1,534; deletes without a Retry refreshed fine; a tab swap corrected it. The entry's hypothesis:

> It looks like the Retry path leaves the card's refresh subscription dead.

**That is wrong, and checking it is what found the real mechanism.** `useInvalidationRefetch` holds its
callback in a ref, keys its effect on the joined key string, and unsubscribes only on unmount. Nothing
in `retry()` touches it. The subscription fires; its refetch is swallowed one layer down.

## The mechanism

`cachedFetch` **joins** an in-flight request rather than firing a second one — `cache.ts:396`, *"If a
request is already in-flight for this key, join its waiter list"* — and every joiner receives that
request's body.

The delete fires `revalidate()` twice on purpose (immediately, then via `pushThenRevalidate`), exactly
as `log-food.ts` does:

1. **Round 1** invalidates and refetches while the outbox push has **not** landed. Its GET asks a server
   that still has the food and answers **1,454**.
2. **Round 2** invalidates again after the push — and its refetch finds round 1 still in flight, **joins
   it, and is handed 1,454**. No further request is made.
3. The card holds the pre-delete figure until something remounts it. That is the tab swap.

**Why Retry made it reproducible:** `retry()` runs `fetchWithRetry`, whose ladder is 2.5 s + 5 s + 7.5 s,
so a request is far likelier to still be in flight when the push lands. Without a Retry, round 1 usually
resolves first, round 2 fires a genuine request, and the card corrects. **The "16 s+" is that ladder, not
a coincidence** — which is the detail that pointed here rather than at the subscription.

## The clincher

**`clearAllCache()` clears `inFlightRequests`. `invalidateCache()` does not.** A response already in
flight when the cache was cleared is by definition pre-invalidation data, and the reasoning that put
that line in one function applies to the other. That asymmetry is why this reads as an oversight rather
than a deliberate trade.

## Why it is Lane A's, and why the one-liner is only half

The fix is `lib/sqlite/cache.ts` — Lane A's by the path list. Two levels:

- **Cheap:** drop the key from `inFlightRequests` inside `invalidateCache`. Stops new joiners.
- **Complete:** a per-key generation counter — bump on invalidation, capture when a request starts,
  discard the response if it no longer matches. **The cheap version does not close the hole**, because
  the *original* caller still awaits its own promise and will write the pre-push value when it resolves.
  It narrows the window; shipping it as the fix would leave a rarer version of the same bug.

Recorded on the entry so Lane A does not have to re-derive any of it, and so nobody ships the one-liner
believing it is done.

## Not done

**No reproduction was run.** This is traced from source against a device report; the device case is a
delete immediately after a Retry with the balance route slow rather than blocked. I did not attempt the
fix — `lib/sqlite/**` is Lane A's, and a change to the shared in-flight dedup touches every cached read
in the app, which is not a thing to do from the surface lane on a hypothesis I cannot exercise on the
device.

The entry keeps a `Keep:` noting the shipped half, so it does not read as unstarted.

<a id="2026-09-28-rv153-cache-mirror-is-lane-a"></a>

# 2026-09-28 — RV-153's remaining fix is the cache layer, not a store

**Lane B.** Branch `docs/rv153-cache-mirror-is-lane-a`. Docs only — no code, no version bump.

## Why this is a re-lane and not a build

`RV-153` was Lane B's #7 and its device probe is already answered (sweep 4a: ~120k characters of
`localStorage` rewritten per Home tap, `friends-feed` at 459k). It was re-laned from `DV` to `B` on
2026-09-26 on the reasoning *"stores and hooks are Lane B"*. That is true and is not where the bytes
come from.

**Every key the probe named is written by one line** — `lib/sqlite/cache.ts:82`,
`localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry))`. `workout-data:meta`,
`workout-card:<id>`, `sleep-sessions`, `friends-feed`, `oura-hr-day:<today>`, `exercise-library`,
`saved-meals` and `body-battery` are all `cachedFetch` keys. **Not one is a Zustand store**, so no
`partialize` change touches any of them. `lib/sqlite/**` is Lane A's by the path list, and the entry's
own rule already said so: *"the fix goes to Lane A if it is the cache layer."*

## What I established so Lane A does not have to

- **Three serialisations per write, not one.** `setCached` calls `ssWrite` (`JSON.stringify(data)` →
  sessionStorage), then `lsSet` (`JSON.stringify(entry)` → localStorage), then on device `runSQL` with
  another `JSON.stringify(data)` → SQLite. A Home tap's ~120k is stringified roughly **three times,
  ~360k on the main thread**. The probe measured only the localStorage leg, so the real cost is higher
  than the entry states.
- **⛔ The obvious fix is unsafe on web and safe on device.** "Skip the rewrite when the payload is
  unchanged" freezes `cachedAt`, and `isFreshWithinTtl` (`cache.ts:319`) reads exactly that. On web
  localStorage *is* the primary store, so a frozen stamp ages entries out early and causes **more**
  network fetches — it would defeat `freshWithinTtl` on `nutrition-targets`, `more-seasons` and the
  exercise catalogue. On the APK that function reads `api_cache.cached_at` from SQLite instead, so the
  localStorage stamp participates in no freshness decision.
- **And the relaunch seed survives a skip, which is what makes it cheap.** The localStorage leg exists
  on purpose — *"survives APK kills so `readCacheSync` can serve instant data on relaunch"* — but it is
  written through `floorSeedTtl`, and `OFFLINE_SEED_TTL_FLOOR` is **7 days**. On an unchanged payload
  the stored bytes are already correct and the stamp has days of headroom. **So the shape that works:
  on device only, skip the `setItem` when the serialised data is byte-identical.**
- **`ta_nav_timing_v1` is not worth splitting out.** `lib/perf/nav-timing-recorder.ts` already caps its
  buffer (`loadSamples` slices to `NAV_SAMPLE_LIMIT`), so its 5.4k is 4.5% of a Home tap and bounded by
  design. Left alone deliberately rather than filed as a separate entry.

## Deliberately not done

**Not measured.** Whether the skip moves `DV-12`'s numbers, and whether the `getItem` + compare it
needs costs more than the `setItem` it avoids, are both open — the analysis above is from source.
`DV-12`'s `perf.js longtasks` bar (every tab tap's longest task under 50 ms) is the test, and taking it
is Lane A's along with the change.

RV-153 keeps its queue position, which puts it at **26** in Lane A's list — below the ten-row default
view. That is its inherited priority and I did not raise it: it is a perf optimisation feeding `DV-12`,
not a correctness bug, and jumping it over two dozen security and data entries is not mine to do.

<a id="2026-09-28-rv213-declined-and-struck"></a>

# 2026-09-28 — RV-213 declined and struck; LB-178's start point investigated

**Lane B.** Branch `fix/nutrition-empty-meal-slots`. Docs only — no code, no version bump.

## Why this is a strike and not a build

`RV-213` proposed collapsing each empty meal slot on the nutrition diary to a single name-plus-`+`
row: roughly **1,400 px → 800 px**, with two cards previously under the fold — the goal-versus-budget
explainer and "Finished logging for today?" — reaching the same screen. A before/after was rendered
at 384 px dark and shown with `LB-163` and `LA-136` in one sitting.

**He declined it**, and gave the reason when asked: *"I like the original look; it shows the grouping
nicely with the space."*

So the empty height the sweep measured is **doing work** — it is what separates one meal from the
next. The saving was real and was paid for in the thing the screen exists to show. The entry's own
instruction is *"Nothing is owed. Strike this entry — a declined change is finished, not parked"*,
and it was still sitting at the head of Lane B's READY list, so `next-item.js` was pointing the lane
at work the owner had already said no to.

## Where the principle went, and why not here

The entry asked for this to be recorded as a **principle for the pillar, not a one-off no** — a
future sweep measuring blank space on the diary will reach the same finding and should stop. A
journal entry is the wrong home for that: nobody greps the journal before filing. It is now in
[`docs/domains/nutrition/README.md`](../domains/nutrition/README.md) under *Decided, and
deliberately not built*, which is the subject-based index a sweep reads first, alongside the
`suggestedTime`-stays-a-label decision it sits naturally beside.

## The half that was not disputed, and is still not a to-do

The finding also noted that an empty meal renders a header `+` (`components/nutrition/meal-card.tsx:73`)
**and** a body `+ Add food` (`:105`) — two affordances for one action. That was never disputed, and
it is deliberately **not** re-filed: the header `+` is the control present in *every* meal state,
while the body row is the empty-state one, so the pair is consistency rather than duplication.
Filing it as its own entry would be re-opening a declined entry through a side door — the entry is
explicit that re-opening needs a new reason, and "he only objected to the density" is not one.

## What is kept

The declined mockup stays at
[`docs/design/2026-09-27-four-screen-mockups.html`](../design/2026-09-27-four-screen-mockups.html),
linked from the principle, so the next person can see what was rejected rather than re-drawing it.

## Also here: `LB-178`'s start point, and a refuted suspect

Both items edit `docs/implementation-backlog.md`, and that file is the repo's most frequent
multi-PR conflict, so they ship as one PR rather than two racing each other.

`LB-178` named `tn53-sparkline-does-not-span-gaps:105` as where to start — the only spec flaky in
**all three** CI censuses. The entry's stated suspect is shared database state (*"the suite runs
`workers: 1` against one seeded database"*). **For this spec that is refuted:**

- **Reproduction failed both ways.** Alone: 3 passed. Run after the four other specs that write
  `body_metrics` (`one-calorie-budget`, `measured-overview`, `reta-weight-response`,
  `metric-bounds-at-keyboard`): 11 passed.
- **Nothing else writes the column it asserts on.** A census of `resting_heart_rate` across `e2e/`
  returns two files — this spec, and `rv72-progress-bars-composite`, whose match is a `page.route`
  **stub**, not a database write. No other spec can add or remove a point from its 14-day window.
- **Nothing mutates the other input to that window** either: `LOCAL_TODAY` derives from
  `users.timezone`, and the only `UPDATE users` in `e2e/` are a `date_of_birth` backfill and a
  `display_name` reset.

**So the next step changes.** Every E2E run already uploads a `playwright-report` artifact, and
Playwright retains the **first attempt** of a flaky test in it — which says in one look whether the
failure was the 60 s wait for the card heading (load), the `3 days missing` text (data), or the
header-width measurement (layout). Those are three unrelated causes. Shuffling spec order is the
expensive way to answer something the artifact answers on every run.

**A cheaper thing learned the hard way:** the job *log* is not a substitute. It is ~9,000 lines and
its tail is container teardown, so a `tail_lines` fetch returns Postgres checkpoint noise instead of
the Playwright summary. That is recorded on the entry so the next session does not pay for it again.

## Not exercised

**No root cause for `tn53:105`, and none is claimed** — this is a negative result that narrows the
search, not a fix. Deliberately nothing was changed in the spec: "flake" is not a root cause, and
editing a spec that passes locally, on a hypothesis the evidence just refuted, is how a real defect
gets papered over. No code changed at all; `check-backlog-pointers` and `check-doc-links` pass, and
the queue is 538 entries, down one.

<a id="2026-09-28-shard-e2e"></a>

# 2026-09-28 — LB-166: E2E sharded four ways, and its park was pointing the wrong direction

**Lane B.** Branch `chore/shard-e2e`. CI workflow only — no product code, no version bump.

## The park was inverted, which is why this sat

`LB-166` carried `Needs: LB-149`, on the reasoning that a browser dying mid-run *"may be the same
saturation seen from the other end"*. But **`LB-149` is not a build** — it closes *"when the next red
E2E reports"*, waiting on a `dmesg` witness from a real failure. And a run killed at the 45-minute
cap reports `cancelled` and **uploads nothing**.

So `LB-166` was blocking `LB-149`'s witness, not waiting on it. The two questions — why the browser
occasionally dies, and how long the suite takes — share no mechanism, and pairing them cost this
entry the time it spent parked.

## What shipped

`e2e` becomes three jobs, mirroring the `test-shard` / `test` pattern already in this file:

- **`e2e-gate`** — computes the UI-paths diff **once**. It needs `fetch-depth: 0`, and four full
  clones to answer one question is the cheapest thing here to get wrong.
- **`e2e-shard` ×4** — each with its own Postgres, exactly as `test-shard` argues: shards run in
  parallel so four container starts cost nothing in wall clock, and fewer specs per database is the
  seed-state class reduced rather than multiplied.
- **`e2e`** — the rollup, keeping the **`E2E`** name so a future ruleset entry still finds it.

**Measured split: 72 tests per shard** — 288 against the suite's 282, the six being the `setup`
project, which every shard must run for its own database. Per-shard timeout **25 min**, against 45
for the whole: ample rather than generous, so a suite that grows again goes red fast instead of
cancelling silently.

## Two things fixed alongside, both of which would have outlived the split

1. **The artifact upload was `if: failure()`, and a capped run is `cancelled`, not failed.** That is
   *why* run `36458784138` published nothing. It is `if: ${{ !success() }}` now, so the evidence
   survives a timeout as well as a failure — which matters because that artifact is the whole of
   `LB-178`'s method.
2. **The rollup refuses to report green when the gate did not succeed.** Without it a broken diff
   step leaves `changed` empty, the shards skip, and the branch reading "no UI change" reports
   success — a required check passing because the thing that decides whether to run it fell over.

## ⚠ Expect the split to surface something

**A database per shard changes which specs share one.** That reduces the seed-state class `LB-178`
found, and it may **surface** an order-dependence that was hidden. A new failure or two on the first
sharded runs is the split doing its job, not evidence against it.

## A small thing that would have cost a job timeout to learn

`pnpm e2e -- --shard=…` **hung locally with no output** rather than forwarding the flag. The package
script is exactly `playwright test`, so the two should be identical, and a CI step that hangs costs
the whole job's timeout to discover. The step calls `npx playwright test --shard=…` directly, which
was verified by listing every shard and by running shard 1 locally.

## Verified

- All four shards listed: **72 tests each**, 36 / 35 / 39 / 40 files.
- **Shard 1 run locally, end to end: 54 passed, 13 failed, 5 not run, 21.9 min.**
  **The failures were not the split's.** Nine of the thirteen were Home specs —
  `bf205-home-section-drag`, `calorie-progress-bar`, `day-rollover-checkin` ×3,
  `dv22-status-bar-scrim` ×2 and `card-429-error-state` — and they were not failing their own
  assertions: **RV-119 had shipped an infinite render loop and Home was crashing to the error
  boundary**, so everything that visits Home failed. That is fixed separately (v1.481.6) and all
  nine pass again. Running this shard is how the crash was found at all.
  ⚠ **So this run is evidence the shard MECHANISM works** — the split, the per-shard setup project,
  the flag — and it is **not** a clean baseline for the suite's health. The first CI run is.
- `yaml.safe_load` parses the workflow, and the three jobs' names, `needs`, `if` and matrix were
  read back from the parsed file rather than from the diff.
- `pnpm check:rules` **Ran 83 of 83** — including *"Every workflow job declares a timeout"*, which
  all three new jobs satisfy.

## Not exercised

**A workflow change cannot be verified before it merges** — the sharded jobs have never run on a
runner, and the first PR after this is the test. The local shard run above exercised the *specs*
under a shard flag, not the workflow that invokes it. The specific risks: shard balance is by file count
and not by duration, so wall-clock per shard may be uneven; and the per-database split may surface
order-dependence, as above. Nothing here touches product code.

<a id="2026-09-28-start-workout-button-no-icon"></a>

# 2026-09-28 — LB-173: the pre-workout primary action drops its dumbbell

**Lane B.** Branch `feat/start-workout-button-no-icon`. v1.478.2.

## What shipped

`components/workout/pre-workout-screen.tsx` — `DumbbellIcon` removed from **both** action states of the
screen's primary button (`Start Workout` and `Continue Workout`), and the now-unused import dropped.
Guard: `components/workout/__tests__/lb173-start-workout-no-leading-icon.test.ts`.

The decision was the Orchestrator's, made 2026-09-28 and explicitly not put to the owner: of 43
full-width primary `<Button>`s across `components/**` and `app/**`, **33 are text-only — 77%**, so the
icon-less form is the house convention and this screen was the outlier. CLAUDE.md's mockup rule exempts
an entry that merely restyles a component, and the 2026-09-22 narrowing puts a derivable choice on the
agent.

## Two corrections to the entry, both from re-verifying it against `main`

**1. There were two dumbbells, not one, in the same button.** The entry named only `Start Workout`.
`Start Workout` and `Continue Workout` are adjacent states of **one** primary-action slot, and both
carried `DumbbellIcon`. Stripping only the named state would have made the icon appear and vanish as
the workout started — an inconsistency *inside* one button, which is worse than the between-screens
one the entry was raised to fix. Both are stripped; that is the sibling-surface rule applied to states
rather than to files.

**2. "Both become text-only" overstates the outcome, and there is a third site.** The entry describes
the comparison as the session card's button having "no icon". It does not: `recommendation-card.tsx:300`
renders `Start Workout` followed by a **trailing arrow SVG**. And a third button exists that the entry
never names — `app/workout-select/workout-select-content.tsx:472`, which *is* genuinely text-only.
So after this change the three read: pre-workout text-only, workout-select text-only, session card
text-plus-trailing-arrow.

**That does not change the call**, and the reason is the entry's own: a trailing arrow is a directional
affordance, not a decorative leading icon — the same distinction the entry used to exclude 8 `Loader2`
spinners from its 43-button census. The dumbbell was the only decorative leading icon in the set. It is
worth recording because "both become text-only" would otherwise read as a claim someone could check and
find false. Neither of the other two buttons was touched: both are hand-rolled `<button>`/`<motion.button>`
elements, so they were never in the `<Button>` census to begin with.

## What is deliberately left

`RefreshCwIcon` on the `Preparing…` state and `CheckIcon` on `Complete Workout` / `Done for today`
stay. A spinner is a state indicator on the entry's own reasoning, and a completion mark carries meaning
the text does not. The resulting rule is coherent: the two **action** states are text-only, the two
**completion** states keep their check. The guard asserts this positively, so stripping either check
fails it.

## Verified

- Guard 5/5, and **control-run in every form it claims to cover** — re-adding the icon to
  `Start Workout` (the collapsed string-literal branch) fails 2, re-adding it to `Continue Workout`
  (the JSX text-node branch) fails 2, stripping the `CheckIcon` fires the negative control, and the
  restored tree is 5/5. The first draft of the guard was itself wrong and its own run caught it: a
  plain `indexOf('Complete Workout')` matched the phrase inside a **comment** above the block and
  walked backwards from there. It keys on a line that *is* the label now.
- Centring checked by reading `components/ui/button.tsx` rather than assuming: the base is
  `inline-flex items-center justify-center gap-2`, so a lone text child centres and the `mr-2` left with
  the icon that owned it.
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean.

**Not exercised:** not rendered on screen and not device-verified. This removes an icon from a button on
a path the owner uses daily, so it is visible on his next workout — the entry's own note that the
**reversal cost is two lines** is what makes that acceptable rather than a gap to close first. No
offline-first, native, safe-area, gesture or notification surface is touched.

<a id="2026-09-28-strap-low-water-mark"></a>

# BF-215 — the entry's recommendation would have been a no-op

**Branch:** `fix/strap-low-water-mark` · **Lane B** · `lib/stores/**`, `lib/hooks/**`,
`components/**`.

The owner asked *"Strap battery is at 100... it was 30 last time I used it? Is this working?"* It
was. BugFix measured production and found exactly two distinct values ever recorded: `100` across
four days, and `30` inside one 92-minute window. A CR2025 cannot recharge, so `100 → 30 → 100` is
not a state of charge — it is the cell drooping under a sustained BLE session and recovering at
rest. The defect is the consequence: **the cell only reads low while it is under load, which is when
he is training and not looking at Home.** By the time he looks, it says 100.

## The recommendation was falsified before it was built

The entry recommended *"the LOWEST reading from the most recent connected session"*.
`PolarGattClient.readBattery` is called **once per connection** — from the descriptor-write callback
when HR notifications are enabled, with no periodic re-read — so the battery value cannot move
inside a session, and a within-session minimum is the reading itself. The 17 rows of `30` are status
posts carrying one reading, not 17 measurements.

The defect the entry names is untouched by that; only its granularity was wrong. The mark is tracked
**across connections** instead, over a rolling 14-day window.

## Why a window, and why 14 days

Nothing can detect a cell change: a fresh CR2025 and a dying one both read 100 at rest. So the mark
has to age out rather than be reset. Long enough to span several workouts, so the sag is still on
screen when the question is asked — *"should I change the cell before this one?"* — and short enough
that a replaced cell clears itself. That is a judgement, not a measurement, and it is written down
as one.

## What shipped

`StrapBatteryReading` gains `min`/`minAt`; `writeStrapBattery` lowers the mark and never raises it
inside the window. An entry written before this reads as **its own** mark rather than a missing
field, so the chip is correct from the first render with no migration and no blank state.

The chip draws the mark. It does **not** grow a label: the header's left column measures 224 px at
412 dp and BF-139 moved the `%` off the glass for exactly that reason, so the explanation lives in
the accessible name — `Strap battery 30% at its lowest 2d ago, 100% at rest`. A mark announcing
itself as a live level would be this same defect wearing a different hat.

The tone and icon follow the mark, so the chip goes amber or red on the sag rather than on the
recovery. That is the warning the owner wanted and the reason the number is worth drawing at all.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors, 827 warnings · six new store cases · the
render spec green.

**Control-run:** against `origin/main` the sag case fails — the chip draws `100` — while both
no-change cases pass in either run, so the spec is not a tautology and the unchanged behaviour is
genuinely unchanged.

**The low-battery notification cannot have broken.** `DeviceBatteryNotifier.decide` is Kotlin, fed
the raw percent by `onBattery`, and nothing in this change is native — `git status` carries no
`android/` path. It is still named as the thing to confirm on the device, because "provably
unaffected" and "observed firing" are different claims.

**Not exercised:** a real strap. Every reading here was seeded, so nothing has seen the mark move
because a cell actually sagged. A Known-Issues row states the pass test across a workout.

<a id="2026-09-28-tn53-seed-state-flake"></a>

# 2026-09-28 — LB-178: the suite's most reproducible flake was seed state, not ordering

**Lane B.** Branch `fix/home-banner-stack`. One e2e spec — no product code, no version bump.

## What it actually was

`tn53-sparkline-does-not-span-gaps:105` was the only spec flaky in **all three** CI censuses, so
`LB-178` named it the start point and named shared database state as the suspect. Earlier today I
refuted the obvious form of that (nothing else writes `resting_heart_rate`, nothing mutates
`users.timezone`, it passed 3/3 alone and 11/11 after the four other `body_metrics` writers) and
recorded that the next step was to **read the retained first attempt** rather than shuffle order.

Doing that answered it in one look. The error is neither a timeout nor a wrong count:

```
Expected substring: "3 days missing"
Received string:    "Resting Heart Rate — 14 days"
```

The note is **absent entirely**, so the chart saw *zero* gaps.

**`scripts/local-db/seed.sql` gives every one of the last 14 days a `resting_heart_rate` of 58.**
The spec seeded its four readings with `ON CONFLICT DO UPDATE` and never cleared the rest, so on a
freshly seeded database the window is full and there is no gap to disclose. **A spec cannot assert a
gap it does not create.**

## Why that reads as "flaky" rather than "broken"

- **CI seeds a new database every run.** Attempt 1 meets a full window and fails. The spec's own
  `afterAll` then NULLs those seeded values. The retry re-runs `beforeAll` against an empty window
  and **passes** — so the run reports *flaky*, every time, deterministically.
- **A local database is persistent**, so one earlier run had already emptied it and the spec could
  never fail here again. Measured: **0 of 15** rows in the window carried a reading locally, against
  **15 of 15** on a fresh seed.

Restoring `resting_heart_rate = 58` across the window reproduced the CI failure locally, byte for
byte — same error, same received string.

## The fix, and the control

`beforeAll` now NULLs `resting_heart_rate` across the whole window before seeding its four, so the
spec is independent of the seed and idempotent. **Control-run both ways against the restored
fresh-seed state:** unfixed → fails with the CI error; fixed → 3 passed.

**Sibling sweep, clean.** Of the specs that both seed `body_metrics` and mention an absence, only
this one asserts on a *rendered* absence; `metric-bounds-at-keyboard` and `reta-weight-response`
match on prose and an error message.

## ⚑ What this changes for the rest of LB-178

The remaining churn has a better hypothesis than ordering. The real asymmetry is not which spec ran
first — it is that **CI runs against a database seeded minutes earlier, while a local database has
been mutated by every previous run**. Any spec whose assertion depends on an absence, or on the
seed's exact values, is a *different test* in the two environments. The cheap probe is a
`pnpm db:local` rebuild followed by the full suite, which reproduces CI's starting conditions
locally; shuffling order does not.

## Two things that cost time, both recorded

1. **I chased the wrong suspect first.** The entry said "shared state", I read that as *another spec
   writing the same column*, censused that, found nothing, and wrote it up as refuted. It was shared
   state — with the **seed**, not with another spec.
2. **The retained first attempt is free and I reached it last.** Every E2E run uploads a
   `playwright-report` artifact containing the flaky test's first attempt, downloadable
   unauthenticated from the artifacts API. The job *log* is not a substitute: ~9,000 lines whose
   tail is container teardown.

## Not exercised

The fix is verified against a locally restored fresh-seed state, which is the condition that fails —
but not against a true `pnpm db:local` rebuild, and not yet on CI. The generalised seed-state
hypothesis for the *other* churning specs is **stated, not tested**: no full-suite run was made from
a rebuilt database. No product code changed.

<a id="2026-09-29-bugfix-accessory-rep-band"></a>

# 2026-09-29 — the accessory rep band is advice to the model and a constraint on nothing

**Agent:** BugFix intake. **Docs only** — no product code.

## The owner's question

*"If its accessory shouldn't it have reps towards the 12+ rep range?"* — on the Pull card that had
just given him `Cable Preacher Curl` at 7 reps, 13.75 kg, RPE 10.

## He was right, and the band is explicit

His active program is `powerbuilding`, and `goalRange('powerbuilding', 'accessory')` returns
**66–75% · 8–12 reps** (run, not read). He was prescribed **77.5% × 7** — below the rep floor and
above the pct ceiling.

**The two violations are one violation.** The accessory branch derives load from the target effort
at whatever reps it is handed — `pctForExpectedRpe(accessoryTargetRpe(goal), a.reps)`
(`generate-prescription.ts:597`). Holding RPE 8 constant, fewer reps means heavier, so dropping
below the rep floor mechanically pushes the load above the pct ceiling.

## Nothing enforces the band on that path

Following every consumer of `goalRange` — there are three:

| consumer | what it does |
|---|---|
| `prompt.ts:96` | puts the range in the **prompt**: a request, not a constraint |
| `autoregulation.ts:150` | clamps reps to the band **only when an adjustment fires** |
| `builder-review.tsx:566` | display only |

Otherwise `ex.reps = a.reps` (`:591`) takes the model's number unchecked, and the accessory pct
clamp is `Math.min(85, Math.max(40, pct))` — **40–85, not 66–75**. The primary and secondary
branches both clamp to their zone via `clampPrescribedPct`; the accessory branch is the only one
that does not. That skip is deliberate — accessories float to an RPE target rather than a fixed
band — and the design is sound. The gap is that floating the *load* was implemented without ever
constraining the *reps* it floats against.

Filed as **BF-221**, Lane A. Recommended fix: clamp reps to the band at `:591`, before the pct is
derived — the same clamp `autoregulation.ts:150` already applies, so the constraint reads
identically wherever it appears and the pct lands in band on its own.

**Still live on a second exercise:** `Pull-Up`, accessory, **77.5% × 7**, in the prescription
pending right now.

## A correction to BF-219, written the same session

That entry said the back-off would over-correct *"next week"*. **It ran in nine minutes.** Completing
the workout regenerates the next prescription in-process, so it fired at `22:16:34Z` and
`Cable Preacher Curl` now reads `66% × 12`. The claim was written from the autoregulation code
without checking when that code runs.

What survives the correction is the oscillation: 66% → RPE 6 → 77.5% → RPE 10 → back to 66%. That
is a return to the load he already found too easy, not a settling. **What the swing has never
visited is the middle of the band** — which is BF-221's territory.

## Not exercised

Docs only, no device run, no code change. **Why the model chose 7 reps for two accessories while
giving Face Pull 12 was not diagnosed** — all three are accessories in the same session carrying the
same band in the prompt, and Face Pull is also the style-less one (BF-217), so the difference may be
a style effect rather than a model whim. Named as undiagnosed in the entry.

<a id="2026-09-29-bugfix-preacher-curl-load-and-in-session-rpe"></a>

# 2026-09-29 — a load he has failed at three times, and the RPE that reached nothing

**Agent:** BugFix intake. **Docs only** — no product code.

## What the owner reported

Mid-rest on Pull, after logging `Cable Preacher Curl 13.75 kg × 6` at RPE 10 against a prescribed 7:
*"This was too heavy for me. What is the role of this exercise? Should be accessory - would be nice
to be able to tell coach then and there if thats on the list of possibilities."*

## The role was already right

`session_exercises.exercise_role = 'accessory'`, style `Hypertrophy 3-set`. The badge on his card
was correct, so the role is not the cause and re-tagging it would fix nothing.

## BF-219 — the load has a five-week record and nothing reads it

Every `13.75 kg` outing on this exercise: **9 reps RPE 9, 8 reps RPE 10 (08-21) · 7 reps RPE 10
(09-06) · 6 reps RPE 10 (09-29)**. The reps fall 9 → 8 → 7 → 6 at RPE 9–10 throughout. Load
selection resolves a pct against a stored 1RM; no part of it consults that history.

**Autoregulation did not cause the jump**, which is worth recording because it is the obvious
suspect: the push branch returns `pctMultiplier: 1` on every path (`autoregulation.ts:86–107`) — it
adds a rep or a set, never load. The 66 → 77.5 move came from the plan.

**It will over-correct next week.** Today trips `missedReps` *and* the RPE dead band, so the
back-off fires for 5–10%, landing near 12.5 kg — which returned RPE 10 on 09-13. The oscillation is
legible in the table: 66% → RPE 6 → plan raises to 77.5% → RPE 10 → back-off → light again. Five
weeks, no settling.

**The 1RM is the first thing to examine.** The stored 17 / displayed 17.25 came off `11.25 × 12 at
RPE 6` — a set capped by the prescription, not by failure, and `prescriptionFactor` exists to make
exactly that reproduce the previous estimate. Read back from today's genuine failure set instead,
`repFactor(6) = 1.181` gives **≈ 16.2 kg**. About 6% high, which at 77.5% is most of the distance
between RPE 8 and RPE 10.

Filed `Lane: T` — it is a calibration, so a Tuning proposal is owed before anyone builds it.

## BF-220 — he already told the coach, in one tap

He logged RPE 10. The next set card still read `13.75 kg × 7 · ↑ up next`.

`computeRpeAdjustment` has **two** call sites in the repo — its own definition and
`autoregulation.ts:141`, which runs at prescription-generation time. Nothing on the workout screen
consults RPE. So the honest answer to *"is that on the list of possibilities"* is that it is not
currently possible, and the rule that would fire is already written and already agrees with him.

Recommended shape: **offer, do not apply** — a one-tap suggestion on the next set card that
pre-fills the weight dial, driven by `computeRpeAdjustment` unchanged so the in-session answer and
the next-week answer cannot diverge. Client-side, offline, no model call — it fires in a gym.

## Worth noting against Q-290

That entry found logged RPE carries almost no information (sd 0.87, effectively two values). On this
exercise it separates cleanly — RPE 6 on an easy session, RPE 10 on three heavy ones. Recorded in
BF-219 rather than reopening Q-290.

## Not exercised

Docs only. No device run, no code change. Which component chose 77.5% — the model or the rules
prescriber — was **not** traced, and that decides whether BF-219 is a prompt problem or a formula
problem; it is named as undiagnosed in the entry.

<a id="2026-09-29-bugfix-retention-horizons"></a>

# 2026-09-29 — the session-start reads: two prunes that have never run, and one index nobody uses

**Agent:** BugFix intake. **Docs only** — no product code.

## The three reads

- **`feedback_submissions` — 0 rows.** Row-scoped to the owner, so that is *none of his*, never
  *nobody's*. Nothing to file.
- **`error_events` — nothing new.** 25 distinct messages in 7 days, of which all but two are
  `bf110 resume …` telemetry from the live BF-110 investigation and one deliberate `BF-92` device
  probe. The single genuine fault — `/api/body-battery`, `timeout exceeded when trying to connect`,
  one hit on 2026-09-23 — is **already journaled** in `history-2026-09-23-folded-1.md`. Not re-filed.
- **Database size — 261 MB, 93 MB index.** This is where the work was.

## The growth rate rose, and it is not a leak

Against the two figures in the docs (171 MB on 08-18, 215 MB on 09-11) the rate went **1.83 →
2.56 MB/day**, on a `CLAUDE.md` line that said to expect ~1.7.

**The cause: the two largest growing tables have never reached their retention horizon.**

| table | retention | oldest row | age | ever pruned? |
|---|---|---|---|---|
| `oura_heartrate` | 180 d | 2026-06-22 | 99 d | **no** |
| `rr_intervals` | 90 d | 2026-07-17 | 74 d | **no** |

`oura_raw_samples`, the one window that *does* cycle, is holding at 173,960 rows across its 7-day
span — reclaiming correctly.

So the acceleration is temporary and the plateau projects to **~300 MB, about 4.5 cents a month**,
flattening by 2026-12-19. Worth carrying into `Q-30`, which is still open on storage cost.

## BF-222 — the risk inside that good news

Both prunes are throttled, fire-and-forget, on-write, and both end in
`.catch(err => console.error('[prune] … failed:', err))` — **stdout, not `error_events`**. Nothing
reads stdout. Their first-ever executions land **~2026-10-15** and **~2026-12-19**, and if either
fails the table just keeps growing with no signal. Recommended routing both catches to
`error_events`, which is the channel built for exactly this and which the session-start read already
covers.

## BF-223 — 7.2 MB of index with zero lifetime scans

`oura_heartrate_pkey`: `idx_scan = 0` with `stats_reset` **NULL**, so that zero covers the table's
whole life. No foreign key references the table. The sibling `(user_id, timestamp)` unique index
takes 10,025,158 scans — every read goes through it. The `id` column is still read by the export
path, but off a sequential scan, and dropping the constraint does not drop the column.

Filed with the drop **gated on the owner** despite OR-182's proved-dead authority: it is
`DROP CONSTRAINT` on a table the Oura pipeline writes to continuously.

## `CLAUDE.md` corrected

The daily-MB figure has now been wrong three times (0.4 → 1.8 → 1.7 against 2.56). Replaced it with
the shape — the two horizons, the ~300 MB plateau, and what to check once each passes — so the rule
stops needing a new number every few weeks. Also recorded the estimator trap it demonstrated again:
`n_live_tup` read **135,306** against **148,811** real rows.

## A gap worth naming

Nothing stores the shape, so every session re-derives it. This comparison took four queries plus
digging two datapoints out of prose. Recommended in BF-222 that a session running the read write the
four numbers into its journal entry — the fix is the journal, not a new table.

## Not exercised

Docs only. No device run, no code change, nothing written to production. **The export path's use of
`oura_heartrate.id` was not fully traced** — whether it orders or paginates by it is the one thing
that could justify keeping that index, and BF-223 names it as the check to do first.

<a id="2026-09-29-chore-lb180-drop-profile-workout-count"></a>

# 2026-09-29 — LB-180: `/api/user/profile` is a pure read of the users row

**Lane A · `app/api/user/profile/route.ts`.**

- **Removed:** `workoutCount` from the GET, and the `countWorkoutSessions` query that computed it on
  every profile read. A repo-wide search found no reader in `app/`, `components/`, `lib/`,
  `packages/` or `e2e/`; the only mention is a comment in `app/more/more-content.tsx` explaining why
  RV-183 waited on this.
- **Why it mattered:** the count was a derivation, so every workout completion was a writer of
  `more-user-profile`, and no completion group clears that key. It was the one thing keeping the key
  off `freshWithinTtl`. **RV-183's `Needs: LB-180` now clears**, and Lane B can add the flag with its
  proof.
- **Kept:** `repo.countWorkoutSessions`. It has its own soft-delete test, and removing an unused
  repository method was not this entry's job.
- **Verified:** a route test that the body has no `workoutCount` and the count is never queried;
  `pnpm dev` GET → 200 with keys `user,hasPassword` and no hash.

<a id="2026-09-29-docs-tn74-close"></a>

# 2026-09-29 — TN-74 closed: the last open item was migration 168's residue

**Lane A · investigation, docs-only.**

- **The last open item** was four `exercise_logs` rows (the 2026-08-06 whole-session deload) holding
  `estimated_1rm = 0` beside a positive `target_80`, all with `updated_at` 2026-08-07
  04:41:27.227Z, and "which later write set `target_80`".
- **Answer:** none did. `schema_migrations` shows **`168_q115_whole_session_deload_pr_correction.sql`
  applied at 04:41:27.240Z**, 13 ms later in the same deploy. That migration re-flagged the four
  logs `exercise_deloaded = true` and set **`estimated_1rm = 0`, but never touched `target_80`**, so
  the original values survived. The entry had the direction reversed: a later write cleared the 1RM
  and left the target.
- **Also ruled out, by reading the code:** the exercise-log upsert (it writes the pair together), the
  server log path (it recomputes the pair from sets, ignoring client values), migration 148 (six June
  bodyweight rows only), and the lbs→kg fix (it keeps the old target when the 1RM is 0).
- **No code change:** nothing live produces this shape. **No data change:** repairing historical
  rows is the owner's call per the entry, and these four August rows are superseded by later logs of
  the same exercises, so no reader treats them as current.
- **TN-74 leaves the queue.** Items 2 and 3 were already resolved (2026-09-27); this was the last
  open item.

<a id="2026-09-29-feat-lb179-prescribed-run-completed-as"></a>

# 2026-09-29 — LB-179: the run planner can tell a walk-satisfied prescription from a run

**Lane A · migration `202609282225` · local SQLite v44 · unblocks RV-166.**

- **Column:** `prescribed_runs.completed_as` ('run' | 'walk' | null), with a CHECK constraint. It is
  mirrored locally (CREATE, v44 ALTER, RECONCILE_COLUMNS), carried by the pull (`sync-engine`,
  `applyDelta`), and set by both write paths. Those are the web PATCH and the offline push branch,
  which share `PrescribedRunPatchBody` and `updatePrescribedRun`. The `claude_ro` view was
  regenerated from a scratch database built from the migrations alone; the diff is exactly the one
  column.
- **Two rules keep a stale 'walk' from outliving its day:** every status write sets the field to what
  the client sent or to null (a run), and the create upsert resets it on a regenerated
  prescription. **No backfill:** every existing completion was a run, which null already means.
- **Readers:** `completedAsRun` (`packages/shared/src/running/run-completion.ts`) now gates the
  hard-run gate, the week's 80/20 sequence and the run-type pace stats.
- **Found on the way:** the create upsert's conflict path rewrites the row's primary key. That is
  existing behaviour, and the test follows it rather than changing it.
- **Verified:**
  - Planner tests: a walk-completed tempo trips neither the gate nor the sequence, and a
    run-completed one trips both.
  - Route tests.
  - A real-Postgres test of the reset rules, the push branch and the CHECK constraint.
  - The claude_ro and snapshot suites: 34 run, none skipped.
  - `pnpm dev`: PATCH as a walk left easy-run stats at 0, the same completion without the field
    counted 1, and "swim" got 400.
- **Owed:** the v44 device migration (Known Issues row), and RV-166's client half, which must send
  `completedAs: 'walk'` (noted on RV-166).

<a id="2026-09-29-feat-lb182-nutrition-prompt-sleep"></a>

# 2026-09-29 — LB-182: the nutrition-goal prompt hears how he said he slept, only when he said it

**Lane A · `app/api/nutrition-goals/recommend`.**

- **Change:** the route reads the window's morning check-ins beside its other reads, and passes each
  one through `answeredMorningScales`, never the raw column. The prompt gets one line per morning he
  actually rated or corrected, with the scale's direction named (1 = slept great, 5 = slept
  terribly, the reverse of every other scale nearby). When there are none, it says so. A failed read
  leaves the line out rather than failing the recommendation.
- **What it tells the model for the owner today:** nothing new. Measured on the snapshot, **3 of 84**
  morning check-ins were ever genuinely rated, the last on 2026-08-12. Since the sheet started
  stating the app's own read of the night, an untouched scale means "accepted it", which is why the
  empty-case line reads "did not rate or correct". The line matters from the next correction on.
- **Verified:**
  - Three new route tests: rated mornings are included in order with the direction; the
    untouched seed never is; a failed read still recommends.
  - The existing TN-66 guard passes.
  - `pnpm dev` against the snapshot, as the owner: `POST /api/nutrition-goals/recommend` → 200,
    1,359 kcal (the figure LA-126 predicted for the corrected baseline).

<a id="2026-09-29-feat-lb183-minutes-of-day-format"></a>

# 2026-09-29 — LB-183: one time-of-day form, and a helper for minutes-of-day values

**Lane A · `packages/shared/src/date-utils.ts`.**

- **`formatMinutesOfDay(minutes)`** prints a minutes-since-midnight value in exactly the form
  `formatTimeOfDay` uses for an instant ("6:40 am"). It rounds the whole value before splitting it,
  so 419.6 is "7:00 am" rather than the "6:60" that `clockLabel`'s minute-only rounding can
  produce, and it wraps into one day.
- **`formatTime12h`** now delegates to it. The activity list and activity sheet read "6:40 am", and
  the fourth form ("6:40am") is gone.
- **Tests:** the new helper and `formatTime12h` are asserted equal to `formatTimeOfDay` for the same
  Brisbane wall time at four points (morning, noon, midnight, 23:59), plus rounding, wrap and NaN.
- **Left for Lane B (LB-183, re-laned):** point `formatClock` and `clockLabel` at the helper.
- **Not exercised:** a browser pass. It is a pure formatter, covered by unit tests.

<a id="2026-09-29-fix-bf217-style-roundtrip"></a>

# 2026-09-29 — BF-217: no save path loses a progression style; the nine blanks were never assigned

**Lane A · investigation + regression test.** BF-217 leaves the queue, replaced by LA-182 (Lane O,
the owner's repair) and LA-183 (Lane B, prevention).

- **Every writer of `session_exercises.style_id` was read, and none can blank it when the caller
  sends it:**
  - `saveProgram` re-inserts `ex.styleId ?? null`;
  - the only route that calls it, `/api/workout-templates`, ownership-checks the ids and passes
    them through;
  - both Config callers send them. The editor round-trips `styleId` from `listPrograms`, and
    activation spreads the listed program;
  - the coach's session-exercise writer preserves a style on a swap and restores it on undo.
- **Production evidence (read-only `db-query`, 2026-09-29):**
  - **No lost style was deleted.** Every style id the nine exercises were last logged with still
    exists in `progression_styles`, so `ON DELETE SET NULL` is ruled out.
  - **The entry's dating method does not hold.** Bankai is `ai_dynamic`, so `exercise_logs.style_id`
    is the style the AI chose that session ("AI · Accumulation" = Hypertrophy Plus), not the
    exercise's own `style_id`. A styled log says nothing about the row.
  - **The uniform `updated_at` of 09-28 05:17:31** matches LA-143's backfill (migration 295, merged
    05:13 UTC), which sets only `exercise_id`.
  - Four of the nine have never had a styled log at all.
- **Most likely origin:** exercises created with no style. The editor leaves a new exercise
  style-less, and the builder passes the AI's `progressionStyleId`, which can be empty. Neither
  forces or defaults one, and the editor shows no signal for "none", so it goes unseen until the
  rules fallback skips the exercise.
- **Shipped:** `bf217-style-survives-resave.test.ts` (real Postgres). An activation-shaped re-save
  and a repeated save keep every style.
- **Filed:**
  - **LA-182 (Lane O):** the owner assigns the nine styles. It un-deads Lower's Full toggle.
  - **LA-183 (Lane B):** default or require a style when an exercise is added.

<a id="2026-09-29-fix-builder-review-default-style"></a>

# 2026-09-29 — LA-183: the AI builder's review screen no longer saves a style-less exercise

**Lane B.** Branch `fix/builder-review-default-style`. UI only — no migration, no API change, no APK.

## Half of this entry had already shipped, hours earlier

`LA-183` named two writers: the program editor and the builder's review screen. **The editor half is
`LB-186`, merged as #1950 this morning** — so the re-verify against `main` turned up a live overlap
rather than a stale plan, and what was left was the builder.

The remaining gap, confirmed link by link on `main`:

- `app/api/generate-program` picks a style **name** per exercise (enforced from the goal for primary
  and secondary, the model's choice accepted for accessories when it is valid) and then resolves it
  with `styleByName.get(styleName)`. **That lookup can miss** — a goal with no rule table, or a name
  the user has no style for — and it yields `undefined` with nothing downstream objecting.
- `builder-review.tsx` saved `styleId: ex.progressionStyleId` straight through.
- And the row said **nothing**: the sets/reps line rendered only when the style name was a key of the
  screen's hardcoded `STYLE_DISPLAY` table, so both *no style* and *a style this screen has no
  description for* printed as a blank line.

## The fix reuses LB-186's rule rather than restating it

`mostUsedStyleId` is now the exported core of `components/config/default-exercise-style.ts` — the
role's most-used style, else the program's — and both writers reach it:

- the **editor** through `defaultStyleIdForSlot`, which adds the user's style list as both the
  validity check and the last resort;
- the **builder** through `fillGeneratedStyles`, which calls it directly, because every id already in
  a generated program was resolved server-side against that same list and needs no re-checking.

The builder's version has to carry the **name** as well as the id, since the row's sets/reps line is
keyed on the name — it takes it from whichever exercise in the program already pairs the two.

**It is derived, not written back.** `const shown = useMemo(() => fillGeneratedStyles(program), [program])`
feeds the rendered rows, the projected-volume card and the save payload. Filling through
`onProgramChange` from an effect would have been the shape that crashed Home in `RV-119` — an effect
writing the state it depends on — and there is no reason to take that risk for a value this screen can
compute. `fillGeneratedStyles` returns the **same object** when nothing is missing, so the memo stays
referentially stable and the screen re-renders exactly as much as it did before.

The display line now falls back to the style's own name when the table has no row for it. A name is a
worse answer than `4 × 10 @ 65% · 60s rest`; it is a much better answer than silence.

## What that means for the projected-volume card

`setsFromStyleName` defaults to **3** for an unknown or absent style, so a style-less exercise was
already being counted — at a number nobody chose. Feeding the card the filled program makes it count
the sets the exercise will actually be prescribed.

## Verified

- `npx vitest run components/workout-builder/__tests__ components/config/__tests__/default-exercise-style.test.ts`
  — **19 passed.** The fill: role-preferred, program-wide fallback, same-object identity when nothing
  is missing, a program with nothing to copy, and never overwriting an existing style. The core: that
  it accepts an id when given no list to check against, and drops one the caller calls unknown.
- A source guard on the wiring — the memo exists, no `useEffect` touches `fillGeneratedStyles`, and
  the rows, the projection and the save payload all read `shown`.
- Full gate on the final tree: `npx tsc --noEmit`, `pnpm check:rules`, `pnpm lint`, `pnpm test`,
  `pnpm build`.

## Not exercised — and this is the honest part

**The review screen was not driven in a browser, because nothing in this repo can reach it.**
`grep -l 'generate-program' e2e/` is empty: there is no spec for this screen at all, and getting one
means driving a **nine-step** wizard and stubbing a live Gemini call. That is a real piece of work,
not an oversight to wave at, so it is filed as **`LB-187`** with what it would take and the one reason
to weigh it first — the suite hit its 45-minute ceiling four days ago.

So the logic here is proven where it lives (pure functions, unit-tested) and the wiring is frozen by a
source guard, and **the screen itself is unseen**. The two things that would slip past both: a layout
consequence of the newly non-empty sets/reps line at 412 px, and anything about how the fill interacts
with a swap or role change made on the review screen before saving.

**Not fixed, deliberately:** the generator still emits `progressionStyleId: undefined` when its name
lookup misses. `builder-review` is the builder's only save point — `builder-chat`'s edits flow through
the same screen — so the fill covers every path to the database, and the upstream `undefined` is now
harmless rather than absent. Making the generator itself always resolve a style is `app/api/**`, which
is Lane A's, and there is no live consequence left to justify handing them the work.

<a id="2026-09-29-fix-e2e-browser-death-diagnostic"></a>

# 2026-09-29 — LB-149: the browser died, and the step built to explain it printed nothing

**Lane B.** Branch `fix/e2e-browser-death-diagnostic`. CI workflow and docs only — no product code, no
version bump.

## The witness arrived and the instrument was broken

`LB-149` has said for four days: *"the cause is NOT established, and this entry closes when the next red
E2E reports."* It reported. Run `36508371834`, the first four-way sharded run, shard 2:
`meal-label.spec.ts:542` failed with `browser.newContext: Target page, context or browser has been
closed` and a 32-frame **`chrome-headless-shell` crash stack**. Shards 1, 3 and 4 were green.

And the `kernel OOM kills` group in the job log is **empty**. Not "no OOM kill found" — empty, with not
even its own fallback line.

```
sudo dmesg 2>/dev/null | grep -iE "killed process|…" | tail -20 \
  || echo "no OOM kill in dmesg — …"
```

**`tail` exits 0 on empty input**, so the `||` arm is unreachable. The step could only ever print
matches, and silence meant nothing at all. Three sessions of *"the dmesg witness is now the thing that
answers it"* rested on a line that cannot answer.

The fix reads dmesg once and branches, and keeps the third case separate: **"no OOM lines" and "dmesg
would not talk to us" are not the same claim**, and from silence they are indistinguishable. All three
branches were exercised against a fake dmesg before pushing — no-OOM, OOM-present, and a refusing
dmesg — because a CI-only shell step has no other way to be tested.

The `free -m` / `ps` block is now labelled **AT TEARDOWN**. It ran minutes after the crash and reported
11 GB free of 16 with swap untouched; reading that as "memory was fine" is the mistake the label exists
to prevent. Catching the peak needs a sampler running alongside the suite, which is not built.

## LB-166's own verification, which this run also settles

The split was merged with *"a workflow change cannot be verified before it merges — the first PR after
this is the test."* This was that PR. All four shards spawned, each on its own Postgres, and the
rollup reported. Playwright step wall-clock: **shard 1 10m53s · shard 2 10.7m · shard 3 8m41s · shard 4
8m46s**; the whole `e2e-gate` → shards → rollup sequence took **~12.2 min** (01:32:40 → 01:44:52)
against ~33–36 min unsharded and the 45-minute cap it had been hitting.

That also answers the risk `LB-166` named against itself — shard balance is by **file count**, not
duration, so wall-clock could have come out lopsided. The spread is **~25%** (8m41s to 10m53s), slowest
shard at 11 of its 25-minute timeout. Balancing by duration would buy nothing worth the machinery.

## Two things that DID work, both from LB-166

The `if: ${{ !success() }}` artifact upload retained the first attempt — `playwright-report-2`, 33
files, 15.7 MB. And the four-way split localised the fault to one shard while three stayed green.

## ⛔ The artifact URL in the log is a dead end from a sandbox, and its 403 lies

`github.com/<owner>/<repo>/actions/runs/<run>/artifacts/<id>` — the URL the upload step prints — comes
back **403** from this container, with a body reading *"sessions are bound to their configured
repositories"*. That is the agent proxy, not GitHub, and it reads exactly like an auth failure. The
repository-scoped REST path works:

```
curl -sSL -o a.zip https://api.github.com/repos/<owner>/<repo>/actions/artifacts/<id>/zip   # 200, 15,686,307 bytes
```

The id comes from `get_job_logs` — the upload step prints `Artifact ID …`. This matters more than it
looks: reading the retained first attempt is the method `LB-178` prescribes, and the baton recorded it
as *"downloadable unauthenticated from the artifacts API"*, which is true only for this path.

## What the artifact then settled, in one read

Shard 2's other failure — `food-log-swipe-delete:238`, failed twice — is **not** collateral from the
browser death. The retained first attempt holds a full DOM snapshot, so the browser was alive and
rendering: the row is swiped open, `button "Delete Spec Swipe Yoghurt": Delete` is in the tree, and the
confirmation heading never appeared (*element(s) not found* after 5 s). A genuine assertion failure,
ahead of the crash rather than caused by it. Run in isolation locally the same day: **8 of 8, `:238` in
14.3 s.**

That is recorded on `LB-178` as its fourth data point and its first under sharding — and it is a real
result for that entry, because a **database per shard did not make `:238` go away**, and one shared
seeded database was its leading suspect. The snapshot also names a candidate: the *"Finished logging
this day? · 0 of 10 days marked"* banner is in the CI tree, and whether it renders is database state,
which moves the row the tap coordinate was computed against.

## And the next run reclassified the other failure

PR #1951's run (`36511264561`) failed shard 2 and only shard 2, with **one** spec in the artifact:
`food-log-swipe-delete:238`, byte-identical error, the row swiped open in the snapshot again. No browser
death in that run at all.

So `:238` is **4 of 4 attempts across two consecutive CI runs, and 0 of 8 locally the same day**. It is
not the highest-frequency flake any more, and it is not order-dependence: it passes on this sandbox's
browser and fails on CI's. The candidate that fits — recorded on `LB-178` as a candidate, not a finding
— is that CI installs `chromium_headless_shell` while a sandbox session runs `/opt/pw-browsers/chromium`
(`playwright install` is proxy-blocked here), and the spec turns on a CDP `touchscreen.tap()` landing
inside a 64 px tray. Two Chromium builds is a live explanation for a pass/fail that tracks the machine
rather than the run. **This container cannot install headless-shell, so it cannot be settled here.**

## Not fixed

- **`LB-149` does not close.** The crash is witnessed and the instrument repaired; what is owed is one
  more red E2E read through the working dmesg branch. Claiming a cause from a stack trace and a
  teardown memory figure is exactly what this entry has refused to do four times.
- **`food-log-swipe-delete:238` is not fixed either**, only correctly classified. The banner hypothesis
  above is a candidate, not a finding — nothing has been measured against it.
- **The fix cannot be verified before it merges.** A workflow change only runs on a runner, and this
  step only runs when a shard fails, so the next red E2E is the test. Its three branches are proven
  against a fake dmesg locally; nothing here proves the real `sudo dmesg` is readable on a GitHub
  runner — and if it is not, the new third branch is what will say so.

<a id="2026-09-29-fix-lb178-assert-the-half-the-app-owns"></a>

# 2026-09-29 — LB-178: the six-run red was Chromium's tap suppression, and the test measuring it is gone

**Lane B.** Branch `fix/lb178-assert-the-half-the-app-owns`. Test-only — no product code, no version bump.

## The answer

`#1965`'s listeners reported from the machine that fails:

> `events seen: pointerdown:Delete | touchstart:Delete | touchend:Delete`

All three on the Delete button. **No `click`, on either attempt.** So the touch reaches the right
element and Chromium never synthesises a click from it — its **tap-suppression window after a gesture**,
entered because the tap is a CDP dispatch issued immediately after a CDP swipe.

The control that makes this an explanation rather than a story: the sibling at `:192` taps identically
just *outside* that window, gets its click, and has been green the whole time.

That closes a chain of three readings, each of which killed a candidate I had written down:

| reading | killed |
|---|---|
| a database per shard did not fix it | shared seed state, this entry's leading suspect |
| `elementFromPoint` → `button "Delete"` | the coordinate, and the Chromium **build** |
| `pointerdown/touchstart/touchend`, no `click` | the app — it never gets a press to ignore |

## So the test is removed, and the removal was checked rather than argued

Its unique content was Chromium's behaviour. Every app-side claim it made is held by a named sibling,
verified before removing it and recorded in the spec file where it stood:

- tray raised while the row is displaced → **the tray is hit-testable the moment the row moves**, which
  holds the row mid-drag at 36 px — where the old `isOpen` gating measurably fails;
- press opens a confirmation rather than deleting → **a swipe reveals Delete, and Delete asks before it
  deletes**;
- the same, mid-animation → **the first tap on Delete opens the confirmation, even mid-animation**.

What is genuinely lost is the device half — the press the S25 swallows — and that was never reachable
here. The spec's own docstring said so, and sweep 4a's probing at 0/100/300/500 ms could not reproduce
it on the web path either.

## ⚠ The part worth keeping: I wrote a replacement, and it was wrong while green

Before removing it I narrowed the test to assert the hit test **at the instant of release** and ran it:
**8 of 8 green.** Then I checked what it would actually catch, and it catches nothing — **at rest
`isOpen` and `displaced` are both true**, so it passes under the exact `isOpen` regression it claimed to
guard. `:274` catches that because it holds the row *mid-drag*; at rest there is nothing to separate.

A green test that cannot fail for its stated reason is worse than no test, and it took writing the thing
out to see that rather than reasoning about it. That is the second time today a decision rule I wrote in
advance did not survive its own input.

## Verified

- `e2e/food-log-swipe-delete.spec.ts` — **7 of 7 locally** after the removal.
- Before it: **8 of 8** with the rejected replacement, which is how its emptiness was found.
- `npx tsc --noEmit`, `npx eslint` on the spec, `pnpm check:rules` **Ran 83 of 83**, `pnpm test`,
  `pnpm build`.
- **✅ AND THE PREDICTION HELD, checked after the merge:** run `36555135104` on head `89df41b8`
  read `completed` / `success`, and `get_job_logs failed_only: true` returned **0 failed jobs of
  15** — so shard 2 is green and the seven-run red streak on this suite is closed. Read that from
  `list_workflow_runs` matched on `head_sha`, not from `get_status`, which reports commit statuses
  this repo does not post and read `total_count: 0` on a run that was in fact fully green.

## Not exercised

- **Shard 2 going green** was owed to this PR's own CI run — the third consecutive PR here in that
  position, which is the standing cost of a fault that only exists on a machine this container cannot
  be. **That run has since passed**; see the last bullet under *Verified*.
- **The device.** Test-harness only; no product code and nothing the APK runs.

<a id="2026-09-29-fix-lb178-did-a-click-fire"></a>

# 2026-09-29 — LB-178: the diagnostic answered, and it retired my own plan

**Lane B.** Branch `fix/lb178-did-a-click-fire`. Test-only — no product code, no version bump.

## The reading

`#1964` shipped a diagnostic that names whatever sits under `food-log-swipe-delete:238`'s tap point.
Its own run was the first to carry it, and shard 2 obliged by failing.

**On CI the topmost element is `button… "Delete"`** — on the first attempt and on the retry.

So the coordinate is right and the press is swallowed. That kills **both** candidates this entry had
been carrying: not the geometry, and not the Chromium build (CI's `chromium_headless_shell` against
the sandbox's pre-installed one), which I had called *"the candidate that fits"* this morning and then
already downgraded once to one of two. It is neither.

## It also retired the plan I wrote for this exact outcome

`#1964` said: *if the topmost element is the Delete control … the sibling at `:274` is then the shape
`:238` should adopt.*

That is wrong, and the answer is what shows it. `:274` asserts **the tray is the topmost element over
its own rect** — which is precisely what this diagnostic has now proved true on CI. Converting `:238`
to that shape would swap a failing assertion for one already known to pass. That is quarantining the
failure under a different name, which this repo forbids for good reason.

Worth stating plainly: the plan was written before the answer existed, and reading the answer is what
made it visible. A decision rule written in advance is still a guess until its input arrives.

## What is still open, and the one fact that settles it

The button's handler has no guard to blame — `swipe-actions.tsx` runs
`openRows.delete(close); close(); a.onPress()` unconditionally. So either the app never receives the
click, or it receives it and the confirmation still does not open. One fact separates those:

- **click fires, no confirmation** → the app ignores a press this soon after a drag. A real defect, and
  the same shape `BF-61` was filed for after the device failed it twice.
- **no click at all** → the browser never synthesised one from a CDP tap issued this soon after a CDP
  swipe. That is the harness's limit rather than the product's — and the spec's own docstring already
  says the device-level cause is unreachable from here.

The spec now installs capture-phase listeners for `pointerdown`, `touchstart`, `touchend` and `click`
on `document` before tapping, and appends what they saw to the same failure message (`events seen: …`).
Capture phase on `document` means nothing the button does can hide them.

## Verified

- `e2e/food-log-swipe-delete.spec.ts` — **8 of 8 locally** with both diagnostics in, `:238` among them.
  The assertion still requires the confirmation to open.
- `npx tsc --noEmit`, `npx eslint` on the spec, `pnpm check:rules` **Ran 83 of 83**, `pnpm test`,
  `pnpm build`.

## Not exercised

- **The failing environment**, again. This ran on the sandbox's Chromium, where the spec passes; the
  listeners exist to report from the machine where it does not, and this PR's own shard-2 run is their
  first real exercise. That is the second consecutive PR whose verification is owed to its own CI run,
  which is the cost of debugging a fault that only exists on a machine this container cannot be.

<a id="2026-09-29-fix-lb178-name-what-swallows-the-tap"></a>

# 2026-09-29 — LB-178: make the one remaining red spec say why it failed

**Lane B.** Branch `fix/lb178-name-what-swallows-the-tap`. Test-only — no product code, no version bump.

## Where the entry actually stood

`LB-178` was filed as *"the suite is flaky once specs share a run, and nobody knows how flaky"*. The
census part is done — five CI runs plus local repeats — and it left **one** spec red:
`food-log-swipe-delete:238`, which by today's runs is **6 of 6 failing on CI and 0 of 8 failing
locally**.

That ratio is the finding. A shared-state or ordering fault is *mixed*; this is deterministic on each
machine and opposite between them, so it is systematic. It also survived the change that was supposed
to fix its class: `LB-166` gave every shard its own Postgres, which was this entry's leading suspect
for `:238`, and the spec failed anyway.

## A correction to my own note from this morning

Earlier today I recorded the browser build as *"the candidate that fits"* — CI installs
`chromium_headless_shell` while a sandbox session runs the pre-installed Chromium, and the spec turns
on a CDP tap landing inside a 64 px tray.

That is **one** of two candidates, not the one. Reading the spec again: it taps a coordinate derived
from a `stableBox` captured **before** the swipe, and taps immediately after the release. A systematic
difference in the resting geometry *or* in how far the row has settled by tap time produces exactly
this split. Nothing measured so far separates *the coordinate missed the tray* from *the tray swallowed
the press*, and I should not have named one of them as the fit.

## What ships instead of a guess

The spec now reads `document.elementFromPoint` at its own tap coordinate, immediately before tapping,
and interpolates the result into the assertion's failure message:

> `the press right after the release was swallowed… At (344, 268) the topmost element was
> button.…"Delete"`

The retained artifact could only ever show that the confirmation was absent. This says what was under
the finger, which is the fact that separates the two candidates — and it needs no headless-shell, which
this container cannot install.

**Verified inert on the happy path:** the file passes **8 of 8** locally with the diagnostic in,
`:238` among them, so nothing about the assertion or its timing changed.

## What is owed, and it is a read rather than a build

Read the message off the next shard-2 failure.

- If the topmost element is the Delete control, the coordinate is right and the press is genuinely
  being swallowed on the web path — a real defect, and the sibling at `:274` (which asserts the same
  property coordinate-free and passes on CI) is the shape `:238` should take.
- If it is the row or anything else, the coordinate is wrong against CI's geometry, and the fix is to
  derive the tap point *after* the release rather than before it.

## Not exercised

- **The failing environment.** Everything here was run on the sandbox's Chromium, where the spec
  passes; the diagnostic's whole purpose is to report from the machine where it does not, and it has
  not yet run there.
- **The device.** A test-harness change; no product code and nothing the APK runs.

<a id="2026-09-29-fix-lb183-one-time-of-day-form"></a>

# 2026-09-29 — LB-183: the last two time-of-day forms fold into the shared one

**Lane B.** Branch `fix/lb183-one-time-of-day-form`. UI only — no migration, no API change, no APK.

## What was left

`RV-208` ① found the app writing a clock time four different ways. Lane A shipped the engine half
earlier today: `formatMinutesOfDay(minutes)` in `packages/shared/src/date-utils.ts`, printing exactly
what `formatTimeOfDay` prints for a minutes-since-midnight value, with `formatTime12h` delegating to
it. Verified on `main` before touching anything.

This is the surface half — the two remaining local copies:

- `sleep-verdict-copy.ts`'s `formatClock`, which printed **`11:10pm`** (no space);
- `sleep-timing-trend-utils.ts`'s `clockLabel`, which printed **`11:30 PM`** (uppercase).

Both are now one line calling the helper. Neither is routed through `formatTimeOfDay`, which the
entry warned against and which would have been wrong: that one takes an *instant* and these values are
already-zoned wall-clock minutes, so handing it a `Date` rebuilt from them is the timezone bug this
app keeps re-finding.

## The latent bug the swap fixes, now pinned

`clockLabel` floored the hour and then rounded **the minute alone**: `Math.round(m % 60)`. At 419.6
that is hour 6 and minute `round(59.6)` = 60 — **`6:60 AM`**. The helper rounds the whole value first,
so the carry reaches the hour and it reads `7:00 am`. A test asserts exactly that case, because the
entry named it and a fix nobody tests is a fix that comes back.

## Verified

- `components/health/__tests__/sleep-timing-trend-utils.test.ts` +
  `components/health/sleep/__tests__/sleep-verdict-copy.test.ts` — **25 passed**. Seven expectations
  changed, all of them the rendered form the entry predicted (`11:10pm` → `11:10 pm`, `6:30 AM` →
  `6:30 am`), plus the new `6:60` case.
- **Sibling sweep, and it came back clean:** grepping every `.ts`/`.tsx` under `e2e/`, `components/`,
  `app/`, `lib/` and `packages/` for a rendered `h:mm AM`/`h:mmam` string found **no live assertion**
  on the old forms — only prose. So no e2e spec was pinned to the uppercase label.
- Full gate: `npx tsc --noEmit`, `pnpm check:rules`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Found and deliberately left for Lane A

`app/api/day-timeline/route.ts:18,28` documents its own field as *"formatTimeOfDay: `6:40am`"* and
*"`12:27pm`"*. `formatTimeOfDay` formats with `'h:mm aaa'` — **it has a space**, so those two comments
describe an output form that no longer exists, and line 43 of the same file already tells the story of
the space being added. They are comments, not behaviour, and `app/api/**` is Lane A's under the path
rule, so reaching across to correct them is exactly what the lane split exists to prevent. Recorded
here instead of silently edited.

## Not exercised

- **The device.** Text rendering on two sleep surfaces; no native plugin, safe-area, gesture or
  offline-first path is involved.
- **The screens themselves.** These are pure string functions with direct unit coverage, and the
  change is the format of what they return; nothing was rendered in a browser for this.

<a id="2026-09-29-fix-next-item-open-prs"></a>

# 2026-09-29 — `next-item.js` no longer lists work that already has an open PR as READY

**Lane A · tooling.**

- **Why:** on 2026-09-28/29 a Lane A session rebuilt five security fixes (RV-190, 191, 192, 193,
  197) and most of two more (RV-195, RV-196), all of which already had open PRs from earlier Lane A
  sessions. A queue entry stays in the file while its PR waits on the owner, and READY ("nobody has
  started it") could not see a PR, so every one of them was offered as startable work. The
  duplicates are named on RV-221; the two genuine additions went into #1930 and #1755.
- **Change:** `scripts/lib/open-prs.js` reads open PRs with `gh`. It matches an entry's id in a PR
  title, or in a branch name where ids are lower-cased and de-hyphenated (`rv190`). A number can
  never claim a longer one (`RV-19` ≠ `RV-190`). Matched entries leave READY and print under
  **IN FLIGHT** with their PR numbers. The first real run found **12** in Lane A.
- **Off switches:** `--no-prs` or `NEXT_ITEM_NO_PRS=1`. It is also always off under Vitest and CI.
  When `gh` cannot answer, the tool says so on one line rather than implying nothing is in flight.
- **Tests:** `next-item-open-prs.test.ts`, covering title and branch matches and the prefix
  boundary. The scripts suite passes: 47 files, 450 tests.

<a id="2026-09-29-fix-outgoing-friend-requests"></a>

# 2026-09-29 — LA-181: a friend request you sent offered you an Accept that could never work

**Lane B.** Branch `fix/outgoing-friend-requests`. UI only — no migration, no API change, no APK.

## What was wrong

The Manage-friends sheet filtered `status === 'pending'` and gave **every** row Accept/Decline. A
pending row can point either way, and Accept on one you sent always fails — the server accepts only as
the addressee. `RV-195` then made it worse rather than causing it: masking the target of an outgoing
request left the row with no name, so it read *"Unknown"* beside two buttons that cannot work.

The same filter drives the count on the Manage button, so the badge asked you to act on requests you
could not act on. That is the sibling surface, fixed in the same PR.

## Direction comes from the row, not from the viewer

The entry prescribed `f.requesterId === <me>`. Neither the sheet nor its parent is given a viewer id,
so that needs `useSession()` — and a session has a loading state in which **every** row would be
miscategorised, which is worse than the bug.

`maskedForRequester` blanks an outgoing request's name, avatar and friend code but **keeps
`otherUser.id`** (`lib/data/postgres/slices/social.ts`). So whichever end `otherUser` sits on says
which way the request points:

- `otherUser.id === addresseeId` → I sent it.
- otherwise → it is waiting on me.

Exact, no new dependency, no loading state. `splitPendingRequests` is the one place both the sheet and
the badge read, so a count and a list cannot disagree again.

## What the user sees

Incoming rows are unchanged — the requester's name, Accept, Decline. Outgoing rows move to a **Sent**
section reading *"Request sent"* with *"Waiting for them to accept"* under it and a Cancel. There is no
name to show and that is by design, not a gap: `otherUser.displayName` carries what the sender typed
only in the send response, and this list is a later read.

Cancel is the same `DELETE /api/friends/[id]` as removing a friend, which already allows either party —
so the only change is the word: *"Request cancelled"* rather than *"Friend removed"*.

## Verified

- `components/more/__tests__/pending-friend-requests.test.ts` — **7 passed**: outgoing, incoming, both
  fully masked, an accepted row and the self-edge dropped, plus a source guard that the old
  both-directions filter is gone from the sheet *and* the badge.
- **`e2e/la181-outgoing-friend-request.spec.ts` — the entry's own check, run in a browser.** Two
  accounts, one request, both views of it: the sender gets *"Request sent"* + Cancel with **no**
  *"Unknown"* and **no** Accept; the addressee gets *"Accept Test User"* / *"Decline Test User"* and no
  *"Request sent"*. The request is deleted in `afterAll`, and the friendship table read **0 rows**
  afterwards.
- **This one is committed, unlike today's other browser checks.** The budget argument that kept them
  as scratch runs was the 45-minute whole-suite cap, and `LB-166`'s sharding removed it — the slowest
  shard measured 11 minutes of a 25-minute timeout this morning. 33 s for the first coverage of a
  two-user handshake is worth it.
- Full gate: `npx tsc --noEmit`, `pnpm check:rules`, `pnpm lint`, `pnpm test`, `pnpm build`.

## It also carries the journal compaction sweep, because the gate made it mine

Merging `origin/main` brought in four other lanes' PRs and took `docs/overview/entries/` to **62
foldable entries, over the 60 runaway limit** — a hard `check-doc-index-size` failure that would have
blocked every lane's next PR, not just this one. Its message says so outright: *"This branch adds 1 of
them, so the sweep is yours: you are already here."*

`node scripts/fold-journal-entries.js` folded **40 entries into `history-2026-09-29-folded-1.md`** and
rewrote the citations pointing at them in four files (`docs/implementation-backlog.md` and the
app-shell, platform and sleep domain indexes). **Six were held back**, which is the script's own rule
rather than an error: it refuses to fold an entry an agent baton cites, because rewriting that link
means one lane writing into another's live state file.

`check-doc-links` reads **OK across 885 files** afterwards, which is the check the script tells you to
run instead of reasoning about which links moved.

## Not exercised

- **The device.** A list split and a label change in a sheet; no native plugin, safe-area, gesture or
  offline-first path.
- **Two real people.** Both accounts are the harness's, on one browser, so nothing here says how the
  request reads to someone who did not just send it.
- **Accept and Decline themselves.** The spec asserts the controls are present and correctly assigned;
  it does not press them, because accepting would consume the request the other test reads. What
  changed is which rows get the buttons, not what the buttons do.

<a id="2026-09-29-fix-program-editor-default-style"></a>

# 2026-09-29 — LB-186: the program editor no longer adds a styleless exercise

**Lane B.** Branch `fix/program-editor-default-style`. UI only — no migration, no API change, no APK.

## The entry's diagnosis held; its prescription could not be followed literally

`LB-186` traced the gap link by link and every link was still true on `main`: `addExercise` created
`{ key, name: "" }`, the type marks `styleId` optional, the route checks only a *provided* id, and the
save writes `styleId ?? null`. **No layer objected**, so a slot was styleless whenever the picker was
never opened — which cost `BF-200` a full working weight in a deload week.

Where it could not be followed as written is the word **role**. The entry says to give the new slot
*"the style its role already uses"* — but **a newly-added slot has no role yet.** The editor shows the
role pills only in the non-Linear approaches, and the style picker only in Linear, so the two are
never on screen together; a slot added in Linear stays unclassified for its whole life.

So the fix reads the program in two places rather than one:

- **at add time**, with no role to go on, the new slot takes the style this *program* uses most;
- **when a role is set** on a slot that has **no** style, it takes the style that *role* uses most.

The second half is what makes "by role" real, and it is guarded on `!e.styleId`, so a style the user
picked is never overwritten. The guard cannot tell a slot that was never styled from one deliberately
set back to *No style*, and it does not try: the only way to reach the role pills with either is to
switch approach while **creating** a program (approach is fixed once a program exists), and in the
role-driven approaches a style is what the deload override needs, so re-filling there is the better
of the two wrong answers.

## Read off the program, never a named default

The entry names `Hypertrophy 3-set`, `General` and `Powerbuilding` — those are *his* styles, on *his*
data. Styles are user-defined rows and session names are user data, so the only authority for what a
program uses is the program. `defaultStyleIdForSlot` counts the styles its own slots carry, prefers
the role's, falls back to the program's, and only then to the first style the user has. It also drops
any id that no longer resolves: the editor already flags an unresolvable `styleId` with *"Style … not
found — please reassign"*, and handing a new slot that same dead id would spread the amber row rather
than fill a gap.

A program with nothing styled yet still gets a style rather than a null, because **the null is the
bug**. It shows in the picker, where it can be changed — and the picker still offers *No style
(default sets)*, which the e2e spec asserts, so nothing here takes the choice away.

## `LA-177` is now unblocked

It carried `Needs: LB-186` precisely so the backfill would not run while the editor kept minting the
tenth styleless slot. Removing this entry from the queue clears that.

## Verified

- `npx vitest run components/config/__tests__/default-exercise-style.test.ts` — **9 passed**, covering
  role-preferred, program-wide fallback, no-role-at-all, a deleted style, an unstyled program, no
  styles at all, and tie stability.
- `e2e/lb186-new-exercise-has-a-style.spec.ts` — builds its own program in the editor, adds an
  exercise, and reads the row's picker: non-empty, and still settable back to no style.
- The spec **builds** a program rather than editing the seeded one, and that was forced rather than
  chosen: the picker renders only in the Linear approach, the Training Approach control exists only
  while *creating*, and the seeded program's `phase_mode` reads `ai_dynamic` in this sandbox's
  database today — a value an earlier spec in the same run changed. Reading the assertion off the
  seed would have made it depend on spec order, which four shards now vary per database.
- **The entry's own proof, observed rather than argued.** A one-off scratch spec (run locally, not
  committed — it saves a program, which would mutate state every later spec in that shard's database
  reads) built a program in the editor, added `Bench Press` without touching the picker, and pressed
  Save. The row read back from Postgres:
  `LB186 SCRATCH / SCRATCH SESSION / Bench Press / 56d6cdf2… / Standard` — **`style_id` non-null**,
  which is what `LB-186` asked for. The scratch program was then deleted from the local dev database.
- Full gate on the final tree: `npx tsc --noEmit`, `pnpm check:rules` (**Ran 83 of 83**), `pnpm lint`,
  `pnpm test`, `pnpm build`.

## Not exercised

- **The device**, and deliberately **no Known-Issues row for it.** The gate in Canonical Runtime
  names offline-first domains, native plugins, safe-area, gestures and notifications; this is none
  of them — a default in client form state, in a surface that is not local-first, exercised in a
  real browser and read back out of Postgres. The one device-shaped thing here is that the picker
  is a native `<select>` whose sheet is Samsung's, and that markup is unchanged.
- **Existing styleless slots.** Nine of them sit in the active program and they are `LA-177`'s, a
  production backfill on Lane A's side of the split. This PR stops the tenth; it does not fix the nine.

<a id="2026-09-29-fix-registered-toast-awaits-approval"></a>

# 2026-09-29 — LA-162: the "Account created" toast told an invited registrant the opposite of what happens

**Lane B.** Branch `fix/registered-toast-awaits-approval`. UI copy only — no migration, no API change,
no APK.

## The copy

On `?registered=1` the sign-in screen toasted *"Sign in below — or wait for approval if not yet
invited."* That was true while an invite activated a password account. `RV-192` (#1779) made **every**
password registration start inactive, invited or not — so the first half became wrong, and a registrant
who followed it signed in and landed on `/pending`, which says the opposite.

## The sentence now exists once

Both screens say why the account cannot be used yet, and **them disagreeing is the whole bug**, so the
sentence is named once in `lib/approval-copy.ts` and imported by the toast and by `/pending`. That is a
deliberate step past what the entry asked for (it asked only for the toast to change): fixing one of two
copies of a sentence leaves the next drift available, and this drift had already shipped once. The
wording is `/pending`'s own, so the screen a registrant actually reaches is the authority rather than a
third phrasing.

`app/__tests__/approval-copy-one-place.test.ts` fails if either screen inlines the sentence again, if
the toast regains *"Sign in below"*, or if the sentence stops naming both the approval and the rough
wait — a wait with no end reads as a failure.

## ✅ The entry's "check first, unconfirmed" is answered: NO, and it matters

`LA-162` carried a second, unconfirmed half — that `router.push('/sign-in?registered=1')` *"did not
navigate after a successful POST"* in three dev-mode runs, with the note that **if it were real the
toast would never be seen at all**, which would have made this whole fix cosmetic.

**It navigates.** Driven end to end in a browser — `/register`, a unique email, submit — the URL becomes
`/sign-in?registered=1` and the toast renders. Lane A's own suspicion was right: Fast Refresh rebuilds
were logged around each of their submits, and a rebuild mid-submit remounts the component and loses the
pending navigation. This run had no file edits during it and no Fast Refresh churn.

**Stated precisely, because the entry asked for something slightly different:** it asked for *"one run
against a production build"*, and this was the dev server. A production build cannot reach the local
Postgres — `next start` sets `NODE_ENV=production`, which turns SSL on for the pool
(`playwright.config.ts` documents exactly this, and it is why the harness runs `pnpm dev`). What this
run does is remove the *suspected cause* and show the flow working; it does not exercise a production
build.

## Why there is no committed e2e for it

`POST /api/auth/register` is rate-limited to **5 attempts per IP per 15 minutes**. A committed spec
would couple the suite to that budget — one registration per run, two if a retry fires — and turn a
busy afternoon of CI into false reds that look nothing like their cause. The suite is also at the
ceiling `LB-166` measured four days ago. So the browser verification was done from a **scratch spec run
locally and then deleted**, along with the three user rows the runs created, and what is committed is
the source-level guard above.

One thing seen and deliberately not filed: the toast renders **twice** in dev, because React StrictMode
double-invokes the effect. Production runs it once.

## Not exercised

- **The device.** Copy on a WebView screen; no native plugin, safe-area, gesture or offline-first path
  is involved.
- **A real invited registrant.** The flow was driven with a fresh self-registration. Whether an invite
  row changes anything here is `RV-192`'s territory, and its whole point is that it no longer does.
- **A production build**, as above.

<a id="2026-09-29-fix-rv218-weekly-nutrition-zero-days"></a>

# 2026-09-29 — RV-218 ④: the 7-day nutrition chart shows seven days, and averages only the logged ones

**Lane A · `app/api/nutrition/weekly-summary` + `components/nutrition/weekly-nutrition-chart.tsx`, one PR as
the entry required.**

- **Route:** always seven rows, oldest first. An empty day is `logged: false` with zeros, and
  `isToday` is marked by the route, the layer that knows the user's timezone.
- **Chart:** its rules live in `components/nutrition/weekly-nutrition-days.ts` → `weeklyChartModel`.
  - The average covers logged days only, labelled "avg of N logged days", because an unlogged day is
    not a 0 kcal day.
  - The empty state shows when nothing was logged.
  - Today's bar is emphasised, not the last one; with gaps, the last bar was yesterday on any morning
    before the first log.
  - A cached payload from before this change (no `logged`, no `isToday`) is read as all-logged with
    the last row as today, so first paint is unchanged until revalidation.
- **Verified:** a route test (seven rows, one today, zeros on unlogged days), helper tests including
  the old cached shape, and `pnpm dev` on the owner's snapshot at 384 px. That showed seven bars
  (Wed to Tue), zeros on Fri, Mon and today, and "avg of 4 logged days: 745 kcal". The old average
  would have divided by 5 rows.
- **RV-218 still open:** ① waits on LA-180 (the owner's calorie-number question) and ② (one "burned"
  function).

<a id="2026-09-29-security-rv195-auth-social-gaps"></a>

# 2026-09-29 — RV-195 ① and ③: mobile sign-in bound to its tab, pending friend requests masked

**Lane A · auth · held for the owner's merge-time yes (RV-221).**

1. **The mobile sign-in challenge is bound to its tab.**
   - `components/google-sign-in.tsx` now opens `/mobile-signin/begin`, a new route. It stores the
     PKCE challenge in a 10-minute httpOnly `ta_mobile_challenge` cookie (SameSite Lax, which
     survives the return from Google) and continues to `/mobile-signin`.
   - `/auth-mobile-bridge` mints through `lib/mobile-auth-bridge.ts` → `mintMobileBridgeToken`, which
     refuses a challenge the cookie does not hold.
   - The flow's JavaScript is served from Railway, so **no APK is needed**.
2. **Item ② (a deleted user stays signed in) is NOT here.** It is #1784, from an earlier Lane A
   session, and this PR was narrowed to avoid duplicating it.
3. **A pending request reveals nothing to its sender.** `listFriendships` and `sendFriendRequest`
   mask the target (only what was typed comes back) until the request is accepted. The addressee
   still sees the sender.
   - The surface consequence, that an outgoing row reads "Unknown" and has Accept/Decline buttons
     that could never work, is filed as **LA-181** (Lane B).

- **Verified:**
  - Unit tests for the cookie, the begin route and the bridge decision.
  - A real-Postgres test for the masking, including the unmask on accept.
  - `pnpm dev` with a throwaway `AUTH_SECRET`:
    - `begin` sets the cookie and redirects;
    - the bridge refuses a missing or mismatched cookie and renders for a match;
- **Not exercised:** the full sign-in on the APK through Google. A DV check is owed after merge:
  sign out, then sign in with Google on the S25, and confirm the app receives its session.

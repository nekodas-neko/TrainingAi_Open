# Status-note archive

The 157 dated status notes that had accumulated in `projectOverview.md`'s Current
Status section, moved here on 2026-08-17 so that file could go back to being the lean index it
says it is. Newest-first ordering was never maintained, so these are in the order they were
found.

**These are superseded by the session journal.** Every note here corresponds to a PR that also
wrote a journal entry under `docs/overview/` — the journal is the authoritative record of what
shipped. These are kept because they carry the *why it mattered* framing the journal entries
often leave implicit, and because deleting evidence is not the same as tidying it.

Do not add to this file. New status notes belong in the journal entry for their PR.

---

**🆕 2026-08-13/14 — a stale sleep-session window traced to a full local repro, plus sharper evidence
for the standing DB-pool-contention fault (docs-only, Q-225).** Owner reported a displayed bedtime
2.5h later than reality. Ruled out the anchor-lag bug (too small a correction) and confirmed, by
importing the real night's raw data into the local dev DB and running the actual
`aggregateOuraRawSamples` function directly against it, that the algorithm computes the *correct*
window (matching the owner's account of a real sleep with brief overheating wake-ups) — the live
stored row just doesn't match it. Leading theory ties it to the Q-107 DB-pool-contention fault,
which got much stronger burst evidence in the same investigation (two ~20-minute windows hitting
15–20+ unrelated routes at once). Verified fix (an admin Redecode) confirmed locally; not run in
production yet. See the two `[sleep]`/`[platform]` Known-Issues rows below and Q-225/Q-107 in
`docs/implementation-backlog.md`.

**🆕 2026-08-13 — the step-decoder table leaves the browser bundle (Q-221).** The ring's own
quantisation spec was a static JSON import inside `steps-motion-decoder.ts`, so webpack compiled it
into client chunks — and `middleware.ts` excludes `_next/static`, so those chunks were served **with
no session**. It was the only thing failing the owner's rule that nothing Oura-derived is reachable
unauthenticated, and it blocked the public cut. The decoder now takes the table by **injection** and
**throws** when unset (decoding without it yields plausible wrong stride values feeding step counts
and auto-detection — a caller that cannot supply it must do nothing, and both client decode sites now
do). Served from session-gated `GET /api/oura-ble/decoder-constants`, cached client-side so an
offline cold start still works after one online session. **Verified against a fresh build:** none of
`sum_accel_mg_std`, `y_accel_std_ratio`, `stride_amplitude_frac`, `first_non_locomotor_frequency` or
`frequency_bin_high_frac` appears in any of the 154 client chunks. (The `decoder_base_settings`
matches that remain are the decoder's own property accesses, not the data — worth knowing before
reading that grep as a failure.) **This does not hide the numbers from a signed-in user and cannot**;
it closes *publication*. ⚠️ **NOT device-verified** — a cold offline launch is the case the caching
exists for and it cannot run in the sandbox. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-15 — Nutrition gets its Log Food action, and its deferred decision was already made
(Q-257, v1.316.0).** Q-237 shipped the row as Water · Saved Meals; the third was deferred because a
global Log Food must pick a meal type. **That pick already existed twice** — `mealTypeForHour` chooses
by clock time against the user's own windows and is shared by the saved-meals sheet and `logPlanMeal`
*precisely so the two cannot drift*, so a third rule would have been that drift. The entry's open
question is answered with live data: `meal_types` does carry the windows (`Breakfast 6-10 … Evening
Snack 21-24`). **The size gate forced the right shape** — the button took `nutrition-content.tsx` to
803 lines, so the row was extracted to its own component, which review had not caught. ⚠️ **Not
device-verified, and the live check could not show the button**: the whole row is client-gated on
`selectedDate`, and *Water* and *Saved Meals* are absent from the fetched HTML too — the control that
proves it is client-rendering rather than a bug. Journal:
[`docs/overview/history-2026-08-15.md`](history-2026-08-15.md).

**🆕 2026-08-15 — logging water stopped invalidating five caches for nothing (Q-243).** Taken after
the IA lane closed and released file ownership. `water-log-sheet` already invalidated on both write
paths, so nothing was stale — but Home also called `invalidateReadinessInputs()`, dropping
`readiness-score`, `weekly-stats`, `progress-summary`, `muscle-recovery` and `body-battery`.
**Verified rather than trusted:** grepping `waterMl`/`water_ml`/`waterIntake` across the readiness,
body-battery, shared-health and oura-model paths returns **nothing**, so water feeds none of them and
a glass of water was making five instant-paint cards refetch. Both redundant calls removed; each
screen keeps its own `fetchMeta()`, which is a refresh rather than invalidation. **The size ratchet
earned its keep on the way:** a 3-line comment pushed `health-content.tsx` 929 → 931 against its
shrink-only baseline and failed `check:rules`, so the explanation moved to where the expensive call
actually was.

**🆕 2026-08-15 — a planned meal can be answered both ways (Q-187 phase 2 slice 2, v1.315.0).** The
IA lane's Q-237 landed, which released the hold on this. Alongside "I ate this" there is now a
dismiss for a meal you skipped, hidden once the meal is logged (that answer is *derived* from the
food, so offering "no" beside it would offer to contradict it) and undoable in one tap. **"No" is
stored and "yes" is not**, deliberately: an absent food log is indistinguishable from an unanswered
prompt, while "ate it" is already visible in the day. **The number the design protects** — a day with
prefills and no answers reporting identical totals to a plan-off day — holds structurally, because
nothing unconfirmed enters `food_logs` and none of its **23 readers** changed. ⚠️ **Not
device-verified**; local SQLite v26 has still never run on a phone, so if the plan card comes up
blank, revert rather than debug forward. Automatic prefill is deliberately still unbuilt. Journal:
[`docs/overview/history-2026-08-15.md`](history-2026-08-15.md).

**🆕 2026-08-15 — Q-270 fixed forward: the training-stress route is warmed on launch.** The column
was empty because nothing called the route — it persists only as a side effect of being rendered, on
a Health tab the app does not open by default. One sync-provider warm-list entry fixes it, **placed
deliberately off the BLE ingest path** that Q-213 traced a multi-week outage to (and with no cron
layer to fall back on). ⚠️ **Forward only — the 89 empty days stay empty**, and the persist is
unproven locally because the dev seed gates before the write. **Re-read `training_load_ots` in a day
or two; if still 0, the diagnosis was incomplete.** Unblocks Q-204. Journal:
[`docs/overview/history-2026-08-15.md`](history-2026-08-15.md).

**🆕 2026-08-15 — Q-270 diagnosed: `training_load_ots` is computable every day and simply never
computed.** All four gates of `computeTrainingStress` measured against production rather than
reasoned about, and **all four pass**: readiness is `ble-derived` (31 days), `n_history` is 40 against
a threshold of 14, RHR is present on 30 of 30 recent days, and the MET grid on 2026-08-13 spans
**1,425 minutes with 1,146 values** against floors of 720/360. So the value could be written every
day, and is written on none. **The cause is that nothing calls the route**: it computes and persists
only as a side effect of rendering the Training Stress card, for *today* only — and that card lives
on Health → **Body** while the tab defaults to **training**. ⚠️ **The fix has a footgun worth
knowing before anyone starts it:** the obvious host is the BLE ingest path, which is exactly the loop
Q-213 traced a multi-week outage to, and there is **no cron layer** to fall back on. Fix shape is
recorded on the entry; it must be measured against the Q-213 CPU signature before merging.

**🆕 2026-08-15 — the explainer says "still learning" instead of nothing (Q-105-followup, v1.308.0).**
Below 30 nights the elevated-temperature deload cannot fire, and the panel said nothing about
temperature at all — indistinguishable from the feature not existing. The entry was blocked only on
having no channel to ask; measured first (**owner at 40 nights**, crossed 30 around 2026-08-05, so
this affects new accounts and resets rather than them), then asked. Owner chose to show the progress.
Rendered as its own line, **not** as a deload reason — the helper returns `number | null` rather than
a `Signal`, so the compiler stops it joining the "why recovery is suggested" list. **The build caught
a bundle regression nothing else did:** importing the threshold from `ai-dynamic` dragged
`onnxruntime-node` into the browser bundle — the **third** Q-221-boundary breach in two days, after
`node:path` (Q-230) and the decoder table. tsc, lint and all 3,899 tests passed with it in place.
Both temperature constants moved to the import-free `deload-constants.ts` and re-exported. ⚠️ Not
device-verified, and the state itself is unreachable on the owner's account. Journal:
[`docs/overview/history-2026-08-15.md`](history-2026-08-15.md).

**🆕 2026-08-14 — Q-107 measured and closed: the batching fix would have changed nothing.** The entry
said to read `error_events` in production before building, because #1149 made the Postgres codes
visible. Doing that reversed the conclusion. The dominant fault is not pool contention at all — it is
**`[pg 21000]` cardinality violations on `oura_heartrate` inserts, 5,771 events** (Q-215's
batch-dedupe fault). The pool/connect signature is real but small (16–39/day) and **both families
stop dead after 2026-08-13**, when Q-213 stage 1 and the HR dedupe fix shipped: 08-14 and 08-15 show
**zero**. Q-213 had already diagnosed pool exhaustion as a *symptom* of event-loop starvation — `pg`'s
connect timeout is a JS timer, so a blocked loop kills healthy connections while the DB answers in
milliseconds — which is why this entry's own 2026-08-08 update found 79% of failures were a lone
query failing while everything else succeeded, the wrong shape for exhaustion. Chunking the fan-out
was never the fix. **Corollary:** `getSyncDelta` going 23 → 24 queries on 2026-08-14 is safe on this
evidence, not merely tolerated. ⚠️ **Stopped is not fixed** — two quiet days is not proof, and 08-14
had zero events of *any* kind, as consistent with a quiet day as with a fix. Re-read `error_events`
next session; if either family returns it reopens as Q-213's, not this entry's.

**🆕 2026-08-14 — the pre-build check on Q-184 says don't build it, and found an emptier pipe next to
it (Q-270).** Q-184 asks for an on-device calorie estimate — Kotlin plus an APK, the most expensive
work in the queue. Its own entry asks for a check first, and the check answers twice over.
**(a)** `activity-goal-calibration.md` §5-B's direction B explicitly *replaces* the dead
`activeEnergy`, and the owner chose direction C on 2026-08-11 — so building `active_calories_est`
means building the input the agreed direction discards. **(b)** The suggested alternative is not
ready either: **`training_load_ots` is 0 of 89 days populated in production**, despite having a live
server-side producer (`/api/training-stress`). §5-B's "already exists and may be most of it" is true
in code and **false in the data**. Two gates ruled out by measurement so nobody re-checks them:
readiness is fine (**31 days** `ble-derived` with scores, latest today) and MET events are arriving
(**222 rows in the most recent 50,000** raw samples). The likely cause is that the route only ever
computes *today*, on demand, and never backfills — which would make it **server-side work with no
APK**, far cheaper than Q-184. Filed as **Q-270**; it gates Q-204, whose design assumes that column
is most of its input. Q-184 is now recommended to be held behind both.

**🆕 2026-08-14 — Q-181's deferral re-confirmed by re-measuring it (watch-only).** The entry records a
decision *not* to build per-worker DB isolation, because every instability observed had a specific
cause that isolation would have hidden rather than fixed. A deferral is worth what its evidence is
worth, so it was re-measured: **89 files / 545 tests, 3 consecutive runs, 0 failures, 86–88 s**,
against the 2026-08-10 baseline of 387 tests at 72–107 s. The suite has grown **+41%** against the
same shared database — more of exactly the pressure isolation would relieve — and the spread got
*tighter*. The named trigger (two files failing on each other's rows, distinct ids, no migration) has
not fired. Kept as ⏳ watch-only rather than removed: it is not finishable, and deleting it would lose
the trigger's definition. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-14 — Q-180 decided: keep `getOuraTimeseriesDelta`, and make the code say why.** Q-136's
route deletion left a keyset-cursor implementation and 142 lines of passing tests with no caller, and
the entry deliberately left the delete-or-keep call un-taken. Decided from measurement rather than
preference: **`ouraHeartrate` appears nowhere in `SyncDelta`**, so intraday HR reaches a fresh device
by no other path, and the owner's 2026-08-02 retention decision makes the device-local raw store a
14-day rolling window with the **server** as the archive — a re-install loses history that still
exists server-side. **The entry's real cost was the audit paragraph, not the code**, so that is what
was fixed: the method and its test file now carry the decision and its evidence, and the queue no
longer holds it. No behaviour change. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-14 — the meal-plan prefill's table and sync path, with nothing reading it (Q-187 phase 2,
slice 1).** A prefilled meal is *suggested*, not eaten, so a prefilled row reaching `food_logs` would
make the day's totals count food nobody ate. The obvious fix — a `confirmed_at` column plus a filter
at every read — means teaching **23 files** a new filter in the domain with this project's worst
data-loss history; instead unconfirmed prefills never enter `food_logs` at all, and **none of the 23
readers change**. Only *declines* are stored: "ate it" is derivable from the food log, and a row
asserting it too would be two sources of truth for one fact. **The tests caught a real bug rather
than confirming one** — re-declining after an undo inserted a *second* row, because the unique index
is partial on `deleted_at IS NULL` and the tombstone is invisible to the conflict target; the read
filtered it out, so it would only ever have shown up as row growth. **The CI failure was a gap in the
local gate, not the diff:** `claude-ro-readonly-role.test.ts` is pinned to the newest views migration
(80 views vs 81 tables), and it **skips entirely under the socket `DATABASE_URL`** the session hook
exports — so the local run read `470 files | 1 skipped` and looked green, while the TCP form gives
`471 files, 3,900 tests, none skipped` and reproduces CI exactly. Run role-sensitive suites under
TCP, and treat a nonzero skip count as something to explain. ⚠️ **Not device-verified, and higher
risk than most**: local SQLite v25 has never run on a phone and v26 stacks on it — if Saved Meals or
the plan card comes up blank after this ships, **revert rather than debug forward**. The prefill UI
is deliberately still owed, held until the Q-237 nutrition-screen work lands. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-14 — goals stop being two disagreeing copies (Q-240, Q-241).** Editing a goal PATCHed
the server and invalidated nothing, so Health rendered the previous goal for up to the `user-goals`
TTL and repainted it stale on the next cold start — while `patchProfile` forty lines above it in the
same file had always invalidated, through a group that already contained the key. **The sibling
sweep found the same omission on two Coach surfaces the entry did not name.** Underneath it, nine
goal values lived in `localStorage` *and* the database and the Health tab read three from the device
copy only; `localStorage` does not sync, so a second device or a re-install showed defaults while
the server held the real goals, with nothing to reconcile them. The payload is authoritative now and
the seed is written **from** it — including its nulls, and through the sync-provider warm list
rather than a tab, since a device that never opens Health was the case that stayed wrong. **A third
bug had to ship with it:** clearing a goal never worked — the editor sent no request when a field
was emptied, and the route's `?? undefined` made an explicit null a 200 that changed nothing
(measured live). Making the server authoritative is what would have made that visible. **Two guards
were wrong before they were right, and both are worth knowing:** the invalidation guard first
detected Coach writers by a string this fix itself introduced, so it recognised only code already
carrying the fix; and matching the goals URL and `PATCH` separately flagged `health-content.tsx`,
which only reads that endpoint. ⚠️ **Not device-verified** — JS-only, so it reaches the phone on the
next deploy, but "a second device sees the first one's goals" is by definition a two-device check.
Journal: [`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-15 — Nutrition's actions stop depending on scroll depth (Q-237, v1.314.0), closing the
2026-08-14 review cluster.** Saved Meals is a library, not an action, and it sat **below every meal
card** — so how far you scrolled to reach it depended on how many meals the day had; Water was
mid-scroll for the same reason. Both are now one row directly under the macro ring, above every meal
card. Verified by position rather than by eye: in the rendered text the ring is at index 126, Water
at 208, Saved Meals at 220, End of Day at 490. **Two things deliberately not done.** *End of Day*
stayed put — merging it with Home's "Your Day in Review" is **Q-112**, spec-sized with its own entry,
and moving it halfway is worse than either end state. *"Log Food"*, which the plan's row names, was
**not** added: no global log-food action exists (`openLogger` requires a meal type, each meal card
supplies its own), so a row-level button must *pick* one — by clock time, next unlogged meal, first
meal type, or a picker — and that is a product decision this placement change should not invent.
Filed as **Q-257**. Water's three `WaterLogSheet` mounts stay three mounts; their divergent
invalidation is **Q-243**, still open, and is a behaviour fix rather than a layout one. ⚠️ **Not
device-verified** — two-column tap targets at 412 px are the case the S25 decides (the row is
`min-h-[48px]` with `gap-3`, meeting 48 dp / 8 dp on paper). Journal:
[`docs/overview/history-2026-08-15.md`](history-2026-08-15.md).

**🆕 2026-08-15 — the admin console splits by audience (Q-234, v1.313.0).** `/admin` had nine tabs,
three sub-consoles reachable only from inside the Tools tab, and a nested "Additional tools"
collapsible inside that — two audiences in one console. **User administration** (users, invites,
feedback) stays at `/admin`, now five tabs and 395 lines from 476. **Developer diagnostics** (BLE
debug, cadence calibration, device data capture, HR backfills, time audit, error log, AI usage, model
assets) are **Settings → Developer**, admin-only, with the three device consoles as **rows** rather
than buttons inside a tab inside a console — which is what Q-239 identified as the only genuinely
misplaced single-entry screens. **`exercises`/`activities` stayed on `/admin` deliberately:** the
plan names them under neither audience, and they are content administration — the library every user
sees — not device diagnostics, so they sit with the audience they match rather than moving because
they were adjacent to things that moved. **Both sides of the gate were exercised** by flipping the
local test user's `is_admin` and re-logging in each time (reverted after): non-admin sees no
Developer row and `/more/settings/developer` redirects to `/`; admin sees the row and all three
sub-routes render real content. **A trap worth knowing:** `isAdminUser(id, flag)` returns the **JWT**
flag whenever it is a boolean and only hits the DB when it is undefined — so flipping
`users.is_admin` does nothing until a fresh login stamps a new token. ⚠️ **Not device-verified** —
four more navless takeovers on `pb-safe-action-lg`, and the consoles behind these rows are APK-only
by nature. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-15 — the Program Builder gets a route, and a dead deep link comes back (Q-235, Q-256,
v1.312.0).** The app had a bottom-nav tab called **Workout** and, inside More, a second tab *also*
called **Workout**, mounting the 997-line Program Builder two containers away from the tab it
configures. It is `/program` now — reachable from a control in the Workout tab's header and from
More → Program; More has two tabs left. **Q-256 was fixed by changing the shape, not the string.**
`/config` dropped the query string through a bare `redirect()`, and `config-screen.tsx` read
`?new=program` from `window.location.search`, so the post-deload "New program" action opened the
Builder and silently never opened the sheet. Forwarding the string would have left the same trap for
the next redirect; the flag is a **prop** resolved from `/program`'s own `searchParams` instead — a
param read from the URL can be dropped by anything in between without a call site changing, a prop
cannot. Measured before and after on the same URL: no sheet, then the sheet. **The Q-223 regression
test was rewritten rather than deleted** — its specifics were gone (no `tab=` value, no
`ConfigScreen` in More) but its invariant survives: every legacy entry point must land on the
Builder carrying its parameters. **One of its assertions did not discriminate, and only mutation
testing found that** — it checked that `searchParams`/`URLSearchParams` *appear* in the file, and a
mutation keeping both while setting the suffix to `''` passed it while dropping every param. That is
a guard recognising the shape of the fix rather than its effect. It now calls the route and reads
the `NEXT_REDIRECT` digest; all six assertions are mutation-verified. **The negative assertions also
first failed on my own comments** (prose describing the very bugs they guard) — the test strips
comments now, the same shape as the Custom Rules safe-area step failing on a comment two PRs ago.
⚠️ **Not device-verified** — `/program` is a navless takeover on `pb-safe-action-lg` and the Builder
ends in tappable controls. Journal:
[`docs/overview/history-2026-08-15.md`](history-2026-08-15.md).

**🆕 2026-08-15 — Settings gets a screen, and `profile-tab.tsx` leaves the size baseline (Q-232 step
3, v1.311.0).** Preferences (six switches), Theme & Appearance and Home Widgets were three
collapsibles inline in the More scroll; they are `/more/settings` now, behind one row. **The file
that opened this cluster as one of six `check-component-size.js` hotspots is 465 lines, from 845,
and its BASELINE row is deleted** — the script's own rule, since a row left behind for a file under
the limit turns the ratchet into an allowlist. Five hotspots remain. The plan predicted this and it
happened **without an artificial split**: 845 → 835 (devices) → 697 (data/about) → 465 (settings),
four screens carved along seams the IA already implied. Ten pieces of state and nine handlers moved
whole, having been checked as read *only* inside the moving block — every value they set is a
`localStorage` flag some other screen reads, so nothing in More depended on where the state lived.
**The toggles were operated, not just rendered:** flipping "Rest Timer in Status Bar" wrote
`ta_pref_rest_chip = "false"`, read back out of `localStorage`. ⚠️ **Not device-verified** — the
`pb-safe-action-lg` clearance on four navless sub-screens, the push toggle (needs a real
service-worker registration and permission prompt), and whether the *native* status-bar pill reads
those flags correctly: the write side is proven here, the read side is not. Journal:
[`docs/overview/history-2026-08-15.md`](history-2026-08-15.md).

**🆕 2026-08-15 — "Restore from cloud" stops living under the version number (Q-232 step 2,
v1.310.0).** One block on More → Profile held the version, update check, SW status, APK download and
changelog — **and** Sync now, Restore from cloud, Export my data, all under a heading saying *About*.
The plan calls this the clearest single instance of the owner's complaint, and it is the one part
that has to be **split** rather than moved: three data operations filed under a version number. They
are `/more/data` now; the rest is `/more/about`. **Settings was deliberately left to step 3** — it is
an independent block sharing no state, so bundling it would have made one PR touching ten preference
toggles, two collapsibles and three sync handlers at once; About/Data had to move together because
they were one block. `components/more/sub-screen.tsx` now owns the navless takeover shell, extracted
at its second copy and used by Devices, Data and About. `profile-tab.tsx` is **697** lines, from 845
at the start of this cluster. **The custom-rules safe-area check failed on my comment** — the grep
found the raw inset expression in the prose explaining why the utility is floored; reworded the
comment rather than touching the check, which is the right trade for a rule with that history.
**The moved handler was run, not just rendered:** tapping *Sync now* produced "Cache cleared" within
400 ms. ⚠️ **Not device-verified** — the `pb-safe-action-lg` clearance on three navless screens, and
the *native* branches of both moved handlers (`pullDelta` and `restoreFromCloud` both return null
without SQLite, so only the fallback path runs here; Restore has never run in the sandbox at all).
Journal: [`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-15 — the Devices screen (Q-233, v1.309.0).** Ring, chest strap, scale and the
background-location permission were four cards stacked between "Goals" and "Settings" in the More
scroll, so *"is my ring connected and what is its battery?"* meant scrolling two-thirds of the way
down More. They are one screen now, `/more/devices`, behind a single row — step 1 of the IA plan's
build order, taken first because it is the smallest real win and proves the sub-route pattern.
**Three things the plan did not anticipate.** All four cards already render their own uppercase
heading, so the wrapper section headers produced *PAIRED DEVICES / INTEGRATIONS / Oura Ring 5* — a
heading above a heading, now gone. `BackgroundLocationCard` returns **null** off-device, so a
"Permissions" heading sat above nothing in the sandbox and would do the same wherever the permission
check is unavailable — caught by reading the rendered text, not the source. And **the size ratchet
fired**: swapping four component tags for a row grew `profile-tab.tsx` 845 → 850, past its baseline.
The fix was not to raise the number — the row was the *second* copy of the Admin row's markup, so it
became `components/more/more-row.tsx`, both call sites use it, the file is **835**, and the baseline
ratcheted down with it. That primitive is the grouped-list row the rest of the plan needs, arrived at
because the check refused the lazy option. One string changed inside a moved component:
`oura-section.tsx`'s heading said "Integrations", which is not what it is on a screen called Devices.
⚠️ **Not device-verified, and this screen has more riding on that than most** — it is navless, so its
trailing padding is `pb-safe-action-lg` rather than a bare `pb-safe`, every card ends in a tappable
pairing control, and the sandbox renders insets as 0; `BackgroundLocationCard` cannot render here at
all, so the Permissions half has never been seen. Journal:
[`docs/overview/history-2026-08-15.md`](history-2026-08-15.md).

**🆕 2026-08-15 — the More-tab IA plan is written, and it found a dead deep link (Q-232, Q-239,
Q-256).** Q-232's entry forbids executing it from the entry — the five IA items share one target
structure and working them one at a time leaves the app half-reorganised in two incompatible
directions — so this is the plan, covering Q-232/233/234/235/237 and the Q-239 decisions together:
[`docs/superpowers/plans/2026-08-14-more-tab-information-architecture.md`](../superpowers/plans/2026-08-14-more-tab-information-architecture.md).
Target is the standard grouped-list pattern with **each row a real sub-route**; all sixteen of
today's `profile-tab.tsx` sections are mapped, and **the cost claim was checked rather than assumed**
— ten already-extracted components totalling 2,053 lines, so it is routing and composition with no
screen internals rewritten. **Admin splits by audience** (user administration stays at `/admin`;
device/data diagnostics become Settings → Developer). **Q-239 is decided: five of the six
single-entry screens are "leave"** — each is genuinely the detail view of the card that owns it —
and only the `/admin/*` trio was misplaced, which is Q-234's job; the table is written down so the
next reachability sweep does not re-open it. **Q-256 found on the way:**
`components/workout/ai-prescription-card.tsx` sends the post-deload "New program" action to
`/config?new=program`, `app/config/page.tsx` does a bare `redirect('/more?tab=workout')` that
**drops the query string**, and `config-screen.tsx` reads that param from `window.location.search` —
so the sheet never opens and the action silently degrades to "open the Program Builder". Measured
live, second instance of Q-223's class, deliberately left for Q-235 to fix since that item rewrites
these redirects anyway. Docs-only, no version bump. Journal:
[`docs/overview/history-2026-08-15.md`](history-2026-08-15.md).

**🆕 2026-08-15 — the theme-token rule gets a ratchet, and the trend it was recording was backwards
(Q-244).** Hex literals under `app/`+`components/` `.tsx`: 455 on 2026-08-07, 430 on 2026-08-09,
**471** on 2026-08-14 — while CLAUDE.md recorded the trend as improving. **+41 in five days,
unnoticed**, because the rule was prose and nothing measured it between two hand counts. The two
comparable rules that hold (component size, the `color-mix` hue bug) each have a shrink-only CI
baseline, and that is the only structural difference. `scripts/check-hex-literals.js` now runs in
Custom Rules (**35 steps**) with a **per-file** baseline rather than a single total — a total lets
one file grow while another shrinks, which is precisely what "the trend looks fine" looked like on
2026-08-09 — and a row for a file that reaches zero **must be deleted**, or the baseline decays into
an allowlist that lets hex return to a file already fixed. The regex is deliberately the one that
produced the numbers above, over-matching (`#1279` in a comment counts) and all, because a baseline
whose number cannot be reproduced from a shell is one nobody trusts. **The existing 471 are not
swept** — that is separate and much larger. Mutation-verified three ways: a literal added to a
baselined file, one added to a file with no row, and a baselined file stripped clean. CLAUDE.md's
count is corrected and now records the reversal itself. Nothing device-shaped here — one CI script,
one workflow step, two doc lines, no runtime code. Journal:
[`docs/overview/history-2026-08-15.md`](history-2026-08-15.md).

**🆕 2026-08-15 — the second Home screen is deleted, and one shim decision goes back to the owner
(Q-236).** `/overview` was 543 lines with its own fetches and cache reads and **zero** in-app links —
re-verified before deleting, including that no push payload or manifest entry points at it. **The
review predicted it would drift from Home; it already had:** the orphan carried private
`loadWidgets`/`saveWidgets` copies against a *different* storage key (`ta_meta_widgets` vs
`ta_ss_widgets`) with *different* defaults and no SSR guard, so it could never have agreed with Home
even if something had linked to it. Gone with it: `components/readiness-card.tsx` (269 lines, sole
importer was the orphan — the Q-238/Q-180 dead-with-a-passing-grep shape) and the `'overview'`
background palette the entry did not mention, in **four** places (`dynamic-background.tsx` ×2, the
`ScreenPaletteKey` union, and both light and dark `--screen-palette-overview` blocks). **The three
`/sheet/[id]/*` shims were NOT deleted, deliberately:** the owner decided to keep them on 2026-08-10
(Q-136) *because they were "the only inbound path to `/chat`"* — and `#1293` deleted `/chat` three
days later on a different decision. The rationale has expired but the decision is the owner's, so it
was filed as **Q-255** rather than reversed. ✅ **Answered 2026-08-16: the owner confirmed no
bookmark, shortcut or saved note uses a `/sheet/...` URL, and all three shims were deleted.** The overview shim is repointed at `/`, since its target
no longer exists. **Getting that target right needed the browser:** the first attempt used
`/session-select` — which is named like Home and is even the manifest's `start_url` — and it is a
legacy redirect that lands on the **Workout tab**. ⚠️ **Not device-verified** — CSS-variable-only
palette removal, no layout or safe-area change, but unseen on the S25. Journal:
[`docs/overview/history-2026-08-15.md`](history-2026-08-15.md).

**🆕 2026-08-15 — one TTL per cache key is now a CI check, not a request (Q-242).** The entry was the
review's smallest item — `day-log:` fetched with a literal `TTL_MEDIUM` at one site and `DAY_LOG_TTL`
at another, equal values, nothing broken. **The whole-repo scan it asked for is what mattered:**
`day-log:` had **three** sites, not two, and two further keys diverged — `hr-profile` was
`HR_PROFILE_TTL` (6 h) at seven sites and a raw `TTL_MEDIUM` (30 min) at the eighth, which is the
last-writer-wins split the rule exists to prevent rather than hygiene; and `workout-data:` carried a
local `const TTL = TTL_LONG` alias against a direct `TTL_LONG`. Three divergences under a rule that
has had a constants file built for it since ~session 104 is the actual finding, so the scan shipped
as **`scripts/check-cache-ttl-divergence.js`** in the Custom Rules job (**34 steps**). It compares
TTL *expressions* rather than values (two names for one number today is what drifts tomorrow),
covers `setCached` and the **sync-provider warm list** as well as the fetch sites, and **prints its
own blind spot** — four keys built by helper calls cannot be resolved statically, so a clean run
states how many it skipped. **It was wrong twice first:** it resolved a re-declared `const cacheKey`
from the file's first definition and invented a divergence that did not exist, then counted a
comment beside an argument as part of the expression. Mutation-verified against each unfixed site.
**A second, different bug rode along:** `observed-hr-card.tsx` held the repo's only
`useState(() => readCacheSync(…))` — the forbidden lazy initializer, the session-165 / Q-73
hydration-mismatch class — now seeded in the effect. That is the user-visible half and what the
version bump is for. ⚠️ **Not device-verified**, and note the hydration fix is precisely what
`pnpm dev` cannot prove either way (one process, one timezone). Journal:
[`docs/overview/history-2026-08-15.md`](history-2026-08-15.md).

**🆕 2026-08-14 — the Health tab's card customiser is gone, not rebuilt (Q-238).** `saveHealthCardOrder`
and `saveHiddenHealthCards` had no caller outside their own test while the readers ran on every
mount — the shape that reads as a shipped feature in every grep. **Git history is what decided it,
and the backlog entry did not carry that history:** the UI existed (`0376da61`, card-visibility
toggles in More → Settings), its render site was removed on purpose the next day (`4e9ecffd`),
drag-to-reorder went with it for scroll lag (`077f48e0`), and the orphaned file was swept as a
"dead file, not imported anywhere" on 2026-06-28 (`73d6d0c3`) — while the helpers and every reader
stayed. Rebuilding it would re-add what the owner removed and would place a Settings surface
**Q-232's plan has not decided yet**. **It also had a half nobody had noticed:** a card hidden during
that one-day window could never be un-hidden, because the readers went on honouring
`ta_health_hidden` with no writer left — so the deletion goes through the readers too, and any such
card is visible again. Rendering is otherwise unchanged: with the hidden set permanently empty, all
nine gates were already constant `true`. ⚠️ **Not device-verified** — no layout, safe-area or sheet
geometry changed (the removed wrappers were `{flag && (…)}` around cards that always rendered), and
all three Health tabs were exercised in `pnpm dev` at 412×915 with zero console errors, but this has
not been seen on the S25. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-14 — a walk records the steps and calories it always could have (Q-230).** Owner: *"we
[have] spm we should be able to get steps count right? as well as a burned calorie number"*. Right on
both — neither was missing because it could not be computed; both were written as literal `null`
while the inputs sat there. Steps now integrate the strap cadence series the walk already persists
(**gated per reading, not per activity**: it is a no-op while `RING_CADENCE_VALIDATED` is false, and
stops a future mixed-source walk counting ring data into a step total). Calories call the same
`estWorkoutKcal` the Body tab's aggregate already ran over the same row, with a test asserting the
two agree exactly. **A comment saying "computed server-side; hydrates on the next sync" appeared in
three writers and was false** — nothing computes it, which is why nobody looked. The sweep found
**four** `activity_logs` writers, not two — but the calorie derivation covers all of them from one
place, because it lives in `saveActivityLog`, which the web route and the outbox's `pushMutations`
branch both already call. **It got there the hard way:** the first attempt computed the estimate in
the client components and **failed CI's Build check** — `estWorkoutKcal` reads its MET table through
`lib/oura-models/constants`, which resolves files with `node:path`, so a client import drags
`node:path` into the browser bundle. That is the Q-221 boundary holding. **The local gate was
running tsc, lint, custom rules and the suite but not `pnpm build`; it does now.** **Near-miss the
client attempt produced, kept because the lesson outlives the code:** the helper read `profile` off
the cached `body-metadata` payload and **that route never exposed it** — it would have returned null
forever, the exact empty column it was written to fill. No test would have caught it; hitting the
live dev server did, and the guard then written to pin the coupling *passed with the field deleted*
because it sliced from the handler's `Unauthorized` early return. Both are gone with the move
server-side. ⚠️ **Not device-verified**: the step
estimate's inputs come from a live strap over BLE, so the arithmetic and wiring are proven but not
that a real walk reports something a pedometer would recognise. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-14 — a failed local write now falls through to the server (Q-216).** #1292 made
`runSQL` throw when the local DB is not open, so a silently-failing local write became a loudly
failing one — and four sites had the shape `if (store) { …local… } else { …API… }` inside one `try`,
so a throw skipped the `else` and landed in the outer catch. **The guided walk was the worst**: its
handler set `saved` and said *"the outbox retries on device"* when the outbox write was exactly what
had failed, so a walk with GPS, splits and pace series was gone while the screen said it was safe.
Fixed in `walk-summary`, `end-of-day-review`, `saved-meals-sheet` and `nutrition-content`'s delete.
**The entry's premise was wrong**: it said only two sites had the fallback; **twelve** did, and
`test-result.tsx` has the correct behaviour written a different way — so this audit had to be on
behaviour, not on grepping `savedLocally`. `workout-screen` is correct by design (local write
best-effort, POST primary). The size gate pushed the quantity maths out of `saved-meals-sheet` into
`saved-meal-qty.ts`, where it finally has tests. ⚠️ **The failure itself is not exercisable here** —
`getLocalStore` returns null in the sandbox, so the branch being fixed cannot run; only the S25
reaches it, which is why these survived #1292's sweep. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-14 — the check-in's suggested soreness can no longer survive an open (Q-226).** The owner
opened Exercise Readiness to five selected muscles and a whole-session-deload warning, closed it, and
reopened to two and no warning. `MoodCheckInSheet` is rendered with `open` as a prop and never
remounts, so **all its state survives every close** — and two effects read `suggested` in ways that
let the previous open's value reach the picker: the cache seed used `if (seed)`, so a miss left the
old value in place, and the reset effect seeded `soreMuscles` from a closure with no `suggested`
dependency. **Both were needed**: the two effects run in the same flush, so reassigning `suggested` in
one does not change what the other closes over in that pass. ⚠️ **Not proven, and worth being plain
about**: a CDP browser harness (Chromium over node's WebSocket, no new dependency) never reproduced
the fault — fixed and unfixed code produced identical output — so this rests on reading the source,
not on observing the fix work. Both stale reads are real and neither is defensible on its own terms,
but the owner's sequence is unconfirmed. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-14 — Coach asks about pain instead of logging an injury off it (Q-227).** The owner asked
*"lower back pain from some of my excercises what donyou think it is?"* and got back only a **"Log
Lower Back Injury" card at Severity: mild** — no prose, and a severity they never said. `SYSTEM` has
had a "propose only when asked" guardrail for `early_deload` since it shipped, and `program_phase` has
its own; **`injury` had neither**, so a bare mention of pain was enough to fire a write proposal. A new
`## Pain and injuries` section names what to ask first and forbids proposing in the same turn as the
first mention of pain. **The severity half is not just a prompt change**: telling the model to omit the
field moves the fabrication into `apply`'s `severity ?? 'moderate'` default, so the confirmation screen
now says *"Recorded as moderate — change it in Health → Injuries if that is not right"* whenever the
proposal omits one, and the literal is named once so the promise and the write cannot drift.
⚠️ **The prompt half is unverifiable here** — proving the model obeys it needs a real conversation, so
what is proven is that the instruction is present and specific. Worth reporting back next time pain
comes up. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-14 — a deloaded log can no longer become a prescription basis (Q-228).** The owner was
prescribed **72.5 kg on Incline Bench Press (83% of an 86.25 kg 1RM)** against a last session of
42.5×8 — and caught it before loading the bar. Those 42.5s were a whole-session AI deload at 52%;
migration 168 corrected four of that session's five exercises, auditing 21:47–22:09 UTC, and **Incline
Bench Press was logged at 21:41:20, six minutes before the window**. The structural half is the part
that matters: `getLastRealOneRmBatch` selected on `estimated_1rm > 0` and **never filtered
`exercise_deloaded`**, trusting a write-time invariant that production disproves — while its sibling
`reconcilePersonalRecord` has carried that exact filter all along. Migration 186 zeroes **both**
`estimated_1rm` and `target_80` on the straggler (the second column is the dial pre-fill, and the
entry missed it). **Honest current state: the symptom already self-cleared** — the owner logged a real
76.5 on 2026-08-13, which shadows the straggler, and exactly one poisoned row exists in their history.
This closes the gap and cleans the row; it changes no number visible tomorrow. No `personal_records`
fix needed — `shouldCountTowardPr` does check the flag, so the PR (78.75) was never touched.
**Reproduced on the live route in both directions**: with a poisoned deload row as the newest log,
`/api/workout-data` returns the real 98/80; reverting the one filter line returns 999/799.
**✅ Confirmed in production 2026-08-14** — v1.306.2 deployed, migration 186 in `schema_migrations`,
and the row now reads `estimated_1rm = 0`, `target_80 = 0` with the flag still true; **zero** rows in
the owner's history now have `exercise_deloaded = true AND estimated_1rm > 0`. (Worth knowing: a query
run seconds after the merge still showed 85.75/44.5 — `ensureSchema` applies on cold start, so read
the deploy as landed only once `/api/version` reports the new version.) Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-14 — AI prescriptions actually expire (Q-229).** `prescriptionExpiresAt` was written at
generation and read in exactly one place — the emergency-deload suppression, which only asks whether
a still-*pending* offer is still on the table. Nothing aged out a prescription the lifter was
training against, so a session type left unused past its own 7-day window replayed its last
AI-computed pct/sets/reps until an unrelated soreness or emergency signal happened to fire. The owner
hit it as an **8-day-old deload-era 52% served on a live Intensification day**. The boundary was
real, documented in `reevaluate.ts`'s own doc comment, and enforced by nothing. Nineteen lines now
enforce it, **before** the soreness re-derivation so a stale plan is replaced rather than refreshed
into looking current. `pending` is deliberately excluded — its expiry already belongs to the
suppression, and there are **two** copies of that check (`emergency-deload.ts:19` and
`generate-prescription.ts:218`), both untouched. Measured 2026-08-14T03:05Z: of the owner's five
prescriptions carrying an expiry, none was expired *at that moment* — because the cited row had
regenerated an hour earlier when its session was next run. That is the shape of the bug, not a
refutation: it self-clears on use and only bites in the gap between runs. Live prediction: row
`5e04a6d9` (generated 2026-08-08) expires **2026-08-15T23:47Z**. **Confirmed end-to-end on the dev
server**, not just in unit tests: a seeded 9-day-old `auto_applied` prescription at a flat 52% was
replaced, on one `workout-data` read, by a real regeneration at 84% 4×4 with a fresh 7-day expiry.
Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-14 — the Oura Cloud integration is gone (Q-224).** The automatic calls went on
2026-08-13; this is the rest — the OAuth/PAT flow, the sync route, the webhook receiver, the HTTP
client, the token cipher, the token storage, and every button that fired one. **Every row of
historical Cloud data is kept**, along with `lib/oura/cloud-freshness.ts` (the re-key constant two
live readiness paths read) and the six `/api/oura/` routes that were only ever local. **Five of the
backlog entry's premises did not survive reading**, and each would have been a live regression — most
quietly, `/api/oura/stats`'s `connected` flag gated the Health tab's whole Ring section on an
`oura_tokens` row, so removing token storage would have made that section render nothing, with
nothing thrown and nothing logged. It is a BLE fact now, pinned in both directions. The More →
Profile card had surgery rather than deletion (it also renders the live BLE battery) and is
BLE-only: battery, last-seen age, a Live badge that now means live. Two new mutation-verified guards,
including a source sweep over 1,000+ files that fails if any Cloud call returns. ⚠️ **NOT
device-verified** — both rewritten surfaces are canonical-runtime screens, and the Ring section's
visibility now depends on an `oura_raw_samples` query; the check is "open More → Profile and the
Health tab, confirm the ring still reports battery and a last-seen time". Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-14 — the Warm Up countdown reads the session's own budget (Q-212).** Owner, on a 30-min
Quick session: *"its still giving 10minutes warmup … should of been only 5minutes"*. They were right,
and the number they expected was already being computed — `warmupBudgetMin()` has been live for
months shaping the `effectiveTimeBudgetMin` the AI prescription is trimmed against, so the app was
already building a **shorter exercise list** for a Quick session while the countdown said ten
minutes. Two concepts, one of which scaled. `warmupGoalSecFor()` composes the two existing shared
functions — no new formula — and both call sites now use it: the screen and `startRestChip()`, which
anchors the Android rest-timer notification to the same number (fixing only the screen would have
left the shade saying 10:00). The 600 s constant survives as a fallback for the window before
`workout-data` lands. The `useMemo` pushed `workout-screen.tsx` past its shrink-only size baseline,
so the whole duration-preset concern moved into `components/workout/use-duration-preset.ts` — the
file ends **smaller** than it started. ⚠️ **NOT device-verified** — the arithmetic is covered, but
seeing a 5-minute countdown, and the notification-shade chip agreeing with it, is a device
observation. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-13 — `/config` opens the Program Builder again (Q-223).** The shortcut redirected to
`/more?tab=config`, but `more-content.tsx` parses `profile | friends | workout` and silently drops
anything else — so it landed on Profile and looked like the link did nothing. The Builder mounts
under `workout`; one value, wrong. **Two links were affected**, not just the AI Coach card that
surfaced it: the session-select recommendation card has had the same `href="/config"` for longer.
Observed fixed on the dev server (`307 → /more?tab=workout` with a session). The guard pins both that
the tab is *parseable* and that it is the tab `ConfigScreen` actually mounts under — `profile` would
satisfy the first and still strand you. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-13 — the app stops calling the Oura Cloud (owner decision), and two fixes are confirmed
in production.** Owner: *"get rid of oura cloud references we dont use it."* The two **automatic**
calls are gone — the Cloud HR pull on **every workout completion**, and the app-open/resume Cloud
sync (62 lines in `sync-provider.tsx`). Both were unable to succeed since the 2026-07-07 re-key, so
each one spent a request earning a 401. **Deliberately left, and not tidiness:**
`components/more/oura-section.tsx` renders the **live BLE ring battery** *and* the Cloud controls in
one component, so deleting it would remove the ring battery display — it needs surgery, filed as
**Q-224** with the rest of the surface. **Historical Cloud data stays** (`oura_daily` and friends are
health history, read by health-trends/day-timeline/More). Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).
**Confirmed from production, not predicted:** a ring sync at 13:20:25 logged
`[oura-ble] rollup worker ready` — Q-213 Stage 2 is genuinely off the request loop — and the
v1.304.3 boot log is 13 lines, all `info`, zero errors, where the previous one opened with two
`TOKEN_ENC_KEY` errors.

**🆕 2026-08-13 — the `TOKEN_ENC_KEY` boot log was crying wolf (Q-217).** Every container start
asserted a broken security control, twice, at `error` severity. Measured rather than judged:
`encryptToken` has exactly **two** callers, both meaning "connect an Oura *Cloud* credential" — a
surface dead since the BLE re-key; production's token row was written **2026-06-22**, seven weeks
before `token-crypto.ts` existed, so it is unprefixed plaintext that reads back fine with or without
a key; and `has_pat` is **false** (it is an OAuth pair, not a PAT). The `error` severity was a
Railway artifact — `console.warn` goes to stderr. The import-time warning is gone and the case that
was genuinely **silent** now reports: `decryptToken` handing back ciphertext when the key vanished,
which Oura rejects as "malformed" and sends you hunting the credential instead of the key. Setting
the variable is now optional, not blocking. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-13 — Q-213 is fully shipped, and a live barcode report is recorded as unexplained.**
Stage 3 replaced a coalescing predicate that meant "any batch" with a trailing-edge debounce, and the
admin Redecode route — the heaviest pair of calls in the app — moved into the worker too. Separately,
the owner reported barcode scanning broken and then working again an hour later. **Open Food Facts is
up (200 in 0.86 s) and nothing barcode-shaped reached production**, but the cause is unrecoverable
because `/api/nutrition/barcode` only `console.error`'d and never called `reportServerError` — the
same gap Q-218 closed for its sibling scan route and stopped there. That route now reports; **12
other `app/api/nutrition/*` routes still do not.** Recorded as unexplained, not fixed. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-13 — the resolved Known Issues moved out of the orientation read (Q-220 Lever 1).**
Every session reads this file before it can start, and 68% of it was Known Issues. 53 fully-resolved
entries (1,092 lines) are now in
[`docs/overview/known-issues-resolved.md`](known-issues-resolved.md) — **9,184 → 8,105
lines, 748 KB → 668 KB**, roughly 20k tokens off every session. `CLAUDE.md` gained the rule that
keeps it true: striking an issue means *moving* it there, not marking it ✅ in place. **It came to
11.7%, not the 17% the backlog entry predicted, and the gap is the finding** — of the 72 ✅-marked
entries, **19 still had something owed** (a pending device check, a blocked finding, a WAL restart)
and stayed. A sweep keyed on the tick alone would have archived the sign-out-wipe check the current
handoff is still chasing. Conservation was proved rather than claimed: 885 non-blank lines out, 885
in, identical and in order; 284 headings → 231 + 53. **Lever 2 — routing the 207 open entries to
their pillar docs — is untouched and is the one that changes the number.** Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-13 — the BLE rollup runs in a worker thread, so it cannot starve a request (Q-213
Stage 2).** The last piece of the outage. Stage 1 plus the watermark took a real ring sync from
15–30 min to 2 min and that was still not enough — a concurrent ingest 500'd after 27.6 s while a
two-minute rollup held the thread. `POST /api/oura-ble/samples` now dispatches through
`runRollupOffLoop` into a `worker_threads` realm with its own `pg` pool (`PG_POOL_MAX=2`, so a
replica running a rollup holds 12 connections rather than 20). Measured main-thread lag during a
rollup: **185 ms of a 262 ms in-process run → 4 ms of a 439 ms worker run**. It needs its own esbuild
bundle because the repository reaches `onnxruntime-node`, which webpack cannot bundle — and **a
missing bundle falls back to in-process**, so a broken worker degrades to the previous behaviour
rather than dropping a rollup (proven by deleting the bundle and watching the correctness test still
pass). **Production is the only place the claim settles**; watch CPU and `/api/version`. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-13 — the local custom-rules gate runs all 31 steps and prints the count (Q-206).**
`pnpm check:rules` parses `.github/workflows/ci.yml`, takes the job named *Custom Rules*, and runs
every one of its steps under the same shell CI uses, ending with `Ran N of N Custom Rules steps.` — a
number to quote instead of the word "pass". **N is read from the YAML, never hardcoded**, and that
earned itself the same day: it was 31 in the morning and 33 once Q-49 Phase A added two rules. `pnpm ci:local` now calls it. **The entry's
own premise was wrong in both directions and measuring it was the first step:** the job has **31**
run-steps, not 35; **20** invoke a `scripts/*.js` and all 20 `check-*.js` files on disk are wired
in, so the glob everyone blamed ran 65%, not 11%. The weak gate was `pnpm ci:local`, which ran
**3 of 31**. The fix is unchanged either way — the **11 inline grep steps** are the ones no glob can
reach, and they hold the `invalidateCache`, UTC-date-slicing, safe-area, nested-button and
LLM-`JSON.parse` rules. Both of those were mutation-probed: a planted violation of each FAILs the
named step and exits 1. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-13 — the production stalls are fixed, and the cause was not what it looked like.** Ten
PRs (#1295–#1304). The app was re-processing **35 days of raw ring data on every sync** — 986,959 rows,
effectively the whole table — to absorb the few minutes a sync actually carried. Each pass outlasted
the gap between syncs, so they ran back-to-back and held Node's single main thread for 15–30 minutes;
`/api/version`, which touches no database and is capped at 5 s, measured **122 seconds**. The DB
connection errors everyone was chasing were a *symptom*: `pg`'s connect timeout is a JS timer and
fires late on a blocked loop, so healthy connections were killed by a stopwatch running behind.
**Verified on a real ring sync: 15–30 min → 2 min, CPU 1.8 → 0.815, memory 2.19 GB → 0.553 GB.**
Two regressions were introduced and fixed inside the same session, both caught by watching production
rather than reading code. Stage 2 (the worker thread) remains, and now has measured justification — a
concurrent ingest still 500'd after 27.6 s while a 2-minute rollup held the thread, which narrowing
cannot fix. Journals:
[`…-oura-rollup-incremental-window`](history-2026-08-12.md) ·
[`…-rollup-watermark-survives-restart`](history-2026-08-12.md) ·
[`…-rollup-span-covers-watermark-and-batch`](history-2026-08-12.md).

**📌 2026-08-13 — session handoff: queue drain + four owner decisions.** A backlog drain that ran
out of implementer-takeable items, put five decisions to the owner, and built four of them —
**Q-202** (prescription follows your last real session), **Q-185** (a deload lightens every
exercise), **Q-189** (unreachable chat surface and read-aloud deleted), **Q-72 partial** (HRV/HR
sleep baselines now a 14-night median) — plus **Q-155**'s ownership coverage for the 13 tables with
no `user_id`. Two standing traps came out of it: **"custom rules pass" locally means a
fraction of the checks** (filed as **Q-206** — its "4 of 35" was measured wrong on both numbers and
corrected when it was built, see the entry above), and **a Q number in an unmerged PR is provisional** — one entry was
renumbered twice. **Nothing from that session is device-verified**; four checks are written up and
waiting. Full record, including the pickup prompt:
[`docs/handoff-2026-08-13-platform-queue-drain-owner-decisions.md`](../handoff-2026-08-13-platform-queue-drain-owner-decisions.md).

**🆕 2026-08-13 — the Sleep Score's HRV/HR baselines stop averaging away real progress (Q-72
partial, v1.304.0).** Measuring Q-72 first corrected its diagnosis twice. **It is three stuck
contributors, not four** — `latency` never reaches 100 on any night (0/48), it is merely compressed.
And **the curves were never the problem: the baseline was.** `hrv`/`hr` used a plain mean over
*every* prior night, while the owner's overnight HRV rose 24.8 → 62.7 ms and average HR fell
74.0 → 60.2 bpm. Against that all-time mean every recent night read 1.3–1.8× better than baseline,
past the curve's 1.1 ceiling, pinning **40/44** nights on `hrv` and 36/44 on `hr`. Now a **14-night
trailing median** (window chosen by measuring five options): `hrv` sd 5.2 → 12.9, pinning 40/44 →
25/44; `hr` sd 6.9 → 14.3. **What it does NOT do, and the owner shipped it knowing this:**
agreement with their own morning ratings did not move (r −0.220 → −0.226), so **Q-72 stays open** —
and the correlation target is itself unreliable, since 33 of 39 ratings are a "2" or a "3". The
old baseline broke **zero** tests when reverted, because every existing case used identical nights;
four drift-sensitive tests now cover it, all mutation-verified. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-12 — the unreachable chat surface is deleted, and read-aloud with it (Q-189,
v1.302.0).** `app/chat/`, `app/sheet/[id]/chat/`, `components/chat.tsx` and `app/api/ai-chat/`
(including `/tts`) are gone. Nothing linked to any of it — every entry point already went to
`/coach`, and the Coach route's own comment said the pair would be deleted once that repoint
happened. Owner decision: **drop text-to-speech rather than move it to Coach**, since it was
reachable only from a screen nobody could open. Three consequences worth knowing: **`GEMINI_API_KEY`
is now read by no code** and can be removed from Railway (`@google/genai` stays — `exercise-image-gen`
uses it, on the other key); **one of the two sign-out buttons went with it**, so More/Profile is now
the only one and the device checklist was corrected in the same PR; and `parseChartBlocks` plus the
already-dead `chart-error-boundary.tsx` were removed, while the chart schema Coach depends on stays.
The CLAUDE.md path checker caught a stale `components/chat.tsx` reference that would otherwise have
shipped — one of the 31 inline steps, not the four scripts (Q-206). Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-12 — a deload week lightens every exercise (Q-185, v1.301.0).** Every deload reduction
lived inside `if (aiDrivesLoad)` and keyed off a prescription entry, so an exercise the AI does not
name never reached one. Measured before the fix: two prescribed lifts at 50%/2 beside an accessory
untouched at 75%/3 — and a session whose prescription is **missing or expired** reduced *nothing at
all*. Owner decision 2026-08-12: lighten them too. **Measured end-to-end both ways** on an
ai_dynamic program in a confirmed deload week with no prescription: `origin/main` returned all nine
exercises at 75%/3 with `deloaded: false`; this build returns 50%/2, `deloaded: true`. Static
programs are deliberately excluded — they have `ProgramPhase` rows and `deloadAwareStylePhase` has
already swapped their style, so reducing again would compound. **A guard I wrote turned out to be
unreachable and mutation testing is what said so** (deleting it failed zero tests), and chasing that
surfaced a real pre-existing contradiction now filed as **Q-211**: the AI deload branch reduces a
*baseline* lift to 50% while `estimateOneRm`/`shouldCountTowardPr` both exempt baseline as a genuine
max effort — so the app prescribes half weight and records the result as a max test. ⚠️ Not
device-verified. Journal:
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**🆕 2026-08-12 — the prescription follows your last real session (Q-202, v1.300.0).** The owner
lowered their weights deliberately to work on form and the app kept prescribing from a lift months
old: `resolveWorkingBasis` took `max(lastLog, seed, allTimePr)`, and the all-time PR is permanent,
so **no number of lighter sessions could ever lower the prescribed weight**. Per the owner's
decision the resolver now takes the **last non-deload session outright** — there is no override
switch; the definition changed. The accepted trade-off, stated up front: one light session now
lowers the next prescription (a smoothed "best of the last 3" was offered and declined, and a test
is named for that so it isn't quietly reintroduced). **Two halves were needed** — changing only the
resolver would have left the bug intact, because `estimateOneRm` stores `estimated1rm: 0` for a
deload, so after one the last log carries no usable number and the basis falls straight back to the
PR. A new `getLastRealOneRmBatch` finds the last real log; `getLastExerciseLogsBatch` still returns
the genuinely most recent one, so the screen keeps showing what you actually lifted. **A sibling bug
was found while verifying and fixed here**: `target80` also reads 0 on a deload row, so after any
deload the target showed **0 kg** and the weight dial started every set at zero. Measured
end-to-end: 98 → 72 with the PR untouched at 98. ⚠️ Not device-verified — the dial's pre-filled
value is an on-device behaviour. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).
**🆕 2026-08-12 — a planned meal can be logged in one tap (v1.299.0, Q-187 first slice).** Until this
a plan told you what to eat and then played no part in the day. This is deliberately the half that
needs **none** of phase 2's machinery: the automatic prefill forces a "prefilled but unconfirmed"
state into existence so the energy-balance bar never reports food nobody ate, and none of that is
needed when the tap **is** the confirmation. Two decisions worth keeping — each ingredient is logged
at a 100 g serving with the weight in the quantity, so the library gains "Cooked quinoa" rather than
"Cooked quinoa (236 g)"; and which meals are already logged is **derived from the day's food, not
stored**, because inventing a per-day row to remember a button press is the start of exactly the
design phase 2 must do properly. Verified end-to-end: the plan card's protein bar moved 29.3% → 62.6%
on tap. ⚠️ Not device-verified — `logFoodEntries` takes the local-store branch on the APK and the web
POST branch here, so the branch that matters on the phone did not run.
Journal: [`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-12 — macro targets that say when they do not add up (v1.297.0, closes Q-191).** Four
independent fields with nothing keeping them in agreement: the seeded account holds 150P/180C/60F
beside a 1,750 kcal goal — **1,860 by Atwater**, a 110 kcal disagreement with no way to see it, and
the reason every meal plan read "over by 110" for reasons unrelated to the food. The editor now shows
the implied total and offers a one-tap carb refit; the read-path `reconcileDailyMacros` guard stays,
because a saved row is never silently rewritten. **The test found a second bug:** the reconciler was
flagging *its own helper's output* — `carbsFromRemainder` rounds to a whole gram (4 kcal) against a
±1 kcal tolerance, so the new one-tap fix would have produced a row the meal-plan review immediately
called drifted. `MACRO_RECONCILE_TOLERANCE_KCAL` is now named, documented and pinned.
Journal: [`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-12 — the plan card shows the day, not just the plan (v1.296.0, closes Q-200).** Its three
macro bars were drawn `w-full` inside the track — **always 100% full regardless of the number beside
them**, which reads as progress and was not. They now fill to `eaten / target`, over-target is marked
with a symbol rather than colour alone, and an unlogged day shows *empty* bars rather than claiming
0% of a day that has not started. Measured in-browser: 0% empty, then 20/19.6/10% after logging.
**Q-201 deliberately left open** — a plan's meal time is a "time to eat" prompt while the existing
reminders are a "you didn't log this" catch-up at a meal *type's* end hour, and the two are not 1:1;
that fork wants an owner decision, not a guess shipped to an unverifiable notification surface.
Journal: [`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-12 — a plan can add food to your meal, not just shrink it (v1.295.0, closes Q-210).**
Putting a saved meal into a slot only ever resized what was already in it. **The mechanism was worse
than the backlog entry claimed, and measuring it changed the fix:** not "6.3× exceeds the 2.5× clamp",
but that full cream milk is 31 kcal of fat against 18 of carbohydrate with a 22% protein share, so
`dominantMacro` files it under *fat* — the protein ice cream has **no carb source at all**, the carb
group is empty, and no factor of any size moves carbohydrate. Widening the clamp would not have
helped even slightly. `scaleWithTopUp()` now asks the model for ≤3 additions when a macro is short,
re-scales, and keeps the result **only if it improves the fit meaningfully** — measured, 40 g of
celery improves an ice cream's fit by 0.4%, so a bare better-or-not test would have put celery in it.
Verified end-to-end: the ice cream into a 644/50/57/24 slot came back **639/50/57/24 with frozen
banana added**. Scaling also moved server-side, because the edit sheet scaled on the client and would
have skipped the top-up on the exact path the complaint travelled. ⚠️ Not device-verified; plan
generation is now slower when a meal needs topping up.
Journal: [`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-12 — tell a meal what to change, and move it earlier or later (v1.294.0, closes
Q-208/Q-209).** An instruction box on a plan meal ("make it vegetarian", "swap the rice for potato")
rewrites that one meal instead of throwing it away — `generate/meal` gains `instruction` +
`currentMeal` and is reused deliberately so allergy handling cannot drift, with the "be different
from the plan" line **suppressed** when rewriting because it fights an instruction whose point is to
keep the meal. Reordering lives in the structure route because moving a meal is not a relabel:
`splitMacrosAcrossMeals` weights carbs toward the meals bracketing training, so a meal that moves
gets a different target — **verified live, a meal moved to slot 0 went from a 57 g carb target to
38 g.** Non-permutations rejected with 400. Up/down buttons, not drag. The measured vegetarian
rewrite also shows what is still missing: protein came back 31.8 g against a 45 g target, which is
Q-210. ⚠️ Not device-verified.
Journal: [`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-12 — one offline-first way to create a food, and a warning on food-database rows
(v1.293.0, closes Q-197/Q-199/Q-196).** The meal builder created a `food_item` three ways and none of
them reached the local store, queued an outbox mutation, or invalidated `nutrition-food-items-all` —
so a food you had just added was missing from the Food Library sheet, invisible to the local-first
search in the same file, and impossible to add at all offline. A comment even claimed the opposite.
All three now go through one `createFoodItem()`, which is `logFoodEntries`' shape extracted rather
than a fourth invention; the sanitiser runs client-side there so local and server hold the same
numbers for the same id. Also: a searched product is no longer stored as `source: 'barcode'`
(`'text'` was in the enum and had never been written), and a row whose macros disagree with its own
calories by >15% now says so — **measured, 4 of 20 live results**, including a yogurt stating 123 kcal
against 164 by Atwater. The two thresholds share one place and a test asserts warn-before-rewrite.
⚠️ Not device-verified, and note the shape of that: the branch this work is *about* is the local-store
one, which the sandbox cannot run.
Journal: [`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**🆕 2026-08-12 — sleep/HR/temperature clock conversion wired to the robust offset (Q-71,
v1.292.1).** Follow-up to the same-day anchor-drain-lag investigation: owner reviewed the real-data
evidence (a uniform, stable −3 minute shift across 9 real nights, tested against the actual shipped
function before any code was written) and approved wiring it in. `aggregateOuraRawSamples`'s
`toDate` (`lib/data/postgres/adapter.ts`) now resolves every ds via `resolveDsToMs` (Q-139's
p10-of-lag robust offset over the whole epoch, already proven on the steps path) instead of
`measuredAtMs` off a single newest anchor — the mechanism behind the same night reading three
different bedtimes across three rollup runs. Verified against the full local DB-backed rollup suite
(57 tests, including the anchor-drift regression, which stays valid by construction — with one
anchor the old and new math are identical) plus the full repo suite (3,186 passing) and clean
typecheck/lint. **Only fixes future rollups** — historical `sleep_sessions` rows are unchanged until
an admin Redecode runs, which needs the owner's own session (no bearer-token path exists for that
route). Full writeup:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-12 — a saved meal can be a batch (v1.292.0).** A recipe that fills two bowls was stored
as if the whole batch were one meal, so a meal plan put the entire tub in one slot.
`saved_meals.servings` (mig 182, **default 1**) plus one shared `oneServingItems()` that both the
log path and the plan conversion call — `totals` deliberately stays the whole recipe, because
dividing it in `listSavedMeals` would change what every existing caller means. Local SQLite **v25**
with all three parts (ALTER + CREATE body + `RECONCILE_COLUMNS`). Stated on purpose: raising the
count **changes what that meal's Log button does**, so the card and builder both say "per serving".
⚠️ Not device-verified — the v25 ALTER has never run on a phone holding v24. First of four slices in
[`plans/2026-08-12-meal-plan-portions-and-editing.md`](../superpowers/plans/2026-08-12-meal-plan-portions-and-editing.md).
Journal: [`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-12 — "Milk" returns milk, and quantities take servings again (v1.291.0).** Four owner
reports from the S25 against v1.290.0, **two of them corrections to it**. Open Food Facts matches
free text against *ingredient lists*, so "Milk" came back with cream cheese and cheddar — the
previous release claimed `sort_by` had fixed that, but sorting reorders a set it cannot change.
Fixed by filtering to Australian products and requiring the query to match the product's own name as
**whole words** ("milk" is inside "Milka", which is how a chocolate bar led the list). The database's
constant "not responding" was **our own doing**: HTTP 503 from that endpoint is rate limiting, and a
250 ms debounce chained behind the library fetch spent OFF's ~10/min budget on prefixes of the word
being typed — now a separate 700 ms effect, our limit cut to 12/min, and one retry. And v1.290.0's
grams-only quantity field broke "two scoops", so each ingredient has a srv/g switch defaulting to
servings. **The lesson worth keeping:** both regressions were measurable in the sandbox and simply
were not measured — one asserted a fix instead of reading the results, the other read a 503 as
someone else's flakiness. ⚠️ Not device-verified.
Journal: [`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-12 — building a saved meal can search a real food database (v1.290.0).** Ingredient
search could only see food items this user had already created, so the library could never grow past
what was in it. `GET /api/nutrition/food-search` queries Open Food Facts — the source the barcode
scanner already trusts, so no new dependency and no new provenance — and the picker always also
offers "work out its macros" via the existing `POST /api/nutrition/scan`, so a search is never a dead
end when OFF has nothing or does not answer. Ingredient quantity is grams now, not a `1×/2×/3×`
multiplier. **Two lessons, both from measuring rather than reading:** a fix to a shared component can
be *silently overridden by its call sites* — `pr-16` on `SheetHeader`'s outer element changed nothing
because eight sheets pass `px-*` and tailwind-merge lets the later class win, so the reservation had
to move to an inner wrapper — and then the size was wrong too, because the close button is positioned
from `SheetContent`'s edge while the padding is per-call-site. Also fixed a **pre-existing barcode
bug** found while verifying: `"1 glass (200 ml)"` matched the "g" of "glass" and returned a one-gram
serving, dividing every macro by a hundred. ⚠️ Not device-verified — see the Known Issues row.
Journal: [`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-12 — More/Profile's ring battery stops lying (Q-205, v1.290.2).** The Oura card on
More read `batteryLevel`/`batteryStale` from `/api/oura/token` — the **Cloud** value, frozen since
the 2026-07-07 direct-BLE re-key — so it rendered a permanent grey **"Not live"** badge and had done
for over a month. It now reads `/api/oura-ble/battery-latest`, the live BLE poll, on the same key
and TTL the Health card uses, falling back to the Cloud value only when BLE has nothing. **This is
the treatment the same card already gave the sync timestamp** (`bleFresh ? … : …`, twenty lines
above) and never gave the battery. Two things the change exposed are fixed with it: the
`oura-ble-battery-latest` key was in **no invalidation group** despite a BLE sync writing new polls
(now in `invalidateOuraSync()`, which fixes the Health card too), and the card's tab-show refresh
would have served the cached battery forever. ⚠️ Not device-verified, and the literal "Not live"
rendering can't be reproduced locally — see the Known Issues row. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-12 — the ring-battery chip leaves Home (Q-203, v1.290.1).** Fourth round on the same
owner report: Q-169 shipped "move it and simplify it" on 2026-08-10, and the identical *"move it or
remove it"* came back two days later on the build carrying that fix. `OuraBatteryChip` is removed
from the Home header and its component file deleted — Home was the only call site. **The backlog
entry's justification was wrong and checking it mattered:** it said More/Profile "already renders
ring battery status independently", but that surface reads the **frozen Oura Cloud** value and shows
a permanent grey **"Not live"** badge. The surface that actually preserves the live reading is the
**Health tab's Ring Status card**, which fetches the same `/api/oura-ble/battery-latest` endpoint on
the same cache key. Removal is safe — for a different reason than the entry gave. The dead
More/Profile badge is now filed as **Q-205**. ⚠️ Not device-verified — see the Known Issues row.
Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-12 — the ownership guards on tables with no `user_id` are covered (Q-155, test-only).**
Q-155's 246-predicate mutation sweep was structurally blind to **13 tables that have no `user_id`
column at all** — their ownership lives in a parent row-count check or a join, so rewriting
`eq(x.userId, userId)` never touched it. Two were covered in August; the remaining eleven now are,
via 13 cases over `saveProgressionStyle`, `updatePhaseSet`, `updateSavedMeal`, `saveProgram` and the
three `friendships` methods. **Every guard was already correct — nothing here is a fix** — and each
reject case was verified by breaking its own guard and observing exactly one failing test.
`friendships` is worth noting: scoped by `requester_id`/`addressee_id` and by neither name, so it is
invisible to **both** the sweep and `scripts/check-repository-user-scoping.js`. The pre-check/join
class is now closed for all 13 tables; what keeps Q-155 open is exact per-predicate attribution and
the fact that only the DB tests have ever been measured. **These tests do not run in CI** (no
`DATABASE_URL` there) — the evidence is local by construction. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-12 — sleep bed/wake-time drift traced to its exact source, and the fix already exists
(docs-only, unblocks Q-71).** Owner report ("displayed bedtime keeps changing") led to finding the
root cause at `insertOuraRawSamples` (`adapter.ts:4655`): `anchorUtc = new Date()` stamps server
batch-receive time, not true ring-capture time, so a night's resolved bed/wake time drifts (verified
three different values for one night across three rollup re-runs, 16–79 min apart) depending purely
on which clock anchor happens to be newest. The "obvious" fix — bracket interpolation — was tested
against real data first and made things *worse* (every recent night shifted 10–48 min later,
independently reproducing a finding this codebase already had on record). The actual fix already
shipped for a sibling bug: Q-139's `resolveDsToMs` (10th-percentile-of-lag robust offset per epoch,
2026-08-08) tests clean against the real data — a uniform, stable −3 minutes across all 9 recent
nights. Re-scoped and unblocked **Q-71** with this evidence; still needs an explicit owner call on
rewriting stored history vs. fix-forward-only before it ships. No code changed this session — every
finding here was tested against real production data via the read-only admin endpoint and the real
shipped functions, never assumed. Full writeup:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**🆕 2026-08-11 — direction B's two gates measured, and one of my own warnings was wrong (Q-204,
docs only).** The HR-derived load lane was held *gated, not queued* on two questions. **Gate 2
passed:** waking-hour HR coverage is **13.3 of 15 hours** (range 12–15 excluding a partial day), so
a load model would be fair. **That contradicts a worry I had put in the doc** — I argued the ring
power-gates its PPG when worn-idle and coverage might be too sparse; measured, on **2026-07-30 the
ring alone covered 12 of 15 waking hours with zero chest-strap samples.** Not strap-dependent, and
the gaps I predicted are not there. **Gate 1 failed:** `training_load_ots` — which the doc twice
called "most of it already" — is populated on **0 of 42 days**, the same empty-pipe shape as
`active_calories_est`. That claim had been verified from the *schema*, not the data. So B is
**viable but has no head start**, and is now queued as **Q-204** with the fairness question closed
and the effort estimate corrected.
[`docs/activity-goal-calibration.md` §11](../activity-goal-calibration.md).

**🆕 2026-08-11 — the volume target stops chasing the athlete (Q-190, v1.286.0).** The volume lane
scored against `typicalSessionVolumeKg × strengthFreqGoal`, and that median is **the user's own** —
train harder, the median rises, the target rises, the score stays put. The treadmill the 2026-07-22
rewrite removed from the daily-movement lane and left here. **The trap was that the formula had
three copies** — model, score-audit note, and the Volume progress bar's `max` — so changing only the
model would have shown a different target from the one being scored, with nothing failing. One
exported `volumeTargetKg(goals)` now serves all three. Anchor is an absolute
`DEFAULT_SESSION_VOLUME_GOAL_KG = 5200`, **measured for this change** (40 sessions over 8 weeks:
median 4,438, mean 5,032, p75 6,782): the median re-saturates a typical week at 100, p75 makes 100
unreachable, 5,200 gives weak 65 / typical 97 / strong 100. **Two things the types did not catch:**
`readiness-payload.ts` re-listed the goal fields by hand (now `DailyGoals & {…}`), and — worth
knowing generally — **`tsconfig` excludes `**/__tests__/**`, so a fixture missing the new required
field compiled fine and surfaced as `NaN` through the score.** Defining regression test: the same
week now scores identically for a beginner, the owner and an advanced lifter. ⚠️ **Fourth change to
this score today** — use a post-Q-188 baseline. 3635 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**🆕 2026-08-11 — move-hours counted a 24-hour day against a 15-hour goal (Q-188, v1.285.0).**
`computeMovedHours` counted any hour in **0–23**; `moveHoursGoal()` divides by waking hours. The two
measured different windows, so the ratio was structurally ≥1 and the contributor (weight **12**)
pinned at 100 **regardless of the goal**. Q-137 had recorded this as "goal 15 against 19–24 actual"
and proposed *raising the goal* — which would have moved the saturation without removing it, since
19–24 is not a score anyone can reach against a 15-hour denominator. **Same shape as Q-183's
`zoneMinutes` structural zero, inverted.** The fix was smaller than the finding: `wakeHour`/
`sleepHour` were **already on the input type and simply never read**. Now the count skips anything
outside `[wakeHour, sleepHour)` — the identical half-open window the goal uses, so the two agree by
construction for any pair, and both production callers were checked to take the same defaults. Four
tests, all mutation-verified, led by the invariant `movedHours ≤ moveHoursGoal`. **One existing test
was weakened by the change and repaired rather than left** — its 3am fixture would have returned 0
for the wrong reason. ⚠️ **Third change to this score today** (Q-183 +5, Q-137/A lower, this lower):
compare against a fresh baseline, not any figure quoted earlier today. 3632 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**🆕 2026-08-11 — one number, two frozen contributors (Q-137/A, v1.284.0).**
`DEFAULT_STRENGTH_FREQ_GOAL` 3 → 5, and that is the whole change. `strengthFreq` (weight **25**, the
largest) was **exactly 100 on all 91 measured days** — 4.9 sessions/wk against a goal of 3 is ratio
1.63 and the curve caps at 1.0. The volume lane is derived from the *same* number
(`volTarget = typicalSessionVolumeKg × strengthFreqGoal`), so at goal 3 its target was 14,100 —
below even a weak week — and clamped too. **45 of 100 weight was constant, from one constant.**
The regression test states the bug as a property using the owner's real figures: **at goal 3 a weak
week (16,843 kg / 3 sessions) and a strong week (25,159 / 5) scored identically on both lanes**; at
5 they separate and a strong week still reaches 100. Set **at** typical rather than above it,
deliberately — the ACWR taper already penalises over-reaching, so a goal of 6 would have one part of
the model rewarding what another punishes. ⚠️ **Expect the score to sit lower than before** — that is
the intended effect, and **Q-183 (+5 points, shipped earlier today) pushed the other way**, so any
before/after needs a post-Q-183 baseline. 3628 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**🆕 2026-08-11 — calories in vs out is one calibrated number (v1.280.0).** The owner asked why the
planned energy-balance work was never visible. It had **never rendered on any tab**: the card's
`case` was in the training renderer while its key is only in the Body groups. Beyond that, three
surfaces each computed their own TDEE and disagreed — the Health "Balance" tile applied an activity
multiplier *and* subtracted measured movement, double-counting it — and two DB columns held targets
200 kcal apart because the TDEE nudge wrote only one of them. All of it now flows through one
service (`lib/health/energy-balance-service.ts`), which the AI coach also calls so it cannot
contradict the widget. New: maintenance calibrated from the user's own logged intake against their
weight trend, gated so an unlogged day is a gap rather than a zero-calorie day, and the current
(partial) day excluded from the window. Meal Plan is planned but not built — backlog **Q-186/Q-187**.

**🆕 2026-08-10 — Coach stopped transcribing the database: 2,204 output tokens → 41 (v1.278.0).**
Owner: *"make the ai model be used as minimally as possible and have direct links to saved data."*
`renderChoiceList` now takes a **source** (`sessions` / `exercises` / `swap_candidates`) and the
widget reads the real rows from `/api/coach/options`; the model writes a source name and stops.
**Cumulative with the thinking fix: 2,204 → ~41 output tokens and ~8.6 s → ~1.2 s.** The swap flow
runs three turns with **no read tools at all**. Two things beyond speed: an invented id is now
*structurally impossible* for these lists (the model never writes one — that class shipped twice
here), and options are current when the widget renders rather than when the model spoke.
**Also fixes a wedged conversation reported from the device:** typing while a picker was open left
an unanswered tool call in the thread, and the provider refuses that — so every following turn
returned *"Something went wrong"* and asking again could not help. Permanently dead, not
transiently.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).


**Last updated:** 2026-08-10.

**🆕 2026-08-11 — the Activity Score's goals need calibrating, and the three filed options were all
downstream of a question none of them asked (Q-137, docs-only).** Re-measured against production
and every premise holds, sharper: `active_calories` last landed **2026-07-07** (the BLE re-key),
and strength frequency is **4.9/wk** against a goal of **3** — ratio 1.63, where the curve caps at
100 from 1.0, so the largest weight (25) is pinned *structurally*, not just observed. Stated as an
outcome rather than as contributors: the score's 30-day spread is **mean 74.3, sd 5.9, range
60–81**, while steps — its one live discriminating input — runs **sd 4,028** on a mean of 6,959.
The input swings ±58%; the output moves in a 21-point band. Asked to choose between the three
options, the owner said the goals should be **scientifically calibrated** first, so the output is a
design discussion:
[`docs/activity-goal-calibration.md`](../activity-goal-calibration.md) — including why
re-anchoring to the user's own baseline reverses a deliberate 2026-07-22 decision ("a lazy week
lowered the bar"), what Garmin/Whoop/Strava/Apple do instead (**every app that handles lifting well
measures HR-derived load, not threshold-minutes**), and the evidence base for any target. Two
findings split out: **Q-183** (`zoneMinutes` scores a lifter's structural zero as a failure at full
weight — goes first, no goal change fixes it) and **Q-184** (`active_calories_est` is plumbed
end-to-end and **0 of 42 days** populated — the device never computes it; needs an APK). ✅ **The
"missing score-days" worry was unfounded** — every day from 2026-07-28 onward has a score; all gaps
precede it, which is its start date. ✅ **DECIDED same day: direction C, and goals set ABOVE
typical.** The second half is the load-bearing one — a strength goal of 5 against a measured 4.9/wk
is ratio 0.98, i.e. the saturation re-created with better-looking numbers. **Expect the score to
move and to centre lower than 74** (intended: 100 should be reachable, not routine), while **Q-183 pushed the other way and has already shipped** (#1249, v1.279.2, +5 points
on a measured A/B), so measure any before/after against a post-Q-183 window, not against 74.3. **B is gated, not queued:** measure non-workout
HR coverage and whether `training_load_ots` is actually populated — the column was verified from the
schema, not the data. **Target values set the same day (§9):** steps **8,000** unchanged, strength
frequency **5** (at the optimum — the ACWR taper already penalises over-reaching, so a goal of 6
would have one part of the model rewarding what another punishes), weekly volume **28,000**.
**Re-verifying the baselines paid for itself twice:** the filed weekly volume of 29,661 turned out
to be near the *maximum*, not the mean (measured 8-week mean **25,159**) — and **move hours is not a
goal problem at all.** `moveHoursGoal()` is `sleepHour − wakeHour` (waking hours) while the
numerator counts any hour 0–23 with movement, so the ratio is structurally ≥1 and the contributor
pins at 100 whatever the goal. Same shape as Q-183, inverted. Filed as **Q-188**; move hours must
not be raised until it is fixed. **Corrected 2026-08-11 (§10): the approved weekly volume of 28,000
is withdrawn** — there is no stored volume goal. `volTarget = typicalSessionVolumeKg ×
strengthFreqGoal`, and that median is the user's own, so **the volume lane is self-referential** —
the treadmill the 2026-07-22 rewrite removed from the daily-movement lane and left here. Filed as
**Q-190** (decided: absolute per-session tonnage). **A therefore shrinks to one line** —
`DEFAULT_STRENGTH_FREQ_GOAL` 3 → 5 — which fixes *both* strength lanes because volTarget scales off
it. **Q-188 decided:** restrict the numerator to waking hours, not divide by 24. Dependabot checked
with the owner: **below threshold**, does not jump the queue.

**🆕 2026-08-10 — the ownership class the mutation sweep could not see (Q-155, partial, no version
bump).** Q-155's 246-predicate sweep named its own blind spot and left it: ownership enforced by a
**join or pre-check** rather than a `user_id` predicate. Counted from the schema, that blind spot is
**13 tables with no `user_id` column at all** — `session_exercises`, `exercise_logs`, `set_logs`,
`style_sets`, `program_sessions`, `saved_meal_items` among them — so rewriting `eq(x.userId, userId)`
was structurally incapable of testing any of them. **No hole was found**, and two that looked like
holes are not: `removeSessionExercise` deletes by bare id but has its join pre-check directly above
(a grep for the DELETE misses it), and `renameExercise`'s cross-user UPDATEs key on
`exercise_library.name`, which is globally UNIQUE — shared-catalogue maintenance, not a leak. Two
guards are now held in place by reject/permit pairs, each verified by mutation.
`ensureWorkoutSession` is the one that matters most: a caller that adopted another user's session id
goes on to write `exercise_logs` and `set_logs` into it, and **neither table has a `user_id` to stop
it**. ⚠️ **2 of 13 tables — the class is sampled, not closed**, and Q-155 stays open. 3461 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-10 — the server and the device disagreed about deleted mood logs (Q-178, no version
bump).** `mood_logs` carries `deleted_at` on the server *and* locally, and the local store filters
it — the server's user-facing reads did not, so the device would hide a deleted mood log and the
server would hand it back. Latent (nothing writes that column yet), fixed on the owner's call so
whoever adds mood-log deletion doesn't land on a server that already returns deleted rows.
**The entry said three reads; two was correct.** The third is inside `getSyncDelta` and is the
**tombstone channel** — a delta that hid deleted rows could never tell a device a row went away, so
the delete would never propagate. `food_logs`, the domain with working tombstones, is unfiltered
there for exactly that reason. Applying the entry literally would have introduced that bug, so the
sync read keeps a comment and a test holds the two apart. **Both directions mutation-tested:**
removing the filter fails the user-facing test, *and* adding it to the sync read fails the tombstone
test. Verified live: `GET /api/mood` → **null** after a hand-stamped `deleted_at`, while
`/api/sync/pull` still carries the row with `deletedAt` set. 3457 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-09/10 — a review-only session mutation-tested the data layer's invariants (10 PRs, almost
no application code).** Handoff:
[`docs/handoff-2026-08-09-platform-mutation-testing-invariants.md`](../handoff-2026-08-09-platform-mutation-testing-invariants.md).
Method: break an invariant on purpose, count what notices. **Ownership scoping** — 246 predicates
neutralised left **286 of 317 tests passing**; burned down to no slice and no quartile at zero.
**Soft-delete filtering** — 113 filters neutralised left **371 of 372 passing**, every slice but one
at zero. Both are correct today; nothing held them in place. Shipped four CI checks (numeric bounds,
sparkline primitive, local-column upgrade path, WCAG contrast — the last after three failed browser
attempts), fixed **Q-174**, and filed **Q-178**, **Q-179** (a live user-facing bug) and **Q-181**.
Two of the new checks have already been burned to empty by other sessions. **Carry-forward: seven
assertions the session wrote could not fail**, each caught only by running the test under mutation as
well as clean; and three scanners reported wrong counts, one of them zero. Nothing was verified on
device.

**🆕 2026-08-10 — the meal type you could never delete (Q-179, v1.278.0, migrations 175 + 176).**
Log food against a meal type, delete that log, then try to delete the meal type: *"has food log
entries"* — citing an entry you can no longer see, permanently, with no way out. The in-use probe
counted soft-deleted logs. **Adding the `deleted_at` filter is not the fix and is a worse bug:**
`food_logs.meal_type_id` is ON DELETE RESTRICT, so the hard delete then fails on the foreign key and
the clean 409 becomes a **500**. Both broken variants were put back and run — the original throws
`MEAL_TYPE_HAS_LOGS`, the "fixed" one throws the FK violation — because the one-directional version
of the test passed. The lifecycle was the problem, so it went to the owner, who chose: **meal types
soft-delete too**, like every other user-owned row here. The RESTRICT is never tested and the
soft-deleted logs keep pointing at a row that still exists, so their sync tombstones survive. **The
live-log guard is unchanged.** Two deliberate non-changes: `seedDefaultMealTypes` still counts
deleted rows (it asks *has this user ever been seeded*), and **no sync tombstone was needed** — the
local `meal_types` table is a read-only mirror fully replaced from a GET, not a `getSyncDelta`
domain, which is what kept this small. The `activity_types` twin is admin-only and left as filed.
Verified end-to-end against `pnpm dev`: 409 → delete the log → **200** → gone from the list, with
the row still present and `deleted_at` set. 3455 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-10 — DB test isolation: measured first, and the measurement changed the work (Q-177, no
version bump).** The brief was a schema per vitest worker. The baseline said the shared database was
not failing anything — 387 tests, **0 failures in 6 runs** — so the work became *where does shared
state actually leak*. Two answers. **(1) Four `TEST_USER_ID`s were used by two files each**, across
nine DB-touching files; every one of them deletes its own fixture in `beforeAll`, and the `…c0de`
pair both run `DELETE FROM users WHERE id = $1` — with **55 of 58 FKs onto `users.id` cascading**
(proven against the live schema, not read off `schema.ts`), so either file's setup can wipe the
other's entire fixture across ~55 tables. Unique ids + `scripts/check-test-user-ids.js`; mocked
tests exempt, which is what keeps it from being noise. **(2) The one file that was actually failing
had nothing to do with ids.** `implausible-cadence.test.ts` failed **5/10** next to its id-twins —
and **2/10 alone**, which is the control that mattered. Two unrelated defects: a **4.2 s module
import billed to a 5 s test** (first test 4162 ms, other four 1–31 ms), and a rate-limit bucket that
**persists in the `rate_limits` table** across runs. The second was *hidden by* the first — fixing
the import made the file fast enough to trip the limiter, so solo failures went 2/10 → 5/10 before
going to **0/12**. It also claimed to need no database while one test reaches the repo, so it threw
instead of skipping without `DATABASE_URL`. **The per-worker isolation was deliberately not built** —
all three instabilities found so far have specific causes that isolation would have hidden rather
than fixed; filed as **Q-181** with the trigger that should start it. 3453 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-10 — API responses stop asking to be cached, and a standing rule is reversed (Q-166, no
version bump).** Owner decision, because it **contradicts a CLAUDE.md rule**: the SWR-header rule
that stood since session 177 is replaced by **`Cache-Control: private, no-store` on every `app/api`
response**. The header sounded like free performance; what it did was put a second cache underneath
the app's own — the only one `invalidateCache()` cannot reach — and it had already caused a live
stale-delete bug in production. With `cachedFetch` and the service worker both bypassing since
v1.276.3, it also governs almost nothing on the device. **76 files / 85 header sites** converted,
plus **13 data routes that had no header at all** now send it explicitly. Two things were measured
before touching anything, and the second changed the shape of the work: the header does reach the
client, and **a headerless Next route handler emits no `Cache-Control` whatsoever** — in dev *and*
production — so those 13 were relying on browser heuristics, not on an implicit no-store.
`lib/ai/stream.ts` covers both AI streaming routes at once (a cached *stream* would freeze a
mid-stream error marker in). `scripts/check-api-no-store.js` keeps the old convention from growing
back, mutation-tested by putting the header back; one exemption, `/api/version`, with its reason in
the script. **Both bypass halves stay** — they fail independently, and the comments now say so.
Verified against the running server: 21 routes, all `200` + `private, no-store`; a
POST/DELETE round-trip on `phase-sets` reflects immediately. 3458 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-10 — the rest of the dead-code sweep, and the cascade it exposed (Q-136, docs + deletions,
no version bump).** The four decisions Q-136 had left for the owner came back as *delete three, keep
the shims*. Gone, each re-verified unreferenced first: `app/health/timeline` (151 lines, **never had
an inbound link — `git log -S` shows no commit ever added one**), `app/api/sync/oura-timeseries` (the
client driver was never written), `app/api/oura/webhooks` (admin CRUD, no UI). Kept: the
`/sheet/[id]/*` shims, which look like dead redirects and are the reverse — the only inbound path to
`/chat`, whose `components/chat.tsx` is the sole caller of `/api/ai-chat/tts`. The near-miss worth
naming is that `app/api/oura/webhook` (**singular**) is the live receiver sitting one character from
the plural admin route that was deleted; checked explicitly rather than pattern-matched, and
confirmed after — it still answers **400** to an unsigned POST. Deleting the timeseries route removed
the only caller of `repo.getOuraTimeseriesDelta`, leaving its keyset-cursor implementation, adapter
delegate and **142 lines of passing DB tests** orphaned. That cascade was **not** taken unilaterally —
the owner answered a question about *routes* — so it is filed as **Q-180** with the question that
decides it. 3451 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-10 — signing out left the previous account's data on the device (Q-172, v1.277.3).**
Two of three sign-out buttons cleared nothing. Reading the one that "worked" before copying it found
the bigger half: **`clearLocalStoreData()` was a hand-written list that had drifted to 27 of the
schema's 37 tables**, so `oura_heartrate`, the sleep/readiness rollups, `prescribed_runs`,
`meal_types` and `sync_outbox` survived every sign-out — the same drift `RECONCILE_TABLES` was once
missing 17 tables to. It now reads `sqlite_master` and clears everything outside a two-entry
keep-set, so a new table is wiped by default. `lib/sign-out.ts` is the only way to sign out, and a
CI check fails on either way of bypassing it (importing the raw action, or a `<form action={…}>`,
which cannot run a client-side clear at all). **The clear did not hold on first measurement** — 4 of
17 cache keys came back, because in-flight `cachedFetch` calls resolve after it; a write latch plus
a sweep when the sign-in screen mounts took it to **24 keys before, 0 after**. Sign-out still works
(redirects, and `/health` bounces). ⚠️ **The local-store half was never actually run** —
`clearLocalStoreData()` is a no-op on web, so the seven-table fix is unverified off-device.
3456 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-10 — two completed backlog entries had come back from the dead (docs only).** A queue
read on fresh `main` found **Q-173** restored in full and a bare **Q-174** heading with no body —
both shipped hours earlier (#1223 and #1219). Traced rather than guessed: **#1220** was branched
before those removals landed, and its text merge put them back. No PR did anything wrong on its own.
Both cleared after confirming the code: `earlyDeload` is on `ReadinessScoreResponse`,
`listVolumeTargets` takes a `userId`. **A heading with no body under it is the tell**, and the
backlog header now says so — a resurrected entry costs a whole session before anyone notices the
work is already done.

**2026-08-10 — the same rule, two opposite fixes (Q-176, v1.277.2).** The two `tap-dense`
controls Q-160's audit left behind are fixed differently, and the difference *is* the rule. The
avatar's camera badge is isolated — the thing behind it is a plain div — so it takes an invisible
**44×44** box (`.tap-target-44`); a live clash check over every control on the page found **zero**
intersections. The Deload pill sits **8px below a large stats button** as a later DOM sibling, where
an invisible box would win the overlap and swallow that button's taps — the Q-160 failure in reverse
— so its **real ink** grows instead, **21px → 25px**, clearing the 24px minimum. `tap-dense` now has
five different correct remedies across ten users, and what decides each is the clearance to the
nearest interactive neighbour. **My own entry's number was wrong**: it said the pill was "about
16 px" from reading CSS; measured, it was 21. A test pins that the pill must *not* get a
`tap-target-*` class, so a later tidy-up cannot reintroduce the overlap. 3444 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-10 — the flaky cable test was another migration rewriting its fixture (Q-171 fixed).**
`cable-exercise-merge-migration.test.ts` failed ~1 run in 3 under the full suite and passed alone.
The entry suspected an unscoped `DELETE`; it is neither a `DELETE` nor a defect in any test. **A data
migration is table-wide by nature**, vitest runs files in parallel workers, and they share one
`trainingai_dev`. Reproduced directly: seed the Cable test's fixture, run migration 163 as a
concurrent worker would, and that user's PR goes **99 → 20** — 163 step 3 is an unrestricted
`UPDATE personal_records`, and its step 1 `INSERT INTO exercise_estimates` has **no name filter at
all**. Fixed with a Postgres advisory lock held for the whole test across the six
migration-executing files — not `retry`, which the entry rules out. The lock is shown *holding* (a
second acquirer blocks, then completes the instant the first releases), and the suite ran clean
**eight times**, against eight clean baseline runs on unmodified `main`. **The first version of the
fix destabilized the suite** — a blocking `pg_advisory_lock` parks the waiter's pooled connection, which tipped an unrelated 3.3 s test over the 5 s timeout in 2 of 5 runs; polling `pg_try_advisory_lock` and releasing between attempts fixed it. The separate **`deadlock detected`** in `planned-pct-bodyweight-migration.test.ts` is
covered by the same lock. ⚠️ The suite-wide half (every DB test shares one database;
two files still unlocked) is filed as **Q-177**. 3437 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-09 — Coach is ~3× faster, and the chip moved (Q-169 + Q-170, v1.277.1).** The chip is
now an icon in Home's right-hand icon row rather than a percentage pill on the date line. **Q-170 is
the one worth reading:** two plausible fixes were built first and **both made it worse** (inlining
the program into the prompt: ~1.1 s *slower*; speaking before every tool call: widget pushed out to
~12 s). The token log then answered it in one query — a picker turn emitted **2,204 output tokens to
render a ~400-token widget**, the rest reasoning nobody sees. One line
(`thinkingLevel: 'minimal'`) took it to **554 tokens and 3.5 s**; five-run wall clock **2.2–3.4 s**
against a baseline median of 8.2 s, with quality checked on the three-turn swap,
create-an-exercise, and a six-tool analysis. **Measure output tokens before optimising an LLM
route** — wall clock cannot tell reasoning from generation.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**🆕 2026-08-09 — every icon-only control now has an accessible name (Q-161 + Q-162, v1.276.2).**

**🆕 2026-08-09 — a cache `invalidateCache()` could not reach (v1.276.3).** Q-166 asked for SWR

**🆕 2026-08-09 — 48px hit areas would have made the carousel dots *harder* to hit (Q-160, v1.276.4).**

**🆕 2026-08-09 — half the "inline sparklines" were time-axis charts (Q-154, docs + classification).**

**Current version:** v1.277.0 · Branch: `main` · Railway auto-deploys on push to `main`.

**Last updated:** 2026-08-09.

**🆕 2026-08-09 — a method that takes `userId` and never uses it now fails CI (Q-155, partial).**
Q-155's own measurement: stripping the `user_id` scope from `getBodyMetricsBaseline` left the whole
suite green. Three passes of hand-written ownership tests followed (36, mutation-verified), but exact
per-predicate attribution needs ~246 runs, so the suite can only *bound* it. This closes the other
half — the entry's stated goal, *"fails loudly when a new unscoped method appears"*:
`check-repository-user-scoping.js` fails any adapter/slice method taking `userId: string` whose body
never mentions it. **368 take it, all 368 use it**, so it passes clean today and independently
confirms the 2026-08-07 read-through; the value is what it stops tomorrow. Verified by re-running
Q-155's exact mutation. **It catches an omitted scope, not a wrong one** — that limit is in the
script's own header, and Q-155 stays open. Two earlier versions of the detector were wrong (29 false
positives from a multi-line return type, then 73 from an over-tight rule), both caught by checking a
known-good method first. 3438 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-09 — the "Fatigue detected" card now says why (Q-173, v1.277.0).** Owner: *"today it
recommended emergency deload but wouldn't tell me why."* The card fired on `score < 45 && acwr > 1.2`
and showed fixed text — neither number even reached the client. It now carries a
`DeloadExplanation`-style collapsible: *"Readiness 38 — under 45…"*, *"Training load 1.47 — above
1.20 — this week against your four-week average"*, plus what each button does. **The thresholds
travel in the payload**, so the card can never state a bound the server stopped applying; a test
asserts it holds neither literal. Both bounds are now named constants, and one pins a subtlety:
`EARLY_DELOAD_ACWR_MIN` is **1.2** while `ACWR_THRESHOLDS.optimalMax` is **1.3** — the card fires
inside the optimal band because it is paired with a low score, so "unifying" them would change who
sees it. ⚠️ The render was verified by patching the response in-page (the seeded DB has `acwr: null`);
**the real trigger path is unproven end-to-end**, and nothing is device-verified. 3434 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-09 — half the "inline sparklines" were time-axis charts (Q-154, docs + classification).**
Q-154 said six files hand-roll a `<polyline>` instead of using the primitive; convert them. Reading
them first: **three are not sparklines.** `components/ui/sparkline.tsx` projects x by **index**,
while `day-detail/day-sections.tsx` (`minute / 1440`), `activity/exercise-review-sheet.tsx`
(`elapsed / duration`) and `body-battery-card.tsx` (`(t − t0) / span`) all draw a **time** axis —
converting them would have moved every unevenly-spaced point. `day-sections.tsx` **already said so
in a comment**; the entry read past it. They are now `EXEMPT`, alongside `live-hr-chart.tsx` which
was already exempt for the same reason. The three that really are sparklines are blocked on the
primitive, not on effort — no value label, hardcoded stroke width, and a **±0.5 value padding that
halves the amplitude of a 0.5 kg weight spread**, which changes what the chart says. The other
primitive that has those features (`sparkline-chart.tsx`) is chart.js and must not enter the hot
workout screen. Also renamed `health-metric-sheet.tsx`'s **local component also called
`Sparkline`**, which made a violating file look like a compliant caller to `grep`. **No conversions
done** — Q-154 stays open with the exact prop list. 3429 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-09 — 48px hit areas would have made the carousel dots *harder* to hit (Q-160, v1.276.4).**
The entry prescribed padding the 7×7 px dots to a 48px hit area. Measured first: the row runs on a
**15 px pitch**, so 48px boxes overlap by 33px each side and the sibling painted last takes the tap —
the left-hand dots would have got less reliable, not more. Shipped **24×44 boxes on a 24 px pitch**
instead: WCAG 2.5.8 AA's minimum and the widest that stays disjoint, with the ink unchanged. The
entry named two screens; there are **four** dot rows, three byte-identical — now one
`components/ui/carousel-dots.tsx`. Proof it works: clicking 10 px left of dot 1 (outside its ink,
inside where a 48px neighbour would have reached) selects **index 0**. The `tap-dense` audit the
entry asked for is done — 4 of 6 users are correct, 2 filed as **Q-176**. ⚠️ Tap targets are the one
thing a desktop browser cannot vouch for; **not device-verified**. 3426 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-09 — a cache `invalidateCache()` could not reach (v1.276.3).** Q-166 asked for SWR
headers on 12 more GET routes; measuring the header first stopped the sweep and found a live bug
instead. `private, max-age=60` puts the **browser's HTTP cache underneath the app's own**, and it is
the only cache `invalidateCache()` cannot clear. A write to the *same* URL as the read self-heals; a
write to a **different** URL does not — `DELETE /api/supplements/<id>` then `GET /api/supplements`
kept returning the deleted row, on a route that **already ships the header on `main`**. The service
worker was meant to prevent this: its `/api/` branch says *"never cache other API calls — always go
to network"*, but a bare `fetch()` inside a service worker still consults the HTTP cache, so that
comment described an intent the code did not implement. Both now send `cache: 'no-store'`. **Q-166
is on hold, rewritten with the measurement** — with the service worker bypassing, the header governs
almost nothing on the canonical runtime, and the option the evidence favours contradicts a standing
CLAUDE.md rule. ⚠️ **Service-worker change, NOT device-verified.** 3422 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).
**Q-166 was decided 2026-08-10** — the owner took the option the evidence favoured; see the entry at
the top of this section.

**2026-08-09 — every icon-only control now has an accessible name (Q-161 + Q-162, v1.276.2).**
Back arrows, the send button, the profile-photo picker and a dozen more announced as just "button".
**The review's list of six was checked rather than applied, and two were false positives** — the chat
Switch is named by its `<label for>`, the dumbbell by its `title`. Measuring computed names in a real
browser across seven pages found the genuine ones instead, plus one the review never saw: the Coach
composer. `scripts/check-icon-button-names.js` is the durable half — deliberately narrow (only a lone
self-closing icon inside a button), because a check that cries wolf gets exempted away. It found
**nine more** on screens the browser pass never reached, all fixed, so it ships with **no grandfather
list**. Verified both ways.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-09 — an HR chart that had never rendered, found by triaging Q-165 (v1.276.1).** Q-165
counted 62 bare-`fetch` client GETs and named ~24 as "genuine render-path reads", flagging that the
list came from route names rather than from reading the call sites. Reading them: **three** were
genuine. The rest were sanctioned offline-first web fallbacks, non-GET mutations, deliberate
freshness re-reads with written reasons, or streaming responses already hand-seeded — an 8×
over-count, plus one the entry missed (`coach/threads`). Converting the real ones surfaced the
finding that matters: `/api/oura/hr-window` gated times on `/^\d{2}:\d{2}$/`, while
`activity_logs.start_time` is a Postgres `time` and serialises as `HH:MM:SS` — so **every** call the
activity detail sheet has ever made was rejected before the handler, and its HR chart, zone
breakdown and HR-coloured route line have never rendered for any activity. Fixed, with a route test
proven to fail against the old regex. Q-165 closed; **Q-172** filed (two sign-out buttons in
`components/chat.tsx` clear neither cache nor local store). 3419 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-09 — Coach can add an exercise the app has never heard of (v1.276.0).** Owner ask, after
the repaired swap flow worked on device: *"I want to add in Jefferson curls to swap with bent over
row"*. The create rides in the **same patch** as the swap, so it is one confirmation showing both
halves — including **what the new exercise will be recorded as training**, because those muscles
drive deload, recovery and ACWR and a model authored them. **Admin-gated, matching
`POST /api/exercises` exactly** — widening that to all users is an owner decision, not a side effect.
A plain swap to an unknown name still refuses, so a typo creates nothing. **Found a bug in what
shipped this morning:** undo restored the exercise *name* but not its catalogue **link**, leaving the
row displaying the old name while pointing at the replacement. Fixed, with a test that asserts the
join rather than the string. 3397 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-09 — light-theme small text now meets AA (Q-167, v1.275.3).** `--muted-foreground` was
**4.34:1** on `--muted`, under the 4.5:1 bar, across nine full-opacity chips and pill badges at
10–12 px. `oklch(0.556)` → `oklch(0.546)` gives **4.52:1** there and 4.94:1 on white. One line,
because `scripts/check-contrast.js` had already done the measuring — and it closed its own loop by
failing until the now-passing pair was removed from `GRANDFATHERED`. **20 pairs, 0 grandfathered.**
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**🆕 2026-08-09 — the first on-device AI Coach session found three things (v1.275.0).** The owner
asked Coach to change an exercise, picked one, and **nothing happened** — it asked in prose with no
widget. Reproduced immediately, and the cause was not the model: **nothing exposed the exercise
catalogue**, so a list of replacements was not something it could draw. `findSwapCandidates` fixes
that (same main muscles, injury-aware, reusing `injurySafeAlternatives` rather than a second
matcher); the full swap now runs pick → replacements → confirm. Coach also printed its own tool
names at the end of an answer — forbidden in the prompt *and* stripped on render, because
"instruct the model not to" already failed once here. Latency was **measured, not fixed**: 7–11 s to
the first widget, two of eight runs at 49 s and 121 s, and grounding is not the cause — filed as
**Q-170**. Also ✅ **Q-158**. 3387 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**🆕 2026-08-09 — AI Coach can start your deload week (Q-168 partly, v1.274.0).** A sixth write
domain, `early_deload`: say you are beaten up and Coach proposes starting the deload now, or
cancelling one already running. **Not** the handoff the follow-up entry proposed — a link to the
home card would be a dead end, since that card only renders when fatigue has *already* been
detected. Tier 2, undoable, and the model does not choose the date (the server stamps today in the
user's timezone). The preview states the cost that nobody expects: flagged sessions are excluded
from every cycle count, so anything logged today stops advancing the block. Also fixes a **Q number
that landed on `main` twice** — phase 3b and #1194 both filed as Q-166; the Coach follow-ups are now
**Q-168**. 3351 tests green.
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**2026-08-09 — AI Coach is complete (Q-157 phase 3b, v1.273.0).** Five write domains, eight
widgets, three confirmation tiers, history and undo. This last part adds **`program_phase`** — the
only tier-3 domain, and the only one whose effects *take something away*: cycles completed are
derived from logged sessions ÷ cycle length, so changing it can move you backwards past work you
have already done. It gets its **own pushed screen** with **hold-to-confirm**, and the consequence
is computed exactly ("Moves you back from cycle 4 to cycle 2 — you lose 2 cycles"). Verified live: a
300 ms tap writes nothing, a 1600 ms hold writes. Also the **Handoff** and **NumberDial** widgets and
the chart-pairing rule. **A Phase 2 claim is corrected here:** `/api/ai-chat` was recorded as
unreferenced and deletable — it is not, `app/chat/page.tsx` uses it, and the earlier check looked for
overlay imports rather than route callers. Caught because the deletion was verified rather than
assumed. 3345 tests green. Details in
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).
⚠️ **Still not device-verified** — two navless full-screen routes with bottom-anchored controls now;
the Known-Issues row and the checklist cover both. Follow-ups (cardio goals, deload handoff) are
**Q-168**.

**🆕 2026-08-09 — AI Coach can change your goals and log an injury (Q-157 phase 3a, v1.272.0).**
Coach could change one thing: an exercise in a session. It now writes four domains — session
exercises, **macro targets**, **steps/calorie/water goals**, and **injuries** — through the same
confirmation, per-row toggles, staleness refusal and undo. Every domain is modelled as a **scalar
field change even when it creates** (`Area: — → left shoulder`), which is why the confirmation UI
was written once rather than per domain; a new domain is now a case in a switch. Goal changes carry
the **localStorage write-through** Home and Profile read from, or the new value would not show until
a reload. A cross-domain guard stops a model aiming a calorie field at an exercise row.
**Coach logs an injury and stops** — the deload weighting, session-swap recommendation and
per-exercise substitution all already exist downstream of the record, so the mockup's "flag N
exercises" toggle was a second implementation and is deliberately not built. **Found while
verifying:** the affected-exercise count read zero for every side-qualified injury (the program
stores `shoulders`, a person says `left shoulder`), which looked identical to "nothing trains this";
fixed and tested. 421 files / 3329 tests green. Details in
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).
**Phase 3b** is the tier-3 pushed confirm (phase/deload), the NumberDial and Handoff widgets, cardio
goals and the chart-pairing rule.

**🆕 2026-08-09 — AI Coach is live: the assistant now shows you things to tap, and can change your
program (Q-157 phase 2 of 3, v1.271.0).** Phase 1 built the protocol behind `/api/coach` with no way
in; this makes it reachable. `/coach` is a full screen on `useChat`, and **a resolved widget
collapses into a normal message bubble** — tap "Pull" and it reads like you said it, with an undo
glyph to re-open. Verified end to end against the dev server: the session list carries real UUIDs, a
specific ask skips the ladder straight to a proposal, Apply writes and the DB confirms it, undo
restores. History lists applied changes (free — the rows already existed) plus 30-day conversations.
Coach alone moved to **`gemini-3.6-flash` with search grounding**; every other AI route stays on
flash-lite. All **three** live entry points repointed (Stats' had already been deleted in Q-136 — the
plan said four) and the old overlay deleted. **Two bugs found by looking at the screen rather than by
testing:** every `<Switch>` in the app has been rendering as a black circle, because the global 48px
tap-target floor beats Radix's `h-5 w-9` — fixed in the shared primitive, so the goal-recommendation
sheet is fixed too; and history read "0 messages" for every thread from a Drizzle correlated subquery
that silently returned 0. ⚠️ **Not device-verified** — a navless full-screen route with a
bottom-anchored composer is the exact shape that has regressed 11+ times; see the new AI Coach
section in [`docs/device-smoke-checklist.md`](../device-smoke-checklist.md). 420 files / 3316 tests
green; details in
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**🆕 2026-08-09 — Home's "Today's Timeline" sleep card had the same stale-refetch gap Q-91 fixed
elsewhere (v1.270.32).** Owner reported last night's bed/wake time looked ~30 min off on first
open, correct after a restart — the classic stale-cache-not-refetched signature, not a clock bug
(the BLE clock-anchor extrapolation skew was investigated and ruled out: the owner's recalled times
were actually *closer* to the stored value than to an alternative resolution method tried during
the investigation). Root cause: Q-91 (2026-08-06) added a `ta:oura-ble-synced` refetch listener to
three readers of the `'sleep-sessions'` cache key, but `components/home-day-timeline.tsx` — almost
certainly the first screen seen — reads a different key (`'home-day-timeline'`) that Q-91's trace
never covered. The cache entry was already being invalidated correctly on sync; only the
already-mounted screen's refetch was missing. Fixed with the same listener pattern, mirrored
exactly. Full writeup: [`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).
**Not verified**: the live client-side refetch in a browser (no Playwright tooling in this
session) or on-device.

**🆕 2026-08-08 — AI Coach Phase 1: the assistant can now render UI in the conversation and write to
your program (Q-157 phase 1 of 3, no version bump — nothing user-facing yet).** The chat had
fourteen read-only tools and zero write paths. Phase 1 builds the spine behind `/api/coach`, with
**no entry point wired up**: widgets are the input schemas of **client-side tools** (a tool with no
`execute` makes the SDK validate the model's args, retry on mismatch, and suspend the turn until the
user answers), and every write goes through `/api/coach/apply`, which re-validates against current
state and 409s on drift. **The model is never in the write path** — forced by a real constraint, not
taste: `ai` v6's `needsApproval` flow looks like an exact fit but `ToolApprovalResponse` is binary,
and per-row toggles cannot ride on it. Consequences have no field in the schema, so the model cannot
author a claim about your training; they are measured by `/api/coach/preview`. Migrations 170–171.
**Three defects the live run caught that review would not have:** `z.literal(false)` breaks Gemini
tool declarations (string enums only) and fails as a *masked* mid-stream error; the model invented
database ids (`push-123`) because the route gave it no program data; and its first two `proposeChange`
attempts were malformed and rejected by the schema — which is precisely the argument for not
extending the in-text `<sheet_chart>` block pattern to input widgets. ⚠️ **Nothing device-verified —
no UI is reachable.** Phase 2 (the `/coach` route) carries that gate. Full suite 417 files / 3300
tests green; details in
[`docs/overview/history-2026-08-07.md`](history-2026-08-07.md).

**🆕 2026-08-08 — the ring-battery chip was reading a source that froze a month ago (Q-111 ring
half, v1.270.30).** `oura-battery-chip.tsx` existed but fetched `batteryLevel` from
`/api/oura/token` — the Oura **Cloud** value, frozen since the 2026-07-07 re-key — then hid itself
whenever `batteryStale` was set, which is always. **It rendered nothing, anywhere, and had since the
re-key.** `/api/oura-ble/battery-latest` has been serving the live BLE poll the whole time. Source
swapped and the chip wired into the Home header, reusing the `oura-ble-battery-latest` key **and its
`cachedFetchToday` variant** that `health/oura-section.tsx` already owns — a second key for one
endpoint causes stale/blank first paints, and mixing fetch variants on one key makes freshness
last-writer-wins. Readings past 3h render muted with "last seen Nh ago" rather than looking current.
**Two latent bugs in the same file went with it:** a `readCacheSync` in a `useState` lazy
initializer (the documented hydration-mismatch pattern) and five hardcoded `rgb()` literals now on
theme tokens. The chip pushed the header date onto two lines at 412px — caught and fixed
(`whitespace-nowrap shrink-0`). ⚠️ Not device-verified; **only the fresh state was rendered** (stale,
charging and low bands were not), and the weather chip was empty locally, so the header was seen
with one chip rather than two. **Q-111 stays open** — the strap half needs JS wiring to a native
value nothing reads, and the scale has no battery capability at all.

**🆕 2026-08-08 — client components can finally read the user's timezone (Q-148, v1.270.29).** The
structural gap *was* the item: `users.timezone` has always been on the JWT and reachable in every API
route — which is why Q-144 could fix the server-side half — but **nothing on the client could read
it**, so every client `formatTimeOfDay`/`formatDayShort`/`toAestDay` silently fell back to
`DEFAULT_TZ`. New `UserTimezoneProvider` + `useUserTimezone()`, fed from the root layout's **existing**
`auth()` call: no extra fetch, and no mounted gate (a gated read would produce a wrong first frame,
which is the class being removed). Both named sites converted, **plus the sweep the CI check cannot
see** — six `formatTimeOfDay` calls with no tz argument, two of them module-scope helpers that now
take tz as a parameter. **`exercise-review-sheet` mattered most:** Q-123 moved it to
`toAestDay`/`msToHHMMInTz`, which left the check's scope *while still writing `DEFAULT_TZ` into the
database*; its day key and persisted `start_time`/`end_time` now use the user's zone.
`BLOCKED_ON_CLIENT_TZ` is now empty — the ratchet failed the moment both were fixed, which is its
job. **Proved with three distinct zones** so no reading is ambiguous (user New York, device London,
fallback Brisbane): a fixed `2026-08-01T02:00:00Z` rendered `31 July`, which is New York — ruling out
*both* device-local and the fallback. ⚠️ Not device-verified; the individual screens were not each
opened with data, and **pre-existing `activity_logs` clock strings are not back-filled** (they hold
`DEFAULT_TZ`, which for the owner is the same value).

**🆕 2026-08-08 — Deload moves off Home onto the pre-workout screen (Q-109-followup, v1.270.28).**
Home's three-choice card is now two (Rest / Full); intensity is chosen beside the session-length
picker, while looking at the session it applies to. **The part that was not a UI move:** `aiDeload`
was a URL param read at eight places in `workout-screen.tsx`'s data layer, so a toggle required it
to become live state — seeded from the URL by the new `useDeloadChoice()` hook, with a flip re-keying
the workout-data cache and refetching `?aiDeload=1`, the exact request the old navigation made
(verified in-browser). The old URL entry point still works. **A placement bug was caught during
verification, not after:** the first attempt gated the toggle on an existing prescription like the
duration picker, which would have left **no way to pick Deload before one is generated** — precisely
the case Home's button covered. `workout-screen.tsx` breached its size ratchet at 1878/1861, so
rather than trim comments this took Q-138's own proposed split for the file (`WorkoutLoadError`
extracted, deload state into the hook): **1861 → 1850**, baseline shrunk to match. ⚠️ Not
device-verified. The deloaded prescription itself was **not** compared against a full one — the
seeded DB has none to regenerate; only the request and refetch are proven.

**🆕 2026-08-08 — the COMPLETED stamp, and a hue bug it exposed on 26 sites (Q-97-followup,
v1.270.27).** A completed session now carries a rotated CSS stamp across its muscle diagram instead
of a banner above it, and the Front/Back labels are gone from all four labelled `MuscleHeatmap` call
sites (six others already passed `compact`; `exercise-history-sheet` rendered them at 64 px wide,
where "FRONT" was unreadable anyway). Both kept as `sr-only`.

**The find:** the first build of the stamp rendered **salmon pink** in light mode. Measured in
Chromium — `color-mix(in oklch, <green 149°> 18%, white)` returns **hue 26.8°**, because oklch is
polar and mixing interpolates the hue angle; white's chroma is 0 and its stored hue is 0. CSS Color 4
calls that hue "powerless" and says to carry the other colour's, but Chromium does not for
`color-mix`. **26 shipped sites do exactly this** — `color-mix(in oklch, var(--color-brand) 15%,
var(--color-muted))` and friends across More, Profile, trophy case, title picker, Oura section, goal
spectrum, the set cards and session-select — so every brand-green tint there has been rendering the
wrong hue. It hid because the app was dark-only: against near-black the wrong hue lands at very low
lightness and reads as dark grey. All 26 → `in oklab`. **The 129 mixes against `transparent` were
never affected** (alpha compositing preserves hue) and are untouched.
`scripts/check-color-mix-hue.js` is the new ratchet, in the Custom Rules job, verified to fail on a
planted regression. ⚠️ Not device-verified; the hue fix is verified by measurement and by the stamp
rendered in both themes, **not** by re-opening all 26 surfaces.

**🆕 2026-08-08 — the naming sheet stops opening by itself when a Guided Walk ends (Q-95-followup,
v1.270.23).** Q-95's gate refuses a *new* `motionTrigger` while a walk/activity/workout is running,
and `auto-detection-service.ts` said in its own comment that an **already-probing/tracking session
"is left alone rather than torn down — a narrow, low-risk edge case"**. It is not narrow: it is
reachable whenever detection was already running when the walk began, and `endSession()` finalizes a
session by pushing it into `pendingSessions` — **which is what the confirm sheet reads**, so a
surviving session doesn't linger, it *becomes* the popup. New `discardSession()` (throws the session
away without finalizing), a pure `shouldAbortInFlightDetection()` predicate that checks gate state
and session state independently (in ungated web-fallback mode the gate never leaves `'idle'` yet a
session still accrues), and an abort that runs on tick, on resume, **and at the top of `onPoint`** —
the last one closes a race the ticker alone loses, since GPS points keep arriving and `onPoint`
calls the watchdog, which calls `endSession()`. A genuine unattended walk is untouched. **11 new
tests**, including a scripted reproduction of the popup — the item had asked for one before any fix
landed. ⚠️ Not device-verified: the decision and the effect are both tested, but
`abortInFlightIfSessionOwned` itself (module-level gate state + four stores) is not, and the
real-world GPS/motion trigger still can't be produced in the sandbox.

**🆕 2026-08-08 — the detected-activity sheet saves offline, and stops filing activities under the
device's calendar day (Q-123 (b)+(c), v1.270.21 — closes Q-123).** The "we detected a walk — save
it?" sheet did a bare `POST /api/activity-logs` with **no local-store write and no outbox mutation
anywhere in the file**, while both sibling save surfaces (`done-activity-screen`, `walk-summary`) do
local+outbox — so the one save the app *initiates itself* could not save at all offline, and even
online the activity was missing from every local-first read until the next pull. It now copies the
reference shape, with the API call kept as the web fallback. Separately, its day key came from
`getFullYear()/getMonth()/getDate()` — **persisted data, not display**, so on a device outside
Brisbane the activity was filed under the wrong day with no way to recover which day was meant.
**Sibling finding the backlog did not name:** `start_time`/`end_time` are persisted clock strings
too, and **four** sites built them from the device's own `getHours()` (the two above plus
`walk-summary.tsx` and `lib/health-connect-sync.ts`), each with a private copy of the same helper —
now one `msToHHMMInTz()`. No migration needed: the owner's device is in Brisbane, so every row
written so far already agrees. ⚠️ **Not device-verified, and the offline half is exactly what needs
it** — `getLocalStore` returns `null` in the web sandbox, so `pnpm dev` exercises only the API
fallback; the local write and outbox row are verified against the reference implementation and the
type signature, not observed landing in native SQLite.

**🆕 2026-08-08 — disclosure toggles announce their state (Q-133 part 1, v1.270.17).** The review counted
*"21 hand-rolled disclosure toggles ship no `aria-expanded`"*. **That is an overcount** — several
listed sites are Radix `CollapsibleTrigger`s (`deload-explanation`, `signal-sections`,
`profile-tab`, `ai-prescription-card`, `meal-card`), which emit the attribute themselves; a source
grep for "chevron with a rotate class" cannot tell a real gap from a primitive doing its job. So the
gap was **measured in the rendered DOM** across six screens instead: More and Config went from
`3 ok / 7 missing` to `8 ok / 2 missing`, and every remaining "missing" is a confirmed false
positive of the probe (month/day nav arrows, a download link, a connect action) — not a disclosure.
12 controls genuinely lacked it and now have it, bound to the state they already toggle, markup
otherwise untouched. **Not** converted to `CollapsibleSection`: that primitive brings its own
bordered section, chevron and state, so converting 12 externally-controlled toggles would be a
visual redesign of 12 screens inside an accessibility PR. Nutrition's day-stepper arrows — a
*different* gap found by the same audit — also gained `aria-label`s. ⚠️ **No screen reader was
used**. **Part 2 (below) closed the rest — Q-133 is done and the backlog entry is removed.**

**🆕 2026-08-08 — the 48dp tap floor, a real confirm dialog, and the last emoji chrome (Q-133 part 2,
v1.270.20 — closes Q-133).** The floor went **44px → 48px** and now covers `[role="button"]` (the
WebView tappable-card pattern, which cannot be a real `<button>`). **It deliberately stays a global
element selector** rather than moving into `components/ui/button.tsx` variants as the backlog
proposed: every `Button` size declares *less* than the floor (`sm` 32px, `default` 36px, `lg` 40px,
`icon` 36px) and most of the app's controls are hand-rolled `<button>`s, so the move would **shrink
coverage, not tidy it** — the rule now carries a comment saying so. `<a>` is still excluded on
purpose (a text link in prose is not a tap target). **Measured rather than assumed:** a DOM pass over
every rendered control on five screens found **0 under 48px** except the deliberate `.tap-dense`
opt-outs, and **no screen gained horizontal scroll**. Also: the four `window.confirm` calls became
`ConfirmDialog` (two gate unrecoverable DB writes, so their wording was carried over verbatim), the
last six emoji-as-chrome sites became Lucide icons — the leaderboard's `👀` gained the `aria-label`
it never had — and `chat.tsx`'s opaque `bg-background` root became `bg-page`. ⚠️ **Not device-verified,
and that matters more than usual**: this is a CSS change touching every control under 640px, checked
on five screens in the web sandbox. Guided-walk, the in-progress workout screen, health and overview
were not measured. The `ConfirmDialog` conversions are verified in source, not clicked — those
consoles need an admin session and live ring data.

**🆕 2026-08-08 — defeated memos, a contradictory skeleton, and four bypassed cache keys (Q-135).**
From the 2026-08-07 full-app review (§3.13, §4). **Memos:** `ModalityPicker` (two inline arrows from
`cardio-content.tsx`) and `MuscleHeatmap` (an inline `.map()` from `sore-muscle-picker.tsx`) had
their `React.memo` silently defeated by fresh prop identities each render — the heatmap is the
costly one, re-rendering an SVG body map on every keystroke in the mood check-in sheet. The third
site the review names (`AiChatOverlay` ← `stats-content.tsx`) is **deliberately not fixed**: Q-136
deletes that file outright as having zero importers, so fixing it would only create a conflict.
**Skeleton:** `overview-screen.tsx` wrapped `ReadinessCard` in `dynamic(..., { loading: <Skeleton/> })`
while seeding `readiness` synchronously from cache — the skeleton wins first paint and defeats the
seed. Static-imported (268 props-only lines, no fetch, no heavy dep — it never met the `dynamic()`
bar). **Cache keys:** four screens bare-`fetch`ed `/api/hr-profile` while five others use the shared
`cachedFetch` key, so post-run/post-walk summaries fired a redundant round-trip and **could not
render HR zones offline**; all four converted. **Waterfall:** left as-is and documented instead —
home's second fetch is sequenced so the first paints on-screen content while the second only seeds
unopened tabs; the existing comment explained the batching and never the ordering, which is why it
read as accidental. No version bump — no user-visible change. ⚠️ No render counts or profiles
captured (structural, not measured), and none of the four HR-profile screens was opened after the
change.

**🆕 2026-08-08 — dead code deleted, the four decisions left as decisions (Q-136 part 1).** Q-136
opens with *"do not delete blindly — two of these are decisions, not cleanups"*, so this took only
the mechanical half. Gone, each verified at **0 references** by a repo-wide grep before deletion:
`app/api/oura/debug` (Cloud pipeline, dead since the BLE re-key), `admin/seed-exercise-gifs`
(superseded by `mirror-dataset-gifs`), `admin/test-exercise-image` (a scratchpad),
`admin/list-ai-models` (a one-off), `app/stats/stats-content.tsx` (389 lines, zero importers) and
`app/history/page.tsx` (a shim to a shim). **Two corrections worth keeping:** `/stats` itself is
**NOT** dead — `session-select-content.tsx:455` pushes to it from a wired control, so only the
orphaned content component went; and deleting the two admin media routes also removed the rate
limits Q-134 (#1146) had added to them hours earlier — harmless, since both routes were
unreachable, but it is another agent's work going away and is recorded rather than silent.
**Left for the owner:** `app/health/timeline` (orphaned since creation — "wire it up or delete it"
is a product call), `sync/oura-timeseries` (half a feature), `oura/webhooks` (no UI, but the only
way to list/delete subscriptions), and the `/sheet/[id]/*` shims (the only inbound path to `/chat`
and `/overview`). No version bump — nothing user-visible. ⚠️ Nothing exercised in a browser: every
deleted path had zero inbound references, so the intended effect is that nothing changes; a caller
reaching them by a string grep cannot see (Tasker, a bookmark, curl) would 404.

**🆕 2026-08-08 — the per-screen wallpaper stops flashing dark for light-theme users (Q-132 part 1,
v1.270.16).** `ScreenPaletteLayer` painted an `absolute inset-0` full-screen wallpaper across **7 screens**
and picked light-vs-dark with `useHeroColorScheme()`, which returns `'dark'` until its effect runs —
so its first frame was always the dark scene, on every launch and hard navigation. The codebase had
**already fixed and documented this exact class once** (`detail-hero.tsx:46-47`, `usePageGradient` →
a plain CSS var) and never carried it to the larger surface. The seven palettes are now
`--screen-palette-*` variables in `globals.css` under `:root`/`.dark`, and the component has no theme
branch at all. **Scope worth knowing:** the dynamic background ships `enabled: false`, so this only
ever reached users who switched the wallpaper on. Verified on 4 of the 7 screens in light mode with
the feature enabled — each resolves to its light variant. ⚠️ The single dark frame itself was not
caught (one commit long). **Part 2 (below) closed the rest — Q-132 is done and the backlog entry is
removed.**

**🆕 2026-08-08 — the light theme stops hiding things, and three palettes collapse to one function
each (Q-132 part 2, v1.270.19 — closes Q-132).** `rgba(255,255,255,α)` and `text-white` are invisible
on a light background, and the review's six flagged files were only most of it. Fixed there plus two
the list did not name: **`home/score-ring-frames.tsx`** — which is what the entry actually meant by
"SVG ring frames, rendered on Home", the line numbers having moved when it was split out of
`oura-score-chip-row.tsx` on 2026-08-07 — and `health/day/day-detail-content.tsx`'s divider. Before
the fix the four Home score numbers rendered **white-on-white with no ring at all** in the light
theme; both are confirmed correct in both themes now. Replacements are the tokens that already mean
the same thing in both schemes (`var(--border)` is literally `oklch(1 0 0 / 7%)` in dark).
**Re-counted after: 22 white-alpha sites remain and every one is legitimate** — scheme-conditional
pairs, hero art, decoration, or the `bg-black` `pip-view`; no follow-up entry, because there is no
remaining finding. Also: `scoreBandByLabel()` and a shared `ScoreBandLegend` kill the duplicated
band palettes (`readiness-card.tsx` hand-rolled one *in a file already importing `scoreBand`*), and
one `bodyBatteryColor(label)` replaces two divergent battery-colour functions plus a client-side
re-derivation of the 75/50/25 tiers `/api/body-battery` already ships as `label`. Three colour-only
score displays now name their band. ⚠️ Not device-verified; `color-mix(in oklch, …)` in an SVG
`stroke` is unproven on Samsung's WebView.

**🆕 2026-08-08 — activity charts load dynamically; Q-127's cold-start claim did not reproduce
(Q-127).** The review found a real static import chain — `health-content.tsx` →
`health-sections.tsx` → `activity-history-card.tsx` → `activity-detail-sheet.tsx` → three chart
components — supposedly defeating the `dynamic()` wrapper above it and putting chart.js (~208 KB)
in the Health tab chunk `tab-shell` warms on every app open. **Measured against two production
builds, it does not:** `/health`'s initial chunk list is 28 chunks / 1040 KB before *and* after,
and neither chart.js nor the sheet's chunk appears in it either way — webpack was already
isolating the whole subtree behind `health-content.tsx`'s own `dynamic()` boundary. Shipped only
the verifiable half: all six charts in `activity-detail-sheet.tsx` now load through
`dynamic(..., { ssr: false })` (three did, three didn't), and `activity-history-card.tsx` matches
`health-content.tsx` in importing the sheet dynamically — so the split is stated rather than
inferred from bundler heuristics that a Next upgrade could change. A first-tap mount gate was
written and then dropped: the measurement shows the chunk is not requested on tab mount anyway.
**No version bump — no user-visible change.** ⚠️ The sheet was **not** opened at runtime after the
change; import shape only, typechecked but not rendered. ⚠️ The code shipped inside **#1140**
(carried across on a branch switch and swept in by `git add -A`), so `git log` attributes it to the
brand-token PR; #1149 carries only the documentation.

**🆕 2026-08-08 — route `Cache-Control: max-age` stops outliving client cache-group invalidation
(Q-125, v1.270.14).** From the 2026-08-07 full-app review (§3.9). The client invalidation discipline is
good — zero `invalidateCache` calls outside `lib/cache-groups.ts` — and was being undone one layer
down: a write clears the client entry, the refetch goes out, and the **WebView's own HTTP cache**
answers it with the pre-write body for the rest of the route's `max-age`. Worst two were
`public, max-age=3600` on session-gated per-user data (`exercise-library`, `activity-types`) — a
newly added exercise stayed invisible for up to an hour despite `invalidateExerciseLibrary()` firing
correctly. Ten routes moved to the standard `private, max-age=60, stale-while-revalidate=120`; the
four cardio/running stat routes are **not** in the backlog entry but belong with it, because Q-126
(#1152) adds their keys to `invalidateActivityWrites()` and a 300 s `max-age` would defeat that.
The entry's counterpoint — 42 of ~48 aggregate GET routes ship no header at all — was resolved by
**narrowing the rule, not enforcing it**: a route was touched only where a cache group invalidates
its client key. All ten verified live against the dev server. ⚠️ The staleness itself was **not**
reproduced — that needs the APK's HTTP cache, not the dev server.

**🆕 2026-08-08 — the active workout screen stops re-rendering itself once a second (Q-121).**
From the 2026-08-07 full-app review (§2.8). `active-workout-screen.tsx` called `useElapsedSec`
**twice at the top of the screen** — two unsynchronised 1 Hz `setInterval` state hooks driving ~700
lines of JSX for the length of a session, the placement CLAUDE.md's render-discipline section bans
by name. The file already knew: two in-file comments describe mitigations that protect the
*children* while the screen's own JSX kept reconciling 1–2×/s for 45–90 minutes. New
`components/workout/workout-clocks.tsx` holds five leaves — `SessionRing`, `SessionPill`,
`ExerciseClock`, `WarmupRampProgress`, `RestTimer` — each owning its own tick. `RestTimer` also
absorbs the rest arithmetic the screen recomputed from `Date.now()` on every render, which was only
correct *because* the session clock was re-rendering it every second. The screen drops 745 → 627
lines and no longer imports `useElapsedSec`. `workout-screen.tsx:796`'s interval is untouched (module
singleton, never React state). Driven end-to-end on `pnpm dev` through a real session: all four
clocks advance and the rest ring counts down. ⚠️ **The improvement is structural, not measured** —
no profile was captured; per Q-51 that needs an on-device Performance capture. Overtime rest,
superset handoff and the all-sets-done inert ring were not reached.

**🆕 2026-08-08 — five cache-invalidation gaps closed (Q-126, v1.270.13).** From the 2026-08-07 full-app
review (§3.10–3.12, §4). (a) `invalidateActivityWrites()` omitted `running-bests`,
`run-type-stats`, `walk-segment-stats` and `cardio-trends` — all read `activity_logs`, all hold 6 h,
so a new 5K PB left the All-Time Bests card on the old number. (b) Confirming a flagged scale
weigh-in invalidated **nothing** (`scale-pairing.tsx` had no cache-groups import) despite the route
performing a real `body_metrics` write; now fires the same pair a manual metric log uses, awaited
before the refetch. (c) `achievements:` was missing from `invalidateBiometrics()` and
`invalidateOuraSync()`, so sleep-streak badges never refreshed — the same sweep had already closed
this for body-metrics and nutrition. (d) `hr-recovery-profile` and `exercise-hr-trend:` were in **no
group at all** despite deriving from `set_hr_stats`. (e) The done screen's "+XP earned" seeded from
a key written by one screen but cleared by five groups, and `?? 0` turned a missing baseline into
the user's entire lifetime XP; one `recordXpEarned()` helper now skips the badge when there is no
baseline **and** writes the response back so the next session has one. ⚠️ **None of the five was
reproduced end-to-end** — each needs a real write plus a navigation (or a paired BLE scale); what
was verified is that every added key matches its component's actual `cachedFetch` call site.

**🆕 2026-08-08 — weekly muscle volume stops splitting one muscle into two rows (Q-120,
v1.270.6).** From the 2026-08-07 full-app review (§2.7). `computeDefaultVolumeTargets` writes
**normalised** muscle names into `program_volume_targets` (`normalizeMuscle` folds `core→abs`,
`quadriceps→quads`, `pecs→chest`, …) while every consumer keyed logged sets by the **raw**
exercise-library label under a bare `LOWER()`. The seeded library ships `"core"` on 14 rows, so
Health → Weekly Muscle Sets drew one muscle as two: a red `Abs 0/16` beside an untargeted
`Core 12` — and the `MuscleHeatmap` directly above it *does* normalise, so the picture and the list
disagreed with each other. Fixed at the source: `getWeeklySetsByMuscleGroup` now returns canonical
keys, `signals.ts` drops the re-normalisation pass it needed to compensate, and the three routes
that run their own SQL (`weekly-muscle-sets`, `ai-periodization/weekly-volume`,
`muscle-tonnage-trend`) normalise both logged and target keys. **`muscle-tonnage-trend` was not in
the backlog entry** — same defect, same user-visible class (it drew `core` and `abs` as two trend
lines), swept per the sibling-surface rule. Reproduced *and* re-verified against the local DB with a
real `"core"`-tagged log: `main` returned `abs 0/16` + `core 3`, the branch returns `abs 3/16`.
Not device-verified — server-side aggregation only.

**🆕 2026-08-08 — light mode's brand colour finally applies, plus a `--brand-foreground` token
(Q-119, v1.270.11).** `app/globals.css`'s light `:root` set `--brand` but never `--color-brand`, and
`--color-brand` is what `text-brand`/`bg-brand` read (495 sites vs 2). The stated light-mode fix had
therefore been inert since it was written: brand text rendered in the dark-theme green at a measured
**2.22:1 on white**. Set `--color-brand` in the light `:root` and moved the value from `oklch(0.55 …)`
to `oklch(0.52 …)` — wiring alone would only have reached 4.16:1, still under the 4.5 floor; 0.52
measures **4.70:1**. Added `--brand-foreground` (`text-brand-foreground`), black or white per
brand × scheme by measured contrast rather than by scheme — white for every light variant, black for
every dark variant except `.dark[data-brand="red"]`, black for all custom hues (pinned at L 0.7,
where black wins at every hue). Converted 59 hardcoded literals across 44 files, retiring all three
competing conventions (`text-white`, `text-black`, inline `color: '#000'`). Verified in Playwright at
412×915 in **both themes**. Not device-verified — CSS and class names only, no native/safe-area path.

**🆕 2026-08-08 — every "Failed query" in `error_events` is now diagnosable (Q-107 first half,
v1.270.10).** The intermittent `/api/sync/pull` failures (and the identical signature on
`/api/readiness-score` and `/api/body-battery` — same fault, wider than sync) have stayed a
*theory* because the error rows carried nothing to diagnose. One omission explains it:
`DrizzleQueryError` sets its message to `Failed query: <sql>` and puts the **real** Postgres error —
`code`, `severity`, `detail` — on `err.cause`, which `reportServerError` dropped. That field is the
difference between `57014` (`query_canceled`, i.e. `statement_timeout`) and a pool-acquisition
timeout, which arrives with no code at all — the two competing explanations. `summariseCause` now
lifts the code into a message **prefix** (a suffix would sit past the `left(message,120)` the
standing session-start query groups by, i.e. invisible in the one read that matters) and records the
full breakdown in the stack. No migration. Verified against a live Postgres, not synthetic objects:
a real undefined-table error produced `[pg 42P01]` and a real statement timeout produced
`[pg 57014]`. **The batching half is deliberately NOT done** — the entry says the observability half
ships first so the batching fix is measurable, and the next session on Q-107 should read
`error_events` in production before touching `getSyncDelta`, since the codes are there now.

**🆕 2026-08-08 — date-handling hardening sweep (Q-130, v1.270.9).** From the 2026-08-07 full-app
review (§3.15, §3.16, §4). All latent — every current caller sends dashed `todayInTz()` output — but
each failure mode has cost a release before. **(a)** Four routes took a raw `date` param with no
`normalizeDateParam` (`mood`, `day-checkin`, `nutrition/food-logs`, `oura/hr-window`) while five
siblings already had it; `oura/hr-window` was doing `dateParam.split('-').map(Number)` on the raw
value, the exact `RangeError` shape the rule exists to prevent, so its `HH:MM` params got a check
too. `food-logs`' **POST body** date got the guard as well — that one becomes the written row's key.
`day-checkin`'s `phase` also reached the repo unvalidated. **(b)** `formatDateDisplay` did precisely
what the function directly beneath it documents as forbidden — `new Date(raw)` (UTC midnight) then
device-local `toLocaleDateString` — so it read a day early on any device behind UTC; now
component-wise, which fixes both live callers without touching either. **(c)** Seven files carried a
dash-only date regex while the client's `localDateString()` emits **slashes** (the mismatch that
killed ai-chat's `localDate` for a full release), and `health-connect/ingest` had the mirror problem;
all eight now use `[-/]`. **(d)** `sync/pull`'s `since` cursor was unvalidated, so a corrupted cursor
threw inside `getSyncDelta` and came back as a generic 500 — a device would retry forever against an
opaque error; now a 400 naming the param. **(e)** `workout/exercise-hr-trend` used the banned
`Date.now() - N×86400000` anchor. Every guard live-verified against `pnpm dev` with valid **and**
invalid input; the `formatDateDisplay` fix verified by running its tests under `TZ=America/New_York`
(2 failed before, all passed after) — CI runs in UTC, where the old code also looked right, and the
test file says so.

**🆕 2026-08-08 — four drifts between the two write paths closed (Q-131, v1.270.8).** From the
2026-08-07 full-app review (§4), all the "web route and `pushMutations` have drifted" class — the
one behind three production incidents. (1) The **`mood_logs` push branch had no validation at all**,
casting straight through (`p.energyLevel as EnergyLevel`) where the web route parses enums and array
caps; a corrupted payload wrote an arbitrary string into the `NOT NULL` `energy_level` column and
every readiness/energy surface then rendered it as a real check-in. Every sibling domain got a shared
schema under SYNC-P3/P4/Q-24; mood was missed — it now has one
(`packages/shared/src/validation/mood-log.ts`), parsed by both paths. (2) **`food_items` push dropped
`barcode` and hardcoded `region: ''`** despite `FoodItemPushSchema` accepting both, and defaulted
serving size to 0 against the web route's 100 — so an item saved offline lost the barcode a later
rescan matches on, and every per-serving calculation collapsed. (3) **The pull chain dropped four
columns present on both ends** (`workout_sessions.session_id`/`intensity_mode`/`was_override`,
`exercise_logs.exercise_deloaded`) — they exist precisely so a stranded outbox replay keeps real
phase attribution, so a replay on a restored device silently degraded to name-fallback attribution
and a deloaded exercise came back full-intensity. None was reachable from today's UI, so this landed
as hygiene; each becomes live the moment its path is made offline-capable. The two push-branch fixes
have DB-backed tests that **fail against the pre-fix adapter**.

**🆕 2026-08-08 — supplements stop losing offline edits, and five admin media routes get a rate
limit (Q-124 + Q-134, v1.270.7).** ⚠️ **NOT device-verified — see the Known-Issues row.** From the
2026-08-07 full-app review (§3.6, §3.7, §4). Supplements were the **one** offline write domain whose
`applyDelta` arm had no pull-clobber guard, and not by oversight: the local table had no
`sync_status` column to gate on, so a rename made offline reverted to the server's old value on the
next pull. **Local migration v22** adds `sync_status` + `deleted_at` (with `RECONCILE_COLUMNS` rows,
the real authority after a partial upgrade), `applyDelta` gained the synced-guard and a tombstone arm
so cross-device deletes finally propagate, local writes mark rows `pending`, and the sync engine's
confirm loop flips them back — that last arm matters, since without it the new guard would make a
pending row permanently unreachable by sync. Separately, `nutrition-content.tsx` fetched the
`supplements` cache key with **both** `cachedFetchToday` and `cachedFetch` on adjacent branches —
same key, incompatible envelopes, the `weekly-stats` crash class — so whichever wrote last decided
whether the section rendered at all; converted to the today-variant every other site already uses.
`updateSupplement` passed the raw request body into Drizzle `.set()`, safe only because its single
caller uses `.strict()` — now an explicit allowlist, the `updateInjury` shape. **Q-124(c) turned out
to be wrong and is struck from the review:** it claimed a web edit never bumped `updated_at` and so
never synced, but migration 078 installs a `BEFORE UPDATE` trigger that has always done it —
verified live (a real PATCH moved the timestamp and the row came back in the next `/api/sync/pull`
delta). The repo function sets it explicitly now regardless, so a sync-critical column does not
depend on a trigger the code never references. Finally, the five admin image/media routes that had no rate limit at all
(`generate-exercise-media`, `test-exercise-image`, `reference-figure`, `mirror-dataset-gifs`,
`seed-exercise-gifs`) got 10/min per admin, matching their siblings. **Not claimed:** the review's
guess that this explains `supplement_logs` holding 1 row since 2026-06-21 — plausible mechanism,
not a diagnosis.

**🆕 2026-08-08 — cross-user phase-set leak closed (Q-129, v1.270.6).** ⚠️ **Security.** From the
2026-08-07 full-app review (§3.4): `programs.phase_set_id` is a client-writable FK into a strictly
user-scoped table, and three links trusted it. (1) `POST /api/workout-templates` wrote
`body.program.phaseSetId` straight through with no ownership check; (2) `listProgramPhases`
resolved that FK with **no user scope**, so another account's phase names, types, durations and
cycle structure rendered in `workout-data`, `program-week`, `readiness-score`, `weights-summary`
and `daily-digest`; (3) `deletePhaseSet`'s in-use probe was unscoped too, and its message reaches
the client verbatim — disclosing a stranger's **program name** and blocking the caller's own
delete. Exploiting it needs another user's UUID, which is why it was not top-of-queue, but
production now holds several real accounts. Fixed by threading `userId` into `listProgramPhases`
(interface + adapter + six routes, all mechanical), scoping the delete probe, and validating
`phaseSetId` against `listPhaseSets(userId)` before any write — the same shape
`phase-sets/[id]/route.ts` already uses for style ids. Also added the explicit rowcount guard
`saveProgram` was missing: it failed closed only by accident (`pRow.id` throwing on a 0-row match),
now by design. New DB-backed test builds two real users and asserts all three links;
**confirmed all three fail against the pre-fix code**, so they test the fix and not the harness.

**🆕 2026-08-08 — an offline-completed workout finally gets its per-set HR attribution
(Q-123a, v1.270.5).** From the 2026-08-07 full-app review (§3.1): the web completion route fires two
side effects (Oura HR sync **and** an inline per-set/per-workout attribution pass), while the
outbox's `complete_workout` branch fired only the sync half — and only when the push request carried
an `origin`+`cookie`, since it reached it by POSTing back to `/api/oura/hr-sync`. A silent
regression of the Q-11 Defect B fix (v1.266.1), which landed on the web route and was never mirrored
to the push branch. It bites exactly when the outbox matters: the direct POST failed, or the phone
was offline. Because Q-122 had already extracted the pipeline into `syncAndAttributeSessionHr`, the
branch became a two-line call to the shared function. **`ctx` is now gone entirely** from
`pushMutations` (adapter, `WorkoutRepository` interface, and the `sync/push` call site) — the
loopback was its only consumer, and a dead request-context parameter threaded through the sync entry
point is an invitation to reintroduce the pattern. New DB-backed test seeds real HR readings and set
windows, pushes a `complete_workout` mutation, and asserts `workout_hr_stats` + `set_hr_stats`
appear; **verified it fails against the pre-fix adapter**, so it tests the fix rather than the
harness. **Q-123(b) and (c) are deliberately still open** — both live in
`components/activity/exercise-review-sheet.tsx` (a server-only save with no outbox, and a
device-local date key written to the DB, which is persisted data rather than display), and
`components/` was another agent's territory while this landed.

**🆕 2026-08-08 — the server no longer makes HTTP calls to itself (Q-122, v1.270.4).** From the
2026-08-07 full-app review (§3.5): three `fetch()` calls at `req.nextUrl.origin` forwarding the
caller's cookie — `complete-workout` → `/api/oura/hr-sync`, and `workout-data` ×2 →
`/api/ai-periodization/session/[id]/prescribe`. Evidenced, not theoretical: `#hr-sync` logged a
bare `"fetch failed"` 9 times, 5 of them in the 8 days before the review, each one silently
skipping that workout's Oura HR sync until an admin backfill caught it. New shared module
`lib/workout/post-completion-hr.ts` (`syncAndAttributeSessionHr`) now holds the whole
completion-time HR pipeline — sync then attribute, in that order, so the attribution pass finally
sees what the sync just stored instead of racing it — and is called by the completion route, by
`/api/oura/hr-sync` (now a thin wrapper, still needed for its client caller) and, next, by the
outbox branch (Q-123a). The prescribe calls became a direct
`generatePrescriptionForSession` invocation that **re-applies the same `prescribe:<userId>` 20/hr
rate limit** the route enforced, so removing the HTTP hop does not also remove the budget that stops
a poll loop minting unlimited Gemini calls. Live-verified on `pnpm dev`: completing a workout
produced no inbound `/api/oura/hr-sync` request, and a `workout-data` read on a pending ai_dynamic
session generated and stored a real Gemini prescription with no inbound `/prescribe` request. Error
tag deliberately renamed `#hr-sync`/`#hr-stats` → `#hr-pipeline` so the 9 historical rows keep
meaning "the loopback failed", a failure mode that no longer exists.

**🆕 2026-08-08 — `sessions_in_phase` is reconciled where it is read, not only where it is
audited (Q-128, v1.270.3).** From the 2026-08-07 full-app review (§3.14):
`reconcileSessionsInPhase` was called from exactly one route (`ai-periodization/program-overview`),
while the counter was read raw by `workout-data/route.ts` (→ `completedCycles`,
`phaseSessionNumber`, both rendered on the workout screen) and by `signals.ts` (→ the number the
prescription prompt is given). This counter has drifted three times historically, so a drifted row
mislabelled phase progress and skewed the AI's input until the user happened to open the
program-overview screen. Both `workout-data` paths now reconcile before reading — batched into the
existing `Promise.all` on the `?tab=all` path, chained ahead of the periodization read on the
single-session path, so neither adds a serial round-trip — and `aggregateSignals` reconciles and
re-reads its own state, covering the `workout-review` caller that never passed through
`generate-prescription`'s existing SYNC-T2 reconcile. **Deliberately not placed inside
`getSessionPeriodization`** (the backlog's first suggestion): `completeWorkoutFromPayload` completes
the session, reads periodization, then increments the counter — a reconcile inside that read would
count the just-completed session and the increment would add it again, converting a self-heal into
a double-count. Both new calls are advisory (`.catch`), falling back to the unreconciled row.
Live-verified on `pnpm dev` against the local DB: rows drifted low (0) and high (9 and 7) against 3
genuinely-completed sessions healed to 3 through both routes. Production impact today was already
nil — of 10 rows, one is drifted and it is on an inactive program — so this landed as hardening.

**🆕 2026-08-07 — removed the redundant "Interval walk" shortcut from the Log Activity sheet
(Q-140, v1.270.1).** Direct owner report: "this is the log activity section; doesn't need
interval walk like that cause guided [walk] exists." Confirmed redundant, not a navigation
dead-end: Guided Walk already has its own separate, always-visible entry point on the Cardio Hub
screen (`components/cardio/modality-picker.tsx`), and `LogActivitySheet` is only ever opened from
one call site (the Hub's "Other activity" row), so removing its internal shortcut strands nothing.
Deleted the featured button, its `startGuidedWalk()` handler, the `router.prefetch('/activity/
guided-walk')` call that existed only to support it, and the now-unused `PersonSimpleWalk` import.
Verified via Playwright: the Log Activity sheet now shows only the plain activity-type grid, and
the separate Guided Walk card remains visible and reachable on the Cardio Hub screen behind it.

**🆕 2026-08-07 — navless takeover screens swept onto the floored safe-area utility (Q-118,
v1.267.20).** ⚠️ **Not yet device-verified.** 6 sites (`active-activity-screen.tsx`,
`fitness-tests/test-active.tsx` ×2, `guided-walk/walk-active.tsx`, `guided-walk/walk-config.tsx`,
`guided-walk/walk-summary.tsx`, `activity/done-activity-screen.tsx`) used the un-floored
`pb-safe-action` instead of `pb-safe-action-lg` on their bottom action row, the same on-device
gesture-bar-overlap class already fixed once for workout screens but never swept here. Pure
Tailwind class swap, no logic changes. See the Known-Issues row below for the full evidence and
why this can't be verified in this sandbox at all.

**🆕 2026-08-07 — a confirmed early deload and a logged injury now both reach today's plan
(Q-117, v1.267.19).** Found by the 2026-08-07 full-app review (§2.2, §2.3): two separate writes
that change what the workout screen prescribes, neither invalidating the cache that holds it.
Because `workout-data:all` is read with `freshWithinTtl: true` at `TTL_LONG`, the stale entry
wasn't just painted first — **no network request was made at all** for up to 6 hours. (1) Early
deload: `handleEarlyDeloadConfirm` only updated local readiness state; the real server effect
(`programs.ts` → `phase-engine.ts` → `workout-data/route.ts`) never got a cache invalidation to
pair with it, so every card kept showing full-intensity target weights after tapping "Take deload
week now." Fixed by calling `invalidatePrescriptionChanged()` from the confirm handler. (2)
Injury: `invalidateInjuryWrites()` cleared only the `injuries` cache itself, not the
`workout-data`/`workout-card:`/`ai-periodization-session:` caches that actually reflect it —
extended the group to clear all four. **A second, server-side gap the client fix alone couldn't
close:** `workout-data/route.ts`'s consumption-day re-evaluation skip check
(`reevaluationKey(todayStr, moodLog, morningCheckin)`) never included injuries at all, so even a
forced refetch would have returned the pre-injury prescription — added a 4th parameter (max
`updatedAt` over unresolved injuries) to the fingerprint, following the exact pattern Q-113 used
for the Morning Check-in's illness flag. Adding `updatedAt` to the `Injury` type (previously
dropped at the repository mapper despite existing on the DB row) touched 5 call sites across
`api/injuries`, `health-content.tsx`, `injury-sheet.tsx`, and `workout-screen.tsx` — all
mechanical, caught by `tsc`. Also corrected a stale proof comment in both
`session-select-content.tsx` and its Workout-tab sibling `workout-select-content.tsx` (same cache
key, same claim, same gap) that asserted every write invalidating this payload was already
covered — `/api/confirm-early-deload` and injury writes were the counter-examples. Verified live
against `pnpm dev`: confirmed `freshWithinTtl` genuinely skips the network fetch on an immediate
cache-fresh revisit (0 requests), then logged a real injury via the UI and confirmed a revisit
fired a genuine `/api/workout-data?tab=all` request afterward (1 request) — proving the
invalidation fix closes the gap rather than merely reducing its odds. Test injury cleaned up
afterward. 5 new unit tests added for the injury-fingerprint behavior of `reevaluationKey`.

**🆕 2026-08-07 — Home's React hydration mismatch is fixed (Q-73, v1.267.18).** 283 recorded
occurrences of minified React error #418 on `/` since 2026-08-04, root-caused the same day by the
full-app review: `session-select-content.tsx`'s header date called `toLocaleDateString("en-AU", …)`
with no `timeZone` — the banned pattern CLAUDE.md's Timezone section names directly. Railway sets
no `TZ` env var, so Node renders in **UTC** while the S25 renders in **Australia/Brisbane**; for
the 42% of each day between 00:00–10:00 AEST the server sent yesterday's weekday+date and the
client rendered today's, producing a text mismatch on every load in that window. Fixed by switching
to `formatInTimeZone(new Date(), DEFAULT_TZ, "EEEE d MMMM")` — a **fixed** timezone rather than
either side's ambient system tz, so server and client always compute the identical string
regardless of where either process runs. Swept the same banned pattern at three sibling sites:
`getGreeting()`'s `new Date().getHours()` in the same file (not yet a live mismatch — gated behind
a currently-null `displayName` — but the same class and would misfire for a travelling user), plus
identical bare `toLocaleDateString` calls in `overview-screen.tsx` and `pre-workout-screen.tsx`.
**Live-verified crossing the actual bug window**: this session's real wall-clock happened to cross
the UTC/AEST midnight boundary while testing (UTC still Aug 7, Brisbane already Aug 8) — a
pre-fix-cache Playwright run caught a genuine hydration error mid-test (`+ Friday 7 August` client
vs `- Saturday 8 August` server); clearing `.next` and rebuilding confirmed it was a stale
dev-server compile artifact from before the fix landed, not a residual bug — a clean rebuild showed
zero hydration errors and "Saturday 8 August" consistently on both renders. All three sibling sites
re-verified with a fresh `pnpm dev` pass afterward. Also corrected two false premises this
investigation's own history carried forward (see the Known-Issues row below): the shell does **not**
mount all five tabs at once (only the active tab mounts client-side), and the fix needed no
on-device capture — both cost two earlier sessions searching the wrong surface.
**🆕 2026-08-07 — Body Battery's "How it moves" panel stops contradicting the card above it
(Q-103, v1.267.17).** Owner-reported (screenshot): the expanded card showed "Currently 91, from
last night's sleep" directly above a "How it moves" panel unconditionally reading "Opens each
morning at your Readiness" — a visible contradiction on the same card. `body-battery-card.tsx`'s
"How it moves" line was a hardcoded string that never read `battery.anchorSource`, while two
sibling lines on the exact same card already rendered it dynamically ("from readiness" / "from
sleep"). The sleep-anchored state itself is correct, intentional, already-documented behavior (a
provisional anchor before Readiness lands) — only this one line's copy was wrong. Wired the same
field into the third line, matching the existing wording pattern: "Opens each morning at your
Readiness" or "...Sleep" depending on `anchorSource`. Verified against `pnpm dev` for the common
(readiness-anchored) case — confirmed no regression, the line still reads "Opens each morning at
your Readiness" matching "Currently 59, from this morning's readiness" directly above it, in both
light and dark themes. The sleep-anchored case (`anchorSource='sleep'`) needs today's readiness
data to be absent while a sleep score exists, and a persisted anchor snapshot already froze the
seed at `'readiness'` for today — forcing that specific data state was judged disproportionate
effort for a 3-line, purely cosmetic conditional that mirrors an already-proven pattern used
correctly at two other sites in the same file; verified by code review instead.
**🆕 2026-08-07 — "Body temp elevated" now shows the real numbers behind it (Q-105, v1.267.16).**
Owner asked whether the banner is gated to 30+ days of baseline data (confirmed yes,
`TEMP_BASELINE_MIN_DAYS = 30`) and wanted the "Why this recommendation?" expandable to show the
actual deviation driving it instead of a fixed qualitative sentence. Oura only exposes a °C
deviation from the ring's own internal baseline — there is no absolute baseline value anywhere in
the data — so the honest version shows **today's deviation vs the 0.5°C alert threshold** plus
**nights of baseline behind it**, not a fabricated absolute average. The raw
`temperatureDeviation`/`temperatureBaselineDays` values were already computed inside
`computeAiDynamicNextSession` but never threaded into `NextSessionRecommendation.signals` — pure
plumbing fix, no new computation. Also promoted the inline `0.5` magic number to a named
`TEMP_ALERT_THRESHOLD_C` constant alongside `TEMP_BASELINE_MIN_DAYS`, and sent the threshold value
itself over the wire (`signals.temperatureAlertThresholdC`) rather than having the client import
`ai-dynamic.ts` directly — that module pulls in the daytime-stress dHRV inference chain, which has
no business in a client bundle. Verified end-to-end against `pnpm dev`: seeded a
`oura_daily_summary` row (`tempDevC=0.7`, `nHistory=35`) and temporarily flipped the local seed
program to `ai_dynamic` mode (the seed defaults to `manual`, so this path can't fire otherwise),
confirmed the expandable rendered "+0.7°C above your baseline (threshold 0.5°C) — based on 35
nights of history" matching the seeded values exactly, in both light and dark themes, then reverted
the program back to `manual` and removed the seeded row. The plan's open product question — whether
the sub-30-day "baseline still maturing" state should surface anything today (currently silent) —
needs an owner decision this session had no channel to get; split off as **Q-105-followup**.

**🆕 2026-08-07 — home "Recommended Today" card no longer gets stuck on "Last: —" (Q-106,
v1.267.15).** Owner-reported: the Legs card showed "Last: —" despite a 62-day streak and other
sessions already showing completed that same week. Same bug family as Q-89 and Q-91, a third
independent site: `memo`'d `RecommendationCard` read `workout-card:<id>` synchronously inside
`lastSessionDay()`, but none of its props changed when the `workout-data:all` batch actually
populated that cache key (the batch only calls `setCached`, a side effect outside React state) —
a card whose first render landed before the batch resolved stayed frozen on `"—"` for the rest of
the visit. Fixed with the same `dataEpoch`-style counter Q-89 used: a new `workoutCardEpoch` state
in `session-select-content.tsx`, bumped every time the batch's `onData` callback runs, passed as a
prop and wired into a new `useMemo` around the `lastSessionDay()` call so the memo recomputes once
the cache is actually populated. Also fixed the independent code smell the same backlog entry
flagged: `lastSessionDay()` looked its session up by **name** against `activeSessions` even though
the caller already held the full session object with a real `id` — the exact "session identity =
DB id, not name" anti-pattern the Standing Instructions call out. It now takes `sessionId` directly.
Verified via Playwright against a cold cache (fresh browser context, no persisted cache): the card
read "Last: —" at t+1s and correctly updated to "Last: Sun" by t+2s and stayed correct thereafter,
reproducing the exact race and confirming the fix closes it. The local seed's mood-checkin gate
(the "Recommended Today" card only renders once today's mood is logged) meant a mood log had to be
seeded directly into the local dev DB to reach the card at all — removed afterward.

**🆕 2026-08-07 — Body Battery chart's right-edge time label no longer falsely claims "now"
(Q-108, v1.267.14).** Owner asked whether a low-sample-count reading was accurate and suspected
Home doesn't refresh. Two separate findings: (1) working-as-intended — Home's `body-battery` fetch
only re-runs on mount/tab-revisit/pull-to-sync/BLE-sync-settle, no polling, so a long-open tab
genuinely shows stale data; (2) the actual bug — `DayChart`'s right-edge axis label
(`body-battery-card.tsx`) was a hardcoded literal `"now"` string, unrelated to the real last-sample
time, so a stale card actively claimed to be current instead of just failing to update. Fixed by
deriving the label from the last series point's timestamp with the same `fmtAest` formatter already
used for the left (wake-time) label, symmetric with it and requiring no client-side `Date.now()`
comparison (so no hydration-mismatch risk). Verified visually in the local dev server: seeded 37
synthetic HR samples for today into `oura_heartrate` to make the chart render (the local seed
otherwise has no HR data for "today", so this path is untestable via a cold seed), confirmed the
chart showed two real derived clock times instead of "2:09pm"/"now", checked in both light and dark
themes via Playwright, then deleted the synthetic rows. Checked against production
(`claude_ro.sleep_sessions`) beforehand: the wake-time anchor itself is correctly computed from a
real recorded sleep-end — no evidence of a wake-time bug, only the label's false freshness claim.
The existing "Limited data" / low-sample disclaimer is intentional (Q-57) and untouched.

**🆕 2026-08-07 — manual Home "Deload" now actually reduces prescribed load on AI-dynamic sessions
(Q-109, v1.267.13).** Root cause: `buildWorkoutExercises` applied the AI-dynamic prescription's
stored numbers unconditionally once `aiDrivesLoad` was true, with no reference to the `aiDeload`
flag Home's manual Deload choice sets — the flag only ever touched cosmetic/logging metadata (phase
banner, `intensityMode` tag, PR suppression), never the actual weight/reps/rest. Fixed by adding an
`else if (aiDeload)` branch that applies `deloadOverrideForGoal(trainingGoal)` — the same tuned
`DELOAD_LOWER_PCT`/`DELOAD_REPS`/`DELOAD_SETS`/`DELOAD_REST` constants the automatic per-exercise
engine already uses — skipped when the exercise is already auto-deloaded so the two don't compound;
`preDeloadStyle`/`preDeloadSets` are populated so the existing revert-to-full-weights UI
(`DeloadInfoSheet`) still works. Composes automatically with this session's earlier Q-115 1RM-gate
fix: setting `deloaded = true` extends the existing `exerciseDeloaded` payload flag, so manually
deloaded sets are excluded from PR/1RM credit with no additional server-side wiring. **Not
device/live-API verified** — the local seed program is `phase_mode='manual'`, not `ai_dynamic`, so
this path couldn't be exercised via a live `pnpm dev` + API call; verified instead with a direct unit
test against the pure `buildWorkoutExercises` function (5 cases: unaffected normal session, correct
override values, revert-UI compatibility, non-compounding with an already-auto-deloaded exercise,
goal-specific override). The owner's separate request to move the Deload toggle off Home onto the
pre-workout screen was split into Q-109-followup and **has since shipped** (v1.270.28, see the entry
at the top of this file). Full detail:
[`docs/overview/history-2026-08-07.md`](history-2026-08-07.md).

**🆕 2026-08-07 — the sore-muscle check-in warns before a whole-session deload, not just a narrow
one (Q-115-followup, v1.267.12).** Split off from Q-115 after its 1RM-inflation half shipped.
`SoreMusclePicker`'s overlap banner always said "those exercises will be lightened," even when
`computePerExerciseDeload` was about to escalate to a whole-session deload (>50% of the session's
exercises matched on a sore muscle's main-role assignment) — directly observed causing 4 of 5
exercises in a real session to flag false "Personal Records" (the other half of Q-115). Fixed by
threading real per-exercise muscle-role data through: `/api/next-session` now also returns
`muscleAssignmentsByExercise` (from the same `getExerciseMuscleAssignments()` the server's real
computation already uses), and `SoreMusclePicker` calls the shared `computePerExerciseDeload`
directly to predict the escalation and switch banner text — reusing the exact server logic instead
of re-deriving it. Verified with Playwright in both themes against the seeded 3-exercise Push
session: selecting 2 of 3 exercises' sore muscles correctly showed the whole-session warning;
deselecting back to 1 correctly reverted to the narrow phrasing. Full detail:
[`docs/overview/history-2026-08-07.md`](history-2026-08-07.md).

**🆕 2026-08-07 — Morning Check-in stops score-based pre-filling; Motivation replaced with an
illness/context flag (Q-113, v1.267.11).** Root cause: `prefillMorningScales()` seeded
`perceivedRecovery`/`sleepQualityFeel` from `scoreToScale(readiness/sleepScore)`, so the sheet
opened already positioned at a score-derived guess — an unedited Save stored that guess as if it
were independent self-report, which is why Recovery felt redundant with Readiness and why
`battery-recovery-calibration.ts`'s published `r=−0.414` correlation was uncertain (partial
circularity, since Body Battery itself anchors from Readiness). Fixed by defaulting both scales to
a neutral 3 (not score-derived) and adding persisted `perceivedRecoveryTouched`/
`sleepQualityFeelTouched` columns (migration 169) so future calibration work can filter to
genuinely-edited rows rather than guessing. `prefillMorningScales()` and its dedicated tests were
removed (fully unused after this). "Motivation to train" (confirmed zero calibration/gating use
anywhere in the codebase) is replaced with a single-select "Anything going on?" chip picker (Feeling
sick / Alcohol last night / Travel or poor sleep environment) — `illnessContext: 'sick'` now feeds
the SAME deterministic `selfReportedSick` signal the mood check-in's `bodyState` already fed,
extracted into one shared `resolveSelfReportedSick()` helper used at all three sites that computed
it (`signals.ts`'s full aggregation, the ai_dynamic home-recommendation path, and the same-day
`reevaluatePrescriptionForToday` path) — previously each computed it slightly differently, all now
consistent. `reevaluationKey()`'s fingerprint now also includes the Morning Check-in's own
`updatedAt`/`illnessContext`, so filling in "sick" after the mood log was already cached still
triggers the same-day re-evaluation instead of being silently skipped. Threaded the two new touched
flags + illness context through the full offline-first chain (Postgres schema/adapter, local SQLite
reconcile-delivered columns, sync-engine mapping, outbox validation schema) per the sync-mirroring
rule. Verified via a real `POST`/`GET /api/day-checkin` round trip against the local seeded DB with
all three new fields, and the full test suite (403 files / 3,187 tests, including new coverage for
`resolveSelfReportedSick` and the extended `reevaluationKey`). **Not exercised:** the auto-prompt
sheet itself couldn't be visually confirmed in the Playwright sandbox — the same "no existing
checkin" auto-open behaviour also doesn't fire on unmodified `main` in this environment, confirming
a pre-existing sandbox/dev-server limitation rather than a regression, but it means the actual
on-screen chip picker and neutral-default sliders were verified by code review and the underlying
data flow, not a live screenshot. No on-device S25 verification — JS-only, no native/safe-area
involvement. Full detail:
[`docs/overview/history-2026-08-07.md`](history-2026-08-07.md).

**🆕 2026-08-07 — Running screen carousel gets per-type imagery, Skip button removed
(Q-98-followup, v1.267.10).** A scoped subset of the owner's suggested redesign: each carousel
slide now shows a themed icon + HR-zone-coloured badge (reusing the existing `HR_ZONE_META`
palette, not new illustration assets), and the separate Skip button/`markRun` machinery is gone —
swiping to a different type already resets status via the existing `applyOverride` path, so
there's no longer a distinct "I don't want this" action. Confirmed by grep that nothing else reads
`status === 'skipped'` as meaningful (stats/streaks only filter for `'completed'`), so removing it
was safe. **Deliberately did not** fold Start into every slide or eliminate `PrescribedRunCard` —
that panel carries content (AI rationale, gate-softening warnings, Push badge) that doesn't map
cleanly onto a small carousel slide, and duplicating a Start button per-slide alongside a
persistent external one would be redundant. Kept one external Start button driven by whichever
slide is currently showing. Full detail:
[`docs/overview/history-2026-08-04.md`](history-2026-08-04.md).

**🆕 2026-08-07 — deloaded sets no longer inflate the 1RM estimate or mint bogus PRs (Q-115,
v1.267.9).** `prescriptionStyleForExercise()` unconditionally set `useFor1rm: true` on every
prescribed set regardless of `presc.deloaded`, so a deliberately submaximal deload set ran through
the 1RM formula as if it were a genuine top set — confirmed against the owner's own report (Incline
Bench Press: 78.75kg → false 85.75kg PR off two 42.5kg sets). **The naive fix wasn't enough on its
own**: `calculate1RM`'s own fallback treats "every set marked `useFor1rm: false`" as "no preference,
use them all" (needed by other real styles like "General") — so simply flipping the flag to `false`
for a deload would have silently kept inflating the estimate. The real fix adds an unambiguous
`deloaded` option to the shared `estimateOneRm()` (`packages/shared/src/1rm.ts`) that short-circuits
to a zero estimate, wired at both the client (`workout-screen.tsx`) and server
(`log-exercise.ts`) call sites — zero is already safely ignored by `resolveWorkingBasis()` (filters
`v > 0`) and `shouldCountTowardPr()` (`<= 0` gate), so a deload never corrupts a future prescription.
Also stamped `deloaded: true` at construction in `buildWholeSessionDeloadPrescription`, closing a
second gap the owner's follow-up report surfaced: a whole-session AI deload (>50% of exercises sore)
never set the per-exercise flag at all, so it bypassed **every** downstream gate — confirmed via a
read-only production query that this had already written 4 bogus PRs on 2026-08-06, corrected in the
same PR by a scoped, idempotent migration (`168_q115_whole_session_deload_pr_correction.sql`) after
explicit confirmation. The static-progression-style deload phase was checked and is already
correctly configured (`use_for_1rm: false` on every deload-phase style set in production) — no bug
there. Verified via a real `POST /api/log-exercise` against the local seeded DB with the owner's
exact reported numbers (estimated1rm: 0, isPR: false) and a control case with genuine working sets
(estimated1rm: 79, isPR: true, unaffected). The sore-muscle-picker's "will be lightened" banner
still doesn't account for the whole-session escalation — split off as **Q-115-followup** (needs
per-exercise muscle-role data threaded through several component layers, out of scope for this fix).
Full detail: [`docs/overview/history-2026-08-04.md`](history-2026-08-04.md).

**🆕 2026-08-07 — the "Today's Timeline" wakeup/sleep cards are tappable → that night's sleep
detail (Q-93-followup sleep half, v1.267.8).** The blocker that scoped these out of Q-93 was real
for `/health/sleep` (`SleepContent` has no date-selection UI) but not fatal — `HealthMetricSheet`'s
existing sleep sheet already renders full per-night detail for any of the last 14 nights via a
list/detail toggle. Deep-linked into it instead of building a new screen: the "Woke up"/"Fell
asleep" cards now navigate to `/health?tab=body&openSleepDate=YYYY-MM-DD`, which pre-selects that
night. Wired on both timeline renderers. Verified with Playwright in both themes by driving the
`?openSleepDate=` URL directly (seed data has no sleep session recent enough for a live "Woke up"
card to render today) — confirmed the sheet opens straight to that night's stage breakdown, not the
list. The workout card remains unwired — it needs a historical HR-chart/exercise-detail screen that
doesn't exist yet at all; Q-93-followup's backlog entry is scoped down to just that piece. Full
detail: [`docs/overview/history-2026-08-07.md`](history-2026-08-07.md).

**🆕 2026-08-06 — Running-plan overrides now write through the local store, fixing a real
APK-only skip-then-dead-end bug (Q-98 bug-fix half, v1.267.7). ⚠️ NOT device-verified.**
`applyOverride` (swipe-to-pick-a-different-run-type, after skipping) only did a bare `fetch`,
unlike `markRun` which writes through the local store + outbox — so on a device with a real local
store, the screen's local-first status effect re-read the stale `'skipped'` row `markRun` left
behind and clobbered the optimistic `'pending'` reset back to skipped, permanently. Invisible on
web (`getLocalStore()` returns `null` there), which is why it survived past `pnpm dev` testing
until an owner hit it on the APK. Fixed by writing the override response through
`store.upsertPrescribedRun(...)` as `synced` (the server already has it via the POST that produced
it). **The failing path is structurally unreachable in this sandbox — no native SQLite here — so
the actual fix has not been exercised on a real device.** Verified only that the web path
(unaffected by this change, since the new code never runs there) still works correctly with no
regressions. Needs a real on-device swipe-to-pick-a-different-run-type check before this can be
marked confirmed. The redesign half of Q-98 (per-run-type imagery, folding Start into carousel
slides) was not attempted — split off as **Q-98-followup** in the backlog. Full detail:
[`docs/overview/history-2026-08-04.md`](history-2026-08-04.md).

**🆕 2026-08-06 — Guided Walk's preset picker is now Long / Short / Custom (Q-99, v1.267.6).**
Content/state change only — the carousel mechanics were already shared with the Running screen and
needed no rebuild; the Workout-tab-style visual richness (palette/imagery) stays explicitly out of
scope. Relabeled Standard→Long, Quick→Short (values unchanged), added a persisted `customConfig` to
`guided-walk-store.ts`, and fixed the pre-existing bug where an edited stepper silently kept
claiming "Long selected" instead of showing Custom. Two real bugs found and fixed during
implementation, not just at review: (1) `DEFAULT_WALK_CONFIG`'s numbers are identical to Long's, so
a naive "apply default and let content-derivation take over" approach snapped straight back to Long
the instant Custom was selected — fixed by tracking the selected slide as real state, not a pure
content derivation; (2) the autosave initially only wrote `customConfig` on a *subsequent* edit
after the flip-to-custom, leaving the Custom slide's own preview text stale until a second stepper
touch — fixed by saving in the same effect pass that detects the flip. Both caught by an actual
Playwright screenshot, not by reasoning about the code. Full detail:
[`docs/overview/history-2026-08-04.md`](history-2026-08-04.md).

**🆕 2026-08-06 — Zone 1 minutes now get lazy-day credit on the Cardiovascular screen (Q-88,
v1.267.5).** Reopens D-10 (`docs/superpowers/specs/2026-07-26-cardio-system-spec.md:60-82`) without
overturning it: Zone 1 stays excluded from both the weekly training quota and the Activity Score's
active minutes exactly as before — the owner's ask was the inverse of D-10's original concern (a
"you still moved" signal, not training credit). Shipped as a new, separate card
(`components/cardio/lazy-day-credit-card.tsx`) shown only on days with no dedicated workout or
logged cardio/guided-walk session, reusing the existing lightweight `getDayExerciseNames()`
"trained today" check plus a same-day `listActivityLogs()` read — `GET /api/cardio-week` gained a
`trainedToday` boolean, no new zone-minutes query needed since `dayQuota` already carries the Zone 1
row. Verified with Playwright against seeded local HR data in both themes: card renders with a real
Zone 1 minute count on a no-workout day, disappears the moment a workout is logged that day. Full
detail: [`docs/overview/history-2026-08-04.md`](history-2026-08-04.md).

**🆕 2026-08-06 — the pre-workout header refresh button no longer flashes "done" mid-generation
(Q-86, v1.267.3).** Not a caching bug — the duration-preset switch correctly forces a real,
uncached LLM regeneration; the bug was that the header refresh button's spin/disabled state was
bound only to its own unrelated re-fetch (workout-data + periodization status), which resolves
from cache almost instantly. Now bound to `prescriptionPending` too (the same flag already driving
the "Preparing your AI workout…" heading), so it stays visibly busy and disabled for the whole
generation window and can't fire a redundant request mid-flight. Verified against a real seeded
`ai_dynamic` prescription with the actual `/prescribe` call intercepted and delayed (no LLM key
configured in this sandbox), confirming the disabled/spin state holds via direct DOM attribute
checks, not just a screenshot. Full detail:
[`docs/overview/history-2026-08-04.md`](history-2026-08-04.md).

**🆕 2026-08-06 — the exercise-summary/rest screen shows what's up next (Q-87, v1.267.2).** Cheap,
traced to source — `effectiveExercises[store.currentIdx + 1]` at the exact call site that already
builds the committed summary object, and the planned starting weight reuses
`computeInitialWeights()`, the same formula the set actually opens with (not the pre-workout
screen's "last time" line, which is last-*logged* weight and can read differently). Renders an "Up
Next" card between the rest timer and the sets table; `null` at the last exercise of a session, no
broken/empty state. Verified end-to-end with a real Playwright run through the actual Log Set /
rest-skip UI against seeded local data, in both themes. Full detail:
[`docs/overview/history-2026-08-04.md`](history-2026-08-04.md).

**🆕 2026-08-06 — the Sleep screen gains phase-hours/bedtime/wake-time trend charts + skin
temperature (Q-90, v1.267.1).** The plan flagged one real ambiguity — "toggle between, or
combine" — needing a decision before building; resolved as a segmented control (the app's
existing `SegmentedTabs` pill-tab primitive) over one shared chart area switching between Sleep
Stages / Bedtime / Wake Time, with skin temperature as its own always-visible card (a separate ask
in the report's own phrasing). Bedtime plots on the noon-shifted axis (`minutesFromNoon`, already
used by this screen's consistency card) to avoid the midnight-wrap trap this domain has hit
before — covered by 8 new unit tests. `extraCards`'s signature grew an additive third `trends`
argument (Readiness/Activity unaffected). Caught a real bug during visual verification: the new
stacked-bar chart's legend didn't render at all because chart.js's `Legend` plugin was never
registered — fixed before merge, a reminder that a clean typecheck/lint/test pass doesn't catch a
silently-missing chart.js plugin registration.

**🆕 2026-08-06 — Sleep Score gets an awake-time fragmentation cap, decided live against a real
disrupted night (v1.267.0).** Owner reported a work-call-disrupted night scoring 89 "High" — traced
to the exact Q-72 finding (score barely uses its range) plus the specific mechanism: normal
duration/HRV/HR/timing diluted the small efficiency/restfulness hit from fragmentation. Owner
explicitly ruled out wiring `sleep_quality_feel` into the score (Q-102's direction — wants it kept
independent for backlog calibration, reversing nothing) and asked for an objective awake-time/
fragmentation criterion instead. Two false starts before the shipped design: (1) reweighting +
steepening existing curves moved the target night but didn't generalise and barely touched the
feel-correlation; (2) `restlessPeriods` (ring wake-event count) was tried as the driving signal and
rejected — production data showed the SAME value (4) on both the disrupted night and the single
best-rated night of the prior month, i.e. it's noise for this ring, not a separator. What shipped:
`sleep-score.ts` adds a STANDALONE cap (not another weighted contributor) — `min(weightedScore,
awakeFractionCap(z))` — keyed on how many personal standard deviations this night's awake-time
fraction sits above the sleeper's own trailing mean (`SLEEP_AWAKE_FRACTION_BASELINE_MIN_NIGHTS =
14` prior main sleeps before it evaluates at all, same opt-in-baseline pattern as `hrv`/`hr`/
`schedule`). Backtested against the real function and the full 53-night production history (not a
reimplementation): correctly fires on genuine outliers already in the data (2026-07-11, z=3.00,
76→32; 07-04, z=1.88, 86→76) and does nothing to the other 51 nights, including every clean one —
confirms the "never lowers the ceiling" design goal held. **One honesty note for whoever reads this
next:** the specific night that motivated this (2026-08-06) was re-queried mid-session and its
`awake_hours` had been revised downward by the live BLE rollup (1.92h → 1.17h) between the first and
final read — under the corrected numbers that particular night's z-score (0.99) falls just short of
the cap threshold. The mechanism is correct and proven on other real nights; this specific night
just turned out milder than the ring's still-catching-up numbers first suggested. Full detail:
[`docs/overview/history-2026-08-04.md`](history-2026-08-04.md).

**🆕 2026-08-06 — the sleep hypnogram no longer looks "stuck missing" after a sync/redecode
(Q-91, v1.266.11).** Measured production first: no recent night was actually missing hypnogram
data. The real bug was a missing reactive refetch — `invalidateOuraSync()` correctly clears the
`'sleep-sessions'` cache after a BLE drain settles or a Redecode, but nothing told an
already-mounted sleep screen to refetch, so the fix was invisible until the next navigate-away/
remount. Traced wider than the plan itself found: `session-select-content.tsx` was the only
`ta:oura-ble-synced` listener in the app, but even its own handler didn't refetch this cache key.
All three readers (`sleep-content.tsx`, `health-content.tsx`, `session-select-content.tsx`) now
refetch on that event. Verified end-to-end with Playwright: updated a row and dispatched the real
event without navigating away, watched the hypnogram appear live. The ingest rollup's own
missing invalidation signal is deferred as `docs/implementation-backlog.md` Q-91-followup — it
needs a scoped design to avoid reintroducing a latency risk the plan flagged.

**🆕 2026-08-06 — the home HR-today chart is smoother, with an opt-in dashed backfill across gaps
(Q-92, v1.266.10).** The bucket width behind the line was already tunable math (`bucketAverage`,
shared with two other charts), just hardcoded at 5 min — promoted to a `bucketMinutes` prop,
defaulted to 10. Added a new pure function, `interpolateGaps`, as a sibling to the existing
`withGapBreaks` (untouched — the real line still shows an honest break at every gap); it produces
a second, separate chart.js dataset that linearly bridges 20min–2h gaps only, rendered dashed in a
distinct scheme-aware color with its own legend entry. Wired on (`showBackfill`) only at the home
widget that was reported — the other three chart consumers keep the smoother bucket, no backfill.
Verified visually in both themes against seeded real-gap data.

**🆕 2026-08-06 — the "Today's Timeline" meal card is tappable → jumps to that day's food log
(Q-93, v1.266.9).** Scoped down from the full Q-93 ask after finding the plan's premise wrong:
the sleep-card destination (`/health/sleep`) has no date-selection UI at all (always shows the
latest night), and the workout-card destination needs a historical HR-chart/exercise-detail screen
that doesn't exist yet — wiring either today would land on a misleading or nonexistent screen.
Shipped only the meal card, on both timeline renderers (home + `/health/timeline`), navigating to
`/nutrition?date=YYYY-MM-DD` using a new `date` field on `TimelineEvent`. Verified end-to-end via
`pnpm dev` + a headless Playwright click. Remaining sleep/workout wiring filed as
`docs/implementation-backlog.md` Q-93-followup with the concrete screen work each needs.

**🆕 2026-08-05 — the Workout tab's "already trained today" state gets a full-width banner (Q-97,
v1.266.8).** Follow-up to Q-89: the underlying state was now correct/timely, but the indication
itself — a faint ring, a 12px icon+text line, a softened button — was too easy to miss. A dedicated
"Completed Today" banner (larger icon, bold text, tinted background) now sits between the session
header and the muscle diagram. Icon+text pairing kept (never colour-only); "Start Again" stays
reachable underneath, unchanged.

**🆕 2026-08-05 — the Workout tab card shows "trained today" immediately, not after a tab revisit
(Q-89, v1.266.7).** Every relevant cache key genuinely was invalidated correctly — the defect was a
stale `useMemo` local to `WorkoutSelectContent`: its `getLastTrainedLabel` callback reads
`workout-card:<id>` from cache directly rather than taking it as an argument, and the
post-completion refresh only bumped a discarded `forceUpdate` counter, never changing
`currentSession`'s object reference, so the memo never recomputed on the same mount. Captured the
counter's value and added it to the memo's deps.

**🆕 2026-08-05 — auto-activity-detection no longer double-logs during a Guided Walk or manual
activity (Q-95, v1.266.6).** `dispatchGate()` already suppressed the passive walk/run trigger
while a lifting workout was active (`isWorkoutInProgress`) — a Guided Walk is the identical case,
but the service never checked the equivalent, already-existing `isGuidedWalkActive` predicate.
Added it, plus a sibling gap found in passing (`isActivityActive` for the manual "Other Activity"
flow). No new plumbing — both predicates already existed and were already used elsewhere for
nav-away guards. Verified via a new test suite proving the composed suppression condition with the
real predicates, since `dispatchGate()` itself isn't exported and GPS/motion triggers aren't
reproducible in the sandbox.

**🆕 2026-08-05 — a Guided Walk shows as "Guided Walk" on the timeline, not "Outdoor walking"
(Q-94, v1.266.5).** The distinguishing data (a guided walk's `segments` column, only it ever
populates) already reached `day-timeline/route.ts` intact — a keyword-collapse step there flattened
every walk to a bare `"Walk"` before display. Checked `segments != null` before that collapse;
both display surfaces (the home timeline card, the separate `/health/timeline` page) already fall
through to rendering the title verbatim for anything that isn't literally "Run"/"Walk", so no other
changes were needed. Reproduced against real seeded data: a guided walk and a plain walk on the
same day were indistinguishable before, correctly labeled after.

**🆕 2026-08-05 — "Burned" and "Balance" now use the correct active-energy source (Q-96,
v1.266.4).** Owner report: Body tab "Burned" read 0 kcal despite a logged workout + guided walk;
"Balance" never showed real data. Both read `calsBurnedToday`, a bare sum of
`activity_logs.caloriesBurned` that a Guided Walk always writes null and lifting workouts never
touch at all — not a data bug, a source bug. `computeActiveEnergy()` already computes the correct
figure (BMR-adjacent + workout + walk/run + steps) and already feeds the separate, working
`EnergyBudgetCard`; swapped both broken cards onto it, per "One Formula, One Place." Sibling-surface
check found two more genuine siblings sharing the same broken concept (the home nutrition-donut
boost, the nutrition macro-ring "+N from cardio" label) and fixed those too. Also relaxed
`useEnergyBalance`'s stricter all-or-nothing null gate to match `useEnergyBudget`'s (no food logged
yet isn't missing data). Reproduced end-to-end against `pnpm dev`: seeded a completed workout + a
null-calorie guided walk, confirmed `calsBurnedToday: 0` (broken) vs `activeEnergyKcalToday: 402`
(correct, now what every UI consumer reads).

**🆕 2026-08-05 — no more visible scrollbar chrome on cardio and its siblings (Q-100, v1.266.3).**
Owner report: a scrollbar shows on the cardio page's right edge. The app already had a
scrollbar-hiding utility (in fact two near-identical ones, now consolidated to one) applied at only
two places app-wide. Sibling-surface sweep found the same bare `overflow-y-auto` pattern on five
more top-level screens plus a shared component (`components/pull-to-sync.tsx`) three more screens
route through — fixed centrally there rather than patching each caller. Confirmed via real SSR that
both the raw-div fix (cardio) and the shared-component fix (session-select/home) render the class
correctly; the client-only tab screens aren't in SSR output to check the same way, so those are the
identical, type-checked mechanical edit extended with confidence rather than individually
screenshotted. **Not exercised:** on-device confirmation that the reported native scrollbar chrome
is actually gone (WebView can render differently from the sandbox) — the fix is inert wherever a
screen never showed one.

**🆕 2026-08-05 — the sleep list no longer shows onset latency as if it were bedtime (Q-101,
v1.266.2).** Owner report: bedtimes looked pushed back from the usual ~10-10:30pm. Root cause: three
surfaces (the sleep list, its detail header, the Body-tab sleep card) displayed an onset-trimmed
start time instead of the raw `sleepStart` — matching `sleep_start + onset_latency_sec` to the
minute, not a data bug. Two other surfaces (the Hypnogram ribbon, the day-timeline "Fell asleep"
card) already showed raw bedtime with latency called out separately, which is the pattern that
matches how the owner reads "bedtime." Standardized the three disagreeing sites on it — latency is
now shown as `· Nm latency` alongside the time range instead of being folded in.

**🆕 2026-08-05 — per-set/per-workout HR attribution no longer depends on opening the recap (Q-11
Defect B, v1.266.1).** A session that was finished and never revisited got zero HR detail forever —
the recap fetch was the only trigger. `POST /api/complete-workout` now fires a best-effort
fire-and-forget compute at completion (closes it outright for a live chest strap), and the two
backfill work-lists are now coverage-aware so an Oura-ring-only session (no data yet at completion)
still gets picked up once the ring drains and a backfill pass runs — the trap a naive
"just compute at completion" fix would have walked straight into. Verified end-to-end against
`pnpm dev`, no mocks. The device-side coverage-quality question (large share of `coverage_ok=false`)
is unrelated and left for a fresh re-measurement.

**🆕 2026-08-05 — a shortened session no longer over-charges warmup (Q-83, v1.266.0).** Once a
measured warmup median is learned, it was subtracted whole from whichever preset budget was chosen,
so the same 9 minutes cost Quick 30% of its budget and Normal 15%. It is now capped at 20% of the
budget — but **only when today's budget is below the session's own configured length**, which is the
only case where the double-charge exists; a session genuinely configured at 30 minutes keeps its
measured value, because there 9 minutes really is 30% of it. Measured through the real prescribe
route: Quick went from 2 dropped exercises / 11 min estimated to 1 dropped / 22 min, standard and
long byte-identical. **The warmup was not the dominant cost, though** — the trimmer's exercise-count
thresholds are ~6–7 min apart and this recovers 3, so it crossed one on the owner's session and
often will not. Rest, not warmup, dominates a short budget (~12 of a main lift's 19 minutes), filed
as **Q-85**.

**🆕 2026-08-05 — guided-walk summaries show cadence, and show it first (Q-84, v1.265.0).** Owner
report. Nothing new is captured: cadence was already live on the walk screen, computed per interval
and persisted — `aggregateSegmentsByKind` just read past it, so three render sites had nothing to
show. Cadence now leads the fast/slow cards, the per-interval rows and the history card, falling back
to pace when no strap was connected. `walkEffortDisplay()` owns that choice so the three sites can't
drift. **Queue note:** Q-71 and Q-73 were skipped as ⛔ blocked (owner decision on a ~5-min sleep-time
shift; a device capture for the hydration error) and annotated in the backlog — next ready is Q-83.

**🆕 2026-08-05 — Body Battery is checked against subjective recovery (Q-79, v1.264.0), and the
data-analysis review batch Q-75…Q-79 is closed.** An admin panel under Day Review, beside the Sleep
Score calibration and sharing its engine and card. **The pairing was measured rather than assumed,
and the assumption was wrong:** the causally appealing "you report it the next morning" lag finds
nothing (r = +0.115, p = 0.52); only same-date reproduces the review's r = −0.400. Shipping the lag
would have rendered a flat panel that read as the model failing. Negative r is agreement —
`perceivedRecovery` stores 1 = fully recovered … 5 = wrecked.

**🆕 2026-08-05 — HRV vs training volume is on screen (Q-78, v1.263.0).** Overnight HRV → same-day
tonnage, r|t = **+0.495, p = 0.006, n = 30**; split at the median, **4,376 kg vs 5,799 kg — a 33 %
difference**. The signal was already being scored by `recovery-vs-strength`, just against mean 1RM
percent rather than volume, which is where the response actually shows. HRV is coded as percent of a
28-day baseline (a raw-ms boundary is a fact about one ring) and tonnage is summed **per day**, since
two sessions share one overnight reading. **Nothing acts on it** — n = 30 does not survive Bonferroni,
so the entry's "candidate input to the prescription engine" was deliberately left unbuilt until n ≥ 60.

**🆕 2026-08-05 — the bedtime-cost trend is live (Q-77, v1.262.0).** A **Bedtime vs sleep** view on
the Health screen, carrying the strongest relationship in the dataset: **−0.70 h of sleep per hour
later to bed** (r|t = −0.534, p < 0.001, n = 52), the only finding in the review that survives
Bonferroni. Built on Q-76's `nightSessions()` and Q-75's significance gate, so it inherits both with
no new code. The trap it guards is the encoding, not the statistics — a raw clock hour wraps at
midnight and reverses the finding to r = +0.75; the route test flips to that coding and asserts red,
reproducing +0.768. Deep sleep (p = 0.038) was deliberately not built.

**🆕 2026-08-05 — sleep analysis counts nights instead of rows (Q-76, v1.261.0).** Eleven read sites
treated one `sleep_sessions` row as one night. Production holds **66 rows for 54 nights**, so **7 of
the 54 dates fed the wrong duration into the sleep-vs-performance correlation** — six by ~8 h
(2026-07-04 read as 0.11 h, not 8.22 h), and the one genuinely split night as 4.02 h, not 6.55 h.
The fix routes them all through the existing `nightSessions()`; the new predicate the backlog entry
proposed was **not** built, because the shared helper already did both halves. Four sites stay on raw
rows on purpose. Two nights (2026-06-01, 2026-06-04) and the 2026-06-02/03 gap remain unrecoverable
at read time — see Known Issues.

**🆕 2026-08-05 — two owner-reported gaps triaged and queued, not yet built (Q-83, Q-84).**
Docs-only planning session. **Q-83:** a 30-min "Quick" session preset was prescribing only 2
exercises because the measured per-lifter warmup carve-out is a fixed absolute minute count that
doesn't scale down with a shorter preset — Quick loses 30% of its budget to warmup vs Normal's 15%
and Long's 10%, for the identical learned warmup value. **Q-84:** the guided-walk summary shows
pace, not cadence, for fast/slow intervals — cadence is already computed per interval and
persisted, it's just dropped at the fast/slow rollup and never rendered. Plans + backlog entries:
[`docs/overview/history-2026-08-04.md`](history-2026-08-04.md).
**Renumbered from Q-75/Q-76** — a same-day PR (#1078) claimed those numbers first for an unrelated
data-analysis review, below.

**🆕 2026-08-05 — the recorded data was reviewed for what else it can tell us, and the review's main
finding is about our own method (docs only, Q-75…Q-79 queued).** A 110-day, 64-column daily matrix
pulled from production and analysed with two controls the app does not apply: a **date-trend control**
(overnight HRV correlates with the calendar at **r = 0.79**, so anything else that trends with time
correlates with HRV for free) and exclusion of the **14 of 66 sleep rows under 4 h**. Of the five
strongest raw correlations, **three vanished under the trend control, one was entirely an artefact of
the degenerate rows, and one reversed direction** under correct variable coding — and
`correlationInsight`, which backs all seven `/api/health-trends` views plus
`/api/sleep-performance-correlation`, applies none of those checks (it renders a confident sentence
whenever two buckets of ≥3 points differ by >1 *raw unit*, a unit-blind threshold). Fixing that is
**Q-75** and ranks above every new view. What survived: **later bedtime costs 0.70 h of sleep per
hour** (r|t = −0.534, p < 0.001, n = 52 — Q-77); **overnight HRV predicts same-day volume**, +33 %
across the median (r|t = +0.495, p = 0.006, n = 30 — Q-78); **Body Battery agrees with subjective
recovery** (r|t = −0.414, p = 0.010 — Q-79). Measured and deliberately *not* built: workout time of
day, steps→sleep, bedtime regularity, tonnage→overnight recovery, set-to-set rest→next set. Evidence:
[`docs/reviews/2026-08-05-data-analysis-opportunities.md`](../reviews/2026-08-05-data-analysis-opportunities.md).

**🆕 2026-08-04 — Q-58 is complete (v1.256.3): 30 of the 31 routes that can return a 500 now report
it.** Part 2 covered the 21 routes that caught their own error and returned a 500 silently — the
global hook of part 1 cannot see those, because nothing escapes. Scripted, then every hunk read:
**two routes would have logged a normal duplicate-name 409 as a server fault**, and `log-calendar-
event` a missing calendar grant, so those calls sit past their non-500 branches. The one route left
out returns its 500 from a data-shape guard rather than a catch.

**🆕 2026-08-04 — server errors that escape a route are recorded instead of vanishing (Q-58 part 1,
v1.256.2).** Counting first changed the shape of this item: it was filed as "189 routes need a
one-line edit", but **80** route files have no `catch` at all (a global hook covers them with zero
edits), **31** catch their own error and return a 500 (invisible to any global hook — they need the
explicit call, queued as **Q-58b**), 13 already report, and ~76 have no 500 path at all. Next's
`onRequestError` now writes to `error_events`, deduped 60 s per route+message so a hot loop in a
broken route cannot fill the 1 GB volume. **Verified by actually firing it** — a temporary throwing
route, hit against `pnpm dev`, row read back out of Postgres with path, method, message and stack.

**🆕 2026-08-04 — the “Update available” banner now tracks the APK, not the app version (Q-59,
v1.256.0).** It compared the installed APK against the server's `package.json`, but the APK is a
WebView loading Railway, so nearly every release reaches the phone with no reinstall — it was telling
the owner to reinstall for changes they already had, every release. **The half the plan missed:**
`package.json` was in the Android workflow's path gate, and every release bumps it, so the APK was
being rebuilt and republished on *literally every merge* (last six checked: all one-line version
bumps, none native). There genuinely was a newer APK each time — identical apart from its version
string. `package.json` is out of the gate (dependency changes still trigger via `pnpm-lock.yaml`), and
the card now compares against the newest **published APK**. It can also finally say **“up to
date”**; it used to render nothing, which is what made the owner's install check ambiguous.
**One more install is needed before it goes quiet** — the owner is on ~1.252.x, the newest APK is
1.255.1.

**🆕 2026-08-04 — the step rollup can no longer file readings on days that have not happened
(Q-56, v1.255.1).** Five `body_metrics` rows were written on 2026-07-30 carrying real ring step
counts dated up to five days ahead; all five self-healed as their dates arrived, which is precisely
why the writer still needed fixing. Root cause confirmed against production anchor rows: ring time
runs ~15 minutes ahead of wall time per anchor re-stamp during a drain, and the step path
extrapolated linearly from whichever anchor was newest with no bound in either direction. Now it
resolves against the anchor **nearest each frame**, and anything still landing in the future is
**dropped and re-read on the next pass** rather than stored. **The rest of the rollup — sleep, HR,
temperature — still uses the single-anchor converter**; that is queued as Q-71, deliberately not
folded in.

**🆕 2026-08-04 — navigation speed is now instrumented on the device (v1.255.0).** The question
"does navigation feel slow, and did the prefetch sweep help?" had no measurement behind it at all —
cold start was measured, navigation never was. Every tap that changes the URL now records how long
the new screen took and **whether the route had been prefetched** (`rscCount === 0` = warm), read
out of **More → Admin → Device data capture**. Verified end-to-end in a real browser, including the
query-only `/workout` → `/workout?session=…` transition. **The phone capture itself is still owed** —
until then the prefetch sweep's effect and the Q-1b bundling drop rest on no navigation evidence.

**🆕 2026-08-03 — a phone-call interruption was silently deleting real sleep from the record
(v1.252.8).** Owner-reported: last night's recorded bedtime showed 00:59 instead of the real
~22:32 onset. Root-caused with the production admin endpoints (`day-review` + the `claude_ro`
read-only DB access) down to the actual decoded raw BLE beats: a genuine ~130-min sleep bout
22:32–00:42, a 15-min gap during the calls, then a ~6h40m bout from 00:57 — `denseSensingSpan`'s
comparable-length ratio test (`lib/sleep/sensing-span.ts`) dropped the whole first bout because it
was only ~0.33× the second, reading as a later bedtime with implausibly little awake time instead
of an interrupted night. Fixed: a substantial run within ~1h of an already-kept run is now bridged
in regardless of length ratio — a real interruption sits far under the 2h night-split threshold, so
proximity alone rules out a distant evening-activity burst (which the ratio test still correctly
rejects). Verified against the real decoded beats for the 08-03/04 night. See
[`docs/oura-ble-operations.md`](../oura-ble-operations.md) §1 row I23. **Not yet done:** last
night's own `sleep_sessions` row still carries the wrong (truncated) `sleep_start` — the fix only
changes future rollups; that specific row needs a targeted Redecode/backfill to correct
retroactively.

**🆕 2026-08-03 — seven owner-reported bugs/features triaged and queued (Q-63…Q-69), none
fixed yet.** Workout skip-confirmation, voice logging dead on the APK, PiP missing the rest
countdown on the exercise-summary screen, guided walk needs a treadmill/no-GPS mode, the scale's
persistent "listening" notification, auto walk/run detection still false-positiving (a real gap
distinct from the already-tracked Hz-band calibration issue), and the scale weight trend should use
the day's lowest confirmed reading instead of the first. Full root causes, decisions and a plan per
item in
[`docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md`](../handoff-2026-08-03-cross-owner-bug-batch-triage.md)
and `docs/implementation-backlog.md`. **Renumbered twice** (an original Q-52…Q-58, briefly Q-57…Q-62,
now finally Q-63…Q-69) to resolve two separate collisions: a "per-exercise phase hold" plan already
held Q-52, and the cross-domain bug review below already held Q-53…Q-56 — both landed on `main`
first.

**🆕 2026-08-03 — cross-domain bug review: 5 new findings, all queued (no code changes this
session).** Four review agents (Cache-Control staleness sweep, write-path ownership/offline-sync
mirroring audit, auto-apply/1RM logic deep-dive, production DB integrity checks) plus a direct
production DB audit via the admin read-only endpoint. Full evidence:
[`docs/reviews/2026-08-03-cross-domain-bug-review.md`](../reviews/2026-08-03-cross-domain-bug-review.md).
Highlights: a real `body_metrics` row dated one day in the future (Q-56, part of a 5-row batch from
2026-07-30 — **all five have now self-healed as those dates arrived; the writer has not been
fixed**, and a root-cause lead is recorded on the backlog entry);
two cache-staleness bugs in the phase-transition/prescription flow (Q-53); a prescription-write
race under concurrent triggers (Q-54); a third unfixed instance of the bodyweight-1RM-as-kg bug
(Q-55, following the v1.252.4 fix). Sync-push mirroring and nutrition data integrity both came back
clean. See the Known-Issues entry below for the full list; queued in
`docs/implementation-backlog.md` as Q-53 through Q-56.

**🆕 2026-08-03 — auto-apply never moved the phase, and a prod audit found four session types stuck
in accumulation since late June.** `generatePrescriptionForSession` set `prescriptionStatus =
'auto_applied'` without ever calling `advancePhase`, and auto-apply was gated on `phaseAction ===
'stay'` so a transition could not qualify anyway. Legs/Push/Upper each carried a pending "move to
intensification" for up to a week while their prescriptions were **already written at
intensification loads** (powerbuilding primaries at 82.5–83% against an 80–87.5% band) — Push had
trained them with the stored phase still saying accumulation. Fixed in v1.252.0: a transition
auto-applies only when the model earned it (`canAutoApplyTransition`), deloads and ceiling-forced
transitions still ask, and an auto-applied transition now carries a deterministic evidence-cited
rationale. See
[`docs/overview/history-2026-07-30.md`](history-2026-07-30.md).

**🆕 2026-08-02 — the roadmap was reviewed against the native endpoint, and the public-repo cut moved
to the front of the queue.** Review:
[`docs/reviews/2026-08-02-native-convergence-roadmap-review.md`](../reviews/2026-08-02-native-convergence-roadmap-review.md)
(eight findings; the roadmap converges on a native-*data* app on one device, not on a shippable
product — those are about one unwritten stage apart). Plan and top queue item:
[`docs/superpowers/plans/2026-08-02-public-repo-migration-roadmap.md`](../superpowers/plans/2026-08-02-public-repo-migration-roadmap.md),
backlog **Q-49**. Three things a future session should not re-derive:
- **The private repo has a running daily cost** — `apk-latest` 404s unauthenticated, so
  `/api/download-apk` plus a PAT is the only distribution path and a second user cannot install.
  That is why the cut jumped the queue; **the Q-1 + Q-30 gates on Q-31/Q-32 are released.**
- **The blocker is model *delivery*, not Phase 3.** SleepNet and `step_counter` run server-side
  (`onnxruntime-node`, `adapter.ts:5006`) behind loaders that return `null` on failure, so
  gitignoring them silently kills the hypnogram and ring steps. Owner chose a build-time fetch.
- **One repo, not two.** Stages 6–7 ship Compose and WebView screens in the same APK.

**Untracked risk worth knowing (Q-48 F2):** after Phase 3 bundles the shell, every UI change becomes
a manual sideload and there is **no OTA path in the repo**. The note calling that low-priority
predates the multi-user answer by a day, and Stage 6 is the highest-UI-churn period the app will
have.

**🆕 2026-08-02 — the "Swift feel" push has a target and an order now.** The owner named where the
app actually feels slow: **the home screen and tab navigation**, not the workout screen. That
retargets both live tracks, because Phase 3's own sizing note says it *"will not make navigation
faster"* and Stage 6 ranked the workout screen first. Owner-approved sequence: **Q-51** (split the
1,414-line home component → prefetch the four tab chunks on idle → **profile cold start on the
S25**) → **Q-49** (public repo) → **Stage 3** (device-primary data) → **measure again and decide**
→ Stage 5 → Phase 3 and Compose only if the profile still shows a gap. **Phase 3 (Q-1) is
measurement-gated, not cancelled** — the architecture rationale stands, the urgency waits on
evidence; do not provision the second Railway `api/` service. One thing worth not re-deriving:
`components/shell/tab-shell.tsx:97` renders `SessionSelectContent` for the **`home`** tab, so
Stage 6's *"session select (1,407)"* **is** the home screen.

**In flight — the "Swift feel" performance push (Q-1, issue #868).** Owner-directed and ongoing.
Post-region-move the network side is exhausted (API calls return in 1–25 ms); every remaining win
has come from **device Performance profiles**, not the Network panel. Shipped so far: cache seeding
(#877), SW icon caching (#881, its cached-document half reverted in #891), `/api/oura/stats` no
longer blocking on Oura Cloud (#885), Health fetching one tab instead of three (#897), screen/tab
transitions + the local-store `getWorkoutHistory` N+1 (#904 — corrected 2026-07-30, this previously
misattributed the citation to #906, which shipped separately as the guided-walk status-bar chip,
v1.243.1), the animated wallpaper made
compositable (#909), animations paused in hidden tab panels (v1.240.3), and Capacitor's bridge no
longer logging (and `JSON.stringify`-ing) every plugin call and result — 16.4% of main-thread self
time (v1.240.4), and screen motion moved from an iOS-style horizontal push to Material 3 shared-axis
Y with back animated for the first time (v1.241.0). **Still open:** Phase 3 (bundling the shell into
the APK), which is the owner's
stated app-native architecture. All of the above are sandbox/Chromium-verified only — the profiles
that found them came from the owner's S25, and only the owner can confirm the numbers moved.
**v1.240.4's config half needs an APK rebuild** (`npx cap sync android && ./gradlew assembleDebug`)
to apply at the source; its runtime half applies to the installed APK on the next Railway deploy.

**Phase 3 detail (updated 2026-08-02):** Task 1 decided (bearer token in native secure storage,
owner-confirmed), Task 2's spike run, Task 2b's auth preconditions written, **Task 4 DECIDED —
option B, two apps in a workspace** (owner-delegated 2026-07-30). Task 3 (move auth client-side,
~21 sites) is ready to implement, sequenced around the workspace split (see below) rather than
strictly before or after it. Both adjacent auth fixes are now done — nothing auth-side blocks
Task 3 anymore. See backlog Q-1, the plan's Task 2b/Task 4, and
[`docs/handoff-phase-3-bundled-shell.md`](../handoff-phase-3-bundled-shell.md) (keep until Phase 3
fully lands — carries negative results not recorded elsewhere).

**⚠️ Task 4 Step 3 (the actual `shell/`+`api/` app split) was attempted 2026-07-31 (#952) and broke
production immediately** — the root `build`/`start` scripts deployed `shell/` alone, and its
`/api/*` rewrite fell back to `http://localhost:3001` because the second Railway service for `api/`
was never provisioned, so every API call (including `/api/auth/*`) failed — sign-in broke, site
500'd. Reverted clean within the hour (#962), production confirmed recovered by the owner. **Blocked
on an owner/infra action, not code:** stand up a second Railway service for `api/`, confirm it
serves `/api/**`, and set `API_ORIGIN` in `shell/`'s Railway environment — *before* re-merging. The
branch content itself is already built and tested; nothing needs redoing once the service exists.
Also noted 2026-08-02 (#964): once the split does land, every future shell/UI change becomes a full
APK-rebuild-and-manual-sideload cycle (today's zero-rebuild Railway deploy goes away for the shell)
— there's no OTA/hot-swap path, though the existing in-app update card would keep working as-is.
Not actioned; a low-priority idea if it turns out cheap. See the Phase 3 plan doc's new
"post-split update delivery" note.

**🆕 Open as of 2026-08-02 — the whole Phase-3/Capacitor approach is now in question, not just its
execution.** After watching #952 break production, the owner asked whether Next.js+Capacitor is
even the right architecture at all, given the app is single-user, Android-only (S25 Ultra,
sideloaded, no Play Store, no iOS), and already committed to offline-first — and floated starting
fresh on a new repo if a design change is warranted. This session gave a stress-test-me opinion
(full native rewrite: Kotlin + Jetpack Compose + Room + WorkManager, Postgres/Railway kept only as
a thin sync/AI-proxy backend) but **no decision was made** — see
[`docs/handoff-2026-08-02-platform-offline-architecture-review.md`](../handoff-2026-08-02-platform-offline-architecture-review.md)
for the full reasoning and a ready-to-paste research prompt for a follow-up session to
independently validate or refute it. **This is upstream of Phase 3 and the workspace-split infra
blocker above** — worth resolving before spending the owner's Railway-service-provisioning effort
on an architecture that might be abandoned.

**✅ RESOLVED 2026-08-02 — incremental convergence, not a rewrite.** The owner directed working
through to the native destination following the staged order in
[`docs/superpowers/plans/2026-08-02-native-convergence-goal-layout.md`](../superpowers/plans/2026-08-02-native-convergence-goal-layout.md),
and answered the three inputs the decision hinged on:

- **All ~38 screens are kept** — the one condition that would have re-opened the rewrite case does
  not hold. The research prompt above was **not run**, and is now moot.
- **Local retention is tiered**, from production measurement: raw BLE frames **14-day rolling**
  (~25,200 rows/day ≈ 3.2 MB/day — uncapped this would be ~1.2 GB/yr), decoded per-minute HR
  **1 year** (~38 MB), daily rollups + all logs **uncapped** (~2 MB/yr). ~85–100 MB total.
- **Device-agnostic source tiers are now a written goal** —
  [`docs/device-agnostic-source-architecture.md`](../device-agnostic-source-architecture.md)
  (2026-08-02). The split is **raw-capable sources** (we derive: the ring over BLE) vs **computed
  sources** (the vendor already derived: Health Connect). Health Connect *does* supply full sleep
  stage intervals — verified against the pinned plugin source — so staging and steps for non-Oura
  users are already solved and need no model of ours. Queued as Q-43 (HC first-class tier) and
  Q-44 (remove vendor naming from user-visible copy).
- **Cross-device sync and multi-user are both permanent** — more than one phone over time, plus
  other users with their own accounts. Railway stays a full sync peer and **the ~8,200-line sync
  engine is maintained and extended, not reduced.** (An initial "S25 only" answer was recorded and
  corrected the same day; the proposal to retire peer conflict-resolution is withdrawn.) The D1
  restore-proof check, unrun since #758, is a routine path under multi-device.

Corroborating the call: `@trainingai/shared` (#939/#941) — 348 files, 36,450 lines, 492 importers —
**is live on `main`** and was never reverted; #962 rolled back only #952's `shell/`+`api/` split.
The bulkiest step of the convergence is already done and running in production. **Gate A (Railway
`api/` service) is now the only owner action blocking Stage 2**; Stages 1 and 3 do not depend on it
and Stage 3 (Oura D2 Task 5) is the active work.

**Offline-first consolidation (2026-07-30).** The owner clarified the destination is
device-primary, not just fast: the app works fully offline except AI calls and older/archival data;
Railway keeps the DB for calculated data. This reframes Phase 3 as step one of that migration, not
a latency optimisation. Written up in
[`docs/offline-first-target-architecture.md`](../offline-first-target-architecture.md), which also
corrects a near-duplication: a large, already-in-progress effort (**the Oura on-device +
own-analysis program, D0–D7**, owner-directed 2026-07-21, ~40% shipped — see
[`docs/oura-ondevice-hybrid-handover.md`](../oura-ondevice-hybrid-handover.md)) already covers the
Oura-BLE-rollup migration a different 2026-07-30 session was about to re-plan from scratch. That
program's one blocking owner action (on-device APK verification, open since 2026-07-27) **passed
2026-07-30** — see the D2 Tasks 2+3 Known-Issues row below — unblocking its next several tasks
(D2 Tasks 4-9). Three other threads sequence against Phase 3 + this program: the Task 4
workspace-split plan (backlog Q-1, new 2026-07-30 — Steps 1 and 2 have merged, moving isomorphic
`lib/` code into `@trainingai/shared`), a Postgres volume fix whose recommended `bytea` migration is
in tension with the Oura program's own D4 decision (backlog Q-30), and a public-GitHub-repo
migration gated on both (backlog Q-31/Q-32). Full picture:
[`docs/handoff-2026-07-30-platform-offline-first-consolidation.md`](../handoff-2026-07-30-platform-offline-first-consolidation.md).

**Latest feature:** (v1.246.9) **Scale: faster advertisement detection + speculative
stored-measurement drain.** Final iteration of tonight's scale reliability arc — owner asked to
"fix the advertising and pull old saved data," explicitly authorizing in-session implementation
(no separate planning PR). Full reasoning in `docs/superpowers/plans/2026-07-30-scale-stored-
measurement-drain-and-scan-latency.md`. Two changes: (1) `ScaleBleScanManager`'s passive scan
switched from `SCAN_MODE_LOW_POWER` to `SCAN_MODE_LOW_LATENCY` — the duty-cycled low-power scan
was adding avoidable seconds to detecting the scale's advertisement in the first place, worsening
the exact connect-pipeline-vs-measurement-cycle race identified in v1.246.8; (2) a **speculative**
stored-measurement drain, following a real lead the owner found
(`ronnnnnnnnnnnnn/renpho-escs20m`, a third-party BLE client for this scale family) — its source
independently confirms our own FFE1/FFE2/FFE3 roles and resolves the always-present 11-byte
handshake frame as a display-unit request (`0x12`), and documents a genuine offline-measurement
store (`0x23`-marked records, queried via `0x22`-prefixed commands). Its opcode family doesn't
match our own confirmed `0x13`-prefixed live-measurement request — different firmware generation
— so this is an explicit, owner-authorized bet: `ScaleGattClient` now also sends the guessed query
after the live request and decodes any `0x23`-marked response via a new `parseStoredRecord()`
(`ScaleProtocol.kt`), posting drained records through the *existing* `/api/scale-ble/samples`
route's `measuredAt` field — no server-side changes needed. Written to fail silently: if the guess
is wrong, no stored records ever decode and the live-weigh-in flow is completely unaffected.
**Not yet verified on-device** on either count — needs the owner to rebuild and report whether
detection feels faster, and whether any `0x23`-marked frame ever actually arrives.

**Previous feature:** (v1.246.8) **Scale: failure notification + one more retry, informed by a
reframed root-cause theory.** After v1.246.7's re-arm fix was device-verified (see Previous
Feature), the owner's actual test procedure surfaced a better explanation for the underlying
stalls than "notify-subscribe sometimes silently fails": across every capture so far, the scale's
11-byte handshake frame has arrived **100% of the time**, on every attempt, success or failure —
meaning the subscribe was never actually the flaky part. What varies is whether a real reading
follows it, and the owner's procedure (step on → wait for the scale's own display to say
"complete" → check the phone → nothing yet → step on again → that's when it worked) points at a
race: the scale's own local measurement cycle finishes faster than the phone's full BLE pipeline
(scan-detect → connect → discover services → subscribe → write the request), so by the time the
app is ready to ask for a reading, the person has often already stepped off and there's nothing new
to send. Two changes land from this, both in `ScaleBleService.kt`: (1) `notifyWeighInFailed()` — a
new low-priority notification ("Weigh-in not captured — step on the scale again") fires when a wake
gives up after all attempts, closing a real silent-failure gap (previously the "Retrying…"
foreground notification just disappeared with no lasting trace either way); (2) `MAX_ATTEMPTS`
bumped 2→3 and the retry notification text changed to "Retrying — stay on the scale…", giving one
more bounded (~8-30s) cycle and clearer guidance to catch a delayed re-engagement, at the cost of a
longer worst-case wake before giving up. **Not yet verified on-device.** Still open and
unaddressed: the `connectionStateChange status=19` mid-measurement disconnect (a separate failure
mode, not yet investigated — no grounded theory yet), and whether the race theory itself should
lead to UI guidance change (e.g. "stay on the scale a few seconds after it beeps") rather than just
service-level tuning.

**Previous feature:** (v1.246.7) **Scale: re-arm the early-data watchdog on the handshake frame.**
Device-verified 2026-07-30 — see the Known-Issues entry for the full before/after evidence.

**Previous feature:** (v1.246.6) **Scale: early-data watchdog for a stalled first connection.**
Owner rebuilt v1.243.2 and, via `chrome://inspect`, found a third scale bug: the very first
connection of a fresh app session could reach `state=waiting` (measurement requested successfully)
and then receive **zero** `FFE1` notifications — not even an unstable packet — for the entire 30s
timeout, while the owner stood on the scale the whole time (confirmed by the scale's own on-device
countdown). The very next connection attempt in the same session worked immediately. Root cause
theory (code-inspection only, matches this codebase's existing documented Samsung-BLE-stack
flakiness for the Oura ring): `ScaleGattClient.onDescriptorWrite` never verified the `FFE1` CCCD
(notify-subscribe) write actually succeeded before proceeding to request a measurement — if that
subscribe silently doesn't take on a fresh GATT session, the scale still accepts the measurement
request but the phone never receives any of its notifications. **Not a regression from #929/#937**
— `ScaleGattClient.kt`'s connection logic hasn't changed since the original integration (#848);
what changed is connection *frequency*: pre-#929, stale-scan replays triggered a real
`connectGatt()` every ~3 minutes continuously, incidentally keeping the BLE stack warm and masking
this cold-first-connection case. #929 correctly stopped those spurious wakes, so a true first
connection (idle period or app restart) is now the normal case again, exposing a quirk that was
always there. Added a bounded early-data watchdog
(`EARLY_DATA_TIMEOUT_MS`, 8s) started alongside the existing 30s weigh-in timeout: if literally no
`FFE1` notification (not even one that fails to parse) arrives within 8s of the request, treat it as
a failed subscribe and close+let `ScaleBleService`'s existing retry policy reconnect with a fresh
GATT session, rather than sitting out the full 30s for a wake that was never going to produce data.
**Not yet verified on-device** — this is a theory from log inspection, not a confirmed root cause;
needs the owner to rebuild and confirm the first-connection-after-reload case now recovers within
~8-16s instead of failing silently for 30s+. **Update (2026-07-30): owner rebuilt and re-tested —
did not fix it,** same full-30s zero-visible-notification timeout twice in a row on the correctly
rebuilt binary. See the Known-Issues entry below for the follow-up theory (a swallowed
handshake/malformed frame can retire the watchdog silently) and the diagnostic-logging-only
follow-up branch (`fix/scale-ble-handshake-frame-watchdog-log`) that's not yet a real fix.
**Second update (2026-07-30): device-verified fixed.** The diagnostic logging confirmed the theory
(the scale sends a consistent 11-byte handshake frame before any real reading, and it was silently
retiring the watchdog for good); `fix/scale-ble-rearm-watchdog-on-handshake-frame` (v1.246.7)
re-arms it instead, and the owner's rebuild caught it firing correctly on-device — a stalled
connection now bails with `"no data within 8s of request…"` instead of the old 30s timeout. See the
Known-Issues entry below for the full before/after evidence.

**Previous feature:** (v1.246.5) **AI-adaptive workout UI: real phase labels + no more prescription-card
pop-in.** Two owner-reported bugs, both traced to `ai_dynamic` programs' phase status being
constructed with hardcoded `cycleInPhase: 1, totalPhaseCycles: 1` (since these programs have no
fixed cycle count) — every render site showed a meaningless "Cycle 1/1". Added `openEnded`/
`phaseSessionNumber` to `PhaseStatus` (`lib/workout/session-data.ts`) and updated all four render
sites (pre-workout header + deload banner, active-workout header, workout-select, the
recommendation card's progress section) to show "Phase · Session N" instead when `openEnded` is
set — non-AI automatic programs are unaffected. Separately, the pre-workout AI-prescription card's
cache-seeding infrastructure (`readCacheSync` in `workout-screen.tsx`) already existed, but the
render gate in `pre-workout-screen.tsx` hid the card whenever `periodizationLoading` was true —
even with a valid cache seed already painted into state — so the card always popped in ~2s after
open regardless. Now renders the moment `periodization` is set; the loading skeleton only shows on
a genuine cold start with no cache seed yet.

**Previous feature:** (v1.246.4) **Heart-rate strap pairing card shows a live connection status.**
Owner-requested follow-up to the H10 integration: the card showed only the device name +
battery/firmware, which read as "permanently connected" when the app only holds a BLE link during
workouts, and an unclipped H10 powers off entirely. `ChestStrapSource.linkStatus()` +
`getChestStrapLinkStatus()` expose the raw GATT truth (`gattConnected`/`worn`/`active`) — separate
from the worn-gated `connectionState()` the live-HR manager uses, which would misreport a
linked-but-unworn strap as "not connected". The card polls it at 1 Hz while mounted and shows one of
four states with a paired colour+label (no colour-only state): Not connected / Connecting /
Connected · on your chest / Connected · no chest contact (ring takes over). Extended to also report
correctly in native foreground-service mode (`nativeState === 'ready'`), which didn't exist when
this was first written. ⚠️ Not verified on device.

**Previous feature:** (v1.246.2) **Deactivating a user now takes effect within ~24h, not up to 7 days.**
`auth.ts`'s jwt callback re-reads `isActive` from the DB (`lib/auth/is-active-refresh.ts`),
throttled to once per 24h per user — bounds the staleness window rather than closing it fully
(owner's choice; a continuously-active user is never signed out or re-prompted). See Known Issues
for the full writeup. ⚠️ The 24h flip itself was not observed end-to-end.

**Previous feature:** (v1.243.2) **Scale: shorter cooldown, plain-success notification.** Follow-up
to v1.242.4's stale-scan-result fix. Owner rebuilt and confirmed the endless-loop bug is gone, but
a live `chrome://inspect` test surfaced a real (much smaller) side effect of v1.242.0's cooldown:
after a real weigh-in, the scale genuinely (not stale-filtered) keeps re-advertising for a short
post-use settling period, triggering a bounded 2-attempt retry cycle that then gives up and starts
the cooldown — and the owner's deliberate second weigh-in ~2 minutes later landed inside that
2-minute cooldown window and was silently missed. `GIVE_UP_COOLDOWN_MS` cut from 120s to 20s
(`ScaleBleService.kt`) — a real weigh-in always succeeds on its first attempt in ~1-5s, so a short
cooldown costs nothing for the genuine case; worst case with it too short is one or two extra
bounded (~1 minute max, self-terminating either way) retry cycles while the scale settles. Also
added `notifyWeighInLogged()`: a plain successful weigh-in previously produced no lasting
confirmation at all (the transient "syncing…" notification just vanished) — now shows "X.X kg
logged" (or "— additional reading today" for a same-day non-trend reading), same one-shot/low
priority pattern as the existing pending/composition-skipped notifications. **Not yet verified
on-device** — needs the owner to rebuild and re-run the same back-to-back-weigh-in test to confirm
the second reading is no longer missed, and confirm the new notification actually shows.

**Previous feature:** (v1.243.1) **Guided walk — Android status-bar pill for phase + countdown.**
Phase D of the guided-walk uplift plan, the last item from the owner's original screenshot report.
Reuses the existing `AndroidRunChip` native bridge (already built for the prescribed-duration
running chip) rather than adding a new Kotlin plugin — its "duration" mode already counts down to a
target instant and flips to count-up past it, which is exactly a walk phase's countdown. The screen
re-anchors the chip on every phase change with the phase name as the label ("Fast — set N of M",
"Warm up", etc). Reused the existing `ta_pref_run_chip` toggle (relabeled "Run/Walk in Status Bar")
instead of adding a third chip preference. Per-phase color was investigated and NOT built — no
color hook exists in the reused bridge, and the phase name already satisfies the no-color-only-state
rule. ⚠️ Not verified on device — see Known Issues.

**Previous feature:** (v1.242.4) **Scale background-sync retry storm — second, deeper root cause
found and fixed.** The v1.242.0 cooldown fix looked confirmed via a `chrome://inspect` capture
(real weigh-in succeeded, a repeat scan match was suppressed, the cooldown suppressed the next
wake) — but the same "connecting…"/"Retrying…" cycle kept recurring indefinitely on a steady ~3
minute cadence, hours later, with nobody near the scale. Testing with an independent BLE scanner
(nRF Connect) proved the scale itself only advertises while someone is actually stepping on it —
disproving this entry's own earlier "motion-sensor wake" theory. The real cause: Android's
`PendingIntent`-based BLE scan can redeliver a stale `ScanResult` well after the real advertisement
stopped, and `ScaleScanReceiver` trusted "the broadcast fired" alone as proof of a live weigh-in,
never checking when the match was actually seen. Fixed by reading each result's own
`ScanResult.timestampNanos` out of the intent extras and discarding the broadcast unless at least
one result is within 5 seconds old. **Not yet verified on-device** — needs another owner rebuild
and confirmation the spurious wakes actually stop this time; see Known Issues below for the full
misdiagnosis-then-fix writeup.

**Previous feature:** (v1.242.2) **Backlog audit + a batch of small real bugs fixed; offline
meal-type mirror.** A source-verified audit of `docs/implementation-backlog.md` (trimmed
~3,050 → ~380 lines) surfaced ten small, independent, genuinely-live bugs, all fixed and merged
in #922: the Intervals running goal was silently using the wrong zone-target split
(`norwegian-4x4` had no `ZONE_WEIGHTS` entry); an abandoned activity session's elapsed timer
could run away indefinitely on rehydrate (owner-reported: 25,723 minutes on a 0.51 km route),
now capped at 12h; the offline activity-log card dropped 9 display fields for a pending-sync
activity; a BLE HR-series rollup bin-key collision could silently merge two different-width
averages; a gait-confirm streak with no gap check could backdate a walk to windows that weren't
actually consecutive; guided-activity pace mixed two different clocks; the manual food-entry
route was missing the Atwater cross-check the AI-scan path already had; the step orchestrator's
auto-post had no retry and misreported failed posts as successful; `/api/oura/sync` could write
a phantom day row once the Cloud API went frozen; and three exercise names two prior migrations
merged away (Q-26) stayed selectable in every picker (migration 165 adds `merged_into`). Also
added a read-only `meal_types` local-SQLite mirror (v21) so an offline food log groups under a
real name/emoji even after the generic response cache expires — editing stays online-only.

**Previous feature:** (v1.242.0) **Scale background-sync retry storm fixed; new Body Composition
card.** Owner reported the on-device passive-scan rework (v1.238.0) got stuck alternating
"connecting…"/"Retrying…" for ~30 minutes with the scale untouched — an on-device log
(`ScaleScanReceiver` fired 37×, ~every 20-90s) confirmed the scale itself was periodically
re-advertising (likely waking on ambient vibration, not a real weigh-in) with no OS Bluetooth
bond and no competing app involved. Root cause in `ScaleBleService.kt`: `onFailure` nulls
`client` before the 8s scheduled retry fires, so any scan match arriving in that gap (or during
the 30s `WEIGH_IN_TIMEOUT_MS` wait) looked like a brand-new wake and reset `attempts` to 0,
bypassing `MAX_ATTEMPTS` indefinitely as long as the scale kept re-advertising. Fixed with a
`cycleActive` guard covering the whole wake episode (not just while a GATT client object exists)
plus a 2-minute cooldown (`GIVE_UP_COOLDOWN_MS`, companion-object state) after giving up — a real
weigh-in still succeeds on its first attempt (stable reading in ~1-5s), so this costs nothing for
the genuine case. Also wired `scaleLog`/`scaleStatus` native events to `console.info` in
`capacitor-native-init.tsx` (JS-only, no rebuild) so a recurrence is debuggable live via
`chrome://inspect` instead of scavenging `adb logcat` for lines that were never actually logged
there. Separately, added a **Body Composition** card to Health > Body: the scale ingest path
already computed and stored 10 BIA fields (skeletal muscle %, fat-free mass, muscle/bone mass,
body water %, subcutaneous fat %, visceral fat index, protein %, BMR, metabolic age) but nothing
in the UI ever surfaced them beyond weight/body-fat — extended `/api/body-metadata`'s
`BodyMetaRow` (reusing the existing `repo.listBodyMetrics` call, no new endpoint) and added the
card next to `bodyWeight`/`bodyFat`/`leanMass`, visible only once a user has a scale reading.
**The cooldown fix is confirmed on-device** (2026-07-30, post-rebuild `chrome://inspect` capture —
see Known Issues below for the log sequence); the Body Composition card is JS/API-only and
auto-deploys, not yet separately confirmed rendering real data on-screen.

**Previous feature:** (v1.240.0) **Guided walk — recorded per-segment stats, HR-zone map, fast/slow
averages.** Owner-directed: the walk-complete screen's per-interval numbers were ephemeral (thrown
away on save) and there was no way to compare a walk's fast/slow blocks against each other over
time. A new `activity_logs.segments` column (mirrors the existing `paceSeries`/`elevationProfile`
JSONB-array pattern, migration 161) now records every segment's HR/pace/distance/cadence — the
same granularity a lift's `set_logs` get per set — threaded through the full stack (schema,
validation, adapter, local SQLite, `RECONCILE_COLUMNS`). The walk-complete screen gained an
HR-zone-colored route map (reusing the #878 helper) and "Fast avg"/"Slow avg" cards. ⚠️ Not
verified on device — see Known Issues. Owner request, no separate plan doc (small enough relative
to the shipped GPS/pace work it extends).

**Previous feature:** (v1.238.0) **Scale background sync reworked from a continuous poll to a
passive BLE scan — no more permanent "Watching for scale…" notification.** Follow-up to the
owner's on-device feedback: the old design ran `ScaleBleService` continuously with a 45s retry
loop and an always-visible foreground-service notification, for a scale used ~10s/day. Replaced
with `ScaleBleScanManager`, a `BluetoothLeScanner.startScan(..., PendingIntent)` registration
(filtered on the FFE0 service UUID — the same filter `scale-pairing.tsx`'s pairing flow already
uses and has proven correct on real hardware) that survives the app process being killed with no
ongoing notification cost. `ScaleScanReceiver` fires only when the scale actually starts
advertising and starts `ScaleBleService` for a bounded 2-attempt connect (`MAX_ATTEMPTS`) that
stops itself once resolved — `stopSelf()` moved to the end of the actual network POST (not a
fixed timer) so a slow request can't race the service's own teardown. `ScaleBootReceiver` re-arms
the scan after a reboot (scan registrations don't survive that, unlike SharedPreferences); unlike
`OuraBootReceiver` this isn't subject to the BOOT_COMPLETED foreground-service-start restriction,
since registering a scan isn't starting one. `ScaleGattClient`/`ScaleProtocol` (the actual
connect/decode logic) are untouched. **Not verified on-device** — this is the first
PendingIntent-scan pattern in this codebase (every other native BLE piece here holds a continuous
connection instead), so it needs a real on-device check before being trusted; flagged in Known
Issues below alongside the still-open two-phone scenario.

**Previous feature:** (v1.237.0) **Multiple scale weigh-ins per day — first reading sets the trend,
later ones are recorded alongside it.** Owner feedback on the same session as the socks-composition
fix below: they want to just step on the scale whenever, morning and night, without the second
reading clobbering the first. `body_metrics` is a one-row-per-day table used everywhere (trend
charts, AI insights), so the fix is at the write path, not the schema: `hasConfirmedScaleTrendForDate`
(`lib/data/repository.ts`/`adapter.ts`) checks whether today already has a scale-sourced weight
before `/api/scale-ble/samples` (and the pending-confirm route) calls `upsertBodyMetrics` — the
day's first confirmed reading always wins the trend value (fasted-morning-weigh-in convention),
and every reading after that is skipped for `body_metrics` but still fully archived in
`scale_raw_samples` (which already stored every past reading with full composition, unaffected).
A new `GET /api/scale-ble/today` surfaces the day's readings, and `scale-pairing.tsx` shows them
in a "Today's weigh-ins" list with the trend entry marked. 5 new DB-backed tests cover the
gating logic and the local-timezone day-boundary case (a reading at 11pm-AEST-previous-day must
not count as "today"). Fully sandbox-verified via `curl` (see the entry) — no native surface.

**Previous feature:** (v1.236.0) **Fix: a no-skin-contact scale reading no longer corrupts body
composition.** Follow-up to the direct-BLE Renpho scale integration's first real on-device use —
the owner weighed in wearing socks, which broke the foot-plate contact BIA needs; the scale
reported impedance as `0` rather than omitting the packet, and dividing by that zero floored the
body-fat estimate at its 3% clamp along with every other composition field (skeletal muscle,
water%, protein%, BMR, metabolic age all garbage in the same write). Confirmed via the read-only
production audit endpoint against the owner's actual `scale_raw_samples`/`body_metrics` rows
before fixing. `hasValidImpedance()` / `MIN_VALID_IMPEDANCE_OHMS` (`lib/scale-ble/composition.ts`)
now rejects an implausibly-low impedance reading before the formula runs; the weight itself (a
load-cell reading, contact-independent) still saves, composition fields are left untouched rather
than overwritten with a wrong number, and `ScaleBleService.kt` fires a one-shot low-priority
notification explaining why composition wasn't updated. Verified live against the local dev server
using the owner's actual captured socks-reading bytes (confirms `compositionSkipped: true`, weight
saves, composition columns stay null) and a real bare-foot reading (confirms the normal path is
unaffected). See the Known Issues entry below for the fuller incident writeup and the still-open
background-sync-notification design question raised in the same conversation.

**Previous feature:** (v1.235.0) **Exercise Readiness rework.** The pre-session check-in now shows the
body map beside the sore-muscle pills, auto-marks any muscle still recovering from recent training
(**"sore" now means "not recovered"** — it uses the recovery curve, not a flat clock, so a hard leg
day still counts at 47 h while a light one doesn't),
drops the two Issues that duplicated other sections, makes **Sick/Unwell** actually do something
(recommends rest; deloads the session if you train anyway — it was stored and never read by the
engine), and adds a **Time Constraints** section: Quick / Normal / Long at the session's own budget
**±30** rather than fixed 30/90 clocks. It shares the stored prescription with the pre-workout picker
so the two can't disagree. Two bugs surfaced while verifying in a real browser: the duration control
was clobbered by its own late-resolving fetch, and dropped exercises escaped the per-role set cap
(storing an accessory at 5 sets against a ceiling of 4).

**Previous feature:** (v1.234.0) **Guided walk — HR chart with fast/slow phase shading.** The
walk summary's per-interval bpm list gets a visual companion: a heart-rate line chart with a
translucent background band per fast/slow segment, via a small custom chart.js plugin (no new
dependency). Extends the existing `ActivityHrChart` with an optional prop rather than forking a
second chart component. Plan: `docs/superpowers/plans/2026-07-23-guided-walk-uplift.md` (Phase C).

**Previous feature:** (v1.233.0) **Guided walk — live GPS, pace-primary UI, recorded per-phase
stats.** The interval walk's mid-exercise screen was missing a live map/speed/HR-zone breakdown,
and fast/slow segments had no real metrics to compare against each other — both owner-reported
gaps. Ships live GPS point tracking + route map (mirroring the regular activity flow's pattern),
pace becomes the headline live stat once a GPS fix exists (HR demoted to secondary — HR drifts
set-over-set on a walk and doesn't cleanly separate fast/slow, pace is the real signal), and route
polyline/splits/pace-series/elevation/per-phase avg pace are now actually saved on finish
(previously hardcoded `null` on every walk). ⚠️ **Not yet device-verified** — see Known Issues:
only the browser `navigator.geolocation` web-fallback path was exercised (via Playwright with
mocked location), not the native `BackgroundGeolocation` plugin. Plan:
`docs/superpowers/plans/2026-07-23-guided-walk-gps-speed-pace.md`.

**Previous feature:** (v1.232.0) **Role ordering — the main lift is the hardest-worked movement again.**
A production audit of every live prescription found one unambiguous inversion: Upper prescribed
**Skull Crusher 5×7 @77.5 %** against **Incline Bench 4×7 @76 %** — an accessory beating the primary
on both load *and* volume. Two independent gaps: the "never out-load the anchor" rule was applied
against the primary's *zone ceiling* (80 %) rather than its *prescribed* pct (76 %), so at 77.5 %
nothing bound; and `SET_CEILING` was reached only via `expandToBudget`, i.e. only on the `long`
preset, so a standard session's set counts were unbounded. Per the owner's decision the two axes now
behave differently — **load order is absolute** (nothing out-loads the anchor, no exception) while
**set order yields to weekly need** (a muscle below its weekly target may carry extra sets), because
a lagging muscle is corrected with volume, never a heavier bar. Verified end-to-end against a real
generated prescription on the dev server. Plan:
`docs/superpowers/plans/2026-07-28-role-ordering-plausibility.md`.

**Previous feature:** (v1.230.0) **AI workout prescription — full review + six fixes.** A read-only
production audit of the pipeline found the AI driving load on only **1 of 5 sessions**: a pending
`transition_recommended` discarded its own sets/reps/pct, and three of the four affected sessions
carried a self-contradictory "transition" to the phase already in progress, which reset
`sessions_in_phase` on acceptance so the block could never complete. Separately the duration model
charged rest for `sets − 1` — production shows per-set rest and inter-exercise gaps are distinct
clocks, so it under-estimated by ~7-8 min per five-exercise session and **10 of the last 20 workouts
ran past their 60-minute budget**. Both fixed, plus: a soreness check-in now actually reaches today's
plan (it was blocked by a 6-hour cache *and* by a once-per-day stamp set by the first read of the
day), model-authored sets floor at 2 (four single-set exercises were live), and a **Short / Standard
/ Long session-length picker** — a short session drops the exercises furthest ahead of their weekly
target rather than cutting everything to two token sets; a long one adds work where you're furthest
behind, bounded by MRV. Two pre-existing bugs surfaced en route: the periodization GET's 60s HTTP
cache answered *every* post-write refetch (accept/dismiss/transition/poll) with pre-write state, and
`/prescribe`'s 10/hour limit predated user-initiated generation. Done screen's six uncached fetches
are now cache-seeded, and HR recovery reports per exercise instead of per set. Plan:
`docs/superpowers/plans/2026-07-28-ai-prescription-review.md`.

**Previous feature:** (v1.229.3) **Stop escalating the Oura ring's live-HR loop during a workout when
the chest strap is already connected.** Follow-up to the same session's chest-strap bug-fix batch —
while investigating how HR source precedence works, found that `lib/live-hr/manager.ts`'s `wants()`
started the ring (`CONNECTED_LIVE` + the 10 s DHR burst) unconditionally whenever a workout was
active, regardless of whether the strap was already connected and covering. The strap already wins
read-path precedence (`activeSourceId()`), so the ring's beats were never even surfaced — pure
battery waste, and a direct contradiction of the original always-on-chest-strap plan's stated Goal
3 ("no new drain on the ring"), which was never actually wired up. `wants()` now also checks
`activeSourceId() !== 'chest_strap'` for non-ambient sources; since there's no push notification
for a source's `connectionState()` changing (BLE connects happen deep in native code), a 10 s
periodic re-check runs for the duration of a workout so a strap that connects, disconnects, or
gets taken off mid-workout escalates/de-escalates the ring without any caller needing to re-call
`start()`. Two of the five existing manager tests asserted the OLD behaviour (ring always
escalates) and were rewritten to match the new intended behaviour, plus three new tests covering
the gating and the periodic re-check (including that the timer actually stops on `stop()`). Every
other live-HR consumer (`useLiveHr`, the walk/fitness-test/run screens) only reads the resolved
`bpm`/`live`/`stale` output and is unaffected. **Not verified on-device** — this only changes when
the ring's native BLE burst loop fires, which cannot be observed in the sandbox; needs an owner
smoke test (start a workout with the strap connected, confirm ring battery doesn't move) on the
S25. Entry:
[`docs/overview/history-2026-07-28.md`](history-2026-07-28.md).

**Previous feature:** (v1.229.0) **Direct-BLE Renpho ES-20M scale integration.** Pairs the owner's
Renpho scale directly over Bluetooth from Profile settings — bypasses Health Connect entirely,
which structurally can't carry 5 of the scale's metrics (Skeletal Muscle %, Subcutaneous Fat %,
Visceral Fat, Protein %, Metabolic Age have no Health Connect record type at all). Protocol was
pinned from a real on-device capture against the owner's actual scale (nRF Connect, Phase 0 —
`docs/superpowers/plans/2026-07-27-renpho-ble-direct-scale.md`), not memory or generic docs: GATT
service `0xFFE0`, notify on `FFE1`, request command on `FFE3`, verified byte layout + a checksum
formula cross-checked against 4 independent real weigh-ins. A native Kotlin foreground service
(`android/.../scale/`, mirrors `PolarStrapService`'s shape) periodically attempts a connection
since the scale sleeps except when stepped on; on a stable reading it POSTs to
`/api/scale-ble/samples` using the same shared-session-cookie mechanism the Polar chest strap
already uses. New `body_metrics` columns (migration 157 — 145, 153 and 155 were already taken by
other PRs on `main` by the time this merged) hold the 10 previously-unreachable fields, computed by a
documented generic BIA formula (`lib/scale-ble/composition.ts` — explicitly NOT Renpho's own
proprietary algorithm, which is unpublished). **Multi-user safety net:** the owner's partner also
uses this scale, so a reading more than 15% off the account's last confirmed weight is staged as
`pending` (a local notification + Confirm/Dismiss in Settings) instead of auto-saved — verified
end-to-end against the local dev DB (confirmed/pending/dismiss/confirm all smoke-tested with
curl). Background sync is opt-in (off by default) so a user without this scale pays no
battery/notification cost. ⚠️ **Not yet device-verified** — see Known Issues: the entire native
Kotlin layer (BLE connect/handshake/decode, the foreground service, the background notification)
cannot be exercised in the sandbox (no Android SDK, Gradle proxy-blocked, no Bluetooth hardware)
and needs an owner APK rebuild + on-device smoke test before this is fully trusted. Entry:
[`docs/overview/history-2026-07-23.md`](history-2026-07-23.md).

**Previous feature:** (v1.228.2) **Skip the "all sets logged, tap Complete" screen — go straight to
the exercise summary, with the rest countdown moved onto it.** Owner-reported: after the last set,
the old rest-ring screen's only action was "Complete →", which got reflexively spam-tapped while
just trying to rest. `handleLogCurrentSet` (`components/workout-screen.tsx`) now auto-finalizes the
exercise (calling the same logic the "Complete →" button used) the instant the truly-last set is
logged — no superset handoff, no buffered exercise pending. The rest countdown itself moved to a
new leaf component, `LastSetRestTimer` (`components/workout/last-set-rest-timer.tsx`), rendered at
the top of the exercise-summary screen; `lastSetRestStartMs` now survives the transition into
`exercise-summary` mode (previously nulled immediately) and is cleared once `advance()` actually
leaves the screen, so it can't bleed a stale countdown into the next exercise's own ready screen.
The old rest-ring + "Complete →" screen in `active-workout-screen.tsx` is left in place as a
fallback (unreachable in the new flow, but protects any already-in-flight/rehydrated session stuck
in that old state). **Verified end-to-end in the sandbox** — not just read-through: drove a full
exercise (3 sets) through a real browser session against the local dev server, confirmed the
summary screen appears immediately with no intermediate screen, the ring visibly ticks down
(90s → 87s over 3 real seconds), and tapping "Next Exercise" clears it cleanly with no stale
countdown on exercise 2's ready screen. Superset/buffered-exercise handoff paths were verified by
code review only (the seeded local program has no supersets to drive through). Entry:
[`docs/overview/history-2026-07-23.md`](history-2026-07-23.md).

**Previous feature:** (v1.228.0) **Intervals goal (Norwegian 4×4) — cardio batch, last item in the
running-system backlog sweep.** A fifth selectable running-plan goal, running the well-known 4×4-
minute high-intensity interval protocol (capped at 2 sessions/week, easy/long fill otherwise). Pure
TypeScript — the prescription engine's swappable `RunFramework` interface was explicitly built for
this exact extension and had never been used until now. Fully verified in the sandbox (unit tests +
end-to-end Playwright + `psql` confirmation), no device-only surface. Entry:
[`docs/overview/history-2026-07-23.md`](history-2026-07-23.md).

**Previous feature:** (v1.227.2) **Run status-bar chip — cardio batch.** Live runs now show their
actual goal's progress in the Android status-bar pill: distance-so-far/target for a distance-goal
run, time-remaining for a duration-goal run, or a plain elapsed clock for a freeform run — reusing
the same native chip mechanism the lifting rest timer already has. Toggle from Profile →
Preferences → Run in Status Bar. **Not verified on-device** — the native chip itself (the entire
payoff) cannot be exercised in the web/dev sandbox; needs an owner APK rebuild + smoke test. See the
Known Issues row below. Entry:
[`docs/overview/history-2026-07-23.md`](history-2026-07-23.md).

**Previous feature:** (v1.227.1) **Max-HR resolver consolidation.** Max HR was resolved three
different ways that could silently disagree; `resolveHrProfile` is now the only resolver, with
every observed value corroborated through `computeObservedHr` so a single motion artefact can no
longer become a permanent target ceiling. **Not verified on-device** — the guided-walk and
fitness-test target screens weren't run on the S25. See the Known Issues row below.

**Previous feature:** (v1.226.2) **Bug-fix batch: chest-strap notification spam + battery, wrong
"weekly step goal met" claim, premature "day in review" banner.** See the session journal entry
for details. See the Known Issues row above for the chest-strap piece's device-verification status.

**Previous:** (v1.225.0) **Elevation profile chart — cardio batch, last item in the running-
system backlog sweep.** GPS activities (mainly runs) with elevation data now show an
elevation-vs-distance chart on the activity detail sheet, next to the existing pace-per-km bar
chart. New `computeElevationProfile` (distance-bucketed, mirrors `computePaceSeries`'s bucketing
shape) plus a new `ActivityLog.elevationProfile` field threaded through the full stack — DB column,
validation, adapter, `activity-store.ts`'s `finish()`, all `done-activity-screen.tsx` save paths,
and the offline sync chain. **Not verified on-device** — the local-SQLite write→sync→pull path and
real GPS elevation data were both only exercised via a manually-seeded row in the sandbox. Entry:
[`docs/overview/history-2026-07-23.md`](history-2026-07-23.md).

**Previous feature:** (v1.222.0) **Dedicated run execution screen — cardio batch.** Runs get their
own live tracking screen (`RunActiveScreen`) instead of the generic activity screen: a live HR +
zone hero (the first place `lib/live-hr/` is wired into the activity flow, not just the workout
screen), splits-so-far and elevation-so-far, a live map, and cadence — and if today's run has a
prescription, the hero shows whether the current zone is on target. No new stored data, no new API
route. **Not verified on-device** — live HR needs a real strap/ring. Entry:
[`docs/overview/history-2026-07-23.md`](history-2026-07-23.md).

**Also recently:** (v1.220.1) **D5 — own daytime-HRV.** Replaces Oura's `dhrv_imputation` ONNX
model with a per-user linear regression (`ln(rmssd) = a + b·hr + c·temp`, closed-form OLS) fit from
this user's own **night-time** `0x5d` HRV events — the ring only streams real daytime HRV ~7% of
waking hours (verified on-device 2026-07-16), so direct measurement isn't viable, but night-time
`0x5d` is dense and real. MET is deliberately NOT a fit feature (near-zero night-time variance to
learn from) — it's an evaluation-time gate instead: a bucket above `MET_ACTIVE_THRESHOLD` scores
null rather than mis-extrapolating from a resting-only fit. Built with **zero knowledge of dHRV's
actual output** (observe-never-feed, per the master plan) — Oura's ONNX path stays golden-tested
and importable but is no longer called from production. Refit is throttled (24h) and runs from the
existing server-side raw-sample aggregation pass, never on `body-battery`'s live request path
(just a coefficient lookup + closed-form eval there). New **Admin → Oura BLE → Comparison harness
→ own daytime-HRV vs Polar H10** console (D6's harness, second adapter registered) is the real
validation gate. This is the master plan's **D6 → D5 → D2** sequencing — D5 unblocks D2 (native
raw store + on-device rollup) next. ⚠️ **Cold-start**: the model needs a few days of real overnight
ring wear post-merge before it produces anything (same "not enough data" outcome as before); **not
yet device-verified** — no real H10 spot-check has been run on this console. See Known Issues.
Entry: [`docs/overview/history-2026-07-23.md`](history-2026-07-23.md).

**Also recently:** (v1.220.0) **Naps no longer drag down your sleep quality trend or your weekly
recap's average sleep score.** A 20-minute afternoon doze was being scored as if it were a night's
sleep in those two places, which also fed the AI's view of how you'd been sleeping when it planned
your sessions. New in Admin → Day Review: your Sleep Score for each night next to the rating you
gave it the next morning.

**Also recently:** (v1.217.1) **Naps no longer overwrite nights.** The original "my sleep score doesn't
match how I slept" bug — F-1/Q-1/Q-18 — is closed; see Known Issues. One shared module now decides
which sleep was the night, by circadian position (with a length override so non-nocturnal sleep still
counts) rather than by whichever row ended last, and reassembles a night broken by a wake-up. Entry:
[`docs/overview/history-2026-07-23.md`](history-2026-07-23.md).

**Previous feature:** (v1.218.0) **Baseline anchors + push sessions — cardio batch, density-progression
item (split plan 2 of 2).** A new `running_baselines` table freezes a fitness/pace snapshot (VO2max,
HR profile, easy pace) at the moment a running plan is created. Every 5th completed session in a
plan is now a derived "push" session (`isPushSession`, `lib/running/push-sessions.ts`): the
prescription's distance target bumps 2% past the best same-environment outdoor run completed so far
in the block, with an explicit "beat your best" rationale and a "PUSH" badge on the running card.
Environment tagging (`inferEnvironment`) is purely derived from whether a run has a GPS route, so a
treadmill result never corrupts an outdoor comparison — nothing new is stored beyond the anchor
table itself, per the "derive, or reconcile on read" rule. **Not verified:** a real 5-session push
cadence over genuine calendar time (checked via seeded DB rows instead) or on-device. Completes the
density-progression backlog item (both split plans now shipped). Entry:
[`docs/overview/history-2026-07-23.md`](history-2026-07-23.md).

**Previous feature:** (v1.217.0) **Density-progression running framework + two prescription bug
fixes.** Running plans can now hold their session time fixed (20/30/45/60 min) and grow the distance
target ~3%/week instead of growing the time itself. Also fixed two pre-existing bugs that silently
blocked every framework's week-over-week growth (`weekIndex` hardcoded to `0`; `ctx.goal` a hardcoded
fake) and the Running screen's "Start run" button (never called `startActivity()`). Entry:
[`docs/overview/history-2026-07-23.md`](history-2026-07-23.md).

**Also recently:** (v1.216.0) **Cardio trends surface — cardio batch item 1 (renumbered).** New
`/api/cardio-trends` route + a Trends card on `/cardio` with a three-pill view picker: weekly
heart-rate zone stacks (`bucketZoneMinutesByWeek` over `getZoneMinutesRange`), a pace-vs-HR
efficiency curve for GPS runs (dual-axis, reversed pace axis matching the session-visuals item's
convention), and a cadence trend. Entry:
[`docs/overview/history-2026-07-23.md`](history-2026-07-23.md).

**Also recently:** (v1.215.0) **Sleep Score gains an autonomic axis.** Owner-directed, from the
data-quality review's case study of the night of 2026-07-25 — a night rated 5/5 "Terrible" that
scored 80 because it was normal on everything the model looked at and abnormal only where nothing
was looking (HRV −2.76 σ, overnight HR +10 bpm, a 2 h-early wake). Adds an `hr` contributor and a
directional `schedule` contributor (only a late bedtime or early wake counts against you), routes
all six callers through one shared baseline derivation (four previously passed none, so a night
could score 82 on the weekly digest and 80 on the Health screen), and rebalances weights so
autonomic state is 28 of 110 rather than 12 of 100. That night now scores **71** — 2nd lowest of 20
and 5 clear of the 3rd, where it used to sit 5th and indistinguishable from ordinary nights — while
the top of the range is unmoved and a perfect night still reaches 100 (pinned by a test).
**Historical scores change meaning**, and the two new contributor bars are **not device-verified**.
Entry: [`docs/overview/history-2026-07-23.md`](history-2026-07-23.md).

**Also recently:** (v1.214.0) **Cardio session visuals — cardio batch item 1.** The per-session
`ActivityDetailSheet` gained a hero interactive HR/pace scrub chart (drag across it and the route
map's marker slides to that moment — the scrub position, a time-based index into `paceSeries`,
maps to a distance via `estimateDistanceKmAtTime` and then to a lat/lng via `pointAtDistanceKm`, a
pure interpolation needing no new stored data), a pace-per-km bar chart with fastest-1km/5km
callouts from `bestEfforts` (computed and stored since GPS tracking shipped, never rendered until
now), a time-in-zone donut beside the existing zone-breakdown bar list, and a proper bordered
splits table. ⚠️ **Not yet device-verified** — the `touch-none` scroll-guard on the hero chart's
touch-drag scrub is untested on a real Samsung WebView gesture. Entry:
[`docs/overview/history-2026-07-23.md`](history-2026-07-23.md).

**Also recently:** (v1.213.0) **Cardio session picker — cardio batch item 1 (renumbered).** The
Cardiovascular hub's modality picker gained a "How much time do you have?" flow: pick 15/30/45/60
minutes and it recommends Run, Guided walk, or Other activity — recommending Run (and surfacing
the running program's own recovery-gate reason, e.g. easing off after a heavy leg day) only when
today's pending prescription actually fits the time budget, otherwise recommending a walk to close
whichever training zone (Z2-Z5, Z1 excluded per D-10) has the most minutes outstanding. Entry:
[`docs/overview/history-2026-07-23.md`](history-2026-07-23.md).

**Latest fixes:** (v1.208.2) added a time-in-zone + Session Load breakdown to the guided walk's
summary screen, reusing the same `ZoneBreakdown` component regular activities already have.
(Real zone-minutes in the Activity score itself was independently wired the same day in
v1.207.0's Activity Score v2 round 3 — see that entry below; no separate wiring was needed here.)

**Also this session:** (v1.208.1) **guided interval walk uplifts** — the fast/slow HR-zone targets
were using a fallback profile (190bpm max/60bpm resting) instead of the walker's real data,
making the fast target unreachable without jogging; now wired to real observed max-HR history
(the existing 70%/40% split itself already matched the actual research protocol, confirmed
against source). The preset buttons (Standard/Quick) now show a selected-state highlight + tap
feedback (they worked before, just gave zero visual confirmation). Added a confirm-before-exit
dialog on the End-walk button, bottom-nav tab-away, and the hardware back button, mirroring the
workout screen's existing three-surface guard. A phased plan for the remaining, much larger
uplift (live GPS map/speed/cadence/elevation, an HR chart with fast/slow phase shading, reusing
the Android status-bar pill for phase/countdown, reactive walk/jog nudge notifications, steps,
per-phase speed/HR stats) is queued in the backlog —
[`docs/superpowers/plans/2026-07-23-guided-walk-uplift.md`](../superpowers/plans/2026-07-23-guided-walk-uplift.md).

**Also this session:** (v1.208.0) **AD-2 — ring-cadence walk/run detection**, fixing false
"Activity detected" notifications during stationary training (e.g. a garage lifting session).
Walk/run **confirmation** (session start + the notification) now comes from the ring's real
stride cadence (`lib/health/gait-classifier.ts` + `lib/activity/gait-confirm.ts`'s sustained
~90s-window accumulator) instead of GPS speed — the same approach Oura's AAD model and Garmin
Move IQ use. GPS is demoted to route recording; session start is backdated to the true onset via
a new probe-phase point buffer. GPS-speed confirm + the AD-1 distance/elapsed gate remain as the
ring-disconnected fallback. **Device-gated** — see Known Issues below for the still-open Hz-band
calibration and the on-device smoke run.

**Latest feature:** (v1.197.0) **per-set / per-exercise HR metrics** — every logged set now saves a
durable HR snapshot (peak/avg during the set, the rest-bounded beat-drop curve, and three
time-to-recover models), surviving the 180 d raw-HR prune in the new `set_hr_stats` table (migration
139, sibling of `workout_hr_stats`). A new "Heart & Recovery" card on the exercise-history sheet trends
peak HR + rest recovery over time and breaks it down by working weight (%1RM). Cardiovascular signal
only (not CNS). Data path fully sandbox-tested; the card surface needs the on-device gate (see
Known-Issues below).

**Latest fixes:** (v1.185.1) the workout screen no longer flashes on open — the exercise list used to
be replaced by a full-screen "Preparing your AI workout" takeover and then swapped back; the list now
stays put and only the heading/Start button reflect the "preparing" state in place. (v1.185.2) locked
the WebView viewport (`maximum-scale=1, user-scalable=no`) so an accidental pinch/double-tap can no
longer leave the app stuck zoomed-in after a minimize/reopen — **needs on-device confirmation** (not
reproducible in the web sandbox). (v1.185.3) the next AI prescription is now generated **at session
end, in-process** (new `lib/ai-periodization/generate-prescription.ts`) instead of via an unreliable
self-origin fetch on next open — a just-trained ai_dynamic session gets its updated plan/"Auto" status
queued immediately, and offline completions regenerate on sync. **Gemini path needs real-data/on-device
confirmation** (local seed is a manual program, no LLM path reachable). (v1.188.1) fixed the home-screen
**"Sync failed" toast**: the Oura-BLE ingest ran its heavy rollup **inline** on every `/api/oura-ble/samples`
POST, and that rollup fanned reads out over **10 pool connections at once** (of `max:10`) for 12–30 s —
starving the outbox sync of a DB connection and blowing the native client's 30 s timeout → 499 → cursor-held
re-drain **retry storm** that pinned the pool (prod `NO_SOCKET`/`TCP_INVALID_SYN`). Now: the rollup reads via
**one** connection and is **time-boxed** so the POST returns 2xx promptly (rollup finishes in the background),
with a per-user in-flight guard. Server-side JS (no APK rebuild); **needs on-device confirmation** that ring
drains no longer 499 (sandbox can't reproduce the native POST). Failure-matrix row I19 in `docs/oura-ble-operations.md`.

**Where the app stands.** The full-system deep-review batch (`docs/reviews/2026-07-18-deep-app-review.md`)
is shipped, the backlog + `planned_upgrades.md` ledgers were source-verified against `main` (PRs
#676/#677 — a large number of "open" entries turned out to be already shipped and are now struck with
file:line proof), the R-1 native BLE cursor hole-jump race was fixed (v1.181.2, native — needs the owner
APK rebuild to take effect), and the goal-based **cardio training system** (running engine + VDOT paces +
observed-HR profile + progress observation) shipped this session (v1.182.0–v1.183.0). The remaining cardio
pieces — `/running` goal-picker UI, admin device-data capture panel, cumulative-stress rollup wiring — are
handed off in `docs/superpowers/plans/2026-07-20-cardio-system-remaining.md` and queued in the backlog.

**Status:** the **owner-directed Core score-cards + Activity overhaul** (v1.207.0) is **fully shipped** —
all four workstreams (W-A accent-tick ring redesign + HR-resting fix + de-Oura, W-B Activity Score v2
including active minutes, W-C sleep recalibration + HRV, W-D readiness recalibration + check-in) landed
across three owner-reviewed rounds. **Remaining is device verification only**: the whole batch needs the
on-device smoke (see Known-Issues below) — nothing left to build against this plan. Two small pieces were
deliberately left out of scope (yesterday-completed home display, hourly move-nudge notification); pick
those up as their own small item if wanted. Plan
[`docs/superpowers/plans/2026-07-22-core-score-cards-and-activity-overhaul.md`](../superpowers/plans/2026-07-22-core-score-cards-and-activity-overhaul.md).
Also, the **owner-directed Health/Training/Workout UX batch** (2026-07-21, 14
items filed on-device with screenshots) is **fully shipped** — all 14 items across 8 PRs
(#709–#712, #716, #717, + the device-gated batch and the workout redesign), v1.189.0–v1.193.0. **The only
outstanding work is on-device verification** of the device-gated items (#2/#4/#7/#9a/#14) and the
energy-budget / Run-card populated states — see the Known-Issues rows above and run
`docs/device-smoke-checklist.md` on the S25. Separately, a
wiring & load-performance audit (`docs/reviews/2026-07-20-wiring-caching-perf-audit.md`)
queued **seven scoped fix plans W1–W7** in `docs/implementation-backlog.md` (cache staleness,
wiring & load-performance audit (`docs/reviews/2026-07-20-wiring-caching-perf-audit.md`) shipped its
seven W1–W7 fix plans (see the entries below). **Corrected 2026-07-30:** this paragraph used to claim
"every previously-open backlog task buildable in the sandbox is done" and pointed at
`docs/owner-action-required.md` as the authoritative what's-left list — both were stale by the time of
a fresh audit (a 3,000-line backlog had accumulated real, non-device-gated open items alongside ~2,300
lines of unremoved shipped work; `owner-action-required.md` hadn't tracked most of the last 9 days).
`docs/implementation-backlog.md` was trimmed and corrected 2026-07-30 and is the current source for
what's open — read its Queue directly rather than assuming everything in it is blocked.

**For the full per-session history of what shipped and why, read the session journal** — the recent
uncompacted entries and the batched `docs/overview/history-*.md` archives (see the Document Map at the
bottom of this file). This section is a lean pointer, not a changelog: it is deliberately kept short so it
stays useful to orient by. Do not grow a run-on "Previously — …" chain here again; that belongs in the
journal.

---

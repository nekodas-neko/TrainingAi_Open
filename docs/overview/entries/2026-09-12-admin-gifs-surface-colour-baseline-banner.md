# 2026-09-12 — three owner reports: the baseline banner, the admin GIF console, and the grey

Intake only; no code changed.

## BF-146 — a correct refusal drawn as a failure

Minutes before training, the Lower card showed *"Couldn't generate your AI prescription just now —
showing your base program. Tap refresh to try again."* Nothing is broken. Generation returns
`{ ok: false, error: 'Baseline not complete', status: 400 }` when a session is in `baseline` with no
anchors, which is right: a prescription is a percentage of a 1RM and there is no 1RM yet.

The client has no case for a deliberate refusal. `pre-workout-screen.tsx:301-305` renders that
banner under `prescriptionGenTimedOut`, so a settled state is drawn in amber with a warning triangle
and an instruction to retry that can never succeed. The panel directly above it already gives the
correct explanation — "First session — establish baseline … the AI will start prescribing from the
next session" — so the screen contradicts itself.

BF-143's fix is what made this reachable, and the entry says so. Before it the owner's sessions were
either AMRAP-calibrated or silently auto-completed, so the state never survived a card open. The 400
predates it; the UI gap was latent.

## BF-147 — the admin exercise list

The name is rendered and then crushed to zero. `exercise-manager.tsx:545` gives it `truncate`, whose
min-width resolves to 0; the `SourceBadge` beside it has neither `shrink-0` nor `overflow:hidden` so
it cannot collapse, and the thumbnail, status glyph and four-button group are all `flex-none`. The
name is the only thing that can give, so it gives everything — the `bod…` on screen is the second
line, which sits alone in the flexible column.

Two destructive actions have no confirmation. Delete fires on one tap, which is BF-124's defect in a
second place — the same unconfirmed trash icon that cost the owner his Lower session four days ago.
And the per-row Mirror and AI buttons pass `force = hasS3Gif`, so tapping one on a row that already
has a good GIF overwrites it silently. The bulk buttons are the safe ones, which inverts the
expectation.

The coverage figure is wrong in both halves: the denominator counts 4 merged-away rows and the
numerator ignores custom URLs. Measured: 152 live exercises, **15** with no media at all, against
the 19 that "137 / 156" implies.

The broken reference thumbnail is the style anchor for every future generation, and it is a storage
failure — the shared S3 client reports `SignatureDoesNotMatch (403)`. Of 139 media rows, 133 are
absolute external URLs and only 6 are proxy paths, which is why the rows render while this one does
not. Those six share the reference figure's fate.

Flagging is new surface: no review or status column exists anywhere on the exercise or media tables,
and the Feedback tab has no entity linkage. The recommendation is a `review_status` on
`exercise_media` plus a one-at-a-time sweep screen — verifying 152 GIFs by scrolling a cramped list
is the wrong instrument, and "decide how to proceed" needs a queryable set, not a toast.

## BF-145 — the grey is structural

Every dark surface token in `globals.css` carries **chroma 0**: background, card, popover,
secondary, muted, muted-foreground. The app is greyscale by construction and the only colour that
can appear is `--brand` on top. The owner already has a `brandHue` preference; it drives the accents
and cannot reach the surfaces. `--card-tint-pct` looks like the hook and is not — it mixes `--muted`
with transparent, so it changes the opacity of a grey.

Separately, `components/ui/sheet.tsx:133` paints `bg-background` on every `SheetContent`, and
`docs/mobile-ui-and-performance.md:97` says screen backgrounds must go through `bg-page` rather than
opaque paint because it "silently hides any wallpaper layer". The rule was written about screens;
the sheet primitive does it to **49 files**. The owner's screenshots show it — the gradient survives
above the sheet edge and dies below it.

## Not exercised

No code changed and nothing was run against a browser. Figures come from the read-only production
query endpoint and direct source reads.

## BF-148 — fixed the same night, and my filed diagnosis was wrong

The owner opened his recalibrated Lower session and got a normal workout: header reading
"Baseline · S1 · Ex 1/5" above a set card prescribing 3 × 92.5 kg × 8.

I filed this blaming the program-phase engine and the `leader.phaseStatus` collapse. That collapse is
real, but it is not what he hit. The operative term was a third condition on `isAiDynamicBaseline` in
the same route:

```ts
const hasAnyPriorLog = priorLogsThisProgram != null && exerciseNames.some(name => priorLogsThisProgram.has(name))
```

`exerciseNames.some(...)` — the identical name-keyed shape BF-143 and BF-144 already corrected in two
other places, here for a third time. Lower's exercise names were logged in this program before the
rebuild, so the flag was true and the baseline was vetoed.

It is removed rather than repaired, in both paths, taking the now-unused `priorLogsThisProgram` fetch
with it. It was a proxy for stale periodization state, and BF-143 made that state trustworthy: the
auto-heal only completes a baseline on evidence that this session was interrupted. `generate-prescription`
already trusts the same pair to refuse a prescription, and the header and pre-workout panel already
render from it — so the set card now agrees with the rest of the screen rather than holding a second
opinion.

A date-keyed repair was considered and rejected. A log newer than `phaseStartedAt` appears the moment
the first set is logged, which would drop the AMRAP display half way through the workout it exists
for. BF-143's auto-heal can use that test because flipping true mid-session is correct there.

The test asserting the old behaviour was replaced deliberately, and both surviving terms are
mutation-checked. The first attempt pinned only one of them and the mutation survived, which is why
there are three cases rather than one.

**Not exercised:** the authenticated body of the route was never run by a browser. `pnpm dev` confirms
both paths load and return 401 without a session cookie; no real session was available.

## BF-150 — the owner's call on which number he eats to

He asked when the budget would return to the figure he expects, "the 1350+ exercise". The honest
answer was: not on its own, and not soon. Measured from his screenshots, the base went 2,150 on the
11th to 2,196 on the 12th — **+46 kcal in a day** — because the calibrated maintenance is fitting a
retatrutide weight drop and reading it as metabolism. At 2,196 it is 1.44 × his 1,527 BMR in a field
the card labels *resting*, and the gap against what he expects is ~646 kcal.

He also cannot opt out. `resolveMaintenance` returns `source: 'calibrated'` the moment either window
fills, unconditionally — no override anywhere in the app. So every day that passes re-anchors him
higher and nothing he can touch changes it.

Two routes were put to him: fix the estimator (BF-137's drug-window exclusion), or anchor the daily
budget to the goal he already set and leave the estimator as information. He chose the second and
asked for it at the top of the queue, so BF-150 leads Lane A.

The reasoning for that recommendation, recorded because it is a product decision rather than a bug
fix: excluding the drug window is the principled repair, but it needs a judgement about when the
data is trustworthy again, and until then he would still be eating to a number he did not choose.
Anchoring to the stored goal is one line of intent, reversible, and correct regardless of where the
estimator eventually settles. It also closes BF-142's gap from the other side — with the budget and
the grams sharing a denominator, the paragraph explaining why they differ stops being needed.

What it gives up, stated so it is not re-opened as a defect later: the app stops auto-adjusting his
intake as his metabolism changes. That is the trade, it is deliberate, and it is revisitable once he
is off the drug — which is the point at which BF-137 becomes the right tool.

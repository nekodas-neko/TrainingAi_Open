# AI Coach — Phase 3: the write domains and the rest of the vocabulary

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Coach from one write domain to the full set the owner approved, and add the widgets
those domains need. Each domain lands with its `ChangePreview` shape, its computed consequences, and
its tier.

**Depends on:** Phases 1 and 2 merged. This phase adds cases to structures that already exist — if
you find yourself changing the protocol, stop and reconsider.

**Design source:** `docs/design/2026-08-08-ai-coach-round3-widgets.html` §2 (D1–D5) and
`docs/design/2026-08-08-ai-coach-conversational-ui.html` §2 (widget catalogue W1–W8).

---

## Scope, as the owner set it

| Domain | Tier | Confirms as | Write path |
|---|---|---|---|
| Session exercises | 2 | Inline | Phase 1 — already done |
| Nutrition targets / user goals | 1 | Inline, dial *is* the confirmation | `upsertNutritionTargets`, `updateUserGoals` |
| Injury | 2 | Inline | `createInjury` — **and nothing else, see Task 3** |
| Cardio goal | 2 | Inline | `saveRunningPlan` / running-goal fields |
| Phase settings / phase set | 3 | **Pushed screen, hold to confirm** | `updateProgramPhaseSettings`, `updatePhaseSet` |
| Early deload | 3 | Pushed screen | `/api/confirm-early-deload` — existing route, call it |
| New program | — | Handoff, no write | Links to the existing generator |

**Never writable, no exceptions:** set logs, workout sessions, sleep, HR, scale and ring metrics,
food logs. Owner confirmed no record-logging in v1. Every analysis Coach gives is only worth
something if it never touched the record it reasoned from — and device-sourced rows go through the
ranked per-field merge in `lib/data/health-source.ts`, where an AI write has no honest source rank
to claim.

---

## Task 1 — the remaining widgets

Add each as a member of the `CoachWidget` union from Phase 1. None of them changes the protocol.

- [ ] `verb_chips` — 2–5 short actions, 48dp min-height each. One may be tinted as recommended: a
      steer, never a default that fires on its own. Above five options, use `choice_list` instead.
- [ ] `search_picker` — suggested rows plus a search row over a catalogue. **The search row is not
      optional.** A picker offering only three ranked options is a decision wearing a choice's
      clothes. Every suggestion carries its reason on the subtitle.
- [ ] `number_dial` — reuses `components/ui/weight-dial.tsx`, not a new control. Must render the
      delta from the current value; a number without the one it replaces is meaningless. For tier-1
      values the dial **is** the confirmation — no separate `change_preview`.
- [ ] `multi_select` — the one widget needing an explicit submit, since there is no natural moment of
      completion. Button counts as you go.
- [ ] `receipt` — what was applied, with Undo (Phase 1 Task 6 built the endpoint). Green, not purple:
      it is done and asks for nothing.
- [ ] `handoff` — a tappable destination for out-of-scope asks. Neutral frame, because a link is
      output. One component serves new-program, log-a-run, edit-a-past-workout and settings.

## Task 2 — nutrition and goals (tier 1)

- [ ] Domains: nutrition targets (`upsertNutritionTargets`) and user goals (`updateUserGoals`).
- [ ] **`updateUserGoals` also writes through to localStorage.** `components/profile/goal-recommendation-sheet.tsx:125-127`
      sets `ta_steps_goal`, `ta_calorie_goal_kcal`, `ta_water_goal_ml` because Home widgets and the
      Profile Goals section read those, not the DB. Coach must do the same or the applied change
      will not appear until a reload. Extract the write-through into a shared helper in this PR
      rather than copying three `setItem` calls — that is a sibling-surface sweep, and a second copy
      is how these drift.
- [ ] Reuse the existing `goal_recommendations` propose/apply flow where it already covers the case,
      rather than adding a parallel path.

## Task 3 — injury (tier 2, and much smaller than it looks)

**Read this before building anything.** The owner's instruction was that the coach's injury handling
should match what already happens when an injury is entered manually — deload the session until it
is marked recovered, or swap exercises where possible. **That behaviour already exists in full**, and
Coach must not reimplement any of it:

- `packages/shared/src/ai-periodization/signals.ts:326` computes `activeInjuredMusclesInSession` from
  active injuries.
- The periodization prompt receives it and can return `phaseAction: 'session_swap_recommended'` or
  `'deload_recommended'` (`packages/shared/src/types/ai-periodization.ts:52`).
- `packages/shared/src/ai-periodization/emergency-deload.ts:21-25` deliberately excludes injuries as
  a *standalone* blunt trigger (AI-4) so severity and muscle get weighed instead of every niggle
  forcing a 2-set/50% branch. **Do not "fix" this** — it is a considered decision with a comment
  explaining itself.
- `packages/shared/src/workout/injury-substitution.ts` exports `injurySafeAlternatives`, already
  consumed by `components/workout/injury-swap-sheet.tsx` at workout time.

So the task is small:

- [ ] Coach writes the injury record via `createInjury` and stops. Everything downstream — deload
      weighting, session-swap recommendation, per-exercise substitution — happens through the
      existing engine because the record exists.
- [ ] The `ChangePreview` states what will follow rather than doing it: "affects N exercises in your
      Lower session; the recommendation engine will weigh this from your next session."
- [ ] Ask **one** question, not four. Side and body part come from the user's sentence; dates
      default; severity (`mild | moderate | severe`, matching `packages/shared/src/types/injury.ts`)
      is the only thing genuinely un-inferrable.
- [ ] Resolving an injury is the same flow in reverse — set `resolvedDate`. The design mockups did
      not cover this and they should have; "my shoulder's fine now" is as common as the report.

**The round-3 mockup D3 shows a "flag 3 exercises" toggle and describes flagging as warn-not-remove.
That is superseded by this task** — the note has been corrected in the design file, but if you are
reading the picture rather than the caption, the picture is out of date.

## Task 4 — cardio goal (tier 2)

- [ ] Goal, not a logged run. Feeds the running plan.
- [ ] The consequence that matters: a goal implying more sessions per week collides with the lifting
      schedule. Compute which day it lands on and say so. That is the difference between setting a
      goal and setting a realistic one.

## Task 5 — tier-3: the pushed confirmation screen

- [ ] `app/coach/confirm/[changeId]/page.tsx` — a real route, so back-button behaviour is free.
- [ ] Renders the same `CoachPatch` payload as the inline `ChangePreview`, in the fuller layout:
      before/after block, computed consequence list, reasoning, hold-to-confirm.
- [ ] **Hold-to-confirm, not tap**, and the only non-purple action in the system, because a phase
      change is the only one that takes something away (it resets the cycle counter).
- [ ] Bottom-anchored action row on a navless full-screen route → **`pb-safe-action-lg`**.
- [ ] Include the good news where it is true. A consequence list that only warns reads as a scare.

## Task 6 — deload routes to the existing endpoint

- [ ] `/api/confirm-early-deload` already exists and already confirms. Coach proposes and hands to
      it. Do **not** add a second deload implementation — one formula, one place.
- [ ] Present the evidence as its own output card (HRV vs baseline, sessions under prescribed load,
      ACWR) beside the proposal. Three numbers beat a paragraph of hedging, and showing them lets the
      owner disagree on the merits.

## Task 7 — the pairing rule

Owner chose T2 as the default with T4 for long lists.

- [ ] Fused: one card, chart on top, option rows below, **rows act as the legend** (the `colorKey`
      field on `choice_list` options from Phase 1). 2–6 items.
- [ ] Over six items: per-row sparklines, no combined chart. Every row stays a clean 56dp target.
- [ ] Bar-tapping (T3) stays available for small ranked comparisons. Make the **whole column**
      tappable, not the bar — a low-value bar is otherwise a 6dp-high target.
- [ ] Encode the selection rule in the system prompt. This is the actual work; the components are
      the easy part.
- [ ] Sparklines use `components/ui/sparkline.tsx`. Do **not** add a sixth inline `<polyline>` — five
      already bypass the primitive and are queued for replacement.

## Task 8 — voice

- [ ] Terse: one or two sentences plus a widget. The widget carries the detail; prose restating what
      the widget already shows is noise.
- [ ] Proactivity level (b): volunteer a relevant observation mid-answer — the stalled lift, the
      protein gap — because the tools to know it have already run. No brief-on-open.
- [ ] Out-of-scope asks get one sentence, no apology, a real handoff destination, and an offer of the
      nearest thing Coach *can* do.

---

## Cross-cutting requirements for every domain added here

Each of these has its own recurring-bug entry in CLAUDE.md. A new domain that skips one is how the
class recurs.

- [ ] The apply path re-validates against current state and returns 409 on drift (Phase 1 Task 5).
- [ ] Ownership is verified, including for tables with no `user_id`, via a join to the owning table.
- [ ] Cache invalidation goes through a **named group** in `lib/cache-groups.ts`, never a hand-rolled
      key list at the call site.
- [ ] The write goes through the domain's existing shared function — the same one the web route and
      the `pushMutations` branch use. If there isn't one, extract it here.
- [ ] Consequences are computed server-side, never authored by the model.
- [ ] `docs/module-map.md` gets a row for `lib/coach/` in the PR that creates it.

## Failure surfaces

Same gate as Phase 2: the tier-3 pushed screen is a new full-screen surface with a bottom-anchored
action row, which is precisely the shape that has regressed 11+ times on gesture-nav. It is
**not verified until seen on the S25** — sandbox renders every inset as 0.

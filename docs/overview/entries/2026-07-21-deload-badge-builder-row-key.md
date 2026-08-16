# 2026-07-21 — Deload badge on exercise history + stable builder-review row keys (W4 §5.7 / W6 §2.4)

**Branch:** `feat/deload-badge-builder-key` · **Version:** 1.186.0

Two small, independent items from the 2026-07-20 audit backlog, batched into one PR at the owner's
request ("build all"). Owner chose the badge label **"Deload"** (interactive intake).

## What landed

- **Deload badge (W4 §5.7).** The exercise-history sheet's Session Log rows now render a small amber
  `Deload` pill next to the weight when `entry.isDeload` is true. The flag was already computed
  server-side (`app/api/exercise-history/route.ts` → `ExerciseHistoryEntry.isDeload`) and already
  present on each entry in the UI — no plumbing added. Amber matches the app's existing deload
  convention (`weekly-stats-hub.tsx` "D" marker); colour comes from the `--accent-amber` theme token
  (defined light + dark), not a hardcoded palette class.
- **Builder-review stable row key (W6 §2.4).** Exercise rows in the program builder review
  (`builder-review.tsx`) were keyed by array index (`key={ei}`), so reorder/swap could leak a
  row's transient state to its neighbour. Added an optional `clientId` to `GeneratedExercise`
  (`lib/types/builder.ts`), mint any missing ones in a normalising effect (AI generation and
  builder-chat responses arrive without one), preserve it through `swapExercise`, and key on it.
  Matches the nutrition ingredient `clientId` pattern (`review-step.tsx`). `clientId` is dropped at
  save (`handleSave` mints fresh server UUIDs) and stripped by the builder-chat Zod schema (default
  object strips unknown keys), so it never reaches the DB or the Gemini prompt.

## Verification

- tsc + lint clean (0 errors). CI gate green.
- **Both are UI-render changes not exercised in the sandbox for their trigger states:** the deload
  badge needs a history entry with `isDeload: true` (server path only — the offline local-seed path
  still stubs `isDeload: false`, a pre-existing documented limitation, so the badge is transiently
  absent offline until the fetch lands), and the builder key needs the AI program-builder flow.
  Both are trivial conditional-render / key-prop changes with no new data flow. Device-smoke:
  open a completed deload week in exercise history and confirm the amber pill shows; in the program
  builder, reorder/swap exercises and confirm no stale input bleeds between rows.

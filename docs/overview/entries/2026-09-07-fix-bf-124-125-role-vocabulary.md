# 2026-09-07 — one word per role, and the review screen can finally set it (BF-124, BF-125)

**Branch:** `fix/bf-124-125-role-vocabulary` · **Lane B** · shipped together because each entry says
to: they disagree about the same three words, and settling it in one place is most of both fixes.

## What the owner saw

Two reports off the same generated program. *"why does one of these have 2 compounds?"* then *"so how
would i change its badge?"* — and, from the BF-123 screenshot, a role row on the program editor sheet
with `Accessory` clipped at the right edge and the selected pill rendering as a white slab.

## The vocabulary

`components/workout/exercise-role-labels.ts` (new) owns the three words. Review said **Main /
Compound / Accessory**; the editor said **Main Compound / Secondary Compound / Accessory**. Same
three enum values, two wordings, and a user meets both doing one thing — spot a bad role on review,
go to the editor to change it.

The short set wins, and neither of the two existing sets was it: **Main / Secondary / Accessory**.
*Main* and *Compound* are not parallel — a main lift **is** a compound, so the old review labels read
as two different axes rather than a ranking — and the long set is what overflowed the editor's row.
The type stays the canonical `ExerciseRole` from `packages/shared/src/types/program.ts`; this module
names the words the user reads, not the values the app stores.

## BF-125 — the role is editable where it is visible

`builder-review.tsx` rendered the badge read-only. It is now a button that discloses the three
options inline, copying the file's existing `swapOpen` disclosure shape rather than adding a new
one — `roleOpen` beside it, `setExerciseRole` beside `swapExercise`.

Only `exerciseRole` moves. The progression style is derived from the role server-side at save
(`generate-program/route.ts:428` overrides the model's choice for `primary`/`secondary`), which is
exactly what the editor's own role control relies on, so the review screen does not need to — and
must not — set a style of its own.

## BF-124 — the row fits, and the chosen option looks chosen

Measured against the tokens rather than the screenshot: `--primary` is `oklch(0.922 0 0)` in dark —
near-white, near-black text. `bg-primary text-primary-foreground` on a chip therefore paints a white
slab that reads as disabled beside its own `bg-muted` siblings. Every other chosen state on this
sheet uses `bg-brand`, which is why the schedule-mode buttons read correctly and this one did not.
Now `bg-brand text-brand-foreground border-brand font-semibold`, plus `aria-pressed`, which the row
never had.

`components/config/phase-editor.tsx:191` carried the identical pair for its phase-type chips —
same defect, same sheet, fixed in the same PR per the sibling-surface rule. No `bg-primary
text-primary-foreground` selected state remains outside `ui/button.tsx`, `ui/input.tsx` and the
chat bubble, where it is correct.

The row is `flex flex-wrap gap-1.5` and the `Role` caption moved onto its own line instead of
sharing the chips' flex line. **Measured at 412 dp after: nothing is clipped** — `Main` 55×30,
`Secondary` 86×30, `Accessory` 82×30, `aria-pressed` correct on each. It still wraps `Accessory` to
a second line inside the deeply-indented exercise card, which is what the entry asked for
(*"It needs to wrap, or the labels need to be short"*) rather than a residual bug, but it is two
lines, not one.

## The guard

`components/workout/__tests__/exercise-role-labels.test.ts` pins the three words and the fallback,
and holds the single-source rule by **search** rather than by a file list — a third screen showing
roles is exactly what the guard is for and would not be in any list written today. A decoy file
was planted to confirm the search actually matches a re-declaration; it did.

Two source guards cover BF-124, because both halves are layout and token choices with no runtime
behaviour to assert and this project's vitest is `environment: 'node'`, so a `.tsx` cannot be
rendered.

## Not verified

**Not run on device.** No APK — these are component changes reaching the WebView through Railway.
The editor's role row was opened and measured in the Playwright harness at 412 dp. **The review
screen's new control was not**: reaching it needs a generated program, which is a live Gemini call
the harness does not make. Its logic is the file's own disclosure pattern and its state setter
mirrors `swapExercise`, both unchanged in shape — but the rendering is unexercised, which is the
weaker half of this PR's evidence and the first thing to look at on device.

## Found, not fixed

`components/ui/switch.tsx:16` marks its on state with `data-[state=checked]:bg-primary` — the same
near-white token, so every Radix switch in the app is white-when-on for the same reason the role
pill was. It is a shadcn default used app-wide and recolouring it is a far wider visual change than
either entry asks for. Filed as **LB-61** rather than folded in.

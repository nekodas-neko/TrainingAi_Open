# 2026-08-17 — Q-350: arrow keys for the eight radiogroups

**Branch:** `claude/implementation-lane-b-0o7kb9` · **Version:** v1.318.7 · **Lane:** Implementation B

## What was missing

Eight `role="radiogroup"`s, none with arrow-key navigation or a roving tabindex. `Tab` walked every
option individually and the arrows did nothing — so a group of five options was five tab stops
instead of one, and a screen-reader user navigating by keyboard could not do the thing the role
promises.

Three of the eight predate this work (`workout/deload-toggle`, `workout/session-duration-picker`,
`more/home-widgets-section`); five were added by Q-261, which matched their shape deliberately
rather than shipping five with keyboard nav next to three without.

## The shape, which is not what the entry proposed

Q-350's entry asked for a shared `components/ui/` radio-group **component** taking
`{ options, value, onChange, label }`. I built a **hook** instead —
`lib/hooks/use-roving-radio-group.ts` — and the reason is the eight call sites:

| Site | Visual shape |
|---|---|
| `deload-toggle`, `session-duration-picker` | two-line segmented pills in a grid |
| `home-widgets-section` | bordered card list with a check icon |
| `profile/goal-targets-section`, `required-info-section` (activity) | card list with title + description |
| `required-info-section` (sex) | equal-width pill row |
| `edit-profile-sheet` (units, region) | compact segmented strip |

Five genuinely different renderings. A single component covering them needs either a render-prop for
the option body or enough styling props to reconstruct each one, and that abstraction fits none of
them well. **What every site was missing is behaviour**, so behaviour is what got shared. The markup
stays where it is and stays readable.

Two design points inside the hook:

- **Options are read from the DOM** (`querySelectorAll('[role="radio"]')`) rather than from a list
  passed in. It keeps the hook agnostic about rendering and it cannot disagree with what is on
  screen.
- **Selection is delegated by clicking the target**, not by calling back with a value. Each site owns
  its own semantics — some clear when you re-pick the active option, some cannot be cleared — and
  routing the keyboard through the `onClick` those buttons already have means the hook cannot get any
  of that subtly wrong. Arrow keys never land on the already-active option, so the deselect-on-repick
  sites are unaffected.

## The guard, and the finding that came out of writing it

`e2e/radiogroup-keyboard.spec.ts`, mutation-checked in both halves: removing `onKeyDown` from
`groupProps` fails the arrow assertions; replacing the computed `tabIndex` with a constant `0` fails
the single-tab-stop one.

The first draft drove **Fitness Goal** and failed on `toBeFocused` — selection moved correctly, but
focus was gone. That is not the hook. `handleFitnessGoalChange` calls `patchProfile`, which sets
`saving`, and those buttons carry `disabled={saving}` — **a browser drops focus from an element that
becomes disabled**. So on the three goal groups, an arrow keypress moves the selection and then
ejects the user from the group.

Filed as **Q-355**. It affects 3 of the 8 (the workout pickers, the two Edit Profile strips and the
home-widgets list do not disable on change), and the spec now reflects the split honestly: Food
Region asserts the full contract, Fitness Goal asserts only that selection moves.

I could have made the spec pass by dropping the focus assertions everywhere. Keeping them on a group
that can hold them is what makes the file say something true about the app rather than something
true about the test.

## What was NOT exercised

- **A screen reader.** Chromium's accessibility tree exposes `aria-checked` and `tabindex`, which is
  what the spec reads. Nothing here is TalkBack on the S25, and that remains the outstanding check
  for every accessibility change this lane has shipped.
- **A physical keyboard on the device.** The canonical runtime is touch-only, which is precisely why
  this was low priority; the value is for future desktop/keyboard use and for automated a11y scanning
  (Q-282), not for the owner today.
- **Six of the eight groups**, in the harness. The spec drives Food Region and Fitness Goal. The
  other six take the identical hook, and typecheck plus the full E2E suite confirm nothing regressed,
  but no assertion drives them individually.
- **Home/End keys**, deliberately not implemented — optional in the ARIA practices, and no call site
  is long enough to want them.

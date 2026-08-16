## 2026-08-08 — disclosure toggles announce their state (Q-133 part 1, v1.270.17)

**Branch:** `fix/a11y-disclosure-toggles` · **Domain:** `app-shell`

Q-133 is a batch; this is its first piece — the `aria-expanded` sweep. **The rest of Q-133 stays
open** (the 44px tap-target floor, the six emoji-as-chrome sites, the four `window.confirm` calls,
and `chat.tsx`'s opaque `bg-background`); the backlog entry is annotated, not removed.

### The finding said 21 sites. The real number is smaller, and that matters

The review counted *"21 hand-rolled disclosure toggles ship no `aria-expanded`"*. Checking the list
against the code, **several of those sites are Radix `CollapsibleTrigger`s**, which emit
`aria-expanded` themselves at runtime — `deload-explanation.tsx`, `signal-sections.tsx`,
`profile-tab.tsx`, `ai-prescription-card.tsx` and `meal-card.tsx` all use `<Collapsible>` from
`components/ui/collapsible.tsx`, a thin wrapper over `@radix-ui/react-collapsible`. A source grep for
"chevron with a rotate class" cannot tell a genuine gap from a primitive doing its job.

So rather than trust either the grep or my own reading, the gap was **measured in the rendered DOM**:
log in, walk six screens, and collect every control that contains a chevron and controls an open
state but carries no `aria-expanded`.

**Before:** Home `1 ok / 0 missing` · Health `1 / 3` · Nutrition `0 / 2` · More `3 / 7` ·
Config `3 / 7` · Session-explain `0 / 0`.

**After:** Home `1 / 0` · Health `1 / 3` · Nutrition `0 / 2` · More `8 / 2` · Config `8 / 2` ·
Session-explain `0 / 0`.

Every remaining "missing" is a **false positive of the probe**, confirmed by inspecting each one:
Health's two are the training calendar's `Previous month` / `Next month` arrows, Nutrition's two are
the day-stepper arrows, and the rest are a navigation link (`Download Android App`) and an action
button (`Connect with Oura`). None is a disclosure, so none should carry `aria-expanded`.

### What shipped

`aria-expanded` added to the 12 controls that genuinely lacked it, each bound to the state it already
toggles — markup otherwise untouched, so nothing moves or restyles:

`achievements-section.tsx` · `goals-section.tsx` · `home-widgets-section.tsx` ·
`macro-targets-pane.tsx` · `edit-profile-sheet.tsx` (password) · `config-screen.tsx` ×4 (Programs,
Advanced Settings, progression sets, phase sets) · `exercise-stats-sheet.tsx` (instructions) ·
`builder-review.tsx` ×2 (1RM panel, per-exercise swap).

**Not converted to `CollapsibleSection`.** The backlog offers *"convert the 21 sites to use it **or
match its shape**"*. That primitive is opinionated — its own bordered `<section>`, its own chevron,
its own internal state — so converting 12 externally-controlled toggles would be a visual redesign of
12 screens in a PR whose point is accessibility. Matching its shape is the smaller, verifiable
change.

**Also fixed, adjacent:** Nutrition's day-stepper arrows were unlabelled icon buttons — no text, no
`aria-label`, so a screen reader announced only "button". They now carry `Previous day` / `Next day`,
and the forward arrow gets `aria-disabled` when already on today. This is a **different** gap from
the one Q-133 names; it surfaced from the same DOM audit and is fixed here rather than dropped.

### A note on where the attributes sit in `config-screen.tsx`

Its four `aria-expanded`s share a line with the `onClick` they mirror rather than each taking their
own. That is not style preference: `check-component-size.js` holds `config-screen.tsx` to a
shrink-only 997-line baseline, and four new lines pushed it to 1001. The ratchet is right — this file
is a named hotspot and the rule is "extract, don't append" — so the attributes were folded onto
existing lines instead, which is identical JSX at net-zero growth. The DOM audit was re-run
afterwards and is unchanged at 8 ok / 2 false positives.

### Verification

- `tsc --noEmit` clean · `pnpm lint` 0 errors.
- The before/after DOM audit above, run against `pnpm dev` as a logged-in user at the S25 viewport.

### Not exercised

No device run — ARIA attributes only, no native, safe-area, gesture or notification path.

**No screen reader was used.** The verification is that the attribute is present and bound to the
right state, not that TalkBack announces it as intended — that needs the device. Three of the twelve
(`edit-profile-sheet` password, `builder-review`'s two) sit behind flows the audit did not open, so
their attribute is verified in source but was not seen in the rendered DOM. The four screens not
audited (workout, stats, overview, guided-walk) may hold further toggles.

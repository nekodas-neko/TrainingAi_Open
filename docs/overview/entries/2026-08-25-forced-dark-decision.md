# 2026-08-25 — one theme, one design

**Branch:** `docs/forced-dark-decision` · docs-only · BugFix Intake

## The decision

*"yes lets keep it as forced dark mode. then we need to only make one UI/design."*

BF-25's `Gate: owner` is cleared. The one-line change — `forcedTheme="dark"` on the `ThemeProvider`
in `app/layout.tsx:140` — is now ordinary Lane B work.

Worth restating why the question was worth asking at all: **there was never a theme switch.**
`setTheme(` has zero call sites, and the provider ran `defaultTheme="system" enableSystem`. Light
mode was not a preference anyone had expressed; it was what the app became if the S25 was ever set
to light. The owner was choosing whether that could happen, not which of two designs to keep.

## Why this went into `CLAUDE.md` and not only the backlog

The second half of the instruction — *"we need to only make one UI/design"* — changes what **every
future session does by default**: design in one theme, verify in one theme, draw mockups in one
theme, stop filing light-mode bugs. A backlog entry is read by whoever picks up that entry. A
standing rule is read by everyone, at session start, which is what this needs to be.

Two lines in it earn their place.

**Do not delete the light palette.** The `:root` block in `globals.css`, the `resolveColor` scheme
pairs, `HERO_GRADIENTS`, `screen-palettes.ts` and the `resolvedTheme` reads cost nothing at runtime
while unreachable. Deleting them is a wide hand-verified sweep whose only benefit is tidiness, and it
is the one irreversible half of this decision. Pinning the theme is a prop; unpinning it is deleting
that prop.

**Theme is pinned, accent is not.** This is the distinction a reader will otherwise get wrong.
`data-brand` — `blue · purple · orange · pink · cyan · red · gold` — is still user-picked, so a hex
literal still bypasses the colour the user chose, and `check-hex-literals.js` still ratchets it.
Without that sentence, "dark only" reads as "literals are fine now", which would quietly break the
brand picker.

## The four existing rules were amended, not deleted

`CLAUDE.md` carried four light-mode hazards. Each was rewritten in place to say which half dark-only
retires and which half still binds, because a deleted rule leaves no record of why it went — and two
of them still guard live failures:

| Rule | What survives |
|---|---|
| Screen backgrounds / scrim | verify in dark; DetailHero hardcoding dark is now **correct**, and the line is kept so nobody "fixes" it back |
| Hero/decoration SVGs | a cutout still paints over the dynamic-background wallpaper layer |
| Canvas/SVG chart colours | the `rgba(255,255,255,…)` default is moot; **`var(--x)` in canvas paint still renders black** |
| `useTheme()` mounted-gates | the flash is closed — defaulting to dark is now the right answer |

## What is owed

BF-25 still carries `Gate: device` and one pre-flight check: three components document depending on
`next-themes` stamping `.dark` on `<html>` **synchronously before React hydrates**. That needs
confirming under `forcedTheme` rather than assuming — if it does not hold, a page-root surface
flashes on every navigation, which is the exact bug this change is meant to close.

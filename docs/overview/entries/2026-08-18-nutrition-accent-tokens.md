# 2026-08-18 — Q-395 findings 1–2: nutrition stopped opting out of the accent

**Branch:** `claude/implementation-lane-b-0o7kb9` · **v1.324.5** · **Lane:** Implementation B

Q-395 is a taste request — *"can we backlog a UI uplift for the nutrition side"* — and the entry
does the useful thing with it: it separates the part that is **objectively wrong** (findings 1–3,
each with a CI check already measuring it) from the part that is genuinely a design decision
(findings 4–5, which need mockups). This ships the first half.

## What was actually wrong

`--brand` is **user-selectable at runtime** (`theme-color-picker.tsx` writes it from a hue the user
picks), and `globals.css` deliberately *darkens* the light-mode value because the vivid dark-mode
green is unreadable as light-mode text.

Every `#22c55e` in the nutrition surface opted out of both. Pick a blue accent and nutrition's
selected chips and checkboxes stayed green; switch to light mode and they stayed at exactly the value
the CSS goes out of its way to avoid. Same story for `#ef4444` where `text-destructive` already
existed — `ingredient-row.tsx` used the token correctly and its neighbours did not.

## What shipped

Every one of them is now `brand` / `destructive`. **Repo total 471 → 428**, and **eight nutrition
files came off the hex baseline entirely** — which is the part that lasts: a file with no baseline
row is held at zero, so this class structurally cannot come back in them.

**One site needed more than a swap.** `meal-plan-section.tsx` passed its literal to
`accentCardStyle()`, and that helper needs real colour channels for its gradient — it **returns an
accent-less card for anything that is not a hex**, so handing it a `var()` would have silently
dropped the tint rather than failing. Its gradient is now built locally with `color-mix` on
`var(--color-brand)`, mirroring the helper's output including the `willChange` layer promotion that
exists for the Samsung WebView bug where an SVG in one card wipes a sibling's gradient.

Finding 3 — both landing files sitting at the 800-line ceiling — **did not bite**, because replacing
a literal with a token is line-for-line. It is still true, though: `nutrition-content.tsx` is *exactly*
at the limit, so the extraction remains the first commit of any change that adds a line.

## Routed, not done: Q-391

While working the queue I checked Q-391 (a per-workout kcal stat) and **its deferral note undersells
the blocker**. It says "the Q-230 bundle hazard from a client component". The real reason is harder:
`estWorkoutKcal` → `getEnergyFeatureSpec()` → `readJson` → **`fs.readFileSync`**. That cannot run in
a browser at all, so there is no "accept the bundle cost" option — the figure has to come from the
server, which makes `/api/day-log` (Lane A's) part of it. Recorded on the entry so the next session
does not re-derive it.

Q-467 was also skipped deliberately: it carries an explicit **⛔ do Q-468 first**, and Q-468 is in
`undoCoachChange` — Lane A's. Wiring the Undo button now would ship the defect that entry describes.

## Guard

The hex ratchet is the guard, and it is a better one than a test here: eight files are now held at
**zero**, so a re-introduced literal fails Custom Rules in the PR that adds it. Verified by build,
lint, `check:rules` **39 of 39**, and the nutrition E2E specs.

## What was NOT exercised

- **Nothing was looked at.** This is a colour-token change verified by compiler, ratchet and specs —
  **not by eye, in either theme.** The whole point of the change is how it looks when the accent is
  not green, and no screenshot was taken at any accent.
- **Light mode specifically** — the darkened `--brand` is half the reason for the change and was not
  visually confirmed.
- **The device.** Chromium at 412×915.
- **Findings 4–5 are untouched**, deliberately: the entry says they need mockups before code.

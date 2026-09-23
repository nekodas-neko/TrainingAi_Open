# 2026-09-23 — DV-11: 17 of 25 switches had no accessible name

**Branch:** `fix/dv11-switch-accessible-names` · **Lane:** B · eleven files, one guard, one test

Device Verification found one unnamed switch on the supplements sheet — a `role="switch"` button
with no `aria-label` and no labelled-by, announced as "switch, on" with nothing to say what it
controls. The sweep that followed found the same defect on **17 of the app's 25 switches**, across
settings, meal types, goal recommendations, the workout builder and the admin activity manager.

All 25 have a name now.

## The entry named one sheet; the class was app-wide

Each of those switches sits beside a visible `<p>` that names it perfectly well on screen and to
nothing else. That is why the class survives: it looks right, and only a screen reader disagrees.
The device sweep found the supplements sheet because that is the screen it was on.

## Why the existing check did not catch them

`scripts/check-icon-button-names.js` walked `<button>` and `<Button>` opening tags and **skipped
self-closing ones outright**, because a self-closing button has no body and the icon-only shape
cannot apply. A `<Switch />` is the opposite: self-closing is its only shape, so it was never
examined.

Extended rather than duplicated — Custom Rules stays at **`Ran 76 of 76`**. The tag walker is now
parameterised, which matters because PS-34's comment on that walker exists precisely to stop anyone
hand-rolling a second `[^>]*` version that ends the tag at the `>` of an inline arrow.

**Unlike the icon-button half, this pass is not a heuristic.** A `Switch` renders a thumb and no
text child, ever, so "no naming attribute" means "no accessible name" with nothing to trade against
under-reporting. The baseline stays **empty**: an unnamed switch is a regression, not a debt row.

## The first measurement was wrong, and that is the reusable part

Matching `<Switch` a line at a time reported **26 of 28**. The truth is **17 of 25**. Nine were
false positives — three were the primitive's own definition, and six were multi-line switches whose
`aria-label` sat on a later line.

That is the same mistake made earlier the same day, on a three-line call whose timezone argument sat
on line 3. **Read the tag to its balanced close, not the line.** It is now a baton lesson.

`scripts/__tests__/switch-accessible-name.test.ts` drives the exported detector directly and pins
nine shapes: same-line and later-line names, a genuinely unnamed multi-line switch, an inline arrow
(PS-34's shape), a `>` inside a quoted attribute, `aria-labelledby`/`title`, `<SwitchGroup>` not
being mistaken for the primitive, and several in one file at their own lines.

The CLI half is now behind `require.main === module`, so importing the detector has no side effect.
The sibling `check-admin-guard-catch.js` exports without that guard, and importing it runs a full
repo scan that can `process.exit(1)` on an unrelated regression.

**Control runs:** removing the name from a self-closing switch and from a multi-line one each fail
the check at the right file and line; both restore green.

## Not done, and not claimed

**`Verify: device` + `Keep:`** — the pass test is a screen reader on the S25 announcing each switch
with its name. The sandbox proves the attribute is present; it cannot prove what TalkBack says. Two
labels are worth a second look on device: the supplement row uses the supplement's own name, and
the goal-recommendation rows use `row.label`.

Also not exercised: Samsung WebView rendering, native SQLite / Capacitor, drifted production data.

## Also in this PR

The **Lane B baton** was rewritten in full — owed for three PRs. It is shrink-only, so making room
for three new lessons (the test-typecheck gap, the two fetch traps, and balanced-close matching)
meant cutting older narrative and moving LB-129's ruled-out candidates into LB-129's own entry,
where they belong. It came back to exactly 55 lines rather than raising the ratchet.

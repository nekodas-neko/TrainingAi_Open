# 2026-09-24 — RV-121: the `moodWidget` pickers named the readiness score

**Branch:** `fix/rv121-readiness-label-collision` · **Lane:** B (Implementation) · **Domain:** app-shell

## What shipped

Three affordances that *select* the morning check-in card labelled it **"Readiness"**:

| Site | Was | Now |
|---|---|---|
| `components/more/home-widgets-section.tsx:52` | `label: "Readiness"` | `"Exercise Readiness"` |
| `components/home/home-card-widget.tsx:213` | `label="Readiness card"` | `"Exercise Readiness card"` |
| `app/session-select/session-select-content.tsx:1329` | `card_moodWidget: 'Readiness'` | `'Exercise Readiness'` |

`oura-score-chip-row.tsx:427` labels the **computed readiness score** "Readiness", and it renders
on the same screen. The card itself already said "Exercise Readiness"
(`readiness-checkin-card.tsx:35`) — only the pickers disagreed with it. So the owner chose between
two different numbers under one name, and the wrong pick is silent.

**The entry named one site; there are three.** That is the whole of the difference between reading
the entry and reading the code, and it is why the test asserts the *agreement* between the card's
own heading and its three pickers rather than a literal string: rename the card and the test still
holds.

## RV-121's other half went to the owner

The entry also found that `/collection` is reached from **exactly one** place in the app
(`home-card-widget.tsx:330`, inside `case 'card_collectionWidget'`, which returns `null` unless the
widget is on) while `DEFAULT_CARD_WIDGETS` is `[]`. That is not Lane B's to decide — the two ways to
fix it are a More-tab row or turning a Home card on by default, and the second changes what Home
shows, which is the owner-gated mockup class.

So **RV-121 stays alive as a `Lane: O` question at position 4**, ungated, re-scoped to that half
alone, carrying the recommendation (a More row, leave the defaults empty), both alternatives with
what each is better at, and the reversal cost (near zero either way). Ungated deliberately: a
`Gate: owner` would park it out of the Orchestrator's own READY list, which is how a question stops
being asked.

**One nuance worth keeping:** all ten card widgets are off by default and the card's docstring says
so on purpose. Collection is only distinctive because it is the sole route to a *whole screen*; the
other nine summarise data reachable elsewhere.

## Verification

- `components/home/__tests__/rv121-readiness-label-collision.test.ts` — 7 tests, green.
- **Control-run against `origin/main`: 6 of the 7 go red.** The seventh is the guard-on-the-guard
  that reads the two anchor names off source, and it should pass either way.
- `pnpm check:rules` **Ran 77 of 77** · `tsc --noEmit` clean · lint clean.

**Not exercised:** nothing was rendered. This is three string literals and a source-assertion test,
so there is no browser or device check here at all — and none is owed, because the strings appear in
the picker rows verbatim. Samsung WebView rendering, safe-area, native SQLite and drifted production
data all untested, as for any change of this shape.

## Next

Lane B's queue head is now **RV-164**, then RV-166, RV-167, RV-111 (its Lane B half shipped in
#1520; what remains is the device re-check), then RV-122.

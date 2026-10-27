# Marking a night partial: the control (#2265)

Drawn in TrainingAi Preview's own components (`mobile/src/shared/ui`), dark theme, 384 px wide (768 px
PNGs at 2x), static **invented** data: a night from 4:40 am to 7:55 am (3h 15m) with made-up stage,
efficiency, heart-rate, HRV and breathing values. None of it is a real night. The web render falls back to a serif font because
Preview's fonts do not load in the browser; the device uses Geist. `PartialNightMockup.tsx.txt` and
`mockup-entry.tsx.txt` are the throwaway source (copy into `mobile/`, point `main` at the entry, do not
commit them there).

| File | Shows |
|---|---|
| `a-off.png` | **Recommended, A:** a switch row at the foot of the night card, off |
| `a-on.png` | A once marked, which is also **how any marked night reads afterwards**: a *Partial night* badge, "3h 15m recorded", a one-line reason, hours/stages/efficiency dimmed, heart rate, HRV and breathing at full strength |
| `b-menu.png` | **B:** a `...` button in the card header opens a menu |
| `b-confirm.png` | B: the confirmation sheet that explains what changes |
| `b-marked.png` | B: the marked night with an undo sheet |
| `c-prompt.png` | **C:** a prompt on a short night: "Was the ring off for part of it?" Yes / No |

**How faithful B is.** B is drawn with Preview's real `Sheet` and `ActionMenu`
(`mobile/src/shared/ui`), stacked the way the app would stack them: the night card already opens
inside a `Sheet title="Sleep"`, so B's `...` menu is a second sheet over it. The `...` button and the
confirm sheet's wording are drawn here; nothing is wired up. A and C are cards on a plain frame, not
inside the Sleep sheet.

**Not in these mockups:** Preview's sleep night has no menu today, so there is no "Log bedtime by
hand" item to show. Bedtime is entered on the separate *When did you go to bed?* card
(`RememberedBedtimeCard`), which stays as it is.

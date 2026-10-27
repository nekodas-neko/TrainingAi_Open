# Marking a night partial: the control (#2265)

Drawn in TrainingAi Preview's own components (`mobile/src/shared/ui`), dark theme, 384 px wide, static
data: the 27 Oct night (4:23 am to 8:03 am, 3h 5m). The web render falls back to a serif font because
Preview's fonts do not load in the browser; the device uses Geist. `PartialNightMockup.tsx.txt` and
`mockup-entry.tsx.txt` are the throwaway source (copy into `mobile/`, point `main` at the entry, do not
commit them there).

| File | Shows |
|---|---|
| `a-off.png` | **Recommended, A:** a switch row at the foot of the night card, off |
| `a-on.png` | A once marked, which is also **how any marked night reads afterwards**: a *Partial night* badge, "3h 5m recorded", a one-line reason, hours/stages/efficiency dimmed, heart rate, HRV and breathing at full strength |
| `b-menu.png` | **B:** a `...` button in the card header opens a menu |
| `b-confirm.png` | B: the confirmation sheet that explains what changes |
| `b-marked.png` | B: the marked night with an undo sheet |
| `c-prompt.png` | **C:** a prompt on a short night: "Was the ring off for part of it?" Yes / No |

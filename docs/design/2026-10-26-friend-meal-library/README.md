# A friend's meal library: mockups (#2217)

Drawn in TrainingAi Preview's own components (`mobile/src/shared/ui`), dark theme, 384 px wide, static
data. The web render falls back to a serif font because Preview's fonts do not load in the browser; the
device uses Geist. `FriendMealLibraryMockup.tsx.txt` and `mockup-entry.tsx.txt` are the throwaway source
(to re-render, copy them into `mobile/` and point `main` at the entry; do not commit them there).

| File | Shows |
|---|---|
| `profile-row.png` | The entry point: a **Meals** row on a friend's profile, present only when the route answers 200 |
| `library.png` | **Recommended** browse screen: one card with **Add all N new meals**, one row per meal, ingredients expand, **Add to my meals** per meal, "In your meals" mark |
| `library-done.png` | The same screen after **Add all** (button turns into the result) |
| `library-sheet.png` | Alternative: the same list as a bottom sheet over the profile |
| `optin-a.png` | **Recommended** opt-in: a Sharing card on the Nutrition settings screen |
| `optin-b.png` | Alternative opt-in: the same card at the top of the Manage friends sheet |

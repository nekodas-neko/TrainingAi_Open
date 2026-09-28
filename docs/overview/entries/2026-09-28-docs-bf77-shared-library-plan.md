# 2026-09-28 — BF-77: the shared food library, planned

**Lane A · docs-only planning PR.** The owner asked on 2026-09-20 for *"the most efficient way to
share a food library"*, and on 2026-09-25 chose to have an agent run the session.

- **Plan:** `docs/superpowers/plans/2026-09-28-shared-food-library.md`. **Recommended design:** browse
  an opted-in friend's saved meals and copy one, or all of them.
  - It reuses `friendships`, the unchanged `saveSharedMealToLibrary` and `savedMealToIngredients`.
  - The opt-in is a `users.preferences` flag (jsonb), so there is **no migration** and no new sync
    domain.
- **Why not a group library:** it would couple two users' data, which BF-57 and BF-58 each declined,
  and an edit would rewrite a meal someone else already logged.
- **Why not a share code:** it only solves remote sharing of one meal, the smallest of the four gaps.
- **Corrected a stale claim.** The backlog said the label still encodes the owner-only token. It
  encodes the full recipe for every style that carries one, so BF-57's surface had already shipped.
- **Queue:** BF-77 is rewritten as the engine entry (Lane A), and BF-77a is the surface entry
  (Lane B, `Needs: BF-77`).
- **Not built:** nothing. The "updated since you copied" badge (plan §5) is deliberately left unfiled
  until the owner asks.

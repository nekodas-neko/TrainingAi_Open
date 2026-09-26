# 2026-09-26 — `projectOverview.md` +16 (12952 → 12968)

Raised for RV-201 ②'s Current Status paragraph: `/api/weekly-digest` lost its model call and became
a `GET`, which changes how two surfaces fetch and what the offline story is — the kind of thing the
index exists to tell the next session before it reads anything else.

**Written short on purpose.** The first draft was 19 lines and was cut to 16 by moving the detail
where it belongs: the three defects the work surfaced, the mutation pass and the verification
matrix are in `docs/overview/entries/2026-09-26-rv201-weekly-digest-offline.md`, which the
paragraph now links rather than summarising. What stays in the index is the shape of the change,
the shared cache key, and the one thing a later session must not assume — that the offline
navigation is **not** demonstrated, because `pnpm dev` runs no service worker.

Offsetting shrink in the same PR: the BF-5 PR 2a paragraph below it was amended rather than
extended, and the RV-201 backlog entry (2,061 characters) left `docs/implementation-backlog.md`.

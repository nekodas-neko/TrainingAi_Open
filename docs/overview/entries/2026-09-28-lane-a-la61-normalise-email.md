# 2026-09-28 — LA-61: one account per email, whatever the case

Registration lower-cased and trimmed an email before storing it. The Google sign-in path passed the
provider's raw value to three lookups that used an exact match. Google lower-cases in practice, so
this never fired, but a differently-cased address would have made a second account or missed an
invite. The owner approved both halves: normalise on the way in, and add the functional index.

- **Code.** `normalizeEmail` (`packages/shared/src/validation/email.ts`) now runs inside the
  repository on every write and every lookup: `upsertUser`, `createEmailUser`, `addInvite`,
  `getUserByEmail`, `isInvited`, `removeInvite`, and the friend-request lookup. Lookups compare
  `lower(email)`, so a row the migration left alone is still found. The three route-level inline
  `.toLowerCase().trim()` calls are replaced by the helper.
- **Migration 296.** It records a pre-image of every rewritten address in
  `email_normalisation_preimage`, which sits on `claude_ro`'s DENIED list and is exported as
  third-party. It then rewrites `users` and `invited_emails` with a count self-check, and builds
  unique `lower(email)` indexes. A row whose normalised form another row already holds is left
  exactly as it was, and if that happens the index is not built. Both emit a NOTICE. Merging two
  accounts is a human decision.
- **Rehearsed on the snapshot database:** the owner's single row was already normal, so there was
  nothing to rewrite, and both indexes were built. Other accounts cannot be seen from here
  (`claude_ro` is owner-scoped), so the migration's guards handle them instead of a count. The
  pre-image table is their snapshot. It is exact and inside the same transaction, and undoing it
  is one UPDATE per table.
- **Tests.** There are two files, one for the migration (throwaway database) and one for the
  repository. Mutation pass: 11 of 11 mutants killed (5 in the migration, 6 in the adapter), and
  both equivalent controls stayed green.

Not exercised: a real Google sign-in. This path runs through NextAuth's callback, which the suite
does not drive.

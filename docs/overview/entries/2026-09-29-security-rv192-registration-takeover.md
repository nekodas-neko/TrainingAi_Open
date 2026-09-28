# 2026-09-29 — RV-192: an invited address can no longer be taken by registering it first

**Lane A · auth · held for the owner's merge-time yes (RV-221).**

- **Fix, with no email provider:** the app has no mail infrastructure, and adding one means money and
  a secret, which are the owner's calls. Google already proves who owns an address, so the fix uses
  that:
  - `createEmailUser` no longer activates an invited address. A password registration starts
    inactive (`/pending`) like any other.
  - `linkOAuthAccount` clears `password_hash` when Google links onto a password account. The
    password never proved the inbox; Google just did.
  - `auth.ts`'s `signIn` honours the invite at that moment: an inactive, invited account is
    activated as its owner signs in with Google.
- **Behaviour change the owner should know:** an invited person who registers with a password waits
  in `/pending` until they sign in with Google or an admin approves them. The product option on
  RV-221, to drop password sign-up altogether, is unaffected and still his.
- **Verified:**
  - A real-Postgres test: an invited password registration is inactive, and linking clears the
    password.
  - The existing register and LA-61 tests pass.
  - `pnpm dev`: `POST /api/auth/register` for an invited address → 200, row `is_active = false`.
- **Not exercised:** the Google half end to end, which needs a real Google sign-in; the adapter
  test covers its database effect. After merge, the owner's own sign-in is unaffected, because his
  account already has Google linked and the link branch only runs when `oauth_sub` is empty.

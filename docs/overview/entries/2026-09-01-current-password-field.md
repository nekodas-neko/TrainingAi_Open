# 2026-09-01 — an account with a password could not change it

**Branch:** `fix/lb-40-current-password-field` · **Entry:** LB-40 · **Lane:** B · **Version:** v1.416.4

## The defect

`EditProfileSheet` held `const [hasPassword, setHasPassword] = useState(false)` and **nothing ever
fetched it**. The only thing that set it true was a *successful* password save later in the same
session. The *Current password* field renders behind that flag, so for anyone who already had a
password it never appeared, the PATCH went up without `currentPassword`, and
`app/api/user/password` answered *"Current password is required."* — an error naming a field that
was not on screen.

**So the change-password flow was completely non-functional for every account with a password**, and
functional only for an account with none, which is the case the flag exists to detect.

Reproduced against the running route before touching anything: `{"newPassword":"…"}` → **400
Current password is required.** `GET /api/user/profile` was returning `hasPassword: true` the whole
time, in the same payload the More tab already reads.

## The fix, and the direction it fails in

The flag is fetched when the sheet opens, through **the key and TTL the More tab already warms**
(`more-user-profile` / `TTL_MEDIUM`) — so on the common path it is a cache read rather than a new
request, and it revalidates, which matters after a password is set on another device.

**Unknown shows the field.** The state is `boolean | null`, and the field renders unless the flag is
known `false`. `cachedFetch` swallows a failed request, so a cold cache plus a dead network would
otherwise land back on `false` and reproduce the bug silently. Of the two ways to be wrong, an
OAuth-only account seeing one optional field it can ignore is recoverable; a password account unable
to change its password is not. The route is the authority either way — it ignores `currentPassword`
when there is no hash.

The submit button blocks on a missing current password **only when `hasPassword === true`**, never
on the unknown or no-password cases.

## Verification

- **Rendered.** Opening More → Edit Profile → Change Password shows the *Current password* field,
  which is the whole of what was missing.
- **All four route paths exercised live**, against the seeded account (which has a bcrypt hash):
  no current password → 400 *required*; wrong current password → 400 *incorrect*; correct current
  password → 200; changed back → 200; and signing in with the seed password afterwards still
  works, so the round trip left nothing behind.
- **Six source guards, five mutations, all killed** — reverting the initialiser to `useState(false)`,
  reverting the render condition to `{hasPassword && …}`, deleting the fetch, minting a second cache
  key for the same endpoint, and dropping the submit guard.
- `pnpm check:rules` — **Ran 67 of 67**. `tsc`, `pnpm lint`, backlog-pointers and doc-links all exit
  0, each read by exit code.

**Not exercised: the OAuth-only account.** The seeded user has a password, and the sandbox has no
Google-only account to sign in as, so the `hasPassword === false` branch — the field being *absent*
— is verified by source and by the route's behaviour, not by rendering it. It is the branch that was
working before this change.

**Not on the S25.** A password field in a bottom sheet with the keyboard up is a device check; the
sheet is `max-h-[90dvh] overflow-y-auto`, which is the thing that would be wrong.

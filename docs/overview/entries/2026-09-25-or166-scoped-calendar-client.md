# 2026-09-25 — OR-166: 203 MB of Google APIs for one calendar call

**Branch:** `or166-scoped-calendar-client` · **Lane A**

`googleapis@172` installed **203 MB** and was imported by exactly one file. It is replaced by
`@googleapis/calendar@20` at **884 kB** — the same generated Calendar v3 client, without the other
~380 Google APIs beside it. Next traces the import graph for the server bundle, so the whole package
was walked on every build.

## The saving, measured rather than assumed

The entry was explicit that the 203 MB was measured and the build saving was not, and asked for a
before/after. Cold `pnpm build` (`rm -rf .next` each time) in this container:

| | total | Next's compile phase |
|---|---|---|
| before | 6m16s | 3.9 min |
| after | 5m09s | 3.2 min |
| after, again | 4m54s | 3.0 min |

The two after-runs sit 15 s apart, so the ~70 s gap is comfortably outside the run-to-run noise.
n=1 on the before, which is the weaker half of the comparison and is stated as such.

## The risk the entry did not name

This is not purely a repackaging, and the difference matters for this particular route.
`googleapis@172` depends on `googleapis-common@^8` + `google-auth-library@^10`;
`@googleapis/calendar@20` depends on `@^9` and `@^11`. So the swap is a **major bump of the
underlying auth and transport stack**.

That is load-bearing here because `/api/log-calendar-event` sorts a failed `events.insert` into two
answers by **reading the error**: a 403 is a consent state the user has not given and is deliberately
kept out of `error_events`, and anything else is a fault and is recorded. A changed error shape would
silently re-route a real fault into the quiet branch, or bury the common consent case in the table
every session reads to orient.

**So both libraries were driven against live Google with a bogus credential, side by side.** They
throw the identical object: `GaxiosError`, `message: 'invalid_client'`, `code: 401` **as a number**,
`status: 401`, `response.status: 401`. The contract is unchanged. `gaxios` stayed on major 7 across
both dependency chains, which is the reason.

That side-by-side also settled something for **LA-85**, the open entry saying this route's scope
check may not match what Google actually throws. Its first mechanism — `GaxiosError.code` is the
numeric status, so `errCode === 'ERR_HTTP_403'` cannot match — was read from the pinned `gaxios`
source and marked as not yet observed live. It is observed now, on a real 401 from Google, and it
holds. LA-85 still needs its genuine **403** to settle the message-matching half; that entry records
both facts.

One incidental tidy: the lockfile carried `googleapis-common` at both 8 and 9 while `googleapis` was
installed. It now carries only 9 — the swap removed a duplicate rather than adding one.

## Verification

- `tsc` clean, `typecheck:tests` at baseline, lint 0 errors, **1052 test files / 9807 tests passed**,
  **Custom Rules 78 of 78**, `pnpm build` green.
- `feedback-calendar-scale-routes.test.ts` (19 tests) passes with its `vi.mock` retargeted from
  `googleapis` to `@googleapis/calendar`. Its mock shape did not otherwise change, because the route
  uses the same two things from either package.
- The real client — not the mock — was constructed and driven end to end as far as a credential
  allows: `auth.OAuth2` constructs, `setCredentials` takes the refresh token, `calendar({version,
  auth})` builds, and `events.insert` performs the token exchange and reaches
  `oauth2.googleapis.com`, which refuses the fake client id.

**Not exercised, and it is the one step that matters most:** an event actually being created with a
real refresh token. The container has no Google credential, so this cannot be done here. OR-166 stays
in the queue as `Verify: owner` with that named as the owed check — complete a workout on the device
and look for the event in Google Calendar. Everything short of a real credential passed, and that is
not the same thing.

No version bump or changelog entry: nothing user-visible is intended to change, and claiming a
user-facing improvement for a build-time dependency swap would be noise in a log the owner reads.

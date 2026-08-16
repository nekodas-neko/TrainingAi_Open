# 2026-08-08 — Server errors now name the user, and the entry that said they couldn't (Q-145)

**Branch:** `fix/request-error-user-attribution` · **Domain:** `platform` · no version bump
(observability, nothing user-visible)

## The entry's premise was wrong, and that was the whole blocker

Q-145 was filed with a ⚠️ warning against implementing it:

> `onRequestError` is handed only `{ path, method }` by Next (`instrumentation.ts:24-36`), so
> `recordRequestError` has no user identity to add — which is also why it inserts `user_id` as NULL.

That reads the **repo's own hand-written parameter type** as if it were Next's. Next's actual
signature, from `next/dist/server/instrumentation/types.d.ts`:

```ts
export type InstrumentationOnRequestError = (error: unknown, errorRequest: Readonly<{
    path: string;
    method: string;
    headers: NodeJS.Dict<string | string[]>;
}>, errorContext: Readonly<RequestErrorContext>) => void | Promise<void>
```

`headers` is there, and the session cookie is in it. So option (a) — the one the entry called risky
and recommended against — is not only implementable, it is the option that actually solves the
problem. Option (b) (sprinkle `reportServerError` into "the routes that matter most") would have
bought partial coverage for a much larger diff.

## What shipped

- `instrumentation.ts` — local type widened to match Next's, and `headers.cookie` passed through.
- `userIdFromSessionCookie()` — parses the session cookie, decrypts it with `AUTH_SECRET` via
  `next-auth/jwt`, returns `id ?? sub`.
- `recordRequestError` — inserts that id instead of a hardcoded `NULL`, and includes it in the
  dedup key.

## Four things that could have made this a bad trade, and what each cost

**1. It must never cost us the error report.** Everything about attribution is inside its own
try/catch returning null: no cookie, expired token, rotated secret, missing `AUTH_SECRET` — all
record exactly as before.

**2. `error_events.user_id` is a `uuid` with an FK to `users`** (`ON DELETE SET NULL`). A session
token can outlive the row it names, and a non-UUID subject would fail the INSERT outright — either
way the *error row itself* would be lost, which inverts the priority. So: the id is UUID-shape
checked before use, and the INSERT retries once with `NULL` if it fails with an id.

**3. The cookie name is the decrypt salt.** Auth.js v5 salts with the cookie name, and
`__Secure-authjs.session-token` contains `authjs.session-token` as a substring — matching on
substring picks the wrong salt and silently decrypts to nothing. The parser returns
`{ name, value }` so the salt is always the exact name the value was found under.

**4. The import graph.** This file's header exists because the instrumentation entry point cannot
pull native addons. `next-auth/jwt` is `jose` underneath — pure JS — and a full `next build`
confirms it: exit 0, no `Can't resolve` anywhere.

## The dedup key

Now `${userId}|${url}|${message}` rather than `${url}|${message}`. Without the user id the 60 s
window collapses two users hitting the same fault into one row, so even the *count* understated it.
Anonymous requests share the empty slot, which is the behaviour they had before.

## Verification

- `tsc --noEmit` clean · `eslint` clean · full suite **417 files / 3291 tests** green.
- 12 new tests, including a real Auth.js `encode` → `decode` round-trip — so this fails loudly if
  Auth.js changes its token format or salt convention, which is what would otherwise break it
  silently. Also covers both cookie names, wrong salt, wrong secret, missing secret, malformed
  token, non-UUID subject, and the dedup-key cases.
- `next build` exit 0.
- **End-to-end against `pnpm dev`**, via a temporary route that throws (deleted before commit):

  | request | recorded `user_id` |
  |---|---|
  | anonymous | `(null)` — unchanged |
  | signed in as seeded `test@local.dev` | `a15b84b8-dfa6-48bd-a074-42a9df6cb6fd` |

  Both rows landed despite identical url+message 27 s apart, which is the dedup fix demonstrated at
  the same time — under the old key the second would have been suppressed.

  Worth knowing for the next person: **`instrumentation.ts` is registered once at server boot and
  does not hot-reload.** A first attempt appeared to show no attribution purely because the dev
  server predated the edit.

## Not exercised

Production, and the APK. The mechanism is the same on device (the WebView sends the same cookie),
but nothing here ran against either. Also untested: a token for a **deleted** user actually hitting
the FK retry path — that branch is reasoned and cheap rather than exercised, because manufacturing it
means deleting a user mid-request.

# 2026-08-13 — the TOKEN_ENC_KEY boot log was crying wolf (Q-217)

**Branch:** `claude/trainingai-backlog-v0abea`

Every container start logged `[token-crypto] TOKEN_ENC_KEY unset — token writes will fail closed`,
twice, at `error` severity. The entry asked which was true: the variable belongs in Railway and is
missing, or the message overstates it. **Both, in different senses** — and it took three measurements
rather than a judgement call.

## What the logs were asserting, and what was actually true

1. **`encryptToken` is reachable from exactly two callers** — `saveOuraPat` and
   `saveOuraOAuthTokens` (`slices/oura.ts:63,80-81`). Both mean *connecting an Oura Cloud
   credential*, and the Cloud has received no new data from this ring since the 2026-07-07 re-key.
   Nothing else in the app writes a token, so nothing that runs day to day could hit the fail-closed
   path.
2. **Production's stored tokens cannot be affected by the missing key.** The `oura_tokens` row was
   written **2026-06-22** and never updated since; `token-crypto.ts` landed **2026-08-11**, seven
   weeks later. The stored values therefore predate the `v1:` prefix, and `decryptToken` returns an
   unprefixed value unchanged whether or not a key is present.
3. **`has_pat` is `false`.** There is no PAT stored at all — only an OAuth access/refresh pair. The
   entry's second bullet called it "the Oura Cloud PAT"; that is the OAuth pair, which matters
   because it is a different disconnect flow.

The `error` severity was a red herring: it was a `console.warn`, and Railway labels anything written
to stderr as error. Nobody escalated it.

So the log asserted a broken security control on every boot of a deployment where nothing was wrong —
exactly the thing that teaches people to stop reading logs.

## What replaced it

The import-time warning is gone. In its place, the case that was **actually silent** now reports:
`decryptToken` returning a `v1:` ciphertext because the key vanished. Today that cannot happen (see
fact 2), but if it ever does, the caller hands a ciphertext to Oura as a bearer token and gets back
`token is expired, revoked, malformed` — a message that sends you to inspect the credential instead of
the missing key. That is a genuinely expensive wrong turn, and it was unlogged.

`encryptToken` still throws. The fail-closed property is unchanged; only the noise is.

## Verified

Full suite green — 464 files, 3,818 tests, zero failures. `tsc --noEmit` clean, lint 0 errors,
`pnpm check:rules` 33 of 33.

**Mutation-verified, both directions:**

- Restored the import-time warning → *"logs nothing merely because the module was imported without a
  key"* fails.
- Made `decryptToken` silent again on ciphertext-without-key → *"reports when the key is missing and
  the stored token IS encrypted"* fails.

There is also a test asserting the missing key stays **silent** for plaintext tokens, which is
production's actual state — without it, the fix would just move the noise instead of removing it.

**Not exercised:** production, though this one is close to self-evident — the next deploy's log
either carries the line or does not. Nothing device-related is touched.

## Left for the owner, and now optional rather than blocking

Setting `TOKEN_ENC_KEY` in Railway (`openssl rand -hex 32`) is only needed to connect an Oura *Cloud*
credential again. Leave it unset and nothing breaks; the logs are quiet either way.

## Deliberately not fixed

The dead Oura Cloud token is still called on **every workout completion**:
`syncAndAttributeSessionHr` (`lib/workout/post-completion-hr.ts:32`) calls `syncHrForSession`, which
401s each time and logs a warn. **Deleting the call would be wrong** — a different user with live
Cloud credentials would lose HR sync, and the app is no longer safely single-user. The fix is to skip
or quiet it when the stored credential is known-dead, which needs a decision about whether a 401
should auto-disconnect the Cloud integration. Recorded on the backlog entry rather than guessed at.

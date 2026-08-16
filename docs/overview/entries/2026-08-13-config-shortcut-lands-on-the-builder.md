# 2026-08-13 — `/config` lands on the Program Builder again (Q-223)

**Branch:** `claude/trainingai-backlog-v0abea`

`app/config/page.tsx` redirected to `/more?tab=config`. `more-content.tsx` parses
`profile | friends | workout` and silently drops anything else, falling back to `profile` — so the
link opened More on the Profile tab and looked like it had done nothing. The Builder mounts under
`workout`. One value, wrong.

```diff
- redirect('/more?tab=config')
+ redirect('/more?tab=workout')
```

**Two links were affected, not one.** The owner hit it from the AI Coach's "Build or Modify Program"
card, but `app/session-select/components/recommendation-card.tsx:197` has had the same `href="/config"`
since before that card existed. Both go through this redirect, so both are fixed by the one line —
and `components/config-screen.tsx` writes `/config` back via `history.replaceState` as its own
canonical URL, which is why the shortcut has to work rather than be routed around.

## Why it survived

The bug lives in the *agreement* between two files, and each is correct on its own: the redirect is a
well-formed URL, and the parser is right to reject a value it does not know. Nothing throws, nothing
logs, and the user lands on a real screen — just the wrong one. That is the failure mode a type
system cannot see, because the string never crosses a typed boundary.

So the guard is a source-text check, and it pins **two** things:

1. the redirect's tab is one the parser admits, and
2. it is specifically the tab `ConfigScreen` mounts under.

The second matters because `profile` would satisfy the first and still strand the user — the same
failure, one step quieter.

## Verified

Observed on the dev server rather than reasoned about: authenticated `GET /config` →
`307 → /more?tab=workout`. (Unauthenticated it is `307 → /sign-in`, because middleware runs first —
worth knowing before concluding the redirect is broken.)

Full suite green — 465 files, 3,821 tests, zero failures. `tsc --noEmit` clean, lint 0 errors,
`pnpm check:rules` 33 of 33, `check-doc-links` OK across 1,016 files.

**Mutation-verified, both directions:**

- Restored `tab=config` → **both** cases fail.
- Set `tab=profile` — valid but wrong — → the second case fails, the first passes. That is the split
  the two assertions exist for.

**And the test caught its own bug first.** The ConfigScreen-mount regex used a `{0,200}` window,
which reached back across the preceding `friends` block and matched *its* guard — so the test passed
while asserting the wrong tab. It is `[^<]*` now: nothing may intervene between a guard and the
component it guards. A source-text check that matches the wrong source text is worse than no check.

**Not exercised:** the S25. This is a server-side redirect with no device surface, and the tab it
selects is plain React state — but the visual confirmation that the Builder is what renders is a
device/browser observation, not one this sandbox makes.

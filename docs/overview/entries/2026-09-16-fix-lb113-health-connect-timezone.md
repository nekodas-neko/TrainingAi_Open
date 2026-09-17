# 2026-09-16 — `fix/lb113-health-connect-timezone`

**LB-113** — `syncHealthConnect(tz = DEFAULT_TZ)` and `enrichActivityLogs(candidates, tz = DEFAULT_TZ)`
gained the parameter on 2026-09-16 and nothing passed it, so both fell back to Brisbane. v1.457.6.

Right for the owner, wrong for anyone else, and silent either way — the shape CLAUDE.md names
directly: *"a default every caller overrides is a safety net, and it is what makes forgetting
silent."*

## The entry named the wrong second call site, and the one it missed is the one that mattered

It said *"`components/health-connect-provider.tsx` calls both without it"* and *"small and local: two
call sites in one component"*. Neither half held.

- **The provider calls only `syncHealthConnect`.** It is twelve lines and calls one function.
- **The un-timezoned `enrichActivityLogs` call is inside `syncHealthConnect` itself**
  (`lib/health-connect-sync.ts:471`), where `tz` is already in scope and was simply dropped.

That second point is what makes it worth writing down: the entry's own pass test — *"neither entry
point is called without a timezone"* — would have been satisfied by fixing the component alone, while
enrichment carried on bucketing in Brisbane. A grep for both names across the repo is what found it;
reading the entry would not have.

## The provider did not have the session either

The entry assumed *"the provider has the session and can pass `session.user.timezone`"*. It is a bare
client component with no props and no session access.

It is mounted inside `UserTimezoneProvider` (`app/layout.tsx:162`, inside 151–172), which is fed
`session?.user?.timezone` from the server layout — so `useUserTimezone()` is the app's established
client-side source and gives the same value the entry wanted. Because the provider is server-fed
there is no placeholder-to-real flip, which is what makes it safe to depend on: the effect is keyed
on `[tz]` rather than `[]`, so changing the profile timezone re-syncs instead of pinning whatever was
current at mount, and there is no double sync on first render.

The `= DEFAULT_TZ` defaults stay. Removing them would be a breaking signature change to a module Lane
A owns, and the defect was the callers.

## What was verified, and what was not

- `components/__tests__/lb113-health-connect-timezone.test.ts` — **4 of 5 assertions fail against
  `main`**. The fifth is a deliberate pin that the defaults stay in place, and passes on both sides.
- `e2e/tabs-instant-paint.spec.ts` — **7 passed**. Not a test of the sync, which cannot run here; it
  is the check that the root layout still paints, since this provider is mounted in `app/layout.tsx`
  and a fault there takes every tab with it.
- Full suite **7577 passed**, `pnpm check:rules` **Ran 75 of 75**, test-typecheck none above
  baseline, lint 0 errors, build clean.

**NOT exercised: the sync itself, and it cannot be here.** `syncHealthConnect` returns immediately
unless `Capacitor.isNativePlatform()`, so every harness run takes the early exit — the tests pin the
call sites, not the behaviour. The check that matters is on the S25 with a non-Brisbane profile
timezone: sync, then confirm a day's metrics land on the day the phone shows. LB-113 carries
`Verify: device`.

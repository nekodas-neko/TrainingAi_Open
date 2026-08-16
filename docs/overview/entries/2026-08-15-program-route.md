# 2026-08-15 — the Program Builder gets a route, and a dead deep link comes back (Q-235, Q-256)

**Branch:** `claude/ia-cluster-app-shell` · **Version:** v1.312.0
**Plan:** [`2026-08-14-more-tab-information-architecture.md`](../../superpowers/plans/2026-08-14-more-tab-information-architecture.md) §5, step 4.

The app had a bottom-nav tab called **Workout** and, inside More, a second tab *also* called
**Workout** — mounting the 997-line Program Builder two containers away from the tab it configures.
The Builder is `/program` now, reachable from a control in the Workout tab's header and from
More → Program. More has two tabs left, Profile and Friends.

## Q-256, fixed by changing the shape rather than the string

`/config?new=program` is the AI prescription card's post-deload "New program" action. `/config`
redirected with a bare `redirect('/more?tab=workout')`, dropping the query string, and
`config-screen.tsx` read `?new=program` from `window.location.search` — so it never arrived and the
sheet silently never opened.

The one-line fix would have been to forward the string. That leaves the same trap for the next
redirect. Instead the flag is now a **prop**, resolved from `/program`'s own `searchParams` in the
server component:

```
/program?new=program → page.tsx searchParams → <ProgramContent openNewProgram> → <ConfigScreen openNewProgram>
```

A param read from `window.location.search` can be dropped by anything in between without a single
call site changing. A prop cannot.

**Measured before and after, same URL.** Before: `/config?new=program` landed on
`/more?tab=workout`, program list rendered, **no sheet**. After: it lands on `/program` with
*New Program / PROGRAM NAME / TRAINING SCHEDULE* open.

One rename fell out — the local `openNewProgram()` function shadowed the new prop, so it is
`openNewProgramSheet()`.

## The Q-223 regression test had to be rewritten, not deleted

`app/config/__tests__/config-redirect-tab.test.ts` asserted that `/config`'s `tab=` value is one
`more-content.tsx` parses, and that it matches the tab `ConfigScreen` mounts under. After this change
there is no `tab=` value and `ConfigScreen` does not mount in More, so both assertions failed —
correctly. The *invariant* survives the restructure: every legacy entry point must land on the
Builder and carry its parameters. It now covers `/config` → `/program`, the query-string forwarding,
`?tab=workout` still being handled explicitly rather than falling through to the default tab, the
prop-not-`window.location` shape, and that `/program` is genuinely where the Builder mounts.

**Two things this cost, both worth recording:**

**The negative assertions first failed on my own comments** — the prose in `config/page.tsx`
explaining the old `/more?tab=` target, and the one in `config-screen.tsx` explaining the old
`window.location.search` read. The test strips comments now; a comment is not behaviour. (Same shape
as the Custom Rules safe-area step failing on a comment two PRs ago.)

**One assertion did not discriminate, and mutation testing is the only reason I know.** The
forwarding check originally asserted that `searchParams` and `URLSearchParams` *appear* in
`config/page.tsx`. A mutation that kept both and set `const suffix = ''` — dropping every param —
**passed it**. That is a guard recognising the shape of the fix rather than its effect, which is the
exact failure mode the handoff warns about. Replaced with a behavioural test that calls the route
and reads the `NEXT_REDIRECT` digest, which cannot be satisfied by naming the right identifiers.

All six assertions were then mutation-verified: reverting the redirect, dropping the suffix while
keeping the machinery, always appending `?`, removing the `?tab=workout` handling, removing the
prop, and making `/program` stop mounting the Builder — each fails exactly one test.

## Verification

`npx tsc --noEmit` · `pnpm lint` (no new warnings) · `pnpm build` (`/program` 4.48 kB) ·
**`pnpm check:rules` — Ran 35 of 35** · full suite **471 files / 3,903 tests green**.

`pnpm dev` at 412×915 as `test@local.dev`, every entry point followed:

| From | Lands on |
|---|---|
| `/config?new=program` | `/program`, **new-program sheet open** |
| `/config` | `/program` |
| `/sheet/abc/config` | `/program` (chained through `/config`) |
| `/more?tab=workout` | `/program` |
| Workout tab → Program control | `/program`, Back → `/workout-select` |
| More → Program row | `/program` |

More no longer renders a Workout tab. Zero console errors throughout.

**⚠️ Not device-verified.** `/program` is a navless takeover using `pb-safe-action-lg`, and the
Builder ends in tappable controls — the sandbox renders insets as 0. The Builder itself is unchanged
apart from the prop, so its own behaviour carries no new device risk.

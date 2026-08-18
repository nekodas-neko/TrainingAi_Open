# Review — Q-499 reproduced in a browser, and a Q-number ledger that would have collided

**Date:** 2026-08-18 · **Agent:** Review 📖 · **Sweep 34** · **Findings:** Q-499 confirmed · **Q-552** filed

Sweep 33 named its own next step and did not take it: *"drive a card to a 429/500 in a browser and
watch it vanish — that would promote the ten candidates to a count, and it needs nothing this harness
lacks."* This sweep took it.

## Q-499 — confirmed. The card vanishes, silently.

Forced `/api/weights-summary` to return 429 by Playwright route interception, at the S25 viewport
(412×915), authenticated as the seeded user, against a clean baseline:

```
RUN BASELINE                    blocked=0  {"Estimated 1RM":1,"Ring Status":0}  errWording=false
RUN 429:/api/weights-summary    blocked=2  {"Estimated 1RM":0,"Ring Status":0}  errWording=false
CARD "Estimated 1RM"  baseline=1  under429=0  -> VANISHED

RUN 429:/api/oura/stats         blocked=2  {"Estimated 1RM":1,"Ring Status":0}  errWording=false
CARD "Ring Status"    baseline=0  under429=0  -> absent-at-baseline (inconclusive)
```

**The control holds.** In the third run — where a *different* endpoint was blocked — `Estimated 1RM`
is back at 1. So the disappearance is caused specifically by blocking that card's own endpoint, not
by the interception machinery. And `errWording=false` throughout: no "too many requests", no retry
affordance, no empty-state text. The card is simply not there.

`Ring Status` is **inconclusive**, not a pass — the seeded account has no ring data, so it is absent
either way.

## Why three earlier attempts failed, and why that matters

This took four runs. The first three failed on **my** methodology, not the app, and each failure is
worth recording because each one produced a plausible-looking wrong answer:

1. **Warm cache.** The endpoint 429'd and the card stayed — `readCacheSync` had seeded it, so it
   showed **stale data**. I briefly took this as a refutation of my own finding. It is not; it is the
   cache masking it.
2. **Cold cache, wrong card.** Used `hr-recovery-profile-card`, which is absent at baseline anyway
   (the seeded user has fewer than two recovery bands). Nothing to compare.
3. **Tripping a limiter that does not exist.** Chose `/api/weights-summary` and fired 90 requests to
   trip its limiter. **That route has no rate limiter** — all 90 returned 200, so the "under-429" run
   was never under a 429. The result table still printed a tidy `baseline=1 under429=1`, and only the
   `TRIP 0 of 90 were 429` line revealed that the independent variable had never been applied.

**That third one is the cautionary case.** It would have produced the *right general conclusion at
the time* — "the card survives" — through a measurement that established nothing. Route
interception is the correct technique precisely because it does not depend on the app's limiter
configuration being what you assumed.

## What the warm/cold split adds to the finding

The vanish is **invisible on a repeat visit with a warm seed** and appears on a cold one. So the user
most likely to hit it is one opening the app fresh — and the user least likely to reproduce it on
demand is the same person a minute later. That makes *"the card is gone"* not merely unanswerable
(sweep 33's argument) but **intermittent-looking**, which is worse: it invites "can't reproduce",
which `CLAUDE.md`'s report-invalidation rule exists to prevent.

## Reproduction, for the implementer

Not committed as a test — it would assert the buggy behaviour and go red on the fix. Paste into
`e2e/`:

```ts
import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

test('a card whose endpoint 429s must not vanish silently', async ({ browser }) => {
  const run = async (blockEp: string | null) => {
    const ctx = await browser.newContext({ storageState: STORAGE_STATE })
    const p = await ctx.newPage()
    if (blockEp) await p.route(u => new URL(u).pathname === blockEp, r =>
      r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"Too many requests"}' }))
    await p.goto('/health', { waitUntil: 'networkidle', timeout: 150_000 })
    await p.waitForTimeout(5000)
    const n = await p.getByText('Estimated 1RM', { exact: true }).count()
    await ctx.close()
    return n
  }
  expect(await run(null)).toBeGreaterThan(0)             // baseline
  expect(await run('/api/weights-summary')).toBeGreaterThan(0)  // currently 0 — the bug
})
```

## Q-552 — two sources of truth for the next Q band; the prose one was wrong

Review's band 450–499 was exhausted by Q-499. `docs/agents/README.md` says: *"claim the next block of
50 above 529"*. Following that literally gives **530–579**, which collides with **fourteen numbers
already in use** — and my own baton had already written 530–579 into the handover.

The ledger recorded 530–537, 538–542 and 543. **544–551 were also live** — across
`docs/handoff-2026-08-18-platform-db-storage-and-device-primary-compute.md`,
`docs/handoff-2026-08-18-platform-database-reclaim.md`, `docs/overview/history-2026-08-15.md`,
`docs/domains/devices/README.md` and the backlog — and appeared nowhere in it.

### The correction that makes this worth filing

My first write-up of this said the ledger *"is the only defence against collisions."* **That is
wrong, and the truth is more interesting.** There are **two** sources for the same fact:

| Source | Said | Status |
|---|---|---|
| `docs/implementation-backlog.md` → *Live pointers* → "Next unallocated Q band" | **552** | ✅ correct, and **CI-enforced** by `scripts/check-backlog-pointers.js` |
| `docs/agents/README.md` prose ledger + "next block of 50 above 529" | **530** | ❌ stale — omitted 544–551 |

The machine-checked pointer was right the whole time. A session that read it would have claimed 552
and never noticed a problem. **The collision was only reachable by following the README's prose
instruction**, which is what the README tells you to do, and which is what my baton had already
copied.

And the check earns its place: claiming 552 without updating the band table **failed the Custom Rules
job** with *"Q-552 is in use but the next unallocated band starts at 552 — a band was used without
being recorded."* It caught me in the same PR.

**So this is the third confirmed instance of Q-492's thesis** — *a count in prose is a claim with a
decay date; a count in a script is a fact* — and the first where the machine-checked copy was
silently correct while the prose copy was silently wrong, with a live near-miss between them.

**Fixed in this PR:** claimed **552–601**, recorded 544–551 retroactively, bumped the pointer to
**602**, and rewrote the instruction to point at the checked source — *read the "Next unallocated Q
band" pointer, not the prose list; then record your block in both.*

## Not exercised

Web build at the S25 viewport, seeded local database. **Not on device** — the APK's WebView and the
native local store are untested, and the offline case (where `cachedFetch` cannot revalidate at all)
was not driven. Only one card was proven; the other eleven candidates from sweep 33 remain a
worklist, and `Ring Status` specifically is inconclusive rather than clean.

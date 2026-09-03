# An account with no data: every surface says so except the one that scores it

**Date:** 2026-09-03 · **Agent:** Review 📖 (sweep 42) · **Pillars:** `[readiness]` `[app-shell]` `[devices]`
**Lens:** two coverage questions left by sweep 41, both about screens the existing guards do not reach —
**instant paint on the sub-routes** (the tabs are guarded; the ~20 screens that actually unmount are
not), and **the first-run state across the whole app** (the zero-data account is driven on two
screens, not twenty-two).

The instant-paint half came back almost clean. The first-run half found one card that fabricates a
score, and it is a repeat of the class the repo has shipped into twice already (Q-451, Q-452).

---

## 1. Method, and what it does not establish

The app was run. `pnpm dev` against the seeded local Postgres, driven through the existing Playwright
harness at the mobile viewport, using the repo's own `ZERO_DATA_STORAGE_STATE` account for the
first-run half. 22 routes were visited as the zero-data user and 14 sub-routes measured for repeat-visit
paint. Every number below is printed by a probe; the probes were deleted before committing.

What this does **not** establish:

- **It is the web build.** `getLocalStore()` returns null and safe-area insets resolve to `0px`. No
  device, native-plugin or safe-area claim originates here.
- **The paint measurement uses `page.goto`, which is a full app boot**, not the client-side push a
  user performs. That makes it a *stricter* test than reality for the sub-routes, so a pass is
  meaningful and a fail would need re-checking through a real in-app navigation. Nothing failed
  hard, so this did not have to be resolved.
- **The dev server compiles on first request.** Every route was visited twice and only the second
  visit measured, which removes the compile from the number but not from the cache state.

---

## 2. RV-38 — Body Battery prints 50 and calls it "Good" for an account that has never worn anything

### The measurement

`GET /api/body-battery` for the zero-data account answers, in full:

```json
{"current":50,"label":"Good","trend":"steady","hasData":false,
 "confidence":{"sampleCount":0,"wakingMinutes":344,"samplesPerHour":0,"sufficient":false},
 "anchor":50,"anchorSource":"default"}
```

**The route is honest.** Four separate fields say it has nothing: `hasData: false`,
`sampleCount: 0`, `samplesPerHour: 0`, `sufficient: false`, and the anchor is flagged
`anchorSource: "default"`.

The card renders:

> **BODY BATTERY  Good  Steady  50**

— with a colour-coded label, a progress bar filled to 50%, a "Steady" trend badge, and **no
"Limited data" badge** (asserted directly: count 0).

### The contrast is on the same screen, for the same account

Everything else on Home degrades correctly:

| Element | Zero-data rendering |
|---|---|
| Streak | `—days` |
| This week | `0 / 5 sessions done` — a real count |
| Week grid (7 days) | `—` on every day |
| Readiness / HR / Sleep chips | **absent** — the row gates itself off entirely |
| `/health/readiness` (same account) | `—  Readiness Score` |
| **Body Battery** | **`50`, `Good`, `Steady`** |

The Readiness score — the number Body Battery *opens at*, by the card's own explainer — renders as an
em-dash for this account. Body Battery renders 50.

### Why the existing guard does not fire, which is the whole finding

`components/body-battery-card.tsx:95`:

```ts
const lowData = battery.hasData && conf != null && !conf.sufficient
```

The "Limited data" badge is gated on `hasData`. So:

| State | `hasData` | `sufficient` | Badge |
|---|---|---|---|
| Enough samples | `true` | `true` | none — correct |
| Some samples, too few | `true` | `false` | **"Limited data"** — correct |
| **No samples at all** | `false` | `false` | **none** — the worst case gets the weakest warning |

The qualification gets *weaker* as the data gets worse. `hasData` is otherwise used only to gate the
expanded chart (line 164), so the collapsed card — the part that is always on screen — has no path
that can say "there is nothing behind this number".

This is Q-57's mechanism working exactly as written and stopping one case short. Its own comment says
*"the number stays, it just stops being presented as measured"*, which is the right posture; it simply
never runs when there is no measurement at all.

**Not a claim that the number should be hidden.** Q-43 settled that these surfaces degrade rather than
blank, and that decision is not being reopened. What the sweep establishes is narrower and does not
depend on it: the app already computes "I cannot support this number", already has a component to say
so, and does not say it in the one case where it is most true.

### One stale comment, worth a line rather than an entry

`body-battery-card.tsx:134–139` says the explainer paragraph *"only renders in the NO-DATA state,
which means on any ordinary day nobody ever reads it"* — two lines after the Q-276 note saying it is
*"always visible"*. The JSX is unconditional and it was observed rendering for the **seeded** user as
well. The second half describes the pre-Q-276 behaviour and should go when the file is next touched.

---

## 3. RV-39 — the `/more/devices` ring card flashes a skeleton on a warm repeat visit

Measured on the second visit to an already-compiled route, skeletons counted in the viewport at
250 / 600 / 1200 / 2500 ms:

```
/more/devices   [1, 1, 0, 0]
```

Every other sub-route measured `[0,0,0,0]`. The element is the ring card placeholder —
`rounded-2xl bg-muted/40 border border-border h-[68px] animate-pulse`, directly under the `RING`
heading — which resolves to *"Oura Ring 5 — No data yet"* within ~1.2 s.

Under a second, and the smallest thing in this write-up. It is filed because `CLAUDE.md` states the
rule without a threshold — *"A skeleton flash on a repeat visit is a bug"* — and because the fix is
the one the rule names: seed from `readCacheSync` before first paint.

---

## 4. What came back clean, stated as results

**Instant paint holds on the sub-routes — 13 of 14 measured `[0,0,0,0]`.** This is the half of the
rule nothing guarded: `e2e/tabs-instant-paint.spec.ts` covers the five tab screens, which live in the
persistent shell and **never unmount**, so a repeat "visit" to one of them is not a remount at all.
The screens where the rule actually bites are the sub-routes, which remount on every arrival, and they
hold: `/health/sleep`, `/health/heart-rate`, `/health/readiness`, `/health/activity`, `/health/day`,
`/cardio`, `/config`, `/program`, `/running`, `/baselines`, `/more/details`, `/more/data`,
`/more/clinical`.

**The first-run state is honest on 21 of 22 routes.** No 5xx from any `/api/` route, no `pageerror`,
no console error, and no permanent skeleton anywhere. The empty states are specific rather than
generic — *"No program yet · Create one to get a session to start"* with a working CTA,
*"No running plan yet"*, *"Still learning your range — wear your ring or strap for a few more days"*,
*"Not enough data"*, *"Add your weight, height, date of birth, sex in Profile to see calories in vs
out"*. Zeros appear only where zero is the true count (`0 XP`, `0 Sessions`, `0 / 5 sessions done`).

**One near-miss worth recording rather than filing:** `/cardio` shows **`60 RESTING`** for the
zero-data account — the documented default, not a measurement. It is not filed because the card
carries its own caveat one line below (*"Still learning your range"*), which is the qualification
Body Battery lacks. `/health/heart-rate` handles the same defaults better still, printing `—` for
min/avg/max and naming the estimate outright: *"Working max: 190 bpm (age-estimated). Age estimate
190 · resting 60."* That is the pattern the Body Battery card should copy.

---

## 5. Filed

| ID | Pillar | What |
|---|---|---|
| **RV-38** | `[readiness]` `[app-shell]` | Body Battery prints a default 50 labelled "Good" when the API says `hasData: false`; the "Limited data" badge is gated on `hasData` so the no-data case shows no warning |
| **RV-39** | `[devices]` `[app-shell]` | The `/more/devices` ring card flashes a skeleton for ~1.2 s on a warm repeat visit — no cache seed |

## 6. Method notes worth keeping

- **The zero-data account is two minutes of setup and reaches a state nothing else can.** It already
  exists (`ZERO_DATA_STORAGE_STATE`); it was simply only pointed at two screens. Pointing it at all 22
  took one loop and found RV-38 immediately. **Re-run it whenever a scoring surface changes** — the
  seeded user has data for everything, so a fabrication is invisible there by construction.
- **Assert the API payload beside the rendered text.** *"The card shows 50"* is not a finding on its
  own — 50 could be correct. *"The route says `hasData: false` and the card shows 50"* is, and it took
  one response listener. A rendered number alone cannot distinguish a bug from a fixture.
- **Count skeletons in the viewport at fixed early offsets, not with a poll.** The repo's
  `expectNoSkeleton` polls to a 20 s budget, which by design catches *never seeds* and cannot see
  *flashes for a second* — the failure RV-39 is. Sampling at 250/600/1200/2500 ms sees both, and the
  second visit to an already-compiled route is what keeps the dev compiler out of the number.

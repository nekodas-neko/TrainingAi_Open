# CLAUDE.md accuracy and test-suite meaningfulness — 2026-08-08

_Domain: `platform`. Lenses 9 and 11 of
[`2026-08-09-deep-review-prompt.md`](2026-08-09-deep-review-prompt.md), continuing
[`2026-08-08-running-app-review.md`](2026-08-08-running-app-review.md) (Step 0 + Step 1)._

Two questions nobody had asked before: **is the rulebook true**, and **does the test suite actually
test anything**. Both were answered by measurement rather than reading.

---

## Lens 9 — `CLAUDE.md` as the subject

916 lines accumulated over ~290 sessions, never audited as a document.

### 9.1 The rulebook systematically points at paths that no longer exist

**Nine modules moved to `packages/shared/src/` and CLAUDE.md still names them under `lib/`.** The
monorepo extraction happened; the rulebook was never updated.

| CLAUDE.md says | actually at |
|---|---|
| `lib/1rm.ts` | `packages/shared/src/1rm.ts` |
| `lib/cache-ttl.ts` | `packages/shared/src/cache-ttl.ts` |
| `lib/changelog.ts` | `packages/shared/src/changelog.ts` |
| `lib/date-utils.ts` | `packages/shared/src/date-utils.ts` |
| `lib/utils.ts` | `packages/shared/src/utils.ts` |
| `lib/sync/cursor.ts` | `packages/shared/src/sync/cursor.ts` |
| `lib/session-explain/group-signals.ts` | `packages/shared/src/session-explain/group-signals.ts` |
| `lib/workout/log-exercise.ts` | `packages/shared/src/workout/log-exercise.ts` |
| `lib/health/score-band.ts` | `packages/shared/src/health/score-band.ts` |

**This is not cosmetic. The Timezone section — which CLAUDE.md itself labels "a strict rule" — gives
a code example that does not compile:**

```ts
import { todayInTz } from '@/lib/date-utils'    // ← what the rulebook instructs
```

Measured: **0 files in the repository import `@/lib/date-utils`. 197 import
`@trainingai/shared/date-utils`.** A session following the most-emphasised rule in the document
verbatim writes a broken import, then has to discover the real path by grep — which is exactly the
friction the rule exists to remove.

The same applies to the end-of-session rule ("add an entry to `lib/changelog.ts`") and the
Cache-Invalidation rule ("Define the TTL once, in `lib/cache-ttl.ts`"). Both name dead paths. The
`lib/health/score-band.ts` mention is **not** a defect — the document deliberately says *"there is no
`lib/health/score-band.ts`"* — but it sits three lines from the same file being cited correctly as
`packages/shared/...`, which is its own kind of confusing.

Filed as **Q-153**.

### 9.2 Numeric claims have drifted — one of them in the wrong direction

| claim in CLAUDE.md | measured 2026-08-08 | verdict |
|---|---|---|
| "455 hex literals currently bypass the tuned tokens" | **430** | improving — the doc undersells progress |
| "`scoreBand()` … imported everywhere as `@trainingai/shared/health/score-band` (17 call sites)" | **18** | trivial drift |
| "a bare `grep -rn '<polyline'` returns eight" | **9** | **a new violation appeared** |

### 9.3 A sixth inline sparkline has appeared, in code shipped the same week

CLAUDE.md names five inline `<polyline>` sparklines bypassing `components/ui/sparkline.tsx`, plus
three legitimate exemptions (the primitive itself, `detail-hero.tsx`'s decorative art,
`live-hr-chart.tsx`'s axis-bearing time series) — total eight. The bare grep now returns **nine**.

The new one is **`components/health/day-detail/day-sections.tsx:57`** — a hand-rolled HR mini-chart
(`<polyline points={d} fill="none" stroke="var(--accent-amber)" …>`), added by **#1136**, the
day-detail screen that shipped 2026-08-08.

The rule says *"Any pattern at ≥2 sites gets extracted before a third copy"* and *"replace on touch"*
— and a sixth copy landed anyway, days after the rule was last re-verified. That is the honest
signal: **this rule is not being followed, and nothing mechanical enforces it.** The
`components/ui/sparkline.tsx` primitive exists and was not used.

Filed as **Q-154**.

---

## Lens 11 — does the suite actually test anything?

414 test files, **3,270 tests**, all green. No coverage tooling has ever been configured. Green is
not the same as meaningful, so the suite was tested by mutation: break the code, see whether anything
notices.

### 11.1 The headline result — a cross-user data leak passes 3,270 tests

**Mutation:** remove the `user_id` scope from a `body_metrics` read in
`lib/data/postgres/adapter.ts:1852` (`getBodyMetricsBaseline`), turning a user-scoped query into one
that returns any user's row:

```diff
- .where(and(eq(s.bodyMetrics.userId, userId), isNotNull(s.bodyMetrics.weightKg)))
+ .where(and(isNotNull(s.bodyMetrics.weightKg)))
```

**Result: `Test Files 414 passed | Tests 3270 passed`. Nothing failed.**

This is the highest-severity class in the project — cross-user data exposure — and the suite is blind
to it at this site. `getBodyMetricsBaseline` is not dead code: it is called by
`app/api/progress-summary/route.ts:39` and `app/api/workout-sessions/[id]/energy/route.ts:40`.

**Context, so this is not over-read:** the 2026-08-07 review certified ownership discipline "clean"
by *reading* the code, and it was right — the scope **is** correctly written today. The finding is
not that the code is wrong; it is that **nothing would tell you if it stopped being right.**

### 11.2 The proxy measure, with its limits stated

Of **286 `async` repository methods** in the adapter, **180 (63%) appear in no test file at all** by
name.

That grep is a crude proxy and I am not claiming 180 untested behaviours: a method can be exercised
indirectly through a route test without being named. The mutation in 11.1 is the hard evidence — for
that one method, the ownership scope genuinely is uncovered. The 63% is a *signal about where to
look*, not a result.

### 11.3 A formula used at 18 sites is defended by one test

**Mutation:** change the `scoreBand()` threshold from `score >= 70` to `score >= 999` in
`packages/shared/src/health/score-band.ts` — inverting the band every score falls into.

**Result: exactly 1 test failed** out of 3,270.

The mutation was caught, so this is not a hole. But a single-source formula that CLAUDE.md calls out
by name, consumed at 18 call sites across the app, has one test standing between a threshold typo and
every score band in the UI being wrong. Worth knowing when judging how much the green tick means.

Filed together as **Q-155**.

---

## Method notes

Mutation testing here was manual and deliberately small: three mutations, each a full
`npx vitest run` against the local Postgres, each reverted immediately and verified restored. This is
not a coverage report and should not be quoted as one. It answers one question well — *would the
suite notice?* — for three specific changes.

**No coverage package was installed.** Doing so is a real dependency change and belongs in its own
PR; whether it is worth it is now a better-informed question than it was this morning.

## Not exercised

Lens 10 (mobile UI against external standards) and Lens 12 (multi-user scale) were **not run**.
Neither were Step 1's adversarial-value, boundary-date, empty-state, offline or rapid-tap items. No
device, no APK, no native SQLite. The remaining CLAUDE.md audit work — rules contradicted by the code
they govern, rules that could become CI checks, rules now obsolete — was **not** completed; only the
factual-accuracy sweep in 9.1–9.3 was.

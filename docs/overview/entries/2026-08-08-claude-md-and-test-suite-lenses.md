# 2026-08-08 — Lenses 9 and 11: the rulebook is wrong, and the suite is blind to a cross-user leak

**Branch:** `claude/token-usage-strategy-7cx7z9` · **Domain:** `platform`

## What this was

Continuation of the deep review after
[`2026-08-08-running-app-review.md`](../../reviews/2026-08-08-running-app-review.md) (Step 0 + Step
1). Two lenses, both asking questions nobody had asked before: **is `CLAUDE.md` true**, and **does
the test suite actually test anything**. Both answered by measurement, not reading.

## The two results that matter

**A cross-user data leak passes all 3,270 tests.** Removing the `user_id` scope from
`adapter.ts:1852` (`getBodyMetricsBaseline`, live on `progress-summary` and
`workout-sessions/[id]/energy`) leaves the suite completely green. This needs reading correctly: the
2026-08-07 review certified ownership discipline clean *by reading the code*, and it was right — the
scope **is** correct today. The finding is that **nothing would tell you if it stopped being right**,
in the highest-severity class the project has.

**CLAUDE.md instructs an import that does not compile.** Nine modules moved to `packages/shared/src/`
and the rulebook still names them under `lib/`. The Timezone section — which the document itself
calls *"a strict rule"* — shows `import { todayInTz } from '@/lib/date-utils'`. **Zero files use that
path; 197 use `@trainingai/shared/date-utils`.** The same is true of `lib/changelog.ts` and
`lib/cache-ttl.ts` — and I hit both of those myself earlier today and had to grep for the real path,
which is what prompted looking.

## The one that says something about process

A **sixth** inline `<polyline>` sparkline shipped in `day-detail/day-sections.tsx:57` (#1136), days
after CLAUDE.md's count was last re-verified at five, with `components/ui/sparkline.tsx` already
sitting there. The rule says *"Any pattern at ≥2 sites gets extracted before a third copy"* and
*"replace on touch"*.

The file is a small fix. The rule being unenforced is the finding: **a rule policed only by reviewer
memory is policed by nothing.** The durable answer is a CI check, and the shrink-only pattern from
`check-timezone-rendering.js` fits it exactly.

## Numbers that had drifted

Hex literals **455 → 430** (improving — the doc undersells progress). Score-band call sites 17 → 18.
Polyline grep 8 → 9.

## Method, and its limits

Three mutations, each a full `npx vitest run` against the local Postgres, each reverted and verified
restored. **This is not a coverage report and must not be quoted as one** — it answers *"would the
suite notice?"* for three specific changes.

The supporting statistic — 180 of 286 repository methods appear in no test file by name — is a
**crude grep proxy**, since a method can be exercised indirectly through a route test. It says where
to look. The mutation is the evidence.

**No coverage package was installed.** That is a real dependency decision and belongs in its own PR;
it is now a better-informed question than it was this morning.

## Not done

Lens 10 (mobile UI against Material/WCAG/platform standards) and Lens 12 (multi-user scale) not run.
Step 1's adversarial-value, boundary-date, empty-state, offline and rapid-tap items still undone. The
rest of the CLAUDE.md audit — rules contradicted by the code they govern, rules that could become CI
checks, rules now obsolete — not started; only the factual-accuracy sweep was. No device, no APK, no
native SQLite.

# 2026-08-09 — The rulebook stops instructing an import that does not compile (Q-153)

**Branch:** `docs/claude-md-path-accuracy` · **Domain:** `platform` · no version bump
(docs + CI, nothing user-visible)

## What was wrong

Nine modules moved to `packages/shared/src/` in the monorepo extraction and CLAUDE.md kept naming
them under `lib/`. The Timezone section — which the document itself labels *"a strict rule"* —
showed:

```ts
import { todayInTz } from '@/lib/date-utils'
```

**0 files import that path. 197 import `@trainingai/shared/date-utils`.** A session following the
most-emphasised rule in the document verbatim writes a broken import, then discovers the real path
by grep — which is exactly the friction the rule exists to remove. At least two sessions had already
hit it on `lib/changelog.ts` and `lib/cache-ttl.ts`.

## Built the check first, then fixed what it reported

Rather than trusting the review's list of nine, I wrote the validator first and let it find them.
It reported **exactly nine**, independently — which is a small but real corroboration of the review.

Thirteen occurrences in total (four of them `lib/changelog.ts`). Also corrected: the header sentence
of the One-Formula-One-Place rule, which claimed domain math *"lives exactly once in `lib/`"*. That
is not a path so no checker would ever catch it, and it would send a reader to the wrong directory
while looking authoritative.

## The durable half

`scripts/check-claude-md-paths.js`, wired into **Custom Rules** in CI. It validates every backticked
path and every `@/…` / `@trainingai/…` import specifier in CLAUDE.md, and prints a
`-> moved to packages/shared/src/…` hint when it can work one out.

Two things it deliberately does *not* flag:

- **Template filenames** — `docs/handoff-YYYY-MM-DD-<domain>-….md`, `docs/domains/<pillar>/README.md`.
  These are patterns, not paths.
- **Genuine exceptions**, which live in a `DELIBERATE` map **with a written reason each** — the
  deliberate *"there is no `lib/health/score-band.ts`"*, two route directories named without their
  `/route.ts`, and the APK artifact that does not exist until Gradle runs. Requiring a reason is
  what stops the check being hollowed out one silent exemption at a time.

Unquoted prose is left alone: backticking a path is the signal that it is meant literally.

## Verified, not assumed

- The check passes on the corrected file: **100 paths, all exist**.
- Planted the original defect back (`@/lib/date-utils` in the Timezone example) and confirmed it
  exits 1 and names both the line and the correct replacement. A ratchet that has never been seen to
  fail is decoration.
- `tsc --noEmit` clean · full suite green · every other custom-rule script still passes.

## Why this one was worth doing

A wrong path in code fails to compile. A wrong path in a rulebook is read as instruction, copied
confidently, and rots silently — and this repo's rulebook is the first thing every session reads.
It is also the same failure class that dominated this session from the other direction: five backlog
entries whose stated premises turned out to be wrong. Documentation that cannot be verified drifts,
and drifted documentation is worse than none, because it is trusted.

## Not exercised

Nothing runtime changed, so there is nothing to verify on device. The check reads only `CLAUDE.md`;
`projectOverview.md`, the backlog and the plan docs have the same rot potential and are **not**
covered — extending it there is a bigger job (those files legitimately name historical paths that no
longer exist) and was not attempted.

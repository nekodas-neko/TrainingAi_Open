# 2026-09-10 — the dependency debt, 36 findings down to 1 (standing item)

**PR:** `chore/dependabot-remediation` · **Lane B** · `package.json`, `pnpm-lock.yaml`.

`CLAUDE.md` makes Dependabot remediation a standing item an implementer takes **before** any numbered
entry once the debt crosses **≥ 5 outstanding high/critical**. Lane B's READY was 0, so the queue was
checked and the standing item's own instruction followed — *"re-check `pnpm audit` before taking
this"*. It read **36 findings: 23 high, 2 critical**, against a stored state of *"2 high, currently
below threshold — skip"* dated **2026-07-27**. Six weeks stale and five times over the line.

**After: 1 moderate.** `adm-zip` GHSA-vwc7-r8mq-g2x9 via `onnxruntime-node`, which has **no published
fix** — `patched_versions: <0.0.0` — so there is nothing to bump and nothing owed.

## What changed

Two direct patch bumps within the same major:

| package | from | to | resolved | why |
|---|---|---|---|---|
| `next` | `^15.5.22` | `^15.5.24` | 15.5.25 | the **critical** |
| `sharp` | `^0.35.3` | `^0.35.4` | 0.35.4 | libheif CVEs |

…and six `pnpm.overrides` for packages reached only transitively: `undici` (via `jsdom`), `nanoid`
(via `@tailwindcss/postcss`), `fast-uri` (via `@sentry/nextjs`), `@xmldom/xmldom` and
`brace-expansion` (via `@capacitor/assets`), `qs` (via `googleapis`), and `sharp` again for the
nested copy below.

**Version-keyed, not bare**, which is the part worth carrying forward. The repo's existing overrides
are mostly of the `"esbuild@<0.28.1": ">=0.28.1"` shape and that is the safe one: a bare
`"nanoid": ">=3.3.18"` resolves **nanoid 5**, which is ESM, under a `postcss` that wants CJS `^3`.
Every override added here carries its `<` bound and an upper bound inside the same major.

## The stored note was wrong in the direction that costs time

The 2026-07-27 state said the `sharp` advisory was reached via `next > sharp` and that fixing it
meant *"a major `next` bump or a force-override under Next's own dependency — either gets its own
PR"*. Both halves were wrong by the time they were read:

- The live path was **`@capacitor/assets > sharp@0.32.6`**. The direct bump and the `next` bump both
  moved their own copies; the nested one stayed at 0.32.6 and kept reporting.
- **`@capacitor/assets` is a devDependency invoked by no script and no CI job** — it generates icons
  when someone runs it by hand. Verified by grepping `package.json`, `.github/workflows/*.yml` and
  `scripts/`. So `"sharp@<0.35.4": ">=0.35.4"` is one line whose only failure mode is a tool nobody
  runs automatically, and whose reversal is deleting that line.

Read as *"this needs a major framework bump"*, it looked like work that had to wait for a dedicated
session. It was a one-line override. **Check which consumer actually pulls the vulnerable copy before
concluding an override is unsafe** — the standing item now says so.

## Cleared opportunistically in the same pass

`vitest` `^4.1.8` → `^4.1.11` (a moderate, and a patch bump within 4.1) — the standing item permits
moderates when already touching related deps, and the test runner is exercised by the gate anyway.

## Verification

A framework bump is the case where a green typecheck proves least, so the whole gate was run:

- `tsc --noEmit` clean.
- **Full unit suite green on vitest 4.1.11 — 877 files, 8,245 tests**, 3 skipped.
- `pnpm lint`: 0 errors (667 warnings, the existing baseline).
- `pnpm check:rules` — **Ran 71 of 71**.
- `pnpm build` on Next 15.5.25: exit 0, 244 static pages generated.
- **E2E smoke against the bumped runtime**, since the build is a compile and not a run:
  `one-calorie-budget`, `toggle-aria-state` and `workout-set-loop` — 7 passed.

**Not exercised:** the S25 APK. The APK is a WebView loading from Railway, so a Next patch reaches it
through the deploy with no rebuild — but nothing here was seen running on the device, and `sharp`'s
override touches an icon-generation tool that has not been run since.

No version or changelog entry: nothing user-visible changed.

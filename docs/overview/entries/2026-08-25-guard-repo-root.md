# 2026-08-25 — nothing guarded the repo root, so one scratch file failed every open PR (BF-20)

**Branch:** `chore/guard-repo-root` · **Lane A** · one check script, one CI step, `.gitignore`.

`m.mjs` — a 39-line Playwright screenshot scratch script referenced by nothing — was committed at the
root in #442 and merged. Its three `console.log` calls fail `no-console`, so **`main` itself went red
and every open PR inherited it**: a docs-only PR failed Lint on a file three directories from
anything it touched, and deleting `m.mjs` was the only way to unblock any of them.

This is the `git add -A` hazard `CLAUDE.md` already documents, which bit twice on 2026-08-08 and
again here. Prose has not held it.

## The entry's allowlist was a guess, and it would have failed on nine correct files

BF-20 proposed allowing `next.config`, `sentry.*`, `vitest.config`, `eslint.config`,
`tailwind.config`, `postcss.config`. Against the actual tree that fails on **`auth.ts`,
`auth.config.ts`, `middleware.ts`, `drizzle.config.ts`, `instrumentation.ts`,
`instrumentation-client.ts`, `instrumentation-node.ts`, `capacitor.config.ts`,
`playwright.config.ts`, `vitest.setup.ts`** — and names a `tailwind.config` this repo does not have,
because Tailwind v4 is configured in CSS.

**A guard that fails on correct files is worse than none**, because the first person to hit it
deletes it. The allowlist is derived from `git ls-files`, with the reason each file has to sit at the
root written beside it.

## The `.gitignore` half needed a correction the entry did not anticipate

BF-20 asks for "the same patterns in `.gitignore` so the file is never staged in the first place".
Applied literally to `*.ts` that is a **worse** trap than the one being fixed: fourteen legitimate
root `.ts` files exist, and a new one would be **silently untracked** — a missing file nobody staged
is far harder to diagnose than a red check that names it.

So the two halves cover different extensions on purpose:

- **`.gitignore`** takes root `*.js` / `*.mjs` / `*.cjs`, where the legitimate set is small — and
  negates the *shape* `*.config.*` rather than today's two filenames, so a future
  `next.config.mjs` or `tailwind.config.js` cannot be silently ignored.
- **The check** covers everything including `.ts`, loudly and by name.

## Sibling sweep

The entry asks for one: other scratch files already committed. **The root is clean** — all 32
tracked root files are config, lockfiles or docs. No stray `*.png`, no capture `*.json`. `m.mjs` was
the only one and #443 had already removed it.

## Verified

- **Both directions, on planted files.** A root `m.mjs` fails the check by name and is refused by
  `.gitignore`; a hypothetical `next.config.mjs`, `tailwind.config.js`, `postcss.config.mjs` and
  `eslint.config.mjs` are each confirmed **not** ignored. A root `probe.ts` fails the check (exit 1)
  while being outside the ignore rules, which is the split described above working.
- `pnpm check:rules` — **Ran 57 of 57** (56 before), which is the evidence the step is wired rather
  than merely written.

## Not exercised

Nothing on the device; CI-only change, no product code. **The check sees only TRACKED files**, so it
catches a stray that was committed rather than one sitting unstaged in a working tree — which is the
right half to catch, since only a committed file can turn `main` red, but it is worth knowing the
`.gitignore` half is what covers the other one, and only for three extensions.

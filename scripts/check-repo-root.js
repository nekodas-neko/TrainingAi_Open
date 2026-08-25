#!/usr/bin/env node
// BF-20 — nothing guards the repo root, and a scratch script got in.
//
// `m.mjs`, a 39-line Playwright screenshot scratch script referenced by nothing, was committed at
// the root in #442 and merged. Its three `console.log` calls fail `no-console`, so **`main` itself
// went red and every open PR inherited it** — a docs-only PR (#443) failed Lint on a file three
// directories away from anything it touched, and removing `m.mjs` was the only way to unblock any
// of them.
//
// This is the `git add -A` hazard `CLAUDE.md` documents, which bit twice on 2026-08-08 and again
// here. Prose has not held it, so this is the check.
//
// **The allowlist is derived from the tree, not from a guess.** The backlog entry proposed
// `next.config`, `sentry.*`, `vitest.config`, `eslint.config`, `tailwind.config`, `postcss.config`
// — which would have failed on NINE legitimate root files (`auth.ts`, `auth.config.ts`,
// `middleware.ts`, `drizzle.config.ts`, the three `instrumentation*.ts`, `capacitor.config.ts`,
// `playwright.config.ts`, `vitest.setup.ts`) and names a `tailwind.config` this repo does not have
// — Tailwind v4 is configured in CSS. A guard that fails on correct files is worse than none,
// because the first person to hit it deletes it.
//
// Adding a genuinely new root-level module means adding it here, in the same PR. That is the point:
// the addition shows up in the diff and someone reads it.

const { execSync } = require('child_process')

const GUARDED = /\.(js|mjs|cjs|ts|tsx)$/

const ALLOWED = new Set([
  // Framework and tooling config that must sit at the root to be found.
  'next.config.ts', 'postcss.config.mjs', 'eslint.config.mjs', 'drizzle.config.ts',
  'capacitor.config.ts', 'playwright.config.ts', 'vitest.config.ts', 'vitest.setup.ts',
  // Next.js reads these from the root by name; they cannot move.
  'middleware.ts', 'instrumentation.ts', 'instrumentation-client.ts', 'instrumentation-node.ts',
  'sentry.edge.config.ts', 'sentry.server.config.ts',
  // NextAuth's split config — `auth.config.ts` is the edge-safe half `middleware.ts` imports.
  'auth.ts', 'auth.config.ts',
])

const offenders = execSync('git ls-files --full-name', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  .split('\n')
  .filter(Boolean)
  .filter(f => !f.includes('/'))
  .filter(f => GUARDED.test(f))
  .filter(f => !ALLOWED.has(f))

if (offenders.length > 0) {
  console.error('Repo-root check failed — a module is committed at the repo root:\n')
  for (const f of offenders) console.error(`  • ${f}`)
  console.error(`
      A scratch script at the root fails Lint for every open PR, not just yours (BF-20).
      Move it under scripts/ (or delete it), or — if it genuinely must live at the root
      because a tool looks for it there — add it to ALLOWED in scripts/check-repo-root.js
      with the reason, in the same PR.`)
  process.exit(1)
}

console.log(`check-repo-root: OK (${ALLOWED.size} allowed root modules, no strays)`)

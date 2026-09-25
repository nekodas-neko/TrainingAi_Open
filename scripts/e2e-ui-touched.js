#!/usr/bin/env node
'use strict';
//
// Does a changed-file list touch anything a browser reaches? (LB-108)
//
// The E2E job always runs and always reports, skipping its expensive half when a PR cannot change
// what Playwright sees — LA-22's design, so a required check never leaves a PR pending, and LA-63's
// refinement, which dropped `app/api/**` because no browser reaches it. Both are right.
//
// **What was wrong is the `lib/` half.** The workflow matched four prefixes and `lib/` was not among
// them, because `lib/` was not a browser-reached directory when the list was written. PR #1173
// changed `lib/resume-repaint.ts` and `lib/hooks/use-resume-repaint.ts` and **E2E went green in 40
// seconds on a ~28-minute suite** — the log is Postgres starting and stopping, no Playwright
// invocation at all.
//
// **A prefix list cannot fix it, which is the finding that changed this fix.** Measured 2026-09-24:
// `lib/` holds **282 source files, 81 of them reachable from a `'use client'` module and 201 not**.
// The reachable set is not a few tidy subtrees — it includes `lib/sqlite/cache.ts`, which every
// screen reads through, and `lib/resume-repaint.ts`, one of the two files in the PR that exposed
// this and the one a subtree list still misses. LB-108's own recommendation (`lib/hooks`,
// `lib/stores`, `lib/media`) would have covered a fraction, and `lib/media` contains no client file
// at all.
//
// Matching all of `lib/` instead is the other failure: it buys the full suite for 201 engine files
// and undoes LA-63.
//
// **So reachability is computed rather than listed.** Roots are the files carrying `'use client'`;
// the walk follows their relative and `@/lib/...` imports. The set maintains itself, which matters
// because the list drifted unnoticed for months and nothing said so.
//
// **⚠ THE FIRST VERSION OF THIS FILE GREPPED FOR ROOTS INSIDE `lib/` ONLY, and that reproduced a
// smaller copy of the bug it replaced (OR-158, measured 2026-09-24).** Almost no client component
// lives in `lib/` — they live in `app/` and `components/`, and those are matched by the prefix rule
// below, so their own `lib/` imports were never walked. Measured: **47 `lib/` modules are imported
// directly by a `'use client'` file under `app/`/`components/` and were NOT marked reachable**,
// among them `lib/cache-groups.ts` and `lib/haptics.ts`. So a PR touching only `lib/cache-groups.ts`
// skipped the browser run, which is exactly the class LB-108 existed to close. The `81` quoted above
// is the OLD number and is left standing because that paragraph records what was measured then.
//
// **Correcting the roots ALONE took it to 179 of 282, and that was too many for a second reason**
// found in the same pass: the walk counted `import type` as an edge. `early-deload-card.tsx`
// type-imports one symbol from `lib/health/readiness-payload.ts`, which re-exports
// `lib/data/index.ts` — so the Postgres adapter arrived in the reachable set behind a type that the
// compiler erases. With type-only edges dropped the figure is **124 of 282**, and
// `lib/data/postgres/adapter.ts` correctly skips again.
//
// **`instrumentation-client.ts` is a root by NAME, not by directive.** It is Next's client
// instrumentation hook — it runs in every browser session and carries no `'use client'`, because it
// does not need one. Nothing else matched it: not `lib/`, not the `app|components|e2e` prefixes. It
// was found by checking a merged PR (#1569) that changed it and skipped E2E. **Any future
// convention-named client entry point needs adding here by hand** — that is the cost of the
// directive being the signal.
//
// **Known floor, stated rather than papered over:** this follows static `from '…'` imports only. A
// dynamic `import()` built from a variable, or a module reached solely through a `require`, is not
// seen. Those are rare here and the failure direction is the bad one, so a NEW client entry point
// is worth a look at this file.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// Client entry points Next.js identifies by FILENAME, so they carry no `'use client'` and no grep
// finds them. Add one here when a new convention-named browser entry point appears.
const CONVENTION_CLIENT_ROOTS = ['instrumentation-client.ts'];

/** Files that declare themselves client components — the roots of everything a browser loads. */
function clientRoots() {
  // grep exits 1 on no match. That would throw here and fail the step — which is the SAFE
  // direction (a red check, not a silent green) but a confusing way to say "lib/ has no client
  // code", so it is handled rather than left to surface as a stack trace.
  let out;
  try {
    out = execFileSync('grep', ['-rl', "^'use client'", 'lib/', 'app/', 'components/'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
  } catch (err) {
    if (err.status === 1) out = '';
    else throw err;
  }
  const roots = out.trim().split('\n').filter(Boolean);
  for (const named of CONVENTION_CLIENT_ROOTS) {
    if (fs.existsSync(path.join(ROOT, named))) roots.push(named);
  }
  return roots;
}

/** Every `lib/` module reachable from those roots, the roots included. */
function clientReachable() {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    let src;
    try {
      src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    } catch {
      return;
    }
    // `import type … from` and `export type … from` are erased by the compiler, so they are not
    // edges a browser follows. Dropping them is not a nicety: `early-deload-card.tsx` type-imports
    // one symbol from `lib/health/readiness-payload.ts`, which re-exports `lib/data/index.ts`, and
    // that alone pulled the Postgres adapter into the reachable set — the whole server engine
    // arriving behind a type. A mixed `import { type A, b }` keeps its edge, because `b` is real.
    const runtime = src.replace(/\b(?:import|export)\s+type\s+[^;\n]*?\bfrom\s*['"][^'"]+['"]/g, '');
    for (const m of runtime.matchAll(/from\s+['"](@\/lib\/[^'"]+|\.\.?\/[^'"]+)['"]/g)) {
      const spec = m[1];
      const base = spec.startsWith('@/lib/')
        ? `lib/${spec.slice('@/lib/'.length)}`
        : path.normalize(path.join(path.dirname(file), spec));
      if (!base.startsWith('lib/')) continue;
      for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
        const cand = base + ext;
        const abs = path.join(ROOT, cand);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          walk(cand);
          break;
        }
      }
    }
  };
  clientRoots().forEach(walk);
  return seen;
}

/**
 * @param {string[]} files  changed paths, repo-relative
 * @returns {{touched: boolean, why: string[]}}
 */
function uiTouched(files, reachable = clientReachable()) {
  const why = [];
  for (const f of files) {
    if (!f) continue;
    // `app/api/**` reaches no browser (LA-63); a vitest file under app/ or components/ is not
    // loaded by one either, and one such file bought four ~34-minute runs (PR #1405).
    if (f.startsWith('app/api/')) continue;
    if (/(^|\/)__tests__\//.test(f)) continue;
    if (/^(app|components|e2e)\//.test(f) || f === 'playwright.config.ts') why.push(f);
    else if (reachable.has(f)) why.push(`${f} (reached from a client module)`);
  }
  return { touched: why.length > 0, why };
}

module.exports = { uiTouched, clientReachable, clientRoots };

if (require.main === module) {
  const files = fs.readFileSync(0, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const { touched, why } = uiTouched(files);
  if (touched) {
    console.error(`e2e-ui-touched: browser suite REQUIRED — ${why.length} file(s) a browser reaches:`);
    why.slice(0, 20).forEach((w) => console.error(`  ${w}`));
    if (why.length > 20) console.error(`  … and ${why.length - 20} more`);
  } else {
    console.error('e2e-ui-touched: nothing a browser reaches — skipping the browser run.');
  }
  process.stdout.write(touched ? 'true' : 'false');
}

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
// **Known floor, stated rather than papered over:** this follows static `from '…'` imports only. A
// dynamic `import()` built from a variable, or a module reached solely through a `require`, is not
// seen. Those are rare here and the failure direction is the bad one, so a NEW client entry point
// is worth a look at this file.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/** Files that declare themselves client components — the roots of everything a browser loads. */
function clientRoots() {
  // grep exits 1 on no match. That would throw here and fail the step — which is the SAFE
  // direction (a red check, not a silent green) but a confusing way to say "lib/ has no client
  // code", so it is handled rather than left to surface as a stack trace.
  let out;
  try {
    out = execFileSync('grep', ['-rl', "^'use client'", 'lib/'], { cwd: ROOT, encoding: 'utf8' });
  } catch (err) {
    if (err.status === 1) return [];
    throw err;
  }
  return out.trim().split('\n').filter(Boolean);
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
    for (const m of src.matchAll(/from\s+['"](@\/lib\/[^'"]+|\.\.?\/[^'"]+)['"]/g)) {
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

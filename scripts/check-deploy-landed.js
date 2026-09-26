#!/usr/bin/env node
// OR-168 — did the deploy this merge triggered actually reach production?
//
// Merging to `main` auto-deploys to Railway and, until this existed, nothing checked the result.
// The 2026-08-17 outage — a database-free route unreachable for ~8 minutes — was found by the owner
// noticing, not by anything telling him.
//
// **It notifies; it never acts.** Owner's call, 2026-09-25, and the reasoning is worth keeping: an
// automatic revert across a migration can leave production worse than the bad deploy did. A check
// that tells you is strictly better than no check; a check that *acts* is a mechanism that can
// itself fail. The only outcomes here are exit 0 and exit 1.
//
// Three things make the obvious implementation wrong, and each one is load-bearing:
//
//  1. **`version` cannot identify a deploy.** It is `CHANGELOG[0].version`, so it moves only when a
//     PR bumps the changelog — most merges do not, and a docs PR never does. Polling it would sit
//     green against the PREVIOUS deploy. `nativeBuildSha` is the APK's sha, a different artefact.
//     `webBuildSha` (this entry's addition) is the web deploy's commit.
//  2. **`/api/version` is `Cache-Control: public, max-age=300`** — deliberately, and the single
//     written exemption in `check-api-no-store.js`. An unbusted poll can answer from five minutes
//     ago and report a deploy that has not happened. Do not remove the header; bust it per request.
//  3. **The sha's length is not guaranteed.** Railway supplies `RAILWAY_GIT_COMMIT_SHA`;
//     `app/sw.js/route.ts` already truncates the same value to 12 for its cache name. So compare by
//     prefix in either direction rather than assuming 40 characters.
'use strict';

const DEFAULT_URL = 'https://trainingai-production.up.railway.app';
/** Below this, a "prefix match" is a coincidence rather than an identification. */
const MIN_PREFIX = 7;

/**
 * Does the sha production reports identify the commit we are waiting for? Either may be the
 * truncation of the other, which is why this is not `===`.
 */
function shaMatches(want, got) {
  if (typeof want !== 'string' || typeof got !== 'string') return false;
  const a = want.trim().toLowerCase();
  const b = got.trim().toLowerCase();
  if (a.length < MIN_PREFIX || b.length < MIN_PREFIX) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/** What to tell a human when the deadline passes. The three cases are genuinely different faults. */
function diagnose({ want, got, body, elapsedMs }) {
  const secs = Math.round(elapsedMs / 1000);
  const head = `Production is NOT serving ${want.slice(0, 12)} after ${secs}s.`;
  if (body == null) {
    return `${head}\n  /api/version did not answer at all — the app may be down, which is the case this check exists for.`;
  }
  if (!got) {
    return `${head}\n  /api/version answered but carries no webBuildSha. Either the running deploy predates`
      + `\n  that field, or RAILWAY_GIT_COMMIT_SHA is unset on the Railway service — check its variables.`;
  }
  return `${head}\n  It is still serving ${got.slice(0, 12)}. The deploy either failed or has not finished.`;
}

async function readDeployedSha(baseUrl, fetchImpl) {
  // Cache-busted per read — see note 2 above.
  const url = `${baseUrl}/api/version?cb=${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const res = await fetchImpl(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) return { body: null, sha: null };
    const body = await res.json();
    return { body, sha: typeof body.webBuildSha === 'string' ? body.webBuildSha : null };
  } catch {
    return { body: null, sha: null };
  }
}

async function waitForDeploy({
  want,
  baseUrl = DEFAULT_URL,
  deadlineMs,
  pollMs,
  fetchImpl = fetch,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  now = () => Date.now(),
  log = () => {},
}) {
  const began = now();
  for (;;) {
    const { body, sha } = await readDeployedSha(baseUrl, fetchImpl);
    const elapsedMs = now() - began;
    if (shaMatches(want, sha)) {
      return { ok: true, elapsedMs, sha };
    }
    if (elapsedMs >= deadlineMs) {
      return { ok: false, elapsedMs, sha, message: diagnose({ want, got: sha, body, elapsedMs }) };
    }
    log(`  t+${Math.round(elapsedMs / 1000)}s: serving ${sha || '<no webBuildSha>'}`);
    await sleep(pollMs);
  }
}

module.exports = { shaMatches, diagnose, waitForDeploy, DEFAULT_URL, MIN_PREFIX };

if (require.main === module) {
  const want = process.env.GITHUB_SHA;
  if (!want) {
    console.error('check-deploy-landed: GITHUB_SHA is not set; nothing to wait for.');
    process.exit(1);
  }
  const baseUrl = process.env.APP_URL || DEFAULT_URL;
  const deadlineMs = Number(process.env.DEADLINE_SECONDS || 1500) * 1000;
  const pollMs = Number(process.env.POLL_SECONDS || 20) * 1000;
  console.log(`Waiting for ${baseUrl} to serve ${want.slice(0, 12)}`);
  waitForDeploy({ want, baseUrl, deadlineMs, pollMs, log: m => console.log(m) }).then(r => {
    if (r.ok) {
      console.log(`Production is serving ${r.sha.slice(0, 12)} after ${Math.round(r.elapsedMs / 1000)}s.`);
      process.exit(0);
    }
    console.error(`::error::${r.message}`);
    console.error('  Nothing has been rolled back — this check only reports (OR-168).');
    process.exit(1);
  });
}

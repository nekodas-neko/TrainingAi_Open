#!/usr/bin/env node
// #4051 — the release workflow's three decisions, kept here so they are tested without a release.
//
// Release 1.531.0 deployed a commit three merges behind `main`; one of those merges had changed
// `.github/workflows/ci.yml`. Production changed, and then the tag push was refused: GitHub will not
// let a workflow's own token create a ref whose workflow files differ from the default branch's.
// The tag is the rollback anchor, so a release with no tag is a release that went out half done.
//
//  1. `drift`          — do the workflow files at the commit differ from `origin/main`'s? Asked in
//                        `verify`, BEFORE the backup and the deploy, when it is still free to stop.
//  2. `tag`            — create and push `v<version>` (always tried: production is already live, so
//                        there is nothing to protect by not trying, and the rule for when GitHub
//                        refuses rests on one observed refusal). If the push fails and the workflow
//                        files differ from a fresh `origin/main`, say so and how to recover; if they
//                        do not, report git's own error. A tag already on the remote at exactly this
//                        commit is treated as done, so "Re-run failed jobs" can finish a release
//                        whose tag someone made by hand. A tag at ANOTHER commit is a hard failure:
//                        tags are permanent, and a rollback to a tag must always mean one commit.
//  3. `release-exists` — has the GitHub release page been made already? Same re-run reason.
//
// The fault is GitHub's limit, not ours, so none of this tries to get round it (no PAT, no other
// API route to a tag). It only finds the problem early and makes the recovery re-runnable.
//
//   node scripts/release-guards.js drift <sha> <release|hotfix>   exit 1 only in release mode
//   node scripts/release-guards.js tag <version> <sha>            exit 1 if the tag is elsewhere, or the
//                                                                  push fails (drift named if present)
//   node scripts/release-guards.js release-exists <tag>           exit 0 yes, 1 no, 2 could not tell
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');

const WORKFLOWS = '.github/workflows';

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function gitOrThrow(args, cwd) {
  const r = git(args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.err || r.out}`);
  return r.out;
}

/**
 * Workflow files that differ between `sha` and `base`. `--no-renames` so a moved file shows under
 * both of its names: the limit applies to a path that was created as much as one that changed.
 * Throws when either side is not a commit, so an unreadable base never reads as "no difference".
 */
/** @param {string} sha @param {{ base?: string, cwd?: string }} [opts] @returns {string[]} */
function workflowDrift(sha, { base = 'origin/main', cwd } = {}) {
  const out = gitOrThrow(['diff', '--name-only', '--no-renames', sha, base, '--', WORKFLOWS], cwd);
  return out ? out.split('\n') : [];
}

/** The message `verify` prints; the same list, worded for the mode's consequence. */
function driftMessage(files, sha, mode) {
  const list = files.map((f) => `  ${f}`).join('\n');
  const head = `The workflow files at ${sha.slice(0, 12)} differ from main's:\n${list}`;
  if (mode === 'release') {
    return (
      `${head}\nGitHub refuses to let this workflow create a tag at a commit whose workflow files ` +
      `differ from main's, so the tag step would fail AFTER the deploy. Nothing has been changed yet. ` +
      `Release main's head instead (leave sha blank), or re-cut the candidate from main's head.`
    );
  }
  return (
    `${head}\nThis is a hotfix, so it goes ahead. GitHub will refuse the tag push from this workflow ` +
    `for the same reason, so the tag and release page will need the owner (docs/owner-manual.md, ` +
    `"Tag and publish notes fails before the tag was created").`
  );
}

/**
 * Where `refs/tags/v<version>` is on the remote, read from the remote itself, not from a local
 * clone: a checkout only has the tags that existed when it was made. An annotated tag lists its
 * commit on a peeled `^{}` line, a lightweight one on the plain line.
 */
/** @param {string} tag @param {{ remote?: string, cwd?: string }} [opts] @returns {string | null} */
function remoteTagCommit(tag, { remote = 'origin', cwd } = {}) {
  const out = gitOrThrow(['ls-remote', '--tags', remote, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], cwd);
  if (!out) return null;
  const lines = out.split('\n').map((l) => l.split(/\s+/));
  const peeled = lines.find(([, ref]) => ref === `refs/tags/${tag}^{}`);
  return (peeled || lines[0])[0];
}

/** Thrown by `ensureTag` when the push failed and the workflow files differ from main's. */
class TagDriftError extends Error {
  /** @param {string} message @param {string[]} files */
  constructor(message, files) {
    super(message);
    this.files = files;
  }
}

/**
 * The message for a refused tag push when the workflow files differ from main's, AFTER the deploy:
 * says what state production is in, and quotes git so a refusal for another reason is not mislabelled.
 */
function lateDriftMessage(files, tag, sha, gitError = '') {
  const list = files.map((f) => `  ${f}`).join('\n');
  const said = gitError ? ` git said: ${gitError}` : '';
  return (
    `Production is already serving this release, but ${tag} was NOT created: the push was refused, and ` +
    `the workflow files at ${sha.slice(0, 12)} differ from main's, which is the usual reason GitHub ` +
    `refuses it.${said}\n${list}\n` +
    `This usually means a workflow change merged to main after Verify. Recovery: make the tag and ` +
    `release page yourself, either with \`gh release create ${tag} --target ${sha} --title ${tag} ` +
    `--generate-notes --notes-start-tag <previous tag>\` or the GitHub form (Releases, Draft a new ` +
    `release, tag ${tag}, target the commit ${sha.slice(0, 12)}, not main), then "Re-run failed jobs" on ` +
    `this run. docs/owner-manual.md, "Tag and publish notes fails before the tag was created".`
  );
}

/**
 * 'created' | 'exists' (already at this commit). Throws, with a message, if it is anywhere else or
 * the push fails. A tag already at this commit is answered FIRST, so a re-run after the owner made
 * the tag by hand still passes while the workflow files differ. Otherwise the push is ALWAYS tried:
 * production is already live, so not trying protects nothing. When the files differ from main's a
 * warning is printed first. If the push fails, main is fetched afresh and compared: drift gives a
 * TagDriftError (recovery steps), no drift gives git's own error. Either way git's stderr is quoted.
 * A tag created locally before a failed push is left (the runner is thrown away) and never reported.
 */
/** @param {string} version @param {string} sha @param {{ remote?: string, cwd?: string, base?: string, warn?: (msg: string) => void }} [opts] @returns {'created' | 'exists'} */
function ensureTag(version, sha, { remote = 'origin', cwd, base = 'origin/main', warn = (m) => console.log(m) } = {}) {
  const tag = `v${version}`;
  const full = gitOrThrow(['rev-parse', '--verify', `${sha}^{commit}`], cwd);
  const there = remoteTagCommit(tag, { remote, cwd });
  if (there) {
    if (there === full) return 'exists';
    throw new Error(
      `${tag} already exists on ${remote} at ${there.slice(0, 12)}, not at the released commit ` +
        `${full.slice(0, 12)}. Tags are permanent and are never moved, so this is not retried. ` +
        `Find out which commit shipped (the deploy confirmed ${full.slice(0, 12)}) before touching it.`
    );
  }
  const local = git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], cwd);
  if (local.code === 0 && local.out !== full) {
    throw new Error(`${tag} exists in this checkout at ${local.out.slice(0, 12)}, not at ${full.slice(0, 12)}.`);
  }
  // Best effort: a failure to compare must not stop the push from being tried.
  const driftNow = () => {
    try {
      gitOrThrow(['fetch', '--quiet', remote, 'main'], cwd);
      return workflowDrift(full, { base, cwd });
    } catch {
      return [];
    }
  };
  const before = driftNow();
  if (before.length > 0) {
    warn(
      `::warning::The workflow files at ${full.slice(0, 12)} differ from main's, so GitHub may refuse this ` +
        `tag push. Trying anyway: production is already live.%0A${before.map((f) => `  ${f}`).join('%0A')}`
    );
  }
  if (local.code !== 0) gitOrThrow(['tag', tag, full], cwd);
  const push = git(['push', remote, `refs/tags/${tag}`], cwd);
  if (push.code === 0) return 'created';
  const gitError = push.err || push.out;
  const after = driftNow();
  if (after.length > 0) throw new TagDriftError(lateDriftMessage(after, tag, full, gitError), after);
  throw new Error(`git push ${remote} refs/tags/${tag} failed: ${gitError}`);
}

/**
 * Does the release page exist? `run` is `gh`'s seam: it returns { code, stderr }. Only gh's own
 * "release not found" counts as absent; any other failure (auth, network) is thrown rather than
 * read as "go and create it", which would then fail confusingly or, worse, duplicate.
 */
function ghRun(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  return { code: r.status, stderr: (r.stderr || '') + (r.stdout || '') };
}

/** @param {string} tag @param {{ run?: (args: string[]) => { code: number | null, stderr: string } }} [opts] @returns {boolean} */
function releaseExists(tag, { run = ghRun } = {}) {
  const r = run(['release', 'view', tag]);
  if (r.code === 0) return true;
  if (/release not found/i.test(r.stderr)) return false;
  throw new Error(`could not tell whether release ${tag} exists: ${r.stderr.trim()}`);
}

function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

function main(argv) {
  const [cmd, a, b] = argv;
  try {
    if (cmd === 'drift') {
      const mode = b;
      if (mode !== 'release' && mode !== 'hotfix') throw new Error('drift needs: <sha> <release|hotfix>');
      const files = workflowDrift(a);
      if (files.length === 0) {
        console.log(`Workflow files at ${a.slice(0, 12)} match origin/main's; the tag push will be accepted.`);
        return 0;
      }
      const msg = driftMessage(files, a, mode);
      if (mode === 'release') {
        console.log(`::error::${msg.replace(/\n/g, '%0A')}`);
        summary(`### Release refused before deploy\n\n\`\`\`\n${msg}\n\`\`\``);
        return 1;
      }
      console.log(`::warning::${msg.replace(/\n/g, '%0A')}`);
      summary(`### Warning: the tag will need the owner\n\n\`\`\`\n${msg}\n\`\`\``);
      return 0;
    }
    if (cmd === 'tag') {
      const result = ensureTag(a, b);
      console.log(result === 'exists' ? `v${a} is already on origin at ${b.slice(0, 12)}; nothing to create.` : `Pushed v${a}.`);
      return 0;
    }
    if (cmd === 'release-exists') {
      const yes = releaseExists(a);
      console.log(yes ? `Release ${a} already exists.` : `Release ${a} does not exist yet.`);
      return yes ? 0 : 1;
    }
    throw new Error('usage: release-guards.js drift|tag|release-exists ...');
  } catch (e) {
    console.log(`::error::${String(e.message).replace(/\n/g, '%0A')}`);
    if (e instanceof TagDriftError) summary(`### Released, but the tag was not created\n\n${e.message}`);
    return cmd === 'release-exists' ? 2 : 1;
  }
}

module.exports = { TagDriftError, workflowDrift, driftMessage, remoteTagCommit, ensureTag, releaseExists };

if (require.main === module) process.exit(main(process.argv.slice(2)));

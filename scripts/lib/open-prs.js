'use strict';
//
// Which queue entries already have an OPEN pull request?
//
// READY means "work nobody has started", and a queue entry stays in the file while its PR waits on
// the owner (the protocol removes it only when the PR merges). So an entry with an open PR looked
// exactly like untouched work. On 2026-09-28/29 a Lane A session rebuilt SIX security fixes that
// already had open PRs from earlier Lane A sessions, because this tool listed them as READY and
// nothing said otherwise.
//
// An entry matches a PR when its id appears in the PR's title (`RV-190`) or in its branch name
// (`lane-a/rv190-db-query`, where ids are usually lower-cased and de-hyphenated). The branch match
// needs a non-digit after the number, so `rv19` never claims `rv190`.

const { execFileSync } = require('child_process');

/** Open PRs as `{ number, title, headRefName, isDraft }`, or null when `gh` cannot answer. */
function fetchOpenPrs() {
  try {
    const out = execFileSync(
      'gh',
      ['pr', 'list', '--state', 'open', '--limit', '300', '--json', 'number,title,headRefName,isDraft'],
      { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/** Map of entry id → open PR numbers that name it. Ids are `[A-Z]+-\d+[a-z]?`, so safe in a RegExp. */
function matchOpenPrs(ids, prs) {
  const out = new Map();
  for (const id of ids) {
    const m = /^([A-Z]+)-(\d+)([a-z]?)$/.exec(id);
    if (!m) continue;
    const [, letters, num, suffix] = m;
    const inTitle = new RegExp(`(^|[^A-Za-z0-9])${id}(?![0-9a-z])`);
    const inBranch = new RegExp(`(^|[^a-z0-9])${letters.toLowerCase()}-?${num}${suffix}(?![0-9])`);
    const hits = prs
      .filter((p) => inTitle.test(p.title ?? '') || inBranch.test((p.headRefName ?? '').toLowerCase()))
      .map((p) => p.number);
    if (hits.length) out.set(id, hits);
  }
  return out;
}

module.exports = { fetchOpenPrs, matchOpenPrs };

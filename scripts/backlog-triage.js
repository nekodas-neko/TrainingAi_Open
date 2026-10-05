'use strict';
// Release-train Phase 1 (docs/superpowers/specs/2026-10-05-release-train-design.md §4.3): give every
// backlog entry a default verdict for the move to GitHub Issues. Uses the repo's own parser and the
// exact bucketing next-item.js uses, so its counts match the queue tool. Re-run right before the
// Phase 3 migration, because the backlog drifts:
//
//   node scripts/backlog-triage.js [backlog.md] [out.csv]
//
// Defaults: docs/implementation-backlog.md -> docs/superpowers/specs/2026-10-05-backlog-triage.csv
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const backlogPath = process.argv[2] || path.join(root, 'docs/implementation-backlog.md');
const outCsv = process.argv[3] || path.join(root, 'docs/superpowers/specs/2026-10-05-backlog-triage.csv');
const { parseEntries } = require('./lib/backlog-entries');
const { bucketFor } = require('./lib/queue-buckets');
const { keepKind, keepIsSettled } = require('./lib/keep-kind');

const lines = fs.readFileSync(backlogPath, 'utf8').split('\n');
const entries = parseEntries(lines);
const inQueue = new Set(entries.map((e) => e.id));

const PROCESS = /\b(backlog|queue|baton|lane[s]?\b|journal|handoff|next-item|doc-size|baseline|PR register|routine|session[s]? (start|title)|entry ids?|check-backlog|orchestrat|the O lane|batch(es)?\b|sittings?)\b/i;
const QUESTIONISH = /\?|\bhe wants\b|\byour\b|\bowner\b|\bdecide\b|\bdecision\b|\bkeep \/ hide\b/i;

function added(e) {
  for (const l of e.laneLines) {
    const m = l.match(/Added:\*{0,2}\s*`?(\d{4}-\d{2}-\d{2})/i);
    if (m) return m[1];
  }
  for (const l of e.laneLines) {
    const m = l.match(/(20\d{2}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  return '';
}

// Owner decisions and evidence from 2026-10-05 that the mechanical rules cannot see.
const OVERRIDES = {
  'Q-1a': ['milestone-v2', 'feature', 'v2 bundled-shell milestone (owner, 2026-10-05; spec §10)'],
  'Q-1b': ['milestone-v2', 'feature', 'v2 bundled-shell milestone (owner, 2026-10-05; spec §10)'],
  'OR-207': ['archive-resolved', '', 'the freeze settled the stranded PRs: #1849 merged, #1790/#1762 closed, #1499 held for release 1'],
  'LB-56': ['archive-resolved', '', 'answered by the release-train spec: E2E runs at release, not per PR'],
  'PS-4': ['obsolete-process', '', 'batons are retired by the release-train spec'],
  'PS-38': ['obsolete-process', '', 'a CLAUDE.md claims sweep; Phase 4 rewrites CLAUDE.md wholesale'],
  'OR-213': ['epic', 'epic', 'a five-phase programme cannot live in one issue: an epic, its phases as sub-issues (docs/architecture/ingest-and-scoring.md §6)'],
};

// The ingest architecture's phases (docs/architecture/ingest-and-scoring.md §6). Two already exist as
// entries — Phase 2 is OR-215 (the basis field), Phase 3 is OR-214 (the connector contract) — so they
// become sub-issues as they are. The other three have no entry and are created here, so the CSV stays
// the migration's only input.
const PARENT = { 'OR-214': 'OR-213', 'OR-215': 'OR-213' };
const EPIC_PHASES = [
  { id: 'OR-213/P0', verdict: 'issue', type: 'chore', domains: 'devices platform', note: 'architecture Phase 0; blocks nothing else',
    title: 'Ingest Phase 0 — make the raw archive safe: build the local archive and PROVE a restore, then stop writing raw to Railway, then drop the server copy' },
  { id: 'OR-213/P1', verdict: 'issue', type: 'engine', domains: 'platform devices', note: 'architecture Phase 1',
    title: 'Ingest Phase 1 — the normaliser and the signal catalogue: canonical sample shape, finest-available resolution, rank-decided sources (D1, D2). No storage moves' },
  { id: 'OR-213/P4', verdict: 'issue-blocked', type: 'blocked', domains: 'platform devices', needs: 'OR-213/P0 OR-213/P1 OR-214 OR-215', note: 'architecture Phase 4; last, after the other four',
    title: 'Ingest Phase 4 — the storage move: the device becomes the source of truth and the cloud takes scored values only' },
];
const rows = [];
for (const e of entries) {
  // Mirrors next-item.js exactly, so the buckets match what the queue tool prints.
  const unmet = e.needs.filter((n) => inQueue.has(n));
  const reasons = [];
  if (unmet.length) reasons.push(`Needs: ${unmet.join(', ')}`);
  const allGates = [...e.gates];
  for (const g of e.gates) reasons.push(`Gate: ${g}`);
  if (e.legacyBlocked && !e.gates.length && !unmet.length) reasons.push('unmigrated marker');
  if (e.keep?.gate && !e.gates.includes(e.keep.gate) && e.verify?.value !== e.keep.gate) {
    reasons.push(`Gate: ${e.keep.gate}`);
    allGates.push(e.keep.gate);
  }
  const bucket = bucketFor(e, reasons);
  const domain = e.tags[0] || 'platform';
  
  const needsLive = e.needs.filter((n) => inQueue.has(n));
  let verdict;
  let type = '';
  let group = '';
  let kk = '';
  if (bucket === 'ask') {
    verdict = 'question';
    type = 'question';
  } else if (bucket === 'parked') {
    if (allGates.includes('owner')) { verdict = 'question'; type = 'question'; }
    else if (allGates.includes('device')) { verdict = 'fold-device'; group = `device-check:${domain}`; }
    else { verdict = 'issue-blocked'; type = 'blocked'; }
  } else if (bucket === 'unclassified') {
    verdict = 'review';
  } else if (bucket === 'verify') {
    const v = e.verify && e.verify.value;
    if (v === 'owner') { verdict = 'fold-owner-look'; group = 'owner-look'; }
    else { verdict = 'fold-device'; group = `device-check:${domain}`; }
  } else if (bucket === 'keep') {
    kk = (e.keep.gate ? 'check' : keepKind(e.keep.text)) || '';
    if (keepIsSettled(e.keep, e.laneLines)) verdict = 'archive-shipped';
    else if (kk === 'check') { verdict = 'fold-device'; group = `device-check:${domain}`; }
    else if (kk === 'build') { verdict = 'issue'; type = 'follow-up'; }
    else { verdict = 'fold-watch'; group = 'watch-list'; }
  } else if (bucket === 'reference') {
    verdict = 'archive-reference';
  } else {
    // ready
    if (e.lane === 'DV') { verdict = 'fold-device'; group = `device-check:${domain}`; }
    else if (e.lane === 'T') { verdict = 'issue'; type = 'tuning'; }
    else if (e.lane === 'O') {
      if (PROCESS.test(e.title)) verdict = 'obsolete-process';
      else if (QUESTIONISH.test(e.title)) { verdict = 'question'; type = 'question'; }
      else { verdict = 'issue'; type = 'chore'; }
    } else { verdict = 'issue'; type = e.lane === 'B' ? 'surface' : 'engine'; }
  }
  let note = '';
  // A sub-issue is not blocked by its own epic: the epic is the container, not a prerequisite.
  if (PARENT[e.id]) {
    const rest = needsLive.filter((n) => n !== PARENT[e.id]);
    needsLive.length = 0;
    needsLive.push(...rest);
    if (!rest.length && verdict === 'issue-blocked') { verdict = 'issue'; type = 'engine'; }
  }
  if (OVERRIDES[e.id]) { [verdict, type, note] = OVERRIDES[e.id]; group = ''; }
  const a = added(e);
  const stale = /^issue/.test(verdict) && a && a < '2026-08-20' ? 'yes' : '';
  rows.push({ id: e.id, parent: PARENT[e.id] || '', verdict, type, group, bucket, lane: e.lane || '', domains: e.tags.join(' '), gates: allGates.join('+'), needs: needsLive.join(' '), keepKind: kk, added: a, reverify: stale, note, title: e.title.replace(/^\[[^\]]+\](\[[^\]]+\])*\s*/, '').replace(/\s+/g, ' ').slice(0, 140) });
}

for (const p of EPIC_PHASES) {
  rows.push({ id: p.id, parent: 'OR-213', verdict: p.verdict, type: p.type, group: '', bucket: 'synthetic', lane: 'O',
    domains: p.domains, gates: '', needs: p.needs || '', keepKind: '', added: '2026-10-05', reverify: '', note: p.note, title: p.title });
}

const esc = (s) => /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
const cols = ['id', 'parent', 'verdict', 'type', 'group', 'bucket', 'lane', 'domains', 'gates', 'needs', 'keepKind', 'added', 'reverify', 'note', 'title'];
fs.writeFileSync(outCsv, [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n');

const count = (k) => rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
console.log('entries', rows.length);
console.log('by verdict', count('verdict'));
console.log('by bucket', count('bucket'));
const groups = count('group');
delete groups[''];
console.log('groups', groups);
console.log('issues needing re-verify (added before 2026-08-20):', rows.filter((r) => r.reverify).length);

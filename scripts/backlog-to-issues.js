#!/usr/bin/env node
'use strict';
// Release-train Phase 3 (docs/superpowers/specs/2026-10-05-release-train-design.md §4.3, §8): move
// docs/implementation-backlog.md into GitHub Issues, using the verdicts in the Phase 1 triage CSV.
//
//   node scripts/backlog-to-issues.js --plan <out.json>   build the plan, touch nothing (dry run)
//   node scripts/backlog-to-issues.js --apply             create what the plan says (needs GH_TOKEN)
//
// IDEMPOTENT ON PURPOSE. Every issue it writes carries `<!-- backlog-id: X -->`, and a re-run skips
// any id already present on an open OR closed issue. A run that dies halfway is finished by running
// it again, never by deleting what it made.
//
// The CSV is the only input that decides WHAT is created; the backlog supplies each entry's text.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseEntries } = require('./lib/backlog-entries');

const root = path.resolve(__dirname, '..');
const CSV = path.join(root, 'docs/superpowers/specs/2026-10-05-backlog-triage.csv');
const BACKLOG = path.join(root, 'docs/implementation-backlog.md');
const BODY_LIMIT = 60000; // GitHub refuses an issue body over 65,536 characters.
const V2_MILESTONE = 'v2 — bundled shell';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const DOMAINS = new Set(['sleep', 'readiness', 'heart-rate', 'cardio', 'activity', 'workouts', 'nutrition', 'body', 'devices', 'app-shell', 'platform']);
const areaLabels = (domains) => [...new Set(domains.split(/\s+/).filter((d) => DOMAINS.has(d)))].map((d) => `area: ${d}`);
const cleanTitle = (t) => t.replace(/^\[[^\]]+\](\[[^\]]+\])*\s*/, '').replace(/\s+/g, ' ').trim();

function typeLabel(row) {
  if (row.type === 'question') return 'type: question';
  if (row.type === 'tuning' || row.lane === 'T') return 'type: tuning';
  if (row.type === 'chore') return 'type: chore';
  // The letter records who FOUND an entry, and BugFix files bugs. Everything else that is work
  // defaults to feature; the triage pass relabels anything that reads otherwise.
  return /^BF-/.test(row.id) ? 'type: bug' : 'type: feature';
}

function laneLabel(row) {
  if (row.lane === 'A' || row.type === 'engine') return 'lane: engine';
  if (row.lane === 'B' || row.type === 'surface') return 'lane: surface';
  return null;
}

function sourceLink(sha, line) {
  return `https://github.com/nekodas-neko/TrainingAi_Open/blob/${sha}/docs/implementation-backlog.md#L${line}`;
}

function clip(text) {
  if (text.length <= BODY_LIMIT) return text;
  return `${text.slice(0, BODY_LIMIT)}\n\n…*(truncated at ${BODY_LIMIT} characters — the full entry is at the source link above)*`;
}

/** Pure: everything that will be created, in creation order. No network. */
function buildPlan({ csvText, backlogLines, sha }) {
  const rows = parseCsv(csvText);
  const entries = new Map(parseEntries(backlogLines).map((e) => [e.id, e]));
  const lineOf = new Map();
  backlogLines.forEach((l, i) => {
    if (!l.startsWith('### ')) return;
    for (const id of entries.keys()) if (!lineOf.has(id) && l.includes(` ${id} `) ) lineOf.set(id, i + 1);
  });

  const entryText = (row) => {
    const e = entries.get(row.id);
    if (!e) return `Created by the migration as part of the ingest-architecture epic (${row.note}). The phase is specified in [\`docs/architecture/ingest-and-scoring.md\` §6](https://github.com/nekodas-neko/TrainingAi_Open/blob/main/docs/architecture/ingest-and-scoring.md#6-phasing), and the decisions it must respect (D1–D5) in §2 and §5 of the same file.`;
    return e.laneLines.join('\n').trim();
  };
  const header = (row) => {
    const parts = [];
    if (entries.has(row.id)) parts.push(`> Migrated from **\`${row.id}\`** in the retired backlog ([source](${sourceLink(sha, lineOf.get(row.id) || 1)})).`);
    if (row.reverify === 'yes') parts.push('> ⚠ **Filed before 2026-08-20 — re-verify the premise against `main` before building.**');
    if (row.needs) parts.push(`> **Blocked by** ${[...new Set(row.needs.split(/\s+/))].map((n) => `{{${n}}}`).join(', ')}`);
    if (row.type === 'question') parts.push('> **For the owner.** The Orchestrator rewrites this as a decision brief (recommendation first) before asking — or closes it with the reason if it has gone stale.');
    return parts.join('\n>\n');
  };

  const plan = [];
  const single = new Set(['issue', 'issue-blocked', 'question', 'epic', 'milestone-v2']);
  for (const row of rows) {
    if (!single.has(row.verdict)) continue;
    const title = entries.has(row.id) ? cleanTitle(entries.get(row.id).title) : row.title;
    const labels = [typeLabel(row), ...areaLabels(row.domains)];
    const lane = laneLabel(row);
    if (lane) labels.push(lane);
    if (row.verdict === 'issue-blocked') labels.push('blocked');
    if (row.reverify === 'yes') labels.push('re-verify');
    if (row.verdict !== 'question' && row.verdict !== 'epic' && row.lane !== 'O') labels.push('agent: implementer');
    plan.push({
      key: row.id,
      title,
      labels,
      milestone: row.verdict === 'milestone-v2' ? V2_MILESTONE : null,
      parent: row.parent || null,
      blockedBy: row.needs ? [...new Set(row.needs.split(/\s+/))] : [],
      // The marker goes FIRST: clip() cuts from the end, and a truncated-away marker would make a
      // re-run create the issue a second time.
      body: clip(`<!-- backlog-id: ${row.id} -->\n${header(row)}\n\n${entryText(row)}`),
    });
  }

  // Folded groups: many entries, one issue. Each member's full text rides inside a <details>.
  const groups = new Map();
  for (const row of rows) {
    let key = null;
    if (row.verdict === 'fold-device') key = row.group;
    else if (row.verdict === 'fold-owner-look') key = 'owner-look';
    else if (row.verdict === 'fold-watch') key = 'watch-list';
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const [key, members] of groups) {
    let title;
    let labels;
    let intro;
    if (key.startsWith('device-check:')) {
      const domain = key.slice('device-check:'.length);
      title = `Device checks owed — ${domain} (${members.length})`;
      labels = ['type: device-check', ...areaLabels(domain), 'agent: implementer'];
      intro = 'Checks that need the phone, folded from the retired backlog. The Implementer works these in release-test mode and answers each **VERIFIED / FAILED / COULD NOT CHECK**. A FAILED becomes its own bug issue; tick the box for anything resolved.';
    } else if (key === 'owner-look') {
      title = `Owner look — shipped things you said you'd look at (${members.length})`;
      labels = ['type: question'];
      intro = 'Already shipped; each is waiting only on the owner looking at it. Tick what you have seen, comment on anything that is wrong.';
    } else {
      title = `Watch list — shipped entries whose residue is "confirm it later" (${members.length})`;
      labels = ['type: chore'];
      intro = 'Shipped work with a light follow-up attached. The Orchestrator prunes this during the first release prep: each line is closed, promoted to its own issue, or dropped with a reason.';
    }
    // Each member links to its own full text at the pinned source rather than inlining it: inlined,
    // seven of the thirteen groups ran past GitHub's body limit and were cut mid-entry.
    const list = members.map((r) => `- [ ] **${r.id}** — ${entries.has(r.id) ? cleanTitle(entries.get(r.id).title) : r.title} ([entry](${sourceLink(sha, lineOf.get(r.id) || 1)}))`).join('\n');
    plan.push({
      key: `group:${key}`,
      title,
      labels,
      milestone: null,
      parent: null,
      blockedBy: [],
      body: clip(`<!-- backlog-id: group:${key} -->\n${intro}\n\n${list}`),
    });
  }
  // A blocker that was folded into a group resolves to that group's issue; one that was archived
  // resolves to nothing, and says so.
  const groupOf = {};
  for (const [key, members] of groups) for (const r of members) groupOf[r.id] = `group:${key}`;
  for (const p of plan) p.blockedVia = Object.fromEntries(p.blockedBy.filter((b) => groupOf[b]).map((b) => [b, groupOf[b]]));
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Apply: the only part that touches GitHub. Runs in .github/workflows/backlog-migration.yml.

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function existingByKey(repo) {
  const out = new Map();
  for (let page = 1; ; page++) {
    const batch = JSON.parse(gh(['api', `repos/${repo}/issues?state=all&per_page=100&page=${page}`]));
    for (const i of batch) {
      const m = (i.body || '').match(/<!-- backlog-id: (\S+) -->/);
      if (m && !i.pull_request) out.set(m[1], { number: i.number, id: i.id });
    }
    if (batch.length < 100) break;
  }
  return out;
}

function ensureMilestone(repo, title) {
  const all = JSON.parse(gh(['api', `repos/${repo}/milestones?state=all&per_page=100`]));
  const hit = all.find((m) => m.title === title);
  if (hit) return hit.number;
  return JSON.parse(gh(['api', '-X', 'POST', `repos/${repo}/milestones`, '-f', `title=${title}`])).number;
}

function apply(plan, repo) {
  const done = existingByKey(repo);
  console.log(`${done.size} already migrated; ${plan.filter((p) => !done.has(p.key)).length} to create.`);
  const v2 = plan.some((p) => p.milestone) ? ensureMilestone(repo, V2_MILESTONE) : null;

  for (const p of plan) {
    if (done.has(p.key)) continue;
    const payload = { title: p.title, body: p.body, labels: p.labels };
    if (p.milestone) payload.milestone = v2;
    const made = JSON.parse(gh(['api', '-X', 'POST', `repos/${repo}/issues`, '--input', '-'], JSON.stringify(payload)));
    done.set(p.key, { number: made.number, id: made.id });
    console.log(`#${made.number}  ${p.key}`);
    // GitHub's secondary limit is ~80 content writes a minute; this stays well under it.
    sleep(1500);
  }

  // Second pass, once every number exists: resolve "Blocked by {{KEY}}" and attach sub-issues.
  for (const p of plan) {
    const me = done.get(p.key);
    if (p.blockedBy.length) {
      const issue = JSON.parse(gh(['api', `repos/${repo}/issues/${me.number}`]));
      const body = issue.body.replace(/\{\{([^}]+)\}\}/g, (_, k) => {
        if (done.has(k)) return `#${done.get(k).number}`;
        const via = p.blockedVia[k];
        if (via && done.has(via)) return `\`${k}\` (in #${done.get(via).number})`;
        return `\`${k}\` (archived, not migrated — check whether it still blocks this)`;
      });
      if (body !== issue.body) {
        gh(['api', '-X', 'PATCH', `repos/${repo}/issues/${me.number}`, '--input', '-'], JSON.stringify({ body }));
        sleep(1500);
      }
    }
    if (p.parent && done.has(p.parent)) {
      const parent = done.get(p.parent).number;
      const subs = JSON.parse(gh(['api', `repos/${repo}/issues/${parent}/sub_issues?per_page=100`]));
      if (!subs.some((s) => s.number === me.number)) {
        gh(['api', '-X', 'POST', `repos/${repo}/issues/${parent}/sub_issues`, '-F', `sub_issue_id=${me.id}`]);
        console.log(`#${me.number} is now a sub-issue of #${parent}`);
        sleep(1500);
      }
    }
  }
  console.log(`Done: ${plan.length} planned, all present.`);
}

function summarise(plan) {
  const count = (f) => plan.reduce((m, p) => { for (const k of f(p)) m[k] = (m[k] || 0) + 1; return m; }, {});
  const lines = [
    `## Backlog → Issues: ${plan.length} issues`,
    '',
    '| By type | Count |', '|---|---|',
    ...Object.entries(count((p) => p.labels.filter((l) => l.startsWith('type:')))).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| \`${k}\` | ${v} |`),
    '',
    `**Blocked:** ${plan.filter((p) => p.labels.includes('blocked')).length} · **Re-verify:** ${plan.filter((p) => p.labels.includes('re-verify')).length} · **Sub-issues:** ${plan.filter((p) => p.parent).length} · **v2 milestone:** ${plan.filter((p) => p.milestone).length} · **Largest body:** ${Math.max(...plan.map((p) => p.body.length)).toLocaleString()} chars`,
    '',
    '| Key | Title | Labels |', '|---|---|---|',
    ...plan.map((p) => `| ${p.key} | ${p.title.replace(/\|/g, '\\|').slice(0, 100)} | ${p.labels.join(', ')} |`),
  ];
  return lines.join('\n');
}

module.exports = { buildPlan, parseCsv, summarise };

if (require.main === module) {
  const args = process.argv.slice(2);
  const sha = process.env.SOURCE_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const plan = buildPlan({ csvText: fs.readFileSync(CSV, 'utf8'), backlogLines: fs.readFileSync(BACKLOG, 'utf8').split('\n'), sha });
  const planOut = args[args.indexOf('--plan') + 1];
  if (args.includes('--plan')) {
    fs.writeFileSync(planOut, JSON.stringify(plan, null, 2));
    const md = summarise(plan);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
    console.log(md.split('\n').slice(0, 14).join('\n'));
  }
  if (args.includes('--apply')) apply(plan, process.env.GH_REPO || 'nekodas-neko/TrainingAi_Open');
}

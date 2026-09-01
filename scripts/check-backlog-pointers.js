#!/usr/bin/env node
/**
 * Custom Rules gate for docs/implementation-backlog.md.
 *
 * The backlog carries three numbers that sessions collide on, and every one of them had drifted by
 * 2026-08-17: the Postgres migration pointer was 11 behind the directory, the local SQLite version
 * was 4 behind the source, and Q-306 and Q-307 were each held by two different entries at once.
 * Prose could not hold them. This reads the real values and fails on a mismatch.
 *
 * Checks:
 *   1. No entry ID is used by two queue entries.
 *   2. Every queue entry heading carries at least one valid [domain] tag.
 *   3. The "Next free Postgres migration" pointer matches the migrations directory.
 *   4. The "Local SQLite schema version" pointer matches lib/sqlite/migrations.ts.
 *   5. Every `Needs:` names an ID that exists, or has existed, somewhere in the tree.
 *   6. No cycle among `Needs:` edges.
 *   7. Every `Gate:` value is one this project knows how to resolve.
 *   8. A `Batch:` is a kebab slug, and no batch mixes Lane A and Lane B — one batch is one PR, and
 *      one PR is one lane.
 *   9. No NEW queue entry announces its own completion in its heading (word list in
 *      `lib/completion-words.js`). The queue tracks what is still open; the PR and the journal are
 *      the record of what shipped. The 17 that already did are baselined below, shrink-only, and
 *      the list is now empty.
 *
 * IDs are `<letter>-<number>` with an optional lowercase suffix: LA/LB (implementer lanes), BF
 * (BugFix), RV (Review), TN (Tuning), PS (one-off planning sessions), and the legacy Q. The old "next
 * unallocated Q band" pointer check is gone with the bands themselves — see docs/agents/README.md
 * for why enumerated bands were replaced by per-agent counters.
 */

const fs = require('fs');
const path = require('path');
const { idPattern, idPartsPattern } = require('./lib/entry-id');
const { announcesCompletion } = require('./lib/completion-words');
const { referenceFromLines, hasProseMarker, PROSE_MARKERS } = require('./lib/reference');
const { verifyFromLines, verifyProblem } = require('./lib/verify');
const { keepFromLines } = require('./lib/keep');
const { keepKind } = require('./lib/keep-kind');

const ROOT = path.resolve(__dirname, '..');
const BACKLOG = path.join(ROOT, 'docs/implementation-backlog.md');
const MIGRATIONS = path.join(ROOT, 'lib/data/postgres/migrations');
const SQLITE = path.join(ROOT, 'lib/sqlite/migrations.ts');

// The eleven pillars, plus "cross" for entries that genuinely span several.
const PILLARS = new Set([
  'sleep', 'readiness', 'heart-rate', 'cardio', 'activity', 'workouts',
  'nutrition', 'body', 'devices', 'app-shell', 'platform', 'cross',
]);

const failures = [];
let batchSummary = '';
let completedSummary = '';
const text = fs.readFileSync(BACKLOG, 'utf8');
const lines = text.split('\n');

// Only the Queue section carries numbered entries; the header and Protocol do not.
const queueStart = lines.findIndex((l) => l.trim() === '## Queue');
if (queueStart < 0) {
  console.error('check-backlog-pointers: no "## Queue" heading found — has the file been restructured?');
  process.exit(1);
}
const queue = lines.slice(queueStart);

// ---- 1 & 2: entry headings -------------------------------------------------
const seen = new Map();
const entryOrder = [];
/** id -> { needs: [], gates: [], batch: null, lane: null, keep: false, body: 0, lines: [] } for the most recently opened heading. */
const meta = new Map();
let currentId = null;

for (let i = 0; i < queue.length; i++) {
  const line = queue[i];

  // A `## ` section heading ends the previous entry. Without this, a field written under a section
  // boundary — belonging to no entry — is attributed to the last entry above it. The queue carries
  // eight such boundaries.
  if (line.startsWith('## ') && !line.startsWith('### ')) {
    currentId = null;
    continue;
  }

  if (!line.startsWith('### ')) {
    // Body lines belong to the heading above them. `Needs:` and `Gate:` are what make readiness
    // computable instead of prose, so they are read here rather than left for a human to notice.
    if (currentId) {
      if (line.trim() !== '') meta.get(currentId).body++;
      const needs = line.match(/^\s*[-*]\s*\*{0,2}Needs:\*{0,2}\s*(.+)$/i);
      if (needs) {
        for (const m of needs[1].matchAll(idPattern('g'))) {
          meta.get(currentId).needs.push(m[1]);
        }
      }
      const gate = line.match(/^\s*[-*]\s*\*{0,2}Gate:\*{0,2}\s*([a-z]+)/i);
      if (gate) meta.get(currentId).gates.push(gate[1].toLowerCase());

      // BF-90. `Verify:` is matched here only so the inline-field guard below can see it; the value
      // itself is read from `lines` by `verifyFromLines`, the same function `next-item.js` calls,
      // so the two can never disagree about what the field says.
      const verify = line.match(/^\s*[-*]\s*\*{0,2}Verify:\*{0,2}\s*([a-z]+)/i);

      // A field written INLINE — `- **Added:** … · **Gate: owner**` — is not a field. The two
      // matchers above anchor at the start of a bullet, so an inline one is silently ignored and
      // the entry stays READY, which is the exact opposite of what writing it was meant to do.
      // Filed after making this mistake twice in two days: `Needs:` on 2026-08-20 and `Gate:` on
      // 2026-08-23, both by appending to the `Added:` line. Only the **bolded** form is flagged, so
      // prose that merely mentions the word is untouched.
      if (/\*\*(Gate|Needs|Verify):/i.test(line) && !needs && !gate && !verify) {
        failures.push(
          `${currentId}: a \`Gate:\`/\`Needs:\`/\`Verify:\` field is written inline and will be ` +
            `IGNORED — it must start its own bullet, or the entry stays READY:\n    ${line.trim().slice(0, 120)}`,
        );
      }

      const batch = line.match(/^\s*[-*]\s*\*{0,2}Batch:\*{0,2}\s*`?([^`\s]+)`?/i);
      if (batch && !meta.get(currentId).batch) meta.get(currentId).batch = batch[1];


      // Collected whole so the `Reference:` ratchet below sees the same lines `next-item.js` does.
      meta.get(currentId).lines.push(line);

      const lane = line.match(/\*{0,2}Lane:?\*{0,2}\s*\*{0,2}(A\b|B\b|\?)/);
      if (lane && !meta.get(currentId).lane) meta.get(currentId).lane = lane[1].trim();
    }
    continue;
  }

  currentId = null;

  const tags = [...line.matchAll(/\[([a-z-]+)\]/g)].map((m) => m[1]);
  const valid = tags.filter((t) => PILLARS.has(t));
  if (valid.length === 0) {
    failures.push(
      `Untagged queue entry — a heading with no valid [domain] tag is invisible to every ` +
        `per-pillar sweep:\n    ${line.slice(0, 120)}`,
    );
  }
  // An UNKNOWN tag beside a valid one used to pass silently, and that is worse than an untagged
  // entry: the heading looks tagged, `grep '\[health\]'` finds it, and there is no `health` pillar
  // for that sweep to belong to. Two entries had `[app-shell][health]` when this was added — one of
  // them written the same hour, by someone who had just read the pillar list.
  const unknown = tags.filter((t) => !PILLARS.has(t));
  if (unknown.length > 0) {
    failures.push(
      `Unknown [domain] tag ${unknown.map((t) => `[${t}]`).join(' ')} — not one of the eleven ` +
        `pillars in docs/domains/README.md, so no per-pillar sweep will ever look at it:\n    ` +
        `${line.slice(0, 120)}`,
    );
  }

  const q = line.match(idPartsPattern());
  if (!q) continue;
  const id = `${q[1]}-${q[2]}${q[3]}`;
  entryOrder.push(id);
  currentId = id;
  if (!meta.has(id)) meta.set(id, { needs: [], gates: [], batch: null, lane: null, keep: false, body: 0, lines: [], heading: line });

  if (seen.has(id)) {
    failures.push(
      `Duplicate ${id} — two queue entries hold the same number:\n` +
        `    ${seen.get(id).slice(0, 110)}\n    ${line.slice(0, 110)}`,
    );
  } else {
    seen.set(id, line);
  }
}

// ---- 2a: a heading with no entry under it ----------------------------------
//
// The signature of a resurrected entry, and the third time this class has landed on `main`.
//
// `docs/implementation-backlog.md` conflicts are almost always TWO DELETIONS — each PR removes the
// entry it finished, so when two land together the markers wrap *different* completed entries and
// "keep both" restores both. That is documented in `CLAUDE.md`, and a rule cannot reach a branch cut
// before it was written: #348 removed four resurrected entries, and #349 — branched earlier, by
// another agent — put LB-4 back four commits later.
//
// **What makes this checkable is that the restored heading carried no body at all.** A real entry
// always has bullets: a `Branch:`, an `Added:`, something. A bare heading followed by the next
// heading is not an entry anyone wrote, so there are no false positives to weigh.
//
// It is deliberately NARROWER than the class. A resurrection that restores a full entry passes this,
// and the obvious general check — flag a queue id that also has a journal entry — was measured and
// rejected: 25 ids sit in both today and most are legitimate, because an entry that shipped half its
// work stays queued with a `Keep:` line. The stronger check wants git history (was this id ever
// deleted from the backlog on `main`?), and CI checks out shallow at depth 1, so it would cost a
// deepened fetch on every run to catch a case that has not yet occurred.
for (const [id, m] of meta) {
  if (m.body === 0) {
    failures.push(
      `${id}: a queue heading with NOTHING under it. This is the signature of a merge resolution ` +
        `that restored a deleted entry — a backlog conflict is two deletions, and keeping both ` +
        `sides puts shipped work back in the queue where it reads exactly like open work. If the ` +
        `entry is genuinely open, write its body; if it shipped, delete the heading:\n    ` +
        `${m.heading.slice(0, 120)}`,
    );
  }
}

// ---- 2b: Gate values -------------------------------------------------------
// Three different blockers used to be written the same way as prose `blocked:` markers, with three
// different resolvers. A free-text gate is the same problem wearing a field name.
// ---- Reference entries: the marker must be a FIELD ------------------------
//
// Two entries in the queue exist to be READ rather than built, and said so only in prose —
// `⚑ Not implementable on its own` (BF-28) and `Not a work item` (BF-11). `next-item.js` had no
// notion of either, so BF-28 printed as READY #1 under a header that says "top of the list is
// next", and three sessions in a row opened the queue and met a row that cannot be started.
//
// The fix is a `- **Reference:** <why>` field, and this is what stops it decaying back into prose:
// an entry may keep the sentence for its detail, but the field has to be there beside it. Without
// this check the next map entry gets written with a third phrasing and the tool silently mis-sorts
// it again — which is the same argument that made `Lane:`, `Needs:` and `Gate:` fields.
for (const [id, m] of meta) {
  if (!hasProseMarker(m.lines)) continue;
  if (referenceFromLines(m.lines)) continue;
  failures.push(
    `${id}: says it is not implementable (${PROSE_MARKERS.map((p) => `"${p}"`).join(' / ')}) in prose ` +
      `only. next-item.js reads a FIELD, so this entry still prints as startable work — add ` +
      `\`- **Reference:** <why it is read rather than built>\` beside the sentence.`,
  );
}

const GATES = new Set(['owner', 'device']);
for (const [id, m] of meta) {
  for (const g of m.gates) {
    if (!GATES.has(g)) {
      failures.push(
        `${id} has \`Gate: ${g}\`, which is not a gate this project resolves. ` +
          `Use \`Gate: owner\` (a decision) or \`Gate: device\` (the S25 smoke run). ` +
          `A dependency on another entry is \`Needs:\`, not a gate.`,
      );
    }
  }
}

// ---- 2c: Verify values, and Gate/Verify contradictions ---------------------
//
// BF-90. `Gate:` carried two meanings — "cannot start" and "is done, look at it" — and a gate
// PARKS the entry, so the second kind sat beside genuinely blocked work. Measured 2026-09-01: 31 of
// 41 gates were `device`, and ELEVEN of those were on entries whose own headings said "shipped;
// device check owed". `Verify:` is the second meaning, given its own field and its own section.
//
// Same two values as `Gate:` deliberately — one vocabulary to remember, and `Verify: owner` is a
// real thing (an owner looking at a shipped tuning change, not deciding whether to build it).
for (const [id, m] of meta) {
  const problem = verifyProblem(m.gates, verifyFromLines(m.lines));
  if (!problem) continue;
  if (problem.kind === 'unknown-value') {
    failures.push(
      `${id} has \`Verify: ${problem.value}\`, which is not something this project resolves. ` +
        `Use \`Verify: device\` (the S25 smoke run on shipped work) or \`Verify: owner\` ` +
        `(the owner looking at shipped work). If the work cannot START yet, that is \`Gate:\`.`,
    );
  } else {
    failures.push(
      `${id} has both \`Gate: ${problem.value}\` and \`Verify: ${problem.value}\`. They contradict — ` +
        `a gate says this cannot start, a verify says it has shipped. Keep one: \`Gate:\` if the work ` +
        `is blocked, \`Verify:\` if it is done and awaiting a look. The gate would win silently.`,
    );
  }
}

// ---- 2b2: Batch slugs and lane purity --------------------------------------
// A batch is a set of entries that ship as ONE pull request, so that one verification pass covers
// all of them. One PR is one lane's work, so a batch spanning both lanes cannot be shipped as one.
{
  const batches = new Map();
  for (const [id, m] of meta) {
    if (!m.batch) continue;
    if (!/^[a-z][a-z0-9-]*$/.test(m.batch)) {
      failures.push(
        `${id} has \`Batch: ${m.batch}\` — a batch name is a lowercase kebab slug (e.g. ` +
          `\`nutrition-surface\`), because it is also the PR's branch suffix.`,
      );
      continue;
    }
    if (!batches.has(m.batch)) batches.set(m.batch, []);
    batches.get(m.batch).push([id, m.lane]);
  }
  for (const [name, members] of batches) {
    const lanes = new Set(members.map(([, l]) => l).filter((l) => l === 'A' || l === 'B'));
    if (lanes.size > 1) {
      const who = members.map(([id, l]) => `${id}=${l ?? '-'}`).join(', ');
      failures.push(
        `Batch \`${name}\` mixes Lane A and Lane B (${who}). A batch ships as one PR and a PR is ` +
          `one lane's work — split it into one batch per lane, with a \`Needs:\` if one must land first.`,
      );
    }
  }
  batchSummary = [...batches.entries()].map(([n, m]) => `${n}×${m.length}`).join(', ');
}

// ---- 2b3: entries that announce their own completion -----------------------
// "Never mark an issue fixed from intent" has a mirror: an entry that says it is finished should
// not still be in the queue, because the protocol removes a completed entry in the PR that
// completes it. Seventeen had accumulated by 2026-08-20 — the queue's own rule was not holding,
// and nothing measured it. Shrink-only: an ID may leave this list, never join it.
//
// The list is now EMPTY, cleared 2026-08-20 by the Orchestrator's first sweep. Only seven of the
// seventeen turned out to be finished and removable. Three more had shipped their code and still
// owed the owner an action, so they kept a `Keep:` line. The remaining SEVEN were not finished at
// all — their headings announced a diagnosis, or a half, or a fix that production later refuted
// (Q-270 read FIXED FORWARD while `training_load_ots` was still 0 of 96 days, five days on). That
// ratio is the argument for this check: a completion claim in a heading is a claim, and ten of the
// seventeen did not survive being checked against a merged diff.
//
// An entry genuinely worth keeping past completion (a shipped fix still owing an owner or device
// check) states so with a `Keep:` line giving the reason, and is removed from this list.
//
// LA-29, 2026-08-25: the word list missed `CLOSED`, and two entries were sitting in the queue
// because of it — Q-304b (closed the same day, and still handed to an implementer as READY #4 by
// `next-item.js`) and Q-27 (closed three weeks earlier). The list now lives in
// `lib/completion-words.js` so its two delicate properties can be tested: it is case-SENSITIVE,
// and `ANSWERED` is deliberately not in it. See that file for why both matter.
// `keep` comes from `lib/keep.js`, not a second regex (OR-100). This file used to carry its own —
// colon-only and bullet-anchored — which missed the em-dash form and anything stated inside a
// blockquote banner: **11 entries** the shared reader sees and this one did not. None of them
// happened to also announce completion in a heading, so the drift was latent rather than a live
// failure; the next one would not have been.
for (const [id, m] of meta) m.keep = keepFromLines(m.lines);

const COMPLETED_HEADING_BASELINE = new Set([]);
{
  const flagged = [];
  for (const [id, heading] of seen) {
    if (!announcesCompletion(heading)) continue;
    if (meta.get(id)?.keep) continue;   // a stated residue is why the heading may say it shipped
    if (COMPLETED_HEADING_BASELINE.has(id)) continue;
    flagged.push(`${id} — ${heading.slice(4, 110)}`);
  }
  if (flagged.length) {
    failures.push(
      `These queue entries announce their own completion in the heading:\n` +
        flagged.map((f) => `      ${f}`).join('\n') +
        `\n      Remove a finished entry — the PR and the journal entry are the record, and this ` +
        `file\n      only tracks what is still open. If something is genuinely still owed (an owner ` +
        `or\n      device check), add \`- **Keep:** <what is still owed>\` and say what closes it.`,
    );
  }
  const stale = [...COMPLETED_HEADING_BASELINE].filter((id) => !seen.has(id) || !announcesCompletion(seen.get(id)));
  if (stale.length) {
    failures.push(
      `COMPLETED_HEADING_BASELINE lists ${stale.join(', ')}, which no longer needs baselining. ` +
        `The list is shrink-only — delete those entries from it in this PR.`,
    );
  }
  completedSummary = `${COMPLETED_HEADING_BASELINE.size} baselined done-headings`;
}

// ---- 2c: Needs targets exist ----------------------------------------------
// An absent target means SHIPPED, because the protocol removes a completed entry from the queue —
// so a dependent must unblock, not wedge. The cost of that rule is that a typo reads exactly like a
// success, which is why a target that has never existed anywhere in the tree is an error here.
let treeBlob = '';
{
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.md')) {
        // Strip the `Needs:` declarations themselves. Otherwise a typo'd target is proved to exist
        // by the very line that names it, and this check silently never fires.
        treeBlob += fs
          .readFileSync(full, 'utf8')
          .split('\n')
          .filter((l) => !/^\s*[-*]\s*\*{0,2}Needs:/i.test(l))
          .join('\n');
      }
    }
  };
  walk(path.join(ROOT, 'docs'));
}
for (const [id, m] of meta) {
  for (const target of m.needs) {
    if (seen.has(target)) continue;
    const mentioned = new RegExp(`\\b${target}\\b`).test(treeBlob);
    if (!mentioned) {
      failures.push(
        `${id} declares \`Needs: ${target}\`, but ${target} does not exist and never has. ` +
          `An absent target reads as "already shipped", so a typo here silently unblocks the entry.`,
      );
    }
  }
}

// ---- 2d: no Needs cycles ---------------------------------------------------
// Two entries waiting on each other are each individually plausible and jointly unstartable.
{
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      const cycle = [...stack.slice(stack.indexOf(id)), id].join(' → ');
      failures.push(`Needs: cycle — these entries wait on each other and none can start: ${cycle}`);
      return;
    }
    state.set(id, 'open');
    stack.push(id);
    for (const t of meta.get(id)?.needs ?? []) if (seen.has(t)) visit(t);
    stack.pop();
    state.set(id, 'done');
  };
  for (const id of seen.keys()) visit(id);
}

// ---- 3: Postgres migration pointer ----------------------------------------
const migFiles = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .map((f) => parseInt(f.match(/^(\d+)/)[1], 10));
const nextMigration = Math.max(...migFiles) + 1;

const migRow = text.match(/\|\s*Next free Postgres migration\s*\|\s*\*\*(\d+)\*\*/);
if (!migRow) {
  failures.push('Live-pointer table is missing its "Next free Postgres migration" row.');
} else if (parseInt(migRow[1], 10) !== nextMigration) {
  failures.push(
    `Migration pointer says ${migRow[1]}, but the directory head is ` +
      `${nextMigration - 1} so the next free number is ${nextMigration}.`,
  );
}

// ---- 4: local SQLite version ----------------------------------------------
const sqliteSrc = fs.readFileSync(SQLITE, 'utf8');
const versions = [...sqliteSrc.matchAll(/toVersion:\s*(\d+)/g)].map((m) => parseInt(m[1], 10));
if (versions.length === 0) {
  failures.push('Could not read any toVersion from lib/sqlite/migrations.ts.');
} else {
  const maxVersion = Math.max(...versions);
  const sqliteRow = text.match(/\|\s*Local SQLite schema version\s*\|\s*\*\*v(\d+)\*\*/);
  if (!sqliteRow) {
    failures.push('Live-pointer table is missing its "Local SQLite schema version" row.');
  } else if (parseInt(sqliteRow[1], 10) !== maxVersion) {
    failures.push(
      `SQLite pointer says v${sqliteRow[1]}, but lib/sqlite/migrations.ts tops out at v${maxVersion}.`,
    );
  }
}

// ---- report ----------------------------------------------------------------
if (failures.length) {
  console.error('Backlog pointer check failed:\n');
  failures.forEach((f) => console.error('  • ' + f + '\n'));
  process.exit(1);
}

const withNeeds = [...meta.values()].filter((m) => m.needs.length).length;
const withGate = [...meta.values()].filter((m) => m.gates.length).length;
// Counted and printed because the count IS the finding: the owner's question was whether his
// decisions are the bottleneck, and separating verification debt from blocked work is what makes
// that answerable at a glance instead of by hand-scanning 41 gates (BF-90).
const verifyCounts = [...meta.values()].reduce((acc, m) => {
  const v = verifyFromLines(m.lines);
  if (v) acc[v.value] = (acc[v.value] ?? 0) + 1;
  return acc;
}, {});
const withVerify = Object.values(verifyCounts).reduce((a, n) => a + n, 0);
const verifySummary = withVerify
  ? `${withVerify} with Verify: (${Object.entries(verifyCounts).map(([k, n]) => `${n} ${k}`).join(', ')})`
  : 'none with Verify:';

// OR-100: a `Keep:` whose residue is a BUILD hides startable work under a heading that reads
// "Not new work". Reported, never failed — the entry is explicit that enforcement stays off until
// the known cases are split, or CI goes red on entries nobody has triaged. The list is the point:
// a count with no ids is a number nobody can act on.
{
  const builds = [];
  let checks = 0;
  let unclear = 0;
  for (const [id, m] of meta) {
    if (!m.keep) continue;
    const kind = m.keep.gate ? 'check' : keepKind(m.keep.text);
    if (kind === 'build') builds.push(`${id} — ${m.keep.text.slice(0, 90)}`);
    else if (kind === 'check') checks++;
    else unclear++;
  }
  if (builds.length) {
    console.log(
      `check-backlog-pointers: note — ${builds.length} \`Keep:\` residues read as BUILDABLE work, ` +
        `not a check (${checks} are checks, ${unclear} unclear). They sit under next-item's KEEP ` +
        `heading, which says "Not new work", so an implementer never sees them. Split each into its ` +
        `own entry with \`Needs:\` pointing at the shipped one (OR-100). Advisory, not a failure:\n` +
        builds.map((b) => `      ${b}`).join('\n'),
    );
  }
}

// BF-90, the half that keeps the split true after today. A `Gate: device` whose own `Keep:` says a
// CHECK is owed has shipped — so it is verification debt wearing a gate, and the gate parks it.
//
// Reported, never failed, and deliberately using `keepKind` rather than a new heuristic: the signal
// is already defined and already tested (OR-100), and a fuzzy new one would be exactly the
// prose-detection this file's fields exist to replace. Seventeen entries were converted on
// 2026-09-01 — eleven BF-90 named from their headings, six more this same rule found — so an empty
// list here is the current state rather than an untested branch.
{
  const stragglers = [];
  for (const [id, m] of meta) {
    if (!m.gates.includes('device') || !m.keep) continue;
    const kind = m.keep.gate ? 'check' : keepKind(m.keep.text);
    if (kind === 'check') stragglers.push(`${id} — ${m.keep.text.slice(0, 90)}`);
  }
  if (stragglers.length) {
    console.log(
      `check-backlog-pointers: note — ${stragglers.length} \`Gate: device\` entr${stragglers.length === 1 ? 'y' : 'ies'} ` +
        `whose own \`Keep:\` says a CHECK is owed. That is shipped work, so the gate PARKS it beside ` +
        `work that genuinely cannot start — the thing BF-90 measured. Convert to \`Verify: device\`, ` +
        `which prints in its own section and does not park. Advisory, not a failure:\n` +
        stragglers.map((r) => `      ${r}`).join('\n'),
    );
  }
}

console.log(
  `check-backlog-pointers: OK — ${seen.size} entries, no duplicates, all tagged; ` +
    `${withNeeds} with Needs: (no cycles, all targets known), ${withGate} with Gate:, ${verifySummary}; ` +
    `batches [${batchSummary || 'none'}]; ${completedSummary}; ` +
    `migration ${nextMigration}, SQLite v${Math.max(...versions)} match source.`,
);

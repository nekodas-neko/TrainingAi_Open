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
 *   1. No Q number is used by two queue entries.
 *   2. Every queue entry heading carries at least one valid [domain] tag.
 *   3. The "Next free Postgres migration" pointer matches the migrations directory.
 *   4. The "Local SQLite schema version" pointer matches lib/sqlite/migrations.ts.
 *   5. The "Next unallocated Q band" pointer sits above every Q number actually in use.
 */

const fs = require('fs');
const path = require('path');

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
for (let i = 0; i < queue.length; i++) {
  const line = queue[i];
  if (!line.startsWith('### ')) continue;

  const tags = [...line.matchAll(/\[([a-z-]+)\]/g)].map((m) => m[1]);
  const valid = tags.filter((t) => PILLARS.has(t));
  if (valid.length === 0) {
    failures.push(
      `Untagged queue entry — a heading with no valid [domain] tag is invisible to every ` +
        `per-pillar sweep:\n    ${line.slice(0, 120)}`,
    );
  }

  const q = line.match(/\bQ-(\d+)([a-z]?)\b/);
  if (!q) continue;
  const id = `Q-${q[1]}${q[2]}`;
  if (seen.has(id)) {
    failures.push(
      `Duplicate ${id} — two queue entries hold the same number:\n` +
        `    ${seen.get(id).slice(0, 110)}\n    ${line.slice(0, 110)}`,
    );
  } else {
    seen.set(id, line);
  }
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

// ---- 5: Q band pointer -----------------------------------------------------
const bandRow = text.match(/\|\s*Next unallocated Q band\s*\|\s*\*\*(\d+)\*\*/);
if (!bandRow) {
  failures.push('Live-pointer table is missing its "Next unallocated Q band" row.');
} else if (seen.size > 0) {
  const band = parseInt(bandRow[1], 10);
  const highest = Math.max(...[...seen.keys()].map((k) => parseInt(k.match(/\d+/)[0], 10)));
  if (highest >= band) {
    failures.push(
      `Q-${highest} is in use but the next unallocated band starts at ${band} — a band was used ` +
        `without being recorded. Claim it in the band table in docs/agents/README.md and bump this row.`,
    );
  }
}

// ---- report ----------------------------------------------------------------
if (failures.length) {
  console.error('Backlog pointer check failed:\n');
  failures.forEach((f) => console.error('  • ' + f + '\n'));
  process.exit(1);
}

console.log(
  `check-backlog-pointers: OK — ${seen.size} numbered entries, no duplicates, all tagged; ` +
    `migration ${nextMigration}, SQLite v${Math.max(...versions)} match source.`,
);

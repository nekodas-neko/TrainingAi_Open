import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
const path = option('--database'),
  user = option('--user');
if (!path || !existsSync(path) || !user) {
  console.error(
    'Use --database a local SQLite snapshot and --user its account UUID. No record values are printed.',
  );
  process.exitCode = 1;
} else {
  let db;
  try {
    db = new DatabaseSync(resolve(path), { readOnly: true });
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    const inventory = tables.map(({ name }) => {
      if (typeof name !== 'string' || !/^[a-zA-Z0-9_]+$/.test(name))
        throw new Error('Unexpected table name.');
      const columns = db
        .prepare(`PRAGMA table_info("${name}")`)
        .all()
        .map((row) => row.name);
      const scoped = columns.includes('user_id');
      const rows = scoped
        ? db.prepare(`SELECT COUNT(*) AS n FROM "${name}" WHERE user_id=?`).get(user).n
        : db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
      return {
        table: name,
        rows: Number(rows),
        ownership: scoped ? 'account-scoped' : 'requires verified cache-owner marker',
      };
    });
    const outbox = tables.some((row) => row.name === 'mutations_outbox')
      ? db
          .prepare(
            'SELECT domain,COUNT(*) AS count FROM mutations_outbox WHERE user_id=? GROUP BY domain ORDER BY domain',
          )
          .all(user)
      : [];
    console.info(
      JSON.stringify(
        {
          integrity: db.prepare('PRAGMA quick_check').get(),
          walSnapshotPresent: existsSync(`${resolve(path)}-wal`),
          inventory,
          outbox,
          readOnly: true,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}

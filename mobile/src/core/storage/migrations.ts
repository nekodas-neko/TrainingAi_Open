export type SqlValue = string | number | null;
export interface StorageDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SqlValue[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
}

const migrations = [
  `CREATE TABLE local_values (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (scope, key)
  ) WITHOUT ROWID;`,
];

export class StorageUpgradeRequired extends Error {
  constructor() {
    super('Update the app to open this device’s saved data.');
  }
}

export async function migrateDatabase(database: StorageDatabase) {
  await database.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await database.execAsync('BEGIN IMMEDIATE');
  try {
    const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const version = row?.user_version;
    if (version === undefined || !Number.isInteger(version) || version < 0) {
      throw new Error('Invalid local database version.');
    }
    if (version > migrations.length) {
      throw new StorageUpgradeRequired();
    }
    for (let index = version; index < migrations.length; index++) {
      await database.execAsync(migrations[index]);
      await database.execAsync(`PRAGMA user_version = ${index + 1}`);
    }
    await database.execAsync('COMMIT');
  } catch (error) {
    await database.execAsync('ROLLBACK');
    throw error;
  }
}

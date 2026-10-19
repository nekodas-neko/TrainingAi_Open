import { migrateDatabase, type StorageDatabase } from './migrations.ts';

export type ScopedStorage = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  // Writes (or, for null, removes) every entry in one transaction: all of them land or none do.
  setMany?(entries: [key: string, value: string | null][]): Promise<void>;
};

function accountScope(origin: string, accountId: string) {
  const url = new URL(origin);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !accountId.trim()
  ) {
    throw new Error('Account storage needs an HTTPS backend origin and an account ID.');
  }
  return JSON.stringify(['account', url.origin, accountId]);
}

export class LocalStorage {
  private database: StorageDatabase;
  private operations: Promise<unknown> = Promise.resolve();

  constructor(database: StorageDatabase) {
    this.database = database;
  }

  device(): ScopedStorage {
    return this.scope(JSON.stringify(['device']));
  }

  account(backendOrigin: string, accountId: string): ScopedStorage {
    return this.scope(accountScope(backendOrigin, accountId));
  }
  clearAccount(origin: string, accountId: string) {
    const scope = accountScope(origin, accountId);
    return this.run(() =>
      this.database.runAsync('DELETE FROM local_values WHERE scope = ?', scope),
    );
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation);
    this.operations = result.catch(() => undefined);
    return result;
  }

  private scope(scope: string): ScopedStorage {
    return {
      get: (key) =>
        this.run(async () => {
          const row = await this.database.getFirstAsync<{ value: string }>(
            'SELECT value FROM local_values WHERE scope = ? AND key = ?',
            scope,
            key,
          );
          return row?.value ?? null;
        }),
      set: (key, value) =>
        this.run(async () => {
          await this.database.runAsync(
            `INSERT INTO local_values (scope, key, value) VALUES (?, ?, ?)
           ON CONFLICT (scope, key) DO UPDATE SET value = excluded.value`,
            scope,
            key,
            value,
          );
        }),
      remove: (key) =>
        this.run(async () => {
          await this.database.runAsync(
            'DELETE FROM local_values WHERE scope = ? AND key = ?',
            scope,
            key,
          );
        }),
      setMany: (entries) =>
        this.run(async () => {
          await this.database.execAsync('BEGIN IMMEDIATE');
          try {
            for (const [key, value] of entries) {
              await (value === null
                ? this.database.runAsync(
                    'DELETE FROM local_values WHERE scope = ? AND key = ?',
                    scope,
                    key,
                  )
                : this.database.runAsync(
                    `INSERT INTO local_values (scope, key, value) VALUES (?, ?, ?)
           ON CONFLICT (scope, key) DO UPDATE SET value = excluded.value`,
                    scope,
                    key,
                    value,
                  ));
            }
            await this.database.execAsync('COMMIT');
          } catch (error) {
            await this.database.execAsync('ROLLBACK');
            throw error;
          }
        }),
    };
  }
}

export async function createLocalStorage(database: StorageDatabase) {
  await migrateDatabase(database);
  return new LocalStorage(database);
}

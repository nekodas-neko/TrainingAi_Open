import { DatabaseSync } from 'node:sqlite';
import type { StorageDatabase, SqlValue } from '../src/core/storage/migrations.ts';

export function sqliteFixture(path = ':memory:') {
  const connection = new DatabaseSync(path);
  const database: StorageDatabase = {
    async execAsync(sql: string) {
      connection.exec(sql);
    },
    async runAsync(sql: string, ...params: SqlValue[]) {
      return connection.prepare(sql).run(...params);
    },
    async getFirstAsync<T>(sql: string, ...params: SqlValue[]) {
      return (connection.prepare(sql).get(...params) as T | undefined) ?? null;
    },
  };
  return { database, connection };
}

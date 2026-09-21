// `node:sqlite` ships in Node 22 (experimental) and this repo pins @types/node 20, which predates
// its declarations — so the import resolves at runtime and fails to typecheck without this.
//
// Only the members actually used are declared, deliberately: a fuller hand-written copy would drift
// from the real API silently, and the moment @types/node moves past 22 this file should be deleted
// rather than maintained. Added for BF-185's local-store test, which executes the shipped SQLite
// upsert statement instead of grepping for it.
declare module 'node:sqlite' {
  export class StatementSync {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number }
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }

  export class DatabaseSync {
    constructor(location: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}

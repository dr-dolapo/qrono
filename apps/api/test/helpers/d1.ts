/**
 * A minimal D1Database stand-in backed by Node's built-in SQLite, with all
 * migrations applied. D1 is SQLite, so route tests run real SQL against the
 * real schema without a Cloudflare account. Supports prepare/bind/first/all/run/batch.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const migrationsDir = join(import.meta.dirname, "..", "..", "migrations");

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}

  bind(...params: unknown[]): Statement {
    for (const p of params) {
      if (p === undefined) throw new Error(`D1_TYPE_ERROR: undefined bound in: ${this.sql}`);
    }
    return new Statement(this.db, this.sql, params as SQLInputValue[]);
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : { ...row }) as T;
  }

  async all<T>(): Promise<{ results: T[]; success: true; meta: object }> {
    const rows = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results: rows.map((r) => ({ ...(r as object) }) as T), success: true, meta: {} };
  }

  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }

  /** Used by batch(): run synchronously inside the transaction. */
  runSync(): void {
    const stmt = this.db.prepare(this.sql);
    if (stmt.columns().length > 0) stmt.all(...this.params);
    else stmt.run(...this.params);
  }
}

export function createTestDb(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }

  const db = {
    prepare: (sql: string) => new Statement(sqlite, sql),
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try {
        for (const s of statements) s.runSync();
        sqlite.exec("COMMIT");
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
      return statements.map(() => ({ success: true, results: [], meta: {} }));
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
  return { db: db as unknown as D1Database, sqlite };
}

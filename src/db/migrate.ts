/** Applies the SQL files in supabase/migrations that a database has not seen yet. Used by tests, the local rehearsal and the Supabase setup. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface SqlDb { query(sql: string, params?: any[]): Promise<{ rows: any[] }>; exec?(sql: string): Promise<any>; }
export const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');

export async function applyMigrations(db: SqlDb, log: (m: string) => void = () => {}): Promise<string[]> {
  const run = (sql: string) => (db.exec ? db.exec(sql) : db.query(sql));     // both drivers run a multi-statement file when no parameters are passed
  await run(`create table if not exists app_migrations (name text primary key, applied_at timestamptz not null default now())`);
  await run(`alter table app_migrations enable row level security`);      // not readable through the API
  const done = new Set((await db.query(`select name from app_migrations`)).rows.map(r => r.name));
  const applied: string[] = [];
  for (const f of readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    await run('begin');
    try {
      await run(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
      await db.query(`insert into app_migrations (name) values ($1)`, [f]);
      await run('commit');
    } catch (e) { await run('rollback'); throw new Error(`Migration ${f} failed: ${(e as Error).message}`); }
    applied.push(f); log(`applied ${f}`);
  }
  return applied;
}

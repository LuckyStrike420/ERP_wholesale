import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from '../src/db/migrate.ts';

/** Fresh in-memory Postgres with all migrations applied. */
export async function freshDb(today = '2026-11-10'): Promise<PGlite> {
  const db = new PGlite();
  await applyMigrations(db);
  await db.exec(`set app.today = '${today}'`);
  // the starting validation rules (0030) are switched off here, so each test only meets the rules it switches on
  await db.exec(`update validation_rules set active = false`);
  return db;
}

export async function one<T = any>(db: PGlite, sql: string, params: any[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}
export async function all<T = any>(db: PGlite, sql: string, params: any[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

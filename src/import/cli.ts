/**
 * Usage:
 *   npm run import -- --file data/workbook.xlsx            dry run (nothing is saved)
 *   npm run import -- --file data/workbook.xlsx --commit   save to the database
 * With DATABASE_URL set (Supabase connection string) the import runs against that database.
 * Without it, the import is rehearsed in a temporary local database with the same schema.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { importWorkbook, reportMarkdown, type Db } from './importer.ts';

const args = process.argv.slice(2);
const file = args[args.indexOf('--file') + 1];
const commit = args.includes('--commit');
if (!file || args.indexOf('--file') < 0) { console.error('Missing --file <workbook.xlsx>'); process.exit(1); }

let db: Db; let close = async () => {}; let target: string;
if (process.env.DATABASE_URL) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  db = client; close = () => client.end(); target = 'database from DATABASE_URL';
} else {
  const { freshDb } = await import('../../tests/db.ts');
  db = await freshDb(new Date().toISOString().slice(0, 10)); target = 'temporary local database (rehearsal)';
}

await db.query('begin');
try {
  const res = await importWorkbook(db, new Uint8Array(readFileSync(file)), basename(file));
  const failed = res.reconciliation.filter(r => !r.ok).length;
  const errors = res.issues.filter(i => i.severity === 'error').length;
  const mode = `${commit && !failed ? 'COMMIT' : 'DRY RUN (nothing saved)'} on ${target}`;
  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/import-report.md', reportMarkdown(basename(file), res, mode));
  console.log(mode);
  console.log('created:', res.created);
  console.log('already present:', res.skipped);
  console.log(`issues: ${errors} errors, ${res.issues.filter(i => i.severity === 'warning').length} warnings, ${res.issues.filter(i => i.severity === 'info').length} info`);
  console.log(`reconciliation: ${res.reconciliation.length} figures compared, ${failed} differ`);
  console.log('report: reports/import-report.md');
  if (commit && failed) console.error('Not committed: reconciliation differences must be resolved first.');
  await db.query(commit && !failed ? 'commit' : 'rollback');
} catch (e) {
  await db.query('rollback');
  throw e;
} finally { await close(); }

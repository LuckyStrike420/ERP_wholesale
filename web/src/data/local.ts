import { PGlite, types } from "@electric-sql/pglite";
import type { DataClient, Row, SelectOpts } from "./client";
import { importWorkbook } from "../../../src/import/importer";

// every file in supabase/migrations, in order: the same SQL that runs on Supabase
const files = import.meta.glob("../../../supabase/migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const MIGRATIONS = Object.keys(files).sort().map(p => ({ name: p.split("/").pop()!, sql: files[p] }));

const DB_NAME = "idb://yp-orders-test-v1";
const id = (s: string) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Bad identifier ${s}`); return `"${s}"`; };
// same shapes as Supabase returns: numbers for numeric, ISO strings for dates
const parsers = { [types.NUMERIC]: (v: string) => Number(v), [types.INT8]: (v: string) => Number(v),
  [types.DATE]: (v: string) => v, [types.TIMESTAMPTZ]: (v: string) => v, [types.TIMESTAMP]: (v: string) => v };

async function open(): Promise<PGlite> {
  try { const db = new PGlite(DB_NAME, { parsers, relaxedDurability: true }); await db.waitReady; return db; }   // write to browser storage in the background, not after every query
  catch { const db = new PGlite({ parsers }); await db.waitReady; return db; }   // storage blocked: keep it in memory
}

/** runs the migrations this database has not seen yet; existing data stays */
async function migrate(db: PGlite) {
  await db.exec("create table if not exists app_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query<{ name: string }>("select name from app_migrations")).rows.map(r => r.name));
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    await db.transaction(async tx => { await tx.exec(m.sql); await tx.query("insert into app_migrations (name) values ($1)", [m.name]); });
  }
}

async function build(db: PGlite, empty = false) {
  await db.exec("drop schema if exists public cascade; create schema public;");
  await migrate(db);
  if (empty) return;
  const seed = await (await fetch("./seed.json")).json();
  // imported rows are loaded as they are: no triggers, so nothing is recalculated or re-audited
  await db.exec("set session_replication_role = replica");
  for (const t of seed.tables as string[]) {
    if (seed.rows[t]?.length) await db.query(`insert into ${id(t)} select * from jsonb_populate_recordset(null::${id(t)}, $1::jsonb)`, [JSON.stringify(seed.rows[t])]);
  }
  await db.exec("set session_replication_role = origin");
}

export async function createLocalClient(): Promise<DataClient> {
  const db = await open();
  const ready = await db.query<{ t: string | null }>("select to_regclass('public.v_attention')::text as t");
  if (!ready.rows[0].t) await build(db);
  else {
    // a database built before migrations were tracked already holds the first three
    const tracked = await db.query<{ t: string | null }>("select to_regclass('public.app_migrations')::text as t");
    if (!tracked.rows[0].t) {
      await db.exec("create table app_migrations (name text primary key, applied_at timestamptz not null default now())");
      for (const m of MIGRATIONS.slice(0, 3)) await db.query("insert into app_migrations (name) values ($1)", [m.name]);
    }
    await migrate(db);
  }

  const where = (match: Row | undefined, params: any[]) => {
    const keys = Object.keys(match ?? {});
    if (!keys.length) return "";
    return " where " + keys.map(k => {
      if (match![k] === null) return `${id(k)} is null`;
      params.push(match![k]); return `${id(k)} = $${params.length}`;
    }).join(" and ");
  };
  return {
    mode: "local",
    async select<T>(from: string, o: SelectOpts = {}) {
      const p: any[] = [];
      let sql = `select * from ${id(from)}${where(o.eq, p)}`;
      if (o.order?.length) sql += " order by " + o.order.map(([c, d]) => `${id(c)} ${d === "desc" ? "desc nulls last" : "asc nulls last"}`).join(", ");
      if (o.limit) sql += ` limit ${Number(o.limit)}`;
      return (await db.query<T>(sql, p)).rows;
    },
    async insert<T>(table: string, row: Row) {
      const keys = Object.keys(row).filter(k => row[k] !== undefined);
      const sql = `insert into ${id(table)} (${keys.map(id).join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning *`;
      return (await db.query<T>(sql, keys.map(k => row[k]))).rows[0];
    },
    async update(table, match, patch) {
      const keys = Object.keys(patch).filter(k => patch[k] !== undefined); if (!keys.length) return;
      const p = keys.map(k => patch[k]);
      await db.query(`update ${id(table)} set ${keys.map((k, i) => `${id(k)} = $${i + 1}`).join(", ")}${where(match, p)}`, p);
    },
    async remove(table, match) { const p: any[] = []; await db.query(`delete from ${id(table)}${where(match, p)}`, p); },
    async rpc(fn, args = {}) {
      const keys = Object.keys(args);
      const r = await db.query<Row>(`select * from ${id(fn)}(${keys.map((k, i) => `${id(k)} => $${i + 1}`).join(", ")})`, keys.map(k => args[k]));
      if (r.fields.length === 1 && r.fields[0].name === fn) return (r.rows[0]?.[fn] ?? null) as any;
      return r.rows as any;
    },
    async session() { return { email: "local test database", name: "Local admin", role: "admin" }; },
    async reset(empty) { await build(db, empty); },
    async importWorkbook(data, fileName, commit) {
      let saved = false; let result: any;
      await db.transaction(async tx => {
        result = await importWorkbook(tx, data, fileName);
        saved = commit && !result.reconciliation.some((r: any) => !r.ok);
        if (!saved) await tx.rollback();
      });
      return { result, saved };
    },
  };
}

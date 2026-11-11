/**
 * The only door between the screens and the database.
 * Two interchangeable adapters: a local test database (Postgres in the browser, same migrations)
 * and Supabase. Screens never calculate money: they read views and call database functions.
 */
export type Row = Record<string, any>;
export interface SelectOpts { eq?: Row; order?: [string, "asc" | "desc"][]; limit?: number }

export interface DataClient {
  mode: "local" | "supabase";
  select<T = Row>(from: string, opts?: SelectOpts): Promise<T[]>;
  insert<T = Row>(table: string, row: Row): Promise<T>;
  update(table: string, match: Row, patch: Row): Promise<void>;
  remove(table: string, match: Row): Promise<void>;
  /** scalar functions return the value, table functions return rows */
  rpc<T = any>(fn: string, args?: Row): Promise<T>;
  /** who is using the app. Local test database: always the admin. Supabase: the signed-in user, null when signed out. */
  session(): Promise<Session | null>;
  signIn?(email: string, password: string): Promise<void>;
  signOut?(): Promise<void>;
  /** local only: throw the test data away and load the imported workbook again (or start empty) */
  reset?(empty?: boolean): Promise<void>;
  /** local only: run the workbook import in the browser. Nothing is saved unless commit is true and every figure matches Excel. */
  importWorkbook?(data: Uint8Array, fileName: string, commit: boolean): Promise<{ result: ImportResult; saved: boolean }>;
}
export interface Session { email: string; name: string | null; role: "admin" | "finance" | "operations" | null }
export type { ImportResult } from "../../../src/import/importer";
import type { ImportResult } from "../../../src/import/importer";

export async function createClient(): Promise<DataClient> {
  const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && key) return (await import("./supabase")).createSupabaseClient(url, key);
  return (await import("./local")).createLocalClient();
}

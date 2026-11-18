import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "./notify";
import type { DataClient, Row, SelectOpts, Session } from "@/data/client";

interface Ctx { db: DataClient; session: Session | null; version: number; refresh: () => void; run: <T>(fn: () => Promise<T>, done?: string) => Promise<T | undefined>;
  /** for forms: undefined when saved, false when the database refused (keeps the form open) */
  save: (fn: () => Promise<any>, done?: string) => Promise<void | false>; }
const C = createContext<Ctx>(null as any);
export const useApp = () => useContext(C);

/** readable message from a database rule that refused something */
export const errorText = (e: any) => String(e?.message ?? e).replace(/^error:\s*/i, "")
  .replace(/duplicate key value violates unique constraint "payments_no_duplicates"/, "This payment is already booked (same party, date, amount and reference)")
  .replace(/duplicate key value violates unique constraint "(\w+)"/, "Already exists: this value must be unique ($1)")
  .replace(/new row for relation "(\w+)" violates check constraint "(\w+)"/, "Not allowed for $1 ($2)")
  .replace(/new row violates row-level security policy for table "(\w+)"/, "Your role may not change $1");

export function AppProvider({ db, session = null, children }: { db: DataClient; session?: Session | null; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(v => v + 1), []);
  const run = useCallback(async <T,>(fn: () => Promise<T>, done?: string) => {
    try { const r = await fn(); if (done) toast.success(done); return r; }
    catch (e) { toast.error(errorText(e), { duration: 9000 }); return undefined; }
    finally { refresh(); }
  }, [refresh]);
  const save = useCallback(async (fn: () => Promise<any>, done?: string): Promise<void | false> => {
    try { await fn(); if (done) toast.success(done); return undefined; }
    catch (e) { toast.error(errorText(e), { duration: 9000 }); return false; }
    finally { refresh(); }
  }, [refresh]);
  return <C.Provider value={{ db, session, version, refresh, run, save }}>{children}</C.Provider>;
}

// number of queries in flight, so a table can say "Loading…" instead of claiming it is empty (OMS-029)
let pending = 0; const listeners = new Set<() => void>();
const setPending = (d: number) => { pending += d; listeners.forEach(l => l()); };
export const useLoading = () => useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => pending > 0);

/**
 * Shared cache: every table/view query is fetched once per data version, however many components ask for it,
 * and the last known rows are shown at once (also when you come back to a page) while fresh rows load.
 */
const cache = new Map<string, { version: number; rows: any[]; promise?: Promise<any[]> }>();
// at most a few queries at the same time: the small database server answers 4 quickly rather than 15 slowly (and timing out)
const MAX_PARALLEL = 4; let running = 0; const waiting: (() => void)[] = [];
async function limited<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>(r => waiting.push(r));
  running++;
  try { return await job(); } finally { running--; waiting.shift()?.(); }
}
function fetchShared<T>(db: DataClient, key: string, from: string, opts: SelectOpts, version: number): Promise<T[]> {
  const hit = cache.get(key);
  if (hit && hit.version === version) return hit.promise ?? Promise.resolve(hit.rows);
  const entry = { version, rows: hit?.rows ?? [], promise: undefined as Promise<any[]> | undefined };
  setPending(1);
  entry.promise = limited(() => db.select<T>(from, opts))
    .then(rows => { entry.rows = rows; entry.promise = undefined; return rows; })
    .catch(e => { cache.delete(key); throw e; })
    .finally(() => setPending(-1));
  cache.set(key, entry);
  return entry.promise as Promise<T[]>;
}

/** rows of a table or view; reloads after every change made through run() or a form */
export function useRows<T = any>(from: string | null, opts: SelectOpts = {}): { rows: T[]; loading: boolean } {
  const { db, version } = useApp();
  const key = JSON.stringify([from, opts]);
  const [state, setState] = useState<{ key: string; rows: T[]; loading: boolean }>(() => {
    const hit = from ? cache.get(key) : undefined;
    return { key, rows: (hit?.rows ?? []) as T[], loading: !!from && !hit };
  });
  useEffect(() => {
    if (!from) { setState({ key, rows: [], loading: false }); return; }
    let live = true;
    const hit = cache.get(key);
    if (hit && state.key !== key) setState({ key, rows: hit.rows as T[], loading: false });   // show what we already know
    fetchShared<T>(db, key, from, opts, version)
      .then(rows => { if (live) setState({ key, rows, loading: false }); })
      .catch(e => { if (live) { toast.error(errorText(e)); setState({ key, rows: [], loading: false }); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, key, version]);
  // a changed query (other order, other filter) never shows the rows of the previous one
  return state.key === key ? state : { rows: ((from && cache.get(key)?.rows) ?? []) as T[], loading: !!from && !cache.get(key) };
}
export function useRow<T = any>(from: string, eq: Row): T | undefined { return useRows<T>(from, { eq }).rows[0]; }

export { useNav } from "./router";

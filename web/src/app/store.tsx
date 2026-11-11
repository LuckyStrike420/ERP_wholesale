import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "sonner";
import type { DataClient, Row, SelectOpts } from "@/data/client";

interface Ctx { db: DataClient; version: number; refresh: () => void; run: <T>(fn: () => Promise<T>, done?: string) => Promise<T | undefined>;
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

export function AppProvider({ db, children }: { db: DataClient; children: ReactNode }) {
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
  return <C.Provider value={{ db, version, refresh, run, save }}>{children}</C.Provider>;
}

// number of queries in flight, so a table can say "Loading…" instead of claiming it is empty (OMS-029)
let pending = 0; const listeners = new Set<() => void>();
const setPending = (d: number) => { pending += d; listeners.forEach(l => l()); };
export const useLoading = () => useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => pending > 0);

/** rows of a table or view; reloads after every change made through run() */
export function useRows<T = any>(from: string | null, opts: SelectOpts = {}): { rows: T[]; loading: boolean } {
  const { db, version } = useApp();
  const [state, setState] = useState<{ rows: T[]; loading: boolean }>({ rows: [], loading: true });
  const key = JSON.stringify([from, opts]);
  const seq = useRef(0);
  useEffect(() => {
    if (!from) { setState({ rows: [], loading: false }); return; }
    const n = ++seq.current;
    setPending(1);
    db.select<T>(from, opts).then(rows => { if (n === seq.current) setState({ rows, loading: false }); })
      .catch(e => { toast.error(errorText(e)); if (n === seq.current) setState({ rows: [], loading: false }); })
      .finally(() => setPending(-1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, key, version]);
  return state;
}
export function useRow<T = any>(from: string, eq: Row): T | undefined { return useRows<T>(from, { eq }).rows[0]; }

// ---- routing on a plain #name (the only form that survives inside an embedded page) ----
export function useRoute(): [string, (r: string) => void] {
  const read = () => window.location.hash.replace(/^#/, "") || "dashboard";
  const [route, setRoute] = useState(read);
  useEffect(() => { const h = () => setRoute(read()); window.addEventListener("hashchange", h); return () => window.removeEventListener("hashchange", h); }, []);
  return [route, (r: string) => { window.location.hash = r; setRoute(r); window.scrollTo(0, 0); }];
}
export const NavCtx = createContext<(r: string) => void>(() => {});
export const useNav = () => useContext(NavCtx);

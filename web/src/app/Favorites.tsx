/**
 * Favourites (pinned records, saved per user in the database) and recently viewed records (kept in this browser).
 * Record pages call useRecord(...) and show <FavoriteStar />; the side menu and Cmd+K list both.
 */
import { useEffect, useSyncExternalStore } from "react";
import { Star } from "lucide-react";
import { useApp, useRows } from "./store";
import { Link, usePath } from "./router";
import { cn } from "@/lib/utils";

export type RecordType = "order" | "po" | "customer" | "supplier" | "product";
export interface RecordRef { type: RecordType; id: string; label: string; path: string; sub?: string }
export const TYPE_LABEL: Record<RecordType, string> = { order: "Order", po: "Purchase order", customer: "Customer", supplier: "Supplier", product: "Product" };

// ---------------- recently viewed ----------------
const KEY = "yp.recent.v1"; const MAX = 12;
const listeners = new Set<() => void>();
let cache: (RecordRef & { at: number })[] | null = null;
const read = () => { if (cache) return cache; try { cache = JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { cache = []; } return cache!; };
const write = (rows: (RecordRef & { at: number })[]) => { cache = rows; try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch { /* private mode */ } listeners.forEach(l => l()); };
export const useRecent = () => useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, read);

/** call on a record page: remembers it as recently viewed */
export function useRecord(r: RecordRef | null) {
  useEffect(() => {
    if (!r) return;
    write([{ ...r, at: Date.now() }, ...read().filter(x => !(x.type === r.type && x.id === r.id))].slice(0, MAX));
  }, [r?.type, r?.id, r?.label, r?.path]);   // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------------- favourites ----------------
export function useFavorites() { return useRows("favorites", { order: [["created_at", "asc"]] }).rows as (RecordRef & { entity_type: RecordType; entity_id: string })[]; }

export function FavoriteStar({ r }: { r: RecordRef }) {
  const { db, run } = useApp();
  const favs = useFavorites();
  const fav = favs.find(f => f.entity_type === r.type && f.entity_id === r.id);
  const toggle = () => fav
    ? run(() => db.remove("favorites", { id: (fav as any).id }), `${r.label} removed from favourites`)
    : run(() => db.insert("favorites", { entity_type: r.type, entity_id: r.id, label: r.label, path: r.path }), `${r.label} added to favourites`);
  return <button type="button" onClick={toggle} aria-pressed={!!fav} aria-label={fav ? "Remove from favourites" : "Add to favourites"} title={fav ? "Remove from favourites" : "Add to favourites"}
    className="rounded-md p-1 text-gray-300 transition-colors hover:bg-gray-100 hover:text-amber-500 print:hidden">
    <Star className={cn("h-5 w-5", fav && "fill-amber-400 text-amber-400")} /></button>;
}

// ---------------- side menu ----------------
const TYPE_ICON: Record<RecordType, string> = { order: "PI", po: "PO", customer: "C", supplier: "S", product: "P" };
function RecordLink({ r, active }: { r: RecordRef; active: boolean }) {
  return <Link to={r.path} title={r.sub ? `${r.label} · ${r.sub}` : r.label}
    className={cn("flex items-center gap-2 rounded-md px-2 py-1 text-[13px] transition-colors", active ? "bg-gray-100 font-medium text-gray-900" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900")}>
    <span className="flex h-4 w-5 shrink-0 items-center justify-center rounded bg-gray-100 text-[9px] font-semibold text-gray-500">{TYPE_ICON[r.type]}</span>
    <span className="min-w-0 flex-1 truncate">{r.label}{r.sub && <span className="text-gray-400"> · {r.sub}</span>}</span></Link>;
}
/** favourites and the last few records you opened, under the main menu */
export function SidebarRecords() {
  const path = usePath();
  const favs = useFavorites().map(f => ({ type: f.entity_type, id: f.entity_id, label: f.label, path: f.path }));
  const recent = useRecent().filter(r => !favs.some(f => f.type === r.type && f.id === r.id)).slice(0, 5);
  const head = "px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400";
  return <>
    {favs.length > 0 && <div className="mb-5"><div className={cn(head, "flex items-center gap-1")}><Star className="h-3 w-3" />Favourites</div>{favs.map(r => <RecordLink key={r.type + r.id} r={r} active={path === r.path} />)}</div>}
    {recent.length > 0 && <div className="mb-5"><div className={head}>Recent</div>{recent.map(r => <RecordLink key={r.type + r.id} r={r} active={path === r.path} />)}</div>}
  </>;
}

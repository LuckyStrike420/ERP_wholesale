/**
 * Pages built from blocks you can move, hide and make full or half width (Salesforce calls this App Builder).
 * The layout is saved per user in the database (user_layouts), so it is the same on every device;
 * a copy in this browser makes the page appear at once. Without a signed-in user (local test database) only the browser copy is used.
 *
 *   const lay = useLayout("order", BLOCK_IDS);
 *   <CustomizeButton lay={lay} />            in the page header
 *   <BlockGrid lay={lay} blocks={[{ id, title, size, node }, …]} />
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "./store";
import { cn } from "@/lib/utils";

export type Size = "full" | "half";
export interface Block { id: string; title: string; size?: Size; node: ReactNode | null | false }
export interface Layout { order: string[]; hidden: string[]; size: Record<string, Size> }
const empty: Layout = { order: [], hidden: [], size: {} };
const KEY = (page: string) => `yp.layout.${page}`;
const read = (page: string, legacyKey?: string): Layout => {
  for (const k of [KEY(page), legacyKey]) { if (!k) continue; try { const x = JSON.parse(localStorage.getItem(k) ?? ""); if (Array.isArray(x.order)) return { ...empty, ...x, size: x.size ?? {} }; } catch { /* none yet */ } }
  return empty;
};

export function useLayout(page: string, legacyKey?: string) {
  const { db, session } = useApp();
  const [layout, setLayout] = useState<Layout>(() => read(page, legacyKey));
  const [editing, setEditing] = useState(false);
  const rowId = useRef<string | null>(null);
  // the saved layout of this user (when signed in)
  useEffect(() => {
    if (!session?.id) return;
    db.select<any>("user_layouts", { eq: { page } }).then(rows => {
      const r = rows[0]; if (!r) return;
      rowId.current = r.id; const l = { ...empty, ...(r.layout ?? {}) };
      setLayout(l); try { localStorage.setItem(KEY(page), JSON.stringify(l)); } catch { /* private mode */ }
    }).catch(() => undefined);
  }, [db, session?.id, page]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const save = (l: Layout) => {
    setLayout(l); try { localStorage.setItem(KEY(page), JSON.stringify(l)); } catch { /* private mode */ }
    if (!session?.id) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        if (rowId.current) await db.update("user_layouts", { id: rowId.current }, { layout: l });
        else rowId.current = (await db.insert<any>("user_layouts", { page, layout: l })).id;
      } catch { /* the browser copy still has it */ }
    }, 400);
  };
  return { page, layout, save, editing, setEditing };
}
export type LayoutState = ReturnType<typeof useLayout>;

export function CustomizeButton({ lay, label = "Customize layout" }: { lay: LayoutState; label?: string }) {
  return <Button variant="outline" onClick={() => lay.setEditing(e => !e)} aria-pressed={lay.editing} title="Move, hide or resize the blocks on this page">
    <SlidersHorizontal className="h-4 w-4" /><span className="hidden xl:inline">{label}</span></Button>;
}

/** the blocks in the user's order; a block whose node is empty (does not apply now) is skipped */
export function BlockGrid({ lay, blocks }: { lay: LayoutState; blocks: Block[] }) {
  const { layout, save } = lay;
  const ids = blocks.map(b => b.id);
  const order = [...layout.order.filter(id => ids.includes(id)), ...ids.filter(id => !layout.order.includes(id))];
  const byId = Object.fromEntries(blocks.map(b => [b.id, b]));
  const sizeOf = (b: Block) => layout.size[b.id] ?? b.size ?? "full";
  const move = (id: string, d: -1 | 1) => { const o = [...order]; const i = o.indexOf(id), j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; save({ ...layout, order: o }); };
  const toggle = (id: string) => save({ ...layout, order, hidden: layout.hidden.includes(id) ? layout.hidden.filter(x => x !== id) : [...layout.hidden, id] });
  const resize = (b: Block) => save({ ...layout, order, size: { ...layout.size, [b.id]: sizeOf(b) === "full" ? "half" : "full" } });
  return <>
    {lay.editing && <section className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4" aria-label="Page layout">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-sm font-semibold text-gray-900">Blocks on this page</h2><p className="text-xs text-gray-500">Saved for you on every device. Half-width blocks sit side by side.</p></div>
        <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => save(empty)}>Reset</Button><Button size="sm" onClick={() => lay.setEditing(false)}>Done</Button></div></div>
      <ul className="grid gap-2 sm:grid-cols-2">{order.map((id, i) => { const b = byId[id]; const on = !layout.hidden.includes(id);
        return <li key={id} className={cn("flex items-center gap-3 rounded-lg border bg-white px-3 py-2", on ? "border-gray-200" : "border-dashed border-gray-300 opacity-60")}>
          <input type="checkbox" checked={on} onChange={() => toggle(id)} className="h-4 w-4 accent-indigo-600" aria-label={`Show ${b.title}`} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{b.title}{!b.node && <span className="ml-1 text-xs font-normal text-gray-400">(empty now)</span>}</span>
          <button type="button" onClick={() => resize(b)} className="rounded-md border border-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 hover:border-indigo-300 hover:text-indigo-700" aria-label={`Width of ${b.title}`}>{sizeOf(b) === "full" ? "Full" : "Half"}</button>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => move(id, -1)} aria-label={`Move ${b.title} up`}><ArrowUp className="h-3.5 w-3.5" /></Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === order.length - 1} onClick={() => move(id, 1)} aria-label={`Move ${b.title} down`}><ArrowDown className="h-3.5 w-3.5" /></Button>
        </li>; })}</ul>
    </section>}
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      {order.filter(id => !layout.hidden.includes(id) && byId[id].node).map(id => <div key={id} className={cn("min-w-0", sizeOf(byId[id]) === "full" && "lg:col-span-2")}>{byId[id].node}</div>)}
    </div>
  </>;
}

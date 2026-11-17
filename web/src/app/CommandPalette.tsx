/**
 * Cmd+K / Ctrl+K: search everything and jump there, or start an action.
 * Orders (PI#, customer, customer PO), purchase orders, customers, suppliers, products, open tasks and every page.
 * Arrow keys + Enter to choose, Esc to close.
 */
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Command } from "cmdk";
import { ArrowRight, BarChart3, History, Star, Boxes, CheckSquare, ClipboardList, Factory, FileText, LayoutDashboard, Package, Plus, Receipt, Search, Settings, Ship, ShoppingCart, Tags, Users } from "lucide-react";
import { useRows } from "./store";
import { useNav } from "./router";
import { customerPath, orderPath, poPath, productPath, supplierPath } from "./paths";
import { money, STATUS_LABEL } from "./format";
import { taskPath } from "@/modules/tasks/Tasks";
import { TYPE_LABEL, useFavorites, useRecent } from "./Favorites";

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const shortcutLabel = () => (isMac() ? "⌘K" : "Ctrl K");

let openPalette: (() => void) | null = null;
/** open the palette from a button (the sidebar search field) */
export const showCommandPalette = () => openPalette?.();

const PAGES: [string, string, ComponentType<{ className?: string }>, string?][] = [
  ["Overview", "/", LayoutDashboard, "dashboard home"], ["Payments to receive", "/payments", Receipt, "overdue late open"], ["Payments to suppliers", "/payments/suppliers", Receipt, "pay"],
  ["Payment ledger", "/payments/ledger", Receipt], ["Tasks", "/tasks", CheckSquare, "reminders to-do"], ["Orders", "/orders", ShoppingCart, "list"], ["Orders board", "/orders?view=board", ShoppingCart, "kanban status"],
  ["Customers", "/customers", Users], ["Price agreements", "/prices", Tags], ["Purchase orders", "/purchasing", ClipboardList, "po"], ["Suppliers", "/suppliers", Factory],
  ["Shipping", "/shipping", Ship, "containers eta etd"], ["NL stock", "/stock", Boxes, "batches"], ["Products", "/products", Package], ["Reports", "/reports", BarChart3],
  ["Payment terms", "/admin/payment-terms", Settings, "deposit balance admin"], ["Settings", "/admin", Settings, "admin company"], ["Users", "/admin/users", Settings, "admin roles"],
];
const ACTIONS: [string, string, string?][] = [
  ["New order", "/orders/new", "create pi"], ["New task", "/tasks/new", "reminder"], ["New customer", "/customers/new"], ["New purchase order", "/purchasing/new", "po"],
  ["New supplier", "/suppliers/new"], ["New product", "/products/new"], ["New payment term", "/admin/payment-terms/new"],
];

/**
 * Every typed word must appear (in the name or its keywords); exact and starting matches rank first,
 * so "2809" finds PO 2809 before anything that merely contains those digits.
 */
function score(value: string, search: string, keywords?: string[]) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return 1;
  const main = value.split("|")[0].toLowerCase(); const text = `${main} ${(keywords ?? []).join(" ").toLowerCase()}`;
  if (!words.every(w => text.includes(w))) return 0;
  const tokens = text.split(/[\s·,/()-]+/);
  let sc = 0.2;
  for (const w of words) sc += tokens.includes(w) ? 0.3 : tokens.some(t => t.startsWith(w)) ? 0.2 : 0.05;
  for (const w of words) if (main.includes(w)) sc += 0.1;   // in the name itself beats only in a keyword
  if (main.includes(words.join(" "))) sc += 0.2;
  return Math.min(sc, 1);
}

const groupCls = "px-2 pb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-gray-400";
function Item({ value, keywords, onSelect, icon: Icon, children, hint }: { value: string; keywords?: string[]; onSelect: () => void; icon: ComponentType<{ className?: string }>; children: ReactNode; hint?: ReactNode }) {
  return <Command.Item value={value} keywords={keywords} onSelect={onSelect}
    className="group flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm text-gray-700 data-[selected=true]:bg-indigo-50 data-[selected=true]:text-gray-900">
    <Icon className="h-4 w-4 shrink-0 text-gray-400 group-data-[selected=true]:text-indigo-600" />
    <div className="min-w-0 flex-1 truncate">{children}</div>
    {hint && <div className="shrink-0 text-xs tabular-nums text-gray-500">{hint}</div>}
    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-indigo-500 opacity-0 group-data-[selected=true]:opacity-100" />
  </Command.Item>;
}

export function CommandPalette() {
  const nav = useNav();
  const [open, setOpen] = useState(false); const [query, setQuery] = useState("");
  useEffect(() => {
    openPalette = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(o => !o); } };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); openPalette = null; };
  }, []);
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  // records load only while the palette is open (and come from the shared cache when already loaded)
  const src = (t: string) => (open ? t : null);
  const orders = useRows(src("v_orders"), { order: [["po_date", "desc"]] }).rows;
  const pos = useRows(src("v_purchase_orders"), { order: [["po_number", "desc"]] }).rows;
  const customers = useRows(src("customers"), { order: [["name", "asc"]] }).rows;
  const suppliers = useRows(src("suppliers"), { order: [["name", "asc"]] }).rows;
  const products = useRows(src("products"), { order: [["name", "asc"]] }).rows;
  const tasks = useRows(src("v_tasks"), { eq: { status: "open" } }).rows;
  const go = (to: string) => { setOpen(false); nav(to); };
  const favs = useFavorites(); const recent = useRecent();
  const typed = query.trim().length > 0;

  return <Command.Dialog open={open} onOpenChange={setOpen} label="Search and go to" loop filter={score}
    overlayClassName="fixed inset-0 z-50 bg-gray-900/30 backdrop-blur-[1px]"
    contentClassName="fixed left-1/2 top-[12vh] z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
    <div className="flex items-center gap-2 border-b border-gray-100 px-4">
      <Search className="h-4 w-4 shrink-0 text-gray-400" />
      <Command.Input value={query} onValueChange={setQuery} placeholder="Search orders, POs, customers, products, pages…" className="h-12 flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400" />
      <kbd className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">Esc</kbd>
    </div>
    <Command.List className="max-h-[60vh] overflow-y-auto overscroll-contain pb-2">
      <Command.Empty className="px-4 py-8 text-center text-sm text-gray-500">Nothing found for “{query}”</Command.Empty>
      {/* while typing: names first (customers, suppliers), then documents; without a query: actions and the latest orders */}
      {typed ? <>
        <Command.Group heading="Customers" className={groupCls}>
          {customers.map(c => <Item key={c.id} value={`customer ${c.name}|${c.id}`} keywords={[c.country ?? "", c.contact_name ?? "", c.email ?? ""]} icon={Users} onSelect={() => go(customerPath(c))} hint={c.country}>{c.name}</Item>)}
        </Command.Group>
        <Command.Group heading="Suppliers" className={groupCls}>
          {suppliers.map(s => <Item key={s.id} value={`supplier ${s.name}|${s.id}`} keywords={[s.country ?? "", s.contact_name ?? ""]} icon={Factory} onSelect={() => go(supplierPath(s))} hint={s.country}>{s.name}</Item>)}
        </Command.Group>
        <Command.Group heading="Orders" className={groupCls}>
        {orders.slice(0, typed ? 200 : 5).map(o => <Item key={o.id} value={`order PI ${o.pi_number ?? "draft"}|${o.id}`} keywords={[o.customer_name, o.customer_po ?? "", o.order_type, STATUS_LABEL[o.status]]} icon={FileText} onSelect={() => go(orderPath(o))}
          hint={<span className={Number(o.overdue_amount) > 0 ? "text-rose-600" : ""}>{Number(o.outstanding) > 0.01 ? `${money(o.outstanding, o.currency, 0)} open` : STATUS_LABEL[o.status]}</span>}>
          <span className="font-medium text-gray-900">{o.pi_number ? `PI ${o.pi_number}` : "Draft order"}</span> <span className="text-gray-500">· {o.customer_name}{o.customer_po ? ` · PO ${o.customer_po}` : ""}</span></Item>)}
      </Command.Group>
        <Command.Group heading="Purchase orders" className={groupCls}>
          {pos.map(p => <Item key={p.id} value={`PO ${p.po_number}|${p.id}`} keywords={[p.supplier_name, p.pi_numbers ?? ""]} icon={ClipboardList} onSelect={() => go(poPath(p))} hint={Number(p.outstanding) > 0.01 ? `${money(p.outstanding, p.currency, 0)} to pay` : undefined}>
            <span className="font-medium text-gray-900">PO {p.po_number}</span> <span className="text-gray-500">· {p.supplier_name}{p.pi_numbers ? ` · for PI ${p.pi_numbers}` : ""}</span></Item>)}
        </Command.Group>
        <Command.Group heading="Products" className={groupCls}>
          {products.map(p => <Item key={p.id} value={`product ${p.name}|${p.id}`} keywords={[p.sku ?? ""]} icon={Package} onSelect={() => go(productPath(p))} hint={p.sku}>{p.name}</Item>)}
        </Command.Group>
        <Command.Group heading="Open tasks" className={groupCls}>
          {tasks.map(t => <Item key={t.id} value={`task ${t.title}|${t.id}`} keywords={[t.pi_number ?? "", t.po_number ?? "", t.customer_name ?? "", t.supplier_name ?? ""]} icon={CheckSquare} onSelect={() => go(taskPath(t))}>{t.title}</Item>)}
        </Command.Group>
      </> : <>
        {favs.length > 0 && <Command.Group heading="Favourites" className={groupCls}>
          {favs.map(f => <Item key={f.entity_type + f.entity_id} value={`fav ${f.label}|${f.entity_id}`} icon={Star} onSelect={() => go(f.path)} hint={TYPE_LABEL[f.entity_type]}>{f.label}</Item>)}
        </Command.Group>}
        {recent.length > 0 && <Command.Group heading="Recent" className={groupCls}>
          {recent.filter(r => !favs.some(f => f.entity_type === r.type && f.entity_id === r.id)).slice(0, 5).map(r => <Item key={r.type + r.id} value={`recent ${r.label}|${r.id}`} icon={History} onSelect={() => go(r.path)} hint={TYPE_LABEL[r.type]}>
            {r.label}{r.sub && <span className="text-gray-500"> · {r.sub}</span>}</Item>)}
        </Command.Group>}
        <Command.Group heading="Actions" className={groupCls}>
        {ACTIONS.map(([l, to, k]) => <Item key={to} value={`action ${l}`} keywords={k ? [k] : undefined} icon={Plus} onSelect={() => go(to)}>{l}</Item>)}
      </Command.Group>
        <Command.Group heading="Orders" className={groupCls}>
        {orders.slice(0, typed ? 200 : 5).map(o => <Item key={o.id} value={`order PI ${o.pi_number ?? "draft"}|${o.id}`} keywords={[o.customer_name, o.customer_po ?? "", o.order_type, STATUS_LABEL[o.status]]} icon={FileText} onSelect={() => go(orderPath(o))}
          hint={<span className={Number(o.overdue_amount) > 0 ? "text-rose-600" : ""}>{Number(o.outstanding) > 0.01 ? `${money(o.outstanding, o.currency, 0)} open` : STATUS_LABEL[o.status]}</span>}>
          <span className="font-medium text-gray-900">{o.pi_number ? `PI ${o.pi_number}` : "Draft order"}</span> <span className="text-gray-500">· {o.customer_name}{o.customer_po ? ` · PO ${o.customer_po}` : ""}</span></Item>)}
      </Command.Group>
      </>}
      <Command.Group heading="Go to" className={groupCls}>
        {PAGES.map(([l, to, icon, k]) => <Item key={to} value={`page ${l}`} keywords={k ? [k] : undefined} icon={icon} onSelect={() => go(to)}>{l}</Item>)}
      </Command.Group>
      {typed && <Command.Group heading="Actions" className={groupCls}>
        {ACTIONS.map(([l, to, k]) => <Item key={to} value={`action ${l}`} keywords={k ? [k] : undefined} icon={Plus} onSelect={() => go(to)}>{l}</Item>)}
      </Command.Group>}
    </Command.List>
    <div className="flex items-center gap-4 border-t border-gray-100 bg-gray-50/70 px-4 py-2 text-[11px] text-gray-500">
      <span><kbd className="font-sans">↑</kbd> <kbd className="font-sans">↓</kbd> to choose</span><span><kbd className="font-sans">Enter</kbd> to open</span><span className="ml-auto">{shortcutLabel()} anywhere</span>
    </div>
  </Command.Dialog>;
}

/**
 * The order page below its fixed top (status path, key figures, next actions) is split into tabs, like record pages in Salesforce:
 * Overview · Logistics · Payments · Documents · Tasks & notes · History.
 * The tab is in the address (?tab=documents), so a link can open the right one; the last one used is remembered.
 * Each tab keeps its own block layout (Customize layout), saved per user.
 */
import type { ReactNode } from "react";
import { BlockGrid, CustomizeButton, useLayout, type Block } from "@/app/Layout";
import { BASE, useNav, useQuery } from "@/app/router";
import { useRows } from "@/app/store";
import { KV, Section } from "@/app/ui";
import { date, money, qty } from "@/app/format";
import { cn } from "@/lib/utils";
import { calc } from "@/modules/documents/ShippingDocument";

export type Tab = "overview" | "logistics" | "payments" | "documents" | "notes" | "history";
const LABEL: Record<Tab, string> = { overview: "Overview", logistics: "Logistics", payments: "Payments", documents: "Documents", notes: "Tasks & notes", history: "History" };
/** which blocks each tab shows */
export const TABS: Record<Tab, string[]> = {
  overview: ["details", "money", "costs", "lines"],
  logistics: ["shipment", "packing", "shipping_docs"],
  payments: ["schedule", "payments", "supplier_payments"],
  documents: ["slots"],
  notes: ["tasks", "notes"],
  history: ["history"],
};
const KEY = "yp.orderTab";
const isTab = (t: any): t is Tab => typeof t === "string" && t in TABS;

export function useOrderTab(): [Tab, (t: Tab) => void] {
  const q = useQuery(); const nav = useNav();
  let saved: string | null = null; try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
  const tab: Tab = isTab(q.get("tab")) ? q.get("tab") as Tab : isTab(saved) ? saved : "overview";
  const set = (t: Tab) => {
    try { localStorage.setItem(KEY, t); } catch { /* private mode */ }
    const p = new URLSearchParams(window.location.search); if (t === "overview") p.delete("tab"); else p.set("tab", t);
    const path = window.location.pathname.slice(BASE.length) || "/";
    nav(`${path}${p.toString() ? `?${p}` : ""}`, { replace: true });
  };
  return [tab, set];
}

export function OrderTabs({ tab, setTab, counts, dots }: { tab: Tab; setTab: (t: Tab) => void; counts: Partial<Record<Tab, string>>; dots: Partial<Record<Tab, boolean>> }) {
  return <nav role="tablist" aria-label="Order sections" className="mb-5 mt-8 flex gap-1 overflow-x-auto border-b border-gray-200">
    {(Object.keys(TABS) as Tab[]).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
      className={cn("relative -mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
        tab === t ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-900")}>
      {LABEL[t]}
      {counts[t] && <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", tab === t ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600")}>{counts[t]}</span>}
      {dots[t] && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-label="needs attention" />}
    </button>)}
  </nav>;
}

/** one tab's blocks, with its own saved layout */
export function TabBlocks({ page, blocks }: { page: string; blocks: Block[] }) {
  const lay = useLayout(page);
  const shown = blocks.filter(b => b.node);
  return <>
    {shown.length > 1 && <div className="-mt-3 mb-3 flex justify-end"><CustomizeButton lay={lay} /></div>}
    <BlockGrid lay={lay} blocks={blocks} />
  </>;
}

/** Overview: what we receive and what we pay, in short; the details are on the Payments tab */
export function MoneySummary({ o, lines, costs, onDetails }: { o: any; lines: any[]; costs: boolean; onDetails: () => void }) {
  const all = useRows(costs ? "v_purchase_orders" : null).rows;
  const ids = [...new Set(lines.map(l => l.purchase_order_id).filter(Boolean))];
  const pos = all.filter(p => ids.includes(p.id));
  const cur = o.currency; const next = Number(o.deposit_outstanding) > 0.01 ? o.deposit_due_date : o.balance_due_date;
  const purchase = lines.reduce((a, l) => a + Number(l.purchase_value ?? 0), 0);
  const items: [ReactNode, ReactNode][] = [
    ["To receive", money(o.total_receivable, cur)],
    ["Received", money(o.paid, cur)],
    ["Outstanding", <span className={Number(o.overdue_amount) > 0 ? "font-semibold text-rose-600" : Number(o.outstanding) > 0.01 ? "font-semibold text-gray-900" : "text-emerald-700"}>
      {money(o.outstanding, cur)}{Number(o.outstanding) > 0.01 && <span className="ml-1.5 text-xs font-normal text-gray-500">{next ? `due ${date(next)}` : "no due date yet"}</span>}</span>],
  ];
  if (costs) {
    items.push(["Purchase cost", money(purchase, cur)]);
    for (const p of pos) items.push([`PO ${p.po_number}`, Number(p.outstanding) > 0.01
      ? <span className={Number(p.overdue_amount) > 0.01 ? "text-rose-600" : ""}>{money(p.outstanding, p.currency)} to pay{p.balance_due_date ? ` · due ${date(p.balance_due_date)}` : ""}</span>
      : <span className="text-emerald-700">paid</span>]);
  }
  return <Section title="Money" action={<button type="button" onClick={onDetails} className="text-xs font-medium text-indigo-600 hover:underline">All payments →</button>}>
    <KV items={items} />
  </Section>;
}

/** Logistics: cartons, weight and volume worked out from the products' carton data (the packing list can change them) */
export function PackingSummary({ lines, products, shipment }: { lines: any[]; products: any[]; shipment: any }) {
  const rows = lines.filter(l => Number(l.qty) > 0).map(l => {
    const p = products.find(x => x.id === l.product_id) ?? {};
    return { name: p.name ?? "?", qty: Number(l.qty), c: calc({ qty: l.qty, units_per_carton: p.units_per_carton, net_kg_carton: p.carton_net_kg, gross_kg_carton: p.carton_weight_kg,
      length_cm: p.carton_length_cm, width_cm: p.carton_width_cm, height_cm: p.carton_height_cm }) };
  });
  const sum = (k: "cartons" | "gross_kg" | "cbm") => rows.every(r => r.c[k] != null) ? rows.reduce((a, r) => a + (r.c[k] ?? 0), 0) : null;
  const n = (v: number | null, dp: number) => v == null ? <span className="text-gray-400">?</span> : v.toLocaleString("en-US", { maximumFractionDigits: dp });
  return <Section title="Packing" sub="From the carton data of the products. A packing list can change any number.">
    {!rows.length ? <p className="px-5 py-6 text-sm text-gray-500">No order lines yet.</p> :
      <table className="w-full text-sm"><thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500">
        <th className="px-5 py-2 font-medium">Product</th><th className="px-2 py-2 text-right font-medium">Qty</th><th className="px-2 py-2 text-right font-medium">Cartons</th>
        <th className="px-2 py-2 text-right font-medium">Gross kg</th><th className="px-5 py-2 text-right font-medium">CBM</th></tr></thead>
        <tbody className="divide-y divide-gray-50">{rows.map((r, i) => <tr key={i}><td className="px-5 py-2 text-gray-900">{r.name}</td><td className="px-2 py-2 text-right tabular-nums">{qty(r.qty)}</td>
          <td className="px-2 py-2 text-right tabular-nums">{n(r.c.cartons, 0)}</td><td className="px-2 py-2 text-right tabular-nums">{n(r.c.gross_kg, 1)}</td><td className="px-5 py-2 text-right tabular-nums">{n(r.c.cbm, 3)}</td></tr>)}</tbody>
        <tfoot><tr className="border-t border-gray-200 font-semibold text-gray-900"><td className="px-5 py-2">Total{shipment?.pallets != null && <span className="ml-2 font-normal text-gray-500">· {shipment.pallets} pallet{shipment.pallets === 1 ? "" : "s"}</span>}</td>
          <td className="px-2 py-2 text-right tabular-nums">{qty(rows.reduce((a, r) => a + r.qty, 0))}</td><td className="px-2 py-2 text-right tabular-nums">{n(sum("cartons"), 0)}</td>
          <td className="px-2 py-2 text-right tabular-nums">{n(sum("gross_kg"), 1)}</td><td className="px-5 py-2 text-right tabular-nums">{n(sum("cbm"), 3)}</td></tr></tfoot></table>}
    {rows.some(r => r.c.cartons == null || r.c.cbm == null) && <p className="border-t border-gray-100 px-5 py-2.5 text-xs text-gray-500">"?" = the product has no carton data yet (pieces per carton, size, weight). Add it on the product.</p>}
  </Section>;
}

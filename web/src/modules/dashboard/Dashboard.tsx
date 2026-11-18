/**
 * The dashboard is a grid of independent widgets (see widgets.tsx).
 * Which widgets show, and in what order, is saved per user; "Customize" changes it.
 * Saved reports marked "Show on the dashboard" are added as widgets too.
 * The filter (customer, order type, year) sits in the address (?customer=…&type=…&year=…) and reaches every widget.
 */
import { LowStockWidget } from "@/modules/stock/StockPages";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRows } from "@/app/store";
import { useNav, useQuery } from "@/app/router";
import { LinkButton, selectClass } from "@/app/ui";
import { cn } from "@/lib/utils";
import { WIDGETS as BASE, type Widget } from "./widgets";
import { HealthWidget, ReordersWidget, TargetsWidget } from "@/modules/insights/Insights";
import { Combobox } from "@/app/Combobox";
import { X } from "lucide-react";

const BUILT_IN: Widget[] = [...BASE,
  { id: "targets", title: "Targets", description: "This month, year to date and the year against the targets", span: "third", Component: p => <TargetsWidget year={p.year} /> },
  { id: "health", title: "Customer health", description: "Customers to watch: paying late, ordering less, gone quiet", span: "third", Component: p => <HealthWidget customer={p.customer} /> },
  { id: "lowstock", title: "Low stock (NL)", description: "Products under their minimum stock, with weeks left", span: "third", Component: () => <LowStockWidget /> },
  { id: "reorders", title: "Reorders due", description: "Customers expected to order again, late ones first", span: "third", Component: p => <ReordersWidget customer={p.customer} /> },
];
import { ReportWidget } from "@/modules/reports/Custom";
import { useLayout } from "@/app/Layout";

// the layout is saved per user (all devices) like the record pages; the old browser-only layout is picked up once
const LEGACY = "yp.dashboard.layout.v1";
const SPAN = { full: "lg:col-span-6", wide: "lg:col-span-4", half: "lg:col-span-3", third: "lg:col-span-2" };

export default function Dashboard() {
  const nav = useNav(); const q = useQuery();
  const monthly = useRows("v_revenue_monthly").rows;
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => [...new Set([thisYear, ...monthly.map(m => m.year)])].sort((a, b) => b - a), [monthly, thisYear]);
  const year = Number(q.get("year") ?? thisYear);
  const customer = q.get("customer"), type = q.get("type");
  const customers = useRows("customers", { order: [["name", "asc"]] }).rows;
  const setQ = (k: string, v: string | null) => { const n = new URLSearchParams(q); if (v) n.set(k, v); else n.delete(k); const s = n.toString(); nav(s ? `/?${s}` : "/", { replace: true }); };
  const reports = useRows("reports", { order: [["name", "asc"]] }).rows;
  const WIDGETS: Widget[] = useMemo(() => [...BUILT_IN, ...reports.filter(r => r.on_dashboard).map(r => ({ id: `report:${r.id}`, title: r.name, description: "Your report",
    span: "half" as const, Component: () => <ReportWidget report={r} /> }))], [reports]);
  const lay = useLayout("dashboard", LEGACY); const { layout, save, editing, setEditing } = lay;
  const order = [...layout.order.filter(id => WIDGETS.some(w => w.id === id)), ...WIDGETS.map(w => w.id).filter(id => !layout.order.includes(id))];
  const shown = order.map(id => WIDGETS.find(w => w.id === id)!).filter(w => !layout.hidden.includes(w.id));
  const move = (id: string, d: -1 | 1) => { const o = [...order]; const i = o.indexOf(id), j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; save({ ...layout, order: o }); };
  const toggle = (id: string) => save({ ...layout, order, hidden: layout.hidden.includes(id) ? layout.hidden.filter(x => x !== id) : [...layout.hidden, id] });
  const hour = new Date().getHours();

  return <>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-sm text-gray-500">{hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Overview</h1>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-56"><Combobox label="Filter on customer" value={customer ?? ""} onChange={v => setQ("customer", v || null)} placeholder="All customers"
          options={customers.map(c => ({ value: c.id, label: c.name, hint: c.country ?? undefined }))} /></div>
        <select aria-label="Order type" className={selectClass + " w-32"} value={type ?? ""} onChange={e => setQ("type", e.target.value || null)}>
          <option value="">EXW and FOB</option><option value="EXW">Only EXW</option><option value="FOB">Only FOB</option></select>
        <select aria-label="Year" className={selectClass + " w-24"} value={year} onChange={e => setQ("year", Number(e.target.value) === thisYear ? null : e.target.value)}>{years.map(y => <option key={y}>{y}</option>)}</select>
        <Button variant="outline" onClick={() => setEditing(e => !e)} aria-pressed={editing}><SlidersHorizontal className="h-4 w-4" />Customize</Button>
        <LinkButton to="/orders/new"><Plus />New order</LinkButton>
      </div>
    </div>

    {editing && <section className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-gray-900">Dashboard widgets</h2>
        <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => save({ order: WIDGETS.map(w => w.id), hidden: [], size: {} })}>Reset</Button><Button size="sm" onClick={() => setEditing(false)}>Done</Button></div></div>
      <ul className="grid gap-2 sm:grid-cols-2">{order.map((id, i) => { const w = WIDGETS.find(x => x.id === id)!; const on = !layout.hidden.includes(id);
        return <li key={id} className={cn("flex items-center gap-3 rounded-lg border bg-white px-3 py-2", on ? "border-gray-200" : "border-dashed border-gray-300 opacity-60")}>
          <input type="checkbox" checked={on} onChange={() => toggle(id)} className="h-4 w-4 accent-indigo-600" aria-label={`Show ${w.title}`} />
          <div className="min-w-0 flex-1"><div className="text-sm font-medium text-gray-900">{w.title}</div><div className="truncate text-xs text-gray-500">{w.description}</div></div>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => move(id, -1)} aria-label={`Move ${w.title} up`}><ArrowUp className="h-3.5 w-3.5" /></Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === order.length - 1} onClick={() => move(id, 1)} aria-label={`Move ${w.title} down`}><ArrowDown className="h-3.5 w-3.5" /></Button>
        </li>; })}</ul>
    </section>}

    {(customer || type) && <div className="mb-4 flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-sm text-indigo-900">
      Filtered on {[customer && <b key="c">{customers.find(c => c.id === customer)?.name ?? "a customer"}</b>, type && <b key="t">{type}</b>].filter(Boolean).reduce<ReactNode[]>((a, x, i) => i ? [...a, " and ", x] : [x], [])}.
      <span className="text-indigo-700/80">Widgets that cannot be filtered say so.</span>
      <button type="button" onClick={() => { const n = new URLSearchParams(q); n.delete("customer"); n.delete("type"); const s = n.toString(); nav(s ? `/?${s}` : "/", { replace: true }); }}
        className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"><X className="h-3.5 w-3.5" />Clear filter</button></div>}
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-6">
      {shown.map(w => <div key={w.id} className={cn("min-w-0", SPAN[w.span])}><w.Component year={year} customer={customer} type={type} /></div>)}
    </div>
  </>;
}

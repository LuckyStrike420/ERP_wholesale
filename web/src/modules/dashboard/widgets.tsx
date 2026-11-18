/**
 * Dashboard widgets. Each widget is self-contained (loads its own data) and registered in WIDGETS,
 * so a widget can be added, removed, hidden or moved without touching the others.
 * The dashboard filter (customer, order type) reaches every widget through WidgetProps; a widget that cannot be
 * filtered says so.
 */
import { useCan } from "@/app/permissions";
import { useMemo, type ReactNode } from "react";
import { ArrowRight, Clock } from "lucide-react";
import { useRows } from "@/app/store";
import { Link } from "@/app/router";
import { orderPath, poPath, shipmentPath } from "@/app/paths";
import { Pill, SeverityPill } from "@/app/ui";
import { BUCKET_LABEL, BUCKET_TONE, date, days, money, monthName, pct, STATUS_LABEL, STATUS_ORDER } from "@/app/format";
import { cn } from "@/lib/utils";
import { TaskItems } from "@/modules/tasks/Tasks";

export interface WidgetProps { year: number; customer?: string | null; type?: string | null }
const filtered = (p: WidgetProps) => !!(p.customer || p.type);
/** orders that pass the dashboard filter, by id */
function useOrderFilter(p: WidgetProps) {
  const orders = useRows(filtered(p) ? "v_orders" : null).rows;
  return useMemo(() => {
    if (!filtered(p)) return null;
    const ok = new Set(orders.filter(o => (!p.customer || o.customer_id === p.customer) && (!p.type || o.order_type === p.type)).map(o => o.id));
    return { ok: (id: string | null | undefined) => !!id && ok.has(id), orders };
  }, [orders, p.customer, p.type]);   // eslint-disable-line react-hooks/exhaustive-deps
}
const NotFiltered = ({ what }: { what: string }) => <p className="mt-2 text-xs text-gray-400">{what} not filtered by customer.</p>;
export interface Widget { id: string; title: string; description: string; span: "full" | "wide" | "half" | "third"; Component: (p: WidgetProps) => ReactNode }

/** card frame shared by all widgets */
export function Card({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={cn("flex h-full flex-col rounded-xl border border-gray-200/80 bg-white shadow-sm", className)}>
    <header className="flex items-center justify-between gap-2 px-5 pb-2 pt-4"><h2 className="text-sm font-semibold text-gray-900">{title}</h2>{action}</header>
    <div className="min-h-0 flex-1 px-5 pb-4">{children}</div>
  </section>;
}
const More = ({ to, children = "View all" }: { to: string; children?: ReactNode }) =>
  <Link to={to} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500">{children}<ArrowRight className="h-3 w-3" /></Link>;
const Empty = ({ children }: { children: ReactNode }) => <p className="py-6 text-center text-sm text-gray-500">{children}</p>;

// ---------------- KPI strip ----------------
function Kpi({ label, children, hint, to, tone }: { label: string; children: ReactNode; hint?: ReactNode; to?: string; tone?: "bad" | "warn" }) {
  const body = <>
    <div className="text-xs font-medium text-gray-500">{label}</div>
    <div className={cn("mt-2 space-y-0.5 text-xl font-semibold tracking-tight tabular-nums text-gray-900", tone === "bad" && "text-rose-600", tone === "warn" && "text-amber-600")}>{children}</div>
    {hint && <div className="mt-1.5 text-xs text-gray-500">{hint}</div>}
  </>;
  const cls = "block h-full rounded-xl border border-gray-200/80 bg-white px-5 py-4 shadow-sm";
  return to ? <Link to={to} className={cn(cls, "transition-colors hover:border-gray-300")}>{body}</Link> : <div className={cls}>{body}</div>;
}
function KpiStrip(props: WidgetProps) {
  const { year, customer, type } = props; const costs = useCan()("see_costs");
  const items = useRows("v_open_items").rows; const pos = useRows(type ? "v_purchase_orders" : null).rows;
  const lines = useRows("v_order_lines").rows;
  // the same sums as v_open_items_totals and v_revenue_yearly, but for the filtered customer / order type
  const totals = useMemo(() => {
    const keep = items.filter(i => i.direction === "in" ? (!customer || i.party_id === customer) && (!type || i.order_type === type) : !customer && (!type || i.order_type === type || pos.find(p => p.id === i.id)?.order_type === type));
    const by = new Map<string, any>();
    for (const i of keep) { const k = i.direction + i.currency; const t = by.get(k) ?? { direction: i.direction, currency: i.currency, items: 0, outstanding: 0, overdue_amount: 0, undated_items: 0 };
      t.items++; t.outstanding += Number(i.outstanding); t.overdue_amount += Number(i.overdue_amount ?? 0); if (i.bucket === "no_due_date") t.undated_items++; by.set(k, t); }
    return [...by.values()];
  }, [items, pos, customer, type]);
  const yearly = useMemo(() => {
    const by = new Map<string, any>();
    for (const l of lines) {
      if (["draft", "cancelled"].includes(l.status) || !l.revenue_date || Number(String(l.revenue_date).slice(0, 4)) !== year) continue;
      if ((customer && l.customer_id !== customer) || (type && l.order_type !== type)) continue;
      const t = by.get(l.order_type) ?? { order_type: l.order_type, currency: l.currency, revenue: 0, margin: 0, costed: 0, cost_missing_lines: 0 };
      t.revenue += Number(l.revenue ?? 0); if (l.cost_known) { t.margin += Number(l.margin ?? 0); t.costed += Number(l.revenue ?? 0); } else if (Number(l.qty) > 0) t.cost_missing_lines++;
      by.set(l.order_type, t);
    }
    return [...by.values()].map(t => ({ ...t, margin_pct: t.costed ? t.margin / t.costed : null })).sort((a, b) => a.order_type.localeCompare(b.order_type));
  }, [lines, year, customer, type]);
  const tin = totals.filter(t => t.direction === "in"), tout = totals.filter(t => t.direction === "out");
  const per = (rows: any[], k: string) => rows.filter(r => Number(r[k]) !== 0);
  const overdue = tin.some(t => Number(t.overdue_amount) > 0);
  const undated = tin.reduce((a, t) => a + Number(t.undated_items), 0), openIn = tin.reduce((a, t) => a + Number(t.items), 0);
  const incomplete = yearly.reduce((a, y) => a + Number(y.cost_missing_lines ?? 0), 0);
  return <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
    <Kpi label="To receive" to="/payments" hint={`${openIn} open order${openIn === 1 ? "" : "s"}`}>{per(tin, "outstanding").map(t => <div key={t.currency}>{money(t.outstanding, t.currency, 0)}</div>)}{!tin.length && "–"}</Kpi>
    <Kpi label="Overdue from customers" to="/payments?bucket=overdue" tone={overdue ? "bad" : undefined}
      hint={undated ? <span className="text-amber-700">{undated} of {openIn} have no due date</span> : undefined}>
      {overdue ? per(tin, "overdue_amount").map(t => <div key={t.currency}>{money(t.overdue_amount, t.currency, 0)}</div>) : <span className="text-gray-400">none</span>}</Kpi>
    {costs && <Kpi label="To pay suppliers" to="/payments/suppliers" hint={customer ? "not filtered by customer" : `${tout.reduce((a, t) => a + Number(t.items), 0)} open POs`}>{per(tout, "outstanding").map(t => <div key={t.currency}>{money(t.outstanding, t.currency, 0)}</div>)}{!tout.length && "–"}</Kpi>}
    <Kpi label={`Revenue ${year}`} to="/reports/monthly" hint={incomplete && costs ? <span className="text-amber-700">margin incomplete: {incomplete} line(s) without cost</span>
        : costs ? yearly.map(y => `${y.order_type} margin ${pct(y.margin_pct, 1)}`).join(" · ") || undefined : undefined}>
      {yearly.map(y => <div key={y.order_type}>{money(y.revenue, y.currency, 0)}</div>)}{!yearly.length && <span className="text-gray-400">–</span>}</Kpi>
  </div>;
}

// ---------------- payments to chase ----------------
const RANK: Record<string, number> = { overdue: 0, reminder: 1, due_soon: 2, no_due_date: 3, scheduled: 4 };
function ChaseList(p: WidgetProps) {
  const items = useRows("v_open_items", { eq: { direction: "in" } }).rows.filter(i => (!p.customer || i.party_id === p.customer) && (!p.type || i.order_type === p.type));
  const rows = [...items].sort((a, b) => RANK[a.bucket] - RANK[b.bucket] || Number(b.days_late ?? 0) - Number(a.days_late ?? 0) || Number(b.days_open ?? 0) - Number(a.days_open ?? 0)).slice(0, 7);
  return <Card title="Payments to chase" action={<More to="/payments" />}>
    {!rows.length ? <Empty>Every customer has paid.</Empty> :
      <ul className="-mx-2 divide-y divide-gray-100">{rows.map(r => (
        <li key={r.id}><Link to={orderPath({ pi_number: r.reference, id: r.id })} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-gray-50">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><span className="text-sm font-semibold text-gray-900">PI {r.reference}</span><Pill tone={BUCKET_TONE[r.bucket]}>{BUCKET_LABEL[r.bucket]}</Pill></div>
            <div className="truncate text-xs text-gray-500">{r.party}</div>
          </div>
          <div className="text-right">
            <div className={cn("text-sm font-semibold tabular-nums", r.bucket === "overdue" ? "text-rose-600" : "text-gray-900")}>{money(r.outstanding, r.currency, 0)}</div>
            <div className="flex items-center justify-end gap-1 text-xs text-gray-500">{r.days_late ? `${days(r.days_late)} late` : r.days_open != null ? <><Clock className="h-3 w-3" />open {days(r.days_open)}</> : ""}</div>
          </div>
        </Link></li>))}</ul>}
  </Card>;
}

// ---------------- needs attention ----------------
const SEV: Record<string, number> = { error: 0, warning: 1, info: 2 };
function Attention(p: WidgetProps) {
  const all = useRows("v_attention").rows; const counts = useRows("v_attention_counts").rows[0];
  const orders = useRows("v_orders").rows; const pos = useRows("v_purchase_orders").rows; const ships = useRows("v_shipments").rows;
  const byId = useMemo(() => ({ o: Object.fromEntries(orders.map(o => [o.id, o])), pi: Object.fromEntries(orders.filter(o => o.pi_number).map(o => [o.pi_number, o])), p: Object.fromEntries(pos.map(p => [p.id, p])), s: Object.fromEntries(ships.map(s => [s.id, s])) }), [orders, pos, ships]);
  const to = (a: any): string => {
    if (a.entity === "sales_orders" && byId.o[a.entity_id]) return orderPath(byId.o[a.entity_id]);
    if (a.entity === "sales_order_lines") return byId.pi[a.reference] ? orderPath(byId.pi[a.reference]) : "/orders?status=draft";
    if (a.entity === "purchase_orders" && byId.p[a.entity_id]) return poPath(byId.p[a.entity_id]);
    if (a.entity === "shipments" && byId.s[a.entity_id]) return shipmentPath(byId.s[a.entity_id], "/edit");
    return "/stock";
  };
  // filtered: only signals about the orders (and their lines) of that customer / order type
  const pass = (a: any) => { const o = a.entity === "sales_orders" ? byId.o[a.entity_id] : a.entity === "sales_order_lines" ? byId.pi[a.reference] : null;
    return !!o && (!p.customer || o.customer_id === p.customer) && (!p.type || o.order_type === p.type); };
  const attention = filtered(p) ? all.filter(pass) : all;
  const rows = [...attention].sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  return <Card title={<>Needs attention <span className="ml-1 font-normal text-gray-500">{filtered(p) ? rows.length : <>{Number(counts?.actionable ?? 0)}{Number(counts?.info_count ?? 0) ? ` + ${counts.info_count} info` : ""}</>}</span></>}>
    {!rows.length ? <Empty>Nothing needs attention.</Empty> :
      <ul className="-mx-2 max-h-[22rem] divide-y divide-gray-100 overflow-y-auto">{rows.map((a, i) => (
        <li key={i}><Link to={to(a)} className="flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-gray-50">
          <SeverityPill s={a.severity} /><div className="min-w-0 flex-1"><div className="text-sm text-gray-800">{a.message}</div><div className="text-xs text-gray-500">{a.reference}</div></div>
        </Link></li>))}</ul>}
  </Card>;
}

// ---------------- revenue per month: small multiples, one per currency ----------------
function MonthBars({ data, cur, label, total }: { data: { m: number; v: number; margin: number }[]; cur: string; label: string; total: any }) {
  const max = Math.max(1, ...data.map(d => d.v));
  const best = data.reduce((a, d) => (d.v > a.v ? d : a), data[0]);
  return <div>
    <div className="mb-3 flex items-baseline justify-between"><span className="text-xs font-medium text-gray-500">{label}</span><span className="text-sm font-semibold tabular-nums text-gray-900">{money(total, cur, 0)}</span></div>
    <div className="flex h-28 items-end gap-1" role="img" aria-label={`${label} revenue per month`}>
      {data.map(d => <div key={d.m} className="group relative flex h-full flex-1 flex-col items-center justify-end" title={`${monthName(d.m)}: ${money(d.v, cur, 0)} revenue, ${money(d.margin, cur, 0)} margin`}>
        <div className={cn("w-full rounded-t-sm transition-colors", d.v ? (d === best ? "bg-indigo-600" : "bg-indigo-300 group-hover:bg-indigo-400") : "bg-gray-100")} style={{ height: `${d.v ? Math.max(4, (d.v / max) * 100) : 3}%` }} />
      </div>)}
    </div>
    <div className="mt-1 flex gap-1 text-[10px] text-gray-400">{data.map(d => <span key={d.m} className="flex-1 text-center">{monthName(d.m)[0]}</span>)}</div>
  </div>;
}
function RevenueChart(p: WidgetProps) {
  const { year } = p;
  const monthlyAll = useRows("v_revenue_monthly", { eq: { year } }).rows;
  const lines = useRows(filtered(p) ? "v_order_lines" : null).rows;
  // filtered: the same monthly sums from the order lines of that customer / order type
  const monthly = useMemo(() => !filtered(p) ? monthlyAll : (() => {
    const by = new Map<string, any>();
    for (const l of lines) {
      if (["draft", "cancelled"].includes(l.status) || !l.revenue_date || Number(String(l.revenue_date).slice(0, 4)) !== year) continue;
      if ((p.customer && l.customer_id !== p.customer) || (p.type && l.order_type !== p.type)) continue;
      const m = Number(String(l.revenue_date).slice(5, 7)); const k = `${l.order_type}${m}`;
      const t = by.get(k) ?? { month: m, order_type: l.order_type, revenue: 0, margin: 0 }; t.revenue += Number(l.revenue ?? 0); t.margin += Number(l.margin ?? 0); by.set(k, t);
    }
    return [...by.values()];
  })(), [monthlyAll, lines, year, p.customer, p.type]);   // eslint-disable-line react-hooks/exhaustive-deps
  const total = (t: string) => monthly.filter(x => x.order_type === t).reduce((a, x) => a + Number(x.revenue ?? 0), 0);
  const series = (t: string) => Array.from({ length: 12 }, (_, i) => { const r = monthly.find(x => x.month === i + 1 && x.order_type === t); return { m: i + 1, v: Number(r?.revenue ?? 0), margin: Number(r?.margin ?? 0) }; });
  return <Card title={`Order value per month, ${year}`} action={<More to={`/reports/monthly?year=${year}`}>Details</More>}>
    <div className="grid gap-6 sm:grid-cols-2 pt-1">
      {p.type !== "EXW" && <MonthBars data={series("FOB")} cur="USD" label="FOB · USD" total={total("FOB")} />}
      {p.type !== "FOB" && <MonthBars data={series("EXW")} cur="EUR" label="EXW · EUR" total={total("EXW")} />}
    </div>
    <p className="mt-3 text-xs text-gray-400">By PO date. Darkest bar = best month. Euro and dollar are never added together.</p>
  </Card>;
}

// ---------------- pipeline ----------------
function Pipeline(p: WidgetProps) {
  const orders = useRows("v_orders").rows.filter(o => (!p.customer || o.customer_id === p.customer) && (!p.type || o.order_type === p.type));
  const open = STATUS_ORDER.filter(s => s !== "completed").map(s => ({ s, n: orders.filter(o => o.status === s).length })).filter(x => x.n);
  const max = Math.max(1, ...open.map(x => x.n));
  return <Card title="Orders by status" action={<More to="/orders" />}>
    {!open.length ? <Empty>No open orders.</Empty> :
      <ul className="space-y-2.5 pt-1">{open.map(x => <li key={x.s}><Link to={`/orders?status=${x.s}${p.type ? `&type=${p.type}` : ""}`} className="group block">
        <div className="mb-1 flex justify-between text-xs"><span className="text-gray-700 group-hover:text-gray-900">{STATUS_LABEL[x.s]}</span><span className="font-semibold tabular-nums text-gray-900">{x.n}</span></div>
        <div className="h-1.5 rounded-full bg-gray-100"><div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${(x.n / max) * 100}%` }} /></div>
      </Link></li>)}</ul>}
  </Card>;
}

// ---------------- cash flow ----------------
function CashFlow(p: WidgetProps) {
  const summaryAll = useRows("v_cash_flow_summary").rows; const all = useRows("v_cash_flow").rows;
  const f = useOrderFilter(p); const pos = useRows(p.type ? "v_purchase_orders" : null).rows;
  // filtered: customer amounts of the matching orders; supplier amounts only by order type
  const cash = !f ? all : all.filter(c => c.direction === "in" ? f.ok(c.order_id) : !p.customer && pos.find(x => x.id === c.order_id)?.order_type === p.type);
  const summary = !f ? summaryAll : [...cash.reduce((m, c) => { const k = c.direction + c.currency; const t = m.get(k) ?? { direction: c.direction, currency: c.currency, total_amount: 0, undated_items: 0, undated_amount: 0 };
    t.total_amount += Number(c.amount); if (!c.due_date) { t.undated_items++; t.undated_amount += Number(c.amount); } m.set(k, t); return m; }, new Map<string, any>()).values()];
  const next = cash.filter(c => c.due_date).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))).slice(0, 5);
  return <Card title="Expected cash flow" action={<More to="/reports/cash-flow" />}>
    <div className="space-y-2 pt-1">{summary.map(s => <div key={s.direction + s.currency} className="text-sm">
      <div className="flex justify-between"><span className="text-gray-600">{s.direction === "in" ? "In" : "Out"} · {s.currency}</span><span className="font-semibold tabular-nums text-gray-900">{money(s.total_amount, s.currency, 0)}</span></div>
      {Number(s.undated_items) > 0 && <div className="text-xs text-amber-700">{money(s.undated_amount, s.currency, 0)} without a due date ({s.undated_items})</div>}
    </div>)}</div>
    {next.length > 0 && <><div className="mb-1 mt-4 text-xs font-medium text-gray-500">Next due</div>
      <ul className="divide-y divide-gray-100">{next.map((c, i) => <li key={i} className="flex justify-between py-1.5 text-sm"><span>{date(c.due_date)} · {c.reference}</span><span className="tabular-nums">{money(c.amount, c.currency, 0)}</span></li>)}</ul></>}
    {p.customer && <NotFiltered what="Supplier payments are" />}
  </Card>;
}

// ---------------- activity ----------------
function Activity(p: WidgetProps) {
  const activity = useRows("audit_log", { order: [["id", "desc"]], limit: 8 }).rows;
  return <Card title="Recent activity" action={<More to="/admin/audit" />}>
    {filtered(p) && <p className="-mt-1 mb-1 text-xs text-gray-400">All changes; not filtered.</p>}
    {!activity.length ? <Empty>No changes yet. Everything you change is logged here.</Empty> :
      <ul className="divide-y divide-gray-100">{activity.map(a => { const d = a.new_data ?? a.old_data ?? {};
        return <li key={a.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
          <span className="min-w-0 truncate text-gray-700">{({ INSERT: "Added", UPDATE: "Changed", DELETE: "Removed" } as any)[a.action]} {String(a.table_name).replace(/_/g, " ")} <span className="text-gray-900">{d.pi_number ?? d.po_number ?? d.name ?? d.reference ?? d.invoice_number ?? ""}</span></span>
          <span className="shrink-0 text-xs text-gray-400">{String(a.changed_at).slice(5, 16).replace("T", " ")}</span></li>; })}</ul>}
  </Card>;
}

// ---------------- tasks ----------------
function TasksWidget(p: WidgetProps) {
  const f = useOrderFilter(p);
  // filtered: tasks on the matching orders, and (customer filter only) tasks on the customer itself
  const rows = useRows("v_tasks", { eq: { status: "open" } }).rows.filter(t => !f || f.ok(t.sales_order_id) || (!p.type && !!p.customer && t.customer_id === p.customer));
  const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const soon = rows.filter(t => t.state === "overdue" || t.state === "today" || (t.due_date && t.due_date <= week));
  const late = rows.filter(t => t.state === "overdue").length;
  return <Card title={<span className="flex items-center gap-2">Tasks{late > 0 && <Pill tone="red">{late} overdue</Pill>}</span>} action={<More to="/tasks">All {rows.length}</More>}>
    <div className="-mx-5"><TaskItems rows={soon.slice(0, 7)} empty={rows.length ? "Nothing due in the next 7 days" : "No open tasks"} /></div>
  </Card>;
}

export const WIDGETS: Widget[] = [
  { id: "kpis", title: "Key figures", description: "To receive, overdue, to pay, revenue this year", span: "full", Component: KpiStrip },
  { id: "chase", title: "Payments to chase", description: "Open customer amounts, most urgent first", span: "third", Component: ChaseList },
  { id: "tasks", title: "Tasks", description: "Your reminders: overdue, today and the next 7 days", span: "third", Component: TasksWidget },
  { id: "attention", title: "Needs attention", description: "Signals the system found in the data", span: "third", Component: Attention },
  { id: "revenue", title: "Order value per month", description: "Bars per month, per currency", span: "wide", Component: RevenueChart },
  { id: "pipeline", title: "Orders by status", description: "How many orders sit in each step", span: "third", Component: Pipeline },
  { id: "cash", title: "Expected cash flow", description: "Money in and out, with and without due date", span: "half", Component: CashFlow },
  { id: "activity", title: "Recent activity", description: "The latest changes in the audit log", span: "half", Component: Activity },
];

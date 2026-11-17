/**
 * Dashboard widgets. Each widget is self-contained (loads its own data) and registered in WIDGETS,
 * so a widget can be added, removed, hidden or moved without touching the others.
 */
import { useMemo, type ReactNode } from "react";
import { ArrowRight, Clock } from "lucide-react";
import { useRows } from "@/app/store";
import { Link } from "@/app/router";
import { orderPath, poPath, shipmentPath } from "@/app/paths";
import { Pill, SeverityPill } from "@/app/ui";
import { BUCKET_LABEL, BUCKET_TONE, date, days, money, monthName, pct, STATUS_LABEL, STATUS_ORDER } from "@/app/format";
import { cn } from "@/lib/utils";
import { TaskItems } from "@/modules/tasks/Tasks";

export interface WidgetProps { year: number }
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
function KpiStrip({ year }: WidgetProps) {
  const totals = useRows("v_open_items_totals").rows;
  const yearly = useRows("v_revenue_yearly", { eq: { year } }).rows;
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
    <Kpi label="To pay suppliers" to="/payments/suppliers" hint={`${tout.reduce((a, t) => a + Number(t.items), 0)} open POs`}>{per(tout, "outstanding").map(t => <div key={t.currency}>{money(t.outstanding, t.currency, 0)}</div>)}{!tout.length && "–"}</Kpi>
    <Kpi label={`Revenue ${year}`} to="/reports/monthly" hint={incomplete ? <span className="text-amber-700">margin incomplete: {incomplete} line(s) without cost</span>
        : yearly.map(y => `${y.order_type} margin ${pct(y.margin_pct, 1)}`).join(" · ") || undefined}>
      {yearly.map(y => <div key={y.order_type}>{money(y.revenue, y.currency, 0)}</div>)}{!yearly.length && <span className="text-gray-400">–</span>}</Kpi>
  </div>;
}

// ---------------- payments to chase ----------------
const RANK: Record<string, number> = { overdue: 0, reminder: 1, due_soon: 2, no_due_date: 3, scheduled: 4 };
function ChaseList() {
  const items = useRows("v_open_items", { eq: { direction: "in" } }).rows;
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
function Attention() {
  const attention = useRows("v_attention").rows; const counts = useRows("v_attention_counts").rows[0];
  const orders = useRows("v_orders").rows; const pos = useRows("v_purchase_orders").rows; const ships = useRows("v_shipments").rows;
  const byId = useMemo(() => ({ o: Object.fromEntries(orders.map(o => [o.id, o])), pi: Object.fromEntries(orders.filter(o => o.pi_number).map(o => [o.pi_number, o])), p: Object.fromEntries(pos.map(p => [p.id, p])), s: Object.fromEntries(ships.map(s => [s.id, s])) }), [orders, pos, ships]);
  const to = (a: any): string => {
    if (a.entity === "sales_orders" && byId.o[a.entity_id]) return orderPath(byId.o[a.entity_id]);
    if (a.entity === "sales_order_lines") return byId.pi[a.reference] ? orderPath(byId.pi[a.reference]) : "/orders?status=draft";
    if (a.entity === "purchase_orders" && byId.p[a.entity_id]) return poPath(byId.p[a.entity_id]);
    if (a.entity === "shipments" && byId.s[a.entity_id]) return shipmentPath(byId.s[a.entity_id], "/edit");
    return "/stock";
  };
  const rows = [...attention].sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  return <Card title={<>Needs attention <span className="ml-1 font-normal text-gray-500">{Number(counts?.actionable ?? 0)}{Number(counts?.info_count ?? 0) ? ` + ${counts.info_count} info` : ""}</span></>}>
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
function RevenueChart({ year }: WidgetProps) {
  const monthly = useRows("v_revenue_monthly", { eq: { year } }).rows;
  const yearly = useRows("v_revenue_yearly", { eq: { year } }).rows;
  const total = (t: string) => yearly.find(y => y.order_type === t)?.revenue ?? 0;
  const series = (t: string) => Array.from({ length: 12 }, (_, i) => { const r = monthly.find(x => x.month === i + 1 && x.order_type === t); return { m: i + 1, v: Number(r?.revenue ?? 0), margin: Number(r?.margin ?? 0) }; });
  return <Card title={`Order value per month, ${year}`} action={<More to={`/reports/monthly?year=${year}`}>Details</More>}>
    <div className="grid gap-6 sm:grid-cols-2 pt-1">
      <MonthBars data={series("FOB")} cur="USD" label="FOB · USD" total={total("FOB")} />
      <MonthBars data={series("EXW")} cur="EUR" label="EXW · EUR" total={total("EXW")} />
    </div>
    <p className="mt-3 text-xs text-gray-400">By PO date. Darkest bar = best month. Euro and dollar are never added together.</p>
  </Card>;
}

// ---------------- pipeline ----------------
function Pipeline() {
  const orders = useRows("v_orders").rows;
  const open = STATUS_ORDER.filter(s => s !== "completed").map(s => ({ s, n: orders.filter(o => o.status === s).length })).filter(x => x.n);
  const max = Math.max(1, ...open.map(x => x.n));
  return <Card title="Orders by status" action={<More to="/orders" />}>
    {!open.length ? <Empty>No open orders.</Empty> :
      <ul className="space-y-2.5 pt-1">{open.map(x => <li key={x.s}><Link to={`/orders?status=${x.s}`} className="group block">
        <div className="mb-1 flex justify-between text-xs"><span className="text-gray-700 group-hover:text-gray-900">{STATUS_LABEL[x.s]}</span><span className="font-semibold tabular-nums text-gray-900">{x.n}</span></div>
        <div className="h-1.5 rounded-full bg-gray-100"><div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${(x.n / max) * 100}%` }} /></div>
      </Link></li>)}</ul>}
  </Card>;
}

// ---------------- cash flow ----------------
function CashFlow() {
  const summary = useRows("v_cash_flow_summary").rows; const cash = useRows("v_cash_flow").rows;
  const next = cash.filter(c => c.due_date).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))).slice(0, 5);
  return <Card title="Expected cash flow" action={<More to="/reports/cash-flow" />}>
    <div className="space-y-2 pt-1">{summary.map(s => <div key={s.direction + s.currency} className="text-sm">
      <div className="flex justify-between"><span className="text-gray-600">{s.direction === "in" ? "In" : "Out"} · {s.currency}</span><span className="font-semibold tabular-nums text-gray-900">{money(s.total_amount, s.currency, 0)}</span></div>
      {Number(s.undated_items) > 0 && <div className="text-xs text-amber-700">{money(s.undated_amount, s.currency, 0)} without a due date ({s.undated_items})</div>}
    </div>)}</div>
    {next.length > 0 && <><div className="mb-1 mt-4 text-xs font-medium text-gray-500">Next due</div>
      <ul className="divide-y divide-gray-100">{next.map((c, i) => <li key={i} className="flex justify-between py-1.5 text-sm"><span>{date(c.due_date)} · {c.reference}</span><span className="tabular-nums">{money(c.amount, c.currency, 0)}</span></li>)}</ul></>}
  </Card>;
}

// ---------------- activity ----------------
function Activity() {
  const activity = useRows("audit_log", { order: [["id", "desc"]], limit: 8 }).rows;
  return <Card title="Recent activity" action={<More to="/admin/audit" />}>
    {!activity.length ? <Empty>No changes yet. Everything you change is logged here.</Empty> :
      <ul className="divide-y divide-gray-100">{activity.map(a => { const d = a.new_data ?? a.old_data ?? {};
        return <li key={a.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
          <span className="min-w-0 truncate text-gray-700">{({ INSERT: "Added", UPDATE: "Changed", DELETE: "Removed" } as any)[a.action]} {String(a.table_name).replace(/_/g, " ")} <span className="text-gray-900">{d.pi_number ?? d.po_number ?? d.name ?? d.reference ?? d.invoice_number ?? ""}</span></span>
          <span className="shrink-0 text-xs text-gray-400">{String(a.changed_at).slice(5, 16).replace("T", " ")}</span></li>; })}</ul>}
  </Card>;
}

// ---------------- tasks ----------------
function TasksWidget() {
  const rows = useRows("v_tasks", { eq: { status: "open" } }).rows;
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

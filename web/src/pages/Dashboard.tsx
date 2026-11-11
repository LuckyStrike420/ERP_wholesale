import { useMemo, useState } from "react";
import { useNav, useRows } from "@/app/store";
import { DataTable, PageHeader, Section, SeverityPill, selectClass } from "@/app/ui";
import { date, money, monthName, pct } from "@/app/format";

export function entityRoute(a: any, lineOrder: Record<string, string>): string {
  if (a.entity === "sales_orders") return `order-${a.entity_id}`;
  if (a.entity === "sales_order_lines") return lineOrder[a.entity_id] ? `order-${lineOrder[a.entity_id]}` : "orders";
  if (a.entity === "purchase_orders") return `po-${a.entity_id}`;
  if (a.entity === "shipments") return "shipping";
  return "stock";
}
const SEV: Record<string, number> = { error: 0, warning: 1, info: 2 };

export default function Dashboard() {
  const nav = useNav();
  const out = useRows("v_outstanding_summary").rows;
  const monthly = useRows("v_revenue_monthly").rows;
  const attention = useRows("v_attention").rows;
  const cash = useRows("v_cash_flow").rows;
  const lines = useRows("v_order_lines").rows;
  const orders = useRows("v_orders").rows;
  const activity = useRows("audit_log", { order: [["id", "desc"]], limit: 12 }).rows;
  const years = useMemo(() => [...new Set([new Date().getFullYear(), ...monthly.map(m => m.year)])].sort((a, b) => b - a), [monthly]);
  const [year, setYear] = useState(new Date().getFullYear());
  const lineOrder = useMemo(() => Object.fromEntries(lines.map(l => [l.id, l.sales_order_id])), [lines]);

  const types = [{ type: "EXW", cur: "EUR" }, { type: "FOB", cur: "USD" }];
  const sum = (rows: any[], k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);   // adding up database figures for display
  const kpi = types.map(t => {
    const m = monthly.filter(r => r.year === year && r.order_type === t.type);
    const o = out.find(r => r.currency === t.cur) ?? {};
    const revenue = sum(m, "revenue"), margin = sum(m, "margin");
    return { ...t, revenue, margin, marginPct: revenue ? margin / revenue : null, ...o,
      completed: orders.filter(x => x.order_type === t.type && x.status === "completed").length };
  });
  const yearRows = monthly.filter(r => r.year === year);
  const fxMissing = yearRows.some(r => r.fx_rate_missing);
  const eurTotal = { revenue: sum(yearRows, "revenue_reporting"), margin: sum(yearRows, "margin_reporting") };

  const months = Array.from({ length: 12 }, (_, i) => i + 1).map(mo => {
    const g = (y: number, t: string, k: string) => sum(monthly.filter(r => r.year === y && r.month === mo && r.order_type === t), k);
    return { id: mo, month: monthName(mo), exw: g(year, "EXW", "revenue"), exwM: g(year, "EXW", "margin"), fob: g(year, "FOB", "revenue"), fobM: g(year, "FOB", "margin"),
      exwPrev: g(year - 1, "EXW", "revenue"), fobPrev: g(year - 1, "FOB", "revenue") };
  });
  const z = (v: number, cur: string) => (v ? money(v, cur) : <span className="text-muted-foreground">–</span>);

  return <>
    <PageHeader title="Dashboard" sub="Euro and dollar are never added together. Revenue and margin follow the PO date; open amounts cover all years.">
      <select className={selectClass + " w-28"} value={year} onChange={e => setYear(Number(e.target.value))}>{years.map(y => <option key={y}>{y}</option>)}</select>
    </PageHeader>

    <Section title={`Key figures ${year}`} className="mb-5">
      <div className="overflow-x-auto"><table className="w-full text-sm tabular-nums">
        <thead><tr className="border-b bg-muted/40 text-right text-xs uppercase tracking-wide text-muted-foreground">
          <th className="px-4 py-2 text-left font-medium"></th><th className="px-4 py-2 font-medium">Order value</th><th className="px-4 py-2 font-medium">Margin</th><th className="px-4 py-2 font-medium">Margin %</th>
          <th className="px-4 py-2 font-medium">Owed by customers</th><th className="px-4 py-2 font-medium">of which overdue</th><th className="px-4 py-2 font-medium">Owed to suppliers</th><th className="px-4 py-2 font-medium">of which overdue</th>
          <th className="px-4 py-2 font-medium">Active orders</th><th className="px-4 py-2 font-medium">Completed</th></tr></thead>
        <tbody>
          {kpi.map(k => <tr key={k.type} className="border-b text-right last:border-0">
            <td className="px-4 py-3 text-left font-semibold">{k.type} <span className="font-normal text-muted-foreground">{k.cur}</span></td>
            <td className="px-4 py-3 text-base font-semibold">{money(k.revenue, k.cur)}</td><td className="px-4 py-3">{money(k.margin, k.cur)}</td><td className="px-4 py-3">{pct(k.marginPct)}</td>
            <td className="px-4 py-3 text-base font-semibold">{money(k.receivable ?? 0, k.cur)}</td>
            <td className={"px-4 py-3 " + (Number(k.receivable_overdue) > 0 ? "font-semibold text-red-700" : "text-muted-foreground")}>{money(k.receivable_overdue ?? 0, k.cur)}</td>
            <td className="px-4 py-3 text-base font-semibold">{money(k.payable ?? 0, k.cur)}</td>
            <td className={"px-4 py-3 " + (Number(k.payable_overdue) > 0 ? "font-semibold text-red-700" : "text-muted-foreground")}>{money(k.payable_overdue ?? 0, k.cur)}</td>
            <td className="px-4 py-3">{k.open_orders ?? 0}</td><td className="px-4 py-3">{k.completed}</td></tr>)}
          <tr className="bg-muted/30 text-right"><td className="px-4 py-2 text-left text-muted-foreground">Combined in EUR</td>
            {fxMissing ? <td colSpan={9} className="px-4 py-2 text-left text-muted-foreground">Needs a USD exchange rate: add one under Admin.</td>
              : <><td className="px-4 py-2 font-semibold">{money(eurTotal.revenue, "EUR")}</td><td className="px-4 py-2">{money(eurTotal.margin, "EUR")}</td><td colSpan={8}></td></>}</tr>
        </tbody></table></div>
    </Section>

    <div className="grid gap-5 xl:grid-cols-2">
      <Section title={`Needs attention · ${attention.length}`}>
        <DataTable dense rows={[...attention].sort((a, b) => SEV[a.severity] - SEV[b.severity])} onRow={a => nav(entityRoute(a, lineOrder))} empty="Nothing needs attention"
          cols={[{ key: "severity", header: "", width: "4.5rem", render: a => <SeverityPill s={a.severity} /> }, { key: "reference", header: "Ref", width: "7rem" }, { key: "message", header: "What" }]} />
      </Section>
      <Section title="Expected cash flow">
        <DataTable dense rows={[...cash].sort((a, b) => String(a.due_date ?? "9").localeCompare(String(b.due_date ?? "9")))} empty="No open amounts"
          onRow={c => nav(c.direction === "in" ? `order-${c.order_id}` : `po-${c.order_id}`)}
          cols={[{ key: "due_date", header: "Due", render: c => c.due_date ? date(c.due_date) : <span className="text-muted-foreground">no due date</span> },
            { key: "direction", header: "", render: c => <span className={c.direction === "in" ? "text-emerald-700" : "text-slate-600"}>{c.direction === "in" ? "In" : "Out"}</span> },
            { key: "reference", header: "PI / PO" }, { key: "party", header: "Party" }, { key: "part", header: "Part" },
            { key: "amount", header: "Amount", align: "right", render: c => money(c.amount, c.currency) }]} />
      </Section>
      <Section title={`Per month ${year}`}>
        <DataTable dense rows={months} cols={[{ key: "month", header: "Month" },
          { key: "exw", header: "EXW €", align: "right", render: r => z(r.exw, "EUR") }, { key: "exwM", header: "Margin €", align: "right", render: r => z(r.exwM, "EUR") },
          { key: "fob", header: "FOB $", align: "right", render: r => z(r.fob, "USD") }, { key: "fobM", header: "Margin $", align: "right", render: r => z(r.fobM, "USD") },
          { key: "exwPrev", header: `EXW € ${year - 1}`, align: "right", render: r => z(r.exwPrev, "EUR") }, { key: "fobPrev", header: `FOB $ ${year - 1}`, align: "right", render: r => z(r.fobPrev, "USD") }]} />
      </Section>
      <Section title="Recent activity">
        <DataTable dense rows={activity} empty="No changes yet. Everything you change is logged here."
          cols={[{ key: "changed_at", header: "When", render: a => String(a.changed_at).slice(0, 16).replace("T", " ") },
            { key: "action", header: "Action", render: a => ({ INSERT: "Added", UPDATE: "Changed", DELETE: "Removed" } as any)[a.action] },
            { key: "table_name", header: "What", render: a => String(a.table_name).replace(/_/g, " ") },
            { key: "detail", header: "Detail", render: a => { const d = a.new_data ?? a.old_data ?? {}; return d.pi_number ?? d.po_number ?? d.name ?? d.reference ?? d.invoice_number ?? d.batch_number ?? ""; } }]} />
      </Section>
    </div>
  </>;
}

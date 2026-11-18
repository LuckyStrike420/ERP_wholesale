/**
 * Insight on customers and targets:
 * - Customer health (v_customer_health): paying, trend and activity in green / amber / red; the worst signal is the score.
 *   Limits: Admin → Settings (health_*).
 * - Reorder rhythm (v_reorder_patterns): how often a customer orders a product and when the next order is expected.
 *   The automation rule "Reorder overdue" makes a task once it is late.
 * - Targets (targets, v_target_progress): revenue and margin target per month in the reporting currency, against booked.
 * Blocks for the customer page, a list for /customers/health, dashboard widgets and the target editor.
 */
import { useState, type ReactNode } from "react";
import { useApp, useRows } from "@/app/store";
import { Link } from "@/app/router";
import { customerPath } from "@/app/paths";
import { DataTable, KV, Pill, Section } from "@/app/ui";
import { date, money, monthName, pct, qty } from "@/app/format";
import { useCan } from "@/app/permissions";
import { cn } from "@/lib/utils";
import { Card } from "@/modules/dashboard/widgets";

export const SCORE_TONE: Record<string, string> = { green: "green", amber: "amber", red: "red" };
const SCORE_LABEL: Record<string, string> = { green: "Healthy", amber: "Watch", red: "At risk" };
const DOT: Record<string, string> = { green: "bg-emerald-500", amber: "bg-amber-400", red: "bg-rose-500" };

export function HealthDot({ score, label }: { score?: string | null; label?: boolean }) {
  if (!score) return <span className="text-xs text-gray-400">{label ? "not enough data" : "–"}</span>;
  return <span className="inline-flex items-center gap-1.5" title={SCORE_LABEL[score]}>
    <span className={cn("h-2.5 w-2.5 rounded-full", DOT[score])} />{label && <span className="text-sm text-gray-700">{SCORE_LABEL[score]}</span>}</span>;
}

const signal = (s: string | null | undefined, text: ReactNode, why: string) => [<span className="flex items-center gap-2"><HealthDot score={s} />{why}</span>, text] as [ReactNode, ReactNode];

/** the health block on a customer page */
export function CustomerHealth({ customerId }: { customerId: string }) {
  const h = useRows("v_customer_health", { eq: { customer_id: customerId } }).rows[0];
  const settings = useRows("app_settings").rows; const costs = useCan()("see_costs");
  const set = (k: string) => settings.find(x => x.key === k)?.value;
  if (!h) return <Section title="Health"><p className="px-5 py-6 text-sm text-gray-500">Loading…</p></Section>;
  const cur = h.currency;
  return <Section title={<span className="flex items-center gap-3">Health <HealthDot score={h.score} label /></span>}
    sub="The worst of the three signals. Limits under Admin → Settings (customer health).">
    <KV items={[
      signal(h.pay_score, h.avg_days_late == null ? "no balance due in the last 2 years" : <>{h.avg_days_late} days late on average · {h.late_orders} of {h.judged_orders} order(s) late{Number(h.overdue_reporting) > 0 ? ` · ${money(h.overdue_reporting, cur, 0)} overdue now` : ""}</>,
        "Paying"),
      signal(h.trend_score, h.trend_ratio == null ? (Number(h.revenue_12m) ? `${money(h.revenue_12m, cur, 0)} last 12 months; nothing the 12 months before` : "no revenue yet") :
        <>{money(h.revenue_12m, cur, 0)} last 12 months · {pct(h.trend_ratio, 0)} of the 12 months before ({money(h.revenue_prev_12m, cur, 0)})</>, "Trend"),
      signal(h.activity_score, !h.last_order ? "no orders yet" : h.usual_days == null ? `last order ${date(h.last_order)} (one order: no rhythm yet)` :
        <>last order {date(h.last_order)}, {h.days_since_last_order} days ago · usually every {h.usual_days} days</>, "Activity"),
      ...(costs ? [["Margin, last 12 months", h.margin_pct_12m == null ? "–" : pct(h.margin_pct_12m, 1)] as [ReactNode, ReactNode]] : []),
    ]} />
    <p className="border-t border-gray-100 px-5 py-2.5 text-xs text-gray-500">Green paying ≤ {set("health_late_green_days")} days late, amber ≤ {set("health_late_amber_days")}. Green trend ≥ {set("health_trend_green_pct")}%, amber ≥ {set("health_trend_amber_pct")}%. Activity amber after {set("health_quiet_amber_factor")}×, red after {set("health_quiet_red_factor")}× the usual time between orders. Amounts in {cur}.{h.fx_rate_missing ? " An exchange rate is missing (Admin → Exchange rates), so the revenue in " + cur + " is incomplete." : ""}</p>
  </Section>;
}

/** the reorder rhythm of one customer */
export function CustomerReorders({ customerId }: { customerId: string }) {
  const rows = useRows("v_reorder_patterns", { eq: { customer_id: customerId } }).rows.filter(r => r.orders >= 2)
    .sort((a, b) => String(a.expected_next).localeCompare(String(b.expected_next)));
  return <Section title="Reorder rhythm" sub="Products ordered at least twice: the average time between orders and when the next one is expected.">
    <DataTable dense rows={rows.map(r => ({ ...r, id: r.product_id }))} empty="No product ordered twice yet" cols={[
      { key: "product_name", header: "Product", render: r => <span className="font-medium text-gray-900">{r.product_name}</span> },
      { key: "orders", header: "Orders", align: "right" },
      { key: "usual_days", header: "Every", align: "right", render: r => `${r.usual_days} days` },
      { key: "usual_qty", header: "Usually", align: "right", render: r => `${qty(r.usual_qty)} pcs` },
      { key: "last_order", header: "Last order", render: r => date(r.last_order) },
      { key: "expected_next", header: "Next expected", render: r => <ReorderWhen r={r} /> }]} />
  </Section>;
}
export function ReorderWhen({ r }: { r: any }) {
  const late = Number(r.days_overdue);
  return <span className="inline-flex items-center gap-2">{date(r.expected_next)}
    {r.draft_open ? <Pill tone="blue">draft open</Pill> : late > 0 ? <Pill tone="red">{late} days late</Pill> : late > -14 ? <Pill tone="amber">in {-late} days</Pill> : null}</span>;
}

// ---------------- dashboard widgets ----------------
export function ReordersWidget({ customer }: { customer?: string | null }) {
  const rows = useRows("v_reorder_patterns").rows.filter(r => r.orders >= 2 && !r.draft_open && (!customer || r.customer_id === customer) && Number(r.days_overdue) > -30)
    .sort((a, b) => Number(b.days_overdue) - Number(a.days_overdue)).slice(0, 7);
  return <Card title="Reorders due" action={<Link to="/customers/health" className="text-xs font-medium text-indigo-600 hover:underline">All customers</Link>}>
    {!rows.length ? <p className="py-6 text-center text-sm text-gray-500">No reorder expected in the next 30 days.</p> :
      <ul className="-mx-2 divide-y divide-gray-100">{rows.map(r => <li key={r.customer_id + r.product_id}>
        <Link to={customerPath({ name: r.customer_name })} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-gray-50">
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-gray-900">{r.customer_name}</div>
            <div className="truncate text-xs text-gray-500">{r.product_name} · every {r.usual_days} days · ~{qty(r.usual_qty)} pcs</div></div>
          <div className="text-right text-xs"><ReorderWhen r={r} /></div>
        </Link></li>)}</ul>}
  </Card>;
}

export function HealthWidget({ customer }: { customer?: string | null }) {
  const rows = useRows("v_customer_health").rows.filter(h => h.score && (!customer || h.customer_id === customer));
  const count = (s: string) => rows.filter(h => h.score === s).length;
  const worst = rows.filter(h => h.score !== "green").sort((a, b) => (a.score === "red" ? 0 : 1) - (b.score === "red" ? 0 : 1)).slice(0, 6);
  return <Card title="Customer health" action={<Link to="/customers/health" className="text-xs font-medium text-indigo-600 hover:underline">View all</Link>}>
    <div className="mb-3 flex gap-4 text-sm">{(["green", "amber", "red"] as const).map(s => <span key={s} className="inline-flex items-center gap-1.5"><HealthDot score={s} /><b className="tabular-nums">{count(s)}</b><span className="text-gray-500">{SCORE_LABEL[s].toLowerCase()}</span></span>)}</div>
    {!worst.length ? <p className="py-4 text-center text-sm text-gray-500">{rows.length ? "Every customer is healthy." : "Not enough data yet."}</p> :
      <ul className="-mx-2 divide-y divide-gray-100">{worst.map(h => <li key={h.customer_id}>
        <Link to={customerPath({ name: h.customer_name })} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-gray-50">
          <HealthDot score={h.score} /><span className="min-w-0 flex-1 truncate text-sm text-gray-900">{h.customer_name}</span>
          <span className="text-xs text-gray-500">{[h.pay_score && h.pay_score !== "green" && `${h.avg_days_late}d late`, h.trend_score && h.trend_score !== "green" && `trend ${pct(h.trend_ratio, 0)}`, h.activity_score && h.activity_score !== "green" && `quiet ${h.days_since_last_order}d`].filter(Boolean).join(" · ")}</span>
        </Link></li>)}</ul>}
  </Card>;
}

export function TargetsWidget({ year }: { year: number }) {
  const rows = useRows("v_target_progress", { eq: { year } }).rows; const costs = useCan()("see_costs");
  const cur = rows[0]?.currency ?? "EUR"; const now = new Date(); const m = now.getFullYear() === year ? now.getMonth() + 1 : 12;
  const month = rows.find(r => r.month === m); const ytd = rows.filter(r => r.month <= m);
  const sum = (k: string, xs = ytd) => xs.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const hasTargets = rows.some(r => r.revenue_target != null);
  return <Card title={`Targets ${year}`} action={<Link to={`/reports/forecast?year=${year}`} className="text-xs font-medium text-indigo-600 hover:underline">{hasTargets ? "Details" : "Set targets"}</Link>}>
    {!hasTargets ? <p className="py-6 text-center text-sm text-gray-500">No targets set for {year} yet.</p> : <div className="space-y-4 pt-1">
      <Bar label={now.getFullYear() === year ? `${monthName(m)} so far` : "December"} actual={Number(month?.revenue_actual ?? 0)} target={month?.revenue_target} cur={cur} />
      <Bar label="Year to date" actual={sum("revenue_actual")} target={ytd.some(r => r.revenue_target != null) ? sum("revenue_target") : null} cur={cur} />
      {costs && rows.some(r => r.margin_target != null) && <Bar label="Margin, year to date" actual={sum("margin_actual")} target={sum("margin_target")} cur={cur} />}
      <Bar label={`Full year ${year}`} actual={sum("revenue_actual", rows)} target={sum("revenue_target", rows)} cur={cur} />
      <p className="text-xs text-gray-400">In {cur}; other currencies at the exchange rate. Company-wide, not filtered.</p>
    </div>}
  </Card>;
}
function Bar({ label, actual, target, cur }: { label: string; actual: number; target: any; cur: string }) {
  const t = target == null ? null : Number(target); const share = t ? actual / t : null;
  return <div>
    <div className="mb-1 flex items-baseline justify-between text-xs"><span className="text-gray-600">{label}</span>
      <span className="tabular-nums"><b className="text-gray-900">{money(actual, cur, 0)}</b>{t != null && <span className="text-gray-500"> of {money(t, cur, 0)}{share != null && ` · ${pct(share, 0)}`}</span>}</span></div>
    <div className="h-2 rounded-full bg-gray-100"><div className={cn("h-2 rounded-full", share == null ? "bg-gray-300" : share >= 1 ? "bg-emerald-500" : share >= 0.75 ? "bg-indigo-500" : "bg-amber-400")}
      style={{ width: `${Math.min(100, (share ?? 0) * 100)}%` }} /></div>
  </div>;
}

// ---------------- targets editor (Reports → Revenue forecast) ----------------
export function TargetEditor({ year }: { year: number }) {
  const { db, run, refresh, session } = useApp(); const costs = useCan()("see_costs");
  const rows = useRows("v_target_progress", { eq: { year } }).rows; const cur = rows[0]?.currency ?? "EUR";
  const canEdit = session?.role === "admin" || session?.role === "finance" || !session?.role;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const val = (m: number, k: "revenue" | "margin") => draft[`${m}${k}`] ?? (rows.find(r => r.month === m)?.[`${k}_target`] ?? "");
  const save = (m: number, k: "revenue" | "margin", v: string) => {
    const n = v.trim() === "" ? null : Number(v.replace(/\./g, "").replace(",", "."));
    if (n != null && !Number.isFinite(n)) return;
    const row = rows.find(r => r.month === m);
    if (String(row?.[`${k}_target`] ?? "") === String(n ?? "")) return;
    run(async () => {
      const exists = row && (row.revenue_target != null || row.margin_target != null);
      if (exists) await db.update("targets", { year, month: m }, { [k]: n }); else await db.insert("targets", { year, month: m, [k]: n });
      setDraft(d => { const x = { ...d }; delete x[`${m}${k}`]; return x; }); refresh();
    }, `Target ${monthName(m)} saved`);
  };
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const r = (m: number) => rows.find(x => x.month === m);
  const tot = (k: string) => months.reduce((a, m) => a + Number(r(m)?.[k] ?? 0), 0);
  const input = (m: number, k: "revenue" | "margin") => <input aria-label={`${k} target ${monthName(m)}`} inputMode="decimal" disabled={!canEdit} value={val(m, k)}
    onChange={e => setDraft(d => ({ ...d, [`${m}${k}`]: e.target.value }))} onBlur={e => save(m, k, e.target.value)} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    placeholder="–" className="h-8 w-28 rounded-md border border-gray-200 bg-white px-2 text-right text-sm tabular-nums focus:border-indigo-400 focus:outline-none disabled:bg-gray-50" />;
  const ach = (a: any) => a == null ? <span className="text-gray-400">–</span> : <span className={cn("font-medium", Number(a) >= 1 ? "text-emerald-700" : Number(a) >= 0.75 ? "text-gray-900" : "text-amber-700")}>{pct(a, 0)}</span>;
  return <Section title={`Targets ${year} · ${cur}`} sub={`Type a target and press Enter. Booked = PIs sent by PO date, every currency converted to ${cur} at the exchange rate.${canEdit ? "" : " Only admin and finance can change targets."}`} className="mb-6">
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
        <th className="px-5 py-2.5">Month</th><th className="px-3 py-2.5 text-right">Revenue target</th><th className="px-3 py-2.5 text-right">Booked</th><th className="px-3 py-2.5 text-right">Reached</th>
        {costs && <><th className="px-3 py-2.5 text-right">Margin target</th><th className="px-3 py-2.5 text-right">Margin booked</th><th className="px-3 py-2.5 text-right">Reached</th></>}
      </tr></thead>
      <tbody className="divide-y divide-gray-100">{months.map(m => <tr key={m}>
        <td className="px-5 py-1.5 text-gray-900">{monthName(m)}</td>
        <td className="px-3 py-1.5 text-right">{input(m, "revenue")}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{money(r(m)?.revenue_actual ?? 0, cur, 0)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{ach(r(m)?.revenue_achieved)}</td>
        {costs && <><td className="px-3 py-1.5 text-right">{input(m, "margin")}</td>
          <td className="px-3 py-1.5 text-right tabular-nums">{money(r(m)?.margin_actual ?? 0, cur, 0)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums">{ach(r(m)?.margin_achieved)}</td></>}
      </tr>)}
        <tr className="border-t-2 border-gray-200 font-semibold"><td className="px-5 py-2.5">Year</td>
          <td className="px-3 py-2.5 text-right tabular-nums">{money(tot("revenue_target"), cur, 0)}</td><td className="px-3 py-2.5 text-right tabular-nums">{money(tot("revenue_actual"), cur, 0)}</td>
          <td className="px-3 py-2.5 text-right tabular-nums">{ach(tot("revenue_target") ? tot("revenue_actual") / tot("revenue_target") : null)}</td>
          {costs && <><td className="px-3 py-2.5 text-right tabular-nums">{money(tot("margin_target"), cur, 0)}</td><td className="px-3 py-2.5 text-right tabular-nums">{money(tot("margin_actual"), cur, 0)}</td>
            <td className="px-3 py-2.5 text-right tabular-nums">{ach(tot("margin_target") ? tot("margin_actual") / tot("margin_target") : null)}</td></>}</tr>
      </tbody></table></div>
    {rows.some(x => x.fx_rate_missing) && <p className="border-t border-gray-100 px-5 py-2.5 text-xs text-amber-700">Some months miss an exchange rate: add it under Admin → Exchange rates.</p>}
  </Section>;
}

// ---------------- all customers: health and reorders (/customers/health) ----------------
export function CustomersHealth() {
  const rows = useRows("v_customer_health", { order: [["customer_name", "asc"]] }).rows; const costs = useCan()("see_costs");
  const re = useRows("v_reorder_patterns").rows.filter(r => r.orders >= 2);
  const rank: Record<string, number> = { red: 0, amber: 1, green: 2 };
  const sorted = [...rows].sort((a, b) => (rank[a.score] ?? 3) - (rank[b.score] ?? 3) || String(a.customer_name).localeCompare(b.customer_name));
  return <>
    <Section title="Customer health" sub="Paying, trend and activity per customer; the worst signal is the score. Limits under Admin → Settings." className="mb-6">
      <DataTable rows={sorted.map(h => ({ ...h, id: h.customer_id }))} rowTo={h => customerPath({ name: h.customer_name })} search exportName="customer-health" cols={[
        { key: "score", header: "", width: "2rem", render: h => <HealthDot score={h.score} /> },
        { key: "customer_name", header: "Customer", render: h => <span className="font-medium text-gray-900">{h.customer_name}</span> },
        { key: "pay", header: "Paying", value: h => h.avg_days_late, render: h => <span className="inline-flex items-center gap-1.5"><HealthDot score={h.pay_score} />{h.avg_days_late != null ? `${h.avg_days_late}d late avg` : ""}</span> },
        { key: "trend", header: "Trend", value: h => h.trend_ratio, render: h => <span className="inline-flex items-center gap-1.5"><HealthDot score={h.trend_score} />{h.trend_ratio != null ? pct(h.trend_ratio, 0) : ""}</span> },
        { key: "activity", header: "Activity", value: h => h.days_since_last_order, render: h => <span className="inline-flex items-center gap-1.5"><HealthDot score={h.activity_score} />{h.last_order ? `${h.days_since_last_order}d ago${h.usual_days ? ` (every ${h.usual_days}d)` : ""}` : ""}</span> },
        { key: "revenue_12m", header: "Revenue 12m", align: "right", render: h => money(h.revenue_12m ?? 0, h.currency, 0) },
        ...(costs ? [{ key: "margin_pct_12m", header: "Margin 12m", align: "right" as const, render: (h: any) => h.margin_pct_12m == null ? "–" : pct(h.margin_pct_12m, 1) }] : []),
        { key: "overdue_reporting", header: "Overdue now", align: "right", render: h => Number(h.overdue_reporting) ? <span className="text-rose-600">{money(h.overdue_reporting, h.currency, 0)}</span> : <span className="text-gray-400">–</span> }]} />
    </Section>
    <Section title="Reorder rhythm" sub="Every customer and product ordered at least twice, the latest first. The automation rule “Reorder overdue” makes a task once it is late.">
      <DataTable rows={[...re].sort((a, b) => Number(b.days_overdue) - Number(a.days_overdue)).map(r => ({ ...r, id: r.customer_id + r.product_id }))} search exportName="reorders"
        rowTo={r => customerPath({ name: r.customer_name })} cols={[
        { key: "customer_name", header: "Customer", render: r => <span className="font-medium text-gray-900">{r.customer_name}</span> },
        { key: "product_name", header: "Product" }, { key: "orders", header: "Orders", align: "right" },
        { key: "usual_days", header: "Every", align: "right", render: r => `${r.usual_days} days` },
        { key: "usual_qty", header: "Usually", align: "right", render: r => `${qty(r.usual_qty)} pcs` },
        { key: "last_order", header: "Last order", render: r => date(r.last_order) },
        { key: "expected_next", header: "Next expected", render: r => <ReorderWhen r={r} /> }]} />
    </Section>
  </>;
}

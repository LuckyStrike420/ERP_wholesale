/**
 * Forecasts: revenue per month (/reports/forecast) and cash per week (/reports/cash-flow).
 * Revenue: months that have passed show what was booked (PO date, PIs sent); months to come show a projection
 * (the average of the last complete months, you choose how many) and the drafts already planned in that month.
 * Cash: every open customer and supplier amount by its due date, per week, with the running balance from a start
 * balance you type in. Overdue and undated amounts are shown apart. EUR and USD are never added together.
 */
import { useMemo, useState } from "react";
import { useRows } from "@/app/store";
import { useNav, useQuery, usePath } from "@/app/router";
import { orderPath, poPath } from "@/app/paths";
import { DataTable, Notice, Section, selectClass } from "@/app/ui";
import { date, money, monthName } from "@/app/format";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ReportChart } from "./ReportChart";

const CURS = ["EUR", "USD"];
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

// ---------------- revenue per month ----------------
export function RevenueForecast() {
  const q = useQuery(); const nav = useNav(); const path = usePath();
  const set = (k: string, v: string) => { const n = new URLSearchParams(q); n.set(k, v); nav(`${path}?${n}`, { replace: true }); };
  const now = new Date(); const thisYear = now.getFullYear(); const thisMonth = now.getMonth() + 1;
  const year = Number(q.get("year") ?? thisYear); const basis = Number(q.get("basis") ?? 3);
  const monthly = useRows("v_revenue_monthly").rows;
  const drafts = useRows("v_orders", { eq: { status: "draft" } }).rows;
  const years = [...new Set([thisYear, thisYear + 1, ...monthly.map(r => r.year)])].sort((a, b) => b - a);

  const per = useMemo(() => CURS.map(cur => {
    const actual = (y: number, m: number) => monthly.filter(r => r.currency === cur && r.year === y && r.month === m).reduce((a, r) => a + Number(r.revenue), 0);
    // the last `basis` complete months before this month
    const past = Array.from({ length: basis }, (_, i) => { const d = new Date(thisYear, thisMonth - 2 - i, 1); return actual(d.getFullYear(), d.getMonth() + 1); });
    const run = past.reduce((a, v) => a + v, 0) / Math.max(1, basis);
    const rows = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1; const key = ym(year, m); const done = year < thisYear || (year === thisYear && m < thisMonth); const current = year === thisYear && m === thisMonth;
      const a = actual(year, m); const pipe = drafts.filter(o => o.currency === cur && String(o.po_date ?? "").slice(0, 7) === key).reduce((s, o) => s + Number(o.order_value), 0);
      const projected = done ? null : current ? Math.max(run, a) : run;
      return { id: key, month: m, actual: done || current ? a : null, projected, pipeline: pipe, expected: done ? a : Math.max(projected ?? 0, a) };
    });
    return { cur, run, rows, total: rows.reduce((s, r) => s + r.expected, 0), booked: rows.reduce((s, r) => s + (r.actual ?? 0), 0), pipeline: rows.reduce((s, r) => s + r.pipeline, 0) };
  }).filter(p => p.rows.some(r => r.expected || r.pipeline) || p.run), [monthly, drafts, year, basis, thisYear, thisMonth]);

  return <>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <select aria-label="Year" className={selectClass + " w-24"} value={year} onChange={e => set("year", e.target.value)}>{years.map(y => <option key={y}>{y}</option>)}</select>
      <select aria-label="Projection basis" className={selectClass} value={basis} onChange={e => set("basis", e.target.value)}>
        {[3, 6, 12].map(n => <option key={n} value={n}>Projection: average of the last {n} months</option>)}</select>
    </div>
    {!per.length && <Notice tone="gray">No revenue yet to base a forecast on.</Notice>}
    {per.map(p => <Section key={p.cur} title={`Revenue ${year} · ${p.cur}`} sub={`Booked by PO date (PIs sent); months to come at ${money(p.run, p.cur, 0)} per month, the average of the last ${basis} complete months.`} className="mb-6">
      <div className="grid gap-3 px-5 pt-4 sm:grid-cols-3">
        <Tile label="Booked so far" value={money(p.booked, p.cur, 0)} />
        <Tile label="Expected for the year" value={money(p.total, p.cur, 0)} hint="booked + projection" />
        <Tile label="Drafts planned" value={money(p.pipeline, p.cur, 0)} hint="not in the projection" />
      </div>
      <div className="px-5 pt-4">
        <ReportChart kind="bar" type="money" currency={p.cur} height={220} label={`Revenue ${year} in ${p.cur}, booked and projected`}
          data={p.rows.map(r => ({ x: monthName(r.month).slice(0, 3), y: r.expected, light: r.actual == null || r.expected > r.actual + 0.005 }))} />
        <div className="mt-1 flex gap-4 text-xs text-gray-500"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-indigo-600" />Booked</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-indigo-200" />Projected</span></div>
      </div>
      <DataTable dense rows={p.rows} exportName={`revenue-forecast-${year}-${p.cur}`} cols={[
        { key: "month", header: "Month", render: r => monthName(r.month) },
        { key: "actual", header: "Booked", align: "right", render: r => r.actual == null ? <span className="text-gray-400">–</span> : money(r.actual, p.cur, 0) },
        { key: "projected", header: "Projected", align: "right", render: r => r.projected == null ? <span className="text-gray-400">–</span> : <span className="text-gray-500">{money(r.projected, p.cur, 0)}</span> },
        { key: "expected", header: "Expected", align: "right", render: r => <span className="font-medium text-gray-900">{money(r.expected, p.cur, 0)}</span> },
        { key: "pipeline", header: "Drafts", align: "right", render: r => r.pipeline ? money(r.pipeline, p.cur, 0) : <span className="text-gray-400">–</span> }]} />
    </Section>)}
  </>;
}

// ---------------- cash per week ----------------
const monday = (d: Date) => { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - day); return x; };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const weekNo = (d: Date) => { const t = new Date(d); t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); const w1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t.getTime() - w1.getTime()) / 864e5 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7); };
const START_KEY = "yp.cash.start.v1";

export function CashWeekly({ pick }: { pick: <T extends Record<string, any>>(rows: T[]) => T[] }) {
  const q = useQuery(); const nav = useNav(); const path = usePath();
  const weeks = Number(q.get("weeks") ?? 12);
  const flows = useRows("v_cash_flow", { order: [["due_date", "asc"]] }).rows;
  const [start, setStart] = useState<Record<string, string>>(() => { try { return JSON.parse(localStorage.getItem(START_KEY) ?? "{}"); } catch { return {}; } });
  const saveStart = (cur: string, v: string) => { const n = { ...start, [cur]: v }; setStart(n); try { localStorage.setItem(START_KEY, JSON.stringify(n)); } catch { /* not kept */ } };
  const first = monday(new Date());

  const per = useMemo(() => [...new Set(pick(flows).map(f => f.currency))].sort().map(cur => {
    const f = pick(flows).filter(x => x.currency === cur);
    const sum = (xs: any[], dir: string) => xs.filter(x => x.direction === dir).reduce((a, x) => a + Number(x.amount), 0);
    const overdue = f.filter(x => x.due_date && x.due_date < iso(first)); const undated = f.filter(x => !x.due_date);
    let bal = Number(String(start[cur] ?? "").replace(",", ".")) || 0;
    bal += sum(overdue, "in") - sum(overdue, "out");
    const rows = Array.from({ length: weeks }, (_, i) => {
      const from = new Date(first); from.setUTCDate(from.getUTCDate() + 7 * i); const to = new Date(from); to.setUTCDate(to.getUTCDate() + 6);
      const xs = f.filter(x => x.due_date && x.due_date >= iso(from) && x.due_date <= iso(to));
      const inn = sum(xs, "in"), out = sum(xs, "out"); bal += inn - out;
      return { id: iso(from), label: `W${weekNo(from)}`, from: iso(from), to: iso(to), inn, out, net: inn - out, balance: bal, items: xs };
    });
    const later = f.filter(x => x.due_date && x.due_date > rows[rows.length - 1].to);
    return { cur, rows, overdue: { inn: sum(overdue, "in"), out: sum(overdue, "out"), n: overdue.length }, undated: { inn: sum(undated, "in"), out: sum(undated, "out"), n: undated.length },
      later: { inn: sum(later, "in"), out: sum(later, "out") }, lowest: rows.reduce((m, r) => Math.min(m, r.balance), Infinity) };
  }), [flows, pick, weeks, start, first.getTime()]);   // eslint-disable-line react-hooks/exhaustive-deps

  const [open, setOpen] = useState<string | null>(null);
  return <>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <select aria-label="Weeks ahead" className={selectClass} value={weeks} onChange={e => { const n = new URLSearchParams(q); n.set("weeks", e.target.value); nav(`${path}?${n}`, { replace: true }); }}>
        {[8, 12, 26].map(n => <option key={n} value={n}>Next {n} weeks</option>)}</select>
    </div>
    {per.map(p => <Section key={p.cur} className="mb-6" title={`Cash per week · ${p.cur}`} sub="Open customer amounts (in) and supplier amounts (out) by due date. Overdue amounts count in the first week.">
      <div className="grid gap-3 px-5 pt-4 sm:grid-cols-4">
        <label className="rounded-lg bg-gray-50 px-3 py-2.5"><div className="text-xs text-gray-500">Start balance {p.cur} (you type it)</div>
          <Input aria-label={`Start balance ${p.cur}`} inputMode="decimal" value={start[p.cur] ?? ""} onChange={e => saveStart(p.cur, e.target.value)} placeholder="0" className="mt-1 h-8 border-gray-300 bg-white" /></label>
        <Tile label="Overdue, counted in week 1" value={`+${money(p.overdue.inn, p.cur, 0)} / −${money(p.overdue.out, p.cur, 0)}`} tone={p.overdue.n ? "warn" : undefined} hint={`${p.overdue.n} amount(s)`} />
        <Tile label="Lowest balance" value={money(p.lowest, p.cur, 0)} tone={p.lowest < 0 ? "bad" : undefined} hint={p.lowest < 0 ? "goes below zero" : undefined} />
        <Tile label="No due date (not in the weeks)" value={`+${money(p.undated.inn, p.cur, 0)} / −${money(p.undated.out, p.cur, 0)}`} tone={p.undated.n ? "warn" : undefined} hint={`${p.undated.n} amount(s)`} />
      </div>
      <div className="grid gap-4 px-5 pt-4 lg:grid-cols-2">
        <div><div className="mb-1 text-xs font-medium text-gray-500">Net per week (in − out)</div>
          <ReportChart kind="bar" type="money" currency={p.cur} height={200} label={`Net cash per week in ${p.cur}`} data={p.rows.map(r => ({ x: r.label, y: r.net }))} /></div>
        <div><div className="mb-1 text-xs font-medium text-gray-500">Balance at the end of the week</div>
          <ReportChart kind="line" type="money" currency={p.cur} height={200} label={`Cash balance per week in ${p.cur}`} data={p.rows.map(r => ({ x: r.label, y: r.balance }))} /></div>
      </div>
      <DataTable dense rows={p.rows} exportName={`cash-per-week-${p.cur}`} onRow={r => setOpen(open === `${p.cur}${r.id}` ? null : `${p.cur}${r.id}`)} cols={[
        { key: "label", header: "Week", render: r => <span><span className="font-medium text-gray-900">{r.label}</span> <span className="text-xs text-gray-500">{date(r.from)} – {date(r.to)}</span></span> },
        { key: "inn", header: "In", align: "right", render: r => r.inn ? <span className="text-emerald-700">+{money(r.inn, p.cur, 0)}</span> : <span className="text-gray-400">–</span> },
        { key: "out", header: "Out", align: "right", render: r => r.out ? <span className="text-gray-900">−{money(r.out, p.cur, 0)}</span> : <span className="text-gray-400">–</span> },
        { key: "net", header: "Net", align: "right", render: r => money(r.net, p.cur, 0) },
        { key: "balance", header: "Balance", align: "right", render: r => <span className={cn("font-medium", r.balance < 0 ? "text-rose-600" : "text-gray-900")}>{money(r.balance, p.cur, 0)}</span> },
        { key: "items", header: "", render: r => r.items.length ? <span className="text-xs text-indigo-600">{r.items.length} item(s) {open === `${p.cur}${r.id}` ? "▴" : "▾"}</span> : null }]} />
      {p.rows.filter(r => open === `${p.cur}${r.id}`).map(r => <ul key={r.id} className="divide-y divide-gray-100 border-t border-gray-100 bg-gray-50/60 text-sm">
        {r.items.map((x: any, i: number) => <li key={i} className="flex items-center justify-between gap-4 px-5 py-2">
          <a href={"#"} onClick={e => { e.preventDefault(); nav(x.direction === "in" ? orderPath({ pi_number: x.reference, id: x.order_id }) : poPath({ po_number: x.reference })); }} className="text-gray-700 hover:text-indigo-600">
            {date(x.due_date)} · {x.direction === "in" ? `PI ${x.reference}` : `PO ${x.reference}`} · {x.party} · {x.part}</a>
          <span className={cn("tabular-nums", x.direction === "in" ? "text-emerald-700" : "text-gray-900")}>{x.direction === "in" ? "+" : "−"}{money(x.amount, p.cur, 2)}</span></li>)}
      </ul>)}
      {(p.later.inn || p.later.out) ? <p className="border-t border-gray-100 px-5 py-2.5 text-xs text-gray-500">After these weeks: +{money(p.later.inn, p.cur, 0)} in, −{money(p.later.out, p.cur, 0)} out.</p> : null}
    </Section>)}
  </>;
}

const Tile = ({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" | "warn" }) =>
  <div className="rounded-lg bg-gray-50 px-3 py-2.5"><div className="text-xs text-gray-500">{label}</div>
    <div className={cn("text-lg font-semibold tabular-nums", tone === "bad" ? "text-rose-600" : tone === "warn" ? "text-amber-700" : "text-gray-900")}>{value}</div>
    {hint && <div className={cn("text-xs", tone === "bad" ? "text-rose-600" : "text-gray-500")}>{hint}</div>}</div>;

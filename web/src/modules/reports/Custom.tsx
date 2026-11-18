/**
 * Your own reports: /reports/custom (list), /reports/custom/new, /reports/custom/1a2b3c4d (build and view).
 * Choose a source, the columns, filters, and optionally a grouping with totals and a chart.
 * A report can be shared (read-only for colleagues) and put on the dashboard as a widget.
 */
import { useMemo, useState, type ReactNode } from "react";
import { BarChart3, Copy, LineChart, List, Plus, Table2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApp, useRows } from "@/app/store";
import { Link, useNav, useParams } from "@/app/router";
import { byShort } from "@/app/paths";
import { ConfirmDialog, DataTable, LinkButton, Loading, NotFound, PageHeader, Pill, Section, selectClass, type Col } from "@/app/ui";
import { date, dateShort, money, pct, qty } from "@/app/format";
import { toast } from "@/app/notify";
import { cn } from "@/lib/utils";
import { AGG_LABEL, blankDef, fieldOf, OPS, runReport, SOURCES, sourceOf, type Agg, type Field, type Filter, type ReportDef, type Result } from "./engine";
import { ReportChart } from "./ReportChart";
import { useCan } from "@/app/permissions";
import { Card } from "@/modules/dashboard/widgets";

/** without "See costs and margins": cost, margin and purchase fields are left out (and purchase orders as a source) */
const COST = /cost|margin|purchase|payable/;
const forRole = (def: ReportDef, costs: boolean): ReportDef => costs ? def : {
  ...def, columns: def.columns.filter(k => !COST.test(k)), measures: def.measures.filter(m => m.agg === "count" || !COST.test(m.field)),
  group: def.group && COST.test(def.group) ? null : def.group, filters: def.filters.filter(f => !COST.test(f.field)) };

export const reportPath = (r: { id: string }) => `/reports/custom/${String(r.id).slice(0, 8)}`;

/** the rows of a source, with names filled in where the view only has ids */
export function useSourceRows(sourceId: string) {
  const s = sourceOf(sourceId);
  const q = useRows(s.view);
  const products = useRows(sourceId === "order_lines" ? "products" : null).rows;
  const customers = useRows(sourceId === "order_lines" ? "customers" : null).rows;
  const rows = useMemo(() => sourceId !== "order_lines" ? q.rows : q.rows.map(r => ({ ...r,
    product_name: products.find(p => p.id === r.product_id)?.name, customer_name: customers.find(c => c.id === r.customer_id)?.name })), [q.rows, products, customers, sourceId]);
  return { rows, loading: q.loading };
}

const cell = (v: any, type: string, cur?: string | null, f?: Field): ReactNode => {
  if (v === null || v === undefined || v === "") return <span className="text-gray-400">–</span>;
  if (type === "money") return money(v, cur ?? "EUR");
  if (type === "pct") return pct(v, 1);
  if (type === "number") return qty(Math.round(Number(v) * 100) / 100);
  if (type === "date") return date(v);
  return f?.labels?.[v] ?? String(v);
};

/** the result as a chart (when grouped and asked for) and a table */
export function ReportResult({ def, result, compact }: { def: ReportDef; result: Result; compact?: boolean }) {
  const s = sourceOf(def.source);
  const cols: Col[] = result.columns.map(c => ({ key: c.key, header: c.label, align: ["money", "number", "pct"].includes(c.type) ? "right" : undefined,
    render: (r: any) => c.type === "group" ? <span className="font-medium text-gray-900">{r._group}</span> : cell(r[c.key], c.type, result.grouped ? r._currency : s.currency ? r[s.currency] : null, fieldOf(s, c.key)) }));
  const chartable = result.grouped && def.chart && def.chart !== "none" && result.rows.length > 0;
  const m0 = result.columns.find(c => c.key === "m0");
  const charts = !chartable ? [] : (result.currencies.length ? result.currencies : [null]).map(cur => ({
    cur, data: result.rows.filter(r => !cur || r._currency === cur).map(r => ({ x: r._group, y: r.m0 == null ? null : Number(r.m0) })) }));
  return <div className="space-y-4">
    {charts.length > 0 && <div className={cn("grid min-w-0 grid-cols-1 gap-4", !compact && charts.length > 1 && "lg:grid-cols-2")}>
      {charts.map(c => <div key={c.cur ?? "all"} className={compact ? "min-w-0" : "min-w-0 rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm"}>
        <div className="mb-2 text-xs font-medium text-gray-500">{m0?.label}{c.cur ? ` · ${c.cur}` : ""}</div>
        <ReportChart data={c.data.slice(0, compact ? 12 : 40)} kind={def.chart as "bar" | "line"} type={m0?.type as any} currency={c.cur} label={`${m0?.label}${c.cur ? ` in ${c.cur}` : ""}`} height={compact ? 170 : 240} />
      </div>)}
    </div>}
    {(!compact || !charts.length) && <div className={compact ? "-mx-5" : "overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-sm"}>
      <DataTable rows={compact ? result.rows.slice(0, 8) : result.rows} cols={cols} dense exportName={compact ? undefined : "report"} search={!compact && !result.grouped}
        rowTo={!result.grouped && s.link ? (r: any) => s.link!(r) : undefined} empty="Nothing matches these filters" />
    </div>}
  </div>;
}

// ---------------- list ----------------
export function CustomReports({ head }: { head: ReactNode }) {
  const { session } = useApp();
  const { rows } = useRows("reports", { order: [["name", "asc"]] }); const profiles = useRows("profiles").rows;
  return <>{head}
    <Section title="Your reports" sub="Build a report from orders, order lines, purchase orders, payments, open items, tasks or stock. Share it, or put it on the dashboard."
      action={<LinkButton size="sm" to="/reports/custom/new"><Plus />New report</LinkButton>}>
      <DataTable rows={rows} rowTo={r => reportPath(r)} empty="No reports yet. Make the first one." cols={[
        { key: "name", header: "Report", render: r => <div><div className="font-medium text-gray-900">{r.name}</div>{r.description && <div className="text-xs text-gray-500">{r.description}</div>}</div> },
        { key: "source", header: "From", value: r => sourceOf(r.definition?.source).label, render: r => sourceOf(r.definition?.source).label },
        { key: "kind", header: "Shows", value: r => r.definition?.group ? "summary" : "list", render: r => r.definition?.group ? <span className="inline-flex items-center gap-1">{r.definition.chart === "line" ? <LineChart className="h-3.5 w-3.5" /> : r.definition.chart === "bar" ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}Summary</span> : <span className="inline-flex items-center gap-1"><List className="h-3.5 w-3.5" />List</span> },
        { key: "owner", header: "Made by", render: r => r.owner === session?.id || !r.owner ? "you" : profiles.find(p => p.user_id === r.owner)?.full_name ?? "a colleague" },
        { key: "flags", header: "", render: r => <span className="flex gap-1">{r.shared && <Pill tone="blue">shared</Pill>}{r.on_dashboard && <Pill tone="green">on dashboard</Pill>}</span> },
        { key: "updated_at", header: "Changed", render: r => dateShort(r.updated_at) }]} />
    </Section></>;
}

// ---------------- build and view ----------------
export function ReportBuilder() {
  const { id } = useParams(); const reports = useRows("reports");
  if (reports.loading && !reports.rows.length) return <Loading />;
  const r = id ? byShort(reports.rows, id) : undefined;
  if (id && !r) return <NotFound what="Report" back={{ to: "/reports/custom", label: "Your reports" }} />;
  return <Builder key={r?.id ?? "new"} report={r} />;
}

function Builder({ report }: { report?: any }) {
  const { db, run, session, refresh } = useApp(); const nav = useNav();
  const [def, setDef] = useState<ReportDef>(() => ({ ...blankDef(), ...(report?.definition ?? {}) }));
  const [name, setName] = useState(report?.name ?? ""); const [desc, setDesc] = useState(report?.description ?? "");
  const [shared, setShared] = useState(!!report?.shared); const [dash, setDash] = useState(!!report?.on_dashboard);
  const [dirty, setDirty] = useState(!report); const [confirm, setConfirm] = useState(false);
  const mine = !report || !report.owner || report.owner === session?.id || session?.role === "admin";
  const costs = useCan()("see_costs"); const shown = useMemo(() => forRole(def, costs), [def, costs]);
  const src = sourceOf(def.source); const s = costs ? src : { ...src, fields: src.fields.filter(f => !COST.test(f.key)) };
  const { rows, loading } = useSourceRows(def.source);
  const result = useMemo(() => runReport(shown, rows), [shown, rows]);
  const up = (p: Partial<ReportDef>) => { setDef(d => ({ ...d, ...p })); setDirty(true); };
  const numeric = s.fields.filter(f => ["money", "number", "pct"].includes(f.type));

  const save = async (copy = false) => {
    if (!name.trim()) { toast.error("Give the report a name first"); return; }
    const body = { name: copy ? `${name} (copy)` : name.trim(), description: desc || null, shared: copy ? false : shared, on_dashboard: copy ? false : dash, definition: def };
    const out = await run(async () => report && !copy ? (await db.update("reports", { id: report.id }, body), report) : await db.insert<any>("reports", body), copy ? "Copy saved" : "Report saved");
    if (out) { setDirty(false); refresh(); if (!report || copy) nav(reportPath(out), { replace: !copy }); }
  };

  return <>
    <PageHeader back={{ to: "/reports/custom", label: "Your reports" }} title={report ? report.name : "New report"} sub={`${s.label} · ${result.total} row(s) match`}>
      {mine ? <Button onClick={() => save()} disabled={!dirty && !!report}>{dirty || !report ? "Save report" : "Saved"}</Button>
        : <Button variant="outline" onClick={() => save(true)}><Copy className="h-4 w-4" />Save as my copy</Button>}
      {report && mine && <Button variant="ghost" className="text-rose-600" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />Delete</Button>}
    </PageHeader>
    <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className="space-y-4">
        <Box title="Report">
          <Input aria-label="Report name" value={name} onChange={e => { setName(e.target.value); setDirty(true); }} placeholder="Name, e.g. Margin per customer 2026" className="h-9 border-gray-300" disabled={!mine} />
          <Input aria-label="Description" value={desc} onChange={e => { setDesc(e.target.value); setDirty(true); }} placeholder="Description (optional)" className="h-9 border-gray-300" disabled={!mine} />
          {mine && <><Check label="Share with colleagues (they can view it)" on={shared} set={v => { setShared(v); setDirty(true); }} />
            <Check label="Show on the dashboard" on={dash} set={v => { setDash(v); setDirty(true); }} /></>}
        </Box>
        <Box title="Data">
          <select aria-label="Source" className={selectClass + " w-full"} value={def.source} onChange={e => { setDef({ ...blankDef(e.target.value) }); setDirty(true); }}>
            {SOURCES.filter(x => costs || x.id !== "purchase_orders").map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 text-sm" role="radiogroup" aria-label="Show as">
            {[["list", "List"], ["summary", "Summary"]].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={(k === "summary") === !!def.group}
              onClick={() => up(k === "summary" ? { group: def.group ?? s.fields.find(f => f.type === "text")?.key, sort: null } : { group: null, sort: null, chart: "none" })}
              className={cn("rounded-md py-1.5 font-medium transition-colors", (k === "summary") === !!def.group ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900")}>{l}</button>)}
          </div>
        </Box>
        {!def.group ? <Box title="Columns">
          <div className="flex flex-wrap gap-1.5">{s.fields.map(f => { const on = def.columns.includes(f.key);
            return <button key={f.key} type="button" aria-pressed={on} onClick={() => up({ columns: on ? def.columns.filter(c => c !== f.key) : [...def.columns.filter(c => s.fields.some(x => x.key === c)), f.key].sort((a, b) => s.fields.findIndex(x => x.key === a) - s.fields.findIndex(x => x.key === b)) })}
              className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors", on ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300")}>{f.label}</button>; })}</div>
          <Row label="Sort by"><select aria-label="Sort by" className={selectClass + " w-full"} value={def.sort?.key ?? ""} onChange={e => up({ sort: e.target.value ? { key: e.target.value, dir: def.sort?.dir ?? -1 } : null })}>
            <option value="">–</option>{s.fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
            {def.sort && <select aria-label="Direction" className={selectClass + " w-28"} value={def.sort.dir} onChange={e => up({ sort: { ...def.sort!, dir: Number(e.target.value) as 1 | -1 } })}><option value={-1}>high → low</option><option value={1}>low → high</option></select>}</Row>
        </Box> : <Box title="Summary">
          <Row label="Group by"><select aria-label="Group by" className={selectClass + " w-full"} value={def.group} onChange={e => up({ group: e.target.value, bucket: fieldOf(s, e.target.value)?.type === "date" ? "month" : null, sort: null })}>
            {s.fields.filter(f => f.type === "text" || f.type === "date").map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select></Row>
          {fieldOf(s, def.group)?.type === "date" && <Row label="Per"><select aria-label="Date grouping" className={selectClass + " w-full"} value={def.bucket ?? ""} onChange={e => up({ bucket: (e.target.value || null) as any })}>
            <option value="">day</option><option value="month">month</option><option value="quarter">quarter</option><option value="year">year</option></select></Row>}
          <div className="space-y-1.5">{def.measures.map((m, i) => <div key={i} className="flex gap-1.5">
            <select aria-label={`Measure ${i + 1}`} className={selectClass + " w-28"} value={m.agg} onChange={e => up({ measures: def.measures.map((x, j) => j === i ? { agg: e.target.value as Agg, field: e.target.value === "count" ? "*" : x.field === "*" ? numeric[0]?.key ?? "*" : x.field } : x) })}>
              {(Object.keys(AGG_LABEL) as Agg[]).filter(a => a === "count" || numeric.length).map(a => <option key={a} value={a}>{AGG_LABEL[a]}</option>)}</select>
            {m.agg !== "count" ? <select aria-label={`Field of measure ${i + 1}`} className={selectClass + " min-w-0 flex-1"} value={m.field} onChange={e => up({ measures: def.measures.map((x, j) => j === i ? { ...x, field: e.target.value } : x) })}>
              {numeric.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select> : <span className="flex-1 self-center text-sm text-gray-500">of rows</span>}
            {def.measures.length > 1 && <button type="button" aria-label="Remove measure" onClick={() => up({ measures: def.measures.filter((_, j) => j !== i) })} className="text-gray-400 hover:text-rose-600"><X className="h-4 w-4" /></button>}
          </div>)}
            <button type="button" onClick={() => up({ measures: [...def.measures, { agg: numeric.length ? "sum" : "count", field: numeric[0]?.key ?? "*" }] })} className="text-xs font-medium text-indigo-600 hover:underline">+ Add a total</button>
            <p className="text-xs text-gray-400">The first total is the one in the chart. Money is added up per currency.</p></div>
          <Row label="Chart"><div className="flex gap-1">{([["none", "None", Table2], ["bar", "Bars", BarChart3], ["line", "Line", LineChart]] as const).map(([k, l, I]) =>
            <button key={k} type="button" aria-pressed={(def.chart ?? "none") === k} onClick={() => up({ chart: k })} className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium", (def.chart ?? "none") === k ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-600")}><I className="h-3.5 w-3.5" />{l}</button>)}</div></Row>
          <Row label="Top"><Input aria-label="Show at most" inputMode="numeric" value={def.limit ?? ""} onChange={e => up({ limit: Number(e.target.value) || null })} placeholder="all" className="h-9 w-24 border-gray-300" /></Row>
        </Box>}
        <Box title="Filters">
          {def.filters.map((f, i) => <FilterRow key={i} f={f} fields={s.fields} set={nf => up({ filters: def.filters.map((x, j) => j === i ? nf : x) })} remove={() => up({ filters: def.filters.filter((_, j) => j !== i) })} />)}
          <button type="button" onClick={() => up({ filters: [...def.filters, { field: s.fields[0].key, op: OPS[s.fields[0].type][0].op, value: "" }] })} className="text-xs font-medium text-indigo-600 hover:underline">+ Add a filter</button>
        </Box>
      </aside>
      <main className="min-w-0">{loading && !rows.length ? <Loading /> : <ReportResult def={shown} result={result} />}</main>
    </div>
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={`Delete "${report?.name}"?`} body="Only the report is removed; no data changes." confirmLabel="Delete"
      onConfirm={() => run(() => db.remove("reports", { id: report.id }), "Report deleted").then(() => nav("/reports/custom"))} />
  </>;
}

function FilterRow({ f, fields, set, remove }: { f: Filter; fields: Field[]; set: (f: Filter) => void; remove: () => void }) {
  const fd = fields.find(x => x.key === f.field) ?? fields[0]; const ops = OPS[fd.type];
  const needsValue = !["empty", "filled"].includes(f.op);
  return <div className="space-y-1.5 rounded-lg border border-gray-200 bg-white p-2">
    <div className="flex gap-1.5">
      <select aria-label="Filter field" className={selectClass + " min-w-0 flex-1"} value={f.field} onChange={e => { const n = fields.find(x => x.key === e.target.value)!; set({ field: n.key, op: OPS[n.type][0].op, value: "" }); }}>
        {fields.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
      <button type="button" aria-label="Remove filter" onClick={remove} className="text-gray-400 hover:text-rose-600"><X className="h-4 w-4" /></button>
    </div>
    <div className="flex gap-1.5">
      <select aria-label="Condition" className={selectClass + " w-32"} value={f.op} onChange={e => set({ ...f, op: e.target.value as any })}>{ops.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}</select>
      {needsValue && (fd.labels && (f.op === "is" || f.op === "not")
        ? <select aria-label="Value" className={selectClass + " min-w-0 flex-1"} value={f.value ?? ""} onChange={e => set({ ...f, value: e.target.value })}><option value="">–</option>{Object.entries(fd.labels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        : <Input aria-label="Value" type={fd.type === "date" && (f.op === "after" || f.op === "before") ? "date" : "text"} value={f.value ?? ""} onChange={e => set({ ...f, value: e.target.value })}
            placeholder={f.op === "year" ? String(new Date().getFullYear()) : f.op === "last_days" ? "30" : ""} className="h-9 min-w-0 flex-1 border-gray-300" />)}
    </div>
  </div>;
}
const Box = ({ title, children }: { title: string; children: ReactNode }) => <section className="space-y-2.5 rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm"><h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</h2>{children}</section>;
const Row = ({ label, children }: { label: string; children: ReactNode }) => <div><div className="mb-1 text-xs font-medium text-gray-600">{label}</div><div className="flex gap-1.5">{children}</div></div>;
const Check = ({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) => <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={on} onChange={e => set(e.target.checked)} className="h-4 w-4 accent-indigo-600" />{label}</label>;

/** a saved report as a dashboard widget */
export function ReportWidget({ report }: { report: any }) {
  const costs = useCan()("see_costs");
  const def: ReportDef = forRole({ ...blankDef(), ...(report.definition ?? {}) }, costs);
  const { rows, loading } = useSourceRows(def.source);
  const result = useMemo(() => runReport(def, rows), [report.definition, rows, costs]);   // eslint-disable-line react-hooks/exhaustive-deps
  return <Card title={report.name} action={<Link to={reportPath(report)} className="text-xs font-medium text-indigo-600 hover:underline">Open →</Link>}>
    {loading && !rows.length ? <div className="h-32 animate-pulse rounded bg-gray-50" /> : <ReportResult def={def} result={result} compact />}
  </Card>;
}

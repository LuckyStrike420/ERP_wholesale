/**
 * Report builder: what can be reported on, and how a saved definition turns rows into a result.
 * Every source is an existing view (the database already worked out every amount); the builder only
 * filters, groups and adds up. Money is never added across currencies: grouped money is split per currency.
 */
import { orderPath, poPath, customerPath } from "@/app/paths";
import { PAYMENT_LABEL, STATUS_LABEL, TASK_STATE_LABEL, BUCKET_LABEL } from "@/app/format";

export type FieldType = "text" | "number" | "money" | "pct" | "date" | "bool";
export interface Field { key: string; label: string; type: FieldType; labels?: Record<string, string> }
export interface Source { id: string; label: string; view: string; currency?: string; fields: Field[]; link?: (r: any) => string | undefined; defaults: string[] }

const statusL = STATUS_LABEL as Record<string, string>;
export const SOURCES: Source[] = [
  { id: "orders", label: "Orders", view: "v_orders", currency: "currency", link: r => orderPath(r), defaults: ["pi_number", "customer_name", "po_date", "status", "total_receivable", "outstanding"],
    fields: [
      { key: "pi_number", label: "PI#", type: "text" }, { key: "customer_name", label: "Customer", type: "text" }, { key: "order_type", label: "Type", type: "text" },
      { key: "status", label: "Status", type: "text", labels: statusL }, { key: "payment_status", label: "Payment", type: "text", labels: PAYMENT_LABEL as Record<string, string> },
      { key: "payment_term_name", label: "Payment term", type: "text" }, { key: "currency", label: "Currency", type: "text" },
      { key: "po_date", label: "PO date", type: "date" }, { key: "pi_date", label: "PI date", type: "date" }, { key: "invoice_date", label: "Invoice date", type: "date" },
      { key: "etd", label: "ETD", type: "date" }, { key: "eta", label: "ETA", type: "date" }, { key: "deposit_due_date", label: "Deposit due", type: "date" }, { key: "balance_due_date", label: "Balance due", type: "date" },
      { key: "order_value", label: "Order value", type: "money" }, { key: "total_receivable", label: "Order total", type: "money" }, { key: "total_cost", label: "Cost", type: "money" },
      { key: "margin", label: "Margin", type: "money" }, { key: "margin_pct", label: "Margin %", type: "pct" }, { key: "paid", label: "Received", type: "money" },
      { key: "outstanding", label: "Outstanding", type: "money" }, { key: "overdue_amount", label: "Overdue", type: "money" }, { key: "days_late", label: "Days late", type: "number" },
      { key: "line_count", label: "Lines", type: "number" }] },
  { id: "order_lines", label: "Order lines (per product)", view: "v_order_lines", currency: "currency", link: r => orderPath({ pi_number: r.pi_number, id: r.sales_order_id }),
    defaults: ["pi_number", "product_name", "revenue_date", "qty", "revenue", "margin"],
    fields: [
      { key: "pi_number", label: "PI#", type: "text" }, { key: "product_name", label: "Product", type: "text" }, { key: "customer_name", label: "Customer", type: "text" },
      { key: "order_type", label: "Type", type: "text" }, { key: "status", label: "Order status", type: "text", labels: statusL }, { key: "currency", label: "Currency", type: "text" },
      { key: "revenue_date", label: "Date", type: "date" }, { key: "qty", label: "Quantity", type: "number" }, { key: "unit_price", label: "Sale price", type: "money" },
      { key: "unit_cost", label: "Cost price", type: "money" }, { key: "revenue", label: "Revenue", type: "money" }, { key: "total_cost", label: "Total cost", type: "money" },
      { key: "margin", label: "Margin", type: "money" }, { key: "margin_pct", label: "Margin %", type: "pct" }] },
  { id: "purchase_orders", label: "Purchase orders", view: "v_purchase_orders", currency: "currency", link: r => poPath(r), defaults: ["po_number", "supplier_name", "po_date", "payable", "outstanding"],
    fields: [
      { key: "po_number", label: "PO#", type: "text" }, { key: "supplier_name", label: "Supplier", type: "text" }, { key: "order_type", label: "Type", type: "text" },
      { key: "currency", label: "Currency", type: "text" }, { key: "po_date", label: "PO date", type: "date" }, { key: "pi_numbers", label: "For PI", type: "text" },
      { key: "expected_amount", label: "Expected", type: "money" }, { key: "payable", label: "To pay", type: "money" }, { key: "paid", label: "Paid", type: "money" },
      { key: "outstanding", label: "Outstanding", type: "money" }, { key: "overdue_amount", label: "Overdue", type: "money" }, { key: "invoice_difference", label: "Invoice difference", type: "money" },
      { key: "days_late", label: "Days late", type: "number" }] },
  { id: "open_items", label: "Open payments (in and out)", view: "v_open_items", currency: "currency", defaults: ["direction", "reference", "party", "outstanding", "next_due_date", "bucket"],
    link: r => r.direction === "in" ? orderPath({ pi_number: r.reference, id: r.id }) : poPath({ po_number: r.reference }),
    fields: [
      { key: "direction", label: "Direction", type: "text", labels: { in: "To receive", out: "To pay" } }, { key: "reference", label: "PI# / PO#", type: "text" }, { key: "party", label: "Customer / supplier", type: "text" },
      { key: "order_type", label: "Type", type: "text" }, { key: "currency", label: "Currency", type: "text" }, { key: "bucket", label: "Urgency", type: "text", labels: BUCKET_LABEL as Record<string, string> },
      { key: "next_due_date", label: "Next due", type: "date" }, { key: "total", label: "Total", type: "money" }, { key: "paid", label: "Paid", type: "money" },
      { key: "outstanding", label: "Outstanding", type: "money" }, { key: "overdue_amount", label: "Overdue", type: "money" }, { key: "days_late", label: "Days late", type: "number" }, { key: "days_open", label: "Days open", type: "number" }] },
  { id: "payments", label: "Payments", view: "v_payments", currency: "currency", defaults: ["payment_date", "direction", "party_name", "amount", "reference"],
    fields: [
      { key: "payment_date", label: "Date", type: "date" }, { key: "direction", label: "Direction", type: "text", labels: { in: "Received", out: "Paid" } }, { key: "party_name", label: "Customer / supplier", type: "text" },
      { key: "currency", label: "Currency", type: "text" }, { key: "reference", label: "Reference", type: "text" }, { key: "amount", label: "Amount", type: "money" },
      { key: "allocated", label: "Allocated", type: "money" }, { key: "unallocated", label: "Not allocated", type: "money" }] },
  { id: "tasks", label: "Tasks", view: "v_tasks", defaults: ["title", "state", "due_date", "assigned_name", "customer_name"],
    fields: [
      { key: "title", label: "Task", type: "text" }, { key: "state", label: "State", type: "text", labels: TASK_STATE_LABEL }, { key: "due_date", label: "Due", type: "date" },
      { key: "assigned_name", label: "For", type: "text" }, { key: "created_by_name", label: "Made by", type: "text" }, { key: "customer_name", label: "Customer", type: "text" },
      { key: "supplier_name", label: "Supplier", type: "text" }, { key: "pi_number", label: "PI#", type: "text" }, { key: "days_late", label: "Days late", type: "number" }] },
  { id: "stock", label: "NL stock (per batch)", view: "v_batch_item_stock", defaults: ["batch_number", "product_name", "qty_received", "sold", "stock"],
    fields: [
      { key: "batch_number", label: "Batch#", type: "text" }, { key: "product_name", label: "Product", type: "text" }, { key: "received_date", label: "Received", type: "date" },
      { key: "qty_received", label: "Received qty", type: "number" }, { key: "sold", label: "Sold", type: "number" }, { key: "stock", label: "In stock", type: "number" },
      { key: "sold_without_po", label: "Sold without PO", type: "number" }] },
];
export const sourceOf = (id: string) => SOURCES.find(s => s.id === id) ?? SOURCES[0];
export const fieldOf = (s: Source, key: string) => s.fields.find(f => f.key === key);

export type Op = "is" | "not" | "contains" | "gt" | "lt" | "after" | "before" | "year" | "last_days" | "empty" | "filled";
export const OPS: Record<FieldType, { op: Op; label: string }[]> = {
  text: [{ op: "is", label: "is" }, { op: "not", label: "is not" }, { op: "contains", label: "contains" }, { op: "empty", label: "is empty" }, { op: "filled", label: "is filled" }],
  number: [{ op: "gt", label: "more than" }, { op: "lt", label: "less than" }, { op: "is", label: "is" }, { op: "empty", label: "is empty" }],
  money: [{ op: "gt", label: "more than" }, { op: "lt", label: "less than" }, { op: "empty", label: "is empty" }],
  pct: [{ op: "gt", label: "more than %" }, { op: "lt", label: "less than %" }, { op: "empty", label: "is unknown" }],
  date: [{ op: "year", label: "in year" }, { op: "last_days", label: "in the last … days" }, { op: "after", label: "on or after" }, { op: "before", label: "before" }, { op: "empty", label: "is empty" }, { op: "filled", label: "is filled" }],
  bool: [{ op: "is", label: "is" }],
};
export type Agg = "sum" | "avg" | "min" | "max" | "count";
export const AGG_LABEL: Record<Agg, string> = { sum: "Total", avg: "Average", min: "Lowest", max: "Highest", count: "Count" };
export interface Filter { field: string; op: Op; value?: string }
export interface Measure { field: string; agg: Agg }
export interface ReportDef {
  source: string; columns: string[]; filters: Filter[];
  group?: string | null; bucket?: "month" | "quarter" | "year" | null; measures: Measure[];
  sort?: { key: string; dir: 1 | -1 } | null; chart?: "none" | "bar" | "line"; limit?: number | null;
}
export const blankDef = (source = "orders"): ReportDef => ({ source, columns: sourceOf(source).defaults, filters: [], group: null, bucket: null, measures: [{ field: "*", agg: "count" }], sort: null, chart: "none", limit: null });

const today = () => new Date().toISOString().slice(0, 10);
const day = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const asNum = (v: any) => (v === null || v === undefined || v === "" ? null : Number(v));
function keep(r: any, f: Filter, s: Source) {
  const fd = fieldOf(s, f.field); if (!fd) return true;
  const v = r[f.field]; const x = f.value ?? "";
  if (f.op === "empty") return v === null || v === undefined || v === "";
  if (f.op === "filled") return !(v === null || v === undefined || v === "");
  if (fd.type === "date") {
    const d = v ? String(v).slice(0, 10) : null; if (!d) return false;
    if (f.op === "year") return d.startsWith(x);
    if (f.op === "last_days") return d >= day(Number(x) || 0) && d <= today();
    if (f.op === "after") return d >= x; if (f.op === "before") return d < x;
  }
  if (fd.type === "number" || fd.type === "money" || fd.type === "pct") {
    const n = asNum(v); if (n === null) return false; const t = Number(String(x).replace(",", ".")) / (fd.type === "pct" ? 100 : 1);
    if (f.op === "gt") return n > t; if (f.op === "lt") return n < t; if (f.op === "is") return n === t;
  }
  const sv = String(v ?? "").toLowerCase(), sx = x.toLowerCase();
  if (f.op === "is") return sv === sx; if (f.op === "not") return sv !== sx; if (f.op === "contains") return sv.includes(sx);
  return true;
}
/** the value a row is grouped by ("2026-11" for a date by month) */
export function groupKey(v: any, fd: Field | undefined, bucket?: string | null) {
  if (v === null || v === undefined || v === "") return "(empty)";
  if (fd?.type === "date") { const d = String(v).slice(0, 10); if (bucket === "year") return d.slice(0, 4); if (bucket === "quarter") return `${d.slice(0, 4)}-Q${Math.ceil(Number(d.slice(5, 7)) / 3)}`; if (bucket === "month") return d.slice(0, 7); return d; }
  return fd?.labels?.[v] ?? String(v);
}

export interface Result { grouped: boolean; columns: { key: string; label: string; type: FieldType | "group" }[]; rows: any[]; currencies: string[]; total: number }
export function runReport(def: ReportDef, input: any[]): Result {
  const s = sourceOf(def.source);
  const rows = input.filter(r => def.filters.every(f => keep(r, f, s)));
  if (!def.group) {
    const cols = def.columns.map(k => fieldOf(s, k)).filter(Boolean).map(f => ({ key: f!.key, label: f!.label, type: f!.type }));
    let out = [...rows];
    if (def.sort) out.sort((a, b) => cmp(a[def.sort!.key], b[def.sort!.key]) * def.sort!.dir);
    if (def.limit) out = out.slice(0, def.limit);
    return { grouped: false, columns: cols, rows: out, currencies: [], total: rows.length };
  }
  const gf = fieldOf(s, def.group);
  const measures = def.measures.filter(m => m.agg === "count" || fieldOf(s, m.field));
  // money is added up per currency, never across
  const split = !!s.currency && measures.some(m => m.agg !== "count" && fieldOf(s, m.field)?.type === "money");
  const groups = new Map<string, any[]>();
  for (const r of rows) { const k = groupKey(r[def.group], gf, def.bucket) + (split ? `\u0000${r[s.currency!]}` : ""); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
  let out = [...groups.entries()].map(([k, rs]) => {
    const [g, cur] = k.split("\u0000"); const row: any = { _group: g, _currency: cur ?? null, _count: rs.length };
    measures.forEach((m, i) => {
      if (m.agg === "count") { row[`m${i}`] = rs.length; return; }
      const vals = rs.map(r => asNum(r[m.field])).filter((x): x is number => x !== null);
      row[`m${i}`] = !vals.length ? null : m.agg === "sum" ? vals.reduce((a, b) => a + b, 0) : m.agg === "avg" ? vals.reduce((a, b) => a + b, 0) / vals.length
        : m.agg === "min" ? Math.min(...vals) : Math.max(...vals);
    });
    return row;
  });
  const dateGroup = gf?.type === "date";
  // months (quarters, years) without rows still show, with 0, so a chart over time has no hidden gaps
  if (dateGroup && def.bucket && !def.sort?.key) {
    const step = (k: string) => def.bucket === "year" ? String(Number(k) + 1)
      : def.bucket === "quarter" ? (k.endsWith("Q4") ? `${Number(k.slice(0, 4)) + 1}-Q1` : `${k.slice(0, 6)}${Number(k.slice(6)) + 1}`)
      : (k.endsWith("-12") ? `${Number(k.slice(0, 4)) + 1}-01` : `${k.slice(0, 5)}${String(Number(k.slice(5)) + 1).padStart(2, "0")}`);
    for (const cur of split ? [...new Set(out.map(r => r._currency))] : [null]) {
      const have = new Set(out.filter(r => !split || r._currency === cur).map(r => r._group).filter(g => g !== "(empty)"));
      const keys = [...have].sort(); if (!keys.length) continue;
      for (let k = step(keys[0]), n = 0; k < keys[keys.length - 1] && n < 240; k = step(k), n++)
        if (!have.has(k)) out.push({ _group: k, _currency: cur, _count: 0, ...Object.fromEntries(measures.map((m, i) => [`m${i}`, m.agg === "count" || m.agg === "sum" ? 0 : null])) });
    }
  }
  if (def.sort?.key) out.sort((a, b) => cmp(a[def.sort!.key], b[def.sort!.key]) * def.sort!.dir);
  else if (dateGroup) out.sort((a, b) => cmp(a._group, b._group));
  else out.sort((a, b) => cmp(b.m0, a.m0));
  if (def.limit) out = out.slice(0, def.limit);
  const columns = [{ key: "_group", label: gf ? gf.label + (def.bucket ? ` (${def.bucket})` : "") : "Group", type: "group" as const },
    ...(split ? [{ key: "_currency", label: "Currency", type: "text" as const }] : []),
    ...measures.map((m, i) => ({ key: `m${i}`, label: m.agg === "count" ? "Count" : `${AGG_LABEL[m.agg]} ${fieldOf(s, m.field)!.label.toLowerCase()}`, type: m.agg === "count" ? "number" as const : fieldOf(s, m.field)!.type }))];
  return { grouped: true, columns, rows: out, currencies: split ? [...new Set(out.map(r => r._currency))] : [], total: rows.length };
}
const cmp = (a: any, b: any) => (a === null || a === undefined ? 1 : b === null || b === undefined ? -1 : typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true }));
export const customerLink = customerPath;

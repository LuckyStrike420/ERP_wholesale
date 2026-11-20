/**
 * NL stock beyond batches: tabs, movements with running balance, stock counts, and the stock value on a date.
 * /stock/movements, /stock/counts, /stock/counts/1a2b3c4d, /stock/value
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApp, useRows } from "@/app/store";
import { Link, useNav, useParams, useQuery, usePath } from "@/app/router";
import { batchPath } from "./Batches";
import { ConfirmDialog, DataTable, Loading, NotFound, PageHeader, Pill, Section, TabLinks, selectClass } from "@/app/ui";
import { date, dateTime, money, qty, today } from "@/app/format";
import { cn } from "@/lib/utils";

export const KIND_LABEL: Record<string, string> = { receipt: "Received", sale: "Sale", Telling: "Count", Schade: "Damage", Retour: "Return", Overig: "Other" , Assembly: "Assembly"};
export const stockTabs = <TabLinks tabs={[{ to: "/stock", label: "Stock" }, { to: "/stock/movements", label: "Movements" }, { to: "/stock/counts", label: "Counts" }, { to: "/stock/value", label: "Stock value" }, { to: "/stock/assemblies", label: "Assembly" }]} />;
const head = (sub: string) => <PageHeader title="NL stock" sub={sub} />;

// ---------------- movements ----------------
export function StockMovements() {
  const q = useQuery(); const nav = useNav(); const path = usePath();
  const set = (k: string, v: string) => { const n = new URLSearchParams(q); if (v) n.set(k, v); else n.delete(k); nav(`${path}${n.toString() ? `?${n}` : ""}`, { replace: true }); };
  const moves = useRows("v_stock_movements").rows; const items = useRows("v_batch_item_stock").rows;
  const product = q.get("product") ?? "", kind = q.get("kind") ?? "";
  const byItem = useMemo(() => Object.fromEntries(items.map(i => [i.batch_item_id, i])), [items]);
  const products = [...new Map(items.map(i => [i.product_id, i.product_name])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  // oldest first for the running balance, newest first to show
  const rows = useMemo(() => {
    const keep = moves.filter(m => (!product || byItem[m.batch_item_id]?.product_id === product) && (!kind || m.kind === kind))
      .sort((a, b) => String(a.movement_date ?? "").localeCompare(String(b.movement_date ?? "")) || (a.kind === "receipt" ? -1 : 1));
    let bal = 0;
    return keep.map((m, i) => { bal += Number(m.quantity); return { ...m, id: `${m.batch_item_id}${i}`, balance: bal }; }).reverse();
  }, [moves, byItem, product, kind]);
  return <>{head("Every movement: received, sold, counted, damaged or returned.")}{stockTabs}
    <div className="mb-4 flex flex-wrap gap-2">
      <select aria-label="Product" className={selectClass + " w-64"} value={product} onChange={e => set("product", e.target.value)}>
        <option value="">All products</option>{products.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <select aria-label="Kind" className={selectClass + " w-40"} value={kind} onChange={e => set("kind", e.target.value)}>
        <option value="">All kinds</option>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    </div>
    <Section sub={product ? "Balance = the stock of this product after each movement." : "Choose a product to see its running balance."}>
      <DataTable rows={rows} search exportName="stock-movements" empty="No movements" cols={[
        { key: "movement_date", header: "Date", render: m => date(m.movement_date) },
        { key: "product", header: "Product", value: m => byItem[m.batch_item_id]?.product_name, render: m => byItem[m.batch_item_id]?.product_name ?? "–" },
        { key: "batch", header: "Batch", value: m => byItem[m.batch_item_id]?.batch_number, render: m => byItem[m.batch_item_id] ? <Link to={batchPath(byItem[m.batch_item_id])} className="text-indigo-600 hover:underline">{byItem[m.batch_item_id].batch_number}</Link> : "–" },
        { key: "kind", header: "Kind", render: m => <Pill tone={m.kind === "receipt" ? "green" : m.kind === "sale" ? "blue" : "amber"}>{KIND_LABEL[m.kind] ?? m.kind}</Pill> },
        { key: "reference", header: "Reference" },
        { key: "quantity", header: "Quantity", align: "right", render: m => <span className={Number(m.quantity) < 0 ? "text-rose-600" : "text-emerald-700"}>{Number(m.quantity) > 0 ? "+" : ""}{qty(m.quantity)}</span> },
        ...(product ? [{ key: "balance", header: "Balance", align: "right" as const, render: (m: any) => <b className={m.balance < 0 ? "text-rose-600" : ""}>{qty(m.balance)}</b> }] : [])]} />
    </Section></>;
}

// ---------------- counts ----------------
export const countPath = (c: { id: string }) => `/stock/counts/${String(c.id).slice(0, 8)}`;
export function StockCounts() {
  const { db, run } = useApp(); const nav = useNav();
  const rows = useRows("stock_counts", { order: [["count_date", "desc"]] }).rows; const lines = useRows("stock_count_lines").rows;
  const start = () => run(async () => { const c = await db.insert<any>("stock_counts", { count_date: today() }); return c; }, undefined).then(c => { if (c) nav(countPath(c)); });
  return <>{head("Count what is on the shelf; the differences are booked as count corrections.")}{stockTabs}
    <Section title="Counts" action={<Button size="sm" onClick={start}><Plus className="h-4 w-4" />New count</Button>}>
      <DataTable rows={rows} rowTo={c => countPath(c)} empty="No counts yet" cols={[
        { key: "count_date", header: "Count date", render: c => <span className="font-medium text-gray-900">{date(c.count_date)}</span> },
        { key: "lines", header: "Counted", align: "right", value: c => lines.filter(l => l.count_id === c.id && l.counted != null).length, render: c => `${lines.filter(l => l.count_id === c.id && l.counted != null).length} item(s)` },
        { key: "diff", header: "Differences", align: "right", value: c => lines.filter(l => l.count_id === c.id && l.expected != null && Number(l.counted) !== Number(l.expected)).length,
          render: c => c.status === "booked" ? `${lines.filter(l => l.count_id === c.id && l.expected != null && Number(l.counted) !== Number(l.expected)).length}` : "–" },
        { key: "status", header: "", render: c => c.status === "booked" ? <Pill tone="green">booked {dateTime(c.booked_at)}</Pill> : <Pill tone="amber">open</Pill> },
        { key: "notes", header: "Note", wrap: true }]} />
    </Section></>;
}

export function StockCountSheet() {
  const { id } = useParams(); const { db, run, refresh } = useApp(); const nav = useNav();
  const counts = useRows("stock_counts"); const c = id ? counts.rows.find(x => String(x.id).startsWith(id)) : undefined;
  const lines = useRows(c ? "stock_count_lines" : null, { eq: { count_id: c?.id } }).rows;
  const [onDate, setOnDate] = useState<any[]>([]); const [draft, setDraft] = useState<Record<string, string>>({}); const [ask, setAsk] = useState<null | "book" | "delete">(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { if (c) db.rpc<any[]>("stock_on", { p_date: c.count_date }).then(r => setOnDate(r ?? [])).catch(() => setOnDate([])); }, [c?.id, c?.count_date]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return counts.loading ? <Loading /> : <NotFound what="Count" back={{ to: "/stock/counts", label: "Counts" }} />;
  const booked = c.status === "booked";
  const counted = (bi: string) => draft[bi] ?? (lines.find(l => l.batch_item_id === bi)?.counted ?? "");
  const save = (bi: string, v: string) => {
    const n = v.trim() === "" ? null : Math.round(Number(v));
    if (n != null && (!Number.isFinite(n) || n < 0)) return;
    const ex = lines.find(l => l.batch_item_id === bi);
    if ((ex?.counted ?? null) === n) return;
    run(async () => {
      if (ex) await db.update("stock_count_lines", { count_id: c.id, batch_item_id: bi }, { counted: n });
      else await db.insert("stock_count_lines", { count_id: c.id, batch_item_id: bi, counted: n });
      setDraft(d => { const x = { ...d }; delete x[bi]; return x; }); refresh();
    }, undefined);
  };
  const rows = onDate.filter(r => showAll || Number(r.qty) !== 0 || lines.some(l => l.batch_item_id === r.batch_item_id))
    .sort((a, b) => String(a.product_name).localeCompare(String(b.product_name)) || String(a.batch_number).localeCompare(String(b.batch_number)))
    .map(r => { const l = lines.find(x => x.batch_item_id === r.batch_item_id); const exp = booked && l?.expected != null ? Number(l.expected) : Number(r.qty);
      const cnt = counted(r.batch_item_id); return { ...r, id: r.batch_item_id, expected: exp, counted: cnt, diff: cnt === "" || cnt == null ? null : Number(cnt) - exp }; });
  const diffs = rows.filter(r => r.diff != null && r.diff !== 0).length; const done = rows.filter(r => r.counted !== "" && r.counted != null).length;
  return <>
    <PageHeader back={{ to: "/stock/counts", label: "Counts" }} title={`Count of ${date(c.count_date)}`}
      sub={booked ? `Booked ${dateTime(c.booked_at)}: the differences are count corrections on ${date(c.count_date)}.` : "Type what you count; it is saved as you go. Empty = not counted (stays as it is)."}>
      {!booked && <><Button variant="ghost" className="text-rose-600" onClick={() => setAsk("delete")}>Delete count</Button>
        <Button onClick={() => setAsk("book")} disabled={!done}><Check className="h-4 w-4" />Book {diffs} difference{diffs === 1 ? "" : "s"}</Button></>}
    </PageHeader>
    <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
      {!booked && <label className="flex items-center gap-2">Count date <Input type="date" aria-label="Count date" value={c.count_date} className="h-8 w-40 border-gray-300"
        onChange={e => e.target.value && run(async () => { await db.update("stock_counts", { id: c.id }, { count_date: e.target.value }); refresh(); }, undefined)} /></label>}
      <span className="text-gray-500">{done} of {rows.length} counted · {diffs} difference{diffs === 1 ? "" : "s"}</span>
      <label className="flex items-center gap-2 text-gray-600"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="h-4 w-4 accent-indigo-600" />Also items without stock</label>
    </div>
    <Section>
      <DataTable rows={rows} search exportName={`count-${c.count_date}`} empty="No stock on this date" cols={[
        { key: "product_name", header: "Product", render: r => <span className="font-medium text-gray-900">{r.product_name}</span> },
        { key: "batch_number", header: "Batch" },
        { key: "expected", header: "In the system", align: "right", render: r => qty(r.expected) },
        { key: "counted", header: "Counted", align: "right", value: r => r.counted === "" ? null : Number(r.counted), render: r => booked ? (r.counted === "" || r.counted == null ? "–" : qty(r.counted)) :
          <input aria-label={`Counted ${r.product_name} ${r.batch_number}`} inputMode="numeric" value={r.counted ?? ""} onChange={e => setDraft(d => ({ ...d, [r.batch_item_id]: e.target.value }))}
            onBlur={e => save(r.batch_item_id, e.target.value)} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="h-8 w-24 rounded-md border border-gray-200 px-2 text-right tabular-nums focus:border-indigo-400 focus:outline-none" placeholder="–" /> },
        { key: "diff", header: "Difference", align: "right", render: r => r.diff == null ? <span className="text-gray-300">–</span> : <b className={cn(r.diff < 0 ? "text-rose-600" : r.diff > 0 ? "text-emerald-700" : "text-gray-400")}>{r.diff > 0 ? "+" : ""}{qty(r.diff)}</b> }]} />
    </Section>
    <ConfirmDialog open={ask === "book"} onClose={() => setAsk(null)} title={`Book ${diffs} difference${diffs === 1 ? "" : "s"}?`} confirmLabel="Book"
      body={`Every counted item that differs gets a count correction on ${date(c.count_date)}. The count is then closed.`}
      onConfirm={() => run(async () => { await db.rpc("book_stock_count", { p_count: c.id }); refresh(); }, "Count booked")} />
    <ConfirmDialog open={ask === "delete"} onClose={() => setAsk(null)} danger title="Delete this count?" body="Nothing was booked yet; the counted numbers are thrown away." confirmLabel="Delete"
      onConfirm={() => run(async () => { await db.remove("stock_counts", { id: c.id }); return true; }, "Count deleted").then(ok => { if (ok) nav("/stock/counts"); })} />
  </>;
}

// ---------------- value on a date ----------------
export function StockValue() {
  const { db } = useApp(); const q = useQuery(); const nav = useNav(); const path = usePath();
  const on = q.get("date") ?? today();
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { setRows(null); db.rpc<any[]>("stock_on", { p_date: on }).then(r => setRows(r ?? [])).catch(() => setRows([])); }, [on]);   // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (rows ?? []).filter(r => Number(r.qty) !== 0).map(r => ({ ...r, id: r.batch_item_id }));
  const total = shown.reduce((a, r) => a + Number(r.value ?? 0), 0); const missing = shown.filter(r => r.purchase_price == null).length;
  const perProduct = Object.values(shown.reduce<Record<string, any>>((m, r) => { const t = m[r.product_id] ?? { id: r.product_id, product_name: r.product_name, qty: 0, value: 0 }; t.qty += Number(r.qty); t.value += Number(r.value ?? 0); m[r.product_id] = t; return m; }, {}));
  return <>{head("What is in stock on a date, at purchase price plus landed costs per piece.")}{stockTabs}
    <div className="mb-4 flex flex-wrap items-end gap-4">
      <label className="text-sm text-gray-600">On date<Input type="date" aria-label="Stock value on" value={on} className="mt-1 h-9 w-44 border-gray-300" onChange={e => e.target.value && nav(`${path}?date=${e.target.value}`, { replace: true })} /></label>
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-2"><div className="text-xs text-gray-500">Stock value {date(on)}</div><div className="text-xl font-semibold tabular-nums">{money(total, "EUR", 0)}</div></div>
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-2"><div className="text-xs text-gray-500">Pieces</div><div className="text-xl font-semibold tabular-nums">{qty(shown.reduce((a, r) => a + Number(r.qty), 0))}</div></div>
      {missing > 0 && <p className="text-sm text-amber-700">{missing} item(s) without a purchase price count as €0.</p>}
    </div>
    {rows == null ? <Loading /> : <div className="grid gap-6 xl:grid-cols-3">
      <Section title="Per batch and product" className="xl:col-span-2">
        <DataTable dense rows={shown} search exportName={`stock-value-${on}`} empty="No stock on this date" cols={[
          { key: "product_name", header: "Product", render: r => <span className="font-medium text-gray-900">{r.product_name}</span> },
          { key: "batch_number", header: "Batch", render: r => <Link to={batchPath(r)} className="text-indigo-600 hover:underline">{r.batch_number}</Link> },
          { key: "qty", header: "Pieces", align: "right", render: r => <span className={Number(r.qty) < 0 ? "text-rose-600" : ""}>{qty(r.qty)}</span> },
          { key: "purchase_price", header: "Purchase price", align: "right", render: r => r.purchase_price == null ? <Pill tone="amber">missing</Pill> : money(r.purchase_price, "EUR", 2) },
          { key: "landed_per_unit", header: "Landed / pc", align: "right", render: r => Number(r.landed_per_unit) ? money(r.landed_per_unit, "EUR", 4) : "–" },
          { key: "value", header: "Value", align: "right", render: r => <b>{money(r.value ?? 0, "EUR", 2)}</b> }]} />
      </Section>
      <Section title="Per product"><DataTable dense rows={perProduct.sort((a: any, b: any) => b.value - a.value)} cols={[
        { key: "product_name", header: "Product" }, { key: "qty", header: "Pieces", align: "right", render: (r: any) => qty(r.qty) },
        { key: "value", header: "Value", align: "right", render: (r: any) => money(r.value, "EUR", 0) }]} /></Section>
    </div>}
    <p className="mt-3 text-xs text-gray-500">Sold = ordered (PO date), also when it has not been picked up yet; cancelled orders do not count. A shared margin with the supplier is not part of the value, as it depends on the sale price.</p>
  </>;
}

/** dashboard: products under their minimum stock */
export function LowStockWidget() {
  const rows = useRows("v_product_stock").rows.filter(p => p.below_min).sort((a, b) => Number(a.stock) - Number(b.stock));
  return <section className="flex h-full flex-col rounded-xl border border-gray-200/80 bg-white shadow-sm">
    <header className="flex items-center justify-between px-5 pb-2 pt-4"><h2 className="text-sm font-semibold text-gray-900">Low stock (NL)</h2><Link to="/stock" className="text-xs font-medium text-indigo-600 hover:underline">NL stock</Link></header>
    <div className="px-5 pb-4">{!rows.length ? <p className="py-6 text-center text-sm text-gray-500">Every product is above its minimum.</p> :
      <ul className="divide-y divide-gray-100">{rows.slice(0, 7).map(p => { const perWeek = Number(p.sold_90d) / 13;
        return <li key={p.product_id} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="min-w-0 truncate text-gray-900">{p.product_name}</span>
          <span className="text-right text-xs"><b className={cn("text-sm tabular-nums", Number(p.stock) <= 0 ? "text-rose-600" : "text-amber-700")}>{qty(p.stock)}</b> <span className="text-gray-500">/ min {qty(p.min_stock)}{perWeek > 0 ? ` · ~${Math.max(0, Math.floor(Number(p.stock) / perWeek))} wk left` : ""}</span></span></li>; })}</ul>}</div>
  </section>;
}

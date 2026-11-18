/**
 * /orders: every order as a list or as a board per status (?view=board).
 * Filters live in the URL, so a filter can be saved under a name (per user) and opened again with one click.
 * On the board an order is dragged to another status; the database checks the same rules as the status menu.
 */
import { useCan } from "@/app/permissions";
import { useMemo, useState, type DragEvent } from "react";
import { BookmarkPlus, Columns3, Flag, List, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorText, useApp, useRows } from "@/app/store";
import { toast } from "@/app/notify";
import { Link, useNav, useQuery } from "@/app/router";
import { orderPath } from "@/app/paths";
import { DataTable, LinkButton, PageHeader, PaymentPill, Section, StatusPill, selectClass } from "@/app/ui";
import { date, days, money, marginPct, PAYMENT_LABEL, STATUS_LABEL, STATUS_ORDER } from "@/app/format";
import { cn } from "@/lib/utils";
import { Combobox } from "@/app/Combobox";

const FILTER_KEYS = ["status", "type", "customer", "payment", "q"];

export default function OrdersList() {
  const nav = useNav(); const q = useQuery(); const { db, run } = useApp(); const costs = useCan()("see_costs");
  const view = q.get("view") === "board" ? "board" : "list";
  const status = q.get("status") ?? "open"; const type = q.get("type") ?? ""; const customer = q.get("customer") ?? ""; const payment = q.get("payment") ?? ""; const text = q.get("q") ?? "";
  const go = (n: URLSearchParams) => nav(`/orders${n.toString() ? "?" + n : ""}`, { replace: true });
  const set = (k: string, v: string) => { const n = new URLSearchParams(q); if (v) n.set(k, v); else n.delete(k); go(n); };
  const orders = useRows("v_orders", { order: [["po_date", "desc"]] }).rows;
  const customers = useRows("customers", { order: [["name", "asc"]] }).rows;
  const views = useRows("saved_views", { eq: { page: "orders" }, order: [["name", "asc"]] }).rows;
  const flags = useRows("v_order_flags").rows;
  const delivery = useRows("v_order_delivery").rows;
  // the order's terms (FOB, EXW, DDP …); the type filter still groups them as FOB (China) and EXW (NL stock)
  const typeOf = (o: any) => delivery.find(d => d.sales_order_id === o.id)?.incoterm ?? o.order_type;
  const flagOf = (id: string) => flags.filter(f => f.sales_order_id === id).map(f => f.flag_text).join(" · ");
  const [naming, setNaming] = useState<string | null>(null);

  const needle = text.trim().toLowerCase();
  const shown = orders.filter(o => (!type || o.order_type === type) && (!customer || o.customer_id === customer) && (!payment || o.payment_status === payment) &&
    (status === "all" || (status === "open" ? o.is_open : status === "overdue" ? Number(o.overdue_amount) > 0 || o.reminder_due : status === "unpaid" ? Number(o.outstanding) > 0.01 && o.status !== "draft" : o.status === status)) &&
    (!needle || [o.pi_number, o.customer_name, o.customer_po, o.notes].some(x => String(x ?? "").toLowerCase().includes(needle))));

  // the filter part of the URL (without the view), which is what a saved filter keeps
  const filterQuery = new URLSearchParams([...q.entries()].filter(([k]) => FILTER_KEYS.includes(k))).toString();
  const withView = (query: string) => { const n = new URLSearchParams(query); if (view === "board") n.set("view", "board"); return `/orders${n.toString() ? "?" + n : ""}`; };
  const current = views.find(v => v.query === filterQuery);
  const saveView = async () => {
    const name = (naming ?? "").trim(); if (!name) return;
    const r = await run(() => db.insert("saved_views", { page: "orders", name, query: filterQuery }), `Filter "${name}" saved`);
    if (r !== undefined) setNaming(null);
  };

  return <>
    <PageHeader title="Orders" sub="One order per PI. Filter, save a filter, or switch to the board to move orders through their statuses.">
      <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5 shadow-sm" role="tablist" aria-label="View">
        {([["list", "List", List], ["board", "Board", Columns3]] as const).map(([v, l, Icon]) =>
          <Link key={v} to={(() => { const n = new URLSearchParams(q); if (v === "board") n.set("view", "board"); else n.delete("view"); return `/orders${n.toString() ? "?" + n : ""}`; })()} role="tab" aria-selected={view === v}
            className={cn("inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium transition-colors", view === v ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100")}><Icon className="h-3.5 w-3.5" />{l}</Link>)}
      </div>
      <LinkButton to="/orders/new"><Plus />New order</LinkButton>
    </PageHeader>

    {/* filters: the same for list and board */}
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
        <Input value={text} onChange={e => set("q", e.target.value)} placeholder="PI#, customer, PO" aria-label="Search orders" className="h-9 w-52 border-gray-300 bg-white pl-8" /></div>
      <select aria-label="Status" className={selectClass + " w-48"} value={status} onChange={e => set("status", e.target.value === "open" ? "" : e.target.value)}>
        <option value="open">Open orders</option><option value="unpaid">With an open amount</option><option value="overdue">Overdue or reminder</option><option value="all">All orders</option>
        {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select aria-label="Type" className={selectClass + " w-32"} value={type} onChange={e => set("type", e.target.value)}><option value="">All terms</option><option value="EXW">From NL stock (EUR)</option><option value="FOB">FOB from China (USD)</option></select>
      <Combobox label="Customer" className="w-52" value={customer || null} onChange={v => set("customer", v ?? "")} placeholder="All customers" options={customers.map(c => ({ value: c.id, label: c.name }))} />
      <select aria-label="Payment" className={selectClass + " w-40"} value={payment} onChange={e => set("payment", e.target.value)}><option value="">Any payment</option>
        {Object.entries(PAYMENT_LABEL).filter(([k]) => k !== "draft").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      {filterQuery && <button type="button" onClick={() => go(new URLSearchParams(view === "board" ? "view=board" : ""))} className="text-xs font-medium text-gray-500 hover:text-gray-900">Clear filters</button>}
    </div>

    {/* saved filters */}
    <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
      {views.length > 0 && <span className="text-xs font-medium text-gray-400">Saved:</span>}
      {views.map(v => <span key={v.id} className={cn("group inline-flex items-center rounded-full border text-xs font-medium transition-colors", v.query === filterQuery ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-gray-200 bg-white text-gray-700 hover:border-gray-300")}>
        <Link to={withView(v.query)} className="py-1 pl-2.5 pr-1">{v.name}</Link>
        <button type="button" aria-label={`Remove saved filter ${v.name}`} onClick={() => run(() => db.remove("saved_views", { id: v.id }), `Filter "${v.name}" removed`)} className="rounded-full p-1 text-gray-400 hover:text-rose-600"><X className="h-3 w-3" /></button></span>)}
      {naming === null ? (!current && filterQuery && <button type="button" onClick={() => setNaming("")} className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-indigo-300 hover:text-indigo-600"><BookmarkPlus className="h-3.5 w-3.5" />Save this filter</button>)
        : <span className="inline-flex items-center gap-1.5"><Input autoFocus value={naming} onChange={e => setNaming(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveView(); if (e.key === "Escape") setNaming(null); }} placeholder="Name, e.g. JML open" aria-label="Name of the filter" className="h-7 w-44 border-gray-300 text-xs" />
          <Button size="sm" className="h-7 px-2.5 text-xs" onClick={saveView} disabled={!naming.trim()}>Save</Button><Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setNaming(null)}>Cancel</Button></span>}
    </div>

    {view === "board" ? <Board orders={shown} showDone={status === "all" || status === "completed"} flagOf={flagOf} typeOf={typeOf} /> :
      <Section>
        <DataTable rows={shown} exportName="orders" rowTo={o => orderPath(o)} empty="No orders match this filter" selectable bulk={(sel, clear) => <OrdersBulk rows={sel} clear={clear} />}
          cols={[
            { key: "pi_number", header: "PI#", render: o => <span className="inline-flex items-center gap-1.5 font-semibold text-gray-900">{o.pi_number ?? <span className="font-normal text-gray-400">draft</span>}
                {flagOf(o.id) && <Flag className="h-3.5 w-3.5 text-amber-500" aria-label={flagOf(o.id)}><title>{flagOf(o.id)}</title></Flag>}</span> },
            { key: "customer_name", header: "Customer", render: o => <div><div className="text-gray-900">{o.customer_name}</div><div className="text-xs text-gray-500">{typeOf(o)}</div></div> },
            { key: "customer_po", header: "Customer PO", render: o => o.customer_po ?? <span className="text-gray-400">–</span>, edit: { kind: "text", save: (o, v) => db.update("sales_orders", { id: o.id }, { customer_po: v }), can: o => !["completed", "cancelled"].includes(o.status) } },
            { key: "po_date", header: "PO date", render: o => date(o.po_date), edit: { kind: "date", save: (o, v) => db.update("sales_orders", { id: o.id }, { po_date: v }), can: o => !["completed", "cancelled"].includes(o.status) } },
            { key: "status", header: "Status", render: o => <StatusPill status={o.status} />, edit: { kind: "select", options: STATUS_ORDER.filter(s => s !== "draft").map(s => ({ value: s, label: STATUS_LABEL[s] })),
                save: (o, v) => db.update("sales_orders", { id: o.id }, { status: v }), can: o => !["completed", "cancelled", "draft"].includes(o.status) } },
            { key: "total_receivable", header: "Order total", align: "right", render: o => money(o.total_receivable, o.currency) },
            ...(!costs ? [] : [{ key: "margin_pct", header: "Margin", align: "right" as const, render: (o: any) => <span className={Number(o.cost_missing_lines) > 0 ? "text-amber-600" : ""} title={Number(o.cost_missing_lines) > 0 ? `${o.cost_missing_lines} line(s) without cost price` : undefined}>{marginPct(o.margin_pct, o.cost_missing_lines)}</span> }]),
            { key: "outstanding", header: "Outstanding", align: "right", render: o => <span className={Number(o.overdue_amount) > 0 ? "font-semibold text-rose-600" : Number(o.outstanding) > 0.01 ? "font-medium text-gray-900" : "text-gray-400"}>{money(o.outstanding, o.currency)}</span> },
            { key: "payment_status", header: "Payment", render: o => <PaymentPill status={o.payment_status} /> },
            { key: "balance_due_date", header: "Due", render: o => Number(o.overdue_amount) > 0 ? <span className="font-semibold text-rose-600">{days(o.days_late)} late</span>
                : o.reminder_due ? <span className="text-amber-600">reminder</span> : (o.balance_due_date ?? o.deposit_due_date) ? date(o.balance_due_date ?? o.deposit_due_date) : <span className="text-gray-400">no due date</span> },
          ]} />
      </Section>}
  </>;
}

// ---------------- several orders at once ----------------
function OrdersBulk({ rows, clear }: { rows: any[]; clear: () => void }) {
  const { db, refresh } = useApp();
  const [title, setTitle] = useState(""); const [due, setDue] = useState(""); const [busy, setBusy] = useState(false);
  // one by one, so one refused order (a rule in the database) does not stop the others
  const each = async (what: string, fn: (o: any) => Promise<unknown>) => {
    setBusy(true); let ok = 0; const failed: string[] = [];
    for (const o of rows) { try { await fn(o); ok++; } catch (e) { failed.push(`${o.pi_number ?? "draft"}: ${errorText(e)}`); } }
    setBusy(false); refresh();
    if (ok) toast.success(`${what}: ${ok} order${ok === 1 ? "" : "s"}`);
    if (failed.length) toast.error(<div><b>Not changed ({failed.length})</b>{failed.slice(0, 5).map(f => <div key={f} className="text-xs">{f}</div>)}</div>, { duration: 12000 });
    if (!failed.length) clear();
  };
  return <div className="flex flex-wrap items-center gap-2">
    <select aria-label="Move selected to status" className={selectClass + " h-8 w-48"} value="" disabled={busy}
      onChange={e => { const s = e.target.value; if (s) each(`Status ${STATUS_LABEL[s]}`, o => db.update("sales_orders", { id: o.id }, { status: s })); }}>
      <option value="">Move to status…</option>{STATUS_ORDER.filter(s => s !== "draft").map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
    <span className="mx-1 h-5 w-px bg-indigo-200" />
    <Input aria-label="Task title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Task for each, e.g. Chase deposit" className="h-8 w-60 border-gray-300 bg-white text-sm" />
    <Input aria-label="Task due date" type="date" value={due} onChange={e => setDue(e.target.value)} className="h-8 w-36 border-gray-300 bg-white text-sm" />
    <Button size="sm" className="h-8" disabled={busy || !title.trim()} onClick={() => each("Task added", o => db.insert("tasks", { title: `${title.trim()} (PI ${o.pi_number ?? "draft"})`, due_date: due || null, sales_order_id: o.id }))}>Add task</Button>
  </div>;
}

// ---------------- board ----------------
function Board({ orders, showDone, flagOf, typeOf }: { orders: any[]; showDone: boolean; flagOf: (id: string) => string; typeOf: (o: any) => string }) {
  const { db, run } = useApp(); const nav = useNav();
  const tasks = useRows("v_tasks", { eq: { status: "open" } }).rows;
  const [over, setOver] = useState<string | null>(null); const [dragging, setDragging] = useState<any>(null);
  const columns = useMemo(() => {
    const cols = STATUS_ORDER.filter(s => s !== "completed" && (s !== "draft" || orders.some(o => o.status === "draft")));
    if (showDone) cols.push("completed");
    return cols;
  }, [orders, showDone]);
  const drop = (e: DragEvent, to: string) => {
    e.preventDefault(); setOver(null);
    const o = dragging; setDragging(null);
    if (!o || o.status === to) return;
    if (to === "draft") return;
    run(() => db.update("sales_orders", { id: o.id }, { status: to }), `PI ${o.pi_number ?? "draft"}: ${STATUS_LABEL[to]}`);
  };
  const sums = (rows: any[]) => Object.entries(rows.reduce((a: Record<string, number>, o) => ({ ...a, [o.currency]: (a[o.currency] ?? 0) + Number(o.total_receivable) }), {}));
  return <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
    <div className="flex min-w-max gap-4">
      {columns.map(s => { const rows = orders.filter(o => o.status === s);
        return <section key={s} onDragOver={e => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(x => x === s ? null : x)} onDrop={e => drop(e, s)}
          aria-label={STATUS_LABEL[s]} className={cn("flex w-64 shrink-0 flex-col rounded-xl border bg-gray-100/70 transition-colors", over === s && dragging && dragging.status !== s ? "border-indigo-400 bg-indigo-50/60" : "border-transparent")}>
          <header className="px-3 pb-2 pt-3">
            <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-gray-900">{STATUS_LABEL[s]}</h2><span className="rounded-full bg-white px-1.5 text-[11px] font-medium tabular-nums text-gray-600">{rows.length}</span></div>
            <div className="mt-0.5 text-xs tabular-nums text-gray-500">{sums(rows).map(([c, v]) => money(v, c, 0)).join(" · ") || " "}</div>
          </header>
          <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
            {rows.map(o => { const late = Number(o.overdue_amount) > 0; const t = tasks.filter(x => x.sales_order_id === o.id).length;
              return <article key={o.id} draggable onDragStart={e => { setDragging(o); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", o.id); }} onDragEnd={() => { setDragging(null); setOver(null); }}
                onClick={() => nav(orderPath(o))} className={cn("cursor-pointer rounded-lg border bg-white p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing", late ? "border-rose-200" : "border-gray-200", dragging?.id === o.id && "opacity-50")}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-gray-900">{o.pi_number ? `PI ${o.pi_number}` : "Draft"}</span>
                  <span className="text-xs text-gray-400">{typeOf(o)}</span>
                </div>
                <div className="mt-0.5 truncate text-sm text-gray-700">{o.customer_name}</div>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <div className="text-sm tabular-nums text-gray-900">{money(o.total_receivable, o.currency, 0)}</div>
                  <PaymentPill status={o.payment_status} />
                </div>
                {flagOf(o.id) && <div className="mt-2 flex items-center gap-1 text-xs font-medium text-amber-700"><Flag className="h-3 w-3" />{flagOf(o.id)}</div>}
                {(late || o.reminder_due || t > 0) && <div className="mt-2 flex flex-wrap gap-x-2 border-t border-gray-100 pt-1.5 text-xs">
                  {late && <span className="font-medium text-rose-600">{money(o.overdue_amount, o.currency, 0)} {days(o.days_late)} late</span>}
                  {!late && o.reminder_due && <span className="text-amber-700">payment reminder</span>}
                  {t > 0 && <span className="text-gray-500">{t} task{t === 1 ? "" : "s"}</span>}
                </div>}
              </article>; })}
            {!rows.length && <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-300 py-6 text-xs text-gray-400">Drop an order here</div>}
          </div>
        </section>; })}
    </div>
  </div>;
}

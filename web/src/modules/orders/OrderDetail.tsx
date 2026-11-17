import { useMemo, useState } from "react";
import { AlertTriangle, Ban, ClipboardList, Copy, FileText, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useRows } from "@/app/store";
import { Link, useParams } from "@/app/router";
import { customerPath, orderPath, poPath, shipmentPath } from "@/app/paths";
import { ConfirmDialog, DataTable, KV, LinkButton, Loading, NotFound, PageHeader, PaymentPill, Pill, Section, SeverityPill, Stat, StatusPill, selectClass } from "@/app/ui";
import { date, money, marginPct, pct, qty, SOURCE_LABEL, STATUS_LABEL, STATUS_ORDER, SHIP_LABEL } from "@/app/format";
import { useOrder } from "./data";

export default function OrderDetail() {
  const { ref } = useParams();
  const { db, run } = useApp();
  const { o, loading } = useOrder(ref);
  const id = o?.id ?? null;
  const lines = useRows(id && "v_order_lines", { eq: { sales_order_id: id }, order: [["line_no", "asc"]] }).rows;
  const allocs = useRows(id && "v_allocations", { eq: { sales_order_id: id }, order: [["payment_date", "asc"]] }).rows;
  const adjustments = useRows(id && "order_adjustments", { eq: { sales_order_id: id } }).rows;
  const writeOffs = useRows(id && "write_offs", { eq: { sales_order_id: id } }).rows;
  const shipLinks = useRows(id && "shipment_orders", { eq: { sales_order_id: id } }).rows;
  const shipments = useRows("v_shipments").rows;
  const attention = useRows("v_attention").rows;
  const history = useRows(id && "audit_log", { eq: { row_id: id }, order: [["id", "desc"]], limit: 30 }).rows;
  const products = useRows("products").rows;
  const pos = useRows("v_purchase_orders").rows;
  const stock = useRows("v_batch_item_stock").rows;
  const customers = useRows("customers").rows;
  const [confirm, setConfirm] = useState<null | { title: string; body: string; label: string; go: () => void }>(null);
  const pName = useMemo(() => Object.fromEntries(products.map(p => [p.id, p.name])), [products]);
  const po = useMemo(() => Object.fromEntries(pos.map(p => [p.id, p])), [pos]);
  const batchNo = useMemo(() => Object.fromEntries(stock.map(s => [s.batch_item_id, s.batch_number])), [stock]);

  if (!o) return loading ? <Loading what="Loading order…" /> : <NotFound what={`Order ${ref}`} back={{ to: "/orders", label: "All orders" }} />;
  const cur = o.currency; const locked = ["completed", "cancelled"].includes(o.status);
  const base = orderPath(o);
  const mine = attention.filter(a => a.entity_id === o.id || lines.some(l => l.id === a.entity_id));
  const shipment = shipments.find(s => shipLinks.some(l => l.shipment_id === s.id));
  const customer = customers.find(c => c.id === o.customer_id);
  const late = Number(o.overdue_amount) > 0;
  const withoutPo = lines.filter(l => !l.purchase_order_id && Number(l.qty) > 0);
  const poButton = !locked && withoutPo.length > 0 && <LinkButton size="sm" to={`${base}/purchase-order`}><ClipboardList />Create PO{withoutPo.length < lines.length ? ` (${withoutPo.length} line${withoutPo.length === 1 ? "" : "s"})` : ""}</LinkButton>;

  return <>
    <PageHeader back={{ to: "/orders", label: "Orders" }}
      title={<span className="flex flex-wrap items-center gap-3">{o.pi_number ? `PI ${o.pi_number}` : "Draft order"}<StatusPill status={o.status} /><PaymentPill status={o.payment_status} /></span>}
      sub={<>{customer ? <Link to={customerPath(customer)} className="text-gray-700 hover:text-indigo-600">{o.customer_name}</Link> : o.customer_name} · {o.order_type} · {cur}{o.customer_po ? ` · customer PO ${o.customer_po}` : ""}</>}>
      {!locked && <select aria-label="Order status" className={selectClass + " w-52"} value={o.status} onChange={e => run(() => db.update("sales_orders", { id: o.id }, { status: e.target.value }), "Status updated")}>
        {STATUS_ORDER.filter(s => s !== "draft" || o.status === "draft").map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>}
      {!["draft", "cancelled"].includes(o.status) && <LinkButton to={`${base}/payment`}><Receipt />Register payment</LinkButton>}
      <LinkButton to={`${base}/edit`} variant="outline"><Pencil />Edit</LinkButton>
      {o.pi_number && <LinkButton to={`${base}/pi`} variant="outline"><FileText />PI (PDF)</LinkButton>}
      {o.pi_number && <LinkButton to={`/orders/new?from=${encodeURIComponent(o.pi_number)}`} variant="outline"><Copy />Repeat order</LinkButton>}
      {!locked && o.status_rank < 60 && <Button variant="outline" className="text-rose-600" onClick={() => setConfirm({ title: "Cancel this order?", label: "Cancel order",
        body: "The order leaves revenue and open amounts. Payments already received stay visible as customer credit. This cannot be undone.",
        go: () => run(() => db.update("sales_orders", { id: o.id }, { status: "cancelled" }), "Order cancelled") })}><Ban className="h-4 w-4" />Cancel order</Button>}
    </PageHeader>

    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat label="Total to receive" value={money(o.total_receivable, cur)} hint={Number(o.adjustments) ? `incl. corrections ${money(o.adjustments, cur)}` : `${o.line_count} line${o.line_count === 1 ? "" : "s"}`} />
      <Stat label="Received" value={money(o.paid, cur)} hint={Number(o.written_off) ? `written off ${money(o.written_off, cur)}` : o.last_payment_date ? `last on ${date(o.last_payment_date)}` : "nothing yet"} />
      <Stat label="Outstanding" value={money(o.outstanding, cur)} tone={late ? "bad" : Number(o.outstanding) > 0.01 ? "warn" : "good"}
        hint={late ? `${money(o.overdue_amount, cur)} overdue, ${o.days_late} days` : o.reminder_due ? "EXW reminder due" : Number(o.outstanding) > 0.01 ? (o.balance_due_date || o.deposit_due_date ? `due ${date(Number(o.deposit_outstanding) > 0.01 && o.deposit_due_date ? o.deposit_due_date : o.balance_due_date)}` : "no due date set") : "fully paid"} />
      <Stat label="Margin" value={money(o.margin, cur)} tone={Number(o.cost_missing_lines) > 0 ? "warn" : undefined}
        hint={Number(o.cost_missing_lines) > 0 ? `incomplete: ${o.cost_missing_lines} line(s) without cost price` : marginPct(o.margin_pct, 0)} />
    </div>

    {mine.length > 0 && <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-4">
      <div className="mb-2 flex items-center text-sm font-semibold text-amber-900"><AlertTriangle className="mr-1.5 h-4 w-4" />Next actions</div>
      <ul className="space-y-1.5 text-sm text-amber-950">{mine.map((a, i) => <li key={i} className="flex items-center gap-2"><SeverityPill s={a.severity} />{a.message}
        {a.code === "stock_sale_without_po" && !locked && <Link to={`${base}/purchase-order`} className="ml-1 font-medium text-indigo-600 hover:underline">Create PO</Link>}</li>)}</ul></div>}

    <div className="mb-6 grid gap-6 lg:grid-cols-2">
      <Section title="Payment schedule" action={!locked && <Link to={`${base}/edit`} className="text-xs font-medium text-indigo-600 hover:underline">Set due dates</Link>}>
        <KV items={[
          [`Deposit ${pct(o.deposit_pct, 0)}`, <>{money(o.deposit_due, cur)} {Number(o.deposit_due) > 0 && (Number(o.deposit_outstanding) <= 0.01 ? <Pill tone="green">received</Pill> : <Pill tone="amber">{money(o.deposit_outstanding, cur)} open</Pill>)}</>],
          ["Deposit due", o.deposit_due_date ? date(o.deposit_due_date) : o.order_type === "EXW" ? "before pick-up" : <span className="text-gray-400">not set</span>],
          ["Balance", money(o.balance_due, cur)],
          ["Balance due", o.balance_due_date ? date(o.balance_due_date) : o.order_type === "FOB" ? <span className="text-gray-400">10 days before ETA (ETA unknown)</span> : <span className="text-gray-400">not set</span>],
          ...(o.order_type === "EXW" ? [["Reminder from", date(o.reminder_date)] as [any, any]] : []),
        ]} />
      </Section>
      <Section title="Order">
        <KV items={[
          ["PO date", date(o.po_date)], ["PI sent", date(o.pi_date)],
          ["Invoice", o.invoice_number ? `${o.invoice_number} · ${date(o.invoice_date)}` : locked ? "–" : <Link to={`${base}/invoice`} className="text-indigo-600 hover:underline">Register invoice</Link>],
          ["Shipment", shipment ? <Link to={shipmentPath(shipment, "/edit")} className="text-indigo-600 hover:underline">{SHIP_LABEL[shipment.status]}{shipment.eta ? ` · ETA ${date(shipment.eta)}` : ""}</Link> : <span className="text-gray-400">none yet</span>],
          ["Note", o.notes ?? "–"],
        ]} />
      </Section>
    </div>

    <Section title="Order lines" className="mb-6" action={!locked && <span className="flex gap-2">{poButton}<LinkButton size="sm" variant="outline" to={`${base}/lines/new`}><Plus />Add line</LinkButton></span>}>
      <DataTable rows={lines} empty="No lines yet. Add the first product." exportName={`order-${o.pi_number ?? "draft"}-lines`}
        rowTo={locked ? undefined : l => `${base}/lines/${l.line_no}`}
        cols={[
          { key: "line_no", header: "#", width: "2.5rem" },
          { key: "product", header: "Product", value: l => pName[l.product_id], render: l => <div><div className="font-medium text-gray-900">{pName[l.product_id]}</div>{l.notes && <div className="text-xs text-gray-500">{l.notes}</div>}</div> },
          { key: "qty", header: "Qty", align: "right", render: l => <>{qty(l.qty)}{l.quantity_cancelled > 0 && <div className="text-xs text-rose-600">{qty(l.quantity_cancelled)} cancelled</div>}</> },
          { key: "unit_price", header: "Price", align: "right", render: l => money(l.unit_price, cur) },
          { key: "unit_cost", header: "Cost", align: "right", render: l => l.unit_cost == null ? <Pill tone="red">missing</Pill>
              : <div>{money(l.unit_cost, cur, 3)}<div className="text-xs text-gray-500">{SOURCE_LABEL[l.cost_source]}{l.cost_is_final ? " · final" : ""} · <Link to={`${base}/lines/${l.line_no}/cost`} className="underline hover:text-gray-900">why?</Link></div></div> },
          { key: "revenue", header: "Revenue", align: "right", render: l => money(l.revenue, cur) },
          { key: "margin", header: "Margin", align: "right", render: l => <span className={Number(l.margin) < 0 ? "font-semibold text-rose-600" : ""}>{money(l.margin, cur)}<div className="text-xs text-gray-500">{marginPct(l.margin_pct, l.cost_known === false ? 1 : 0)}</div></span> },
          { key: "po", header: "Our PO", value: l => po[l.purchase_order_id]?.po_number, render: l => po[l.purchase_order_id] ? <Link to={poPath(po[l.purchase_order_id])} className="text-indigo-600 hover:underline">{po[l.purchase_order_id].po_number}</Link>
              : !locked && Number(l.qty) > 0 ? <Link to={`${base}/purchase-order`} className="text-xs font-medium text-amber-700 hover:underline">no PO · create</Link> : "–" },
          { key: "batch", header: "Batch", value: l => batchNo[l.batch_item_id], render: l => batchNo[l.batch_item_id] ?? "–" },
          { key: "act", header: "", width: "3rem", render: l => locked ? null : <Button size="icon" variant="ghost" aria-label={`Remove line ${l.line_no}`} className="h-7 w-7 text-gray-400 hover:text-rose-600"
              onClick={e => { e.stopPropagation(); setConfirm({ title: "Remove this line?", label: "Remove line", body: `${pName[l.product_id]}, ${qty(l.quantity)} pieces. To keep the history, set "quantity cancelled" on the line instead.`,
                go: () => run(() => db.remove("sales_order_lines", { id: l.id }), "Line removed") }); }}><Trash2 className="h-3.5 w-3.5" /></Button> },
        ]} />
    </Section>

    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Payments and corrections" action={!locked && <span className="flex gap-2">
        <LinkButton size="sm" variant="outline" to={`${base}/correction`}>Correction</LinkButton>
        <LinkButton size="sm" variant="outline" to={`${base}/write-off`}>Write-off</LinkButton></span>}>
        <DataTable dense empty="No payments registered yet" rows={[
            ...allocs.map(a => ({ id: a.id, d: a.payment_date, what: a.voided_at ? "Payment (voided)" : "Payment", ref: a.reference, amount: a.amount, voided: !!a.voided_at, pid: a.payment_id })),
            ...adjustments.map(a => ({ id: a.id, d: String(a.created_at).slice(0, 10), what: "Correction", ref: a.reason, amount: a.amount })),
            ...writeOffs.map(a => ({ id: a.id, d: a.write_off_date, what: "Write-off", ref: a.reason, amount: a.amount })),
          ].sort((a, b) => String(a.d).localeCompare(String(b.d)))}
          cols={[{ key: "d", header: "Date", render: r => date(r.d) }, { key: "what", header: "Type" }, { key: "ref", header: "Reference / reason" },
            { key: "amount", header: "Amount", align: "right", render: (r: any) => <span className={r.voided ? "text-gray-400 line-through" : ""}>{money(r.amount, cur)}</span> },
            { key: "x", header: "", render: (r: any) => r.pid && !r.voided ? <Link to={`/payments/${String(r.pid).slice(0, 8)}/void?back=${encodeURIComponent(base)}`} className="text-xs text-rose-600 hover:underline">void</Link> : null }]} />
      </Section>
      <Section title="History">
        <DataTable dense rows={history} empty="No changes logged"
          cols={[{ key: "changed_at", header: "When", render: a => String(a.changed_at).slice(0, 16).replace("T", " ") },
            { key: "what", header: "Change", render: a => a.action === "INSERT" ? "Order created"
              : Object.keys(a.new_data ?? {}).filter(k => JSON.stringify(a.new_data[k]) !== JSON.stringify(a.old_data?.[k]))
                  .map(k => `${k.replace(/_/g, " ")}: ${k === "status" ? `${STATUS_LABEL[a.old_data?.[k]] ?? "–"} → ${STATUS_LABEL[a.new_data[k]]}` : `${a.old_data?.[k] ?? "–"} → ${a.new_data[k] ?? "–"}`}`).join("; ") }]} />
      </Section>
    </div>
    <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={confirm?.title ?? ""} body={confirm?.body} confirmLabel={confirm?.label} onConfirm={() => confirm?.go()} />
  </>;
}

import { OrderCosts } from "@/modules/costs/LandedCosts";
import { incotermHint, incotermText } from "./incoterms";
import { OrderRuleChecks } from "@/modules/admin/ValidationRules";
import { useCan } from "@/app/permissions";
import { OrderApproval } from "@/modules/approvals/Approvals";
import { OrderShipment, OrderSupplierPayments } from "./OrderSupply";
import { useMemo, useState } from "react";
import { AlertTriangle, Ban, Flag, ClipboardList, Copy, FileText, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useRows } from "@/app/store";
import { Link, useNav, useParams } from "@/app/router";
import { customerPath, orderPath, poPath, shipmentPath } from "@/app/paths";
import { ConfirmDialog, DataTable, KV, LinkButton, Loading, NotFound, PageHeader, PaymentPill, Pill, Section, SeverityPill, Stat, StatusPill, selectClass, type Col } from "@/app/ui";
import { date, money, marginPct, pct, qty, SOURCE_LABEL, STATUS_LABEL, STATUS_ORDER, SHIP_LABEL, termWhen } from "@/app/format";
import { useOrder } from "./data";
import { OrderTimeline } from "./Timeline";
import { OrderPath } from "./OrderPath";
import { BlockGrid, CustomizeButton, useLayout } from "@/app/Layout";
import { FavoriteStar, useRecord } from "@/app/Favorites";
import { TasksSection, newTaskPath } from "@/modules/tasks/Tasks";
import { DocumentsSection } from "@/modules/documents/Documents";
import { ShippingDocumentsSection } from "@/modules/documents/ShippingDocument";

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
  const terms = useRows("payment_terms").rows;
  const flags = useRows(id && "v_order_flags", { eq: { sales_order_id: id } }).rows;
  const delivery = useRows(id && "v_order_delivery", { eq: { sales_order_id: id } }).rows[0];
  const products = useRows("products").rows;
  const pos = useRows("v_purchase_orders").rows;
  const stock = useRows("v_batch_item_stock").rows;
  const customers = useRows("customers").rows;
  const [confirm, setConfirm] = useState<null | { title: string; body: string; label: string; go: () => void }>(null);
  const pName = useMemo(() => Object.fromEntries(products.map(p => [p.id, p.name])), [products]);
  const po = useMemo(() => Object.fromEntries(pos.map(p => [p.id, p])), [pos]);
  const batchNo = useMemo(() => Object.fromEntries(stock.map(s => [s.batch_item_id, s.batch_number])), [stock]);

  const rec = o ? { type: "order" as const, id: o.id, label: o.pi_number ? `PI ${o.pi_number}` : "Draft order", path: orderPath(o), sub: o.customer_name } : null;
  useRecord(rec);
  const lay = useLayout("order"); const nav = useNav(); const can = useCan(); const costs = can("see_costs");
  if (!o) return loading ? <Loading what="Loading order…" /> : <NotFound what={`Order ${ref}`} back={{ to: "/orders", label: "All orders" }} />;
  const cur = o.currency; const locked = ["completed", "cancelled"].includes(o.status);
  const base = orderPath(o);
  const mine = attention.filter(a => a.entity_id === o.id || lines.some(l => l.id === a.entity_id));
  const shipment = shipments.find(s => shipLinks.some(l => l.shipment_id === s.id));
  const customer = customers.find(c => c.id === o.customer_id);
  const late = Number(o.overdue_amount) > 0;
  const withoutPo = lines.filter(l => !l.purchase_order_id && Number(l.qty) > 0);
  const term = terms.find(t => t.id === o.payment_term_id);
  const open = Number(o.outstanding) > 0.01;
  // where a due date comes from: typed on the order, the payment term, or nothing yet (and why)
  const dueText = (d: any, set: boolean, anchor: string | null, days: any) => d
    ? <span>{date(d)} <span className="text-xs text-gray-400">{set ? "set on this order" : term ? termWhen(anchor, days) : ""}</span></span>
    : <span className="text-gray-400">{term && anchor ? `${termWhen(anchor, days)}: that date is not known yet` : "not set"}</span>;
  const chase = Number(o.deposit_outstanding) > 0.01 ? { what: "deposit", due: o.deposit_due_date } : { what: "payment", due: o.balance_due_date ?? o.deposit_due_date };
  const poButton = !locked && withoutPo.length > 0 && <LinkButton size="sm" to={`${base}/purchase-order`}><ClipboardList />Create PO{withoutPo.length < lines.length ? ` (${withoutPo.length} line${withoutPo.length === 1 ? "" : "s"})` : ""}</LinkButton>;

  return <>
    <PageHeader back={{ to: "/orders", label: "Orders" }}
      title={<span className="flex flex-wrap items-center gap-3">{o.pi_number ? `PI ${o.pi_number}` : "Draft order"}<StatusPill status={o.status} /><PaymentPill status={o.payment_status} />{rec && <FavoriteStar r={rec} />}</span>}
      sub={<>{customer ? <Link to={customerPath(customer)} className="text-gray-700 hover:text-indigo-600">{o.customer_name}</Link> : o.customer_name} · {o.order_type} · {cur}{delivery && delivery.incoterm !== o.order_type ? ` · ${incotermText(delivery.incoterm, delivery.delivery_place)}` : ""}{o.customer_po ? ` · customer PO ${o.customer_po}` : ""}</>}>
      {!["draft", "cancelled"].includes(o.status) && can("register_payments") && <LinkButton to={`${base}/payment`}><Receipt />Register payment</LinkButton>}
      <LinkButton to={`${base}/edit`} variant="outline"><Pencil />Edit</LinkButton>
      {o.pi_number && <LinkButton to={`${base}/pi`} variant="outline"><FileText />PI (PDF)</LinkButton>}
      {o.invoice_number && <LinkButton to={`${base}/commercial-invoice`} variant="outline"><FileText />Invoice (PDF)</LinkButton>}
      {o.pi_number && <LinkButton to={`/orders/new?from=${encodeURIComponent(o.pi_number)}`} variant="outline"><Copy />Repeat order</LinkButton>}
      <CustomizeButton lay={lay} />
      {!locked && o.status_rank < 60 && <Button variant="outline" className="text-rose-600" onClick={() => setConfirm({ title: "Cancel this order?", label: "Cancel order",
        body: "The order leaves revenue and open amounts. Payments already received stay visible as customer credit. This cannot be undone.",
        go: () => run(() => db.update("sales_orders", { id: o.id }, { status: "cancelled" }), "Order cancelled") })}><Ban className="h-4 w-4" />Cancel order</Button>}
      {can("delete_records") && (o.status === "draft" || o.status === "cancelled") && <Button variant="ghost" className="text-rose-600" onClick={() => setConfirm({ title: `Delete ${o.pi_number ? `PI ${o.pi_number}` : "this draft"}?`, label: "Delete order",
        body: "The order, its lines, tasks, notes and documents go to the recycle bin and can be restored there for 30 days (Admin → Recycle bin). An order with payments, a shipment or an invoice cannot be deleted.",
        go: () => run(async () => { await db.remove("sales_orders", { id: o.id }); return true; }, "Order deleted; restore it from Admin → Recycle bin within 30 days").then(ok => { if (ok) nav("/orders"); }) })}><Trash2 className="h-4 w-4" />Delete</Button>}
    </PageHeader>

    <BlockGrid lay={lay} blocks={[
      { id: "path", title: "Status path", node: <div className="space-y-3"><OrderApproval o={o} /><OrderRuleChecks o={o} /><OrderPath o={o} lines={lines} shipment={shipment} customer={customer} />
        {flags.length > 0 && <div className="-mt-3 flex flex-wrap gap-2">{flags.map(f => <span key={f.rule_id ?? f.flag_text} title={f.rule_id ? `Rule: ${f.rule_name}` : f.rule_name} className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800"><Flag className="h-3.5 w-3.5" />{f.flag_text}</span>)}</div>}</div> },
      { id: "stats", title: "Key figures", node: <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat label="Total to receive" value={money(o.total_receivable, cur)} hint={[Number(o.vat_amount) ? `incl. VAT ${money(o.vat_amount, cur)}` : null, Number(o.adjustments) ? `incl. corrections ${money(o.adjustments, cur)}` : null].filter(Boolean).join(" · ") || `${o.line_count} line${o.line_count === 1 ? "" : "s"}`} />
      <Stat label="Received" value={money(o.paid, cur)} hint={Number(o.written_off) ? `written off ${money(o.written_off, cur)}` : o.last_payment_date ? `last on ${date(o.last_payment_date)}` : "nothing yet"} />
      <Stat label="Outstanding" value={money(o.outstanding, cur)} tone={late ? "bad" : Number(o.outstanding) > 0.01 ? "warn" : "good"}
        hint={late ? `${money(o.overdue_amount, cur)} overdue, ${o.days_late} days` : o.reminder_due ? "EXW reminder due" : Number(o.outstanding) > 0.01 ? (o.balance_due_date || o.deposit_due_date ? `due ${date(Number(o.deposit_outstanding) > 0.01 && o.deposit_due_date ? o.deposit_due_date : o.balance_due_date)}` : "no due date set") : "fully paid"} />
      {costs && <Stat label="Margin" value={money(o.margin, cur)} tone={Number(o.cost_missing_lines) > 0 ? "warn" : undefined}
        hint={Number(o.cost_missing_lines) > 0 ? `incomplete: ${o.cost_missing_lines} line(s) without cost price` : marginPct(o.margin_pct, 0)} />}
    </div> },
      { id: "actions", title: "Next actions", node: mine.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-4">
      <div className="mb-2 flex items-center text-sm font-semibold text-amber-900"><AlertTriangle className="mr-1.5 h-4 w-4" />Next actions</div>
      <ul className="space-y-1.5 text-sm text-amber-950">{mine.map((a, i) => <li key={i} className="flex items-center gap-2"><SeverityPill s={a.severity} />{a.message}
        {a.code === "stock_sale_without_po" && !locked && <Link to={`${base}/purchase-order`} className="ml-1 font-medium text-indigo-600 hover:underline">Create PO</Link>}
        {a.code === "transport_cost_missing" && <Link to={`/costs/new?order=${o.id}&kind=freight&back=${encodeURIComponent(base)}`} className="ml-1 font-medium text-indigo-600 hover:underline">Add transport cost</Link>}</li>)}</ul></div> },
      { id: "schedule", title: "Payment schedule", size: "half", node: <Section title="Payment schedule" sub={term ? term.name : "No payment term on this order"}
        action={!locked && <Link to={`${base}/edit`} className="text-xs font-medium text-indigo-600 hover:underline">Change term or dates</Link>}>
        <KV items={[
          [`Deposit ${pct(o.deposit_pct, 0)}`, <>{money(o.deposit_due, cur)} {Number(o.deposit_due) > 0 && (Number(o.deposit_outstanding) <= 0.01 ? <Pill tone="green">received</Pill> : <Pill tone="amber">{money(o.deposit_outstanding, cur)} open</Pill>)}</>],
          ...(Number(o.deposit_due) > 0 ? [["Deposit due", dueText(o.deposit_due_date, o.deposit_due_date_set, term?.deposit_anchor, term?.deposit_days)] as [any, any]] : []),
          ...(Number(o.deposit_pct) < 1 ? [["Balance", money(o.balance_due, cur)] as [any, any],
            ["Balance due", term || o.balance_due_date ? dueText(o.balance_due_date, o.balance_due_date_set, term?.balance_anchor, term?.balance_days)
              : o.order_type === "FOB" ? <span className="text-gray-400">10 days before ETA (ETA unknown)</span> : <span className="text-gray-400">not set</span>] as [any, any]] : []),
          ...(o.order_type === "EXW" ? [["Reminder from", date(o.reminder_date)] as [any, any]] : []),
        ]} />
        {open && !["draft", "cancelled"].includes(o.status) && <div className="border-t border-gray-100 px-5 py-2.5">
          <Link to={newTaskPath({ order: o.pi_number ?? `draft-${o.id.slice(0, 8)}`, title: `Chase ${chase.what} ${o.pi_number ? `PI ${o.pi_number} ` : ""}(${o.customer_name})`, due: chase.due, back: base })}
            className="text-xs font-medium text-indigo-600 hover:underline">+ Reminder to chase the {chase.what}</Link></div>}
      </Section> },
      { id: "details", title: "Order details", size: "half", node: <Section title="Order">
        <KV items={[
          ["PO date", date(o.po_date)], ["PI sent", date(o.pi_date)],
          ["Delivery", delivery ? <span title={incotermHint(delivery.incoterm)}>{incotermText(delivery.incoterm, delivery.delivery_place)}{delivery.we_arrange_transport && <span className="text-gray-500"> · we arrange transport</span>}</span> : "–"],
          ["Invoice", o.invoice_number ? `${o.invoice_number} · ${date(o.invoice_date)}` : locked ? "–" : <Link to={`${base}/invoice`} className="text-indigo-600 hover:underline">Register invoice</Link>],
          ["Shipment", shipment ? <Link to={shipmentPath(shipment, "/edit")} className="text-indigo-600 hover:underline">{SHIP_LABEL[shipment.status]}{shipment.eta ? ` · ETA ${date(shipment.eta)}` : ""}</Link> : <span className="text-gray-400">none yet</span>],
          ["Note", o.notes ?? "–"],
        ]} />
      </Section> },
      { id: "shipment", title: "Shipment", size: "half", node: <OrderShipment o={o} shipment={shipment} lines={lines} locked={locked} /> },
      { id: "costs", title: "Extra costs", size: "half", node: costs ? <OrderCosts o={o} lines={lines} shipment={shipment} /> : null },
      { id: "supplier_payments", title: "To pay suppliers", size: "half", node: costs ? <OrderSupplierPayments o={o} lines={lines} locked={locked} /> : null },
      { id: "lines", title: "Order lines", node: <Section title="Order lines" action={!locked && <span className="flex gap-2">{poButton}<LinkButton size="sm" variant="outline" to={`${base}/lines/new`}><Plus />Add line</LinkButton></span>}>
      <DataTable rows={lines} empty="No lines yet. Add the first product." exportName={`order-${o.pi_number ?? "draft"}-lines`}
        rowTo={locked ? undefined : l => `${base}/lines/${l.line_no}`}
        cols={([
          { key: "line_no", header: "#", width: "2.5rem" },
          { key: "product", header: "Product", value: l => pName[l.product_id], render: l => <div><div className="font-medium text-gray-900">{pName[l.product_id]}</div>{l.notes && <div className="text-xs text-gray-500">{l.notes}</div>}</div> },
          { key: "qty", header: "Qty", align: "right", render: l => <>{qty(l.qty)}{l.quantity_cancelled > 0 && <div className="text-xs text-rose-600">{qty(l.quantity_cancelled)} cancelled</div>}</> },
          { key: "unit_price", header: "Price", align: "right", render: l => money(l.unit_price, cur) },
          { key: "unit_cost", header: "Cost", align: "right", render: l => l.unit_cost == null ? <Pill tone="red">missing</Pill>
              : <div>{money(l.unit_cost, cur, 3)}<div className="text-xs text-gray-500">{SOURCE_LABEL[l.cost_source]}{l.cost_is_final ? " · final" : ""} · <Link to={`${base}/lines/${l.line_no}/cost`} className="underline hover:text-gray-900">why?</Link></div></div> },
          { key: "revenue", header: "Revenue", align: "right", render: l => money(l.revenue, cur) },
          ...(lines.some(l => Number(l.extra_costs)) ? [{ key: "extra_costs", header: "Extra costs", align: "right" as const, render: (l: any) => Number(l.extra_costs) ? money(l.extra_costs, cur) : "–" }] : []),
          { key: "margin", header: "Margin", align: "right", render: l => <span className={Number(l.margin) < 0 ? "font-semibold text-rose-600" : ""}>{money(l.margin, cur)}<div className="text-xs text-gray-500">{marginPct(l.margin_pct, l.cost_known === false ? 1 : 0)}</div></span> },
          { key: "po", header: "Our PO", value: l => po[l.purchase_order_id]?.po_number, render: l => po[l.purchase_order_id] ? <Link to={poPath(po[l.purchase_order_id])} className="text-indigo-600 hover:underline">{po[l.purchase_order_id].po_number}</Link>
              : !locked && Number(l.qty) > 0 ? <Link to={`${base}/purchase-order`} className="text-xs font-medium text-amber-700 hover:underline">no PO · create</Link> : "–" },
          { key: "batch", header: "Batch", value: l => batchNo[l.batch_item_id], render: l => batchNo[l.batch_item_id] ?? "–" },
          { key: "act", header: "", width: "3rem", render: l => locked || !can("delete_records") ? null : <Button size="icon" variant="ghost" aria-label={`Remove line ${l.line_no}`} className="h-7 w-7 text-gray-400 hover:text-rose-600"
              onClick={e => { e.stopPropagation(); setConfirm({ title: "Remove this line?", label: "Remove line", body: `${pName[l.product_id]}, ${qty(l.quantity)} pieces. It stays 30 days in Admin → Recycle bin. To keep the history, set "quantity cancelled" on the line instead.`,
                go: () => run(() => db.remove("sales_order_lines", { id: l.id }), "Line removed") }); }}><Trash2 className="h-3.5 w-3.5" /></Button> },
        ] as Col[]).filter(c => costs || !["unit_cost", "margin", "po", "extra_costs"].includes(c.key))} />
    </Section> },
      { id: "payments", title: "Payments and corrections", size: "half", node: <Section title="Payments and corrections" action={!locked && <span className="flex gap-2">
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
      </Section> },
      { id: "tasks", title: "Tasks", size: "half", node: <TasksSection eq={{ sales_order_id: o.id }} hide={["order", "customer"]} newLink={newTaskPath({ order: o.pi_number ?? `draft-${o.id.slice(0, 8)}`, back: base })} /> },
      { id: "timeline", title: "Timeline", size: "half", node: <OrderTimeline o={o} /> },
      { id: "shipping_docs", title: "Shipping documents", size: "half", node: <ShippingDocumentsSection o={o} /> },
      { id: "documents", title: "Documents", size: "half", node: <DocumentsSection entity="sales_orders" id={o.id} /> },
    ]} />
    <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={confirm?.title ?? ""} body={confirm?.body} confirmLabel={confirm?.label} onConfirm={() => confirm?.go()} />
  </>;
}

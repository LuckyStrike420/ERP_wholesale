import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Ban, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useNav, useRows } from "@/app/store";
import { ConfirmDialog, DataTable, FormDialog, KV, PageHeader, PaymentPill, Pill, Section, SeverityPill, StatusPill, selectClass, type Field } from "@/app/ui";
import { date, money, marginPct, pct, qty, SOURCE_LABEL, STATUS_LABEL, STATUS_ORDER, SHIP_LABEL, today } from "@/app/format";
import { orderFields } from "./Orders";

export default function OrderDetail({ id }: { id: string }) {
  const { db, run, save } = useApp(); const nav = useNav();
  const o = useRows("v_orders", { eq: { id } }).rows[0];
  const raw = useRows("sales_orders", { eq: { id } }).rows[0];
  const lines = useRows("v_order_lines", { eq: { sales_order_id: id }, order: [["line_no", "asc"]] }).rows;
  const allocs = useRows("v_allocations", { eq: { sales_order_id: id }, order: [["payment_date", "asc"]] }).rows;
  const adjustments = useRows("order_adjustments", { eq: { sales_order_id: id } }).rows;
  const writeOffs = useRows("write_offs", { eq: { sales_order_id: id } }).rows;
  const shipLinks = useRows("shipment_orders", { eq: { sales_order_id: id } }).rows;
  const shipments = useRows("v_shipments").rows;
  const attention = useRows("v_attention").rows;
  const history = useRows("audit_log", { eq: { row_id: id }, order: [["id", "desc"]], limit: 30 }).rows;
  const customers = useRows("customers", { order: [["name", "asc"]] }).rows;
  const products = useRows("products", { order: [["name", "asc"]] }).rows;
  const pos = useRows("v_purchase_orders", { order: [["po_number", "desc"]] }).rows;
  const stock = useRows("v_batch_item_stock").rows;
  const [dlg, setDlg] = useState<null | { kind: string; row?: any }>(null);
  const [belowBasis, setBelowBasis] = useState<null | { values: any; row?: any; basis: number }>(null);
  const [why, setWhy] = useState<null | { line: any; rows: any[] }>(null);
  const showWhy = async (l: any) => {
    try { setWhy({ line: l, rows: await db.rpc<any[]>("explain_unit_cost", { p_product: l.product_id, p_customer: o.customer_id, p_order_type: o.order_type, p_unit_price: l.unit_price,
      p_batch_item: l.batch_item_id, p_override: l.cost_override, p_date: l.line_date ?? o.po_date }) }); }
    catch (e) { toast.error(String((e as any)?.message ?? e)); }
  };
  const [confirm, setConfirm] = useState<null | { title: string; body: string; label: string; go: () => void }>(null);

  const pName = useMemo(() => Object.fromEntries(products.map(p => [p.id, p.name])), [products]);
  const poNo = useMemo(() => Object.fromEntries(pos.map(p => [p.id, p.po_number])), [pos]);
  const batchNo = useMemo(() => Object.fromEntries(stock.map(s => [s.batch_item_id, s.batch_number])), [stock]);
  if (!o || !raw) return <p className="text-sm text-muted-foreground">Loading order…</p>;
  const cur = o.currency; const locked = ["completed", "cancelled"].includes(o.status);
  const mine = attention.filter(a => a.entity_id === id || lines.some(l => l.id === a.entity_id));
  const shipment = shipments.find(s => shipLinks.some(l => l.shipment_id === s.id));

  const lineFields: Field[] = [
    { name: "product_id", label: "Product", type: "select", required: true, options: products.map(p => ({ value: p.id, label: p.name })) },
    { name: "quantity", label: "Quantity", type: "number", required: true, span: 1 },
    { name: "unit_price", label: `Sale price per piece (${cur})`, type: "number", required: true, span: 1 },
    { name: "purchase_order_id", label: "Our PO to the supplier", type: "select", span: 1, options: pos.filter(p => p.order_type === o.order_type).map(p => ({ value: p.id, label: `${p.po_number} · ${p.supplier_name}` })) },
    { name: "batch_item_id", label: "From NL stock (batch)", type: "select", span: 1, options: stock.map(s => ({ value: s.batch_item_id, label: `${s.batch_number} · ${s.product_name} (${s.stock} in stock)` })) },
    { name: "cost_override", label: `Purchase price override (${cur})`, type: "number", span: 1, hint: "Only for a one-off exception" },
    { name: "line_date", label: "Line date", type: "date", span: 1, hint: "Only if different from the PO date" },
    ...(dlg?.row ? [{ name: "quantity_cancelled", label: "Quantity cancelled", type: "number", span: 1 } as Field] : []),
    { name: "notes", label: "Note", type: "textarea" },
  ];
  const saveLine = async (v: any, row?: any) => {
    const body = { ...v, quantity_cancelled: v.quantity_cancelled ?? 0 };
    return save(() => row ? db.update("sales_order_lines", { id: row.id }, body)
      : db.insert("sales_order_lines", { ...body, sales_order_id: id, line_no: Math.max(0, ...lines.map(l => l.line_no)) + 1 }), "Line saved");
  };
  const submitLine = async (v: any) => {
    const c = (await db.rpc<any[]>("calc_unit_cost", { p_product: v.product_id, p_customer: o.customer_id, p_order_type: o.order_type, p_unit_price: v.unit_price,
      p_batch_item: v.batch_item_id, p_override: v.cost_override, p_date: v.line_date ?? o.po_date }))[0];
    if (c?.cost_basis != null && Number(v.unit_price) < Number(c.cost_basis)) { setBelowBasis({ values: v, row: dlg?.row, basis: Number(c.cost_basis) }); return; }
    return saveLine(v, dlg?.row);
  };

  return <>
    <button onClick={() => nav("orders")} className="mb-2 flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" />Orders</button>
    <PageHeader title={<span className="flex items-center gap-3">{o.pi_number ? `PI ${o.pi_number}` : "Draft order"}<StatusPill status={o.status} /><PaymentPill status={o.payment_status} /></span>}
      sub={`${o.customer_name} · ${o.order_type} · ${cur}${o.customer_po ? ` · customer PO ${o.customer_po}` : ""}`}>
      {!locked && <select className={selectClass + " w-52"} value={o.status} onChange={e => run(() => db.update("sales_orders", { id }, { status: e.target.value }), "Status updated")}>
        {STATUS_ORDER.filter(s => s !== "draft" || o.status === "draft").map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>}
      {!["draft", "cancelled"].includes(o.status) && <Button onClick={() => setDlg({ kind: "payment" })}><Plus className="mr-1 h-4 w-4" />Register payment</Button>}
      <Button variant="outline" onClick={() => setDlg({ kind: "header" })}><Pencil className="mr-1 h-4 w-4" />Edit</Button>
      {!locked && o.status_rank < 60 && <Button variant="outline" className="text-red-700" onClick={() => setConfirm({ title: "Cancel this order?", label: "Cancel order",
        body: "The order leaves revenue and open amounts. Payments already received stay visible as customer credit. This cannot be undone.",
        go: () => run(() => db.update("sales_orders", { id }, { status: "cancelled" }), "Order cancelled") })}><Ban className="mr-1 h-4 w-4" />Cancel order</Button>}
    </PageHeader>

    {mine.length > 0 && <div className="mb-5 rounded-md border border-amber-200 bg-amber-50/60 px-4 py-3">
      <div className="mb-1.5 flex items-center text-sm font-semibold text-amber-900"><AlertTriangle className="mr-1.5 h-4 w-4" />Next actions</div>
      <ul className="space-y-1 text-sm">{mine.map((a, i) => <li key={i} className="flex items-center gap-2"><SeverityPill s={a.severity} />{a.message}</li>)}</ul></div>}

    <div className="mb-5 grid gap-5 lg:grid-cols-3">
      <Section title="Money">
        <KV items={[
          ["Order value", money(o.order_value, cur)],
          ...(Number(o.adjustments) ? [["Corrections", money(o.adjustments, cur)] as [any, any]] : []),
          ["Total to receive", <b>{money(o.total_receivable, cur)}</b>],
          ["Received", money(o.paid, cur)],
          ...(Number(o.written_off) ? [["Written off", money(o.written_off, cur)] as [any, any]] : []),
          ["Outstanding", <b className={Number(o.overdue_amount) > 0 ? "text-red-700" : ""}>{money(o.outstanding, cur)}</b>],
          ["Margin", Number(o.cost_missing_lines) > 0 ? <span className="text-amber-700">{money(o.margin, cur)} · incomplete: {o.cost_missing_lines} line(s) without cost price</span> : `${money(o.margin, cur)} · ${marginPct(o.margin_pct, 0)}`],
        ]} />
      </Section>
      <Section title="Payment schedule">
        <KV items={[
          [`Deposit ${pct(o.deposit_pct, 0)}`, <>{money(o.deposit_due, cur)} {Number(o.deposit_due) > 0 && (Number(o.deposit_outstanding) <= 0.01 ? <Pill tone="green">received</Pill> : <Pill tone="amber">{money(o.deposit_outstanding, cur)} open</Pill>)}</>],
          ["Deposit due", o.order_type === "EXW" ? "before pick-up" : date(o.deposit_due_date)],
          ["Balance", money(o.balance_due, cur)],
          ["Balance due", o.balance_due_date ? date(o.balance_due_date) : o.order_type === "FOB" ? "10 days before ETA (ETA unknown)" : "–"],
          ...(o.order_type === "EXW" ? [["Reminder from", date(o.reminder_date)] as [any, any]] : []),
          ...(Number(o.overdue_amount) > 0 ? [["Overdue", <b className="text-red-700">{money(o.overdue_amount, cur)} · {o.days_late} days</b>] as [any, any]] : []),
        ]} />
      </Section>
      <Section title="Order">
        <KV items={[
          ["PO date", date(o.po_date)], ["PI sent", date(o.pi_date)],
          ["Invoice", o.invoice_number ? `${o.invoice_number} · ${date(o.invoice_date)}` : locked ? "–" : <button className="text-sky-700 underline" onClick={() => setDlg({ kind: "invoice" })}>Register invoice</button>],
          ["Shipment", shipment ? <button className="text-sky-700 underline" onClick={() => nav("shipping")}>{SHIP_LABEL[shipment.status]}{shipment.eta ? ` · ETA ${date(shipment.eta)}` : ""}</button> : "none yet"],
          ["Note", o.notes ?? "–"],
        ]} />
      </Section>
    </div>

    <Section title="Order lines" className="mb-5" action={!locked && <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "line" })}><Plus className="mr-1 h-3.5 w-3.5" />Add line</Button>}>
      <DataTable rows={lines} empty="No lines yet. Add the first product." exportName={`order-${o.pi_number ?? "draft"}-lines`}
        cols={[
          { key: "line_no", header: "#", width: "2.5rem" },
          { key: "product", header: "Product", value: l => pName[l.product_id], render: l => <div>{pName[l.product_id]}{l.notes && <div className="text-xs text-muted-foreground">{l.notes}</div>}</div> },
          { key: "qty", header: "Qty", align: "right", render: l => <>{qty(l.qty)}{l.quantity_cancelled > 0 && <div className="text-xs text-red-700">{qty(l.quantity_cancelled)} cancelled</div>}</> },
          { key: "unit_price", header: "Price", align: "right", render: l => money(l.unit_price, cur) },
          { key: "unit_cost", header: "Cost", align: "right", render: l => l.unit_cost == null ? <Pill tone="red">missing</Pill>
              : <div>{money(l.unit_cost, cur, 3)}<div className="text-xs text-muted-foreground">{SOURCE_LABEL[l.cost_source]}{l.cost_is_final ? " · final" : ""} · <button type="button" className="underline hover:text-foreground" onClick={() => showWhy(l)}>why?</button></div></div> },
          { key: "revenue", header: "Revenue", align: "right", render: l => money(l.revenue, cur) },
          { key: "total_cost", header: "Total cost", align: "right", render: l => money(l.total_cost, cur) },
          { key: "margin", header: "Margin", align: "right", render: l => <span className={Number(l.margin) < 0 ? "font-semibold text-red-700" : ""}>{money(l.margin, cur)}<div className="text-xs text-muted-foreground">{marginPct(l.margin_pct, l.cost_known === false ? 1 : 0)}</div></span> },
          { key: "po", header: "Our PO", value: l => poNo[l.purchase_order_id], render: l => l.purchase_order_id ? <button className="text-sky-700 underline" onClick={() => nav(`po-${l.purchase_order_id}`)}>{poNo[l.purchase_order_id]}</button> : "–" },
          { key: "batch", header: "Batch", value: l => batchNo[l.batch_item_id], render: l => batchNo[l.batch_item_id] ?? "–" },
          { key: "act", header: "", width: "4.5rem", render: l => locked ? null : <span className="flex justify-end gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDlg({ kind: "line", row: l })}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setConfirm({ title: "Remove this line?", label: "Remove line", body: `${pName[l.product_id]}, ${qty(l.quantity)} pieces. To keep the history, set "quantity cancelled" on the line instead.`,
                go: () => run(() => db.remove("sales_order_lines", { id: l.id }), "Line removed") })}><Trash2 className="h-3.5 w-3.5" /></Button></span> },
        ]} />
    </Section>

    <div className="grid gap-5 lg:grid-cols-2">
      <Section title="Payments and corrections" action={!locked && <span className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "adjustment" })}>Correction</Button>
        <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "writeoff" })}>Write-off</Button></span>}>
        <DataTable dense empty="No payments registered yet" rows={[
            ...allocs.map(a => ({ id: a.id, d: a.payment_date, what: a.voided_at ? "Payment (voided)" : "Payment", ref: a.reference, amount: a.amount, voided: !!a.voided_at, pid: a.payment_id })),
            ...adjustments.map(a => ({ id: a.id, d: String(a.created_at).slice(0, 10), what: "Correction", ref: a.reason, amount: a.amount })),
            ...writeOffs.map(a => ({ id: a.id, d: a.write_off_date, what: "Write-off", ref: a.reason, amount: a.amount })),
          ].sort((a, b) => String(a.d).localeCompare(String(b.d)))}
          cols={[{ key: "d", header: "Date", render: r => date(r.d) }, { key: "what", header: "Type" }, { key: "ref", header: "Reference / reason" },
            { key: "amount", header: "Amount", align: "right", render: (r: any) => <span className={r.voided ? "text-muted-foreground line-through" : ""}>{money(r.amount, cur)}</span> },
            { key: "x", header: "", render: (r: any) => r.pid && !r.voided ? <button className="text-xs text-red-700 underline" onClick={() => setDlg({ kind: "void", row: r })}>void</button> : null }]} />
      </Section>
      <Section title="History">
        <DataTable dense rows={history} empty="No changes logged"
          cols={[{ key: "changed_at", header: "When", render: a => String(a.changed_at).slice(0, 16).replace("T", " ") },
            { key: "what", header: "Change", render: a => a.action === "INSERT" ? "Order created"
              : Object.keys(a.new_data ?? {}).filter(k => JSON.stringify(a.new_data[k]) !== JSON.stringify(a.old_data?.[k]))
                  .map(k => `${k.replace(/_/g, " ")}: ${k === "status" ? `${STATUS_LABEL[a.old_data?.[k]] ?? "–"} → ${STATUS_LABEL[a.new_data[k]]}` : `${a.old_data?.[k] ?? "–"} → ${a.new_data[k] ?? "–"}`}`).join("; ") }]} />
      </Section>
    </div>

    <FormDialog open={dlg?.kind === "line"} onClose={() => setDlg(null)} title={dlg?.row ? "Edit line" : "Add line"} fields={lineFields}
      initial={dlg?.row ?? belowBasis?.values} onSubmit={submitLine}
      description="The purchase price is calculated: override, then batch, then price agreement, then product rule." />
    <ConfirmDialog open={!!why} onClose={() => setWhy(null)} title={`Why this purchase price? ${why ? pName[why.line.product_id] ?? "" : ""}`} confirmLabel="Close" onConfirm={() => setWhy(null)}
      body={why && <div className="space-y-2 text-sm"><p className="text-xs text-muted-foreground">Order of priority: override, batch, price agreement, product rule. The first that applies wins.{why.line.cost_is_final ? " This price is final; the explanation below follows today's rules." : ""}</p>
        <ol className="space-y-1.5">{why.rows.map((r: any) => <li key={r.step} className={"rounded border px-2 py-1.5 " + (r.applies ? "border-sky-300 bg-sky-50" : "")}>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{r.step === 5 ? "Result" : SOURCE_LABEL[r.source] ?? r.source}{r.applies && r.step !== 5 ? " · used" : ""}</div>{r.detail}</li>)}</ol></div>} />
    <ConfirmDialog open={!!belowBasis} onClose={() => setBelowBasis(null)} danger title="Selling below the cost basis"
      body={belowBasis && <>The sale price <b>{money(belowBasis.values.unit_price, cur)}</b> is below the cost basis <b>{money(belowBasis.basis, cur)}</b> for this product. This line would be sold at a loss.</>}
      confirmLabel="Save anyway" onConfirm={() => belowBasis && saveLine(belowBasis.values, belowBasis.row)} />
    <FormDialog open={dlg?.kind === "payment"} onClose={() => setDlg(null)} title="Register payment" submitLabel="Register"
      description={`Outstanding ${money(o.outstanding, cur)}${Number(o.deposit_outstanding) > 0.01 ? `, of which deposit ${money(o.deposit_outstanding, cur)}` : ""}. Anything paid above the open amount is kept as customer credit.`}
      initial={{ p_date: today(), p_amount: Number(o.deposit_outstanding) > 0.01 ? o.deposit_outstanding : Math.max(Number(o.outstanding), 0) }}
      fields={[{ name: "p_date", label: "Date received", type: "date", required: true, span: 1 }, { name: "p_amount", label: `Amount (${cur})`, type: "number", required: true, span: 1 },
        { name: "p_reference", label: "Bank reference" }, { name: "p_notes", label: "Note", type: "textarea" }]}
      onSubmit={v => save(() => db.rpc("register_customer_payment", { p_order: id, ...v }), "Payment registered")} />
    <FormDialog open={dlg?.kind === "void"} onClose={() => setDlg(null)} title="Void payment" submitLabel="Void payment" description="The payment stays in the history, marked as voided, and no longer counts."
      fields={[{ name: "p_reason", label: "Reason", required: true }]} onSubmit={v => save(() => db.rpc("void_payment", { p_payment: dlg!.row.pid, ...v }), "Payment voided")} />
    <FormDialog open={dlg?.kind === "invoice"} onClose={() => setDlg(null)} title="Register invoice" initial={{ invoice_date: today() }}
      fields={[{ name: "invoice_number", label: "Invoice # (CI#)", required: true, span: 1 }, { name: "invoice_date", label: "Invoice date", type: "date", required: true, span: 1 }]}
      onSubmit={v => save(() => db.insert("invoices", { ...v, sales_order_id: id }), "Invoice registered")} />
    <FormDialog open={dlg?.kind === "adjustment"} onClose={() => setDlg(null)} title="Correction on the order total" description="A plus or minus amount on top of the order lines, for example a discount."
      fields={[{ name: "amount", label: `Amount (${cur}), minus for a discount`, type: "number", required: true }, { name: "reason", label: "Reason", required: true }]}
      onSubmit={v => save(() => db.insert("order_adjustments", { ...v, sales_order_id: id }), "Correction saved")} />
    <FormDialog open={dlg?.kind === "writeoff"} onClose={() => setDlg(null)} title="Write off a difference" description="For bank charges or small differences. Never automatic: every write-off needs a reason."
      initial={{ write_off_date: today(), amount: Math.max(Number(o.outstanding), 0) }}
      fields={[{ name: "amount", label: `Amount (${cur})`, type: "number", required: true, span: 1 }, { name: "write_off_date", label: "Date", type: "date", required: true, span: 1 }, { name: "reason", label: "Reason", required: true }]}
      onSubmit={v => save(() => db.insert("write_offs", { ...v, sales_order_id: id }), "Write-off saved")} />
    <FormDialog open={dlg?.kind === "header"} onClose={() => setDlg(null)} title="Edit order" initial={raw}
      fields={[...orderFields(customers).filter(f => !locked || f.name === "customer_po"),
        ...(locked ? [] : [{ name: "pi_date", label: "PI sent on", type: "date", span: 1 }, { name: "deposit_pct", label: "Deposit %", type: "percent", span: 1 },
          { name: "payment_days", label: "Payment term (days after invoice)", type: "number", span: 1 }, { name: "deposit_due_date", label: "Deposit due date", type: "date", span: 1 },
          { name: "balance_due_date", label: "Balance due date (override)", type: "date", span: 1, hint: "Empty = rule for the order type" }] as Field[]),
        { name: "notes", label: "Note", type: "textarea" }]}
      onSubmit={async v => { const patch = { ...v }; if (raw.status === "draft" && v.pi_number) patch.status = "pi_sent";
        return save(() => db.update("sales_orders", { id }, patch), "Order saved"); }} />
    <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={confirm?.title ?? ""} body={confirm?.body} confirmLabel={confirm?.label} onConfirm={() => confirm?.go()} />
  </>;
}

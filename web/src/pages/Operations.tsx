import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useNav, useRows } from "@/app/store";
import { DataTable, FormDialog, PageHeader, Pill, Section, selectClass, type Field } from "@/app/ui";
import { date, money, qty, SHIP_LABEL, today } from "@/app/format";

// ---------------- payments ledger ----------------
export function Payments() {
  const { db, save } = useApp(); const nav = useNav();
  const allocs = useRows("v_allocations", { order: [["payment_date", "desc"]] }).rows;
  const payments = useRows("v_payments", { order: [["payment_date", "desc"]] }).rows;
  const credit = useRows("v_customer_credit").rows; const customers = useRows("customers").rows;
  const [dir, setDir] = useState(""); const [voiding, setVoiding] = useState<any>(null);
  const cName = Object.fromEntries(customers.map(c => [c.id, c.name]));
  const rows = payments.filter(p => !dir || p.direction === dir).map(p => ({ ...p, links: allocs.filter(a => a.payment_id === p.id) }));
  return <>
    <PageHeader title="Payments" sub="Every payment received and made. Register a payment from the order or the PO it belongs to." />
    {credit.filter(c => Number(c.credit) > 0).length > 0 && <div className="mb-5 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm">
      <b>Customer credit:</b> {credit.filter(c => Number(c.credit) > 0).map(c => `${cName[c.customer_id] ?? "?"} ${money(c.credit, c.currency)}`).join(" · ")}</div>}
    <Section title="Ledger">
      <DataTable rows={rows} search exportName="payments" empty="No payments registered yet"
        toolbar={<select className={selectClass + " h-8 w-40"} value={dir} onChange={e => setDir(e.target.value)}><option value="">In and out</option><option value="in">Received</option><option value="out">Paid</option></select>}
        cols={[{ key: "payment_date", header: "Date", render: p => date(p.payment_date) },
          { key: "direction", header: "", render: p => p.direction === "in" ? <Pill tone="green">Received</Pill> : <Pill>Paid</Pill> },
          { key: "party_name", header: "Party" }, { key: "reference", header: "Reference" },
          { key: "for", header: "For", value: p => p.links.map((a: any) => a.pi_number ?? a.po_number).join(", "),
            render: p => p.links.length ? p.links.map((a: any) => <button key={a.id} className="mr-2 text-sky-700 underline" onClick={() => nav(a.sales_order_id ? `order-${a.sales_order_id}` : `po-${a.purchase_order_id}`)}>{a.sales_order_id ? "PI " + a.pi_number : "PO " + a.po_number}</button>) : "–" },
          { key: "amount", header: "Amount", align: "right", render: p => <span className={p.voided_at ? "text-muted-foreground line-through" : ""}>{money(p.amount, p.currency)}</span> },
          { key: "unallocated", header: "Not allocated", align: "right", render: p => Number(p.unallocated) > 0 ? <span className="text-amber-700">{money(p.unallocated, p.currency)}</span> : "–" },
          { key: "voided_at", header: "", render: p => p.voided_at ? <Pill tone="red">Voided: {p.void_reason}</Pill> : <button className="text-xs text-red-700 underline" onClick={() => setVoiding(p)}>void</button> }]} />
    </Section>
    <FormDialog open={!!voiding} onClose={() => setVoiding(null)} title="Void payment" submitLabel="Void payment" description="The payment stays in the history, marked as voided, and no longer counts."
      fields={[{ name: "p_reason", label: "Reason", required: true }]} onSubmit={v => save(() => db.rpc("void_payment", { p_payment: voiding.id, ...v }), "Payment voided")} />
  </>;
}

// ---------------- shipping ----------------
export function Shipping() {
  const { db, save } = useApp();
  const ships = useRows("v_shipments").rows; const orders = useRows("v_orders", { order: [["pi_number", "desc"]] }).rows; const pos = useRows("v_purchase_orders", { order: [["po_number", "desc"]] }).rows;
  const links = useRows("shipment_orders").rows;
  const [dlg, setDlg] = useState<null | { row?: any }>(null);
  const fields: Field[] = [
    ...(dlg?.row ? [] : [{ name: "sales_order_id", label: "PI", type: "select", span: 1, options: orders.filter(o => o.pi_number && !links.some(l => l.sales_order_id === o.id)).map(o => ({ value: o.id, label: `${o.pi_number} · ${o.customer_name}` })) },
      { name: "purchase_order_id", label: "Our PO", type: "select", span: 1, options: pos.map(p => ({ value: p.id, label: `${p.po_number} · ${p.supplier_name}` })) }] as Field[]),
    { name: "forwarder", label: "Forwarder", span: 1 }, { name: "container_number", label: "Container#", span: 1 }, { name: "bl_number", label: "BL#", span: 1 },
    { name: "ready_date", label: "Ready date", type: "date", span: 1 }, { name: "port_loading", label: "Port of loading", span: 1 }, { name: "port_discharge", label: "Port of discharge", span: 1 },
    { name: "etd", label: "ETD", type: "date", span: 1 }, { name: "eta", label: "ETA", type: "date", span: 1, hint: "FOB balance falls due 10 days before ETA" },
    { name: "docs_complete", label: "Documents complete (BL / CI / PL / COO)", type: "checkbox" }, { name: "notes", label: "Note", type: "textarea" }];
  return <>
    <PageHeader title="Shipping" sub="One row per shipment or container. The status follows ETD and ETA."><Button onClick={() => setDlg({})}><Plus className="mr-1 h-4 w-4" />New shipment</Button></PageHeader>
    <Section title="Shipments">
      <DataTable rows={ships} search exportName="shipments" empty="No shipments yet" cols={[
        { key: "pi_numbers", header: "PI#", render: s => <b>{s.pi_numbers ?? "–"}</b> }, { key: "po_numbers", header: "Our PO" }, { key: "forwarder", header: "Forwarder" },
        { key: "container_number", header: "Container#" }, { key: "bl_number", header: "BL#" }, { key: "port_loading", header: "From" }, { key: "port_discharge", header: "To" },
        { key: "ready_date", header: "Ready", render: s => date(s.ready_date) }, { key: "etd", header: "ETD", render: s => date(s.etd) }, { key: "eta", header: "ETA", render: s => date(s.eta) },
        { key: "docs_complete", header: "Docs", render: s => s.docs_complete ? <Pill tone="green">Complete</Pill> : <Pill tone="amber">Open</Pill> },
        { key: "status", header: "Status", render: s => <Pill tone={s.status === "awaiting_info" ? "red" : s.status === "arrived" ? "green" : "blue"}>{SHIP_LABEL[s.status]}</Pill> },
        { key: "x", header: "", render: s => <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDlg({ row: s })}><Pencil className="h-3.5 w-3.5" /></Button> }]} />
    </Section>
    <FormDialog open={!!dlg} onClose={() => setDlg(null)} title={dlg?.row ? "Edit shipment" : "New shipment"} fields={fields} initial={dlg?.row}
      onSubmit={v => save(async () => {
        const { sales_order_id, purchase_order_id, ...ship } = v;
        if (dlg?.row) return db.update("shipments", { id: dlg.row.id }, ship);
        if (!sales_order_id && !purchase_order_id) throw new Error("Choose a PI or a PO for this shipment");
        const s = await db.insert("shipments", ship);
        await db.insert("shipment_orders", { shipment_id: s.id, sales_order_id, purchase_order_id });
      }, "Shipment saved")} />
  </>;
}

// ---------------- NL stock ----------------
export function Stock() {
  const { db, save } = useApp();
  const batches = useRows("v_batch_stock", { order: [["batch_number", "desc"]] }).rows; const items = useRows("v_batch_item_stock", { order: [["batch_number", "desc"]] }).rows;
  const perProduct = useRows("v_product_stock", { order: [["product_name", "asc"]] }).rows; const moves = useRows("v_stock_movements", { order: [["movement_date", "desc"]] }).rows;
  const suppliers = useRows("suppliers").rows; const products = useRows("products", { order: [["name", "asc"]] }).rows; const kinds = useRows("stock_adjustment_kinds").rows;
  const [dlg, setDlg] = useState<null | string>(null);
  const itemLabel = Object.fromEntries(items.map(i => [i.batch_item_id, `${i.batch_number} · ${i.product_name}`]));
  const neg = (v: any) => <span className={Number(v) < 0 ? "font-semibold text-red-700" : ""}>{qty(v)}</span>;
  return <>
    <PageHeader title="NL stock" sub="Shipments the supplier places in our warehouse. Selling from a batch lowers its stock; the PO to the supplier follows after the sale.">
      <Button onClick={() => setDlg("batch")}><Plus className="mr-1 h-4 w-4" />New batch</Button>
      <Button variant="outline" onClick={() => setDlg("item")}>Add product to batch</Button><Button variant="outline" onClick={() => setDlg("adjust")}>Stock correction</Button></PageHeader>
    <div className="grid gap-5 xl:grid-cols-2">
      <Section title="Per batch and product" className="xl:col-span-2">
        <DataTable rows={items} search exportName="stock-per-batch" empty="No stock batches yet" cols={[
          { key: "batch_number", header: "Batch#", render: i => <b>{i.batch_number}</b> }, { key: "product_name", header: "Product" }, { key: "received_date", header: "Received", render: i => date(i.received_date) },
          { key: "qty_received", header: "Received", align: "right", render: i => qty(i.qty_received) }, { key: "adjustments", header: "Corrections", align: "right", render: i => qty(i.adjustments) },
          { key: "sold", header: "Sold", align: "right", render: i => qty(i.sold) }, { key: "stock", header: "In stock", align: "right", render: i => <b>{neg(i.stock)}</b> },
          { key: "sold_without_po", header: "Sold, no PO yet", align: "right", render: i => Number(i.sold_without_po) > 0 ? <span className="font-semibold text-amber-700">{qty(i.sold_without_po)}</span> : "–" }]} />
      </Section>
      <Section title="Per product"><DataTable dense rows={perProduct.filter(p => Number(p.received_and_adjusted) || Number(p.sold_from_stock))} empty="No stock" cols={[{ key: "product_name", header: "Product" },
        { key: "received_and_adjusted", header: "Received + corrections", align: "right", render: p => qty(p.received_and_adjusted) }, { key: "sold_from_stock", header: "Sold", align: "right", render: p => qty(p.sold_from_stock) },
        { key: "stock", header: "In stock", align: "right", render: p => <b>{neg(p.stock)}</b> }]} /></Section>
      <Section title="Movements"><DataTable dense rows={moves} empty="No movements" cols={[{ key: "movement_date", header: "Date", render: m => date(m.movement_date) },
        { key: "item", header: "Batch · product", value: m => itemLabel[m.batch_item_id], render: m => itemLabel[m.batch_item_id] }, { key: "kind", header: "Type", render: m => ({ receipt: "Received", sale: "Sale" } as any)[m.kind] ?? m.kind },
        { key: "reference", header: "Ref" }, { key: "quantity", header: "Qty", align: "right", render: m => neg(m.quantity) }]} /></Section>
    </div>
    <p className="mt-3 text-xs text-muted-foreground">{batches.length} batches.</p>
    <FormDialog open={dlg === "batch"} onClose={() => setDlg(null)} title="New batch" description="One batch per shipment the supplier places with us. No PO needed yet." initial={{ received_date: today() }}
      fields={[{ name: "batch_number", label: "Batch#", required: true, span: 1 }, { name: "received_date", label: "Received on", type: "date", span: 1 },
        { name: "supplier_id", label: "Supplier", type: "select", options: suppliers.map(s => ({ value: s.id, label: s.name })) }, { name: "reference", label: "Container# / reference" }, { name: "notes", label: "Note", type: "textarea" }]}
      onSubmit={v => save(() => db.insert("batches", v), "Batch created")} />
    <FormDialog open={dlg === "item"} onClose={() => setDlg(null)} title="Add product to batch" description="Optional EXW cost rule for this batch: basis only = fixed cost, basis + share = profit share. Empty = price agreement or product rule."
      fields={[{ name: "batch_id", label: "Batch", type: "select", required: true, span: 1, options: batches.map(b => ({ value: b.batch_id, label: b.batch_number })) },
        { name: "product_id", label: "Product", type: "select", required: true, span: 1, options: products.map(p => ({ value: p.id, label: p.name })) },
        { name: "qty_received", label: "Quantity received", type: "number", required: true }, { name: "cost_basis", label: "EXW cost basis (€)", type: "number", span: 1 }, { name: "share_above_basis", label: "Share above basis %", type: "percent", span: 1 },
        { name: "notes", label: "Note", type: "textarea" }]} onSubmit={v => save(() => db.insert("batch_items", v), "Product added to batch")} />
    <FormDialog open={dlg === "adjust"} onClose={() => setDlg(null)} title="Stock correction" description="Count, damage or return. Less stock is a negative number." initial={{ adjustment_date: today() }}
      fields={[{ name: "batch_item_id", label: "Batch · product", type: "select", required: true, options: items.map(i => ({ value: i.batch_item_id, label: `${i.batch_number} · ${i.product_name} (${i.stock} in stock)` })) },
        { name: "adjustment_date", label: "Date", type: "date", span: 1 }, { name: "kind", label: "Kind", type: "select", span: 1, options: kinds.map(k => ({ value: k.code, label: k.code })) },
        { name: "quantity", label: "Quantity (+/-)", type: "number", required: true, span: 1 }, { name: "reference", label: "Reference", span: 1 }, { name: "notes", label: "Note", type: "textarea" }]}
      onSubmit={v => save(() => db.insert("stock_adjustments", v), "Correction saved")} />
  </>;
}

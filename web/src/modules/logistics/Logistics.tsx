/**
 * Shipping and NL stock: /shipping, /shipping/new, /shipping/tiiu2819255/edit, /stock, /stock/batches/new, /stock/items/new, /stock/corrections/new
 */
import { Plus } from "lucide-react";
import { useApp, useRows } from "@/app/store";
import { Link, useParams } from "@/app/router";
import { orderPath, shipmentPath, shipmentRef } from "@/app/paths";
import { DataTable, FormPage, LinkButton, Loading, NotFound, PageHeader, Pill, Section, type Field } from "@/app/ui";
import { date, qty, SHIP_LABEL, today } from "@/app/format";

export function Shipping() {
  const ships = useRows("v_shipments").rows; const orders = useRows("v_orders").rows; const links = useRows("shipment_orders").rows;
  const ordersOf = (s: any) => links.filter(l => l.shipment_id === s.id && l.sales_order_id).map(l => orders.find(o => o.id === l.sales_order_id)).filter(Boolean);
  return <>
    <PageHeader title="Shipping" sub="One row per shipment or container. The status follows ETD and ETA."><LinkButton to="/shipping/new"><Plus />New shipment</LinkButton></PageHeader>
    <Section>
      <DataTable rows={ships} search exportName="shipments" rowTo={s => shipmentPath(s, "/edit")} empty="No shipments yet" cols={[
        { key: "pi_numbers", header: "PI#", render: s => <span className="font-semibold text-gray-900">{ordersOf(s).map((o: any) => <Link key={o.id} to={orderPath(o)} className="mr-2 hover:text-indigo-600">{o.pi_number}</Link>)}{!ordersOf(s).length && "–"}</span> },
        { key: "po_numbers", header: "Our PO" }, { key: "forwarder", header: "Forwarder" },
        { key: "container_number", header: "Container / BL", render: s => <div>{s.container_number ?? "–"}<div className="text-xs text-gray-500">{s.bl_number}</div></div> },
        { key: "route", header: "Route", value: s => `${s.port_loading ?? ""} ${s.port_discharge ?? ""}`, render: s => s.port_loading || s.port_discharge ? `${s.port_loading ?? "?"} → ${s.port_discharge ?? "?"}` : "–" },
        { key: "etd", header: "ETD", render: s => date(s.etd) }, { key: "eta", header: "ETA", render: s => date(s.eta) },
        { key: "docs_complete", header: "Docs", render: s => s.docs_complete ? <Pill tone="green">Complete</Pill> : <Pill tone="amber">Open</Pill> },
        { key: "status", header: "Status", render: s => <Pill tone={s.status === "awaiting_info" ? "red" : s.status === "arrived" ? "green" : "blue"}>{SHIP_LABEL[s.status]}</Pill> }]} />
    </Section>
  </>;
}

const shipFields: Field[] = [
  { name: "forwarder", label: "Forwarder", span: 1 }, { name: "container_number", label: "Container#", span: 1 }, { name: "bl_number", label: "BL#", span: 1 },
  { name: "ready_date", label: "Ready date", type: "date", span: 1 }, { name: "port_loading", label: "Port of loading", span: 1 }, { name: "port_discharge", label: "Port of discharge", span: 1 },
  { name: "etd", label: "ETD", type: "date", span: 1, section: "Planning" }, { name: "eta", label: "ETA", type: "date", span: 1, section: "Planning", hint: "The FOB balance falls due 10 days before ETA" },
  { name: "docs_complete", label: "Documents complete (BL / CI / PL / COO)", type: "checkbox", section: "Planning" }, { name: "notes", label: "Note", type: "textarea", section: "Planning" }];

export function ShipmentForm() {
  const { ref } = useParams(); const { db } = useApp();
  const ships = useRows("v_shipments"); const orders = useRows("v_orders", { order: [["pi_number", "desc"]] }).rows;
  const pos = useRows("v_purchase_orders", { order: [["po_number", "desc"]] }).rows; const links = useRows("shipment_orders").rows;
  const row = ref ? ships.rows.find(s => shipmentRef(s) === ref) : undefined;
  if (ref && !row) return ships.loading ? <Loading /> : <NotFound what="Shipment" back={{ to: "/shipping", label: "All shipments" }} />;
  const fields: Field[] = [
    ...(row ? [] : [{ name: "sales_order_id", label: "PI", type: "select", span: 1, section: "For", options: orders.filter(o => o.pi_number && !links.some(l => l.sales_order_id === o.id)).map(o => ({ value: o.id, label: `${o.pi_number} · ${o.customer_name}` })) },
      { name: "purchase_order_id", label: "Our PO", type: "select", span: 1, section: "For", options: pos.map(p => ({ value: p.id, label: `${p.po_number} · ${p.supplier_name}` })) }] as Field[]),
    ...shipFields.map(f => ({ ...f, section: f.section ?? "Shipment" }))];
  return <FormPage title={row ? `Shipment ${row.container_number ?? row.pi_numbers ?? ""}` : "New shipment"} back={{ to: "/shipping", label: "Shipping" }} fields={fields} initial={row ?? {}}
    sub={row ? `For PI ${row.pi_numbers ?? "–"} · PO ${row.po_numbers ?? "–"}` : undefined}
    onSubmit={async v => {
      const { sales_order_id, purchase_order_id, ...ship } = v;
      if (row) { await db.update("shipments", { id: row.id }, ship); return; }
      if (!sales_order_id && !purchase_order_id) throw new Error("Choose a PI or a PO for this shipment");
      const s = await db.insert("shipments", ship);
      await db.insert("shipment_orders", { shipment_id: s.id, sales_order_id, purchase_order_id });
    }} />;
}

export function Stock() {
  const items = useRows("v_batch_item_stock", { order: [["batch_number", "desc"]] }).rows;
  const perProduct = useRows("v_product_stock", { order: [["product_name", "asc"]] }).rows; const moves = useRows("v_stock_movements", { order: [["movement_date", "desc"]] }).rows;
  const itemLabel = Object.fromEntries(items.map(i => [i.batch_item_id, `${i.batch_number} · ${i.product_name}`]));
  const neg = (v: any) => <span className={Number(v) < 0 ? "font-semibold text-rose-600" : ""}>{qty(v)}</span>;
  return <>
    <PageHeader title="NL stock" sub="Shipments the supplier places in our warehouse. Selling from a batch lowers its stock; the PO to the supplier follows after the sale.">
      <LinkButton to="/stock/batches/new"><Plus />New batch</LinkButton>
      <LinkButton variant="outline" to="/stock/items/new">Add product to batch</LinkButton><LinkButton variant="outline" to="/stock/corrections/new">Stock correction</LinkButton></PageHeader>
    <div className="grid gap-6 xl:grid-cols-2">
      <Section title="Per batch and product" className="xl:col-span-2">
        <DataTable rows={items} search exportName="stock-per-batch" empty="No stock batches yet" cols={[
          { key: "batch_number", header: "Batch#", render: i => <span className="font-semibold text-gray-900">{i.batch_number}</span> }, { key: "product_name", header: "Product" }, { key: "received_date", header: "Received on", render: i => date(i.received_date) },
          { key: "qty_received", header: "Quantity received", align: "right", render: i => qty(i.qty_received) }, { key: "adjustments", header: "Corrections", align: "right", render: i => qty(i.adjustments) },
          { key: "sold", header: "Sold", align: "right", render: i => qty(i.sold) }, { key: "stock", header: "In stock", align: "right", render: i => <b>{neg(i.stock)}</b> },
          { key: "sold_without_po", header: "Sold, no PO yet", align: "right", render: i => Number(i.sold_without_po) > 0 ? <span className="font-semibold text-amber-600">{qty(i.sold_without_po)}</span> : "–" }]} />
      </Section>
      <Section title="Per product"><DataTable dense rows={perProduct.filter(p => Number(p.received_and_adjusted) || Number(p.sold_from_stock))} empty="No stock" cols={[{ key: "product_name", header: "Product" },
        { key: "received_and_adjusted", header: "Received + corrections", align: "right", render: p => qty(p.received_and_adjusted) }, { key: "sold_from_stock", header: "Sold", align: "right", render: p => qty(p.sold_from_stock) },
        { key: "stock", header: "In stock", align: "right", render: p => <b>{neg(p.stock)}</b> }]} /></Section>
      <Section title="Movements"><DataTable dense rows={moves} empty="No movements" cols={[{ key: "movement_date", header: "Date", render: m => date(m.movement_date) },
        { key: "item", header: "Batch · product", value: m => itemLabel[m.batch_item_id], render: m => itemLabel[m.batch_item_id] }, { key: "kind", header: "Type", render: m => ({ receipt: "Received", sale: "Sale" } as any)[m.kind] ?? m.kind },
        { key: "reference", header: "Ref" }, { key: "quantity", header: "Qty", align: "right", render: m => neg(m.quantity) }]} /></Section>
    </div>
  </>;
}

const back = { to: "/stock", label: "NL stock" };
export function BatchNew() {
  const { db } = useApp(); const suppliers = useRows("suppliers").rows;
  return <FormPage title="New batch" sub="One batch per shipment the supplier places with us. No PO needed yet." back={back} initial={{ received_date: today() }}
    fields={[{ name: "batch_number", label: "Batch#", required: true, span: 1 }, { name: "received_date", label: "Received on", type: "date", span: 1 },
      { name: "supplier_id", label: "Supplier", type: "select", options: suppliers.map(s => ({ value: s.id, label: s.name })) }, { name: "reference", label: "Container# / reference" }, { name: "notes", label: "Note", type: "textarea" }]}
    onSubmit={async v => { await db.insert("batches", v); return "/stock/items/new"; }} />;
}
export function BatchItemNew() {
  const { db } = useApp(); const batches = useRows("v_batch_stock", { order: [["batch_number", "desc"]] }).rows; const products = useRows("products", { order: [["name", "asc"]] }).rows;
  return <FormPage title="Add product to batch" sub="Optional EXW cost rule for this batch: basis only = fixed cost, basis + share = profit share. Empty = price agreement or product rule." back={back}
    fields={[{ name: "batch_id", label: "Batch", type: "select", required: true, span: 1, options: batches.map(b => ({ value: b.batch_id, label: b.batch_number })) },
      { name: "product_id", label: "Product", type: "select", required: true, span: 1, options: products.map(p => ({ value: p.id, label: p.name })) },
      { name: "qty_received", label: "Quantity received", type: "number", required: true }, { name: "cost_basis", label: "EXW cost basis (€)", type: "number", span: 1 }, { name: "share_above_basis", label: "Share above basis %", type: "percent", span: 1 },
      { name: "notes", label: "Note", type: "textarea" }]} onSubmit={async v => { await db.insert("batch_items", v); }} />;
}
export function StockCorrection() {
  const { db } = useApp(); const items = useRows("v_batch_item_stock", { order: [["batch_number", "desc"]] }).rows; const kinds = useRows("stock_adjustment_kinds").rows;
  return <FormPage title="Stock correction" sub="Count, damage or return. Less stock is a negative number." back={back} initial={{ adjustment_date: today() }}
    fields={[{ name: "batch_item_id", label: "Batch · product", type: "select", required: true, options: items.map(i => ({ value: i.batch_item_id, label: `${i.batch_number} · ${i.product_name} (${i.stock} in stock)` })) },
      { name: "adjustment_date", label: "Date", type: "date", span: 1 }, { name: "kind", label: "Kind", type: "select", span: 1, options: kinds.map(k => ({ value: k.code, label: k.code })) },
      { name: "quantity", label: "Quantity (+/-)", type: "number", required: true, span: 1 }, { name: "reference", label: "Reference", span: 1 }, { name: "notes", label: "Note", type: "textarea" }]}
    onSubmit={async v => { await db.insert("stock_adjustments", v); }} />;
}

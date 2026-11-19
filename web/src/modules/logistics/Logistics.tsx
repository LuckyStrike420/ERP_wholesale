/**
 * Shipping and NL stock: /shipping, /shipping/new, /shipping/tiiu2819255/edit, /stock, /stock/batches/new, /stock/items/new, /stock/corrections/new
 */
import { KIND_LABEL as STOCK_KIND, stockTabs } from "@/modules/stock/StockPages";
import { LandedCostList } from "@/modules/costs/LandedCosts";
import { useCan } from "@/app/permissions";
import { COUNTRY_OPTIONS, place } from "@/app/countries";
import { Plus } from "lucide-react";
import { useApp, useRows } from "@/app/store";
import { Link, useParams, useQuery } from "@/app/router";
import { orderPath, shipmentPath, shipmentRef } from "@/app/paths";
import { DataTable, FormPage, LinkButton, Loading, NotFound, PageHeader, Pill, Section, type Field } from "@/app/ui";
import { date, money, pct, qty, SHIP_LABEL, today } from "@/app/format";
import { batchPath } from "@/modules/stock/Batches";
import { COURIERS, dateLabels, isSea, MODE_LABEL, MODES, modeFor, shipmentLabel, trackingUrl } from "./transport";

export function Shipping() {
  const ships = useRows("v_shipments").rows; const orders = useRows("v_orders").rows; const links = useRows("shipment_orders").rows;
  const ordersOf = (s: any) => links.filter(l => l.shipment_id === s.id && l.sales_order_id).map(l => orders.find(o => o.id === l.sales_order_id)).filter(Boolean);
  return <>
    <PageHeader title="Shipping" sub="One row per shipment: a container, pallets by sea or road, a pick-up by the customer or a courier parcel. The status follows the dates."><LinkButton to="/shipping/new"><Plus />New shipment</LinkButton></PageHeader>
    <Section>
      <DataTable rows={ships} search exportName="shipments" rowTo={s => shipmentPath(s, "/edit")} empty="No shipments yet" cols={[
        { key: "pi_numbers", header: "PI#", render: s => <span className="font-semibold text-gray-900">{ordersOf(s).map((o: any) => <Link key={o.id} to={orderPath(o)} className="mr-2 hover:text-indigo-600">{o.pi_number}</Link>)}{!ordersOf(s).length && "–"}</span> },
        { key: "po_numbers", header: "Our PO" },
        { key: "mode", header: "Type", value: s => MODE_LABEL[s.mode], render: s => <span className="whitespace-nowrap">{MODE_LABEL[s.mode]}</span> },
        { key: "forwarder", header: "Forwarder / carrier", value: s => s.forwarder ?? s.carrier ?? s.collected_by, render: s => s.mode === "pickup" ? (s.collected_by ?? "–") : (s.forwarder ?? s.carrier ?? "–") },
        { key: "container_number", header: "Reference", value: s => [s.container_number, s.bl_number, s.tracking_number, s.cmr_number].filter(Boolean).join(" "), render: s => <ShipmentRef s={s} /> },
        { key: "route", header: "Route", value: s => `${place(s.port_loading, s.port_loading_country)} ${place(s.port_discharge, s.port_discharge_country)}`, render: s => isSea(s.mode) && (s.port_loading || s.port_discharge || s.port_loading_country || s.port_discharge_country) ? `${place(s.port_loading, s.port_loading_country) || "?"} → ${place(s.port_discharge, s.port_discharge_country) || "?"}` : "–" },
        { key: "etd", header: "Departs", render: s => <span title={dateLabels(s.mode).etd}>{date(s.etd)}</span> }, { key: "eta", header: "Arrives", render: s => s.mode === "pickup" ? "–" : <span title={dateLabels(s.mode).eta}>{date(s.eta)}</span> },
        { key: "docs_complete", header: "Docs", render: s => s.docs_complete ? <Pill tone="green">Complete</Pill> : <Pill tone="amber">Open</Pill> },
        { key: "status", header: "Status", render: s => <Pill tone={s.status === "awaiting_info" ? "red" : s.status === "arrived" || s.status === "collected" ? "green" : "blue"}>{SHIP_LABEL[s.status]}</Pill> }]} />
    </Section>
  </>;
}

const sea = (v: any) => isSea(v.mode);
/** a shipment's reference: container + BL, or the courier's tracking number as a link, or the CMR … */
export function ShipmentRef({ s }: { s: any }) {
  const url = s.mode === "courier" ? trackingUrl(s.carrier, s.tracking_number) : null;
  return <div onClick={e => url && e.stopPropagation()}>
    {url ? <a href={url} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 hover:underline">{s.tracking_number}</a> : shipmentLabel(s)}
    <div className="text-xs text-gray-500">{[s.container_number && s.bl_number, s.pallets != null && `${s.pallets} pallet${s.pallets === 1 ? "" : "s"}`, s.mode === "pickup" && s.vehicle_plate].filter(Boolean).join(" · ")}</div></div>;
}
const shipFields: Field[] = [
  { name: "mode", label: "Type of transport", type: "select", required: true, options: MODES.map(m => ({ value: m.value, label: m.label })) },
  { name: "forwarder", label: "Forwarder", span: 1, show: sea },
  { name: "carrier", label: "Carrier", span: 1, show: v => v.mode === "road" || v.mode === "courier",
    vary: v => v.mode === "courier" ? { label: "Courier", type: "select", options: COURIERS.map(c => ({ value: c, label: c })), free: true, hint: "FedEx, UPS, DHL, PostNL or type another" } : undefined },
  { name: "tracking_number", label: "Tracking number", span: 1, show: v => v.mode === "courier" },
  { name: "container_number", label: "Container#", span: 1, show: v => v.mode === "sea_container" || !v.mode },
  { name: "bl_number", label: "BL#", span: 1, show: sea, vary: v => v.mode === "sea_lcl" ? { label: "BL# / HBL#" } : undefined },
  { name: "collected_by", label: "Collected by", span: 1, show: v => v.mode === "pickup", hint: "Company or driver who collects" },
  { name: "vehicle_plate", label: "Vehicle plate", span: 1, show: v => v.mode === "pickup" },
  { name: "cmr_number", label: "CMR number", span: 1, show: v => v.mode === "road" || v.mode === "pickup" },
  { name: "pallets", label: "Pallets", type: "number", span: 1, show: v => v.mode === "sea_lcl" || v.mode === "road" || v.mode === "pickup" },
  { name: "ready_date", label: "Ready date", type: "date", span: 1 },
  { name: "etd", label: "ETD", type: "date", span: 1, section: "Planning", vary: v => ({ label: dateLabels(v.mode).etd }) },
  { name: "eta", label: "ETA", type: "date", span: 1, section: "Planning", show: v => v.mode !== "pickup",
    vary: v => ({ label: dateLabels(v.mode).eta, hint: sea(v) ? "The FOB balance falls due 10 days before ETA" : undefined }) },
  { name: "docs_complete", label: "Documents complete", type: "checkbox", section: "Planning", vary: v => ({ label: sea(v) ? "Documents complete (BL / CI / PL / COO)" : v.mode === "courier" ? "Documents complete" : "Documents complete (CMR / CI / PL)" }) },
  { name: "notes", label: "Note", type: "textarea", section: "Planning" }];

export function ShipmentForm() {
  const { ref } = useParams(); const { db } = useApp(); const q = useQuery();
  const forOrder = q.get("order"), forPo = q.get("po"), back = q.get("back"); const useCanCosts = useCan()("see_costs");
  const ships = useRows("v_shipments"); const orders = useRows("v_orders", { order: [["pi_number", "desc"]] }).rows;
  const pos = useRows("v_purchase_orders", { order: [["po_number", "desc"]] }).rows; const links = useRows("shipment_orders").rows;
  const deliv = useRows(forOrder ? "v_order_delivery" : null, { eq: { sales_order_id: forOrder } }).rows[0];
  const prodQ = useRows("products"); const linesQ = useRows(forOrder ? "sales_order_lines" : null, { eq: { sales_order_id: forOrder } });
  const products = prodQ.rows; const orderLines = linesQ.rows;
  const row = ref ? ships.rows.find(s => shipmentRef(s) === ref) : undefined;
  if (ref && !row) return ships.loading ? <Loading /> : <NotFound what="Shipment" back={{ to: "/shipping", label: "All shipments" }} />;
  if (!row && forOrder && ((linesQ.loading && !orderLines.length) || (prodQ.loading && !products.length))) return <Loading />;
  // cities already used, to pick from; any other city can be typed
  const cities = [...new Set([...ships.rows.flatMap(s => [s.port_loading, s.port_discharge]), ...products.map(p => p.pol_city)].filter(Boolean).map(String))].sort().map(c => ({ value: c, label: c }));
  // a new shipment for an order: the port of loading of its products (the first one that has it)
  const pol = products.find(p => p.pol_city && orderLines.some(l => l.product_id === p.id));
  const portFields: Field[] = [
    { name: "port_loading", label: "Port of loading: city", type: "select", options: cities, free: true, span: 1, section: "Ports", show: sea },
    { name: "port_loading_country", label: "Port of loading: country", type: "select", options: COUNTRY_OPTIONS, span: 1, section: "Ports", show: sea, hint: pol && !row ? `From the product ${pol.name}; change it if needed` : undefined },
    { name: "port_discharge", label: "Port of discharge: city", type: "select", options: cities, free: true, span: 1, section: "Ports", show: sea },
    { name: "port_discharge_country", label: "Port of discharge: country", type: "select", options: COUNTRY_OPTIONS, span: 1, section: "Ports", show: sea }];
  const fields: Field[] = [
    ...(row ? [] : [{ name: "sales_order_id", label: "PI", type: "select", span: 1, section: "For", options: orders.filter(o => (o.pi_number || o.id === forOrder) && !links.some(l => l.sales_order_id === o.id)).map(o => ({ value: o.id, label: `${o.pi_number ?? "Draft"} · ${o.customer_name}` })) },
      { name: "purchase_order_id", label: "Our PO", type: "select", span: 1, section: "For", options: pos.map(p => ({ value: p.id, label: `${p.po_number} · ${p.supplier_name}` })) }] as Field[]),
    ...shipFields.map(f => ({ ...f, section: f.section ?? "Shipment" })), ...portFields];
  return <FormPage title={row ? `Shipment ${row.container_number ?? row.tracking_number ?? row.pi_numbers ?? ""}` : "New shipment"} back={back ? { to: back, label: "Back to the order" } : { to: "/shipping", label: "Shipping" }} fields={fields}
    initial={row ?? { mode: modeFor(deliv?.incoterm), sales_order_id: forOrder ?? "", purchase_order_id: forPo ?? "", port_loading: pol?.pol_city ?? "", port_loading_country: pol?.pol_country ?? "" }}
    sub={row ? `For PI ${row.pi_numbers ?? "–"} · PO ${row.po_numbers ?? "–"}` : undefined}
    aside={row && useCanCosts && <LandedCostList shipment={row.id} back={`${shipmentPath(row, "/edit")}${back ? `?back=${encodeURIComponent(back)}` : ""}`} title="Shipment costs" sub="Freight, duties, forwarder … spread over the orders on this shipment." />}
    onSubmit={async v => {
      const { sales_order_id, purchase_order_id, ...ship } = v;
      if (row) { await db.update("shipments", { id: row.id }, ship); return; }
      if (!sales_order_id && !purchase_order_id) throw new Error("Choose a PI or a PO for this shipment");
      const s = await db.insert("shipments", ship);
      await db.insert("shipment_orders", { shipment_id: s.id, sales_order_id, purchase_order_id });
    }} />;
}

export function Stock() {
  const { db } = useApp();
  const stockRows = useRows("v_batch_item_stock", { order: [["batch_number", "desc"]] }).rows; const raw = useRows("batch_items").rows;
  const items = stockRows.map(s => ({ ...s, cost_basis: raw.find(r => r.id === s.batch_item_id)?.cost_basis, share_above_basis: raw.find(r => r.id === s.batch_item_id)?.share_above_basis }));
  const perProduct = useRows("v_product_stock", { order: [["product_name", "asc"]] }).rows; const moves = useRows("v_stock_movements", { order: [["movement_date", "desc"]] }).rows;
  const itemLabel = Object.fromEntries(items.map(i => [i.batch_item_id, `${i.batch_number} · ${i.product_name}`]));
  const neg = (v: any) => <span className={Number(v) < 0 ? "font-semibold text-rose-600" : ""}>{qty(v)}</span>;
  return <>
    <PageHeader title="NL stock" sub="Shipments the supplier places in our warehouse. An EXW sale from a batch costs the purchase price, plus the supplier's share of the margin when that is shared. Click a batch to change it.">
      <LinkButton to="/stock/batches/new"><Plus />New batch</LinkButton>
      <LinkButton variant="outline" to="/stock/corrections/new">Stock correction</LinkButton></PageHeader>
    {stockTabs}
    <div className="grid gap-6 xl:grid-cols-2">
      <Section title="Per batch and product" className="xl:col-span-2">
        <DataTable rows={items} search exportName="stock-per-batch" empty="No stock batches yet" rowTo={i => batchPath(i)} cols={[
          { key: "batch_number", header: "Batch#", render: i => <span className="font-semibold text-gray-900">{i.batch_number}</span> }, { key: "product_name", header: "Product" }, { key: "received_date", header: "Received on", render: i => date(i.received_date) },
          { key: "cost_basis", header: "Purchase price", align: "right", render: i => i.cost_basis == null ? <Pill tone="amber">missing</Pill> : money(i.cost_basis, "EUR", 2),
            edit: { kind: "number", save: (i, v) => db.update("batch_items", { id: i.batch_item_id }, { cost_basis: v }) } },
          { key: "share_above_basis", header: "Margin to supplier", align: "right", render: i => Number(i.share_above_basis) > 0 ? pct(i.share_above_basis, 0) : <span className="text-gray-400">not shared</span>,
            edit: { kind: "number", get: i => i.share_above_basis == null ? null : Number(i.share_above_basis) * 100, save: (i, v) => db.update("batch_items", { id: i.batch_item_id }, { share_above_basis: v == null || Number(v) === 0 ? null : Number(v) / 100 }) } },
          { key: "qty_received", header: "Quantity received", align: "right", render: i => qty(i.qty_received) }, { key: "adjustments", header: "Corrections", align: "right", render: i => qty(i.adjustments) },
          { key: "sold", header: "Sold", align: "right", render: i => qty(i.sold) }, { key: "stock", header: "In stock", align: "right", render: i => <b>{neg(i.stock)}</b> },
          { key: "sold_without_po", header: "Sold, no PO yet", align: "right", render: i => Number(i.sold_without_po) > 0 ? <span className="font-semibold text-amber-600">{qty(i.sold_without_po)}</span> : "–" }]} />
      </Section>
      <Section title="Per product" sub="Set a minimum per product (pencil); below it the product shows on the dashboard."><DataTable dense rows={perProduct.filter(p => Number(p.received_and_adjusted) || Number(p.sold_from_stock) || p.min_stock != null).map(p => ({ ...p, id: p.product_id }))} empty="No stock" cols={[{ key: "product_name", header: "Product" },
        { key: "received_and_adjusted", header: "Received + corrections", align: "right", render: p => qty(p.received_and_adjusted) }, { key: "sold_from_stock", header: "Sold", align: "right", render: p => qty(p.sold_from_stock) },
        { key: "stock", header: "In stock", align: "right", render: p => <span className="inline-flex items-center gap-1.5"><b>{neg(p.stock)}</b>{p.below_min && <Pill tone="red">low</Pill>}</span> },
        { key: "min_stock", header: "Minimum", align: "right", render: p => p.min_stock == null ? <span className="text-gray-400">–</span> : qty(p.min_stock),
          edit: { kind: "number", save: (p, v) => db.update("products", { id: p.product_id }, { min_stock: v == null || v === "" ? null : Math.max(0, Math.round(Number(v))) }) } },
        { key: "sold_90d", header: "Sold 90 days", align: "right", render: p => qty(p.sold_90d) },
        { key: "cover", header: "Weeks left", align: "right", value: p => Number(p.sold_90d) ? Number(p.stock) / (Number(p.sold_90d) / 13) : null, render: p => Number(p.sold_90d) ? `${Math.max(0, Math.floor(Number(p.stock) / (Number(p.sold_90d) / 13)))}` : "–" }]} /></Section>
      <Section title="Movements"><DataTable dense rows={moves} empty="No movements" cols={[{ key: "movement_date", header: "Date", render: m => date(m.movement_date) },
        { key: "item", header: "Batch · product", value: m => itemLabel[m.batch_item_id], render: m => itemLabel[m.batch_item_id] }, { key: "kind", header: "Type", render: m => STOCK_KIND[m.kind] ?? m.kind },
        { key: "reference", header: "Ref" }, { key: "quantity", header: "Qty", align: "right", render: m => neg(m.quantity) }]} /></Section>
    </div>
  </>;
}

export function StockCorrection() {
  const { db } = useApp(); const q = useQuery(); const items = useRows("v_batch_item_stock", { order: [["batch_number", "desc"]] }); const kinds = useRows("stock_adjustment_kinds").rows;
  if (items.loading && !items.rows.length) return <Loading />;
  const inBatch = items.rows.filter(i => i.batch_number === q.get("batch"));
  const back = inBatch.length ? { to: batchPath(inBatch[0]), label: `Batch ${inBatch[0].batch_number}` } : { to: "/stock", label: "NL stock" };
  return <FormPage title="Stock correction" sub="Count, damage or return. Less stock is a negative number." back={back} done={back.to} initial={{ adjustment_date: today(), batch_item_id: inBatch.length === 1 ? inBatch[0].batch_item_id : undefined }}
    fields={[{ name: "batch_item_id", label: "Batch · product", type: "select", required: true, options: items.rows.map(i => ({ value: i.batch_item_id, label: `${i.batch_number} · ${i.product_name} (${i.stock} in stock)` })) },
      { name: "adjustment_date", label: "Date", type: "date", span: 1 }, { name: "kind", label: "Kind", type: "select", span: 1, options: kinds.map(k => ({ value: k.code, label: STOCK_KIND[k.code] ?? k.code })) },
      { name: "quantity", label: "Quantity (+/-)", type: "number", required: true, span: 1 }, { name: "reference", label: "Reference", span: 1 }, { name: "notes", label: "Note", type: "textarea" }]}
    onSubmit={async v => { await db.insert("stock_adjustments", v); }} />;
}

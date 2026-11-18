/**
 * NL stock batches: /stock/batches/new, /stock/batches/1257_Best_Bright_DRTV, /stock/batches/1257_Best_Bright_DRTV/edit,
 * /stock/items/new?batch=…, /stock/items/1a2b3c4d
 *
 * A batch item has the supplier's purchase price and, optionally, a share of the margin for the supplier.
 * An EXW order line sold from the batch then costs: purchase price + (sale price − purchase price) × share.
 * Example: purchase 5.00, sold at 10.00, margin shared 50% → cost 7.50. That cost is also what the PO to the supplier says.
 * (The database calculates this; the screens only show it.)
 */
import { useState } from "react";
import { Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useRows } from "@/app/store";
import { Link, useNav, useParams, useQuery } from "@/app/router";
import { byShort, orderPath, poPath, supplierPath } from "@/app/paths";
import { ConfirmDialog, DataTable, FormPage, KV, LinkButton, Loading, NotFound, PageHeader, Pill, Section, Stat, type Field } from "@/app/ui";
import { date, money, pct, qty, today } from "@/app/format";

export const batchPath = (b: { batch_number: string }, sub = "") => `/stock/batches/${encodeURIComponent(b.batch_number)}${sub}`;
export const batchItemPath = (i: { batch_item_id?: string; id?: string }) => `/stock/items/${String(i.batch_item_id ?? i.id).slice(0, 8)}`;
/** "€5.00 + 50% of the margin", "€5.00 fixed", or a warning when there is no purchase price */
export const shareText = (basis: any, share: any) => basis == null && share == null ? null
  : Number(share) > 0 ? `${money(basis ?? 0, "EUR", 2)} + ${pct(share, 0)} of the margin` : `${money(basis, "EUR", 2)} fixed`;
const PriceCell = ({ i }: { i: any }) => { const t = shareText(i.cost_basis, i.share_above_basis); return t ? <span>{t}</span> : <Pill tone="amber">no purchase price</Pill>; };

// ---------------- one batch ----------------
export function BatchDetail() {
  const { batch } = useParams(); const { db } = useApp();
  const batches = useRows("v_batch_stock"); const b = batches.rows.find(x => x.batch_number === batch);
  const stock = useRows(b ? "v_batch_item_stock" : null, { eq: { batch_id: b?.batch_id } }).rows;
  const raw = useRows(b ? "batch_items" : null, { eq: { batch_id: b?.batch_id } }).rows;
  const sold = useRows("v_order_lines", { eq: { order_type: "EXW" } }).rows;
  const suppliers = useRows("suppliers").rows; const products = useRows("products").rows;
  if (!b) return batches.loading ? <Loading /> : <NotFound what={`Batch ${batch}`} back={{ to: "/stock", label: "NL stock" }} />;
  const items = stock.map(s => ({ ...s, ...raw.find(r => r.id === s.batch_item_id), batch_item_id: s.batch_item_id }));
  const ids = new Set(items.map(i => i.batch_item_id));
  const lines = sold.filter(l => ids.has(l.batch_item_id) && Number(l.qty) > 0);
  const sup = suppliers.find(s => s.id === b.supplier_id);
  const pName = Object.fromEntries(products.map(p => [p.id, p.name]));
  const noPrice = items.filter(i => i.cost_basis == null && i.share_above_basis == null).length;
  const pctField = (i: any) => i.share_above_basis == null ? null : Number(i.share_above_basis) * 100;
  return <>
    <PageHeader back={{ to: "/stock", label: "NL stock" }} title={`Batch ${b.batch_number}`}
      sub={<>{sup ? <Link to={supplierPath(sup)} className="text-gray-700 hover:text-indigo-600">{sup.name}</Link> : "No supplier"} · received {date(b.received_date)}{b.reference ? ` · ${b.reference}` : ""}</>}>
      <LinkButton variant="outline" to={batchPath(b, "/edit")}><Pencil />Edit batch</LinkButton>
      <LinkButton variant="outline" to={`/stock/corrections/new?batch=${encodeURIComponent(b.batch_number)}`}><SlidersHorizontal />Stock correction</LinkButton>
      <LinkButton to={`/stock/items/new?batch=${encodeURIComponent(b.batch_number)}`}><Plus />Add product</LinkButton>
    </PageHeader>
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat label="Received" value={qty(b.received)} hint={`${b.product_count} product(s)`} />
      <Stat label="Sold" value={qty(b.sold)} hint={Number(b.sold_without_po) > 0 ? `${qty(b.sold_without_po)} without PO to the supplier` : "all on a PO"} tone={Number(b.sold_without_po) > 0 ? "warn" : undefined} />
      <Stat label="In stock" value={qty(b.stock)} tone={Number(b.stock) < 0 ? "bad" : undefined} />
      <Stat label="Purchase price" value={noPrice ? `${noPrice} missing` : "complete"} tone={noPrice ? "warn" : "good"} hint={noPrice ? "EXW orders from this batch have no cost" : undefined} />
    </div>
    <Section title="Products in this batch" sub="Purchase price and margin share can be changed here: click the pencil, or open a line. Open orders follow at once; completed orders keep their cost." className="mb-6">
      <DataTable rows={items} rowTo={i => batchItemPath(i)} empty="No products in this batch yet" cols={[
        { key: "product_name", header: "Product", render: i => <span className="font-medium text-gray-900">{i.product_name}</span> },
        { key: "qty_received", header: "Received", align: "right", render: i => qty(i.qty_received), edit: { kind: "number", save: (i, v) => db.update("batch_items", { id: i.batch_item_id }, { qty_received: v ?? 0 }) } },
        { key: "sold", header: "Sold", align: "right", render: i => qty(i.sold) },
        { key: "stock", header: "In stock", align: "right", render: i => <b className={Number(i.stock) < 0 ? "text-rose-600" : ""}>{qty(i.stock)}</b> },
        { key: "cost_basis", header: "Purchase price (€)", align: "right", render: i => i.cost_basis == null ? <span className="text-amber-600">missing</span> : money(i.cost_basis, "EUR", 2),
          edit: { kind: "number", save: (i, v) => db.update("batch_items", { id: i.batch_item_id }, { cost_basis: v }) } },
        { key: "share", header: "Margin to supplier", align: "right", value: i => i.share_above_basis, render: i => Number(i.share_above_basis) > 0 ? pct(i.share_above_basis, 0) : <span className="text-gray-400">not shared</span>,
          edit: { kind: "number", get: pctField, save: (i, v) => db.update("batch_items", { id: i.batch_item_id }, { share_above_basis: v == null || Number(v) === 0 ? null : Number(v) / 100 }) } },
        { key: "rule", header: "Cost on an EXW sale", value: i => shareText(i.cost_basis, i.share_above_basis), render: i => <PriceCell i={i} /> },
      ]} />
    </Section>
    <Section title="Sold from this batch" sub="The cost per piece follows from the purchase price and margin share above; it is also the price on the PO to the supplier.">
      <DataTable rows={lines} rowTo={l => orderPath({ pi_number: l.pi_number, id: l.sales_order_id })} empty="Nothing sold from this batch yet" cols={[
        { key: "pi_number", header: "PI#", render: l => <span className="font-semibold text-gray-900">{l.pi_number ?? "draft"}</span> },
        { key: "product", header: "Product", value: l => pName[l.product_id], render: l => pName[l.product_id] },
        { key: "revenue_date", header: "Date", render: l => date(l.revenue_date) },
        { key: "qty", header: "Qty", align: "right", render: l => qty(l.qty) },
        { key: "unit_price", header: "Sold at", align: "right", render: l => money(l.unit_price, l.currency, 2) },
        { key: "unit_cost", header: "Cost / pc", align: "right", render: l => l.unit_cost == null ? <span className="text-amber-600">unknown</span> : <span>{money(l.unit_cost, l.currency, 2)}{l.cost_is_final && <span className="ml-1 text-xs text-gray-400">final</span>}</span> },
        { key: "purchase_value", header: "To supplier", align: "right", render: l => l.unit_cost == null ? "–" : money(l.purchase_value, l.currency) },
        { key: "po", header: "PO", render: l => l.purchase_order_id ? <POLink id={l.purchase_order_id} /> : <Link to={orderPath({ pi_number: l.pi_number, id: l.sales_order_id }, "/purchase-order")} onClick={e => e.stopPropagation()} className="text-xs font-medium text-amber-700 hover:underline">no PO · create</Link> },
      ]} />
    </Section>
  </>;
}
function POLink({ id }: { id: string }) {
  const p = useRows("v_purchase_orders").rows.find(x => x.id === id);
  return p ? <Link to={poPath(p)} onClick={e => e.stopPropagation()} className="text-indigo-600 hover:underline">PO {p.po_number}</Link> : <span>–</span>;
}

// ---------------- batch: new and edit ----------------
export function BatchForm() {
  const { batch } = useParams(); const { db } = useApp();
  const suppliers = useRows("suppliers", { order: [["name", "asc"]] }).rows;
  const batches = useRows("batches"); const b = batch ? batches.rows.find(x => x.batch_number === batch) : undefined;
  if (batch && !b) return batches.loading ? <Loading /> : <NotFound what={`Batch ${batch}`} back={{ to: "/stock", label: "NL stock" }} />;
  return <FormPage title={b ? `Edit batch ${b.batch_number}` : "New batch"} sub={b ? undefined : "One batch per shipment the supplier places with us. The products and their purchase price come next."}
    back={b ? { to: batchPath(b), label: `Batch ${b.batch_number}` } : { to: "/stock", label: "NL stock" }} initial={b ?? { received_date: today() }}
    fields={[{ name: "batch_number", label: "Batch#", required: true, span: 1 }, { name: "received_date", label: "Received on", type: "date", span: 1 },
      { name: "supplier_id", label: "Supplier", type: "select", required: true, options: suppliers.map(s => ({ value: s.id, label: s.name })), hint: "The PO for what is sold from this batch goes to this supplier" },
      { name: "reference", label: "Container# / reference" }, { name: "notes", label: "Note", type: "textarea" }]}
    onSubmit={async v => {
      if (b) await db.update("batches", { id: b.id }, v); else await db.insert("batches", v);
      return b ? batchPath({ batch_number: v.batch_number }) : `/stock/items/new?batch=${encodeURIComponent(v.batch_number)}`;
    }} />;
}

// ---------------- product in a batch: new and edit ----------------
export function BatchItemForm() {
  const { id } = useParams(); const q = useQuery(); const { db, run } = useApp(); const nav = useNav();
  const batches = useRows("batches", { order: [["batch_number", "desc"]] }); const products = useRows("products", { order: [["name", "asc"]] }).rows;
  const items = useRows("batch_items"); const stock = useRows("v_batch_item_stock").rows;
  const [confirm, setConfirm] = useState(false);
  if (batches.loading || items.loading) return <Loading />;
  const it = id ? byShort(items.rows, id) : undefined;
  if (id && !it) return <NotFound what="Batch line" back={{ to: "/stock", label: "NL stock" }} />;
  const b = batches.rows.find(x => x.id === it?.batch_id) ?? batches.rows.find(x => x.batch_number === q.get("batch"));
  const st = it ? stock.find(s => s.batch_item_id === it.id) : undefined;
  const back = b ? { to: batchPath(b), label: `Batch ${b.batch_number}` } : { to: "/stock", label: "NL stock" };
  const fields: Field[] = [
    { name: "batch_id", label: "Batch", type: "select", required: true, span: 1, options: batches.rows.map(x => ({ value: x.id, label: x.batch_number })) },
    { name: "product_id", label: "Product", type: "select", required: true, span: 1, options: products.map(p => ({ value: p.id, label: p.name })) },
    { name: "qty_received", label: "Quantity received", type: "number", required: true, span: 1 },
    { name: "cost_basis", label: "Purchase price per piece (€)", type: "number", span: 1, section: "Purchase price", hint: "What the supplier charges us per piece" },
    { name: "share_margin", label: "Share the margin with the supplier", type: "checkbox", span: 1, section: "Purchase price" },
    { name: "share_pct", label: "Supplier's share of the margin %", type: "number", span: 1, section: "Purchase price", hint: "Only used when the margin is shared. 50 = half each" },
    { name: "notes", label: "Note", type: "textarea", section: "Note" },
  ];
  const initial = it ? { ...it, share_margin: Number(it.share_above_basis) > 0, share_pct: it.share_above_basis == null ? 50 : Number(it.share_above_basis) * 100 }
    : { batch_id: b?.id, share_margin: false, share_pct: 50 };
  return <>
    <FormPage title={it ? `${products.find(p => p.id === it.product_id)?.name ?? "Product"} in batch ${b?.batch_number ?? ""}` : "Add product to batch"} back={back} fields={fields} initial={initial}
      sub={<>Cost of an EXW sale from this batch = purchase price + (sale price − purchase price) × the supplier's share. Example: purchase €5.00, sold at €10.00, margin shared 50% → cost €7.50. Not shared → cost €5.00. That cost is also the price on the PO to the supplier.</>}
      done={b ? batchPath(b) : "/stock"}
      onSubmit={async v => {
        const { share_margin, share_pct, ...row } = v;
        const p = Number(share_pct);
        if (share_margin && !(p > 0 && p <= 100)) throw new Error("Supplier's share: a percentage between 1 and 100");
        const body = { ...row, share_above_basis: share_margin ? p / 100 : null };
        if (it) await db.update("batch_items", { id: it.id }, body); else await db.insert("batch_items", body);
        const nb = batches.rows.find(x => x.id === v.batch_id); return nb ? batchPath(nb) : "/stock";
      }}
      aside={it && st && <Section title="This batch line">
        <KV items={[["Sold", qty(st.sold)], ["In stock", qty(st.stock)], ["Sold without PO", qty(st.sold_without_po)]]} />
        <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">A changed price applies at once to open orders sold from this line. Completed orders keep the cost they were closed with.</p>
        {Number(st.sold) === 0 && <div className="border-t border-gray-100 px-5 py-3"><Button variant="ghost" className="w-full text-rose-600" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />Remove from batch</Button></div>}
      </Section>} />
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title="Remove this product from the batch?" body="Nothing was sold from it, so no order changes. Stock corrections on this line are removed too." confirmLabel="Remove"
      onConfirm={() => it && run(async () => { for (const a of await db.select<any>("stock_adjustments", { eq: { batch_item_id: it.id } })) await db.remove("stock_adjustments", { id: a.id }); await db.remove("batch_items", { id: it.id }); }, "Removed from batch").then(() => nav(back.to))} />
  </>;
}

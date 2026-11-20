/**
 * A PO's own lines: things bought for stock, components, packaging or a service, not tied to a sales order.
 * They count in what the PO costs. "Receive into stock" puts product lines into a new own-stock batch at the PO price.
 */
import { useState } from "react";
import { PackagePlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorText, useApp, useRows } from "@/app/store";
import { Link, useNav, useParams } from "@/app/router";
import { poPath, productPath } from "@/app/paths";
import { Combobox } from "@/app/Combobox";
import { DataTable, LinkButton, Loading, Notice, NotFound, PageHeader, Section, selectClass } from "@/app/ui";
import { money, pct, qty, today } from "@/app/format";
import { VAT_OPTIONS } from "@/app/vat";
import { toast } from "@/app/notify";
import { batchPath } from "@/modules/stock/Batches";

export const unitText = (u?: string | null) => (u === "ml" ? "ml" : "pcs");
const inputClass = "h-9 w-full rounded-md border border-gray-300 px-2.5 text-sm tabular-nums focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export function POOwnLines({ p }: { p: any }) {
  const { db, run } = useApp();
  const rows = useRows("v_purchase_order_lines", { eq: { purchase_order_id: p.id }, order: [["line_no", "asc"]] }).rows;
  const products = useRows("products", { order: [["name", "asc"]] }).rows;
  const empty = { product_id: "", description: "", quantity: "", unit_price: "", vat_rate: "" };
  const [n, setN] = useState(empty); const [busy, setBusy] = useState(false);
  const cur = p.currency; const base = poPath(p);
  const prod = products.find(x => x.id === n.product_id);
  const canReceive = rows.some(r => r.product_id && Number(r.received) < Number(r.quantity));
  const add = async () => {
    if (!n.product_id && !n.description.trim()) return toast.error("Choose a product or type a description");
    if (!(Number(n.quantity) > 0)) return toast.error("Give a quantity");
    if (n.unit_price === "" || Number(n.unit_price) < 0) return toast.error("Give a unit price");
    setBusy(true);
    const ok = await run(() => db.insert("purchase_order_lines", {
      purchase_order_id: p.id, line_no: (rows.at(-1)?.line_no ?? 0) + 1, product_id: n.product_id || null, description: n.description.trim() || null,
      quantity: Number(n.quantity), unit_price: Number(n.unit_price),
      vat_rate: n.vat_rate === "" ? (prod?.vat_rate ?? null) : Number(n.vat_rate) }), "Line added");
    setBusy(false); if (ok !== undefined) setN(empty);
  };
  return <Section title="Lines on this PO" sub="Bought for stock, components, packaging or a service: not tied to a sales order. They count in what this PO costs."
    action={canReceive ? <LinkButton size="sm" to={`${base}/receive`}><PackagePlus />Receive into stock</LinkButton> : undefined}>
    <DataTable rows={rows} empty="No lines yet. Add one below." cols={[
      { key: "line_no", header: "#", render: r => <span className="text-gray-400">{r.line_no}</span> },
      { key: "what", header: "Product / description", value: r => r.product_name ?? r.description, render: r => <div>
        {r.product_id ? <Link to={productPath({ name: r.product_name })} className="font-medium text-gray-900 hover:text-indigo-600">{r.product_name}</Link> : <span className="font-medium text-gray-900">{r.description}</span>}
        {r.product_id && r.description && <div className="text-xs text-gray-500">{r.description}</div>}{!r.product_id && <div className="text-xs text-gray-400">service / not stocked</div>}</div> },
      { key: "quantity", header: "Qty", align: "right", render: r => `${qty(r.quantity)} ${r.product_id ? unitText(r.unit) : ""}`,
        edit: { kind: "number", save: (r, v) => db.update("purchase_order_lines", { id: r.id }, { quantity: v }) } },
      { key: "unit_price", header: "Unit price", align: "right", render: r => money(r.unit_price, cur, 4),
        edit: { kind: "number", save: (r, v) => db.update("purchase_order_lines", { id: r.id }, { unit_price: v }) } },
      ...(p.vat_applies ? [{ key: "vat_rate", header: "VAT", align: "right" as const, render: (r: any) => r.vat_rate == null ? <span className="text-amber-600">0%</span> : pct(r.vat_rate, 0) }] : []),
      { key: "amount", header: "Amount", align: "right", render: r => money(r.amount, cur) },
      { key: "received", header: "Received", align: "right", render: r => !r.product_id ? "–" : Number(r.received) >= Number(r.quantity) ? <span className="text-emerald-700">all</span> : Number(r.received) > 0 ? `${qty(r.received)} of ${qty(r.quantity)}` : <span className="text-gray-400">not yet</span> },
      { key: "x", header: "", render: r => Number(r.received) > 0 ? null : <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-rose-600" aria-label="Remove line"
        onClick={() => run(() => db.remove("purchase_order_lines", { id: r.id }), "Line removed")}><Trash2 className="h-3.5 w-3.5" /></Button> }]} />
    <div className="grid grid-cols-2 items-end gap-2 border-t border-gray-100 px-5 py-3 md:grid-cols-[2fr_1.4fr_0.8fr_0.9fr_0.9fr_auto]">
      <div className="col-span-2 md:col-span-1"><label className="mb-1 block text-xs font-medium text-gray-600">Product</label>
        <Combobox label="Product" value={n.product_id} onChange={v => setN(x => ({ ...x, product_id: v ?? "", unit_price: x.unit_price }))} placeholder="Type to search, or leave empty for a service"
          options={products.map(x => ({ value: x.id, label: x.name, hint: x.sku ?? undefined }))} createNoun="product"
          create={async name => (await run(() => db.insert("products", { name }), "Product added; fill in its details on the product page") as any)?.id} /></div>
      <div className="col-span-2 md:col-span-1"><label className="mb-1 block text-xs font-medium text-gray-600">{n.product_id ? "Note (optional)" : "Description"}</label>
        <input aria-label="Description" className={inputClass} value={n.description} onChange={e => setN(x => ({ ...x, description: e.target.value }))} placeholder={n.product_id ? "" : "e.g. Assembling 1,000 pcs"} /></div>
      <div><label className="mb-1 block text-xs font-medium text-gray-600">Qty{prod ? ` (${unitText(prod.unit)})` : ""}</label>
        <input aria-label="Quantity" inputMode="decimal" className={inputClass} value={n.quantity} onChange={e => setN(x => ({ ...x, quantity: e.target.value.replace(",", ".") }))} /></div>
      <div><label className="mb-1 block text-xs font-medium text-gray-600">Unit price ({cur})</label>
        <input aria-label="Unit price" inputMode="decimal" className={inputClass} value={n.unit_price} onChange={e => setN(x => ({ ...x, unit_price: e.target.value.replace(",", ".") }))} /></div>
      {p.vat_applies ? <div><label className="mb-1 block text-xs font-medium text-gray-600">VAT</label>
        <select aria-label="VAT" className={selectClass + " w-full"} value={n.vat_rate === "" ? String(prod?.vat_rate ?? "0.21") : n.vat_rate} onChange={e => setN(x => ({ ...x, vat_rate: e.target.value }))}>
          {VAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}<option value="0">0%</option></select></div> : <div />}
      <Button onClick={add} disabled={busy} className="col-span-2 md:col-span-1"><Plus />Add</Button>
    </div>
  </Section>;
}

export function PurchaseOrderReceive() {
  const { po } = useParams(); const { db, run } = useApp(); const nav = useNav();
  const { rows: pos, loading } = useRows("v_purchase_orders", { eq: { po_number: po } }); const p = pos[0];
  const lines = useRows(p ? "v_purchase_order_lines" : null, { eq: { purchase_order_id: p?.id }, order: [["line_no", "asc"]] }).rows.filter(l => l.product_id);
  const batches = useRows("batches").rows;
  const [batchNo, setBatchNo] = useState(""); const [when, setWhen] = useState(today()); const [q, setQ] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  if (!p) return loading ? <Loading /> : <NotFound what={`PO ${po}`} back={{ to: "/purchasing", label: "All purchase orders" }} />;
  const open = (l: any) => Math.max(0, Number(l.quantity) - Number(l.received));
  const val = (l: any) => q[l.id] ?? String(open(l));
  const taken = batches.some(b => b.batch_number === batchNo.trim());
  const go = async () => {
    const payload = lines.map(l => ({ line_id: l.id, qty: Number(val(l) || 0) })).filter(x => x.qty > 0);
    if (!batchNo.trim()) return toast.error("Give the batch a number");
    if (!payload.length) return toast.error("Nothing to receive");
    setBusy(true);
    const id = await run(() => db.rpc<string>("receive_po_lines", { p_po: p.id, p_batch_number: batchNo.trim(), p_received: when, p_lines: payload }), "Received into stock");
    setBusy(false);
    if (id) nav(batchPath({ batch_number: batchNo.trim() }));
  };
  return <>
    <PageHeader back={{ to: poPath(p), label: `PO ${p.po_number}` }} title="Receive into stock" sub={`${p.supplier_name} · the goods go into a new batch as own stock, at the PO price${p.currency !== "EUR" ? " in euros (rate of the day received)" : ""}`} />
    <div className="max-w-3xl space-y-5">
      <Section title="Batch"><div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
        <div><label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="bn">Batch#</label>
          <input id="bn" className={inputClass} value={batchNo} onChange={e => setBatchNo(e.target.value)} placeholder={`e.g. ${p.po_number}-1`} />
          {taken && <p className="mt-1 text-xs text-rose-600">This batch number already exists</p>}</div>
        <div><label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="rd">Received on</label>
          <input id="rd" type="date" className={inputClass} value={when} onChange={e => setWhen(e.target.value)} /></div>
      </div></Section>
      <Section title="What came in" sub="Change a quantity for a partial delivery; the rest can be received later.">
        <DataTable rows={lines} empty="No product lines on this PO" cols={[
          { key: "product_name", header: "Product", render: l => <span className="font-medium text-gray-900">{l.product_name}</span> },
          { key: "quantity", header: "Ordered", align: "right", render: l => `${qty(l.quantity)} ${unitText(l.unit)}` },
          { key: "received", header: "Already in", align: "right", render: l => qty(l.received) },
          { key: "now", header: "Received now", align: "right", render: l => <input aria-label={`Received now: ${l.product_name}`} inputMode="numeric" className={inputClass + " w-28 text-right"} value={val(l)}
            onChange={e => setQ(x => ({ ...x, [l.id]: e.target.value.replace(/[^\d]/g, "") }))} /> },
          { key: "price", header: "Cost price", align: "right", render: l => money(l.unit_price, p.currency, 4) }]} />
      </Section>
      {lines.every(l => open(l) === 0) && <Notice tone="sky">Everything on this PO is already received.</Notice>}
      <div className="flex justify-end gap-2"><LinkButton variant="outline" to={poPath(p)}>Cancel</LinkButton>
        <Button onClick={go} disabled={busy || taken}><PackagePlus className="h-4 w-4" />{busy ? "Receiving…" : "Receive into stock"}</Button></div>
    </div>
  </>;
}

/** PO document: own lines with their VAT */
export function ownVat(lines: any[]) {
  const by: Record<string, { rate: number; base: number; vat: number }> = {};
  for (const l of lines) { const r = Number(l.vat_rate ?? 0); const b = Number(l.amount); const k = String(r);
    by[k] ??= { rate: r, base: 0, vat: 0 }; by[k].base += b; by[k].vat += Math.round(b * r * 100) / 100; }
  return Object.values(by);
}
export { errorText };

/**
 * Landed costs: freight, duties, insurance, forwarder, inspection, commission, storage or other costs on a shipment
 * (spread over its orders), on one order, or on a stock batch (spread over its products, then per piece sold).
 * The database spreads them (v_landed_cost_allocation, v_batch_landed) and adds them to the cost price of the
 * order lines, so total cost, margin and margin % include them.
 * Routes: /costs/new?shipment=…|order=…|batch=…&back=…, /costs/1a2b3c4d?back=…
 */
import { useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useRows } from "@/app/store";
import { Link, useNav, useParams, useQuery } from "@/app/router";
import { byShort, orderPath, shipmentPath } from "@/app/paths";
import { ConfirmDialog, FormPage, Loading, NotFound, Section, type Field } from "@/app/ui";
import { date, money } from "@/app/format";
import { useCan } from "@/app/permissions";

export const KIND_LABEL: Record<string, string> = { freight: "Freight", duties: "Import duties", insurance: "Insurance", forwarder: "Forwarder / handling", inspection: "Inspection", commission: "Commission", storage: "Storage", other: "Other" };
export const BASIS_LABEL: Record<string, string> = { value: "by value", quantity: "by quantity", volume: "by volume (cbm)", weight: "by weight" };
export const costPath = (c: { id: string }, back: string) => `/costs/${String(c.id).slice(0, 8)}?back=${encodeURIComponent(back)}`;
const newPath = (k: string, id: string, back: string) => `/costs/new?${k}=${id}&back=${encodeURIComponent(back)}`;

/** the costs on a shipment, an order or a batch, with how they are spread */
export function LandedCostList({ shipment, order, batch, back, title = "Extra costs", sub, compact }: {
  shipment?: string; order?: string; batch?: string; back: string; title?: ReactNode; sub?: ReactNode; compact?: boolean;
}) {
  const filter = shipment ? { shipment_id: shipment } : order ? { sales_order_id: order } : { batch_id: batch };
  const rows = useRows("landed_costs", { eq: filter, order: [["created_at", "asc"]] }).rows;
  const suppliers = useRows("suppliers").rows;
  const alloc = useRows(shipment ? "v_landed_cost_allocation" : null).rows;
  const orders = useRows(shipment ? "v_orders" : null).rows;
  const perOrder = (costId: string) => Object.entries(alloc.filter(a => a.cost_id === costId).reduce<Record<string, { amount: number; cur: string }>>((m, a) => {
    const t = m[a.sales_order_id] ?? { amount: 0, cur: a.order_currency }; t.amount += Number(a.amount ?? 0); m[a.sales_order_id] = t; return m; }, {}));
  const total = rows.reduce<Record<string, number>>((m, c) => ({ ...m, [c.currency]: (m[c.currency] ?? 0) + Number(c.amount) }), {});
  const add = newPath(shipment ? "shipment" : order ? "order" : "batch", (shipment ?? order ?? batch)!, back);
  return <Section title={title} sub={sub} action={<Link to={add} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"><Plus className="h-3.5 w-3.5" />Add cost</Link>}>
    {!rows.length ? <p className="px-5 py-5 text-sm text-gray-500">No extra costs yet.</p> :
      <ul className="divide-y divide-gray-100">{rows.map(c => { const sup = suppliers.find(s => s.id === c.supplier_id); const spread = shipment ? perOrder(c.id) : [];
        return <li key={c.id}><Link to={costPath(c, back)} className="block px-5 py-2.5 hover:bg-gray-50">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate"><span className="font-medium text-gray-900">{KIND_LABEL[c.kind]}</span>{c.description ? <span className="text-gray-600"> · {c.description}</span> : null}</span>
            <span className="shrink-0 font-semibold tabular-nums text-gray-900">{money(c.amount, c.currency)}</span></div>
          <div className="text-xs text-gray-500">{[sup?.name, c.invoice_number && `invoice ${c.invoice_number}`, c.invoice_date && date(c.invoice_date), BASIS_LABEL[c.allocate_by]].filter(Boolean).join(" · ")}</div>
          {!compact && spread.length > 0 && <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-500">{spread.map(([oid, t]) => { const o = orders.find(x => x.id === oid);
            return <span key={oid}>{o?.pi_number ? `PI ${o.pi_number}` : "draft"}: {money(t.amount, t.cur)}</span>; })}</div>}
        </Link></li>; })}</ul>}
    {rows.length > 0 && <div className="flex justify-between border-t border-gray-100 px-5 py-2.5 text-sm"><span className="text-gray-500">Total</span>
      <span className="font-semibold tabular-nums">{Object.entries(total).map(([cur, v]) => money(v, cur)).join(" + ")}</span></div>}
  </Section>;
}

/** on the order page: everything extra this order carries, from wherever it comes */
export function OrderCosts({ o, lines, shipment }: { o: any; lines: any[]; shipment: any }) {
  const can = useCan(); const base = orderPath(o);
  const direct = useRows("landed_costs", { eq: { sales_order_id: o.id } }).rows;
  const alloc = useRows("v_landed_cost_allocation", { eq: { sales_order_id: o.id } }).rows;
  const shipCosts = useRows(shipment ? "landed_costs" : null, { eq: { shipment_id: shipment?.id } }).rows;
  if (!can("see_costs")) return null;
  const cur = o.currency;
  const landed = lines.reduce((a, l) => a + Number(l.landed_costs ?? 0), 0);
  const manual = lines.reduce((a, l) => a + Number(l.extra_costs ?? 0) - Number(l.landed_costs ?? 0), 0);
  const sum = (ids: string[]) => alloc.filter(a => ids.includes(a.cost_id)).reduce((s, a) => s + Number(a.amount ?? 0), 0);
  const fromShipment = sum(shipCosts.map(c => c.id)); const fromOrder = sum(direct.map(c => c.id));
  const fromBatch = landed - fromShipment - fromOrder;
  const row = (label: ReactNode, v: number, hint?: string) => <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
    <span className="text-gray-600">{label}{hint && <span className="text-xs text-gray-400"> · {hint}</span>}</span><span className="tabular-nums text-gray-900">{money(v, cur)}</span></div>;
  return <Section title="Extra costs" sub="Freight, duties, forwarder and other costs on this order, its share of the shipment's costs, and landed costs of stock it is sold from. They count in the margin."
    action={<span className="flex gap-3">
      <Link to={newPath("order", o.id, base)} className="text-xs font-medium text-indigo-600 hover:underline">+ On this order</Link>
      {shipment && <Link to={newPath("shipment", shipment.id, base)} className="text-xs font-medium text-indigo-600 hover:underline">+ On the shipment</Link>}</span>}>
    <div className="px-5 py-3">
      {direct.length > 0 && <ul className="mb-2 divide-y divide-gray-100 rounded-lg border border-gray-100">{direct.map(c => <li key={c.id}>
        <Link to={costPath(c, base)} className="flex justify-between gap-3 px-3 py-1.5 text-sm hover:bg-gray-50"><span>{KIND_LABEL[c.kind]}{c.description ? ` · ${c.description}` : ""}</span><span className="tabular-nums">{money(c.amount, c.currency)}</span></Link></li>)}</ul>}
      {row("On this order", fromOrder)}
      {row(shipment ? <>Share of the shipment <Link to={`${shipmentPath(shipment, "/edit")}?back=${encodeURIComponent(base)}`} className="text-indigo-600 hover:underline">{shipment.container_number || "costs"}</Link></> : "Share of a shipment", fromShipment,
        shipCosts.length ? `${shipCosts.length} cost(s) on the shipment` : shipment ? "none yet" : "not on a shipment")}
      {Math.abs(fromBatch) > 0.004 && row("Landed costs of stock (per piece)", fromBatch)}
      {Math.abs(manual) > 0.004 && row("Older cost lines", manual)}
      <div className="mt-1 flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold"><span>Total extra costs</span><span className="tabular-nums">{money(landed + manual, cur)}</span></div>
      {lines.some(l => l.landed_fx_missing) && <p className="mt-2 text-xs text-amber-700">An exchange rate is missing for a cost in another currency; it counts as 0 until the rate is there.</p>}
    </div>
  </Section>;
}

// ---------------- form ----------------
const CURRENCIES = [{ value: "EUR", label: "EUR" }, { value: "USD", label: "USD" }];
export function LandedCostForm() {
  const { id } = useParams(); const q = useQuery(); const { db, run } = useApp(); const nav = useNav();
  const costs = useRows("landed_costs"); const suppliers = useRows("suppliers", { order: [["name", "asc"]] }).rows;
  const shipsQ = useRows("shipments"); const ordersQ = useRows("v_orders"); const batchesQ = useRows("batches");
  const ships = shipsQ.rows, orders = ordersQ.rows, batches = batchesQ.rows;
  const [confirm, setConfirm] = useState(false);
  const c = id ? byShort(costs.rows, id) : undefined;
  // the defaults (currency, how to spread) depend on what the cost is on, so wait for it
  if ((costs.loading && !costs.rows.length) || [shipsQ, ordersQ, batchesQ].some(x => x.loading && !x.rows.length)) return <Loading />;
  if (id && !c) return <NotFound what="Cost" back={{ to: q.get("back") ?? "/shipping", label: "Back" }} />;
  const target = c ? { shipment_id: c.shipment_id, sales_order_id: c.sales_order_id, batch_id: c.batch_id }
    : { shipment_id: q.get("shipment"), sales_order_id: q.get("order"), batch_id: q.get("batch") };
  const sh = ships.find(s => s.id === target.shipment_id), o = orders.find(x => x.id === target.sales_order_id), b = batches.find(x => x.id === target.batch_id);
  const on = sh ? `shipment ${sh.container_number || ""}`.trim() : o ? (o.pi_number ? `PI ${o.pi_number}` : "a draft order") : b ? `batch ${b.batch_number}` : "–";
  const back = q.get("back") ?? (o ? orderPath(o) : "/shipping");
  if (!target.shipment_id && !target.sales_order_id && !target.batch_id) return <NotFound what="Shipment, order or batch for this cost" back={{ to: back, label: "Back" }} />;
  const fields: Field[] = [
    { name: "kind", label: "Kind", type: "select", required: true, span: 1, options: Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })) },
    { name: "description", label: "Description", span: 1, placeholder: "e.g. sea freight Ningbo → Rotterdam" },
    { name: "amount", label: "Amount without VAT", type: "number", required: true, span: 1 },
    { name: "currency", label: "Currency", type: "select", required: true, span: 1, options: CURRENCIES, hint: "Another currency than the order's is converted at the ECB rate of the invoice date" },
    { name: "allocate_by", label: sh ? "Spread over the orders" : o ? "Spread over the lines" : "Spread over the products", type: "select", required: true, options: Object.entries(BASIS_LABEL).map(([value, label]) => ({ value, label: label.replace(/^by/, "By") })),
      hint: "Volume and weight use the carton data of the products; where that is missing, by quantity" },
    { name: "supplier_id", label: "Invoiced by", type: "select", section: "Invoice", options: suppliers.map(s => ({ value: s.id, label: s.name })), hint: "Forwarder, broker or agent (optional)" },
    { name: "invoice_number", label: "Invoice number", span: 1, section: "Invoice" }, { name: "invoice_date", label: "Invoice date", type: "date", span: 1, section: "Invoice" },
  ];
  return <>
    <FormPage title={c ? `${KIND_LABEL[c.kind]} on ${on}` : `Extra cost on ${on}`} back={{ to: back, label: "Back" }} done={back} fields={fields}
      sub={sh ? "Spread over every order on this shipment." : o ? "Counts in this order's cost price." : b ? "Spread over the products of this batch, then added per piece to every EXW sale from it and to the stock value." : undefined}
      initial={c ?? { kind: "freight", currency: b ? "EUR" : o?.currency ?? "USD", allocate_by: b ? "quantity" : "value" }}
      onSubmit={async v => {
        const body = { kind: v.kind, description: v.description || null, amount: v.amount, currency: v.currency, allocate_by: v.allocate_by,
          supplier_id: v.supplier_id || null, invoice_number: v.invoice_number || null, invoice_date: v.invoice_date || null };
        if (c) await db.update("landed_costs", { id: c.id }, body); else await db.insert("landed_costs", { ...target, ...body });
      }}
      aside={c && <Section title="This cost"><div className="space-y-3 px-5 py-4 text-sm text-gray-600"><p>Deleting it takes it out of the cost price at once. It stays 30 days in Admin → Recycle bin.</p>
        <Button variant="ghost" className="w-full text-rose-600" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />Delete cost</Button></div></Section>} />
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title="Delete this cost?" body="It leaves the cost price of the orders straight away." confirmLabel="Delete"
      onConfirm={() => c && run(async () => { await db.remove("landed_costs", { id: c.id }); return true; }, "Cost deleted").then(ok => { if (ok) nav(back); })} />
  </>;
}

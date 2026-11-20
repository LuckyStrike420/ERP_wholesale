/**
 * Two blocks on the order page:
 * - Shipment: link the order to a shipment that already exists, start a new one, or unlink, without leaving the order.
 * - To pay suppliers: the purchase orders behind this order, what they cost, what is paid and what is still open.
 */
import { place } from "@/app/countries";
import { useCan } from "@/app/permissions";
import { useState, type ReactNode } from "react";
import { dateLabels, isSea, MODE_LABEL, shipmentLabel, trackingUrl } from "@/modules/logistics/transport";
import { Plus, Ship, Unlink, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useRows } from "@/app/store";
import { Link } from "@/app/router";
import { orderPath, poPath, shipmentPath } from "@/app/paths";
import { ConfirmDialog, KV, LinkButton, Pill, Section, selectClass } from "@/app/ui";
import { date, money, SHIP_LABEL } from "@/app/format";
import { cn } from "@/lib/utils";

const SHIP_TONE: Record<string, string> = { awaiting_info: "grey", planned: "blue", in_transit: "amber", arrived: "green", collected: "green" };
const shipLabel = (s: any) => [shipmentLabel(s), s.pi_numbers ? `PI ${s.pi_numbers}` : null, s.etd ? `ETD ${date(s.etd)}` : s.eta ? `ETA ${date(s.eta)}` : null].filter(Boolean).join(" · ");

export function OrderShipment({ o, shipment, lines, locked }: { o: any; shipment: any; lines: any[]; locked: boolean }) {
  const { db, run, refresh } = useApp();
  const ships = useRows("v_shipments", { order: [["etd", "desc"]] }).rows; const links = useRows("shipment_orders").rows;
  const [pick, setPick] = useState(""); const [unlink, setUnlink] = useState(false);
  const term = useRows("v_order_delivery", { eq: { sales_order_id: o.id } }).rows[0]?.incoterm ?? o.order_type;
  const collects = term === "EXW" || term === "FCA";   // the customer collects from our warehouse
  const base = orderPath(o);
  const pos = [...new Set(lines.map(l => l.purchase_order_id).filter(Boolean))] as string[];
  const onePo = pos.length === 1 ? pos[0] : null;
  const open = ships.filter(s => s.status !== "arrived" || s.id === pick);
  const link = (sid: string) => run(async () => {
    const poAlready = onePo && links.some(l => l.shipment_id === sid && l.purchase_order_id === onePo);
    await db.insert("shipment_orders", { shipment_id: sid, sales_order_id: o.id, purchase_order_id: poAlready ? null : onePo });
    setPick(""); refresh();
  }, "Linked to the shipment");
  const newPath = `/shipping/new?order=${o.id}${onePo ? `&po=${onePo}` : ""}&back=${encodeURIComponent(base)}`;

  if (shipment) return <Section title="Shipment" action={<span className="flex items-center gap-3">
      <Link to={`${shipmentPath(shipment, "/edit")}?back=${encodeURIComponent(base)}`} className="text-xs font-medium text-indigo-600 hover:underline">Edit shipment</Link>
      {!locked && <button type="button" onClick={() => setUnlink(true)} className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-rose-600"><Unlink className="h-3.5 w-3.5" />Unlink</button>}</span>}>
    <KV items={shipmentFacts(shipment, o)} />
    <ConfirmDialog open={unlink} onClose={() => setUnlink(false)} title="Unlink this order from the shipment?" confirmLabel="Unlink"
      body="The shipment itself stays, with any other orders on it. ETD and ETA no longer count for this order's due dates."
      onConfirm={() => run(async () => { await db.remove("shipment_orders", { shipment_id: shipment.id, sales_order_id: o.id }); refresh(); }, "Unlinked")} />
  </Section>;

  return <Section title="Shipment" sub={o.order_type === "FOB" ? "ETD and ETA of the shipment set the due dates that count from them." : undefined}>
    <div className="space-y-3 px-5 py-4">
      <div className="flex items-center gap-2 text-sm text-gray-500"><Ship className="h-4 w-4 text-gray-400" />{collects ? "Not collected yet. Record the pick-up (who, when, plate, CMR) as a shipment." : "Not on a shipment yet."}</div>
      {!locked && <>
        {open.length > 0 && <div className="flex gap-2">
          <select aria-label="Existing shipment" className={cn(selectClass, "min-w-0 flex-1")} value={pick} onChange={e => setPick(e.target.value)}>
            <option value="">Add to an existing shipment…</option>
            {open.map(s => <option key={s.id} value={s.id}>{shipLabel(s)} ({SHIP_LABEL[s.status].toLowerCase()})</option>)}
          </select>
          <Button size="sm" disabled={!pick} onClick={() => link(pick)}>Link</Button>
        </div>}
        <LinkButton size="sm" variant="outline" to={newPath}><Plus />{collects ? "Record pick-up" : "New shipment for this order"}</LinkButton>
      </>}
    </div>
  </Section>;
}

/** the facts of a shipment that matter for its type */
function shipmentFacts(s: any, o: any): [string, ReactNode][] {
  const d = dateLabels(s.mode); const url = s.mode === "courier" ? trackingUrl(s.carrier, s.tracking_number) : null;
  const rows: [string, ReactNode][] = [["Status", <Pill tone={SHIP_TONE[s.status]}>{SHIP_LABEL[s.status]}</Pill>], ["Type", MODE_LABEL[s.mode] ?? "–"]];
  if (isSea(s.mode)) rows.push(
    ...(s.mode === "sea_container" ? [["Container", s.container_number || "–"]] as [string, ReactNode][] : [["Pallets", s.pallets ?? "–"]] as [string, ReactNode][]),
    ["Forwarder", s.forwarder || "–"],
    ["Route", [place(s.port_loading, s.port_loading_country), place(s.port_discharge, s.port_discharge_country)].filter(Boolean).join(" → ") || "–"],
    ["ETD / ETA", `${date(s.etd)} / ${date(s.eta)}`], ["B/L", s.bl_number || "–"]);
  else if (s.mode === "road") rows.push(["Carrier", s.carrier || "–"], ["CMR", s.cmr_number || "–"], ["Pallets", s.pallets ?? "–"], [`${d.etd} / ${d.eta.toLowerCase()}`, `${date(s.etd)} / ${date(s.eta)}`]);
  else if (s.mode === "pickup") rows.push(["Collected by", s.collected_by || "–"], ["Vehicle plate", s.vehicle_plate || "–"], ["CMR", s.cmr_number || "–"], ["Pallets", s.pallets ?? "–"], [d.etd, date(s.etd)]);
  else rows.push(["Courier", s.carrier || "–"], ["Tracking", url ? <a href={url} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 hover:underline">{s.tracking_number}</a> : s.tracking_number || "–"], [`${d.etd} / ${d.eta.toLowerCase()}`, `${date(s.etd)} / ${date(s.eta)}`]);
  rows.push([s.mode === "pickup" ? "Also collected" : "Also on it", s.pi_numbers && s.pi_numbers !== o.pi_number ? `PI ${s.pi_numbers}` : "only this order"]);
  return rows;
}

/** what the purchase side of this order costs and what is still open to the supplier(s) */
export function OrderSupplierPayments({ o, lines, locked }: { o: any; lines: any[]; locked: boolean }) {
  const all = useRows("v_purchase_orders").rows; const canPay = useCan()("pay_suppliers");
  const base = orderPath(o);
  const ids = [...new Set(lines.map(l => l.purchase_order_id).filter(Boolean))];
  const pos = all.filter(p => ids.includes(p.id));
  const withoutPo = lines.filter(l => !l.purchase_order_id && !l.own_stock && Number(l.qty) > 0);
  const part = (pid: string) => lines.filter(l => l.purchase_order_id === pid).reduce((a, l) => a + Number(l.purchase_value ?? 0), 0);
  const byCur = pos.reduce<Record<string, { payable: number; paid: number; open: number; overdue: number }>>((a, p) => {
    const t = a[p.currency] ??= { payable: 0, paid: 0, open: 0, overdue: 0 };
    t.payable += Number(p.payable); t.paid += Number(p.paid); t.open += Math.max(Number(p.outstanding), 0); t.overdue += Number(p.overdue_amount ?? 0); return a;
  }, {});
  const next = (p: any) => Number(p.outstanding) <= 0.01 ? null
    : Number(p.deposit_outstanding) > 0.01 ? { what: "Deposit", amount: p.deposit_outstanding, due: p.deposit_due_date }
    : { what: "Balance", amount: p.outstanding, due: p.balance_due_date };

  return <Section title="To pay suppliers" sub="The purchase orders behind this order. A PO shared with other orders shows its full amount; 'this order' is the part for these lines."
    action={!locked && withoutPo.length > 0 ? <Link to={`${base}/purchase-order`} className="text-xs font-medium text-amber-700 hover:underline">{withoutPo.length} line(s) without PO · create</Link> : undefined}>
    {!pos.length ? <p className="px-5 py-6 text-sm text-gray-500">{withoutPo.length ? "No purchase order yet for this order." : "No purchase lines on this order."}</p> : <>
      <div className="grid gap-3 px-5 pt-4 sm:grid-cols-3">
        {Object.entries(byCur).map(([cur, t]) => <div key={cur} className="contents">
          <Mini label={`Payable${Object.keys(byCur).length > 1 ? ` · ${cur}` : ""}`} value={money(t.payable, cur)} />
          <Mini label="Paid" value={money(t.paid, cur)} />
          <Mini label="Still to pay" value={money(t.open, cur)} tone={t.overdue > 0.01 ? "bad" : t.open > 0.01 ? "warn" : "good"} hint={t.overdue > 0.01 ? `${money(t.overdue, cur)} overdue` : t.open > 0.01 ? undefined : "all paid"} />
        </div>)}
      </div>
      <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
        {pos.map(p => { const n = next(p); const late = Number(p.overdue_amount) > 0.01;
          return <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <Link to={poPath(p)} className="font-semibold text-gray-900 hover:underline">PO {p.po_number}</Link> <span className="text-gray-500">· {p.supplier_name}</span>
              <div className="text-xs text-gray-500">{money(p.payable, p.currency)}{ids.length && p.pi_numbers && p.pi_numbers !== o.pi_number ? ` (this order ${money(part(p.id), p.currency)}; also PI ${p.pi_numbers})` : ""} · paid {money(p.paid, p.currency)}{p.invoice_number ? ` · invoice ${p.invoice_number}` : " · no supplier invoice yet"}</div>
            </div>
            <div className="text-right">
              {n ? <><div className={cn("font-semibold tabular-nums", late ? "text-rose-600" : "text-gray-900")}>{money(n.amount, p.currency)}</div>
                <div className={cn("text-xs", late ? "text-rose-600" : "text-gray-500")}>{n.what} {n.due ? `due ${date(n.due)}` : "· no due date"}{late && p.days_late ? `, ${p.days_late} days late` : ""}</div></>
                : <Pill tone="green">paid</Pill>}
            </div>
            {n && !locked && canPay && <LinkButton size="sm" variant="outline" to={`${poPath(p)}/payment?back=${encodeURIComponent(base)}`}><Wallet />Pay</LinkButton>}
          </li>; })}
      </ul>
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-gray-100 px-5 py-2.5 text-xs text-gray-500">
        <span>From the customer: received {money(o.paid, o.currency)} of {money(o.total_receivable, o.currency)}</span>
        {Object.entries(byCur).map(([cur, t]) => <span key={cur}>To suppliers: paid {money(t.paid, cur)} of {money(t.payable, cur)}</span>)}
      </div>
    </>}
  </Section>;
}

const Mini = ({ label, value, tone, hint }: { label: string; value: string; tone?: "bad" | "warn" | "good"; hint?: string }) =>
  <div className="rounded-lg bg-gray-50 px-3 py-2.5">
    <div className="text-xs text-gray-500">{label}</div>
    <div className={cn("text-lg font-semibold tabular-nums", tone === "bad" ? "text-rose-600" : tone === "warn" ? "text-amber-700" : tone === "good" ? "text-emerald-700" : "text-gray-900")}>{value}</div>
    {hint && <div className={cn("text-xs", tone === "bad" ? "text-rose-600" : "text-gray-500")}>{hint}</div>}
  </div>;

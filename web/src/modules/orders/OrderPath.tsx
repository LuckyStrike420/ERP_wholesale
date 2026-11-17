/**
 * The order's path (Salesforce "Path"): every status as a step, where the order stands, and for the next step
 * what is still needed. Click a step to move the order there; the database keeps the same rules as before
 * (e.g. completed only with an invoice and nothing outstanding). The checklist guides, it does not block.
 */
import { Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useRows } from "@/app/store";
import { Link } from "@/app/router";
import { customerPath, orderPath } from "@/app/paths";
import { money, STATUS_LABEL, STATUS_ORDER } from "@/app/format";
import { cn } from "@/lib/utils";

type Need = { label: string; ok: boolean; to?: string; action?: string };

export function OrderPath({ o, lines, shipment, customer }: { o: any; lines: any[]; shipment: any; customer: any }) {
  const { db, run } = useApp();
  const docs = useRows("generated_documents", { eq: { sales_order_id: o.id } }).rows;
  if (o.status === "cancelled") return <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-800">This order is cancelled.</div>;
  const steps = STATUS_ORDER.filter(s => s !== "draft" || o.status === "draft");
  const at = steps.indexOf(o.status);
  const next = steps[at + 1];
  const base = orderPath(o); const cur = o.currency; const tol = 0.01;
  const withoutPo = lines.filter(l => !l.purchase_order_id && Number(l.qty) > 0).length;
  const hasDoc = (t: string) => docs.some(d => d.doc_type === t);

  // what each step asks for (shown for the next step)
  const needs: Record<string, Need[]> = {
    pi_sent: [
      { label: "PI number", ok: !!o.pi_number, to: `${base}/edit`, action: "Set" },
      { label: "At least one order line", ok: lines.length > 0, to: `${base}/lines/new`, action: "Add line" },
      { label: "Customer address for the PI", ok: !!customer?.address, to: customer ? customerPath(customer, "/edit") : undefined, action: "Add" },
    ],
    po_received: [{ label: "Customer PO number", ok: !!o.customer_po, to: `${base}/edit`, action: "Add" }],
    deposit_received: [{ label: Number(o.deposit_due) > 0 ? `Deposit received (${money(o.deposit_outstanding, cur)} still open)` : "No deposit asked", ok: Number(o.deposit_outstanding) <= tol, to: `${base}/payment`, action: "Register payment" }],
    in_production: [{ label: withoutPo ? `Purchase order to the supplier (${withoutPo} line${withoutPo === 1 ? "" : "s"} without PO)` : "Purchase order to the supplier", ok: withoutPo === 0, to: `${base}/purchase-order`, action: "Create PO" }],
    ready_to_ship: [
      { label: "Shipment planned", ok: !!shipment, to: "/shipping/new", action: "Plan" },
      { label: "Packing list made", ok: hasDoc("packing_list"), to: `${base}/documents/new?type=packing_list`, action: "Make" },
    ],
    shipped: o.order_type === "FOB"
      ? [{ label: "ETD known", ok: !!shipment?.etd, to: shipment ? `/shipping` : "/shipping/new", action: "Add" }, { label: "B/L number", ok: !!shipment?.bl_number, to: "/shipping", action: "Add" }]
      : [{ label: "Paid in full before pick-up", ok: Number(o.outstanding) <= tol, to: `${base}/payment`, action: "Register payment" }],
    delivered: o.order_type === "FOB"
      ? [{ label: "ETA known", ok: !!shipment?.eta, to: "/shipping", action: "Add" }]
      : [{ label: "Delivery note made", ok: hasDoc("delivery_note"), to: `${base}/documents/new?type=delivery_note`, action: "Make" }],
    completed: [
      { label: "Invoice registered", ok: !!o.invoice_number, to: `${base}/invoice`, action: "Register" },
      { label: Number(o.outstanding) > tol ? `Paid in full (${money(o.outstanding, cur)} outstanding)` : "Paid in full", ok: Number(o.outstanding) <= tol, to: `${base}/payment`, action: "Register payment" },
    ],
  };
  const list = next ? needs[next] ?? [] : [];
  const ready = list.every(c => c.ok);
  const move = (s: string) => run(() => db.update("sales_orders", { id: o.id }, { status: s }), `Status: ${STATUS_LABEL[s]}`);

  return <section className="mb-6 overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-sm" aria-label="Order path">
    <ol className="flex overflow-x-auto">
      {steps.map((s, i) => { const done = i < at, here = i === at;
        return <li key={s} className="min-w-[8.5rem] flex-1">
          <button type="button" onClick={() => !here && move(s)} disabled={here} title={here ? "Current status" : `Move to ${STATUS_LABEL[s]}`}
            className={cn("group relative flex h-11 w-full items-center justify-center gap-1.5 px-3 text-xs font-medium transition-colors",
              here ? "bg-indigo-600 text-white" : done ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100" : "bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-800")}>
            {done && <Check className="h-3.5 w-3.5" />}{STATUS_LABEL[s]}
            {i < steps.length - 1 && <ChevronRight className={cn("absolute -right-2 z-10 h-5 w-5", here ? "text-indigo-600" : done ? "text-indigo-200" : "text-gray-200")} />}
          </button></li>; })}
    </ol>
    {next && <div className="flex flex-wrap items-start justify-between gap-4 border-t border-gray-100 px-5 py-3">
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Next: {STATUS_LABEL[next]}</div>
        <ul className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {list.map(c => <li key={c.label} className="flex items-center gap-1.5">
            <span className={cn("flex h-4 w-4 items-center justify-center rounded-full", c.ok ? "bg-emerald-500 text-white" : "border border-gray-300")}>{c.ok && <Check className="h-3 w-3" />}</span>
            <span className={c.ok ? "text-gray-500" : "text-gray-900"}>{c.label}</span>
            {!c.ok && c.to && <Link to={c.to} className="text-xs font-medium text-indigo-600 hover:underline">{c.action}</Link>}
          </li>)}
          {!list.length && <li className="text-gray-500">Nothing to check</li>}
        </ul>
      </div>
      <Button size="sm" variant={ready ? "default" : "outline"} onClick={() => move(next)}>
        {ready ? <Check className="h-3.5 w-3.5" /> : null}Mark as {STATUS_LABEL[next]}</Button>
    </div>}
    {!next && <div className="border-t border-gray-100 px-5 py-3 text-sm text-emerald-700">Completed: invoiced and paid.</div>}
  </section>;
}

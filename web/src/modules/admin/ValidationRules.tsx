/**
 * Admin → Validation rules (/admin/validation-rules): "when an order reaches <status>, <requirement> must be met".
 * The database checks them when an order moves forward. The order page shows what is still missing for the steps ahead.
 */
import { useState } from "react";
import { Plus, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useRows } from "@/app/store";
import { useNav, useParams } from "@/app/router";
import { byShort } from "@/app/paths";
import { ConfirmDialog, DataTable, FormPage, LinkButton, Loading, NotFound, Pill, Section, type Field } from "@/app/ui";
import { STATUS_LABEL, STATUS_ORDER } from "@/app/format";
import { AdminHead } from "./Admin";

export const REQUIREMENT: Record<string, string> = {
  customer_po: "a customer PO number", pi_number: "a PI number", po_date: "a PO date", payment_term: "a payment term",
  customer_address: "the customer's address", customer_vat: "the customer's VAT number", lines_have_po: "a purchase order on every line",
  cost_complete: "a cost price on every line", shipment_linked: "a linked shipment", container_number: "a container number on the shipment",
  bl_number: "a B/L number on the shipment", etd: "an ETD", eta: "an ETA", docs_complete: "shipping documents marked complete",
  deposit_paid: "the deposit received", fully_paid: "the full amount received", invoice: "a commercial invoice",
};
/** what a requirement asks, also for "doc:<slot>": a document slot of the order */
export const reqText = (req: string, slots: any[] = []) => req?.startsWith("doc:")
  ? `the document "${slots.find(x => x.code === req.slice(4))?.label ?? req.slice(4)}"` : REQUIREMENT[req];
export const ruleSentence = (r: any, slots: any[] = []) => <>An order{r.order_type ? <> of type <b>{r.order_type}</b></> : null} can only reach <b>{STATUS_LABEL[r.status] ?? "…"}</b> (or later) with <b>{reqText(r.requirement, slots) ?? "…"}</b>{r.requirement?.startsWith("doc:") && " (uploaded, made in the app or marked not needed)"}.</>;
export const rulePath = (r: { id: string }) => `/admin/validation-rules/${String(r.id).slice(0, 8)}`;

export function ValidationRules() {
  const rows = useRows("validation_rules", { order: [["created_at", "asc"]] }).rows; const slots = useRows("doc_slots").rows;
  return <><AdminHead />
    <Section title="Validation rules" sub="Checked when an order moves forward; moving back is never blocked. The order page shows what is still missing for the steps ahead."
      action={<LinkButton size="sm" to="/admin/validation-rules/new"><Plus />New rule</LinkButton>}>
      <DataTable rows={rows} rowTo={r => rulePath(r)} empty="No validation rules" cols={[
        { key: "name", header: "Rule", render: r => <div><div className="font-semibold text-gray-900">{r.name}</div><div className="mt-0.5 text-xs text-gray-600">{ruleSentence(r, slots)}</div></div> },
        { key: "message", header: "Message when blocked", wrap: true, render: r => r.message ?? <span className="text-gray-400">the rule name</span> },
        { key: "active", header: "", render: r => r.active ? <Pill tone="green">on</Pill> : <Pill>off</Pill> }]} />
    </Section></>;
}

const fieldsFor = (slots: any[]): Field[] => [
  { name: "name", label: "Name", required: true, placeholder: "e.g. FOB shipped needs a B/L number" },
  { name: "status", label: "When an order reaches", type: "select", required: true, span: 1, options: STATUS_ORDER.filter(s => !["draft", "cancelled"].includes(s)).map(s => ({ value: s, label: STATUS_LABEL[s] })) },
  { name: "order_type", label: "For", type: "select", span: 1, options: [{ value: "", label: "All orders" }, { value: "EXW", label: "EXW orders" }, { value: "FOB", label: "FOB orders" }] },
  { name: "requirement", label: "It must have", type: "select", required: true, options: [
      ...Object.entries(REQUIREMENT).map(([value, label]) => ({ value, label: label.replace(/^\w/, c => c.toUpperCase()) })),
      ...slots.filter(x => x.active).map(x => ({ value: `doc:${x.code}`, label: `Document: ${x.label}` }))],
    hint: "A document counts when it is uploaded in its slot, made in the app, or marked \"not needed\" on the order" },
  { name: "message", label: "Message when blocked", placeholder: "e.g. a FOB order cannot be Shipped without a B/L number", hint: "Empty = the name of the rule" },
  { name: "active", label: "Rule is on", type: "checkbox" },
];
export function ValidationRuleForm() {
  const { id } = useParams(); const { db, run } = useApp(); const nav = useNav();
  const { rows, loading } = useRows("validation_rules"); const [confirm, setConfirm] = useState(false); const slots = useRows("doc_slots", { order: [["sort", "asc"]] }).rows;
  const fields = fieldsFor(slots);
  const r = id ? byShort(rows, id) : undefined;
  if (loading && !rows.length) return <Loading />;
  if (id && !r) return <NotFound what="Validation rule" back={{ to: "/admin/validation-rules", label: "Validation rules" }} />;
  return <>
    <FormPage title={r ? r.name : "New validation rule"} back={{ to: "/admin/validation-rules", label: "Validation rules" }} fields={fields} done="/admin/validation-rules"
      initial={r ? { ...r, order_type: r.order_type ?? "" } : { active: true, status: "pi_sent", order_type: "" }}
      live={v => <div><div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-400"><ShieldAlert className="h-3.5 w-3.5" />This rule</div>{ruleSentence({ ...v, order_type: v.order_type || null }, slots)}</div>}
      onSubmit={async v => {
        const body = { name: v.name, status: v.status, order_type: v.order_type || null, requirement: v.requirement, message: v.message || null, active: !!v.active };
        if (r) await db.update("validation_rules", { id: r.id }, body); else await db.insert("validation_rules", body);
      }}
      aside={r && <Section title="This rule"><div className="space-y-3 px-5 py-4 text-sm text-gray-600"><p>Orders that are already past this step are not touched.</p>
        <Button variant="ghost" className="w-full text-rose-600" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />Delete rule</Button></div></Section>} />
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={`Delete "${r?.name}"?`} body="Switching it off keeps it for later." confirmLabel="Delete"
      onConfirm={() => r && run(() => db.remove("validation_rules", { id: r.id }), "Rule deleted").then(() => nav("/admin/validation-rules"))} />
  </>;
}

/** on the order page: what the rules still need for the steps ahead */
export function OrderRuleChecks({ o }: { o: any }) {
  const rows = useRows("v_order_rule_checks", { eq: { sales_order_id: o.id } }).rows.filter(r => !r.passed_already).sort((a, b) => a.status_rank - b.status_rank);
  const slots = useRows("doc_slots").rows;
  if (!rows.length || ["cancelled", "completed"].includes(o.status)) return null;
  return <section className="rounded-xl border border-amber-200 bg-amber-50/60 px-5 py-3 text-sm" aria-label="Still needed">
    <div className="mb-1 flex items-center gap-2 font-semibold text-gray-900"><ShieldAlert className="h-4 w-4 text-amber-600" />Still needed before the next steps</div>
    <ul className="space-y-0.5 text-gray-700">{rows.map(r => <li key={r.rule_id}><b>{STATUS_LABEL[r.status]}</b>: {reqText(r.requirement, slots)}<span className="text-gray-500"> ({r.name})</span></li>)}</ul>
  </section>;
}

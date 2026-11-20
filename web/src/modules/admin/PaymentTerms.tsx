/**
 * Payment terms you make yourself: /admin/payment-terms, /admin/payment-terms/new, /admin/payment-terms/1a2b3c4d
 * A term = a deposit part and a balance part, each due a number of days before or after an anchor date.
 * Customers get a term per order type; new orders copy it; due dates and "late" follow from it.
 */
import { Plus } from "lucide-react";
import { useApp, useRows } from "@/app/store";
import { useParams } from "@/app/router";
import { byShort } from "@/app/paths";
import { DataTable, FormPage, KV, LinkButton, Loading, NotFound, Pill, Section, type Field } from "@/app/ui";
import { ANCHOR_OPTIONS, discountText, pct, termText, termWhen } from "@/app/format";
import { AdminHead } from "./Admin";

export const termPath = (t: { id: string }) => `/admin/payment-terms/${String(t.id).slice(0, 8)}`;

export function PaymentTerms() {
  const terms = useRows("payment_terms", { order: [["deposit_pct", "desc"], ["name", "asc"]] }).rows;
  const ct = useRows("customer_terms").rows; const orders = useRows("v_orders").rows;
  const rows = terms.map(t => ({ ...t, customers: new Set(ct.filter(c => c.payment_term_id === t.id).map(c => c.customer_id)).size,
    open: orders.filter(o => o.payment_term_id === t.id && o.is_open && o.status !== "draft").length }));
  return <><AdminHead />
    <Section title="Payment terms" sub="Choose a term per customer and order type (Customers → Edit). New orders copy it; the due dates follow from it."
      action={<LinkButton size="sm" to="/admin/payment-terms/new"><Plus />New term</LinkButton>}>
      <DataTable rows={rows} rowTo={t => termPath(t)} empty="No payment terms yet" cols={[
        { key: "name", header: "Term", render: t => <span className="font-semibold text-gray-900">{t.name}</span> },
        { key: "rule", header: "Due", wrap: true, value: t => termText(t), render: t => <span className="text-gray-700">{termText(t)}</span> },
        { key: "customers", header: "Customers", align: "right" }, { key: "open", header: "Open orders", align: "right" },
        { key: "active", header: "", render: t => t.active ? null : <Pill>not offered</Pill> }]} />
    </Section></>;
}

const WHEN = [{ value: "after", label: "after" }, { value: "before", label: "before" }];
const fields: Field[] = [
  { name: "name", label: "Name", required: true, placeholder: "e.g. 30% deposit / 70% balance" },
  { name: "deposit_pct", label: "Deposit %", type: "percent", required: true, span: 1, hint: "100 = everything in one payment, 0 = no deposit" },
  { name: "active", label: "Offer this term for customers", type: "checkbox", span: 1 },
  { name: "deposit_days", label: "Days", type: "number", span: 1, section: "Deposit due" }, { name: "deposit_when", label: "Before / after", type: "select", options: WHEN, span: 1, section: "Deposit due" },
  { name: "deposit_anchor", label: "Counted from", type: "select", options: ANCHOR_OPTIONS, section: "Deposit due", hint: "Empty = no automatic date: set it per order" },
  { name: "balance_days", label: "Days", type: "number", span: 1, section: "Balance due" }, { name: "balance_when", label: "Before / after", type: "select", options: WHEN, span: 1, section: "Balance due" },
  { name: "balance_anchor", label: "Counted from", type: "select", options: ANCHOR_OPTIONS, section: "Balance due", hint: "Not used when the deposit is 100%. Empty = set it per order" },
  { name: "discount_pct", label: "Discount %", type: "percent", span: 1, section: "Early payment discount", hint: "e.g. 3. Empty or 0 = no discount" },
  { name: "discount_days", label: "If paid within (days)", type: "number", span: 1, section: "Early payment discount", hint: "Counted from the same date as the payment above, e.g. 14 days after the invoice date" },
  { name: "notes", label: "Note", type: "textarea", section: "Note" },
];

export function PaymentTermForm() {
  const { id } = useParams(); const { db } = useApp();
  const { rows, loading } = useRows("payment_terms");
  const t = id ? byShort(rows, id) : undefined;
  if (loading && !rows.length) return <Loading />;
  if (id && !t) return <NotFound what="Payment term" back={{ to: "/admin/payment-terms", label: "Payment terms" }} />;
  const split = (d: any) => ({ days: Math.abs(Number(d ?? 0)), when: Number(d ?? 0) < 0 ? "before" : "after" });
  const initial = t ? { ...t, deposit_days: split(t.deposit_days).days, deposit_when: split(t.deposit_days).when, balance_days: split(t.balance_days).days, balance_when: split(t.balance_days).when }
    : { active: true, deposit_pct: 0.3, deposit_days: 7, deposit_when: "after", deposit_anchor: "order_date", balance_days: 10, balance_when: "before", balance_anchor: "eta" };
  return <FormPage title={t ? `Edit ${t.name}` : "New payment term"} back={{ to: "/admin/payment-terms", label: "Payment terms" }} fields={fields} initial={initial}
    sub={t ? "A changed deposit % applies to new orders of the customers with this term; existing orders keep theirs. Changed days apply to every open order with this term." : undefined}
    aside={t && <Section title="Now"><KV items={[["Deposit", `${pct(t.deposit_pct, 0)} ${termWhen(t.deposit_anchor, t.deposit_days)}`],
      ["Balance", Number(t.deposit_pct) >= 1 ? "–" : `${pct(1 - Number(t.deposit_pct), 0)} ${termWhen(t.balance_anchor, t.balance_days)}`],
      ["Discount", Number(t.discount_pct) > 0 ? discountText(t).replace(/^ · /, "") : "–"]]} /></Section>}
    onSubmit={async v => {
      if (v.deposit_pct < 0 || v.deposit_pct > 1) throw new Error("Deposit % must be between 0 and 100");
      if (Number(v.discount_pct) > 0 && v.discount_days == null) throw new Error("Within how many days must they pay for the discount?");
      if (Number(v.discount_pct) >= 0.5) throw new Error("A discount of 50% or more is not an early payment discount");
      const signed = (d: any, w: any) => (Number(d ?? 0) || 0) * (w === "before" ? -1 : 1);
      const { deposit_when, balance_when, ...row } = v;
      const body = { ...row, discount_pct: Number(v.discount_pct) || 0, discount_days: Number(v.discount_pct) > 0 ? v.discount_days : null, deposit_days: signed(v.deposit_days, deposit_when), balance_days: signed(v.balance_days, balance_when), active: !!v.active };
      if (t) await db.update("payment_terms", { id: t.id }, body); else await db.insert("payment_terms", body);
    }} />;
}

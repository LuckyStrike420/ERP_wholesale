import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useNav, useRows } from "@/app/store";
import { DataTable, FormDialog, PageHeader, PaymentPill, Section, StatusPill, selectClass, type Field } from "@/app/ui";
import { date, money, marginPct, STATUS_LABEL, today } from "@/app/format";

export const orderFields = (customers: any[]): Field[] => [
  { name: "customer_id", label: "Customer", type: "select", required: true, options: customers.map(c => ({ value: c.id, label: c.name })) },
  { name: "order_type", label: "Type", type: "select", required: true, span: 1, options: [{ value: "EXW", label: "EXW (euro)" }, { value: "FOB", label: "FOB (dollar)" }] },
  { name: "pi_number", label: "PI#", span: 1, hint: "Leave empty to save as draft" },
  { name: "customer_po", label: "Customer PO#", span: 1 },
  { name: "po_date", label: "PO date", type: "date", span: 1 },
];

export default function Orders() {
  const { db, run } = useApp(); const nav = useNav();
  const orders = useRows("v_orders", { order: [["po_date", "desc"]] }).rows;
  const customers = useRows("customers", { order: [["name", "asc"]] }).rows;
  const [status, setStatus] = useState("open"); const [type, setType] = useState(""); const [adding, setAdding] = useState(false);
  const shown = orders.filter(o => (!type || o.order_type === type) &&
    (status === "all" || (status === "open" ? o.is_open : status === "overdue" ? Number(o.overdue_amount) > 0 || o.reminder_due : status === "unpaid" ? Number(o.outstanding) > 0.01 && o.status !== "draft" : o.status === status)));
  return <>
    <PageHeader title="Orders" sub="One order per PI. Click an order for its lines, payments and documents.">
      <Button onClick={() => setAdding(true)}><Plus className="mr-1 h-4 w-4" />New order</Button>
    </PageHeader>
    <Section title="Orders">
      <DataTable rows={shown} search exportName="orders" onRow={o => nav(`order-${o.id}`)} empty="No orders match this filter"
        toolbar={<>
          <select className={selectClass + " h-8 w-44"} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="open">Open orders</option><option value="unpaid">With open amount</option><option value="overdue">Overdue or reminder</option><option value="all">All orders</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className={selectClass + " h-8 w-28"} value={type} onChange={e => setType(e.target.value)}><option value="">EXW + FOB</option><option>EXW</option><option>FOB</option></select></>}
        cols={[
          { key: "pi_number", header: "PI#", render: o => <span className="font-semibold">{o.pi_number ?? <span className="font-normal text-muted-foreground">no PI# yet</span>}</span> },
          { key: "order_type", header: "Type" }, { key: "customer_name", header: "Customer" }, { key: "customer_po", header: "Customer PO#" },
          { key: "po_date", header: "PO date", render: o => date(o.po_date) },
          { key: "status", header: "Status", render: o => <StatusPill status={o.status} /> },
          { key: "total_receivable", header: "Order total", align: "right", render: o => money(o.total_receivable, o.currency) },
          { key: "margin_pct", header: "Margin", align: "right", render: o => <span className={Number(o.cost_missing_lines) > 0 ? "text-amber-700" : ""} title={Number(o.cost_missing_lines) > 0 ? `${o.cost_missing_lines} line(s) without cost price` : undefined}>{marginPct(o.margin_pct, o.cost_missing_lines)}</span> },
          { key: "outstanding", header: "Outstanding", align: "right", render: o => <span className={Number(o.overdue_amount) > 0 ? "font-semibold text-red-700" : ""}>{money(o.outstanding, o.currency)}</span> },
          { key: "payment_status", header: "Payment", render: o => <PaymentPill status={o.payment_status} /> },
          { key: "balance_due_date", header: "Due", render: o => Number(o.overdue_amount) > 0 ? <span className="font-semibold text-red-700">{o.days_late} days late</span>
              : o.reminder_due ? <span className="text-amber-700">reminder</span> : date(o.balance_due_date ?? o.deposit_due_date) },
        ]} />
    </Section>
    <FormDialog open={adding} onClose={() => setAdding(false)} title="New order" description="Deposit % and payment term are taken from the customer."
      fields={orderFields(customers)} initial={{ order_type: "FOB", po_date: today() }} submitLabel="Create order"
      onSubmit={async v => { const o = await run(() => db.insert("sales_orders", { ...v, status: v.pi_number ? "pi_sent" : "draft", pi_date: v.pi_number ? today() : null }), "Order created");
        if (!o) return false; nav(`order-${o.id}`); }} />
  </>;
}

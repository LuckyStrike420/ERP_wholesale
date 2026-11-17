import { Plus } from "lucide-react";
import { useRows } from "@/app/store";
import { useNav, useQuery } from "@/app/router";
import { orderPath } from "@/app/paths";
import { DataTable, LinkButton, PageHeader, PaymentPill, Section, StatusPill, selectClass } from "@/app/ui";
import { date, days, money, marginPct, STATUS_LABEL } from "@/app/format";

export default function OrdersList() {
  const nav = useNav(); const q = useQuery();
  const status = q.get("status") ?? "open"; const type = q.get("type") ?? "";
  const set = (k: string, v: string) => { const n = new URLSearchParams(q); if (v) n.set(k, v); else n.delete(k); nav(`/orders${n.toString() ? "?" + n : ""}`, { replace: true }); };
  const orders = useRows("v_orders", { order: [["po_date", "desc"]] }).rows;
  const shown = orders.filter(o => (!type || o.order_type === type) &&
    (status === "all" || (status === "open" ? o.is_open : status === "overdue" ? Number(o.overdue_amount) > 0 || o.reminder_due : status === "unpaid" ? Number(o.outstanding) > 0.01 && o.status !== "draft" : o.status === status)));
  return <>
    <PageHeader title="Orders" sub="One order per PI. Open an order for its lines, payments and history.">
      <LinkButton to="/orders/new"><Plus />New order</LinkButton>
    </PageHeader>
    <Section>
      <DataTable rows={shown} search exportName="orders" rowTo={o => orderPath(o)} empty="No orders match this filter"
        toolbar={<>
          <select aria-label="Status" className={selectClass + " h-8 w-48"} value={status} onChange={e => set("status", e.target.value === "open" ? "" : e.target.value)}>
            <option value="open">Open orders</option><option value="unpaid">With an open amount</option><option value="overdue">Overdue or reminder</option><option value="all">All orders</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select aria-label="Type" className={selectClass + " h-8 w-32"} value={type} onChange={e => set("type", e.target.value)}><option value="">EXW + FOB</option><option>EXW</option><option>FOB</option></select></>}
        cols={[
          { key: "pi_number", header: "PI#", render: o => <span className="font-semibold text-gray-900">{o.pi_number ?? <span className="font-normal text-gray-400">draft</span>}</span> },
          { key: "customer_name", header: "Customer", render: o => <div><div className="text-gray-900">{o.customer_name}</div><div className="text-xs text-gray-500">{o.order_type}{o.customer_po ? ` · PO ${o.customer_po}` : ""}</div></div> },
          { key: "po_date", header: "PO date", render: o => date(o.po_date) },
          { key: "status", header: "Status", render: o => <StatusPill status={o.status} /> },
          { key: "total_receivable", header: "Order total", align: "right", render: o => money(o.total_receivable, o.currency) },
          { key: "margin_pct", header: "Margin", align: "right", render: o => <span className={Number(o.cost_missing_lines) > 0 ? "text-amber-600" : ""} title={Number(o.cost_missing_lines) > 0 ? `${o.cost_missing_lines} line(s) without cost price` : undefined}>{marginPct(o.margin_pct, o.cost_missing_lines)}</span> },
          { key: "outstanding", header: "Outstanding", align: "right", render: o => <span className={Number(o.overdue_amount) > 0 ? "font-semibold text-rose-600" : Number(o.outstanding) > 0.01 ? "font-medium text-gray-900" : "text-gray-400"}>{money(o.outstanding, o.currency)}</span> },
          { key: "payment_status", header: "Payment", render: o => <PaymentPill status={o.payment_status} /> },
          { key: "balance_due_date", header: "Due", render: o => Number(o.overdue_amount) > 0 ? <span className="font-semibold text-rose-600">{days(o.days_late)} late</span>
              : o.reminder_due ? <span className="text-amber-600">reminder</span> : (o.balance_due_date ?? o.deposit_due_date) ? date(o.balance_due_date ?? o.deposit_due_date) : <span className="text-gray-400">no due date</span> },
        ]} />
    </Section>
  </>;
}

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNav, useRows } from "@/app/store";
import { DataTable, PageHeader, PaymentPill, Section, StatusPill, selectClass, type Col } from "@/app/ui";
import { date, money, monthName, pct, qty } from "@/app/format";

const m = (key: string, header: string): Col => ({ key, header, align: "right", render: r => money(r[key], r.currency) });

export default function Reports() {
  const nav = useNav();
  const byCustomer = useRows("v_customer_summary", { order: [["customer_name", "asc"]] }).rows;
  const bySupplier = useRows("v_supplier_summary", { order: [["supplier_name", "asc"]] }).rows;
  const monthly = useRows("v_revenue_monthly", { order: [["year", "desc"], ["month", "asc"]] }).rows;
  const products = useRows("v_product_sales", { order: [["product_name", "asc"]] }).rows;
  const orders = useRows("v_orders", { order: [["po_date", "desc"]] }).rows;
  const pos = useRows("v_purchase_orders", { order: [["po_number", "desc"]] }).rows;
  const allocs = useRows("v_allocations", { order: [["payment_date", "desc"]] }).rows;
  const cash = useRows("v_cash_flow", { order: [["due_date", "asc"]] }).rows;
  const years = [...new Set(monthly.map(r => r.year))].sort((a, b) => b - a);
  const [year, setYear] = useState<string>(""); const [cur, setCur] = useState("");
  const y = year ? Number(year) : years[0];
  const pick = <T extends Record<string, any>>(rows: T[]) => rows.filter(r => !cur || r.currency === cur);
  const curSel = <select className={selectClass + " h-8 w-32"} value={cur} onChange={e => setCur(e.target.value)}><option value="">EUR and USD</option><option value="EUR">EUR (EXW)</option><option value="USD">USD (FOB)</option></select>;
  const yearSel = <select className={selectClass + " h-8 w-24"} value={y ?? ""} onChange={e => setYear(e.target.value)}>{years.map(v => <option key={v} value={v}>{v}</option>)}</select>;
  const live = orders.filter(o => !["draft", "cancelled"].includes(o.status));
  const overdue = [
    ...live.filter(o => Number(o.overdue_amount) > 0).map(o => ({ id: "o" + o.id, side: "Customer", party: o.customer_name, ref: "PI " + o.pi_number, currency: o.currency, amount: o.overdue_amount, days: o.days_late, go: `order-${o.id}` })),
    ...pos.filter(p => Number(p.overdue_amount) > 0).map(p => ({ id: "p" + p.id, side: "Supplier", party: p.supplier_name, ref: "PO " + p.po_number, currency: p.currency, amount: p.overdue_amount, days: p.days_late, go: `po-${p.id}` })),
  ];
  return <>
    <PageHeader title="Reports" sub="Every table can be searched, sorted and exported. EUR and USD are never added together." />
    <Tabs defaultValue="customers">
      <TabsList className="mb-4 h-auto flex-wrap justify-start">
        <TabsTrigger value="customers">By customer</TabsTrigger><TabsTrigger value="suppliers">By supplier</TabsTrigger><TabsTrigger value="monthly">Monthly</TabsTrigger>
        <TabsTrigger value="products">Products</TabsTrigger><TabsTrigger value="receivable">Outstanding customers</TabsTrigger><TabsTrigger value="payable">Outstanding suppliers</TabsTrigger>
        <TabsTrigger value="overdue">Overdue</TabsTrigger><TabsTrigger value="payments">Payment history</TabsTrigger><TabsTrigger value="cash">Cash-flow forecast</TabsTrigger>
      </TabsList>
      <TabsContent value="customers"><Section title="Orders by customer, all years">
        <DataTable rows={pick(byCustomer).map(r => ({ ...r, id: r.customer_id + r.currency }))} search exportName="orders-by-customer" toolbar={curSel}
          cols={[{ key: "customer_name", header: "Customer" }, { key: "currency", header: "Cur" }, { key: "order_count", header: "Orders", align: "right", value: r => r.orders ?? r.order_count, render: r => qty(r.orders ?? r.order_count) },
            { key: "open_orders", header: "Open", align: "right" }, m("order_value", "Order value"), m("margin", "Margin"), m("paid", "Paid"), m("outstanding", "Outstanding"), m("overdue", "Overdue")]} />
      </Section></TabsContent>
      <TabsContent value="suppliers"><Section title="Purchase orders by supplier, all years">
        <DataTable rows={pick(bySupplier).map(r => ({ ...r, id: r.supplier_id + r.currency }))} search exportName="orders-by-supplier" toolbar={curSel}
          cols={[{ key: "supplier_name", header: "Supplier" }, { key: "currency", header: "Cur" }, { key: "purchase_orders", header: "POs", align: "right" },
            m("payable", "Payable"), m("paid", "Paid"), m("outstanding", "Outstanding"), m("overdue", "Overdue")]} />
      </Section></TabsContent>
      <TabsContent value="monthly"><Section title={`Monthly order value ${y ?? ""}, by PO date`}>
        <DataTable rows={pick(monthly).filter(r => r.year === y).map(r => ({ ...r, id: `${r.year}-${r.month}-${r.order_type}` }))} exportName={`monthly-${y}`} toolbar={<>{yearSel}{curSel}</>}
          cols={[{ key: "month", header: "Month", render: r => monthName(r.month) }, { key: "order_type", header: "Type" }, { key: "units", header: "Units", align: "right", render: r => qty(r.units) },
            m("revenue", "Revenue"), m("margin", "Margin"), { key: "margin_pct", header: "Margin %", align: "right", value: r => (Number(r.revenue) ? Number(r.margin) / Number(r.revenue) : null), render: r => (Number(r.revenue) ? pct(Number(r.margin) / Number(r.revenue)) : "–") },
            { key: "revenue_reporting", header: "Revenue in EUR", align: "right", render: r => (r.fx_rate_missing ? <span className="text-amber-700">no rate</span> : money(r.revenue_reporting, "EUR")) }]} />
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">"Revenue in EUR" uses the exchange rate on the PO date. Rates are entered under Admin → Exchange rates.</p>
      </Section></TabsContent>
      <TabsContent value="products"><Section title={`Product sales ${y ?? ""}`}>
        <DataTable rows={pick(products).filter(r => r.year === y).map(r => ({ ...r, id: r.product_id + r.order_type }))} search exportName={`product-sales-${y}`} toolbar={<>{yearSel}{curSel}</>}
          cols={[{ key: "product_name", header: "Product" }, { key: "order_type", header: "Type" }, { key: "units", header: "Units", align: "right", render: r => qty(r.units) }, m("revenue", "Revenue"), m("margin", "Margin")]} />
      </Section></TabsContent>
      <TabsContent value="receivable"><Section title="Outstanding at customers">
        <DataTable rows={pick(live).filter(o => Number(o.outstanding) > 0.01)} search exportName="outstanding-customers" toolbar={curSel} onRow={o => nav(`order-${o.id}`)}
          cols={[{ key: "pi_number", header: "PI#" }, { key: "customer_name", header: "Customer" }, { key: "status", header: "Status", render: o => <StatusPill status={o.status} /> },
            { key: "payment_status", header: "Payment", render: o => <PaymentPill status={o.payment_status} /> }, m("total_receivable", "Total"), m("paid", "Paid"), m("outstanding", "Outstanding"),
            { key: "balance_due_date", header: "Balance due", render: o => date(o.balance_due_date) }, { key: "days_late", header: "Days late", align: "right", render: o => o.days_late ?? "–" }]} />
      </Section></TabsContent>
      <TabsContent value="payable"><Section title="Outstanding at suppliers">
        <DataTable rows={pick(pos).filter(p => Number(p.outstanding) > 0.01)} search exportName="outstanding-suppliers" toolbar={curSel} onRow={p => nav(`po-${p.id}`)}
          cols={[{ key: "po_number", header: "PO#" }, { key: "supplier_name", header: "Supplier" }, { key: "pi_numbers", header: "For PI" }, m("payable", "Payable"), m("paid", "Paid"), m("outstanding", "Outstanding"),
            { key: "deposit_due_date", header: "Deposit due", render: p => date(p.deposit_due_date) }, { key: "balance_due_date", header: "Balance due", render: p => date(p.balance_due_date) }, { key: "days_late", header: "Days late", align: "right", render: p => p.days_late ?? "–" }]} />
      </Section></TabsContent>
      <TabsContent value="overdue"><Section title="Overdue, customers and suppliers">
        <DataTable rows={pick(overdue)} search exportName="overdue" toolbar={curSel} onRow={r => nav(r.go)} empty="Nothing is overdue"
          cols={[{ key: "side", header: "Side" }, { key: "party", header: "Party" }, { key: "ref", header: "Reference" }, m("amount", "Overdue"), { key: "days", header: "Days late", align: "right" }]} />
      </Section></TabsContent>
      <TabsContent value="payments"><Section title="Payment history">
        <DataTable rows={pick(allocs)} search exportName="payment-history" toolbar={curSel} empty="No payments registered yet" onRow={a => nav(a.sales_order_id ? `order-${a.sales_order_id}` : `po-${a.purchase_order_id}`)}
          cols={[{ key: "payment_date", header: "Date", render: a => date(a.payment_date) }, { key: "direction", header: "Direction", render: a => (a.direction === "in" ? "Received" : "Paid") },
            { key: "party_name", header: "Party" }, { key: "for", header: "For", value: a => (a.pi_number ? "PI " + a.pi_number : "PO " + a.po_number), render: a => (a.pi_number ? "PI " + a.pi_number : "PO " + a.po_number) },
            { key: "reference", header: "Reference" }, m("amount", "Amount"), { key: "voided_at", header: "", render: a => (a.voided_at ? "voided" : "") }]} />
      </Section></TabsContent>
      <TabsContent value="cash"><Section title="Expected money in and out, by due date">
        <DataTable rows={pick(cash).map((r, i) => ({ ...r, id: i }))} search exportName="cash-flow-forecast" toolbar={curSel} onRow={r => nav(r.direction === "in" ? `order-${r.order_id}` : `po-${r.order_id}`)}
          cols={[{ key: "due_date", header: "Due", render: r => (r.due_date ? date(r.due_date) : <span className="text-amber-700">no due date</span>) }, { key: "direction", header: "Direction", render: r => (r.direction === "in" ? "In" : "Out") },
            { key: "party", header: "Party" }, { key: "reference", header: "PI / PO" }, { key: "part", header: "Part" }, m("amount", "Amount")]} />
      </Section></TabsContent>
    </Tabs>
  </>;
}

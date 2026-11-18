/**
 * Reports: /reports (by customer), /reports/suppliers, /reports/monthly, /reports/products, /reports/cash-flow, /reports/custom (your own).
 * What is open and late lives under Payments.
 */
import { useNav, useQuery, usePath } from "@/app/router";
import { useRows } from "@/app/store";
import { orderPath, poPath } from "@/app/paths";
import { DataTable, PageHeader, Section, TabLinks, selectClass, type Col } from "@/app/ui";
import { date, money, marginPct, monthName, qty } from "@/app/format";
import { CustomReports } from "./Custom";

const m = (key: string, header: string): Col => ({ key, header, align: "right", render: r => money(r[key], r.currency) });

export default function Reports({ tab }: { tab: "customers" | "suppliers" | "monthly" | "products" | "cash-flow" | "custom" }) {
  const nav = useNav(); const q = useQuery(); const path = usePath();
  const cur = q.get("currency") ?? ""; const yearQ = q.get("year");
  const set = (k: string, v: string) => { const n = new URLSearchParams(q); if (v) n.set(k, v); else n.delete(k); nav(`${path}${n.toString() ? "?" + n : ""}`, { replace: true }); };
  const monthly = useRows("v_revenue_monthly", { order: [["year", "desc"], ["month", "asc"]] }).rows;
  const years = [...new Set(monthly.map(r => r.year))].sort((a, b) => b - a);
  const y = yearQ ? Number(yearQ) : years[0];
  const pick = <T extends Record<string, any>>(rows: T[]) => rows.filter(r => !cur || r.currency === cur);
  const curSel = <select aria-label="Currency" className={selectClass + " h-8 w-32"} value={cur} onChange={e => set("currency", e.target.value)}><option value="">EUR and USD</option><option value="EUR">EUR (EXW)</option><option value="USD">USD (FOB)</option></select>;
  const yearSel = <select aria-label="Year" className={selectClass + " h-8 w-24"} value={y ?? ""} onChange={e => set("year", e.target.value)}>{years.map(v => <option key={v} value={v}>{v}</option>)}</select>;
  const head = <>
    <PageHeader title="Reports" sub="Every table can be searched, sorted and exported. EUR and USD are never added together." />
    <TabLinks tabs={[{ to: "/reports", label: "By customer" }, { to: "/reports/suppliers", label: "By supplier" }, { to: "/reports/monthly", label: "Monthly" },
      { to: "/reports/products", label: "Products" }, { to: "/reports/cash-flow", label: "Cash-flow forecast" }, { to: "/reports/custom", label: "Your reports" }]} /></>;
  if (tab === "custom") return <CustomReports head={head} />;
  return <>{head}
    {tab === "customers" && <ByCustomer pick={pick} curSel={curSel} />}
    {tab === "suppliers" && <BySupplier pick={pick} curSel={curSel} />}
    {tab === "monthly" && <Section title={`Order value ${y ?? ""} per month, by PO date`}>
      <DataTable rows={pick(monthly).filter(r => r.year === y).map(r => ({ ...r, id: `${r.year}-${r.month}-${r.order_type}` }))} exportName={`monthly-${y}`} toolbar={<>{yearSel}{curSel}</>}
        cols={[{ key: "month", header: "Month", render: r => monthName(r.month) }, { key: "order_type", header: "Type" }, { key: "units", header: "Units", align: "right", render: r => qty(r.units) },
          m("revenue", "Revenue"), m("margin", "Margin"), { key: "margin_pct", header: "Margin %", align: "right", value: r => r.margin_pct, render: r => <span className={Number(r.cost_missing_lines) > 0 ? "text-amber-600" : ""}>{marginPct(r.margin_pct, r.cost_missing_lines)}</span> },
          { key: "revenue_reporting", header: "Revenue in EUR", align: "right", render: r => (r.fx_rate_missing ? <span className="text-amber-600">no rate</span> : money(r.revenue_reporting, "EUR")) }]} />
      <p className="border-t border-gray-100 px-5 py-2.5 text-xs text-gray-500">"Revenue in EUR" uses the exchange rate on the PO date. Rates are entered under Admin → Exchange rates.</p>
    </Section>}
    {tab === "products" && <Products pick={pick} y={y} toolbar={<>{yearSel}{curSel}</>} />}
    {tab === "cash-flow" && <CashFlow pick={pick} curSel={curSel} />}
  </>;
}

function ByCustomer({ pick, curSel }: any) {
  const rows = useRows("v_customer_summary", { order: [["customer_name", "asc"]] }).rows;
  return <Section title="Orders by customer, all years">
    <DataTable rows={pick(rows).map((r: any) => ({ ...r, id: r.customer_id + r.currency }))} search exportName="orders-by-customer" toolbar={curSel}
      cols={[{ key: "customer_name", header: "Customer" }, { key: "currency", header: "Cur" }, { key: "order_count", header: "Orders", align: "right", value: r => r.orders ?? r.order_count, render: r => qty(r.orders ?? r.order_count) },
        { key: "open_orders", header: "Open", align: "right" }, m("order_value", "Order value"), m("margin", "Margin"), m("paid", "Paid"), m("outstanding", "Outstanding"), m("overdue", "Overdue")]} />
  </Section>;
}
function BySupplier({ pick, curSel }: any) {
  const rows = useRows("v_supplier_summary", { order: [["supplier_name", "asc"]] }).rows;
  return <Section title="Purchase orders by supplier, all years">
    <DataTable rows={pick(rows).map((r: any) => ({ ...r, id: r.supplier_id + r.currency }))} search exportName="orders-by-supplier" toolbar={curSel}
      cols={[{ key: "supplier_name", header: "Supplier" }, { key: "currency", header: "Cur" }, { key: "purchase_orders", header: "POs", align: "right" },
        m("payable", "Payable"), m("paid", "Paid"), m("outstanding", "Outstanding"), m("overdue", "Overdue")]} />
  </Section>;
}
function Products({ pick, y, toolbar }: any) {
  const rows = useRows("v_product_sales", { order: [["product_name", "asc"]] }).rows;
  return <Section title={`Product sales ${y ?? ""}`}>
    <DataTable rows={pick(rows).filter((r: any) => r.year === y).map((r: any) => ({ ...r, id: r.product_id + r.order_type }))} search exportName={`product-sales-${y}`} toolbar={toolbar}
      cols={[{ key: "product_name", header: "Product" }, { key: "order_type", header: "Type" }, { key: "units", header: "Units", align: "right", render: r => qty(r.units) }, m("revenue", "Revenue"), m("margin", "Margin")]} />
  </Section>;
}
function CashFlow({ pick, curSel }: any) {
  const cash = useRows("v_cash_flow", { order: [["due_date", "asc"]] }).rows;
  return <Section title="Expected money in and out, by due date">
    <DataTable rows={pick(cash).map((r: any, i: number) => ({ ...r, id: i }))} search exportName="cash-flow-forecast" toolbar={curSel}
      rowTo={r => r.direction === "in" ? orderPath({ pi_number: r.reference, id: r.order_id }) : poPath({ po_number: r.reference })}
      cols={[{ key: "due_date", header: "Due", render: r => (r.due_date ? date(r.due_date) : <span className="text-amber-600">no due date</span>) }, { key: "direction", header: "Direction", render: r => (r.direction === "in" ? "In" : "Out") },
        { key: "party", header: "Party" }, { key: "reference", header: "PI / PO" }, { key: "part", header: "Part" }, m("amount", "Amount")]} />
  </Section>;
}

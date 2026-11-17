/** Every order form is a page of its own: /orders/new, /orders/26179/edit, /orders/26179/payment … */
import { useEffect, useState } from "react";
import { useApp, useRows } from "@/app/store";
import { useParams } from "@/app/router";
import { orderPath } from "@/app/paths";
import { FormPage, KV, Loading, NotFound, PageHeader, Pill, Section, type Field } from "@/app/ui";
import { date, money, SOURCE_LABEL, today } from "@/app/format";
import { useOrder } from "./data";

const TYPE_OPTIONS = [{ value: "EXW", label: "EXW (euro)" }, { value: "FOB", label: "FOB (dollar)" }];
export const orderFields = (customers: any[]): Field[] => [
  { name: "customer_id", label: "Customer", type: "select", required: true, options: customers.map(c => ({ value: c.id, label: c.name })) },
  { name: "order_type", label: "Type", type: "select", required: true, span: 1, options: TYPE_OPTIONS },
  { name: "pi_number", label: "PI#", span: 1, hint: "Leave empty to save as a draft" },
  { name: "customer_po", label: "Customer PO#", span: 1 },
  { name: "po_date", label: "PO date", type: "date", span: 1 },
];

/** short summary of the order next to every order form */
function OrderAside({ o }: { o: any }) {
  return <Section title={o.pi_number ? `PI ${o.pi_number}` : "Draft order"} sub={o.customer_name}>
    <KV items={[["Total", money(o.total_receivable, o.currency)], ["Received", money(o.paid, o.currency)],
      ["Outstanding", <b className={Number(o.overdue_amount) > 0 ? "text-rose-600" : ""}>{money(o.outstanding, o.currency)}</b>],
      ...(Number(o.deposit_outstanding) > 0.01 ? [["of which deposit", money(o.deposit_outstanding, o.currency)] as [any, any]] : [])]} />
  </Section>;
}

/** loads the order of the URL and hands it to the form, or shows loading / not found */
function WithOrder({ children }: { children: (o: any) => React.ReactNode }) {
  const { ref } = useParams(); const { o, loading } = useOrder(ref);
  if (!o) return loading ? <Loading what="Loading order…" /> : <NotFound what={`Order ${ref}`} back={{ to: "/orders", label: "All orders" }} />;
  return <>{children(o)}</>;
}
const backTo = (o: any) => ({ to: orderPath(o), label: o.pi_number ? `PI ${o.pi_number}` : "Draft order" });

export function OrderNew() {
  const { db } = useApp();
  const customers = useRows("customers", { order: [["name", "asc"]] }).rows;
  if (!customers.length) return <Loading />;
  return <FormPage title="New order" sub="Deposit % and payment term are taken from the customer." back={{ to: "/orders", label: "Orders" }}
    fields={orderFields(customers)} initial={{ order_type: "FOB", po_date: today() }} submitLabel="Create order"
    onSubmit={async v => { const o = await db.insert("sales_orders", { ...v, status: v.pi_number ? "pi_sent" : "draft", pi_date: v.pi_number ? today() : null });
      return orderPath(o as any, "/lines/new"); }} />;
}

export function OrderEdit() {
  const { db } = useApp();
  const customers = useRows("customers", { order: [["name", "asc"]] }).rows;
  return <WithOrder>{o => <OrderEditForm o={o} customers={customers} db={db} />}</WithOrder>;
}
function OrderEditForm({ o, customers, db }: { o: any; customers: any[]; db: any }) {
  const raw = useRows("sales_orders", { eq: { id: o.id } }).rows[0];
  if (!raw || !customers.length) return <Loading />;
  const locked = ["completed", "cancelled"].includes(o.status);
  const fields: Field[] = [...orderFields(customers).filter(f => !locked || f.name === "customer_po").map(f => ({ ...f, section: "Order" })),
    ...(locked ? [] : [{ name: "pi_date", label: "PI sent on", type: "date", span: 1 },
      { name: "deposit_pct", label: "Deposit %", type: "percent", span: 1, section: "Payment terms" }, { name: "payment_days", label: "Payment term (days after invoice)", type: "number", span: 1, section: "Payment terms" },
      { name: "deposit_due_date", label: "Deposit due date", type: "date", span: 1, section: "Payment terms" },
      { name: "balance_due_date", label: "Balance due date", type: "date", span: 1, section: "Payment terms", hint: "Empty = the rule for the order type (FOB: before ETA, EXW: invoice date + term)" }] as Field[]),
    { name: "notes", label: "Note", type: "textarea", section: "Note" }];
  return <FormPage title={`Edit ${o.pi_number ? `PI ${o.pi_number}` : "draft order"}`} back={backTo(o)} fields={fields} initial={raw} aside={<OrderAside o={o} />}
    onSubmit={async v => { const patch = { ...v }; if (raw.status === "draft" && v.pi_number) patch.status = "pi_sent";
      await db.update("sales_orders", { id: o.id }, patch); return orderPath({ ...o, pi_number: v.pi_number ?? o.pi_number }); }} />;
}

export function OrderLine() {
  const { line } = useParams();
  return <WithOrder>{o => <LineForm o={o} lineNo={line === "new" ? null : Number(line)} />}</WithOrder>;
}
function LineForm({ o, lineNo }: { o: any; lineNo: number | null }) {
  const { db } = useApp();
  const lines = useRows("sales_order_lines", { eq: { sales_order_id: o.id } });
  const products = useRows("products", { order: [["name", "asc"]] }).rows;
  const pos = useRows("v_purchase_orders", { order: [["po_number", "desc"]] }).rows;
  const stock = useRows("v_batch_item_stock").rows;
  if (lines.loading || !products.length) return <Loading />;
  const row = lineNo == null ? null : lines.rows.find(l => l.line_no === lineNo);
  if (lineNo != null && !row) return <NotFound what={`Line ${lineNo}`} back={backTo(o)} />;
  const cur = o.currency;
  const fields: Field[] = [
    { name: "product_id", label: "Product", type: "select", required: true, options: products.map(p => ({ value: p.id, label: p.name })) },
    { name: "quantity", label: "Quantity", type: "number", required: true, span: 1 },
    { name: "unit_price", label: `Sale price per piece (${cur})`, type: "number", required: true, span: 1 },
    { name: "purchase_order_id", label: "Our PO to the supplier", type: "select", span: 1, section: "Purchasing", options: pos.filter(p => p.order_type === o.order_type).map(p => ({ value: p.id, label: `${p.po_number} · ${p.supplier_name}` })) },
    { name: "batch_item_id", label: "From NL stock (batch)", type: "select", span: 1, section: "Purchasing", options: stock.map(s => ({ value: s.batch_item_id, label: `${s.batch_number} · ${s.product_name} (${s.stock} in stock)` })) },
    { name: "cost_override", label: `Purchase price override (${cur})`, type: "number", span: 1, section: "Purchasing", hint: "Only for a one-off exception" },
    { name: "line_date", label: "Line date", type: "date", span: 1, section: "Purchasing", hint: "Only if different from the PO date" },
    ...(row ? [{ name: "quantity_cancelled", label: "Quantity cancelled", type: "number", span: 1, section: "Purchasing" } as Field] : []),
    { name: "notes", label: "Note", type: "textarea", section: "Note" },
  ];
  const save = async (v: any) => {
    const body = { ...v, quantity_cancelled: v.quantity_cancelled ?? 0 };
    if (row) await db.update("sales_order_lines", { id: row.id }, body);
    else await db.insert("sales_order_lines", { ...body, sales_order_id: o.id, line_no: Math.max(0, ...lines.rows.map(l => l.line_no)) + 1 });
  };
  return <FormPage title={row ? `Line ${row.line_no}` : "Add line"} sub="The purchase price is calculated: override, then batch, then price agreement, then product rule."
    back={backTo(o)} fields={fields} initial={row ?? {}} aside={<OrderAside o={o} />} submitLabel={row ? "Save line" : "Add line"}
    onSubmit={async v => {
      const c = (await db.rpc("calc_unit_cost", { p_product: v.product_id, p_customer: o.customer_id, p_order_type: o.order_type, p_unit_price: v.unit_price,
        p_batch_item: v.batch_item_id, p_override: v.cost_override, p_date: v.line_date ?? o.po_date }))[0];
      if (c?.cost_basis != null && Number(v.unit_price) < Number(c.cost_basis))
        return { confirm: { title: "Selling below the cost basis", danger: true, label: "Save anyway",
          body: <>The sale price <b>{money(v.unit_price, cur)}</b> is below the cost basis <b>{money(c.cost_basis, cur)}</b> for this product. This line would be sold at a loss.</>,
          go: async () => { await save(v); } } };
      await save(v);
    }} />;
}

/** /orders/:ref/lines/:line/cost: why the line has this purchase price */
export function LineCost() {
  const { line } = useParams();
  return <WithOrder>{o => <LineCostView o={o} lineNo={Number(line)} />}</WithOrder>;
}
function LineCostView({ o, lineNo }: { o: any; lineNo: number }) {
  const { db } = useApp();
  const l = useRows("v_order_lines", { eq: { sales_order_id: o.id, line_no: lineNo } }).rows[0];
  const products = useRows("products").rows;
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { if (l) db.rpc<any[]>("explain_unit_cost", { p_product: l.product_id, p_customer: o.customer_id, p_order_type: o.order_type, p_unit_price: l.unit_price,
    p_batch_item: l.batch_item_id, p_override: l.cost_override, p_date: l.line_date ?? o.po_date }).then(setRows); }, [l?.id]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!l || !rows) return <Loading />;
  return <>
    <PageHeader back={backTo(o)} title={`Why this purchase price?`} sub={`Line ${l.line_no} · ${products.find(p => p.id === l.product_id)?.name ?? ""} · ${money(l.unit_cost, o.currency, 3)} per piece`} />
    <div className="max-w-2xl space-y-3">
      <p className="text-sm text-gray-600">Order of priority: override, batch, price agreement, product rule. The first that applies wins.{l.cost_is_final ? " This price is final; the explanation below follows today's rules." : ""}</p>
      {rows.map(r => <div key={r.step} className={"rounded-xl border bg-white px-5 py-4 shadow-sm " + (r.applies ? "border-indigo-300 ring-1 ring-indigo-200" : "border-gray-200")}>
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{r.step === 5 ? "Result" : SOURCE_LABEL[r.source] ?? r.source}{r.applies && r.step !== 5 && <Pill tone="blue">used</Pill>}</div>
        <div className="text-sm text-gray-800">{r.detail}</div></div>)}
    </div>
  </>;
}

export function OrderPayment() {
  const { db } = useApp();
  return <WithOrder>{o => <FormPage title="Register payment" back={backTo(o)} submitLabel="Register payment" aside={<OrderAside o={o} />}
    sub={`Outstanding ${money(o.outstanding, o.currency)}${Number(o.deposit_outstanding) > 0.01 ? `, of which deposit ${money(o.deposit_outstanding, o.currency)}` : ""}. Anything paid above the open amount is kept as customer credit.`}
    initial={{ p_date: today(), p_amount: Number(o.deposit_outstanding) > 0.01 ? o.deposit_outstanding : Math.max(Number(o.outstanding), 0) }}
    fields={[{ name: "p_date", label: "Date received", type: "date", required: true, span: 1 }, { name: "p_amount", label: `Amount (${o.currency})`, type: "number", required: true, span: 1 },
      { name: "p_reference", label: "Bank reference" }, { name: "p_notes", label: "Note", type: "textarea" }]}
    onSubmit={async v => { await db.rpc("register_customer_payment", { p_order: o.id, ...v }); }} />}</WithOrder>;
}

export function OrderInvoice() {
  const { db } = useApp();
  return <WithOrder>{o => <FormPage title="Register invoice" back={backTo(o)} aside={<OrderAside o={o} />} initial={{ invoice_date: today() }}
    fields={[{ name: "invoice_number", label: "Invoice # (CI#)", required: true, span: 1 }, { name: "invoice_date", label: "Invoice date", type: "date", required: true, span: 1 }]}
    onSubmit={async v => { await db.insert("invoices", { ...v, sales_order_id: o.id }); }} />}</WithOrder>;
}

export function OrderCorrection() {
  const { db } = useApp();
  return <WithOrder>{o => <FormPage title="Correction on the order total" sub="A plus or minus amount on top of the order lines, for example a discount." back={backTo(o)} aside={<OrderAside o={o} />}
    fields={[{ name: "amount", label: `Amount (${o.currency}), minus for a discount`, type: "number", required: true }, { name: "reason", label: "Reason", required: true }]}
    onSubmit={async v => { await db.insert("order_adjustments", { ...v, sales_order_id: o.id }); }} />}</WithOrder>;
}

export function OrderWriteOff() {
  const { db } = useApp();
  return <WithOrder>{o => <FormPage title="Write off a difference" sub="For bank charges or small differences. Never automatic: every write-off needs a reason." back={backTo(o)} aside={<OrderAside o={o} />}
    initial={{ write_off_date: today() }}
    fields={[{ name: "amount", label: `Amount (${o.currency})`, type: "number", required: true, span: 1, hint: `Outstanding now: ${money(o.outstanding, o.currency)}` },
      { name: "write_off_date", label: "Date", type: "date", required: true, span: 1 }, { name: "reason", label: "Reason", required: true }]}
    onSubmit={async v => {
      if (Number(v.amount) > Number(o.outstanding)) return { confirm: { title: "More than the open amount", danger: true, label: "Write off anyway",
        body: <>You write off <b>{money(v.amount, o.currency)}</b> while only <b>{money(o.outstanding, o.currency)}</b> is open ({date(today())}).</>,
        go: async () => { await db.insert("write_offs", { ...v, sales_order_id: o.id }); } } };
      await db.insert("write_offs", { ...v, sales_order_id: o.id });
    }} />}</WithOrder>;
}

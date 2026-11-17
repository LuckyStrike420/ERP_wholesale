/**
 * Purchasing module: /purchasing, /purchasing/new, /purchasing/2774, /purchasing/2774/edit|payment|invoice|write-off
 */
import { FileText, Pencil, Plus, Receipt } from "lucide-react";
import { useApp, useRows } from "@/app/store";
import { Link, useParams } from "@/app/router";
import { orderPath, poPath, supplierPath } from "@/app/paths";
import { DataTable, FormPage, KV, LinkButton, Loading, NotFound, PageHeader, Pill, Section, Stat, type Field } from "@/app/ui";
import { date, money, pct, qty, today } from "@/app/format";
import { TasksSection, newTaskPath } from "@/modules/tasks/Tasks";
import { DocumentsSection } from "@/modules/documents/Documents";
import { FavoriteStar, useRecord } from "@/app/Favorites";

function usePO() {
  const { po } = useParams();
  const { rows, loading } = useRows("v_purchase_orders", { eq: { po_number: po } });
  return { p: rows[0], loading, no: po };
}
function WithPO({ children }: { children: (p: any) => React.ReactNode }) {
  const { p, loading, no } = usePO();
  if (!p) return loading ? <Loading what="Loading PO…" /> : <NotFound what={`PO ${no}`} back={{ to: "/purchasing", label: "All purchase orders" }} />;
  return <>{children(p)}</>;
}
const backTo = (p: any) => ({ to: poPath(p), label: `PO ${p.po_number}` });
const POAside = ({ p }: { p: any }) => <Section title={`PO ${p.po_number}`} sub={p.supplier_name}>
  <KV items={[["To pay", money(p.payable, p.currency)], ["Paid", money(p.paid, p.currency)], ["Outstanding", <b>{money(p.outstanding, p.currency)}</b>],
    ...(Number(p.deposit_outstanding) > 0.01 ? [["of which deposit", money(p.deposit_outstanding, p.currency)] as [any, any]] : [])]} /></Section>;

export function PurchaseOrders() {
  const pos = useRows("v_purchase_orders", { order: [["po_number", "desc"]] }).rows;
  return <>
    <PageHeader title="Purchase orders" sub="One row per own PO to a supplier. The expected amount comes from the order lines linked to the PO.">
      <LinkButton to="/purchasing/new"><Plus />New PO</LinkButton></PageHeader>
    <Section>
      <DataTable rows={pos} search exportName="purchase-orders" rowTo={p => poPath(p)} cols={[
        { key: "po_number", header: "PO#", render: p => <span className="font-semibold text-gray-900">{p.po_number}</span> },
        { key: "supplier_name", header: "Supplier", render: p => <div><div className="text-gray-900">{p.supplier_name}</div><div className="text-xs text-gray-500">{p.order_type}{p.pi_numbers ? ` · for PI ${p.pi_numbers}` : ""}</div></div> },
        { key: "po_date", header: "PO date", render: p => p.po_date ? date(p.po_date) : <span className="text-gray-400">not set</span> },
        { key: "expected_amount", header: "Expected", align: "right", render: p => money(p.expected_amount, p.currency) },
        { key: "invoice_amount", header: "Invoiced", align: "right", render: p => p.invoice_amount == null ? <span className="text-gray-400">no invoice</span> : money(p.invoice_amount, p.currency) },
        { key: "invoice_difference", header: "Difference", align: "right", render: p => Math.abs(Number(p.invoice_difference ?? 0)) > 0.01 ? <span className="font-semibold text-amber-600">{money(p.invoice_difference, p.currency)}</span> : "–" },
        { key: "paid", header: "Paid", align: "right", render: p => money(p.paid, p.currency) },
        { key: "outstanding", header: "Outstanding", align: "right", render: p => <span className={Number(p.overdue_amount) > 0 ? "font-semibold text-rose-600" : "font-medium text-gray-900"}>{money(p.outstanding, p.currency)}</span> },
        { key: "fully_paid", header: "", render: p => p.fully_paid && Number(p.payable) > 0 ? <Pill tone="green">Paid</Pill> : Number(p.overdue_amount) > 0 ? <Pill tone="red">{p.days_late} days late</Pill> : null },
      ]} />
    </Section>
  </>;
}

export function PurchaseOrderNew() {
  const { db } = useApp();
  const suppliers = useRows("suppliers", { order: [["name", "asc"]] }).rows;
  if (!suppliers.length) return <Loading />;
  return <FormPage title="New purchase order" sub="Currency and deposit % are taken from the supplier's terms for this type." submitLabel="Create PO" back={{ to: "/purchasing", label: "Purchase orders" }}
    initial={{ order_type: "FOB", po_date: today() }}
    fields={[{ name: "po_number", label: "Our PO#", required: true, span: 1 }, { name: "po_date", label: "PO date", type: "date", span: 1 },
      { name: "supplier_id", label: "Supplier", type: "select", required: true, options: suppliers.map(s => ({ value: s.id, label: s.name })) },
      { name: "order_type", label: "Type", type: "select", required: true, span: 1, options: [{ value: "EXW", label: "EXW (euro)" }, { value: "FOB", label: "FOB (dollar)" }] },
      { name: "notes", label: "Note", type: "textarea" }]}
    onSubmit={async v => { const p = await db.insert("purchase_orders", v); return poPath(p as any); }} />;
}

export function PurchaseOrderDetail() {
  const { p, loading, no } = usePO();
  const id = p?.id ?? null;
  const inv = useRows(id && "supplier_invoices", { eq: { purchase_order_id: id } }).rows[0];
  const lines = useRows(id && "v_order_lines", { eq: { purchase_order_id: id }, order: [["pi_number", "asc"]] }).rows;
  const allocs = useRows(id && "v_allocations", { eq: { purchase_order_id: id }, order: [["payment_date", "asc"]] }).rows;
  const writeOffs = useRows(id && "write_offs", { eq: { purchase_order_id: id } }).rows;
  const products = useRows("products").rows; const suppliers = useRows("suppliers").rows;
  const rec = p ? { type: "po" as const, id: p.id, label: `PO ${p.po_number}`, path: poPath(p), sub: p.supplier_name } : null;
  useRecord(rec);
  if (!p) return loading ? <Loading what="Loading PO…" /> : <NotFound what={`PO ${no}`} back={{ to: "/purchasing", label: "All purchase orders" }} />;
  const cur = p.currency; const pName = Object.fromEntries(products.map(x => [x.id, x.name])); const base = poPath(p);
  const supplier = suppliers.find(s => s.id === p.supplier_id);
  return <>
    <PageHeader back={{ to: "/purchasing", label: "Purchase orders" }}
      title={<span className="flex items-center gap-3">PO {p.po_number}{rec && <FavoriteStar r={rec} />}{p.fully_paid && Number(p.payable) > 0 && <Pill tone="green">Paid</Pill>}{Number(p.overdue_amount) > 0 && <Pill tone="red">{p.days_late} days late</Pill>}</span>}
      sub={<>{supplier ? <Link to={supplierPath(supplier)} className="text-gray-700 hover:text-indigo-600">{p.supplier_name}</Link> : p.supplier_name} · {p.order_type} · {cur}{p.pi_numbers ? ` · for PI ${p.pi_numbers}` : ""}</>}>
      <LinkButton to={`${base}/payment`}><Receipt />Register payment</LinkButton>
      <LinkButton variant="outline" to={`${base}/invoice`}>{inv ? "Edit supplier invoice" : "Supplier invoice received"}</LinkButton>
      <LinkButton variant="outline" to={`${base}/pdf`}><FileText />PO (PDF)</LinkButton>
      <LinkButton variant="outline" to={`${base}/edit`}><Pencil />Edit</LinkButton>
    </PageHeader>
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat label="To pay" value={money(p.payable, cur)} hint={p.invoice_amount == null ? "expected, no invoice yet" : `invoice ${p.invoice_number ?? ""}`} />
      <Stat label="Paid" value={money(p.paid, cur)} />
      <Stat label="Outstanding" value={money(p.outstanding, cur)} tone={Number(p.overdue_amount) > 0 ? "bad" : Number(p.outstanding) > 0.01 ? "warn" : "good"}
        hint={p.balance_due_date || p.deposit_due_date ? `due ${date(p.deposit_due_date ?? p.balance_due_date)}` : "no due date set"} />
      <Stat label="Invoice difference" value={Math.abs(Number(p.invoice_difference ?? 0)) > 0.01 ? money(p.invoice_difference, cur) : "–"} tone={Math.abs(Number(p.invoice_difference ?? 0)) > 0.01 ? "warn" : undefined} hint="goes into the margin" />
    </div>
    <div className="mb-6 grid gap-6 lg:grid-cols-2">
      <Section title="Payment schedule" action={<Link to={`${base}/edit`} className="text-xs font-medium text-indigo-600 hover:underline">Set due dates</Link>}><KV items={[
        [`Deposit ${pct(p.deposit_pct, 0)}`, <>{money(p.deposit_due, cur)} {Number(p.deposit_due) > 0 && (Number(p.deposit_outstanding) <= 0.01 ? <Pill tone="green">paid</Pill> : <Pill tone="amber">{money(p.deposit_outstanding, cur)} open</Pill>)}</>],
        ["Deposit due", p.deposit_due_date ? date(p.deposit_due_date) : <span className="text-gray-400">not set</span>],
        ["Balance", money(Number(p.payable) - Number(p.deposit_due), cur)],
        ["Balance due", p.balance_due_date ? date(p.balance_due_date) : <span className="text-gray-400">not set</span>]]} /></Section>
      <Section title="PO"><KV items={[["PO date", date(p.po_date)], ["Cost prices", inv ? "final (supplier invoice entered)" : "calculated, final at supplier invoice"], ["Note", p.notes ?? "–"]]} /></Section>
    </div>
    <Section title="Order lines on this PO" className="mb-6">
      <DataTable rows={lines} empty="No order lines linked yet. Link a line by choosing this PO on the order." rowTo={l => orderPath({ pi_number: l.pi_number, id: l.sales_order_id })} cols={[
        { key: "pi_number", header: "PI#", render: l => <span className="font-semibold text-gray-900">{l.pi_number ?? "draft"}</span> }, { key: "product", header: "Product", value: l => pName[l.product_id], render: l => pName[l.product_id] },
        { key: "qty", header: "Qty", align: "right", render: l => qty(l.qty) }, { key: "unit_cost", header: "Cost per piece", align: "right", render: l => money(l.unit_cost, cur, 3) },
        { key: "purchase_value", header: "Purchase value", align: "right", render: l => money(l.purchase_value, cur) },
        { key: "invoice_variance", header: "Invoice difference", align: "right", render: l => Number(l.invoice_variance) ? money(l.invoice_variance, cur) : "–" }]} />
    </Section>
    <Section title="Payments" action={<LinkButton size="sm" variant="outline" to={`${base}/write-off`}>Write-off</LinkButton>}>
      <DataTable dense empty="No payments registered yet" rows={[
          ...allocs.map(a => ({ id: a.id, d: a.payment_date, what: a.voided_at ? "Payment (voided)" : "Payment", ref: a.reference, amount: a.amount, voided: !!a.voided_at, pid: a.payment_id })),
          ...writeOffs.map(a => ({ id: a.id, d: a.write_off_date, what: "Write-off", ref: a.reason, amount: a.amount }))]}
        cols={[{ key: "d", header: "Date", render: r => date(r.d) }, { key: "what", header: "Type" }, { key: "ref", header: "Reference / reason" },
          { key: "amount", header: "Amount", align: "right", render: (r: any) => <span className={r.voided ? "text-gray-400 line-through" : ""}>{money(r.amount, cur)}</span> },
          { key: "x", header: "", render: (r: any) => r.pid && !r.voided ? <Link to={`/payments/${String(r.pid).slice(0, 8)}/void?back=${encodeURIComponent(base)}`} className="text-xs text-rose-600 hover:underline">void</Link> : null }]} />
    </Section>
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <TasksSection eq={{ purchase_order_id: p.id }} hide={["po", "supplier"]} newLink={newTaskPath({ po: p.po_number, back: base })} />
      <DocumentsSection entity="purchase_orders" id={p.id} />
    </div>
  </>;
}

export function PurchaseOrderEdit() {
  const { db } = useApp();
  return <WithPO>{p => <POEditForm p={p} db={db} />}</WithPO>;
}
function POEditForm({ p, db }: { p: any; db: any }) {
  const raw = useRows("purchase_orders", { eq: { id: p.id } }).rows[0];
  if (!raw) return <Loading />;
  const fields: Field[] = [{ name: "po_date", label: "PO date", type: "date", span: 1 }, { name: "deposit_pct", label: "Deposit %", type: "percent", span: 1 },
    { name: "deposit_due_date", label: "Deposit due date", type: "date", span: 1, section: "Payment terms" }, { name: "balance_due_date", label: "Balance due date", type: "date", span: 1, section: "Payment terms" },
    { name: "notes", label: "Note", type: "textarea", section: "Note" }];
  return <FormPage title={`Edit PO ${p.po_number}`} back={backTo(p)} fields={fields} initial={raw} aside={<POAside p={p} />}
    onSubmit={async v => { await db.update("purchase_orders", { id: p.id }, v); }} />;
}

export function PurchaseOrderPayment() {
  const { db } = useApp();
  return <WithPO>{p => <FormPage title="Register payment to supplier" submitLabel="Register payment" back={backTo(p)} aside={<POAside p={p} />}
    sub={`Outstanding ${money(p.outstanding, p.currency)}${Number(p.deposit_outstanding) > 0.01 ? `, of which deposit ${money(p.deposit_outstanding, p.currency)}` : ""}.`}
    initial={{ p_date: today(), p_amount: Number(p.deposit_outstanding) > 0.01 ? p.deposit_outstanding : Math.max(Number(p.outstanding), 0) }}
    fields={[{ name: "p_date", label: "Date paid", type: "date", required: true, span: 1 }, { name: "p_amount", label: `Amount (${p.currency})`, type: "number", required: true, span: 1 },
      { name: "p_reference", label: "Bank reference" }, { name: "p_notes", label: "Note", type: "textarea" }]}
    onSubmit={async v => { await db.rpc("register_supplier_payment", { p_po: p.id, ...v }); }} />}</WithPO>;
}

export function PurchaseOrderInvoice() {
  const { db } = useApp();
  return <WithPO>{p => <POInvoiceForm p={p} db={db} />}</WithPO>;
}
function POInvoiceForm({ p, db }: { p: any; db: any }) {
  const { rows, loading } = useRows("supplier_invoices", { eq: { purchase_order_id: p.id } });
  if (loading) return <Loading />;
  const inv = rows[0];
  return <FormPage title="Supplier invoice" back={backTo(p)} aside={<POAside p={p} />} initial={inv ?? { invoice_date: today(), amount: p.expected_amount }}
    sub="The supplier's invoice stands: it replaces the expected amount, makes the cost prices of the linked lines final, and any difference goes into the margin."
    fields={[{ name: "invoice_number", label: "Supplier invoice #", span: 1 }, { name: "invoice_date", label: "Invoice date", type: "date", span: 1 }, { name: "amount", label: `Invoice amount (${p.currency})`, type: "number", required: true }]}
    onSubmit={async v => { if (inv) await db.update("supplier_invoices", { id: inv.id }, v); else await db.insert("supplier_invoices", { ...v, purchase_order_id: p.id }); }} />;
}

export function PurchaseOrderWriteOff() {
  const { db } = useApp();
  return <WithPO>{p => <FormPage title="Write off a difference" back={backTo(p)} aside={<POAside p={p} />} initial={{ write_off_date: today() }}
    fields={[{ name: "amount", label: `Amount (${p.currency})`, type: "number", required: true, span: 1 }, { name: "write_off_date", label: "Date", type: "date", required: true, span: 1 }, { name: "reason", label: "Reason", required: true }]}
    onSubmit={async v => { await db.insert("write_offs", { ...v, purchase_order_id: p.id }); }} />}</WithPO>;
}

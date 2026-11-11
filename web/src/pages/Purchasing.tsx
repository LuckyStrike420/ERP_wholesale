import { useState } from "react";
import { ArrowLeft, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useNav, useRows } from "@/app/store";
import { DataTable, FormDialog, KV, PageHeader, Pill, Section, type Field } from "@/app/ui";
import { date, money, pct, qty, today } from "@/app/format";

export function PurchaseOrders() {
  const { db, run } = useApp(); const nav = useNav();
  const pos = useRows("v_purchase_orders", { order: [["po_number", "desc"]] }).rows;
  const suppliers = useRows("suppliers", { order: [["name", "asc"]] }).rows;
  const [adding, setAdding] = useState(false);
  return <>
    <PageHeader title="Purchasing" sub="One row per own PO to a supplier. The expected amount comes from the order lines linked to the PO.">
      <Button onClick={() => setAdding(true)}><Plus className="mr-1 h-4 w-4" />New PO</Button></PageHeader>
    <Section title="Purchase orders">
      <DataTable rows={pos} search exportName="purchase-orders" onRow={p => nav(`po-${p.id}`)} cols={[
        { key: "po_number", header: "PO#", render: p => <b>{p.po_number}</b> }, { key: "supplier_name", header: "Supplier" }, { key: "order_type", header: "Type" },
        { key: "pi_numbers", header: "For PI" }, { key: "po_date", header: "PO date", render: p => date(p.po_date) },
        { key: "expected_amount", header: "Expected", align: "right", render: p => money(p.expected_amount, p.currency) },
        { key: "invoice_amount", header: "Invoiced", align: "right", render: p => p.invoice_amount == null ? <span className="text-muted-foreground">no invoice</span> : money(p.invoice_amount, p.currency) },
        { key: "invoice_difference", header: "Difference", align: "right", render: p => Math.abs(Number(p.invoice_difference ?? 0)) > 0.01 ? <span className="font-semibold text-amber-700">{money(p.invoice_difference, p.currency)}</span> : "–" },
        { key: "paid", header: "Paid", align: "right", render: p => money(p.paid, p.currency) },
        { key: "outstanding", header: "Outstanding", align: "right", render: p => <span className={Number(p.overdue_amount) > 0 ? "font-semibold text-red-700" : ""}>{money(p.outstanding, p.currency)}</span> },
        { key: "fully_paid", header: "", render: p => p.fully_paid && Number(p.payable) > 0 ? <Pill tone="green">Paid</Pill> : Number(p.overdue_amount) > 0 ? <Pill tone="red">{p.days_late} days late</Pill> : null },
      ]} />
    </Section>
    <FormDialog open={adding} onClose={() => setAdding(false)} title="New purchase order" description="Currency and deposit % are taken from the supplier's terms for this type." submitLabel="Create PO"
      initial={{ order_type: "FOB", po_date: today() }}
      fields={[{ name: "po_number", label: "Our PO#", required: true, span: 1 }, { name: "po_date", label: "PO date", type: "date", span: 1 },
        { name: "supplier_id", label: "Supplier", type: "select", required: true, options: suppliers.map(s => ({ value: s.id, label: s.name })) },
        { name: "order_type", label: "Type", type: "select", required: true, span: 1, options: [{ value: "EXW", label: "EXW (euro)" }, { value: "FOB", label: "FOB (dollar)" }] },
        { name: "notes", label: "Note", type: "textarea" }]}
      onSubmit={async v => { const p = await run(() => db.insert("purchase_orders", v), "PO created"); if (!p) return false; nav(`po-${p.id}`); }} />
  </>;
}

export function PurchaseOrderDetail({ id }: { id: string }) {
  const { db, save } = useApp(); const nav = useNav();
  const p = useRows("v_purchase_orders", { eq: { id } }).rows[0];
  const raw = useRows("purchase_orders", { eq: { id } }).rows[0];
  const inv = useRows("supplier_invoices", { eq: { purchase_order_id: id } }).rows[0];
  const lines = useRows("v_order_lines", { eq: { purchase_order_id: id }, order: [["pi_number", "asc"]] }).rows;
  const allocs = useRows("v_allocations", { eq: { purchase_order_id: id }, order: [["payment_date", "asc"]] }).rows;
  const writeOffs = useRows("write_offs", { eq: { purchase_order_id: id } }).rows;
  const products = useRows("products").rows;
  const [dlg, setDlg] = useState<null | { kind: string; row?: any }>(null);
  if (!p || !raw) return <p className="text-sm text-muted-foreground">Loading PO…</p>;
  const cur = p.currency; const pName = Object.fromEntries(products.map(x => [x.id, x.name]));
  const headerFields: Field[] = [{ name: "po_date", label: "PO date", type: "date", span: 1 }, { name: "deposit_pct", label: "Deposit %", type: "percent", span: 1 },
    { name: "deposit_due_date", label: "Deposit due date", type: "date", span: 1 }, { name: "balance_due_date", label: "Balance due date", type: "date", span: 1 }, { name: "notes", label: "Note", type: "textarea" }];
  return <>
    <button onClick={() => nav("purchasing")} className="mb-2 flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" />Purchasing</button>
    <PageHeader title={<span className="flex items-center gap-3">PO {p.po_number}{p.fully_paid && Number(p.payable) > 0 && <Pill tone="green">Paid</Pill>}{Number(p.overdue_amount) > 0 && <Pill tone="red">{p.days_late} days late</Pill>}</span>}
      sub={`${p.supplier_name} · ${p.order_type} · ${cur}${p.pi_numbers ? ` · for PI ${p.pi_numbers}` : ""}`}>
      <Button onClick={() => setDlg({ kind: "payment" })}><Plus className="mr-1 h-4 w-4" />Register payment</Button>
      <Button variant="outline" onClick={() => setDlg({ kind: "invoice" })}>{inv ? "Edit supplier invoice" : "Supplier invoice received"}</Button>
      <Button variant="outline" onClick={() => setDlg({ kind: "header" })}><Pencil className="mr-1 h-4 w-4" />Edit</Button>
    </PageHeader>
    <div className="mb-5 grid gap-5 lg:grid-cols-3">
      <Section title="Amount"><KV items={[
        ["Expected from order lines", money(p.expected_amount, cur)],
        ["Supplier invoice", p.invoice_amount == null ? "not received" : <>{money(p.invoice_amount, cur)} · {p.invoice_number ?? "no number"}</>],
        ["Difference", Math.abs(Number(p.invoice_difference ?? 0)) > 0.01 ? <b className="text-amber-700">{money(p.invoice_difference, cur)}</b> : "–"],
        ["To pay", <b>{money(p.payable, cur)}</b>], ["Paid", money(p.paid, cur)],
        ...(Number(p.written_off) ? [["Written off", money(p.written_off, cur)] as [any, any]] : []),
        ["Outstanding", <b className={Number(p.overdue_amount) > 0 ? "text-red-700" : ""}>{money(p.outstanding, cur)}</b>]]} /></Section>
      <Section title="Payment schedule"><KV items={[
        [`Deposit ${pct(p.deposit_pct, 0)}`, <>{money(p.deposit_due, cur)} {Number(p.deposit_due) > 0 && (Number(p.deposit_outstanding) <= 0.01 ? <Pill tone="green">paid</Pill> : <Pill tone="amber">{money(p.deposit_outstanding, cur)} open</Pill>)}</>],
        ["Deposit due", p.deposit_due_date ? date(p.deposit_due_date) : <button className="text-sky-700 underline" onClick={() => setDlg({ kind: "header" })}>set date</button>],
        ["Balance", money(Number(p.payable) - Number(p.deposit_due), cur)],
        ["Balance due", p.balance_due_date ? date(p.balance_due_date) : <button className="text-sky-700 underline" onClick={() => setDlg({ kind: "header" })}>set date</button>]]} /></Section>
      <Section title="PO"><KV items={[["PO date", date(p.po_date)], ["Cost prices", inv ? "final (supplier invoice entered)" : "calculated, final at supplier invoice"], ["Note", p.notes ?? "–"]]} /></Section>
    </div>
    <Section title="Order lines on this PO" className="mb-5">
      <DataTable rows={lines} empty="No order lines linked yet. Link a line by choosing this PO on the order." onRow={l => nav(`order-${l.sales_order_id}`)} cols={[
        { key: "pi_number", header: "PI#", render: l => <b>{l.pi_number ?? "draft"}</b> }, { key: "product", header: "Product", value: l => pName[l.product_id], render: l => pName[l.product_id] },
        { key: "qty", header: "Qty", align: "right", render: l => qty(l.qty) }, { key: "unit_cost", header: "Cost per piece", align: "right", render: l => money(l.unit_cost, cur, 3) },
        { key: "purchase_value", header: "Purchase value", align: "right", render: l => money(l.purchase_value, cur) },
        { key: "invoice_variance", header: "Invoice difference", align: "right", render: l => Number(l.invoice_variance) ? money(l.invoice_variance, cur) : "–" }]} />
    </Section>
    <Section title="Payments" action={<Button size="sm" variant="outline" onClick={() => setDlg({ kind: "writeoff" })}>Write-off</Button>}>
      <DataTable dense empty="No payments registered yet" rows={[
          ...allocs.map(a => ({ id: a.id, d: a.payment_date, what: a.voided_at ? "Payment (voided)" : "Payment", ref: a.reference, amount: a.amount, voided: !!a.voided_at, pid: a.payment_id })),
          ...writeOffs.map(a => ({ id: a.id, d: a.write_off_date, what: "Write-off", ref: a.reason, amount: a.amount }))]}
        cols={[{ key: "d", header: "Date", render: r => date(r.d) }, { key: "what", header: "Type" }, { key: "ref", header: "Reference / reason" },
          { key: "amount", header: "Amount", align: "right", render: (r: any) => <span className={r.voided ? "text-muted-foreground line-through" : ""}>{money(r.amount, cur)}</span> },
          { key: "x", header: "", render: (r: any) => r.pid && !r.voided ? <button className="text-xs text-red-700 underline" onClick={() => setDlg({ kind: "void", row: r })}>void</button> : null }]} />
    </Section>

    <FormDialog open={dlg?.kind === "payment"} onClose={() => setDlg(null)} title="Register payment to supplier" submitLabel="Register"
      description={`Outstanding ${money(p.outstanding, cur)}${Number(p.deposit_outstanding) > 0.01 ? `, of which deposit ${money(p.deposit_outstanding, cur)}` : ""}.`}
      initial={{ p_date: today(), p_amount: Number(p.deposit_outstanding) > 0.01 ? p.deposit_outstanding : Math.max(Number(p.outstanding), 0) }}
      fields={[{ name: "p_date", label: "Date paid", type: "date", required: true, span: 1 }, { name: "p_amount", label: `Amount (${cur})`, type: "number", required: true, span: 1 },
        { name: "p_reference", label: "Bank reference" }, { name: "p_notes", label: "Note", type: "textarea" }]}
      onSubmit={v => save(() => db.rpc("register_supplier_payment", { p_po: id, ...v }), "Payment registered")} />
    <FormDialog open={dlg?.kind === "void"} onClose={() => setDlg(null)} title="Void payment" submitLabel="Void payment" description="The payment stays in the history, marked as voided, and no longer counts."
      fields={[{ name: "p_reason", label: "Reason", required: true }]} onSubmit={v => save(() => db.rpc("void_payment", { p_payment: dlg!.row.pid, ...v }), "Payment voided")} />
    <FormDialog open={dlg?.kind === "invoice"} onClose={() => setDlg(null)} title="Supplier invoice" initial={inv ?? { invoice_date: today(), amount: p.expected_amount }}
      description="The supplier's invoice stands: it replaces the expected amount, makes the cost prices of the linked lines final, and any difference goes into the margin."
      fields={[{ name: "invoice_number", label: "Supplier invoice #", span: 1 }, { name: "invoice_date", label: "Invoice date", type: "date", span: 1 }, { name: "amount", label: `Invoice amount (${cur})`, type: "number", required: true }]}
      onSubmit={v => save(() => inv ? db.update("supplier_invoices", { id: inv.id }, v) : db.insert("supplier_invoices", { ...v, purchase_order_id: id }), "Supplier invoice saved")} />
    <FormDialog open={dlg?.kind === "writeoff"} onClose={() => setDlg(null)} title="Write off a difference" initial={{ write_off_date: today() }}
      fields={[{ name: "amount", label: `Amount (${cur})`, type: "number", required: true, span: 1 }, { name: "write_off_date", label: "Date", type: "date", required: true, span: 1 }, { name: "reason", label: "Reason", required: true }]}
      onSubmit={v => save(() => db.insert("write_offs", { ...v, purchase_order_id: id }), "Write-off saved")} />
    <FormDialog open={dlg?.kind === "header"} onClose={() => setDlg(null)} title="Edit PO" initial={raw} fields={headerFields} onSubmit={v => save(() => db.update("purchase_orders", { id }, v), "PO saved")} />
  </>;
}

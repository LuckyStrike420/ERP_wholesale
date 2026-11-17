/**
 * Customers and suppliers: /customers, /customers/new, /customers/jml, /customers/jml/edit (same for /suppliers).
 */
import { Pencil, Plus } from "lucide-react";
import { useApp, useRows } from "@/app/store";
import { useParams } from "@/app/router";
import { bySlug, customerPath, orderPath, poPath, supplierPath } from "@/app/paths";
import { DataTable, FormPage, KV, LinkButton, Loading, NotFound, PageHeader, PaymentPill, Section, Stat, StatusPill, type Field } from "@/app/ui";
import { date, money, pct } from "@/app/format";

// ---------------- customers ----------------
function useCustomers() {
  const customers = useRows("customers", { order: [["name", "asc"]] }); const terms = useRows("customer_terms").rows; const summary = useRows("v_customer_summary").rows;
  const t = (id: string, type: string) => terms.find(x => x.customer_id === id && x.order_type === type);
  const s = (id: string, cur: string) => summary.find(x => x.customer_id === id && x.currency === cur);
  return { loading: customers.loading, rows: customers.rows.map(c => ({ ...c, exw: t(c.id, "EXW"), fob: t(c.id, "FOB"), eur: s(c.id, "EUR"), usd: s(c.id, "USD") })) };
}
const terms = (x: any) => x ? `${pct(x.deposit_pct, 0)} deposit · ${x.payment_days} days` : "–";

export function Customers() {
  const { rows } = useCustomers();
  return <>
    <PageHeader title="Customers" sub="One record per customer, with deposit and payment term per order type."><LinkButton to="/customers/new"><Plus />New customer</LinkButton></PageHeader>
    <Section><DataTable rows={rows} search exportName="customers" rowTo={c => customerPath(c)} cols={[
      { key: "name", header: "Customer", render: c => <div><div className="font-semibold text-gray-900">{c.name}</div><div className="text-xs text-gray-500">{[c.country, c.contact_name].filter(Boolean).join(" · ")}</div></div> },
      { key: "exw", header: "EXW terms", value: c => c.exw?.deposit_pct, render: c => terms(c.exw) },
      { key: "fob", header: "FOB terms", value: c => c.fob?.deposit_pct, render: c => terms(c.fob) },
      { key: "oeur", header: "Open €", align: "right", value: c => Number(c.eur?.outstanding ?? 0), render: c => Number(c.eur?.outstanding) ? <span className="font-medium text-gray-900">{money(c.eur.outstanding, "EUR")}</span> : "–" },
      { key: "ousd", header: "Open $", align: "right", value: c => Number(c.usd?.outstanding ?? 0), render: c => Number(c.usd?.outstanding) ? <span className="font-medium text-gray-900">{money(c.usd.outstanding, "USD")}</span> : "–" },
      { key: "open", header: "Open orders", align: "right", value: c => Number(c.eur?.open_orders ?? 0) + Number(c.usd?.open_orders ?? 0), render: c => (Number(c.eur?.open_orders ?? 0) + Number(c.usd?.open_orders ?? 0)) || "–" }]} /></Section>
  </>;
}

export function CustomerDetail() {
  const { slug } = useParams(); const { rows, loading } = useCustomers();
  const c = bySlug(rows, slug);
  const orders = useRows(c ? "v_orders" : null, { eq: { customer_id: c?.id }, order: [["po_date", "desc"]] }).rows;
  if (!c) return loading ? <Loading /> : <NotFound what="Customer" back={{ to: "/customers", label: "All customers" }} />;
  const cur = [c.eur, c.usd].filter(Boolean);
  return <>
    <PageHeader back={{ to: "/customers", label: "Customers" }} title={c.name} sub={[c.country, c.contact_name, c.email].filter(Boolean).join(" · ") || undefined}>
      <LinkButton to={`/orders/new`} variant="outline"><Plus />New order</LinkButton>
      <LinkButton to={customerPath(c, "/edit")} variant="outline"><Pencil />Edit</LinkButton></PageHeader>
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cur.map(x => <Stat key={x.currency} label={`Open ${x.currency}`} value={money(x.outstanding, x.currency)} tone={Number(x.overdue) > 0 ? "bad" : undefined} hint={Number(x.overdue) > 0 ? `${money(x.overdue, x.currency)} overdue` : `${x.open_orders} open order(s)`} />)}
      {cur.map(x => <Stat key={"v" + x.currency} label={`Order value ${x.currency}`} value={money(x.order_value, x.currency)} hint={`margin ${money(x.margin, x.currency)}`} />)}
    </div>
    <div className="mb-6 grid gap-6 lg:grid-cols-2">
      <Section title="Terms"><KV items={[["EXW", terms(c.exw)], ["FOB", terms(c.fob)]]} /></Section>
      <Section title="Details"><KV items={[["Address", c.address ? <span className="whitespace-pre-line">{c.address}</span> : "–"], ["VAT number", c.vat_number ?? "–"], ["E-mail", c.email ?? "–"], ["Note", c.notes ?? "–"]]} /></Section>
    </div>
    <Section title="Orders">
      <DataTable rows={orders} rowTo={o => orderPath(o)} empty="No orders yet" cols={[
        { key: "pi_number", header: "PI#", render: o => <span className="font-semibold text-gray-900">{o.pi_number ?? "draft"}</span> }, { key: "order_type", header: "Type" },
        { key: "po_date", header: "PO date", render: o => date(o.po_date) }, { key: "status", header: "Status", render: o => <StatusPill status={o.status} /> },
        { key: "total_receivable", header: "Total", align: "right", render: o => money(o.total_receivable, o.currency) },
        { key: "outstanding", header: "Outstanding", align: "right", render: o => money(o.outstanding, o.currency) },
        { key: "payment_status", header: "Payment", render: o => <PaymentPill status={o.payment_status} /> }]} />
    </Section>
  </>;
}

const customerFields: Field[] = [{ name: "name", label: "Customer", required: true }, { name: "country", label: "Country", span: 1 }, { name: "vat_number", label: "VAT number", span: 1 },
  { name: "contact_name", label: "Contact", span: 1 }, { name: "email", label: "E-mail", span: 1 },
  { name: "address", label: "Address (on the PI)", type: "textarea" },
  { name: "exw_deposit", label: "EXW deposit %", type: "percent", span: 1, section: "Payment terms" }, { name: "exw_days", label: "EXW payment term (days)", type: "number", span: 1, section: "Payment terms" },
  { name: "fob_deposit", label: "FOB deposit %", type: "percent", span: 1, section: "Payment terms" }, { name: "fob_days", label: "FOB payment term (days)", type: "number", span: 1, section: "Payment terms" },
  { name: "notes", label: "Note", type: "textarea", section: "Note" }];

export function CustomerForm() {
  const { slug } = useParams(); const { db } = useApp(); const { rows, loading } = useCustomers();
  const row = slug ? bySlug(rows, slug) : undefined;
  if (slug && !row) return loading ? <Loading /> : <NotFound what="Customer" back={{ to: "/customers", label: "All customers" }} />;
  return <FormPage title={row ? `Edit ${row.name}` : "New customer"} sub="New terms apply to new orders; existing orders keep the terms they were created with."
    back={row ? { to: customerPath(row), label: row.name } : { to: "/customers", label: "Customers" }} fields={customerFields}
    initial={row ? { ...row, exw_deposit: row.exw?.deposit_pct, exw_days: row.exw?.payment_days, fob_deposit: row.fob?.deposit_pct, fob_days: row.fob?.payment_days } : { exw_deposit: 1, exw_days: 0, fob_deposit: 0.3, fob_days: 0 }}
    onSubmit={async v => {
      const { exw_deposit, exw_days, fob_deposit, fob_days, ...c } = v;
      const id = row ? (await db.update("customers", { id: row.id }, c), row.id) : (await db.insert("customers", c)).id;
      for (const [type, dep, d] of [["EXW", exw_deposit, exw_days], ["FOB", fob_deposit, fob_days]] as const) {
        const body = { deposit_pct: dep ?? 0, payment_days: d ?? 0 };
        if (row?.[type.toLowerCase()]) await db.update("customer_terms", { customer_id: id, order_type: type }, body);
        else await db.insert("customer_terms", { customer_id: id, order_type: type, ...body });
      }
      return customerPath({ name: c.name });
    }} />;
}

// ---------------- suppliers ----------------
function useSuppliers() {
  const suppliers = useRows("suppliers", { order: [["name", "asc"]] }); const terms = useRows("supplier_terms").rows; const summary = useRows("v_supplier_summary").rows;
  const t = (id: string, type: string) => terms.find(x => x.supplier_id === id && x.order_type === type);
  const s = (id: string, cur: string) => summary.find(x => x.supplier_id === id && x.currency === cur);
  return { loading: suppliers.loading, rows: suppliers.rows.map(c => ({ ...c, exw: t(c.id, "EXW"), fob: t(c.id, "FOB"), eur: s(c.id, "EUR"), usd: s(c.id, "USD") })) };
}
const sterms = (x: any) => x ? `${x.currency} · ${pct(x.deposit_pct, 0)} deposit` : "–";

export function Suppliers() {
  const { rows } = useSuppliers();
  return <>
    <PageHeader title="Suppliers" sub="One record per supplier or factory, with currency and deposit per order type."><LinkButton to="/suppliers/new"><Plus />New supplier</LinkButton></PageHeader>
    <Section><DataTable rows={rows} search exportName="suppliers" rowTo={s => supplierPath(s)} cols={[
      { key: "name", header: "Supplier", render: c => <div><div className="font-semibold text-gray-900">{c.name}</div><div className="text-xs text-gray-500">{[c.country, c.contact_name].filter(Boolean).join(" · ")}</div></div> },
      { key: "exw", header: "EXW terms", value: c => c.exw?.deposit_pct, render: c => sterms(c.exw) },
      { key: "fob", header: "FOB terms", value: c => c.fob?.deposit_pct, render: c => sterms(c.fob) },
      { key: "oeur", header: "Open €", align: "right", value: c => Number(c.eur?.outstanding ?? 0), render: c => Number(c.eur?.outstanding) ? money(c.eur.outstanding, "EUR") : "–" },
      { key: "ousd", header: "Open $", align: "right", value: c => Number(c.usd?.outstanding ?? 0), render: c => Number(c.usd?.outstanding) ? money(c.usd.outstanding, "USD") : "–" }]} /></Section>
  </>;
}

export function SupplierDetail() {
  const { slug } = useParams(); const { rows, loading } = useSuppliers();
  const s = bySlug(rows, slug);
  const pos = useRows(s ? "v_purchase_orders" : null, { eq: { supplier_id: s?.id }, order: [["po_number", "desc"]] }).rows;
  if (!s) return loading ? <Loading /> : <NotFound what="Supplier" back={{ to: "/suppliers", label: "All suppliers" }} />;
  return <>
    <PageHeader back={{ to: "/suppliers", label: "Suppliers" }} title={s.name} sub={[s.country, s.contact_name, s.email].filter(Boolean).join(" · ") || undefined}>
      <LinkButton to={supplierPath(s, "/edit")} variant="outline"><Pencil />Edit</LinkButton></PageHeader>
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {[s.eur, s.usd].filter(Boolean).map(x => <Stat key={x.currency} label={`Still to pay ${x.currency}`} value={money(x.outstanding, x.currency)} tone={Number(x.overdue) > 0 ? "bad" : undefined} />)}
    </div>
    <Section title="Terms" className="mb-6"><KV items={[["EXW", sterms(s.exw)], ["FOB", sterms(s.fob)], ["Note", s.notes ?? "–"]]} /></Section>
    <Section title="Purchase orders">
      <DataTable rows={pos} rowTo={p => poPath(p)} empty="No purchase orders yet" cols={[
        { key: "po_number", header: "PO#", render: p => <span className="font-semibold text-gray-900">{p.po_number}</span> }, { key: "pi_numbers", header: "For PI" },
        { key: "po_date", header: "PO date", render: p => date(p.po_date) }, { key: "payable", header: "To pay", align: "right", render: p => money(p.payable, p.currency) },
        { key: "outstanding", header: "Outstanding", align: "right", render: p => money(p.outstanding, p.currency) }]} />
    </Section>
  </>;
}

export function SupplierForm() {
  const { slug } = useParams(); const { db } = useApp(); const { rows, loading } = useSuppliers();
  const row = slug ? bySlug(rows, slug) : undefined;
  if (slug && !row) return loading ? <Loading /> : <NotFound what="Supplier" back={{ to: "/suppliers", label: "All suppliers" }} />;
  const cur = [{ value: "EUR", label: "EUR" }, { value: "USD", label: "USD" }];
  return <FormPage title={row ? `Edit ${row.name}` : "New supplier"} back={row ? { to: supplierPath(row), label: row.name } : { to: "/suppliers", label: "Suppliers" }}
    fields={[{ name: "name", label: "Supplier", required: true }, { name: "country", label: "Country", span: 1 }, { name: "contact_name", label: "Contact", span: 1 }, { name: "email", label: "E-mail" },
      { name: "exw_currency", label: "EXW currency", type: "select", options: cur, span: 1, section: "Terms" }, { name: "exw_deposit", label: "EXW deposit %", type: "percent", span: 1, section: "Terms" },
      { name: "fob_currency", label: "FOB currency", type: "select", options: cur, span: 1, section: "Terms" }, { name: "fob_deposit", label: "FOB deposit %", type: "percent", span: 1, section: "Terms" },
      { name: "notes", label: "Note", type: "textarea", section: "Note" }]}
    initial={row ? { ...row, exw_currency: row.exw?.currency, exw_deposit: row.exw?.deposit_pct, fob_currency: row.fob?.currency, fob_deposit: row.fob?.deposit_pct } : { exw_currency: "EUR", fob_currency: "USD" }}
    onSubmit={async v => {
      const { exw_currency, exw_deposit, fob_currency, fob_deposit, ...c } = v;
      const id = row ? (await db.update("suppliers", { id: row.id }, c), row.id) : (await db.insert("suppliers", c)).id;
      for (const [type, currency, dep] of [["EXW", exw_currency, exw_deposit], ["FOB", fob_currency, fob_deposit]] as const) {
        if (!currency) continue; const body = { currency, deposit_pct: dep ?? 0 };
        if (row?.[type.toLowerCase()]) await db.update("supplier_terms", { supplier_id: id, order_type: type }, body);
        else await db.insert("supplier_terms", { supplier_id: id, order_type: type, ...body });
      }
      return supplierPath({ name: c.name });
    }} />;
}

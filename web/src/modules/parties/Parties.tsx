/**
 * Customers and suppliers: /customers, /customers/new, /customers/jml, /customers/jml/edit (same for /suppliers).
 */
import { CustomerHealth, CustomerReorders, HealthDot } from "@/modules/insights/Insights";
import { addressFields } from "@/app/countries";
import { Pencil, Plus } from "lucide-react";
import { useApp, useRows } from "@/app/store";
import { Link, useParams } from "@/app/router";
import { bySlug, customerPath, orderPath, poPath, supplierPath } from "@/app/paths";
import { DataTable, FormPage, KV, LinkButton, Loading, NotFound, PageHeader, PaymentPill, Section, Stat, StatusPill, type Field } from "@/app/ui";
import { date, money, pct, termText } from "@/app/format";
import { TasksSection, newTaskPath } from "@/modules/tasks/Tasks";
import { DocumentsSection } from "@/modules/documents/Documents";
import { ContactsSection, NotesSection } from "./Contacts";
import { FavoriteStar, useRecord } from "@/app/Favorites";
import { BlockGrid, CustomizeButton, useLayout } from "@/app/Layout";
import { findSimilar } from "@/app/duplicates";
import type { ReactNode } from "react";
import { INCOTERMS, INCOTERM_OPTIONS, incotermHint } from "@/modules/orders/incoterms";

/** "a similar customer already exists" with links, shown on the form before a new one is saved */
export const similarWarning = (kind: string, sims: { name: string }[], pathOf: (x: { name: string }) => string, go: () => Promise<any>) => ({ confirm: {
  title: `A ${kind} with a similar name already exists`, label: `Create new ${kind} anyway`, go,
  body: <div>Check that it is not the same {kind}:<ul className="mt-1 list-disc pl-5">{sims.map(x => <li key={x.name}><Link to={pathOf(x)} className="font-medium underline">{x.name}</Link></li>)}</ul></div> as ReactNode } });

// ---------------- customers ----------------
function useCustomers() {
  const customers = useRows("customers", { order: [["name", "asc"]] }); const terms = useRows("customer_terms").rows; const summary = useRows("v_customer_summary").rows;
  const pts = useRows("payment_terms").rows;
  const t = (id: string, type: string) => { const x = terms.find(y => y.customer_id === id && y.order_type === type); return x && { ...x, term: pts.find(p => p.id === x.payment_term_id) }; };
  const s = (id: string, cur: string) => summary.find(x => x.customer_id === id && x.currency === cur);
  return { loading: customers.loading, rows: customers.rows.map(c => ({ ...c, exw: t(c.id, "EXW"), fob: t(c.id, "FOB"), eur: s(c.id, "EUR"), usd: s(c.id, "USD") })) };
}
const terms = (x: any) => !x ? "–" : x.term ? x.term.name : `${pct(x.deposit_pct, 0)} deposit · ${x.payment_days} days`;
const termLine = (x: any) => !x ? "–" : x.term ? <div><div className="text-gray-900">{x.term.name}</div><div className="text-xs text-gray-500">{termText(x.term)}</div></div> : terms(x);

export function Customers() {
  const { rows } = useCustomers(); const health = useRows("v_customer_health").rows;
  return <>
    <PageHeader title="Customers" sub="One record per customer, with a payment term per order type.">
      <LinkButton variant="outline" to="/customers/health">Health and reorders</LinkButton><LinkButton to="/customers/new"><Plus />New customer</LinkButton></PageHeader>
    <Section><DataTable rows={rows} search exportName="customers" rowTo={c => customerPath(c)} cols={[
      { key: "health", header: "", width: "2rem", value: c => ({ red: 0, amber: 1, green: 2 } as any)[health.find(h => h.customer_id === c.id)?.score] ?? 3, render: c => <HealthDot score={health.find(h => h.customer_id === c.id)?.score} /> },
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
  const rec = c ? { type: "customer" as const, id: c.id, label: c.name, path: customerPath(c), sub: c.country ?? undefined } : null;
  useRecord(rec);
  const lay = useLayout("customer");
  if (!c) return loading ? <Loading /> : <NotFound what="Customer" back={{ to: "/customers", label: "All customers" }} />;
  const cur = [c.eur, c.usd].filter(Boolean);
  const last = orders.find(o => o.status !== "cancelled");
  const lastPay = orders.map(o => o.last_payment_date).filter(Boolean).sort().pop();
  return <>
    <PageHeader back={{ to: "/customers", label: "Customers" }} title={<span className="flex items-center gap-2">{c.name}{rec && <FavoriteStar r={rec} />}</span>} sub={[c.country, c.contact_name, c.email].filter(Boolean).join(" · ") || undefined}>
      <LinkButton to={`/orders/new`} variant="outline"><Plus />New order</LinkButton>
      <LinkButton to={customerPath(c, "/edit")} variant="outline"><Pencil />Edit</LinkButton><CustomizeButton lay={lay} /></PageHeader>
    <BlockGrid lay={lay} blocks={[
      { id: "stats", title: "Key figures", node: <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cur.map(x => <Stat key={x.currency} label={`Open ${x.currency}`} value={money(x.outstanding, x.currency)} tone={Number(x.overdue) > 0 ? "bad" : undefined} hint={Number(x.overdue) > 0 ? `${money(x.overdue, x.currency)} overdue` : `${x.open_orders} open order(s)`} />)}
      {!cur.length && <Stat label="Open" value="–" hint="no orders yet" />}
      <Stat label="Last order" value={last ? <Link to={orderPath(last)} className="hover:text-indigo-600">{last.pi_number ? `PI ${last.pi_number}` : "draft"}</Link> : "–"} hint={last ? `${date(last.po_date)} · ${orders.length} order(s) in total` : undefined} />
      <Stat label="Last payment" value={lastPay ? date(lastPay) : "–"} hint={lastPay ? "received" : "nothing received yet"} />
    </div> },
      { id: "contacts", title: "Contacts", size: "half", node: <ContactsSection party="customer" p={c} /> },
      { id: "terms", title: "Payment terms", size: "half", node: <Section title="Payment terms" action={<Link to={customerPath(c, "/edit")} className="text-xs font-medium text-indigo-600 hover:underline">Change</Link>}><KV items={[["EXW", termLine(c.exw)], ["FOB", termLine(c.fob)], ["Delivery", c.default_incoterm ? <span title={incotermHint(c.default_incoterm)}>{INCOTERMS.find(t => t.code === c.default_incoterm)?.label}</span> : "Follows the order type"]]} /></Section> },
      { id: "details", title: "Details", size: "half", node: <Section title="Details"><KV items={[["Address", c.address || c.country ? <span className="whitespace-pre-line">{[c.address, c.country].filter(Boolean).join("\n")}</span> : "–"], ["VAT number", c.vat_number ?? "–"], ["E-mail", c.email ?? "–"], ["Note", c.notes ?? "–"]]} /></Section> },
      { id: "notes", title: "Notes", size: "half", node: <NotesSection party="customer" p={c} /> },
      { id: "health", title: "Health", size: "half", node: <CustomerHealth customerId={c.id} /> },
      { id: "reorders", title: "Reorder rhythm", node: <CustomerReorders customerId={c.id} /> },
      { id: "orders", title: "Orders", node: <Section title="Orders">
      <DataTable rows={orders} rowTo={o => orderPath(o)} empty="No orders yet" cols={[
        { key: "pi_number", header: "PI#", render: o => <span className="font-semibold text-gray-900">{o.pi_number ?? "draft"}</span> }, { key: "order_type", header: "Type" },
        { key: "po_date", header: "PO date", render: o => date(o.po_date) }, { key: "status", header: "Status", render: o => <StatusPill status={o.status} /> },
        { key: "total_receivable", header: "Total", align: "right", render: o => money(o.total_receivable, o.currency) },
        { key: "outstanding", header: "Outstanding", align: "right", render: o => money(o.outstanding, o.currency) },
        { key: "payment_status", header: "Payment", render: o => <PaymentPill status={o.payment_status} /> }]} />
    </Section> },
      { id: "tasks", title: "Tasks", size: "half", node: <TasksSection eq={{ customer_id: c.id }} hide={["customer"]} newLink={newTaskPath({ customer: slug, back: customerPath(c) })} /> },
      { id: "documents", title: "Documents", size: "half", node: <DocumentsSection entity="customers" id={c.id} /> },
    ]} />
  </>;
}

const customerFields: Field[] = [{ name: "name", label: "Customer", required: true }, { name: "vat_number", label: "VAT number", span: 1 },
  { name: "contact_name", label: "Contact", span: 1 }, { name: "email", label: "E-mail", span: 1 },
  ...addressFields("Address (on the PI)"),
  { name: "notes", label: "Note", type: "textarea", section: "Note" }];

export function CustomerForm() {
  const { slug } = useParams(); const { db } = useApp(); const { rows, loading } = useCustomers();
  const pts = useRows("payment_terms", { order: [["deposit_pct", "desc"], ["name", "asc"]] });
  const row = slug ? bySlug(rows, slug) : undefined;
  if (slug && !row) return loading ? <Loading /> : <NotFound what="Customer" back={{ to: "/customers", label: "All customers" }} />;
  if (pts.loading && !pts.rows.length) return <Loading />;
  // inactive terms are only offered when the customer still has one
  const opts = (current?: string) => pts.rows.filter(t => t.active || t.id === current).map(t => ({ value: t.id, label: `${t.name} (${termText(t)})` }));
  const named = (n: string) => pts.rows.find(t => t.name === n)?.id;
  const fields: Field[] = [...customerFields.slice(0, -1),
    { name: "exw_term", label: "EXW payment term", type: "select", options: opts(row?.exw?.payment_term_id), section: "Payment terms" },
    { name: "fob_term", label: "FOB payment term", type: "select", options: opts(row?.fob?.payment_term_id), section: "Payment terms", hint: "Terms are managed under Admin → Payment terms." },
    { name: "default_incoterm", label: "Usual delivery terms", type: "select", options: INCOTERM_OPTIONS, section: "Delivery",
      hint: "Filled in on new orders (can be changed per order). Empty = follows the order type: EXW or FOB." },
    customerFields[customerFields.length - 1]];
  return <FormPage title={row ? `Edit ${row.name}` : "New customer"} sub="A new term applies to new orders; existing orders keep the term they were created with (change it on the order)."
    back={row ? { to: customerPath(row), label: row.name } : { to: "/customers", label: "Customers" }} fields={fields}
    initial={row ? { ...row, exw_term: row.exw?.payment_term_id, fob_term: row.fob?.payment_term_id } : { exw_term: named("100% payment"), fob_term: named("30% deposit / 70% balance") }}
    onSubmit={async v => {
      const doSave = async () => {
      const { exw_term, fob_term, ...c } = v;
      c.default_incoterm = c.default_incoterm || null;
      const id = row ? (await db.update("customers", { id: row.id }, c), row.id) : (await db.insert("customers", c)).id;
      for (const [type, term] of [["EXW", exw_term], ["FOB", fob_term]] as const) {
        if (!term) continue;
        if (row?.[type.toLowerCase()]) await db.update("customer_terms", { customer_id: id, order_type: type }, { payment_term_id: term });
        else await db.insert("customer_terms", { customer_id: id, order_type: type, payment_term_id: term });
      }
      return customerPath({ name: c.name });
      };
      const sims = findSimilar(v.name ?? "", rows, row?.id);
      return sims.length && (!row || v.name !== row.name) ? similarWarning("customer", sims, customerPath, doSave) : doSave();
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
  const rec = s ? { type: "supplier" as const, id: s.id, label: s.name, path: supplierPath(s), sub: s.country ?? undefined } : null;
  useRecord(rec);
  if (!s) return loading ? <Loading /> : <NotFound what="Supplier" back={{ to: "/suppliers", label: "All suppliers" }} />;
  return <>
    <PageHeader back={{ to: "/suppliers", label: "Suppliers" }} title={<span className="flex items-center gap-2">{s.name}{rec && <FavoriteStar r={rec} />}</span>} sub={[s.country, s.contact_name, s.email].filter(Boolean).join(" · ") || undefined}>
      <LinkButton to={supplierPath(s, "/edit")} variant="outline"><Pencil />Edit</LinkButton></PageHeader>
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {[s.eur, s.usd].filter(Boolean).map(x => <Stat key={x.currency} label={`Still to pay ${x.currency}`} value={money(x.outstanding, x.currency)} tone={Number(x.overdue) > 0 ? "bad" : undefined} />)}
    </div>
    <div className="mb-6 grid gap-6 lg:grid-cols-2">
      <ContactsSection party="supplier" p={s} />
      <Section title="Terms"><KV items={[["EXW", sterms(s.exw)], ["FOB", sterms(s.fob)], ["Address", s.address || s.country ? <span className="whitespace-pre-line">{[s.address, s.country].filter(Boolean).join("\n")}</span> : "–"], ["Note", s.notes ?? "–"]]} /></Section>
    </div>
    <Section title="Purchase orders">
      <DataTable rows={pos} rowTo={p => poPath(p)} empty="No purchase orders yet" cols={[
        { key: "po_number", header: "PO#", render: p => <span className="font-semibold text-gray-900">{p.po_number}</span> }, { key: "pi_numbers", header: "For PI" },
        { key: "po_date", header: "PO date", render: p => date(p.po_date) }, { key: "payable", header: "To pay", align: "right", render: p => money(p.payable, p.currency) },
        { key: "outstanding", header: "Outstanding", align: "right", render: p => money(p.outstanding, p.currency) }]} />
    </Section>
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <NotesSection party="supplier" p={s} />
      <div className="space-y-6"><TasksSection eq={{ supplier_id: s.id }} hide={["supplier"]} newLink={newTaskPath({ supplier: slug, back: supplierPath(s) })} />
        <DocumentsSection entity="suppliers" id={s.id} /></div>
    </div>
  </>;
}

export function SupplierForm() {
  const { slug } = useParams(); const { db } = useApp(); const { rows, loading } = useSuppliers();
  const row = slug ? bySlug(rows, slug) : undefined;
  if (slug && !row) return loading ? <Loading /> : <NotFound what="Supplier" back={{ to: "/suppliers", label: "All suppliers" }} />;
  const cur = [{ value: "EUR", label: "EUR" }, { value: "USD", label: "USD" }];
  return <FormPage title={row ? `Edit ${row.name}` : "New supplier"} back={row ? { to: supplierPath(row), label: row.name } : { to: "/suppliers", label: "Suppliers" }}
    fields={[{ name: "name", label: "Supplier", required: true }, { name: "contact_name", label: "Contact", span: 1 }, { name: "email", label: "E-mail", span: 1 },
      ...addressFields("Address (on the PO)"),
      { name: "exw_currency", label: "EXW currency", type: "select", options: cur, span: 1, section: "Terms" }, { name: "exw_deposit", label: "EXW deposit %", type: "percent", span: 1, section: "Terms" },
      { name: "fob_currency", label: "FOB currency", type: "select", options: cur, span: 1, section: "Terms" }, { name: "fob_deposit", label: "FOB deposit %", type: "percent", span: 1, section: "Terms" },
      { name: "notes", label: "Note", type: "textarea", section: "Note" }]}
    initial={row ? { ...row, exw_currency: row.exw?.currency, exw_deposit: row.exw?.deposit_pct, fob_currency: row.fob?.currency, fob_deposit: row.fob?.deposit_pct } : { exw_currency: "EUR", fob_currency: "USD" }}
    onSubmit={async v => {
      const doSave = async () => {
      const { exw_currency, exw_deposit, fob_currency, fob_deposit, ...c } = v;
      const id = row ? (await db.update("suppliers", { id: row.id }, c), row.id) : (await db.insert("suppliers", c)).id;
      for (const [type, currency, dep] of [["EXW", exw_currency, exw_deposit], ["FOB", fob_currency, fob_deposit]] as const) {
        if (!currency) continue; const body = { currency, deposit_pct: dep ?? 0 };
        if (row?.[type.toLowerCase()]) await db.update("supplier_terms", { supplier_id: id, order_type: type }, body);
        else await db.insert("supplier_terms", { supplier_id: id, order_type: type, ...body });
      }
      return supplierPath({ name: c.name });
      };
      const sims = findSimilar(v.name ?? "", rows, row?.id);
      return sims.length && (!row || v.name !== row.name) ? similarWarning("supplier", sims, supplierPath, doSave) : doSave();
    }} />;
}

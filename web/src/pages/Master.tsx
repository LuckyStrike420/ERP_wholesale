import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { errorText, useApp, useRows } from "@/app/store";
import { ConfirmDialog, DataTable, FormDialog, PageHeader, Pill, Section, type Field } from "@/app/ui";
import { date, money, pct, qty, today } from "@/app/format";

const TYPES = ["EXW", "FOB"] as const;

export function Customers() {
  const { db, save } = useApp();
  const customers = useRows("customers", { order: [["name", "asc"]] }).rows; const terms = useRows("customer_terms").rows; const summary = useRows("v_customer_summary").rows;
  const [dlg, setDlg] = useState<null | { row?: any }>(null);
  const t = (id: string, type: string) => terms.find(x => x.customer_id === id && x.order_type === type);
  const s = (id: string, cur: string) => summary.find(x => x.customer_id === id && x.currency === cur);
  const rows = customers.map(c => ({ ...c, exw: t(c.id, "EXW"), fob: t(c.id, "FOB"), eur: s(c.id, "EUR"), usd: s(c.id, "USD") }));
  const fields: Field[] = [{ name: "name", label: "Customer", required: true }, { name: "country", label: "Country", span: 1 }, { name: "vat_number", label: "VAT number", span: 1 },
    { name: "contact_name", label: "Contact", span: 1 }, { name: "email", label: "E-mail", span: 1 },
    { name: "exw_deposit", label: "EXW deposit %", type: "percent", span: 1 }, { name: "exw_days", label: "EXW payment term (days)", type: "number", span: 1 },
    { name: "fob_deposit", label: "FOB deposit %", type: "percent", span: 1 }, { name: "fob_days", label: "FOB payment term (days)", type: "number", span: 1 }, { name: "notes", label: "Note", type: "textarea" }];
  return <>
    <PageHeader title="Customers" sub="One record per customer, with deposit and payment term per order type."><Button onClick={() => setDlg({})}><Plus className="mr-1 h-4 w-4" />New customer</Button></PageHeader>
    <Section title="Customers"><DataTable rows={rows} search exportName="customers" onRow={r => setDlg({ row: r })} cols={[
      { key: "name", header: "Customer", render: c => <b>{c.name}</b> }, { key: "country", header: "Country" }, { key: "contact_name", header: "Contact" },
      { key: "exw", header: "EXW terms", value: c => c.exw?.deposit_pct, render: c => c.exw ? `${pct(c.exw.deposit_pct, 0)} deposit · ${c.exw.payment_days} d` : "–" },
      { key: "fob", header: "FOB terms", value: c => c.fob?.deposit_pct, render: c => c.fob ? `${pct(c.fob.deposit_pct, 0)} deposit · ${c.fob.payment_days} d` : "–" },
      { key: "eur", header: "Order value €", align: "right", value: c => c.eur?.order_value, render: c => c.eur ? money(c.eur.order_value, "EUR") : "–" },
      { key: "usd", header: "Order value $", align: "right", value: c => c.usd?.order_value, render: c => c.usd ? money(c.usd.order_value, "USD") : "–" },
      { key: "oeur", header: "Open €", align: "right", value: c => c.eur?.outstanding, render: c => Number(c.eur?.outstanding) ? money(c.eur.outstanding, "EUR") : "–" },
      { key: "ousd", header: "Open $", align: "right", value: c => c.usd?.outstanding, render: c => Number(c.usd?.outstanding) ? money(c.usd.outstanding, "USD") : "–" },
      { key: "open", header: "Open orders", align: "right", value: c => (c.eur?.open_orders ?? 0) + (c.usd?.open_orders ?? 0), render: c => (c.eur?.open_orders ?? 0) + (c.usd?.open_orders ?? 0) || "–" }]} /></Section>
    <FormDialog open={!!dlg} onClose={() => setDlg(null)} title={dlg?.row ? "Edit customer" : "New customer"} fields={fields}
      description="New terms apply to new orders; existing orders keep the terms they were created with."
      initial={dlg?.row ? { ...dlg.row, exw_deposit: dlg.row.exw?.deposit_pct, exw_days: dlg.row.exw?.payment_days, fob_deposit: dlg.row.fob?.deposit_pct, fob_days: dlg.row.fob?.payment_days } : { exw_deposit: 1, exw_days: 0, fob_deposit: 0.3, fob_days: 0 }}
      onSubmit={v => save(async () => {
        const { exw_deposit, exw_days, fob_deposit, fob_days, ...c } = v;
        const id = dlg?.row ? (await db.update("customers", { id: dlg.row.id }, c), dlg.row.id) : (await db.insert("customers", c)).id;
        for (const [type, dep, days] of [["EXW", exw_deposit, exw_days], ["FOB", fob_deposit, fob_days]] as const) {
          const body = { deposit_pct: dep ?? 0, payment_days: days ?? 0 };
          if (dlg?.row && t(id, type)) await db.update("customer_terms", { customer_id: id, order_type: type }, body);
          else await db.insert("customer_terms", { customer_id: id, order_type: type, ...body });
        }
      }, "Customer saved")} />
  </>;
}

export function Suppliers() {
  const { db, save } = useApp();
  const suppliers = useRows("suppliers", { order: [["name", "asc"]] }).rows; const terms = useRows("supplier_terms").rows; const summary = useRows("v_supplier_summary").rows;
  const [dlg, setDlg] = useState<null | { row?: any }>(null);
  const t = (id: string, type: string) => terms.find(x => x.supplier_id === id && x.order_type === type);
  const s = (id: string, cur: string) => summary.find(x => x.supplier_id === id && x.currency === cur);
  const rows = suppliers.map(c => ({ ...c, exw: t(c.id, "EXW"), fob: t(c.id, "FOB"), eur: s(c.id, "EUR"), usd: s(c.id, "USD") }));
  const cur = [{ value: "EUR", label: "EUR" }, { value: "USD", label: "USD" }];
  const fields: Field[] = [{ name: "name", label: "Supplier", required: true }, { name: "country", label: "Country", span: 1 }, { name: "contact_name", label: "Contact", span: 1 }, { name: "email", label: "E-mail" },
    { name: "exw_currency", label: "EXW currency", type: "select", options: cur, span: 1 }, { name: "exw_deposit", label: "EXW deposit %", type: "percent", span: 1 },
    { name: "fob_currency", label: "FOB currency", type: "select", options: cur, span: 1 }, { name: "fob_deposit", label: "FOB deposit %", type: "percent", span: 1 }, { name: "notes", label: "Note", type: "textarea" }];
  return <>
    <PageHeader title="Suppliers" sub="One record per supplier or factory, with currency and deposit per order type."><Button onClick={() => setDlg({})}><Plus className="mr-1 h-4 w-4" />New supplier</Button></PageHeader>
    <Section title="Suppliers"><DataTable rows={rows} search exportName="suppliers" onRow={r => setDlg({ row: r })} cols={[
      { key: "name", header: "Supplier", render: c => <b>{c.name}</b> }, { key: "country", header: "Country" }, { key: "contact_name", header: "Contact" },
      { key: "exw", header: "EXW terms", value: c => c.exw?.deposit_pct, render: c => c.exw ? `${c.exw.currency} · ${pct(c.exw.deposit_pct, 0)} deposit` : "–" },
      { key: "fob", header: "FOB terms", value: c => c.fob?.deposit_pct, render: c => c.fob ? `${c.fob.currency} · ${pct(c.fob.deposit_pct, 0)} deposit` : "–" },
      { key: "oeur", header: "Open €", align: "right", value: c => c.eur?.outstanding, render: c => Number(c.eur?.outstanding) ? money(c.eur.outstanding, "EUR") : "–" },
      { key: "ousd", header: "Open $", align: "right", value: c => c.usd?.outstanding, render: c => Number(c.usd?.outstanding) ? money(c.usd.outstanding, "USD") : "–" }]} /></Section>
    <FormDialog open={!!dlg} onClose={() => setDlg(null)} title={dlg?.row ? "Edit supplier" : "New supplier"} fields={fields}
      initial={dlg?.row ? { ...dlg.row, exw_currency: dlg.row.exw?.currency, exw_deposit: dlg.row.exw?.deposit_pct, fob_currency: dlg.row.fob?.currency, fob_deposit: dlg.row.fob?.deposit_pct } : { exw_currency: "EUR", fob_currency: "USD" }}
      onSubmit={v => save(async () => {
        const { exw_currency, exw_deposit, fob_currency, fob_deposit, ...c } = v;
        const id = dlg?.row ? (await db.update("suppliers", { id: dlg.row.id }, c), dlg.row.id) : (await db.insert("suppliers", c)).id;
        for (const [type, currency, dep] of [["EXW", exw_currency, exw_deposit], ["FOB", fob_currency, fob_deposit]] as const) {
          if (!currency) continue; const body = { currency, deposit_pct: dep ?? 0 };
          if (dlg?.row && t(id, type)) await db.update("supplier_terms", { supplier_id: id, order_type: type }, body);
          else await db.insert("supplier_terms", { supplier_id: id, order_type: type, ...body });
        }
      }, "Supplier saved")} />
  </>;
}

export function Products() {
  const { db, save } = useApp();
  const products = useRows("products", { order: [["name", "asc"]] }).rows; const rules = useRows("product_cost_rules", { order: [["valid_from", "desc"]] }).rows;
  const suppliers = useRows("suppliers").rows; const kinds = useRows("product_kinds").rows; const stock = useRows("v_product_stock").rows; const sales = useRows("v_product_sales").rows;
  const [dlg, setDlg] = useState<null | { row?: any }>(null);
  const [costPreview, setCostPreview] = useState<null | { rows: any[]; go: () => void }>(null);
  // the rule that applies today (a version that starts later is not shown yet)
  const r = (id: string, type: string) => rules.find(x => x.product_id === id && x.order_type === type && x.valid_from <= today());
  const year = new Date().getFullYear();
  const sName = Object.fromEntries(suppliers.map(s => [s.id, s.name]));
  const rule = (x: any, cur: string) => !x || (x.cost_basis == null && x.share_above_basis == null) ? <Pill tone="amber">no rule</Pill>
    : x.cost_basis != null && x.share_above_basis == null ? `${money(x.cost_basis, cur, 2)} fixed`
    : x.cost_basis == null ? `${pct(x.share_above_basis, 0)} of sale price` : `${money(x.cost_basis, cur, 2)} + ${pct(x.share_above_basis, 0)} above`;
  const rows = products.map(p => ({ ...p, fob: r(p.id, "FOB"), exw: r(p.id, "EXW"), stock: stock.find(s => s.product_id === p.id)?.stock,
    units: sales.filter(s => s.product_id === p.id && s.year === year).reduce((a, s) => a + Number(s.units), 0) }));
  const fields: Field[] = [{ name: "name", label: "Product", required: true }, { name: "sku", label: "SKU", span: 1 }, { name: "kind", label: "Kind", type: "select", span: 1, options: kinds.map(k => ({ value: k.code, label: k.code })) },
    { name: "default_supplier_id", label: "Supplier", type: "select", options: suppliers.map(s => ({ value: s.id, label: s.name })) },
    ...TYPES.flatMap(t => { const c = t === "FOB" ? "$" : "€"; const k = t.toLowerCase(); return [
      { name: `${k}_basis`, label: `${t} cost basis (${c})`, type: "number", span: 1 }, { name: `${k}_share`, label: `${t} share above basis %`, type: "percent", span: 1 },
      { name: `${k}_royalty`, label: `${t} royalty per piece (${c})`, type: "number", span: 1 }] as Field[]; }),
    ...(dlg?.row ? [{ name: "cost_valid_from", label: "A changed cost rule is valid from", type: "date", span: 1, hint: "Earlier orders keep the old rule. Choose an earlier date only if you want to correct the past: you see the effect first." } as Field] : []),
    { name: "carton_dimensions", label: "Carton (L x W x H cm)", span: 1 }, { name: "carton_weight_kg", label: "Carton weight (kg)", type: "number", span: 1 }, { name: "units_per_carton", label: "Pieces per carton", type: "number", span: 1 },
    { name: "units_20ft", label: "Pieces 20ft", type: "number", span: 1 }, { name: "units_40ft", label: "Pieces 40ft", type: "number", span: 1 }, { name: "units_40hc", label: "Pieces 40HC", type: "number", span: 1 }, { name: "notes", label: "Note", type: "textarea" }];
  return <>
    <PageHeader title="Products" sub="Purchase price = basis + (sale price − basis) × share. Basis only is a fixed cost; share only is a percentage of the sale price."><Button onClick={() => setDlg({})}><Plus className="mr-1 h-4 w-4" />New product</Button></PageHeader>
    <Section title="Products"><DataTable rows={rows} search exportName="products" onRow={x => setDlg({ row: x })} cols={[
      { key: "name", header: "Product", render: p => <b>{p.name}</b> }, { key: "sku", header: "SKU" }, { key: "supplier", header: "Supplier", value: p => sName[p.default_supplier_id], render: p => sName[p.default_supplier_id] ?? "–" },
      { key: "fob", header: "FOB cost rule", value: p => p.fob?.cost_basis, render: p => rule(p.fob, "USD") }, { key: "exw", header: "EXW cost rule", value: p => p.exw?.cost_basis, render: p => rule(p.exw, "EUR") },
      { key: "stock", header: "NL stock", align: "right", render: p => Number(p.stock) ? qty(p.stock) : "–" }, { key: "units", header: `Sold ${year}`, align: "right", render: p => p.units ? qty(p.units) : "–" }]} /></Section>
    <FormDialog open={!!dlg} onClose={() => setDlg(null)} title={dlg?.row ? "Edit product" : "New product"} fields={fields}
      description="A changed cost rule is saved as a new version that starts on the chosen date; the old version stays. Orders with a supplier invoice or a completed status keep their final cost."
      initial={dlg?.row ? { ...dlg.row, ...Object.fromEntries(TYPES.flatMap(t => { const x = dlg.row[t.toLowerCase()]; const k = t.toLowerCase(); return [[`${k}_basis`, x?.cost_basis], [`${k}_share`, x?.share_above_basis], [`${k}_royalty`, x?.royalty_per_unit]]; })) } : {}}
      onSubmit={async v => {
        const p: any = {}; const rs: any = {}; const validFrom: string = v.cost_valid_from || today();
        for (const [k, x] of Object.entries(v)) { if (k === "cost_valid_from") continue; (/^(fob|exw)_/.test(k) ? rs : p)[k] = x; }
        const num = (x: any) => (x === null || x === undefined || x === "" ? null : Number(x));
        const bodyOf = (t: string) => { const k = t.toLowerCase(); return { cost_basis: num(rs[`${k}_basis`]), share_above_basis: num(rs[`${k}_share`]), royalty_per_unit: num(rs[`${k}_royalty`]) }; };
        const exOf = (t: string) => dlg?.row?.[t.toLowerCase()];
        const changedTypes = TYPES.filter(t => { const ex = exOf(t), b = bodyOf(t);
          return ex ? (num(ex.cost_basis) !== b.cost_basis || num(ex.share_above_basis) !== b.share_above_basis || num(ex.royalty_per_unit) !== b.royalty_per_unit) : false; });
        const doSave = () => save(async () => {
          const id = dlg?.row ? (await db.update("products", { id: dlg.row.id }, p), dlg.row.id) : (await db.insert("products", p)).id;
          for (const t of TYPES) { const body = bodyOf(t); const ex = exOf(t);
            if (ex) { if (!changedTypes.includes(t)) continue;
              if (ex.valid_from === validFrom) await db.update("product_cost_rules", { product_id: id, order_type: t, valid_from: validFrom }, body);
              else await db.insert("product_cost_rules", { product_id: id, order_type: t, valid_from: validFrom, ...body }); }
            else if (Object.values(body).some(x => x != null)) await db.insert("product_cost_rules", { product_id: id, order_type: t, ...body }); }
        }, "Product saved");
        if (!changedTypes.length) return doSave();
        let rows: any[] = [];
        try { for (const t of changedTypes) { const b = bodyOf(t);
          rows.push(...(await db.rpc<any[]>("preview_cost_rule_change", { p_product: dlg!.row.id, p_order_type: t, p_valid_from: validFrom, p_cost_basis: b.cost_basis, p_share: b.share_above_basis, p_royalty: b.royalty_per_unit })).map(x => ({ ...x, type: t }))); } }
        catch (e) { toast.error(errorText(e)); return false; }
        if (!rows.length) return doSave();
        setCostPreview({ rows, go: () => { doSave(); } });
      }} />
    <ConfirmDialog open={!!costPreview} onClose={() => setCostPreview(null)} title="This cost change moves existing margins" confirmLabel="Save the new cost rule"
      body={costPreview && <div className="space-y-2"><p>{costPreview.rows.length} order line(s) without final costs get another margin:</p>
        <div className="max-h-56 overflow-y-auto rounded border text-xs"><table className="w-full">
          <thead><tr className="border-b bg-muted/40 text-left"><th className="px-2 py-1">PI</th><th className="px-2 py-1">Customer</th><th className="px-2 py-1">Status</th><th className="px-2 py-1 text-right">Margin now</th><th className="px-2 py-1 text-right">Margin after</th></tr></thead>
          <tbody>{costPreview.rows.map((x, i) => <tr key={i} className="border-b last:border-0"><td className="px-2 py-1">{x.pi_number ?? "draft"}</td><td className="px-2 py-1">{x.customer_name}</td><td className="px-2 py-1">{x.status}</td>
            <td className="px-2 py-1 text-right">{money(x.margin_before, x.type === "FOB" ? "USD" : "EUR")}</td><td className="px-2 py-1 text-right font-semibold">{money(x.margin_after, x.type === "FOB" ? "USD" : "EUR")}</td></tr>)}</tbody></table></div>
        <p>Completed orders and orders with a supplier invoice are not affected.</p></div>}
      onConfirm={() => costPreview?.go()} />
  </>;
}

export function Prices() {
  const { db, save } = useApp();
  const prices = useRows("price_agreements").rows; const products = useRows("products", { order: [["name", "asc"]] }).rows; const customers = useRows("customers", { order: [["name", "asc"]] }).rows;
  const [dlg, setDlg] = useState<null | { row?: any }>(null);
  const pN = Object.fromEntries(products.map(p => [p.id, p.name])); const cN = Object.fromEntries(customers.map(c => [c.id, c.name]));
  const fields: Field[] = [{ name: "product_id", label: "Product", type: "select", required: true, options: products.map(p => ({ value: p.id, label: p.name })) },
    { name: "customer_id", label: "Customer (empty = standard price)", type: "select", options: customers.map(c => ({ value: c.id, label: c.name })) },
    { name: "order_type", label: "Type", type: "select", required: true, span: 1, options: TYPES.map(t => ({ value: t, label: t })) }, { name: "sale_price", label: "Sale price per piece", type: "number", required: true, span: 1 },
    { name: "agreed_cost", label: "Agreed purchase price", type: "number", span: 1, hint: "Empty = product rule" }, { name: "moq", label: "MOQ", type: "number", span: 1 },
    { name: "valid_from", label: "Valid from", type: "date", span: 1 }, { name: "valid_to", label: "Valid until", type: "date", span: 1 }, { name: "notes", label: "Note", type: "textarea" }];
  return <>
    <PageHeader title="Price agreements" sub="An agreement applies when product, customer, type and the exact sale price match on the order date."><Button onClick={() => setDlg({})}><Plus className="mr-1 h-4 w-4" />New agreement</Button></PageHeader>
    <Section title="Agreements"><DataTable rows={prices} search exportName="price-agreements" onRow={x => setDlg({ row: x })} empty="No price agreements yet" cols={[
      { key: "product", header: "Product", value: p => pN[p.product_id], render: p => <b>{pN[p.product_id]}</b> }, { key: "customer", header: "Customer", value: p => cN[p.customer_id], render: p => cN[p.customer_id] ?? <span className="text-muted-foreground">standard</span> },
      { key: "order_type", header: "Type" }, { key: "sale_price", header: "Sale price", align: "right", render: p => money(p.sale_price, p.order_type === "FOB" ? "USD" : "EUR") },
      { key: "agreed_cost", header: "Agreed cost", align: "right", render: p => p.agreed_cost == null ? "product rule" : money(p.agreed_cost, p.order_type === "FOB" ? "USD" : "EUR") },
      { key: "moq", header: "MOQ", align: "right", render: p => qty(p.moq) }, { key: "valid_from", header: "From", render: p => date(p.valid_from) }, { key: "valid_to", header: "Until", render: p => date(p.valid_to) },
      { key: "status", header: "", value: p => p.valid_to, render: p => p.valid_to && p.valid_to < today() ? <Pill tone="red">Expired</Pill> : <Pill tone="green">Active</Pill> }]} /></Section>
    <FormDialog open={!!dlg} onClose={() => setDlg(null)} title={dlg?.row ? "Edit agreement" : "New agreement"} fields={fields} initial={dlg?.row ?? { order_type: "FOB" }}
      onSubmit={v => save(() => dlg?.row ? db.update("price_agreements", { id: dlg.row.id }, v) : db.insert("price_agreements", v), "Agreement saved")} />
  </>;
}

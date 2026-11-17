/**
 * Products and price agreements: /products, /products/new, /products/clever-cane, /prices, /prices/new, /prices/1a2b3c4d
 */
import { Plus } from "lucide-react";
import { useApp, useRows } from "@/app/store";
import { useParams } from "@/app/router";
import { byShort, bySlug, pricePath, productPath } from "@/app/paths";
import { DataTable, FormPage, LinkButton, Loading, NotFound, PageHeader, Pill, Section, type Field } from "@/app/ui";
import { date, money, pct, qty, today } from "@/app/format";
import { FavoriteStar, useRecord } from "@/app/Favorites";
import { findSimilar } from "@/app/duplicates";
import { similarWarning } from "@/modules/parties/Parties";

const TYPES = ["EXW", "FOB"] as const;

function useProducts() {
  const products = useRows("products", { order: [["name", "asc"]] }); const rules = useRows("product_cost_rules", { order: [["valid_from", "desc"]] }).rows;
  const stock = useRows("v_product_stock").rows; const sales = useRows("v_product_sales").rows;
  const year = new Date().getFullYear();
  // the rule that applies today (a version that starts later is not shown yet)
  const r = (id: string, type: string) => rules.find(x => x.product_id === id && x.order_type === type && x.valid_from <= today());
  return { loading: products.loading, year, rows: products.rows.map(p => ({ ...p, fob: r(p.id, "FOB"), exw: r(p.id, "EXW"), stock: stock.find(s => s.product_id === p.id)?.stock,
    units: sales.filter(s => s.product_id === p.id && s.year === year).reduce((a, s) => a + Number(s.units), 0) })) };
}
const rule = (x: any, cur: string) => !x || (x.cost_basis == null && x.share_above_basis == null) ? <Pill tone="amber">no rule</Pill>
  : x.cost_basis != null && x.share_above_basis == null ? `${money(x.cost_basis, cur, 2)} fixed`
  : x.cost_basis == null ? `${pct(x.share_above_basis, 0)} of sale price` : `${money(x.cost_basis, cur, 2)} + ${pct(x.share_above_basis, 0)} above`;

export function Products() {
  const { rows, year } = useProducts(); const suppliers = useRows("suppliers").rows; const { db } = useApp();
  const field = (k: string) => (p: any, v: any) => db.update("products", { id: p.id }, { [k]: v });
  const sName = Object.fromEntries(suppliers.map(s => [s.id, s.name]));
  return <>
    <PageHeader title="Products" sub="Purchase price = basis + (sale price − basis) × share. Basis only is a fixed cost; share only is a percentage of the sale price."><LinkButton to="/products/new"><Plus />New product</LinkButton></PageHeader>
    <Section><DataTable rows={rows} search exportName="products" rowTo={p => productPath(p)} cols={[
      { key: "name", header: "Product", render: p => <div><div className="font-semibold text-gray-900">{p.name}</div><div className="text-xs text-gray-500">{[p.sku, sName[p.default_supplier_id]].filter(Boolean).join(" · ")}</div></div> },
      { key: "sku", header: "SKU", render: p => p.sku ?? <span className="text-gray-400">–</span>, edit: { kind: "text", save: field("sku") } },
      { key: "sale_price_fob", header: "Price FOB", align: "right", render: p => p.sale_price_fob != null ? money(p.sale_price_fob, "USD", 2) : <span className="text-gray-400">–</span>, edit: { kind: "number", save: field("sale_price_fob") } },
      { key: "sale_price_exw", header: "Price EXW", align: "right", render: p => p.sale_price_exw != null ? money(p.sale_price_exw, "EUR", 2) : <span className="text-gray-400">–</span>, edit: { kind: "number", save: field("sale_price_exw") } },
      { key: "units_per_carton", header: "Pcs/ctn", align: "right", render: p => p.units_per_carton ?? <span className="text-gray-400">–</span>, edit: { kind: "number", save: field("units_per_carton") } },
      { key: "fob", header: "FOB cost rule", value: p => p.fob?.cost_basis, render: p => rule(p.fob, "USD") }, { key: "exw", header: "EXW cost rule", value: p => p.exw?.cost_basis, render: p => rule(p.exw, "EUR") },
      { key: "stock", header: "NL stock", align: "right", render: p => Number(p.stock) ? qty(p.stock) : "–" }, { key: "units", header: `Sold ${year}`, align: "right", render: p => p.units ? qty(p.units) : "–" }]} /></Section>
  </>;
}

export function ProductForm() {
  const { slug } = useParams(); const { db } = useApp(); const { rows, loading } = useProducts();
  const suppliers = useRows("suppliers").rows; const kinds = useRows("product_kinds").rows;
  const row = slug ? bySlug(rows, slug) : undefined;
  const rec = row ? { type: "product" as const, id: row.id, label: row.name, path: productPath(row), sub: row.sku ?? undefined } : null;
  useRecord(rec);
  if (slug && !row) return loading ? <Loading /> : <NotFound what="Product" back={{ to: "/products", label: "All products" }} />;
  const fields: Field[] = [{ name: "name", label: "Product", required: true }, { name: "sku", label: "SKU", span: 1 }, { name: "kind", label: "Kind", type: "select", span: 1, options: kinds.map(k => ({ value: k.code, label: k.code })) },
    { name: "default_supplier_id", label: "Supplier", type: "select", options: suppliers.map(s => ({ value: s.id, label: s.name })) },
    { name: "sale_price_fob", label: "Standard sale price FOB ($)", type: "number", span: 1, section: "Standard sale price", hint: "Used on a new order when no price agreement applies" },
    { name: "sale_price_exw", label: "Standard sale price EXW (€)", type: "number", span: 1, section: "Standard sale price" },
    ...TYPES.flatMap(t => { const c = t === "FOB" ? "$" : "€"; const k = t.toLowerCase(); return [
      { name: `${k}_basis`, label: `${t} cost basis (${c})`, type: "number", span: 1, section: "Cost rules" }, { name: `${k}_share`, label: `${t} share above basis %`, type: "percent", span: 1, section: "Cost rules" },
      { name: `${k}_royalty`, label: `${t} royalty per piece (${c})`, type: "number", span: 1, section: "Cost rules" }] as Field[]; }),
    ...(row ? [{ name: "cost_valid_from", label: "A changed cost rule is valid from", type: "date", span: 1, section: "Cost rules", hint: "Earlier orders keep the old rule. Choose an earlier date only to correct the past: you see the effect first." } as Field] : []),
    { name: "units_per_carton", label: "Pieces per carton", type: "number", span: 1, section: "Packing", hint: "Used on packing lists: cartons, weights and CBM are worked out from these" },
    { name: "carton_net_kg", label: "Net weight per carton (kg)", type: "number", span: 1, section: "Packing" }, { name: "carton_weight_kg", label: "Gross weight per carton (kg)", type: "number", span: 1, section: "Packing" },
    { name: "carton_length_cm", label: "Carton length (cm)", type: "number", span: 1, section: "Packing" }, { name: "carton_width_cm", label: "Carton width (cm)", type: "number", span: 1, section: "Packing" },
    { name: "carton_height_cm", label: "Carton height (cm)", type: "number", span: 1, section: "Packing" }, { name: "units_20ft", label: "Pieces 20ft", type: "number", span: 1, section: "Packing" },
    { name: "units_40ft", label: "Pieces 40ft", type: "number", span: 1, section: "Packing" }, { name: "units_40hc", label: "Pieces 40HC", type: "number", span: 1, section: "Packing" },
    { name: "notes", label: "Note", type: "textarea", section: "Note" }];
  return <FormPage title={row ? <span className="flex items-center gap-2">{row.name}{rec && <FavoriteStar r={rec} />}</span> : "New product"} back={{ to: "/products", label: "Products" }} fields={fields}
    sub={row ? "A changed cost rule is saved as a new version from the chosen date; the old version stays. Orders with a supplier invoice or a completed status keep their final cost." : undefined}
    initial={row ? { ...row, ...Object.fromEntries(TYPES.flatMap(t => { const x = row[t.toLowerCase()]; const k = t.toLowerCase(); return [[`${k}_basis`, x?.cost_basis], [`${k}_share`, x?.share_above_basis], [`${k}_royalty`, x?.royalty_per_unit]]; })) } : {}}
    onSubmit={async v => {
      const p: any = {}; const rs: any = {}; const validFrom: string = v.cost_valid_from || today();
      for (const [k, x] of Object.entries(v)) { if (k === "cost_valid_from") continue; (/^(fob|exw)_/.test(k) ? rs : p)[k] = x; }
      const num = (x: any) => (x === null || x === undefined || x === "" ? null : Number(x));
      const bodyOf = (t: string) => { const k = t.toLowerCase(); return { cost_basis: num(rs[`${k}_basis`]), share_above_basis: num(rs[`${k}_share`]), royalty_per_unit: num(rs[`${k}_royalty`]) }; };
      const exOf = (t: string) => row?.[t.toLowerCase()];
      const changedTypes = TYPES.filter(t => { const ex = exOf(t), b = bodyOf(t);
        return ex ? (num(ex.cost_basis) !== b.cost_basis || num(ex.share_above_basis) !== b.share_above_basis || num(ex.royalty_per_unit) !== b.royalty_per_unit) : false; });
      const doSave = async () => {
        const id = row ? (await db.update("products", { id: row.id }, p), row.id) : (await db.insert("products", p)).id;
        for (const t of TYPES) { const body = bodyOf(t); const ex = exOf(t);
          if (ex) { if (!changedTypes.includes(t)) continue;
            if (ex.valid_from === validFrom) await db.update("product_cost_rules", { product_id: id, order_type: t, valid_from: validFrom }, body);
            else await db.insert("product_cost_rules", { product_id: id, order_type: t, valid_from: validFrom, ...body }); }
          else if (Object.values(body).some(x => x != null)) await db.insert("product_cost_rules", { product_id: id, order_type: t, ...body }); }
        return "/products";
      };
      if (!row) { const sims = findSimilar(v.name ?? "", rows); if (sims.length) return similarWarning("product", sims, productPath, doSave); }
      if (!changedTypes.length) return doSave();
      const preview: any[] = [];
      for (const t of changedTypes) { const b = bodyOf(t);
        preview.push(...(await db.rpc<any[]>("preview_cost_rule_change", { p_product: row!.id, p_order_type: t, p_valid_from: validFrom, p_cost_basis: b.cost_basis, p_share: b.share_above_basis, p_royalty: b.royalty_per_unit })).map(x => ({ ...x, type: t }))); }
      if (!preview.length) return doSave();
      return { confirm: { title: "This cost change moves existing margins", label: "Save the new cost rule", go: doSave,
        body: <div className="space-y-2"><p>{preview.length} order line(s) without final costs get another margin. Completed orders and orders with a supplier invoice are not affected.</p>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-amber-200 bg-white text-xs text-gray-800"><table className="w-full">
            <thead><tr className="border-b text-left text-gray-500"><th className="px-3 py-1.5">PI</th><th className="px-3 py-1.5">Customer</th><th className="px-3 py-1.5">Status</th><th className="px-3 py-1.5 text-right">Margin now</th><th className="px-3 py-1.5 text-right">Margin after</th></tr></thead>
            <tbody>{preview.map((x, i) => <tr key={i} className="border-b last:border-0"><td className="px-3 py-1.5">{x.pi_number ?? "draft"}</td><td className="px-3 py-1.5">{x.customer_name}</td><td className="px-3 py-1.5">{x.status}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{money(x.margin_before, x.type === "FOB" ? "USD" : "EUR")}</td><td className="px-3 py-1.5 text-right font-semibold tabular-nums">{money(x.margin_after, x.type === "FOB" ? "USD" : "EUR")}</td></tr>)}</tbody></table></div></div> } };
    }} />;
}

// ---------------- price agreements ----------------
export function Prices() {
  const prices = useRows("price_agreements").rows; const products = useRows("products").rows; const customers = useRows("customers").rows;
  const pN = Object.fromEntries(products.map(p => [p.id, p.name])); const cN = Object.fromEntries(customers.map(c => [c.id, c.name]));
  return <>
    <PageHeader title="Price agreements" sub="An agreement applies when product, customer, type and the exact sale price match on the order date."><LinkButton to="/prices/new"><Plus />New agreement</LinkButton></PageHeader>
    <Section><DataTable rows={prices} search exportName="price-agreements" rowTo={a => pricePath(a)} empty="No price agreements yet" cols={[
      { key: "product", header: "Product", value: p => pN[p.product_id], render: p => <span className="font-semibold text-gray-900">{pN[p.product_id]}</span> },
      { key: "customer", header: "Customer", value: p => cN[p.customer_id], render: p => cN[p.customer_id] ?? <span className="text-gray-400">standard</span> },
      { key: "order_type", header: "Type" }, { key: "sale_price", header: "Sale price", align: "right", render: p => money(p.sale_price, p.order_type === "FOB" ? "USD" : "EUR") },
      { key: "agreed_cost", header: "Agreed cost", align: "right", render: p => p.agreed_cost == null ? <span className="text-gray-400">product rule</span> : money(p.agreed_cost, p.order_type === "FOB" ? "USD" : "EUR") },
      { key: "moq", header: "MOQ", align: "right", render: p => qty(p.moq) }, { key: "valid_from", header: "From", render: p => date(p.valid_from) }, { key: "valid_to", header: "Until", render: p => date(p.valid_to) },
      { key: "status", header: "", value: p => p.valid_to, render: p => p.valid_to && p.valid_to < today() ? <Pill tone="red">Expired</Pill> : <Pill tone="green">Active</Pill> }]} /></Section>
  </>;
}

export function PriceForm() {
  const { id } = useParams(); const { db } = useApp();
  const prices = useRows("price_agreements"); const products = useRows("products", { order: [["name", "asc"]] }).rows; const customers = useRows("customers", { order: [["name", "asc"]] }).rows;
  const row = id ? byShort(prices.rows, id) : undefined;
  if (id && !row) return prices.loading ? <Loading /> : <NotFound what="Price agreement" back={{ to: "/prices", label: "All agreements" }} />;
  return <FormPage title={row ? "Edit price agreement" : "New price agreement"} back={{ to: "/prices", label: "Price agreements" }} initial={row ?? { order_type: "FOB" }}
    fields={[{ name: "product_id", label: "Product", type: "select", required: true, options: products.map(p => ({ value: p.id, label: p.name })) },
      { name: "customer_id", label: "Customer (empty = standard price)", type: "select", options: customers.map(c => ({ value: c.id, label: c.name })) },
      { name: "order_type", label: "Type", type: "select", required: true, span: 1, options: TYPES.map(t => ({ value: t, label: t })) }, { name: "sale_price", label: "Sale price per piece", type: "number", required: true, span: 1 },
      { name: "agreed_cost", label: "Agreed purchase price", type: "number", span: 1, hint: "Empty = product rule" }, { name: "moq", label: "MOQ", type: "number", span: 1, hint: "Only a warning below this quantity; it never changes a price" },
      { name: "valid_from", label: "Valid from", type: "date", span: 1 }, { name: "valid_to", label: "Valid until", type: "date", span: 1 }, { name: "notes", label: "Note", type: "textarea" }]}
    onSubmit={async v => { if (row) await db.update("price_agreements", { id: row.id }, v); else await db.insert("price_agreements", v); }} />;
}

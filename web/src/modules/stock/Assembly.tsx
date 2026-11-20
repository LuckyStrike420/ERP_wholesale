/**
 * Recipes and assembling. A finished product (e.g. Snake Complex) has a recipe: the components per piece
 * (1 box, 1 bottle, 1 dispenser, 1 label, 100 ml cream). Assembling uses the component batches you choose,
 * makes a new own-stock batch of the finished product at the cost of its components, and adds the assembler's fee.
 */
import { useMemo, useState } from "react";
import { Factory, Plus, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useRows } from "@/app/store";
import { Link, useNav, useQuery } from "@/app/router";
import { productPath } from "@/app/paths";
import { Combobox } from "@/app/Combobox";
import { ConfirmDialog, DataTable, LinkButton, Notice, PageHeader, Pill, Section, selectClass } from "@/app/ui";
import { date, money, qty, today } from "@/app/format";
import { toast } from "@/app/notify";
import { cn } from "@/lib/utils";
import { batchPath } from "./Batches";
import { stockTabs } from "./StockPages";
import { unitText } from "@/modules/purchasing/POLines";

const inputClass = "h-9 w-full rounded-md border border-gray-300 px-2.5 text-sm tabular-nums focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const n = (v: any) => (v === "" || v == null ? 0 : Number(v));

/** on the product page: what goes into one piece, and how many the stock still allows */
export function RecipeSection({ product }: { product: any }) {
  const { db, run } = useApp();
  const recipe = useRows("product_recipes", { eq: { product_id: product.id } }).rows;
  const products = useRows("products", { order: [["name", "asc"]] }).rows; const stock = useRows("v_product_stock").rows;
  const cap = useRows("v_recipe_capacity", { eq: { product_id: product.id } }).rows[0];
  const [c, setC] = useState(""); const [q, setQ] = useState("");
  const pr = (id: string) => products.find(p => p.id === id);
  const add = () => {
    if (!c) return toast.error("Choose a component"); if (!(n(q) > 0)) return toast.error("How much goes into one piece?");
    run(() => db.insert("product_recipes", { product_id: product.id, component_id: c, qty_per_unit: n(q) }), "Component added").then(r => { if (r !== undefined) { setC(""); setQ(""); } });
  };
  return <Section title="Recipe" sub="What goes into one piece of this product when it is assembled."
    action={recipe.length ? <LinkButton size="sm" variant="outline" to={`/stock/assemble?product=${product.id}`}><Factory />Assemble</LinkButton> : undefined}>
    <DataTable rows={recipe} empty="No recipe: this product is not assembled from components." cols={[
      { key: "component", header: "Component", value: r => pr(r.component_id)?.name, render: r => pr(r.component_id) ? <Link to={productPath(pr(r.component_id))} className="font-medium text-gray-900 hover:text-indigo-600">{pr(r.component_id).name}</Link> : "?" },
      { key: "qty_per_unit", header: "Per piece", align: "right", render: r => `${qty(r.qty_per_unit)} ${unitText(pr(r.component_id)?.unit)}`,
        edit: { kind: "number", save: (r, v) => db.update("product_recipes", { product_id: r.product_id, component_id: r.component_id }, { qty_per_unit: v }) } },
      { key: "stock", header: "In stock", align: "right", render: r => `${qty(stock.find(s => s.product_id === r.component_id)?.stock ?? 0)} ${unitText(pr(r.component_id)?.unit)}` },
      { key: "x", header: "", render: r => <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-rose-600" aria-label="Remove component"
        onClick={() => run(() => db.remove("product_recipes", { product_id: r.product_id, component_id: r.component_id }), "Component removed")}><Trash2 className="h-3.5 w-3.5" /></Button> }]} />
    <div className="grid grid-cols-[1fr_7rem_auto] items-end gap-2 border-t border-gray-100 px-5 py-3">
      <div><label className="mb-1 block text-xs font-medium text-gray-600">Component</label>
        <Combobox label="Component" value={c} onChange={v => setC(v ?? "")} options={products.filter(p => p.id !== product.id && !recipe.some(r => r.component_id === p.id)).map(p => ({ value: p.id, label: p.name, hint: p.kind ?? undefined }))} /></div>
      <div><label className="mb-1 block text-xs font-medium text-gray-600">Per piece{c ? ` (${unitText(pr(c)?.unit)})` : ""}</label>
        <input aria-label="Quantity per piece" inputMode="decimal" className={inputClass} value={q} onChange={e => setQ(e.target.value.replace(",", "."))} /></div>
      <Button onClick={add}><Plus />Add</Button>
    </div>
    {cap && <p className="border-t border-gray-100 px-5 py-2.5 text-sm text-gray-600">With the components in stock you can make <b className="tabular-nums text-gray-900">{qty(cap.can_make)}</b> piece{cap.can_make === 1 ? "" : "s"}{cap.limited_by ? <> · limited by <b>{cap.limited_by}</b></> : null}.</p>}
  </Section>;
}

// ---------------- list ----------------
export function Assemblies() {
  const { db, run } = useApp();
  const rows = useRows("v_assemblies", { order: [["assembled_on", "desc"], ["created_at", "desc"]] }).rows;
  const caps = useRows("v_recipe_capacity").rows; const products = useRows("products").rows;
  const [undo, setUndo] = useState<any>(null);
  return <><PageHeader title="NL stock" sub="Assembling finished products from components in our warehouse.">
      <LinkButton to="/stock/assemble"><Factory />Assemble</LinkButton></PageHeader>
    {stockTabs}
    {caps.length > 0 && <Section title="What the components allow" sub="Per product with a recipe: how many pieces the components in stock still make." className="mb-6">
      <DataTable dense rows={caps} cols={[
        { key: "product", header: "Product", value: r => products.find(p => p.id === r.product_id)?.name, render: r => { const p = products.find(x => x.id === r.product_id); return p ? <Link to={productPath(p)} className="font-medium text-gray-900 hover:text-indigo-600">{p.name}</Link> : "?"; } },
        { key: "can_make", header: "Can make", align: "right", render: r => <span className={cn("font-semibold tabular-nums", r.can_make === 0 ? "text-rose-600" : "text-gray-900")}>{qty(r.can_make)}</span> },
        { key: "limited_by", header: "Limited by" },
        { key: "go", header: "", render: r => <Link to={`/stock/assemble?product=${r.product_id}`} className="text-xs font-medium text-indigo-600 hover:underline">Assemble</Link> }]} />
    </Section>}
    <Section title="Assemblies">
      <DataTable rows={rows} rowTo={r => batchPath(r)} empty="Nothing assembled yet" cols={[
        { key: "assembled_on", header: "Date", render: r => date(r.assembled_on) },
        { key: "product_name", header: "Product", render: r => <span className="font-medium text-gray-900">{r.product_name}</span> },
        { key: "quantity", header: "Pieces", align: "right", render: r => qty(r.quantity) },
        { key: "batch_number", header: "Batch" },
        { key: "used", header: "Used", wrap: true, render: r => <span className="text-xs text-gray-600">{r.used}</span> },
        { key: "cost_per_unit", header: "Cost / pc", align: "right", render: r => <div>{money(r.cost_per_unit, "EUR", 3)}<div className="text-xs text-gray-500">{money(r.components_per_unit, "EUR", 3)} parts{Number(r.fee_per_unit) ? ` + ${money(r.fee_per_unit, "EUR", 3)} fee` : ""}</div></div> },
        { key: "supplier_name", header: "Assembler", render: r => r.supplier_name ?? "–" },
        { key: "x", header: "", render: r => <button type="button" onClick={e => { e.stopPropagation(); setUndo(r); }} className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-rose-600"><Undo2 className="h-3 w-3" />Undo</button> }]} />
    </Section>
    <ConfirmDialog open={!!undo} onClose={() => setUndo(null)} danger title={`Undo assembling ${undo?.quantity} × ${undo?.product_name}?`} confirmLabel="Undo"
      body={`Batch ${undo?.batch_number} is removed and the components go back into their batches. Only possible while nothing of it is sold or corrected.`}
      onConfirm={() => { const x = undo; run(() => db.rpc("undo_assembly", { p_assembly: x.id }), "Assembly undone"); }} />
  </>;
}

// ---------------- assemble ----------------
type Input = { key: string; component_id: string; batch_item_id: string; qty: string };

export function AssembleForm() {
  const { db, run } = useApp(); const nav = useNav(); const qp = useQuery();
  const products = useRows("products", { order: [["name", "asc"]] }).rows; const recipes = useRows("product_recipes").rows;
  const items = useRows("v_batch_item_stock").rows; const raw = useRows("batch_items").rows; const landed = useRows("v_batch_landed").rows;
  const suppliers = useRows("suppliers", { order: [["name", "asc"]] }).rows; const batches = useRows("batches").rows;
  const [product, setProduct] = useState(qp.get("product") ?? ""); const [pieces, setPieces] = useState("");
  const [batchNo, setBatchNo] = useState(""); const [when, setWhen] = useState(today());
  const [inputs, setInputs] = useState<Input[]>([]); const [touched, setTouched] = useState<string | null>(null);
  const [sup, setSup] = useState(""); const [fee, setFee] = useState(""); const [cur, setCur] = useState("EUR"); const [inv, setInv] = useState(""); const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false);

  const recipe = recipes.filter(r => r.product_id === product);
  const withRecipe = products.filter(p => recipes.some(r => r.product_id === p.id));
  const pr = (id: string) => products.find(p => p.id === id);
  const unitCost = (bi: string) => { const r = raw.find(x => x.id === bi); if (r?.cost_basis == null) return null; return Number(r.cost_basis) + Number(landed.find(l => l.batch_item_id === bi)?.per_unit_eur ?? 0); };
  const batchesOf = (comp: string) => items.filter(i => i.product_id === comp && Number(i.stock) > 0).sort((a, b) => String(a.received_date ?? "").localeCompare(String(b.received_date ?? "")));
  const need = (comp: string) => Number(recipe.find(r => r.component_id === comp)?.qty_per_unit ?? 0) * n(pieces);

  // a fresh row per component when the product or the number of pieces changes; a batch is pre-chosen only when there is just one
  const key = `${product}|${pieces}`;
  if (touched !== key && recipe.length) {
    setTouched(key);
    setInputs(recipe.map(r => { const own = batchesOf(r.component_id); const kept = inputs.find(i => i.component_id === r.component_id);
      return { key: r.component_id, component_id: r.component_id, batch_item_id: kept?.batch_item_id ?? (own.length === 1 ? own[0].batch_item_id : ""), qty: String(Math.round(need(r.component_id))) }; }));
  }
  const set = (k: string, patch: Partial<Input>) => setInputs(xs => xs.map(x => x.key === k ? { ...x, ...patch } : x));
  const used = (comp: string) => inputs.filter(i => i.component_id === comp).reduce((a, i) => a + n(i.qty), 0);
  const parts = inputs.reduce((a, i) => a + n(i.qty) * (unitCost(i.batch_item_id) ?? 0), 0);
  const unknown = inputs.some(i => i.batch_item_id && unitCost(i.batch_item_id) == null);
  const perUnit = n(pieces) ? parts / n(pieces) : 0; const feeUnit = n(pieces) ? n(fee) / n(pieces) : 0;
  const taken = batches.some(b => b.batch_number === batchNo.trim());
  const problems = useMemo(() => recipe.flatMap(r => {
    const rows = inputs.filter(i => i.component_id === r.component_id);
    const out: string[] = [];
    if (!rows.some(i => i.batch_item_id && n(i.qty) > 0)) out.push(`Choose a batch for ${pr(r.component_id)?.name}`);
    for (const i of rows) { const s = items.find(x => x.batch_item_id === i.batch_item_id); if (s && n(i.qty) > Number(s.stock)) out.push(`Batch ${s.batch_number} has only ${qty(s.stock)} of ${s.product_name}`); }
    return out; }), [recipe, inputs, items]);

  const go = async () => {
    if (!product) return toast.error("Choose a product"); if (!(n(pieces) > 0)) return toast.error("How many pieces?");
    if (!batchNo.trim()) return toast.error("Give the new batch a number"); if (problems.length) return toast.error(problems[0]);
    setBusy(true);
    const id = await run(() => db.rpc<string>("assemble", { p_product: product, p_qty: Math.round(n(pieces)), p_batch_number: batchNo.trim(), p_date: when,
      p_inputs: inputs.filter(i => i.batch_item_id && n(i.qty) > 0).map(i => ({ batch_item_id: i.batch_item_id, qty: n(i.qty) })),
      p_supplier: sup || null, p_cost: fee === "" ? null : n(fee), p_currency: cur, p_invoice: inv || null, p_notes: notes || null }), `${pieces} × ${pr(product)?.name} assembled`);
    setBusy(false); if (id) nav(batchPath({ batch_number: batchNo.trim() }));
  };

  return <>
    <PageHeader back={{ to: "/stock/assemblies", label: "Assemblies" }} title="Assemble" sub="Uses the components from the batches you choose and puts the finished product into a new batch as own stock." />
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-5">
        <Section title="What"><div className="grid gap-4 px-5 py-4 sm:grid-cols-4">
          <div className="sm:col-span-2"><label className="mb-1.5 block text-sm font-medium text-gray-700">Product</label>
            <Combobox label="Product" value={product} onChange={v => { setProduct(v ?? ""); setInputs([]); setTouched(null); }} options={withRecipe.map(p => ({ value: p.id, label: p.name }))} placeholder="A product with a recipe" />
            {!withRecipe.length && <p className="mt-1 text-xs text-gray-500">No product has a recipe yet. Add one on the product page.</p>}</div>
          <div><label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="pcs">Pieces</label>
            <input id="pcs" inputMode="numeric" className={inputClass} value={pieces} onChange={e => setPieces(e.target.value.replace(/[^\d]/g, ""))} /></div>
          <div><label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="on">Assembled on</label>
            <input id="on" type="date" className={inputClass} value={when} onChange={e => setWhen(e.target.value)} /></div>
          <div className="sm:col-span-2"><label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="nb">New batch#</label>
            <input id="nb" className={inputClass} value={batchNo} onChange={e => setBatchNo(e.target.value)} />
            {taken && <p className="mt-1 text-xs text-rose-600">This batch number already exists</p>}</div>
        </div></Section>

        {product && <Section title="Components" sub="Choose the batch each component comes from. The quantity follows the recipe; change it if more was used.">
          <table className="w-full text-sm"><thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500">
            <th className="px-5 py-2 font-medium">Component</th><th className="px-2 py-2 font-medium">From batch</th><th className="px-2 py-2 text-right font-medium">Quantity</th><th className="px-5 py-2 text-right font-medium">Cost</th></tr></thead>
            <tbody className="divide-y divide-gray-50">{inputs.map(i => { const c = pr(i.component_id); const opts = batchesOf(i.component_id); const uc = unitCost(i.batch_item_id);
              const first = inputs.find(x => x.component_id === i.component_id)?.key === i.key; const short = first && used(i.component_id) < need(i.component_id);
              return <tr key={i.key}>
                <td className="px-5 py-2 align-top">{first ? <><div className="font-medium text-gray-900">{c?.name}</div><div className={cn("text-xs", short ? "text-amber-600" : "text-gray-500")}>needs {qty(need(i.component_id))} {unitText(c?.unit)}{short ? ` · ${qty(used(i.component_id))} chosen` : ""}</div></> : <span className="text-xs text-gray-400">+ another batch</span>}</td>
                <td className="px-2 py-2 align-top"><select aria-label={`Batch for ${c?.name}`} className={selectClass + " w-full"} value={i.batch_item_id} onChange={e => set(i.key, { batch_item_id: e.target.value })}>
                  <option value="">{opts.length ? "Choose a batch…" : "None in stock"}</option>
                  {opts.map(o => <option key={o.batch_item_id} value={o.batch_item_id}>{o.batch_number} · {qty(o.stock)} {unitText(c?.unit)} in stock{o.received_date ? ` · ${date(o.received_date)}` : ""}</option>)}</select>
                  {first && <button type="button" className="mt-1 text-xs font-medium text-indigo-600 hover:underline" onClick={() => setInputs(xs => [...xs, { key: `${i.component_id}-${xs.length}`, component_id: i.component_id, batch_item_id: "", qty: String(Math.max(0, Math.round(need(i.component_id) - used(i.component_id)))) }])}>Split over another batch</button>}</td>
                <td className="px-2 py-2 align-top"><input aria-label={`Quantity of ${c?.name}`} inputMode="numeric" className={inputClass + " w-28 text-right"} value={i.qty} onChange={e => set(i.key, { qty: e.target.value.replace(/[^\d]/g, "") })} /></td>
                <td className="px-5 py-2 text-right align-top tabular-nums">{!i.batch_item_id ? "–" : uc == null ? <Pill tone="amber">no price</Pill> : <>{money(n(i.qty) * uc, "EUR")}<div className="text-xs text-gray-500">{money(uc, "EUR", 4)} / {unitText(c?.unit)}</div></>}</td>
              </tr>; })}</tbody></table>
          {problems.length > 0 && <div className="border-t border-gray-100 px-5 py-2.5 text-xs text-amber-700">{problems.join(" · ")}</div>}
        </Section>}

        {product && <Section title="Assembler" sub="The fee is added to what a piece costs (as a landed cost on the new batch)."><div className="grid gap-4 px-5 py-4 sm:grid-cols-4">
          <div className="sm:col-span-2"><label className="mb-1.5 block text-sm font-medium text-gray-700">Assembler</label>
            <Combobox label="Assembler" value={sup} onChange={v => setSup(v ?? "")} options={suppliers.map(s => ({ value: s.id, label: s.name }))} placeholder="Supplier who assembles" /></div>
          <div><label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="fee">Fee (total)</label>
            <input id="fee" inputMode="decimal" className={inputClass} value={fee} onChange={e => setFee(e.target.value.replace(",", "."))} /></div>
          <div><label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="cur">Currency</label>
            <select id="cur" className={selectClass + " w-full"} value={cur} onChange={e => setCur(e.target.value)}><option>EUR</option><option>USD</option></select></div>
          <div className="sm:col-span-2"><label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="inv">Invoice#</label>
            <input id="inv" className={inputClass} value={inv} onChange={e => setInv(e.target.value)} /></div>
          <div className="sm:col-span-2"><label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="nt">Note</label>
            <input id="nt" className={inputClass} value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div></Section>}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Section title="Cost per piece"><dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 px-5 py-4 text-sm">
          <dt className="text-gray-500">Components</dt><dd className="text-right tabular-nums">{money(perUnit, "EUR", 4)}</dd>
          <dt className="text-gray-500">Assembler fee</dt><dd className="text-right tabular-nums">{cur === "EUR" ? money(feeUnit, "EUR", 4) : `${money(feeUnit, cur, 4)}*`}</dd>
          <dt className="border-t border-gray-100 pt-1.5 font-semibold text-gray-900">Total</dt><dd className="border-t border-gray-100 pt-1.5 text-right font-semibold tabular-nums text-gray-900">{cur === "EUR" ? money(perUnit + feeUnit, "EUR", 4) : "–"}</dd>
        </dl>{cur !== "EUR" && <p className="border-t border-gray-100 px-5 py-2 text-xs text-gray-500">* converted to euros at the rate of the day</p>}</Section>
        {unknown && <Notice tone="amber">A chosen batch has no purchase price yet: it counts as €0. Set the price on that batch first for a correct cost.</Notice>}
        <Button className="w-full" onClick={go} disabled={busy || !product || taken}><Factory className="h-4 w-4" />{busy ? "Assembling…" : `Assemble${pieces ? ` ${qty(n(pieces))} pcs` : ""}`}</Button>
      </aside>
    </div>
  </>;
}

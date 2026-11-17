/**
 * New order on one screen (/orders/new, /orders/new?from=26185).
 * Choosing the customer fills in type, terms and the next PI#; choosing a product fills in the sale price
 * (customer agreement > standard agreement > product standard price) and shows NL stock. The figures on the
 * right come from the database (preview_order), the same calculation as for a saved order.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorText, useApp, useRows } from "@/app/store";
import { Link, useNav, useQuery } from "@/app/router";
import { findOrder, orderPath } from "@/app/paths";
import { Loading, Notice, PageHeader, Pill, Section, selectClass } from "@/app/ui";
import { date, money, pct, qty, SOURCE_LABEL, termText, today } from "@/app/format";
import { cn } from "@/lib/utils";
import { Combobox } from "@/app/Combobox";
import { quickCreate } from "@/app/quickCreate";

type Line = { key: number; product_id: string; quantity: string; unit_price: string; batch_item_id: string;
  touched: boolean; source: string | null; suggestion: { price: number; source: string; moq: number | null } | null };
const PRICE_SOURCE: Record<string, string> = { customer_agreement: "Customer agreement", standard_agreement: "Standard agreement", product_price: "Product price", copied: "From earlier order", manual: "Typed in" };
let keySeq = 1;
const blank = (): Line => ({ key: keySeq++, product_id: "", quantity: "", unit_price: "", batch_item_id: "", touched: false, source: null, suggestion: null });
const num = (s: string) => { const n = Number(String(s).replace(",", ".")); return String(s).trim() === "" || isNaN(n) ? null : n; };
const complete = (l: Line) => l.product_id && num(l.quantity) && num(l.quantity)! > 0 && num(l.unit_price) != null;

export default function OrderComposer() {
  const { db, refresh } = useApp(); const nav = useNav(); const q = useQuery();
  const fromRef = q.get("from");
  const customers = useRows("customers", { order: [["name", "asc"]] });
  const terms = useRows("customer_terms").rows;
  const payTerms = useRows("payment_terms", { order: [["deposit_pct", "desc"], ["name", "asc"]] }).rows;
  const products = useRows("products", { order: [["name", "asc"]] });
  const orders = useRows("v_orders", { order: [["po_date", "desc"]] });
  const stock = useRows("v_batch_item_stock").rows;
  const fromOrder = fromRef ? findOrder(orders.rows, fromRef) : undefined;
  const fromLines = useRows(fromOrder ? "v_order_lines" : null, { eq: { sales_order_id: fromOrder?.id }, order: [["line_no", "asc"]] });

  const [h, setH] = useState({ customer_id: "", order_type: "FOB", pi_number: "", customer_po: "", po_date: today(), notes: "", payment_term_id: "" });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [preview, setPreview] = useState<any>(null); const [calc, setCalc] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const prod = useMemo(() => Object.fromEntries(products.rows.map(p => [p.id, p])), [products.rows]);
  const nextPi = useMemo(() => { const n = orders.rows.map(o => Number(o.pi_number)).filter(Number.isInteger); return n.length ? String(Math.max(...n) + 1) : ""; }, [orders.rows]);
  const cur = h.order_type === "FOB" ? "USD" : "EUR";
  const lastOrder = h.customer_id ? orders.rows.find(o => o.customer_id === h.customer_id && o.status !== "cancelled") : undefined;
  const term = terms.find(t => t.customer_id === h.customer_id && t.order_type === h.order_type);
  // the order's term: chosen here, otherwise the customer's term for this type
  const termId = h.payment_term_id || term?.payment_term_id || "";
  const payTerm = payTerms.find(t => t.id === termId);

  // start: suggested PI#, or a copy of an earlier order
  useEffect(() => {
    if (started.current || orders.loading || products.loading || (fromRef && (fromLines.loading || !fromOrder))) return;
    started.current = true;
    if (fromOrder) {
      setH(x => ({ ...x, customer_id: fromOrder.customer_id, order_type: fromOrder.order_type, pi_number: nextPi }));
      setLines(fromLines.rows.length ? fromLines.rows.map(l => ({ ...blank(), product_id: l.product_id, quantity: String(l.quantity), unit_price: String(l.unit_price), touched: true, source: "copied" })) : [blank()]);
    } else setH(x => ({ ...x, pi_number: nextPi }));
  }, [orders.loading, products.loading, fromLines.loading, fromOrder, fromRef, nextPi, fromLines.rows]);

  const setLine = (key: number, patch: Partial<Line>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const pickCustomer = (id: string) => {
    const last = orders.rows.find(o => o.customer_id === id && o.status !== "cancelled");
    setH(x => ({ ...x, customer_id: id, order_type: last?.order_type ?? x.order_type, payment_term_id: "" }));
  };
  const copyFrom = async (o: any) => {
    try { const rows = await db.select<any>("v_order_lines", { eq: { sales_order_id: o.id }, order: [["line_no", "asc"]] });
      if (rows.length) setLines(rows.map(l => ({ ...blank(), product_id: l.product_id, quantity: String(l.quantity), unit_price: String(l.unit_price), touched: true, source: "copied" }))); }
    catch (e) { setErr(errorText(e)); }
  };

  // price suggestions: re-asked whenever product, quantity, customer, type or date changes
  const sugKey = JSON.stringify([h.customer_id, h.order_type, h.po_date, lines.map(l => [l.key, l.product_id, l.quantity])]);
  useEffect(() => {
    if (!h.customer_id) return;
    let live = true;
    const t = setTimeout(async () => {
      for (const l of lines) {
        if (!l.product_id) continue;
        try {
          const r = (await db.rpc<any[]>("suggest_sale_price", { p_product: l.product_id, p_customer: h.customer_id, p_order_type: h.order_type, p_date: h.po_date || null, p_qty: num(l.quantity) }))[0];
          if (!live) return;
          const s = r ? { price: Number(r.sale_price), source: r.source, moq: r.moq } : null;
          setLines(ls => ls.map(x => x.key !== l.key ? x : !x.touched && s ? { ...x, suggestion: s, unit_price: String(s.price), source: s.source } : { ...x, suggestion: s }));
        } catch { /* a suggestion is a help, never a blocker */ }
      }
    }, 250);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugKey, db]);

  // live figures from the database
  const ready = lines.filter(complete);
  const prevKey = JSON.stringify([h.customer_id, h.order_type, h.po_date, termId, ready.map(l => [l.key, l.product_id, l.quantity, l.unit_price, l.batch_item_id])]);
  useEffect(() => {
    if (!h.customer_id || !ready.length) { setPreview(null); return; }
    let live = true; setCalc(true);
    const t = setTimeout(async () => {
      try {
        const p = await db.rpc<any>("preview_order", { p_customer: h.customer_id, p_order_type: h.order_type, p_po_date: h.po_date || null, p_payment_term: termId || null,
          p_lines: ready.map(l => ({ idx: l.key, product_id: l.product_id, quantity: num(l.quantity), unit_price: num(l.unit_price), batch_item_id: l.batch_item_id || null })) });
        if (live) { setPreview(p); setErr(""); }
      } catch (e) { if (live) setErr(errorText(e)); } finally { if (live) setCalc(false); }
    }, 400);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevKey, db]);
  const pl = (key: number) => preview?.lines?.find((x: any) => x.idx === key);

  const submit = async () => {
    setErr("");
    if (!h.customer_id) return setErr("Choose the customer");
    const incomplete = lines.filter(l => (l.product_id || l.quantity || l.unit_price) && !complete(l));
    if (incomplete.length) return setErr("Every line needs a product, a quantity and a price (or remove the line)");
    if (!ready.length) return setErr("Add at least one order line");
    setBusy(true);
    try {
      const ref = await db.rpc<string>("create_order", { p_order: { ...h, payment_term_id: termId || null }, p_lines: ready.map(l => ({ product_id: l.product_id, quantity: num(l.quantity), unit_price: num(l.unit_price), batch_item_id: l.batch_item_id || null })) });
      refresh(); nav(`/orders/${encodeURIComponent(ref)}`);
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };

  if (customers.loading || products.loading || orders.loading || (fromRef && !started.current && fromLines.loading)) return <Loading />;
  const o = preview?.order;
  const missing = Number(o?.cost_missing_lines ?? 0);
  const below = (preview?.lines ?? []).filter((x: any) => x.below_basis).length;
  const moqWarn = lines.filter(l => l.suggestion?.moq && num(l.quantity) != null && num(l.quantity)! < l.suggestion.moq);

  return <>
    <PageHeader back={{ to: "/orders", label: "Orders" }} title="New order"
      sub={fromOrder ? <>Lines copied from <Link to={orderPath(fromOrder)} className="text-indigo-600 hover:underline">PI {fromOrder.pi_number}</Link>. Check quantities and prices.</> : "Choose the customer first: type, terms and prices are filled in for you."} />
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="min-w-0 space-y-5">
        <Section title="Customer and order">
          <div className="grid grid-cols-2 gap-x-5 gap-y-4 px-5 py-5 md:grid-cols-4">
            <div className="col-span-2">
              <Label htmlFor="customer" className="mb-1.5 block text-sm font-medium text-gray-700">Customer <span className="text-rose-600">*</span></Label>
              <Combobox id="customer" label="Customer" required value={h.customer_id || null} onChange={v => pickCustomer(v ?? "")} placeholder="Type a customer…"
                options={customers.rows.map(c => ({ value: c.id, label: c.name, hint: c.country ?? undefined }))}
                create={async t => { const id = await quickCreate(db, "customer", t); refresh(); return id; }} createNoun="customer" />
              {h.customer_id && <p className="mt-1.5 text-xs text-gray-500">{payTerm ? payTerm.name : term ? `${pct(term.deposit_pct, 0)} deposit` : "No payment term for this type"}
                {lastOrder && <> · last order <Link to={orderPath(lastOrder)} className="text-indigo-600 hover:underline">PI {lastOrder.pi_number ?? "draft"}</Link> on {date(lastOrder.po_date)}</>}</p>}
            </div>
            <div className="col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Type</span>
              <div className="inline-flex rounded-md border border-gray-300 p-0.5" role="radiogroup" aria-label="Order type">
                {[["FOB", "FOB · USD"], ["EXW", "EXW · EUR"]].map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={h.order_type === v} onClick={() => setH(x => ({ ...x, order_type: v, payment_term_id: "" }))}
                  className={cn("rounded px-3 py-1.5 text-sm font-medium transition-colors", h.order_type === v ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-100")}>{l}</button>)}
              </div>
            </div>
            <Field id="pi" label="PI#" value={h.pi_number} onChange={v => setH(x => ({ ...x, pi_number: v }))} hint={nextPi && h.pi_number === nextPi ? "Next free number" : "Empty = save as draft"} />
            <Field id="cpo" label="Customer PO#" value={h.customer_po} onChange={v => setH(x => ({ ...x, customer_po: v }))} />
            <Field id="date" label="PO date" type="date" value={h.po_date} onChange={v => setH(x => ({ ...x, po_date: v }))} />
            <div className="col-span-2 md:col-span-4">
              <Label htmlFor="term" className="mb-1.5 block text-sm font-medium text-gray-700">Payment term</Label>
              <select id="term" className={selectClass + " w-full"} value={termId} onChange={e => setH(x => ({ ...x, payment_term_id: e.target.value }))}>
                <option value="">–</option>{payTerms.filter(t => t.active || t.id === termId).map(t => <option key={t.id} value={t.id}>{t.name}{t.id === term?.payment_term_id ? " (customer's term)" : ""}</option>)}</select>
              {payTerm && <p className="mt-1.5 text-xs text-gray-500">{termText(payTerm)}</p>}
            </div>
          </div>
          {h.customer_id && lastOrder && !fromOrder && !lines.some(l => l.product_id) && <div className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/60 px-5 py-3 text-sm">
            <span className="text-gray-600">Same products as last time?</span>
            <Button size="sm" variant="outline" onClick={() => copyFrom(lastOrder)}><Copy className="h-3.5 w-3.5" />Copy lines from PI {lastOrder.pi_number}</Button></div>}
        </Section>

        <Section title="Order lines" action={<Button size="sm" variant="outline" onClick={() => setLines(ls => [...ls, blank()])}><Plus className="h-3.5 w-3.5" />Add line</Button>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/70 text-left text-xs text-gray-500">
                <th className="px-4 py-2.5 font-medium">Product</th><th className="w-28 px-2 py-2.5 text-right font-medium">Qty</th><th className="w-36 px-2 py-2.5 text-right font-medium">Price ({cur})</th>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium">NL stock</th><th className="px-2 py-2.5 text-right font-medium">Cost</th><th className="px-2 py-2.5 text-right font-medium">Margin</th><th className="w-10" /></tr></thead>
              <tbody>{lines.map(l => { const p = pl(l.key); const st = stock.filter(s => s.product_id === l.product_id && Number(s.stock) > 0);
                const differs = l.suggestion && num(l.unit_price) !== l.suggestion.price;
                return <tr key={l.key} className="border-b border-gray-100 align-top last:border-0">
                  <td className="px-4 py-2.5">
                    <Combobox label="Product" className="min-w-48" value={l.product_id || null} placeholder="Type a product…"
                      onChange={v => setLine(l.key, { product_id: v ?? "", touched: false, source: null, unit_price: "", suggestion: null, batch_item_id: "" })}
                      options={products.rows.map(x => ({ value: x.id, label: x.name, hint: x.sku ?? undefined, keywords: x.sku ?? "" }))}
                      create={async t => { const id = await quickCreate(db, "product", t); refresh(); return id; }} createNoun="product" />
                    {l.product_id && prod[l.product_id]?.sku && <div className="mt-1 text-xs text-gray-400">SKU {prod[l.product_id].sku}</div>}
                  </td>
                  <td className="px-2 py-2.5"><Input aria-label="Quantity" inputMode="decimal" value={l.quantity} onChange={e => setLine(l.key, { quantity: e.target.value })} className="h-9 border-gray-300 text-right" />
                    {l.suggestion?.moq && num(l.quantity) != null && num(l.quantity)! < l.suggestion.moq && <div className="mt-1 text-right text-xs text-amber-700">MOQ {qty(l.suggestion.moq)}</div>}</td>
                  <td className="px-2 py-2.5"><Input aria-label="Sale price" inputMode="decimal" value={l.unit_price} onChange={e => setLine(l.key, { unit_price: e.target.value, touched: true, source: "manual" })} className="h-9 border-gray-300 text-right" />
                    <div className="mt-1 text-right text-xs">{l.source && <span className="text-gray-400">{PRICE_SOURCE[l.source]}</span>}
                      {differs && <button type="button" className="ml-1 font-medium text-indigo-600 hover:underline" onClick={() => setLine(l.key, { unit_price: String(l.suggestion!.price), source: l.suggestion!.source, touched: false })}>
                        use {money(l.suggestion!.price, cur, 2)}</button>}
                      {l.product_id && !l.suggestion && !l.unit_price && <span className="text-gray-400">no agreed price</span>}</div></td>
                  <td className="px-2 py-2.5">{st.length ? <select aria-label="Batch" className={selectClass + " w-full min-w-40"} value={l.batch_item_id} onChange={e => setLine(l.key, { batch_item_id: e.target.value })}>
                      <option value="">Not from stock</option>{st.map(s => <option key={s.batch_item_id} value={s.batch_item_id}>{s.batch_number} · {qty(s.stock)} free</option>)}</select>
                    : <span className="whitespace-nowrap text-xs text-gray-400">{l.product_id ? "none" : ""}</span>}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{!p ? <span className="text-gray-300">–</span> : p.unit_cost == null ? <Pill tone="red">missing</Pill>
                    : <div>{money(p.unit_cost, cur, 3)}<div className="text-xs text-gray-400">{SOURCE_LABEL[p.cost_source]}</div></div>}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{!p ? <span className="text-gray-300">–</span>
                    : <div className={Number(p.margin) < 0 || p.below_basis ? "font-semibold text-rose-600" : "text-gray-900"}>{money(p.margin, cur)}<div className="text-xs font-normal text-gray-400">{p.margin_pct == null ? "incomplete" : pct(p.margin_pct)}</div></div>}</td>
                  <td className="py-2.5 pr-3"><Button size="icon" variant="ghost" aria-label="Remove line" className="h-8 w-8 text-gray-400 hover:text-rose-600" onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== l.key) : [blank()])}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                </tr>; })}</tbody>
            </table>
          </div>
        </Section>

        <Section title="Note"><div className="px-5 py-4"><Textarea aria-label="Note" rows={2} value={h.notes} onChange={e => setH(x => ({ ...x, notes: e.target.value }))} className="border-gray-300" /></div></Section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Section title="Order total" action={calc && <span className="text-xs text-gray-400">calculating…</span>}>
          <div className="space-y-2 px-5 py-4 text-sm">
            <Row label="Order value" value={o ? money(o.order_value, cur) : "–"} strong />
            <Row label="Purchase cost" value={o ? money(o.total_cost, cur) : "–"} />
            <Row label="Margin" value={o ? <span className={missing ? "text-amber-700" : ""}>{money(o.margin, cur)} · {o.margin_pct == null ? "incomplete" : pct(o.margin_pct)}</span> : "–"} />
            <div className="border-t border-gray-100 pt-2" />
            <Row label={`Deposit ${o ? pct(o.deposit_pct, 0) : term ? pct(term.deposit_pct, 0) : ""}`} value={o ? money(o.deposit_due, cur) : "–"} />
            {o?.deposit_due_date && <Row label="Deposit due" value={date(o.deposit_due_date)} />}
            <Row label="Balance" value={o ? money(o.balance_due, cur) : "–"} />
            {o?.balance_due_date && <Row label="Balance due" value={date(o.balance_due_date)} />}
          </div>
        </Section>
        {(missing > 0 || below > 0 || moqWarn.length > 0) && <Notice tone="amber" title="Check before saving">
          <ul className="space-y-1">
            {missing > 0 && <li>{missing} line(s) have no purchase price: the margin is incomplete.</li>}
            {below > 0 && <li>{below} line(s) are sold below the cost basis.</li>}
            {moqWarn.map(l => <li key={l.key}>{prod[l.product_id]?.name}: quantity below the MOQ of {qty(l.suggestion!.moq)}.</li>)}
          </ul></Notice>}
        {err && <Notice tone="rose"><span className="inline-flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{err}</span></Notice>}
        <div className="flex gap-2">
          <Button className="flex-1" onClick={submit} disabled={busy}>{busy ? "Saving…" : h.pi_number.trim() ? `Create PI ${h.pi_number.trim()}` : "Save as draft"}</Button>
          <Button variant="ghost" onClick={() => nav("/orders")}>Cancel</Button>
        </div>
        <p className="text-xs text-gray-500">Prices: customer agreement, then standard agreement, then the product's standard price. Purchase prices: override, batch, agreement, product rule.</p>
      </aside>
    </div>
  </>;
}

function Field({ id, label, value, onChange, type, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string }) {
  return <div className="col-span-2 sm:col-span-1">
    <Label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-700">{label}</Label>
    <Input id={id} type={type ?? "text"} value={value} onChange={e => onChange(e.target.value)} className="h-9 border-gray-300" />
    {hint && <p className="mt-1.5 text-xs text-gray-500">{hint}</p>}
  </div>;
}
const Row = ({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) =>
  <div className="flex items-baseline justify-between gap-3"><span className="text-gray-500">{label}</span><span className={cn("tabular-nums", strong ? "text-base font-semibold text-gray-900" : "text-gray-800")}>{value}</span></div>;

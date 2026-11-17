/**
 * /purchasing/2774/pdf: our purchase order to the supplier as an A4 document, in the same style as the PI.
 * Lines are the order lines linked to this PO, at the purchase price the system works out (the same figures as the PO page).
 * "Download PDF" opens the print dialog; choose "Save as PDF".
 */
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRows } from "@/app/store";
import { Link, useParams } from "@/app/router";
import { poPath, supplierPath } from "@/app/paths";
import { Loading, NotFound, Notice } from "@/app/ui";
import { date, money, pct, qty } from "@/app/format";

const unitPrice = (v: any, cur: string) => `${cur === "USD" ? "$" : cur === "EUR" ? "€" : cur + " "}${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

export function PurchaseOrderDocument() {
  const { po } = useParams();
  const { rows, loading } = useRows("v_purchase_orders", { eq: { po_number: po } }); const p = rows[0];
  const lines = useRows(p ? "v_order_lines" : null, { eq: { purchase_order_id: p?.id }, order: [["pi_number", "asc"], ["line_no", "asc"]] });
  const products = useRows("products").rows; const suppliers = useRows("suppliers").rows; const settings = useRows("app_settings").rows;
  if (!p) return loading ? <Loading /> : <NotFound what={`PO ${po}`} back={{ to: "/purchasing", label: "All purchase orders" }} />;
  if (lines.loading) return <Loading />;
  const set = (k: string) => (settings.find(s => s.key === k)?.value ?? "").trim();
  const sup = suppliers.find(s => s.id === p.supplier_id) ?? {};
  const prod = Object.fromEntries(products.map(x => [x.id, x]));
  const cur = p.currency;
  const shown = lines.rows.filter(l => l.counts_for_po && Number(l.qty) > 0);
  const unknown = shown.filter(l => l.unit_cost == null).length;
  const missing = ["company_name", "company_address"].filter(k => !set(k));

  return <>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
      <Link to={poPath(p)} className="text-sm text-gray-500 hover:text-gray-900">← PO {p.po_number}</Link>
      <Button onClick={() => window.print()}><Download className="h-4 w-4" />Download PDF</Button>
    </div>
    {missing.length > 0 && <Notice tone="amber" className="mb-3 print:hidden">Company details are missing on the document. Fill them in once under <Link to="/admin" className="font-medium underline">Admin → Settings</Link>.</Notice>}
    {!sup.address && <Notice tone="amber" className="mb-3 print:hidden">The supplier has no address yet. Add it under <Link to={supplierPath(sup, "/edit")} className="font-medium underline">Suppliers → {sup.name} → Edit</Link>.</Notice>}
    {unknown > 0 && <Notice tone="amber" className="mb-5 print:hidden">{unknown} line(s) have no purchase price yet: they show "to be confirmed" and are not in the total.</Notice>}
    <article className="mx-auto max-w-[210mm] bg-white px-[14mm] py-[14mm] text-[12.5px] leading-relaxed text-gray-800 shadow-sm ring-1 ring-gray-200 print:max-w-none print:p-0 print:shadow-none print:ring-0">
      <header className="flex items-start justify-between gap-8 border-b border-gray-200 pb-6">
        <div>
          <div className="text-lg font-semibold text-gray-900">{set("company_name") || <span className="text-gray-300">Company name</span>}</div>
          <div className="mt-1 whitespace-pre-line text-gray-600">{set("company_address")}</div>
          <div className="mt-1 whitespace-pre-line text-gray-500">{[set("company_contact"), set("company_vat")].filter(Boolean).join("\n")}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tracking-tight text-gray-900">PURCHASE ORDER</div>
          <dl className="mt-3 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5 text-gray-600">
            <dt>PO number</dt><dd className="font-semibold text-gray-900">{p.po_number}</dd>
            <dt>Date</dt><dd>{date(p.po_date)}</dd>
            <dt>Terms</dt><dd>{p.order_type}</dd>
            <dt>Currency</dt><dd>{cur}</dd>
          </dl>
        </div>
      </header>

      <section className="py-6">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Supplier</div>
        <div className="font-semibold text-gray-900">{sup.name}</div>
        {sup.address ? <div className="whitespace-pre-line">{sup.address}</div> : sup.country && <div>{sup.country}</div>}
        {sup.contact_name && <div className="text-gray-500">Attn. {sup.contact_name}{sup.email ? ` · ${sup.email}` : ""}</div>}
      </section>

      <table className="w-full">
        <thead><tr className="border-y border-gray-200 text-left text-[11px] uppercase tracking-wider text-gray-500">
          <th className="py-2 pr-2 font-semibold">#</th><th className="py-2 pr-2 font-semibold">Description</th><th className="py-2 pr-2 font-semibold">SKU</th>
          <th className="py-2 pr-2 text-right font-semibold">Qty</th><th className="py-2 pr-2 text-right font-semibold">Unit price</th><th className="py-2 text-right font-semibold">Amount</th></tr></thead>
        <tbody>{shown.map((l, i) => <tr key={l.id} className="border-b border-gray-100">
          <td className="py-2 pr-2 align-top text-gray-400">{i + 1}</td>
          <td className="py-2 pr-2 align-top text-gray-900">{prod[l.product_id]?.name}</td>
          <td className="py-2 pr-2 align-top text-gray-500">{prod[l.product_id]?.sku ?? ""}</td>
          <td className="py-2 pr-2 text-right align-top tabular-nums">{qty(l.qty)}</td>
          <td className="py-2 pr-2 text-right align-top tabular-nums">{l.unit_cost == null ? <span className="text-gray-400">to be confirmed</span> : unitPrice(l.unit_cost, cur)}</td>
          <td className="py-2 text-right align-top tabular-nums">{l.unit_cost == null ? "–" : money(l.purchase_value, cur)}</td></tr>)}</tbody>
      </table>

      <section className="mt-4 flex justify-end">
        <dl className="grid w-72 grid-cols-[1fr_auto] gap-x-6 gap-y-1">
          <dt className="font-semibold text-gray-900">Total {cur}</dt><dd className="text-right text-base font-semibold tabular-nums text-gray-900">{money(p.expected_amount, cur)}</dd>
        </dl>
      </section>

      <section className="mt-8 border-t border-gray-200 pt-6">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Payment</div>
        {Number(p.deposit_pct) > 0 && <div>{Number(p.deposit_pct) >= 1 ? "Payment" : `Deposit ${pct(p.deposit_pct, 0)}`}: <b className="tabular-nums">{money(p.deposit_due, cur)}</b>{p.deposit_due_date ? `, due ${date(p.deposit_due_date)}` : ""}</div>}
        {Number(p.deposit_pct) <= 0 && <div>Payment: <b className="tabular-nums">{money(p.expected_amount, cur)}</b>{p.balance_due_date ? `, due ${date(p.balance_due_date)}` : ""}</div>}
        {Number(p.deposit_pct) > 0 && Number(p.deposit_pct) < 1 && <div>Balance {pct(1 - Number(p.deposit_pct), 0)}{p.balance_due_date ? `, due ${date(p.balance_due_date)}` : ""}</div>}
        <div className="mt-1 text-gray-500">Please state PO {p.po_number} on your proforma invoice, invoice and shipping documents.</div>
        {p.notes && <div className="mt-3 whitespace-pre-line">{p.notes}</div>}
      </section>
    </article>
  </>;
}

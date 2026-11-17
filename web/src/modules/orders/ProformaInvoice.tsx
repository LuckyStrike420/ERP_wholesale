/**
 * /orders/:ref/pi: the proforma invoice as an A4 document; /orders/:ref/commercial-invoice: the same layout as the
 * commercial invoice (invoice number and date, received so far and the balance still due). "Download PDF" opens the browser's print dialog
 * (choose "Save as PDF"); only the document is printed, not the app around it.
 * Company details come from Admin → Settings (company_*); nothing is invented when they are empty.
 */
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRows } from "@/app/store";
import { Link, useParams } from "@/app/router";
import { orderPath } from "@/app/paths";
import { Loading, NotFound, Notice } from "@/app/ui";
import { date, money, pct, qty, termWhen } from "@/app/format";
import { useOrder } from "./data";

/** unit prices keep the decimals they were agreed with: $0.98, $0.845, $8.25 */
const unitPrice = (v: any, cur: string) => `${cur === "USD" ? "$" : "€"}${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

export default function ProformaInvoice() { return <SalesDocument kind="pi" />; }
export function CommercialInvoice() { return <SalesDocument kind="invoice" />; }

function SalesDocument({ kind }: { kind: "pi" | "invoice" }) {
  const { ref } = useParams(); const { o, loading } = useOrder(ref);
  const terms = useRows("payment_terms").rows;
  const id = o?.id ?? null;
  const lines = useRows(id && "v_order_lines", { eq: { sales_order_id: id }, order: [["line_no", "asc"]] });
  const products = useRows("products").rows; const customers = useRows("customers").rows;
  const settings = useRows("app_settings").rows; const adjustments = useRows(id && "order_adjustments", { eq: { sales_order_id: id } }).rows;
  const links = useRows(id && "shipment_orders", { eq: { sales_order_id: id } }).rows; const ships = useRows("v_shipments").rows;
  if (!o) return loading ? <Loading /> : <NotFound what={`Order ${ref}`} back={{ to: "/orders", label: "All orders" }} />;
  if (lines.loading) return <Loading />;
  const set = (k: string) => (settings.find(s => s.key === k)?.value ?? "").trim();
  const c = customers.find(x => x.id === o.customer_id) ?? {};
  const prod = Object.fromEntries(products.map(p => [p.id, p]));
  const ship = ships.find(s => links.some(l => l.shipment_id === s.id));
  const cur = o.currency; const missing = ["company_name", "company_address", "company_bank"].filter(k => !set(k));
  const term = terms.find(t => t.id === o.payment_term_id);
  const balanceWhen = term ? termWhen(term.balance_anchor, term.balance_days) : o.order_type === "FOB" ? "before shipment / 10 days before ETA" : o.payment_days ? `${o.payment_days} days after invoice` : "before pick-up";
  const depositWhen = term ? termWhen(term.deposit_anchor, term.deposit_days) : "on confirmation";
  const inv = kind === "invoice";
  if (inv && !o.invoice_number) return <Notice tone="amber">No invoice is registered on PI {o.pi_number} yet. <Link to={orderPath(o, "/invoice")} className="font-medium underline">Register the invoice</Link> first.</Notice>;
  const shownLines = lines.rows.filter(l => Number(l.qty) > 0);

  return <>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
      <Link to={orderPath(o)} className="text-sm text-gray-500 hover:text-gray-900">← PI {o.pi_number}</Link>
      <Button onClick={() => window.print()}><Download className="h-4 w-4" />Download PDF</Button>
    </div>
    {missing.length > 0 && <Notice tone="amber" className="mb-5 print:hidden">Company details are missing on the document ({missing.map(k => k.replace("company_", "")).join(", ")}). Fill them in once under <Link to="/admin" className="font-medium underline">Admin → Settings</Link>.</Notice>}
    <article className="mx-auto max-w-[210mm] bg-white px-[14mm] py-[14mm] text-[12.5px] leading-relaxed text-gray-800 shadow-sm ring-1 ring-gray-200 print:max-w-none print:p-0 print:shadow-none print:ring-0">
      <header className="flex items-start justify-between gap-8 border-b border-gray-200 pb-6">
        <div>
          <div className="text-lg font-semibold text-gray-900">{set("company_name") || <span className="text-gray-300">Company name</span>}</div>
          <div className="mt-1 whitespace-pre-line text-gray-600">{set("company_address")}</div>
          <div className="mt-1 whitespace-pre-line text-gray-500">{[set("company_contact"), set("company_vat")].filter(Boolean).join("\n")}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tracking-tight text-gray-900">{inv ? "COMMERCIAL INVOICE" : "PROFORMA INVOICE"}</div>
          <dl className="mt-3 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5 text-gray-600">
            {inv && <><dt>Invoice number</dt><dd className="font-semibold text-gray-900">{o.invoice_number}</dd></>}
            <dt>PI number</dt><dd className={inv ? "" : "font-semibold text-gray-900"}>{o.pi_number}</dd>
            <dt>Date</dt><dd>{date(inv ? o.invoice_date : o.pi_date ?? o.po_date)}</dd>
            {o.customer_po && <><dt>Your PO</dt><dd>{o.customer_po}</dd></>}
            <dt>Terms</dt><dd>{o.order_type}{o.order_type === "FOB" && ship?.port_loading ? ` ${ship.port_loading}` : ""}</dd>
            <dt>Currency</dt><dd>{cur}</dd>
          </dl>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-8 py-6">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Bill to</div>
          <div className="font-semibold text-gray-900">{c.name}</div>
          {c.address && <div className="whitespace-pre-line">{c.address}</div>}
          {!c.address && c.country && <div>{c.country}</div>}
          {c.vat_number && <div className="text-gray-500">VAT {c.vat_number}</div>}
          {c.contact_name && <div className="text-gray-500">Attn. {c.contact_name}{c.email ? ` · ${c.email}` : ""}</div>}
        </div>
        {ship && (ship.port_loading || ship.port_discharge) && <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Shipment</div>
          {ship.port_loading && <div>Port of loading: {ship.port_loading}</div>}
          {ship.port_discharge && <div>Port of discharge: {ship.port_discharge}</div>}
          {ship.etd && <div>ETD {date(ship.etd)}</div>}
        </div>}
      </section>

      <table className="w-full">
        <thead><tr className="border-y border-gray-200 text-left text-[11px] uppercase tracking-wider text-gray-500">
          <th className="py-2 pr-2 font-semibold">#</th><th className="py-2 pr-2 font-semibold">Description</th><th className="py-2 pr-2 font-semibold">SKU</th>
          <th className="py-2 pr-2 text-right font-semibold">Qty</th><th className="py-2 pr-2 text-right font-semibold">Unit price</th><th className="py-2 text-right font-semibold">Amount</th></tr></thead>
        <tbody>{shownLines.map((l, i) => <tr key={l.id} className="border-b border-gray-100">
          <td className="py-2 pr-2 align-top text-gray-400">{i + 1}</td>
          <td className="py-2 pr-2 align-top text-gray-900">{prod[l.product_id]?.name}{l.notes && <div className="text-gray-500">{l.notes}</div>}</td>
          <td className="py-2 pr-2 align-top text-gray-500">{prod[l.product_id]?.sku ?? ""}</td>
          <td className="py-2 pr-2 text-right align-top tabular-nums">{qty(l.qty)}</td>
          <td className="py-2 pr-2 text-right align-top tabular-nums">{unitPrice(l.unit_price, cur)}</td>
          <td className="py-2 text-right align-top tabular-nums">{money(l.revenue, cur)}</td></tr>)}</tbody>
      </table>

      <section className="mt-4 flex justify-end">
        <dl className="grid w-72 grid-cols-[1fr_auto] gap-x-6 gap-y-1">
          <dt className="text-gray-500">Subtotal</dt><dd className="text-right tabular-nums">{money(o.order_value, cur)}</dd>
          {adjustments.map(a => <div key={a.id} className="contents"><dt className="text-gray-500">{a.reason}</dt><dd className="text-right tabular-nums">{money(a.amount, cur)}</dd></div>)}
          <div className="col-span-2 my-1 border-t border-gray-300" />
          <dt className="font-semibold text-gray-900">Total {cur}</dt><dd className="text-right text-base font-semibold tabular-nums text-gray-900">{money(o.total_receivable, cur)}</dd>
          {inv && Number(o.paid) > 0 && <><dt className="text-gray-500">Received</dt><dd className="text-right tabular-nums">−{money(o.paid, cur)}</dd></>}
          {inv && Number(o.written_off) !== 0 && <><dt className="text-gray-500">Settled</dt><dd className="text-right tabular-nums">−{money(o.written_off, cur)}</dd></>}
          {inv && <><div className="col-span-2 my-1 border-t border-gray-300" /><dt className="font-semibold text-gray-900">Balance due</dt><dd className="text-right text-base font-semibold tabular-nums text-gray-900">{money(Math.max(Number(o.outstanding), 0), cur)}</dd></>}
        </dl>
      </section>

      <section className="mt-8 grid grid-cols-2 gap-8 border-t border-gray-200 pt-6">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Payment</div>
          {inv ? <>
            {Number(o.outstanding) > 0.01 ? <div>Please pay <b className="tabular-nums">{money(o.outstanding, cur)}</b>{o.balance_due_date ? ` by ${date(o.balance_due_date)}` : o.deposit_due_date && Number(o.deposit_outstanding) > 0.01 ? ` by ${date(o.deposit_due_date)}` : ""}.</div>
              : <div>Paid in full. Thank you.</div>}
            <div className="mt-1 text-gray-500">Please state invoice {o.invoice_number} with your payment.</div>
          </> : <>
            {Number(o.deposit_pct) > 0 && <div>{Number(o.deposit_pct) >= 1 ? "Payment" : `Deposit ${pct(o.deposit_pct, 0)}`}: <b className="tabular-nums">{money(o.deposit_due, cur)}</b>{o.deposit_due_date ? `, due ${date(o.deposit_due_date)}` : `, ${depositWhen}`}</div>}
            {Number(o.balance_due) > 0 && <div>Balance: <b className="tabular-nums">{money(o.balance_due, cur)}</b>{o.balance_due_date ? `, due ${date(o.balance_due_date)}` : `, ${balanceWhen}`}</div>}
            <div className="mt-1 text-gray-500">Please state PI {o.pi_number} with your payment.</div>
          </>}
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Bank details</div>
          <div className="whitespace-pre-line">{set("company_bank") || <span className="text-gray-300">Bank details</span>}</div>
        </div>
      </section>
      {set("pi_footer") && <footer className="mt-8 whitespace-pre-line border-t border-gray-200 pt-4 text-[11px] text-gray-500">{set("pi_footer")}</footer>}
    </article>
  </>;
}

/**
 * Packing list and delivery note, edited on the A4 page itself:
 *   /orders/26185/documents/new?type=packing_list   first version, filled from the order, its products and its shipment
 *   /orders/26185/documents/PL-26185                a saved document: change anything, save, print as PDF
 * Cartons, weights and CBM are worked out from pieces per carton and the carton data; a number typed over it wins
 * (clear the field to go back to the worked-out value). After saving the document is your own text: it does not
 * change when the order changes, unless you choose "Fill again from order".
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { toast } from "@/app/notify";
import { Button } from "@/components/ui/button";
import { errorText, useApp, useRows } from "@/app/store";
import { Link, useNav, useParams, useQuery } from "@/app/router";
import { orderPath } from "@/app/paths";
import { ConfirmDialog, Loading, NotFound, Notice } from "@/app/ui";
import { cn } from "@/lib/utils";
import { date as fmtDate } from "@/app/format";
import { useOrder } from "@/modules/orders/data";

export type DocType = "packing_list" | "delivery_note";
export const DOC_LABEL: Record<DocType, string> = { packing_list: "Packing list", delivery_note: "Delivery note" };
export const docPath = (o: { pi_number?: string | null; id: string }, number: string) => orderPath(o, `/documents/${encodeURIComponent(number)}`);

type Line = Record<string, any>;
interface Doc { id?: string; doc_type: DocType; doc_number: string; doc_date: string; shipment_id: string | null; header: Record<string, any>; lines: Line[] }

// ---------------- numbers ----------------
const n = (v: any) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
const parse = (s: string) => { const t = s.trim().replace(/\s/g, "").replace(",", "."); return t === "" ? null : isNaN(Number(t)) ? s : Number(t); };
const fmt = (v: any, dp: number) => v === null || v === undefined ? "" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp });
/** worked-out values of a line; a typed value (not null) wins */
export function calc(l: Line) {
  const qty = n(l.qty), upc = n(l.units_per_carton);
  const autoCartons = qty != null && upc ? Math.ceil(qty / upc) : null;
  const cartons = n(l.cartons) ?? autoCartons;
  const vol = n(l.length_cm) && n(l.width_cm) && n(l.height_cm) ? n(l.length_cm)! * n(l.width_cm)! * n(l.height_cm)! / 1e6 : null;
  const auto = {
    cartons: autoCartons,
    net_kg: cartons != null && n(l.net_kg_carton) != null ? Math.round(cartons * n(l.net_kg_carton)! * 100) / 100 : null,
    gross_kg: cartons != null && n(l.gross_kg_carton) != null ? Math.round(cartons * n(l.gross_kg_carton)! * 100) / 100 : null,
    cbm: cartons != null && vol != null ? Math.round(cartons * vol * 1000) / 1000 : null,
  };
  return { auto, cartons, net_kg: n(l.net_kg) ?? auto.net_kg, gross_kg: n(l.gross_kg) ?? auto.gross_kg, cbm: n(l.cbm) ?? auto.cbm };
}
const dims = (l: Line) => [l.length_cm, l.width_cm, l.height_cm].every(x => n(x) != null) ? `${fmt(l.length_cm, 1)}×${fmt(l.width_cm, 1)}×${fmt(l.height_cm, 1)}` : "";

// ---------------- editable pieces of the page ----------------
const field = "w-full min-w-0 rounded-sm bg-transparent px-0.5 outline-none transition-colors hover:bg-amber-50 focus:bg-amber-50 focus:ring-1 focus:ring-amber-300 print:px-0 print:hover:bg-transparent placeholder:text-gray-300 print:placeholder:text-transparent";
function Ed({ value, onChange, placeholder, className, align, label }: { value: any; onChange: (v: string) => void; placeholder?: string; className?: string; align?: "right"; label?: string }) {
  return <input aria-label={label ?? placeholder} value={value ?? ""} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={cn(field, align === "right" && "text-right tabular-nums", className)} />;
}
function EdArea({ value, onChange, placeholder, className, label }: { value: any; onChange: (v: string) => void; placeholder?: string; className?: string; label?: string }) {
  const rows = Math.max(1, String(value ?? "").split("\n").length);
  return <textarea aria-label={label ?? placeholder} value={value ?? ""} placeholder={placeholder} rows={rows} onChange={e => onChange(e.target.value)} className={cn(field, "block resize-none overflow-hidden", className)} />;
}
/** a whole number shown as 1,518; commas typed in are ignored */
function IntEd({ value, onChange, label, placeholder }: { value: any; onChange: (v: number | null) => void; label: string; placeholder?: string }) {
  return <input aria-label={label} inputMode="numeric" value={n(value) != null ? fmt(value, 3) : value ?? ""} placeholder={placeholder}
    onChange={e => { const t = e.target.value.replace(/[,\s]/g, ""); onChange(t === "" || isNaN(Number(t)) ? null : Number(t)); }} className={cn(field, "text-right tabular-nums")} />;
}
/** a number that is worked out until you type over it */
function AutoNum({ value, auto, onChange, dp, label }: { value: any; auto: number | null; onChange: (v: any) => void; dp: number; label: string }) {
  const typed = n(value) != null;
  return <input aria-label={label} value={typed ? String(value) : fmt(auto, dp)} placeholder="–" title={typed ? "Typed in. Clear to go back to the worked-out value." : auto != null ? "Worked out from the carton data" : undefined}
    onChange={e => { const v = parse(e.target.value); onChange(typeof v === "number" ? v : null); }}
    className={cn(field, "text-right tabular-nums", typed ? "font-medium text-gray-900 underline decoration-indigo-300 decoration-dotted underline-offset-2 print:no-underline" : "text-gray-700")} />;
}
const Label = ({ children }: { children: ReactNode }) => <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-gray-400">{children}</div>;
function Pair({ k, children }: { k: string; children: ReactNode }) { return <><dt className="whitespace-nowrap pt-px text-gray-500">{k}</dt><dd className="min-w-0">{children}</dd></>; }

// ---------------- page ----------------
export function ShippingDocumentNew() {
  const { ref } = useParams(); const q = useQuery(); const { db } = useApp();
  const { o, loading } = useOrder(ref);
  const type = (q.get("type") === "delivery_note" ? "delivery_note" : "packing_list") as DocType;
  const [draft, setDraft] = useState<Doc | null>(null); const [err, setErr] = useState("");
  useEffect(() => {
    if (!o) return;
    db.rpc<any>("draft_document", { p_order: o.id, p_type: type })
      .then(d => setDraft({ doc_type: type, doc_number: d.doc_number, doc_date: d.doc_date, shipment_id: d.shipment_id, header: d.header ?? {}, lines: d.lines ?? [] }))
      .catch(e => setErr(errorText(e)));
  }, [o?.id, type, db]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) return loading ? <Loading /> : <NotFound what={`Order ${ref}`} back={{ to: "/orders", label: "All orders" }} />;
  if (err) return <Notice tone="rose">{err}</Notice>;
  if (!draft) return <Loading what="Filling in from the order…" />;
  return <Editor o={o} initial={draft} />;
}

export function ShippingDocumentEdit() {
  const { ref, doc } = useParams(); const { o, loading } = useOrder(ref);
  const docs = useRows(o ? "generated_documents" : null, { eq: { sales_order_id: o?.id } });
  if (!o) return loading ? <Loading /> : <NotFound what={`Order ${ref}`} back={{ to: "/orders", label: "All orders" }} />;
  const d = docs.rows.find(x => x.doc_number === doc);
  if (!d) return docs.loading ? <Loading /> : <NotFound what={`Document ${doc}`} back={{ to: orderPath(o), label: `PI ${o.pi_number ?? ""}` }} />;
  return <Editor key={d.id + d.updated_at} o={o} initial={{ ...d, header: d.header ?? {}, lines: d.lines ?? [] }} />;
}

function Editor({ o, initial }: { o: any; initial: Doc }) {
  const { db, refresh } = useApp(); const nav = useNav();
  const settings = useRows("app_settings").rows;
  const [d, setD] = useState<Doc>(initial); const [dirty, setDirty] = useState(!initial.id); const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<null | "delete" | "refill">(null);
  const set = (k: keyof Doc, v: any) => { setD(x => ({ ...x, [k]: v })); setDirty(true); };
  const h = (k: string) => d.header?.[k] ?? "";
  const setH = (k: string) => (v: any) => { setD(x => ({ ...x, header: { ...x.header, [k]: v } })); setDirty(true); };
  const setL = (i: number, k: string, v: any) => { setD(x => ({ ...x, lines: x.lines.map((l, j) => j === i ? { ...l, [k]: v } : l) })); setDirty(true); };
  const pl = d.doc_type === "packing_list";
  const company = (k: string) => (settings.find(s => s.key === k)?.value ?? "").trim();
  const rows = useMemo(() => d.lines.map(l => ({ l, c: calc(l) })), [d.lines]);
  const total = (k: "cartons" | "net_kg" | "gross_kg" | "cbm") => rows.some(r => r.c[k] != null) ? rows.reduce((a, r) => a + (r.c[k] ?? 0), 0) : null;
  const totalQty = rows.reduce((a, r) => a + (n(r.l.qty) ?? 0), 0);

  // warn before leaving with unsaved changes
  useEffect(() => { if (!dirty) return; const f = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener("beforeunload", f); return () => window.removeEventListener("beforeunload", f); }, [dirty]);

  const save = async (): Promise<boolean> => {
    if (!d.doc_number.trim()) { toast.error("The document needs a number"); return false; }
    setBusy(true);
    const body = { doc_type: d.doc_type, doc_number: d.doc_number.trim(), doc_date: d.doc_date || null, shipment_id: d.shipment_id, header: d.header, lines: d.lines };
    try {
      if (d.id) await db.update("generated_documents", { id: d.id }, body);
      else { const r = await db.insert<any>("generated_documents", { ...body, sales_order_id: o.id }); setD(x => ({ ...x, id: r.id })); }
      setDirty(false); refresh(); toast.success(`${DOC_LABEL[d.doc_type]} saved`);
      if (!d.id || body.doc_number !== initial.doc_number) nav(docPath(o, body.doc_number), { replace: true });
      return true;
    } catch (e) { toast.error(errorText(e), { duration: 9000 }); return false; } finally { setBusy(false); }
  };
  // a new document moves to its own address when saved, so it is printed from there
  const print = async () => {
    if (dirty) { const wasNew = !d.id; if (!(await save())) return; if (wasNew) { toast("Saved. Choose Print / PDF again to print it."); return; } }
    window.print();
  };
  const refill = async () => {
    try { const r = await db.rpc<any>("draft_document", { p_order: o.id, p_type: d.doc_type });
      setD(x => ({ ...x, shipment_id: r.shipment_id, header: r.header, lines: r.lines })); setDirty(true); toast.success("Filled in again from the order: save to keep it"); }
    catch (e) { toast.error(errorText(e)); }
  };

  return <>
    <div className="sticky top-0 z-20 -mx-4 mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 print:hidden">
      <div className="flex items-center gap-3">
        <Link to={orderPath(o)} className="text-sm text-gray-500 hover:text-gray-900">← PI {o.pi_number ?? "draft"}</Link>
        <span className="text-sm font-semibold text-gray-900">{DOC_LABEL[d.doc_type]} {d.doc_number}</span>
        <span className={cn("text-xs", dirty ? "text-amber-700" : "text-gray-400")}>{dirty ? (d.id ? "Unsaved changes" : "Not saved yet") : "Saved"}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={() => setAsk("refill")}><RotateCcw className="h-3.5 w-3.5" />Fill again from order</Button>
        {d.id && <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => setAsk("delete")}><Trash2 className="h-3.5 w-3.5" />Delete</Button>}
        <Button variant="outline" onClick={print} disabled={busy}><Download className="h-4 w-4" />Print / PDF</Button>
        <Button onClick={save} disabled={busy || !dirty}><Save className="h-4 w-4" />{busy ? "Saving…" : "Save"}</Button>
      </div>
    </div>
    <p className="mx-auto mb-3 max-w-[210mm] text-xs text-gray-500 print:hidden">Click any text on the document to change it.{pl && " Cartons, weights and CBM are worked out from the carton data of each product; type over a number to change it, clear it to go back."}</p>

    <article className="mx-auto max-w-[210mm] bg-white px-[14mm] py-[14mm] text-[11.5px] leading-snug text-gray-800 shadow-sm ring-1 ring-gray-200 print:max-w-none print:p-0 print:shadow-none print:ring-0">
      <header className="flex items-start justify-between gap-8 border-b border-gray-200 pb-5">
        <div className="min-w-0 flex-1">
          <Label>{pl ? "Shipper" : "From"}</Label>
          <EdArea label="Shipper" value={h("shipper")} onChange={setH("shipper")} placeholder="Company name and address (Admin → Settings)" className="font-medium text-gray-900" />
          {company("company_contact") && <div className="mt-1 whitespace-pre-line text-gray-500">{company("company_contact")}</div>}
        </div>
        <div className="w-64 text-right">
          <div className="text-2xl font-semibold tracking-tight text-gray-900">{pl ? "PACKING LIST" : "DELIVERY NOTE"}</div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-left">
            <Pair k="Number"><Ed label="Document number" value={d.doc_number} onChange={v => set("doc_number", v)} className="text-right font-semibold text-gray-900" /></Pair>
            <Pair k="Date"><input type="date" aria-label="Document date" value={d.doc_date ?? ""} onChange={e => set("doc_date", e.target.value)} className={cn(field, "text-right print:hidden")} />
              <span className="hidden text-right print:block">{fmtDate(d.doc_date)}</span></Pair>
            <Pair k="PI number"><Ed label="PI number" value={h("pi_number")} onChange={setH("pi_number")} align="right" /></Pair>
            <Pair k="Your PO"><Ed label="Customer PO" value={h("customer_po")} onChange={setH("customer_po")} align="right" /></Pair>
            {pl && <Pair k="Terms"><Ed label="Terms" value={h("terms")} onChange={setH("terms")} align="right" /></Pair>}
          </dl>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-8 py-5">
        <div>
          <Label>{pl ? "Consignee" : "Deliver to"}</Label>
          {pl ? <EdArea label="Consignee" value={h("consignee")} onChange={setH("consignee")} placeholder="Name and address" className="text-gray-900" />
            : <EdArea label="Deliver to" value={h("deliver_to")} onChange={setH("deliver_to")} placeholder="Name and delivery address" className="text-gray-900" />}
          {!pl && <div className="mt-3"><Label>Customer</Label><EdArea label="Customer" value={h("consignee")} onChange={setH("consignee")} placeholder="Customer name and address" /></div>}
        </div>
        <div>
          <Label>{pl ? "Shipment" : "Delivery"}</Label>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {pl ? <>
              <Pair k="Forwarder"><Ed label="Forwarder" value={h("forwarder")} onChange={setH("forwarder")} placeholder="–" /></Pair>
              <Pair k="Container"><Ed label="Container" value={h("container_number")} onChange={setH("container_number")} placeholder="–" /></Pair>
              <Pair k="Seal"><Ed label="Seal" value={h("seal_number")} onChange={setH("seal_number")} placeholder="–" /></Pair>
              <Pair k="B/L"><Ed label="BL number" value={h("bl_number")} onChange={setH("bl_number")} placeholder="–" /></Pair>
              <Pair k="Port of loading"><Ed label="Port of loading" value={h("port_loading")} onChange={setH("port_loading")} placeholder="–" /></Pair>
              <Pair k="Port of discharge"><Ed label="Port of discharge" value={h("port_discharge")} onChange={setH("port_discharge")} placeholder="–" /></Pair>
              <Pair k="ETD"><Ed label="ETD" value={h("etd")} onChange={setH("etd")} placeholder="–" /></Pair>
            </> : <>
              <Pair k="Delivery date"><Ed label="Delivery date" value={h("delivery_date")} onChange={setH("delivery_date")} placeholder="–" /></Pair>
              <Pair k="Carrier"><Ed label="Carrier" value={h("forwarder")} onChange={setH("forwarder")} placeholder="–" /></Pair>
              <Pair k="Reference"><Ed label="Reference" value={h("container_number")} onChange={setH("container_number")} placeholder="–" /></Pair>
            </>}
          </dl>
        </div>
      </section>

      <table className="w-full table-fixed">
        <colgroup>{pl ? <><col className="w-6" /><col /><col className="w-14" /><col className="w-12" /><col className="w-12" /><col className="w-[4.6rem]" /><col className="w-14" /><col className="w-14" /><col className="w-14" /><col className="w-6 print:hidden" /></>
          : <><col className="w-6" /><col /><col className="w-24" /><col className="w-16" /><col className="w-14" /><col className="w-40" /><col className="w-6 print:hidden" /></>}</colgroup>
        <thead><tr className="border-y border-gray-200 text-left text-[10px] uppercase tracking-wider text-gray-500">
          <th className="py-2 pr-1 font-semibold">#</th><th className="py-2 pr-1 font-semibold">Description</th>
          {pl ? <><th className="py-2 pr-1 text-right font-semibold">Qty</th><th className="py-2 pr-1 text-right font-semibold">Pcs/ctn</th><th className="py-2 pr-1 text-right font-semibold">Ctns</th>
            <th className="py-2 pr-1 text-right font-semibold">Ctn cm</th><th className="py-2 pr-1 text-right font-semibold">N.W. kg</th><th className="py-2 pr-1 text-right font-semibold">G.W. kg</th><th className="py-2 pr-1 text-right font-semibold">CBM</th></>
            : <><th className="py-2 pr-1 font-semibold">SKU</th><th className="py-2 pr-1 text-right font-semibold">Qty</th><th className="py-2 pr-1 text-right font-semibold">Ctns</th><th className="py-2 pl-3 pr-1 font-semibold">Remarks</th></>}
          <th className="print:hidden" /></tr></thead>
        <tbody>{rows.map(({ l, c }, i) => <tr key={i} className="group border-b border-gray-100 align-top">
          <td className="py-1.5 pr-1 text-gray-400">{i + 1}</td>
          <td className="py-1.5 pr-1">
            <EdArea label={`Description line ${i + 1}`} value={l.description} onChange={v => setL(i, "description", v)} placeholder="Description" className="text-gray-900" />
            {pl && <Ed label={`SKU line ${i + 1}`} value={l.sku} onChange={v => setL(i, "sku", v)} placeholder="SKU" className="text-[10.5px] text-gray-500" />}
          </td>
          {pl ? <>
            <td className="py-1.5 pr-1"><IntEd label={`Quantity line ${i + 1}`} value={l.qty} onChange={v => setL(i, "qty", v)} /></td>
            <td className="py-1.5 pr-1"><IntEd label={`Pieces per carton line ${i + 1}`} value={l.units_per_carton} onChange={v => setL(i, "units_per_carton", v)} placeholder="?" /></td>
            <td className="py-1.5 pr-1"><AutoNum label={`Cartons line ${i + 1}`} value={l.cartons} auto={c.auto.cartons} onChange={v => setL(i, "cartons", v)} dp={0} /></td>
            <td className="py-1.5 pr-1"><Ed label={`Carton size line ${i + 1}`} value={dims(l)} placeholder="L×W×H" align="right"
              onChange={v => { const m = v.replace(/,/g, ".").match(/\d+(\.\d+)?/g) ?? []; setD(x => ({ ...x, lines: x.lines.map((y, j) => j === i ? { ...y, length_cm: m[0] ? Number(m[0]) : null, width_cm: m[1] ? Number(m[1]) : null, height_cm: m[2] ? Number(m[2]) : null } : y) })); setDirty(true); }} /></td>
            <td className="py-1.5 pr-1"><AutoNum label={`Net weight line ${i + 1}`} value={l.net_kg} auto={c.auto.net_kg} onChange={v => setL(i, "net_kg", v)} dp={2} /></td>
            <td className="py-1.5 pr-1"><AutoNum label={`Gross weight line ${i + 1}`} value={l.gross_kg} auto={c.auto.gross_kg} onChange={v => setL(i, "gross_kg", v)} dp={2} /></td>
            <td className="py-1.5 pr-1"><AutoNum label={`CBM line ${i + 1}`} value={l.cbm} auto={c.auto.cbm} onChange={v => setL(i, "cbm", v)} dp={3} /></td>
          </> : <>
            <td className="py-1.5 pr-1"><Ed label={`SKU line ${i + 1}`} value={l.sku} onChange={v => setL(i, "sku", v)} placeholder="–" /></td>
            <td className="py-1.5 pr-1"><IntEd label={`Quantity line ${i + 1}`} value={l.qty} onChange={v => setL(i, "qty", v)} /></td>
            <td className="py-1.5 pr-1"><AutoNum label={`Cartons line ${i + 1}`} value={l.cartons} auto={c.auto.cartons} onChange={v => setL(i, "cartons", v)} dp={0} /></td>
            <td className="py-1.5 pl-3 pr-1"><EdArea label={`Remarks line ${i + 1}`} value={l.remarks} onChange={v => setL(i, "remarks", v)} placeholder="–" /></td>
          </>}
          <td className="py-1.5 print:hidden"><button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => { set("lines", d.lines.filter((_, j) => j !== i)); }}
            className="rounded p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-rose-600 group-hover:opacity-100 focus:opacity-100"><X className="h-3.5 w-3.5" /></button></td>
        </tr>)}</tbody>
        <tfoot><tr className="border-t-2 border-gray-300 font-semibold text-gray-900">
          <td /><td className="py-2 pr-1">Total</td>
          {pl ? <><td className="py-2 pr-1 text-right tabular-nums">{fmt(totalQty, 0)}</td><td /><td className="py-2 pr-1 text-right tabular-nums">{fmt(total("cartons"), 0)}</td><td />
            <td className="py-2 pr-1 text-right tabular-nums">{fmt(total("net_kg"), 2)}</td><td className="py-2 pr-1 text-right tabular-nums">{fmt(total("gross_kg"), 2)}</td><td className="py-2 pr-1 text-right tabular-nums">{fmt(total("cbm"), 3)}</td></>
            : <><td /><td className="py-2 pr-1 text-right tabular-nums">{fmt(totalQty, 0)}</td><td className="py-2 pr-1 text-right tabular-nums">{fmt(total("cartons"), 0)}</td><td /></>}
          <td className="print:hidden" /></tr></tfoot>
      </table>
      <button type="button" onClick={() => set("lines", [...d.lines, { description: "", qty: null }])} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline print:hidden"><Plus className="h-3 w-3" />Add line</button>

      <section className="mt-6 grid grid-cols-2 gap-8">
        {pl && <div><Label>Shipping marks</Label><EdArea label="Shipping marks" value={h("shipping_marks")} onChange={setH("shipping_marks")} placeholder="e.g. customer name, PO, carton no. 1-up" /></div>}
        <div className={pl ? "" : "col-span-2"}><Label>Notes</Label><EdArea label="Notes" value={h("notes")} onChange={setH("notes")} placeholder="–" /></div>
      </section>

      {!pl && <section className="mt-10 grid grid-cols-3 gap-8 text-gray-600">
        <div className="col-span-3 text-gray-700">Received the goods above in good order and condition.</div>
        {["Name", "Date", "Signature"].map(k => <div key={k}><div className="h-10 border-b border-gray-400" /><div className="mt-1 text-[10.5px] uppercase tracking-wider text-gray-400">{k}</div></div>)}
      </section>}
    </article>

    <ConfirmDialog open={ask === "delete"} onClose={() => setAsk(null)} danger title={`Delete ${d.doc_number}?`} body="The document is removed; the order does not change. It stays 30 days in Admin → Recycle bin." confirmLabel="Delete"
      onConfirm={async () => { try { await db.remove("generated_documents", { id: d.id }); refresh(); toast.success("Document deleted"); nav(orderPath(o)); } catch (e) { toast.error(errorText(e)); } }} />
    <ConfirmDialog open={ask === "refill"} onClose={() => setAsk(null)} title="Fill again from the order?" confirmLabel="Fill again"
      body="Addresses, shipment details and lines are taken again from the order, the products and the shipment. Your changes to this document are replaced (only after you save)." onConfirm={refill} />
  </>;
}

/** the block on the order page: the order's packing lists and delivery notes */
export function ShippingDocumentsSection({ o }: { o: any }) {
  const docs = useRows("generated_documents", { eq: { sales_order_id: o.id }, order: [["created_at", "desc"]] }).rows;
  return <section className="overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-sm">
    <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3"><h2 className="text-sm font-semibold text-gray-900">Shipping documents</h2></header>
    {docs.length > 0 && <ul className="divide-y divide-gray-100">{docs.map(x => <li key={x.id}>
      <Link to={docPath(o, x.doc_number)} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm transition-colors hover:bg-gray-50">
        <span><span className="font-medium text-gray-900">{x.doc_number}</span> <span className="text-gray-500">· {DOC_LABEL[x.doc_type as DocType]}</span></span>
        <span className="text-xs text-gray-400">{String(x.updated_at).slice(0, 10).split("-").reverse().join("-")}</span></Link></li>)}</ul>}
    <div className="flex flex-wrap gap-2 px-5 py-3">
      <Link to={orderPath(o, "/documents/new?type=packing_list")} className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 shadow-sm hover:bg-gray-50"><Plus className="h-3.5 w-3.5" />Packing list</Link>
      <Link to={orderPath(o, "/documents/new?type=delivery_note")} className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 shadow-sm hover:bg-gray-50"><Plus className="h-3.5 w-3.5" />Delivery note</Link>
    </div>
  </section>;
}

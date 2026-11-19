/**
 * Documents on a record (order, PO, shipment, customer, supplier). Files go to the private "documents" bucket; the attachments
 * table keeps what, where and which slot ("hokje") it fills. Links to a file are valid for 5 minutes.
 * - DocumentsSection: a plain list with a type to choose (POs, shipments, customers, suppliers)
 * - OrderDocSlots: the order's slots: one box per document the order needs, present / missing / not needed
 */
import { useRef, useState, type ReactNode } from "react";
import { Check, Download, FileText, Trash2, Undo2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorText, useApp, useRows } from "@/app/store";
import { Link } from "@/app/router";
import { orderPath } from "@/app/paths";
import { ConfirmDialog, Pill, Section, selectClass } from "@/app/ui";
import { date, fileSize, STATUS_LABEL } from "@/app/format";
import { toast } from "@/app/notify";
import { cn } from "@/lib/utils";
import { docPath } from "./ShippingDocument";

const MAX_MB = 50;
const safeName = (n: string) => n.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(-120);
type Entity = "sales_orders" | "purchase_orders" | "customers" | "suppliers" | "shipments";

/** upload, open and remove, shared by the list and the slots */
function useFiles() {
  const { db, refresh } = useApp(); const [busy, setBusy] = useState(false);
  const upload = async (files: FileList | File[] | null, to: { entity: Entity; id: string; slot: string; label: string }) => {
    const list = Array.from(files ?? []); if (!list.length) return;
    setBusy(true);
    for (const f of list) {
      if (f.size > MAX_MB * 1048576) { toast.error(`${f.name} is larger than ${MAX_MB} MB`); continue; }
      const path = `${to.entity}/${to.id}/${crypto.randomUUID().slice(0, 8)}-${safeName(f.name)}`;
      try {
        await db.uploadFile(path, f);
        try { await db.insert("attachments", { entity_table: to.entity, entity_id: to.id, doc_type: to.label, slot: to.slot, file_name: f.name, storage_path: path, size_bytes: f.size, mime_type: f.type || null }); }
        catch (e) { await db.removeFile(path).catch(() => undefined); throw e; }   // no file without a record
        toast.success(`${f.name} added`);
      } catch (e) { toast.error(`${f.name}: ${errorText(e)}`, { duration: 9000 }); }
    }
    setBusy(false); refresh();
  };
  // the tab is opened right away (inside the click), so the browser does not block it while the link is made
  const open = async (d: any) => {
    const w = window.open("", "_blank");
    try { const url = await db.fileUrl(d.storage_path); if (w) w.location.href = url; else window.location.href = url; }
    catch (e) { w?.close(); toast.error(errorText(e)); }
  };
  return { upload, open, busy };
}

function FileRow({ d, onOpen, onRemove, who, where }: { d: any; onOpen: () => void; onRemove: () => void; who?: string; where?: string }) {
  return <li className="flex items-center gap-2.5 py-1.5">
    <FileText className="h-4 w-4 shrink-0 text-gray-400" />
    <div className="min-w-0 flex-1">
      <button type="button" onClick={onOpen} className="block max-w-full truncate text-left text-sm font-medium text-gray-900 hover:text-indigo-600">{d.file_name}</button>
      <div className="text-xs text-gray-500">{[where, fileSize(d.size_bytes), date(String(d.created_at).slice(0, 10)), who].filter(Boolean).join(" · ")}</div>
    </div>
    <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-gray-900" aria-label={`Open ${d.file_name}`} onClick={onOpen}><Download className="h-3.5 w-3.5" /></Button>
    <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-rose-600" aria-label={`Remove ${d.file_name}`} onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>
  </li>;
}

function RemoveDialog({ d, onClose }: { d: any; onClose: () => void }) {
  const { db, run } = useApp();
  return <ConfirmDialog open={!!d} onClose={onClose} danger title="Remove this document?" body={d ? `${d.file_name} is removed for everyone. It stays 30 days in Admin → Recycle bin, where it can be restored.` : ""}
    confirmLabel="Remove" onConfirm={() => { const x = d; run(async () => { await db.remove("attachments", { id: x.id }); }, "Document removed"); }} />;
}

export function DocumentsSection({ entity, id, className }: { entity: Entity; id: string; className?: string }) {
  const docs = useRows("attachments", { eq: { entity_table: entity, entity_id: id }, order: [["created_at", "desc"]] }).rows;
  const slots = useRows("doc_slots", { order: [["sort", "asc"]] }).rows.filter(s => s.active);
  const profiles = useRows("profiles").rows; const who = (u: string) => profiles.find(p => p.user_id === u)?.full_name;
  const { upload, open, busy } = useFiles();
  const input = useRef<HTMLInputElement>(null);
  const [type, setType] = useState(""); const [drag, setDrag] = useState(false); const [remove, setRemove] = useState<any>(null);
  // the first slot that is usually kept here
  const first = slots.find(s => (entity === "shipments" ? s.stored_on === "shipment" : entity === "purchase_orders" ? s.stored_on === "purchase_order" : false))?.code ?? "other";
  const slot = slots.find(s => s.code === (type || first));
  const go = async (files: FileList | File[] | null) => {
    if (!slot) return toast.error("Choose a document type");
    await upload(files, { entity, id, slot: slot.code, label: slot.label }); if (input.current) input.current.value = "";
  };
  return <Section title={<span className="flex items-center gap-2">Documents{docs.length > 0 && <span className="rounded-full bg-gray-100 px-1.5 text-[11px] tabular-nums text-gray-600">{docs.length}</span>}</span>} className={className}>
    <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); go(e.dataTransfer.files); }}
      className={`flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-3 transition-colors ${drag ? "bg-indigo-50" : ""}`}>
      <select aria-label="Document type" className={selectClass + " w-48"} value={type || first} onChange={e => setType(e.target.value)}>{slots.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}</select>
      <input ref={input} type="file" multiple className="hidden" onChange={e => go(e.target.files)} aria-label="Choose files" />
      <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy}><Upload className="h-3.5 w-3.5" />{busy ? "Uploading…" : "Upload"}</Button>
      <span className="text-xs text-gray-400">or drop files here</span>
    </div>
    {!docs.length ? <p className="px-5 py-6 text-center text-sm text-gray-500">No documents yet</p> :
      <ul className="divide-y divide-gray-100 px-5">{docs.map(d => <FileRow key={d.id} d={d} onOpen={() => open(d)} onRemove={() => setRemove(d)} who={who(d.uploaded_by)}
        where={slots.find(s => s.code === d.slot)?.label ?? d.doc_type} />)}</ul>}
    <RemoveDialog d={remove} onClose={() => setRemove(null)} />
  </Section>;
}

// ---------------- the order's slots ----------------
const STATE_TONE: Record<string, string> = { present: "green", waived: "grey", missing: "amber" };

/** how many needed documents are there: for the tab label, e.g. "3/6" */
export function useDocCount(orderId: string | null) {
  const rows = useRows(orderId && "v_order_doc_slots", { eq: { sales_order_id: orderId } }).rows;
  const needed = rows.filter(r => r.is_required);
  return { done: needed.filter(r => r.state !== "missing").length, total: needed.length, late: needed.some(r => r.due_now && r.state === "missing") };
}

export function OrderDocSlots({ o, shipment, lines }: { o: any; shipment: any; lines: any[] }) {
  const { db, run } = useApp();
  const rows = useRows("v_order_doc_slots", { eq: { sales_order_id: o.id }, order: [["sort", "asc"]] }).rows;
  const onOrder = useRows("attachments", { eq: { entity_table: "sales_orders", entity_id: o.id }, order: [["created_at", "desc"]] }).rows;
  const onShip = useRows(shipment ? "attachments" : null, { eq: { entity_table: "shipments", entity_id: shipment?.id } }).rows;
  const poIds = [...new Set(lines.map(l => l.purchase_order_id).filter(Boolean))] as string[];
  const onPos = useRows(poIds.length ? "attachments" : null, { eq: { entity_table: "purchase_orders" } }).rows.filter(a => poIds.includes(a.entity_id));
  const made = useRows("generated_documents", { eq: { sales_order_id: o.id }, order: [["created_at", "desc"]] }).rows;
  const profiles = useRows("profiles").rows; const who = (u: string) => profiles.find(p => p.user_id === u)?.full_name;
  const { upload, open, busy } = useFiles();
  const [remove, setRemove] = useState<any>(null); const [waive, setWaive] = useState<{ code: string; reason: string } | null>(null);
  const base = orderPath(o);
  const all = [...onOrder.map(a => ({ ...a, where: "" })), ...onShip.map(a => ({ ...a, where: "on the shipment" })), ...onPos.map(a => ({ ...a, where: "on the PO" }))];
  const loose = onOrder.filter(a => !a.slot);
  // where a new file goes: the shipment or the (only) PO when the slot lives there, otherwise the order
  const target = (s: any): { entity: Entity; id: string } =>
    s.stored_on === "shipment" && shipment ? { entity: "shipments", id: shipment.id }
    : s.stored_on === "purchase_order" && poIds.length === 1 ? { entity: "purchase_orders", id: poIds[0] } : { entity: "sales_orders", id: o.id };

  const card = (s: any): ReactNode => {
    const files = all.filter(a => a.slot === s.code);
    const appDocs: { label: string; to: string }[] = s.made_in_app === "invoice" ? (o.invoice_number ? [{ label: `Invoice ${o.invoice_number}`, to: `${base}/commercial-invoice` }] : [])
      : s.made_in_app ? made.filter(m => m.doc_type === s.made_in_app).map(m => ({ label: `${m.doc_number} (made in the app)`, to: docPath(o, m.doc_number) })) : [];
    const late = s.state === "missing" && s.due_now;
    const status = s.state === "present" ? <Pill tone="green"><Check className="mr-0.5 inline h-3 w-3" />Present</Pill>
      : s.state === "waived" ? <Pill tone="grey">Not needed</Pill>
      : !s.is_required ? <Pill tone="grey">Optional</Pill>
      : late ? <Pill tone="amber">Missing</Pill> : <Pill tone="blue">From {STATUS_LABEL[s.required_from]}</Pill>;
    return <DropBox key={s.code} onFiles={f => upload(f, { ...target(s), slot: s.code, label: s.label })}
      className={cn("flex flex-col rounded-xl border bg-white p-4 shadow-sm", late ? "border-amber-300" : s.state === "present" ? "border-emerald-200" : "border-gray-200/80")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><div className="text-sm font-semibold text-gray-900">{s.label}</div>
          <div className="mt-0.5 text-xs text-gray-500">{s.is_required ? `Needed from "${STATUS_LABEL[s.required_from]}"` : "Optional"}{s.stored_on !== "order" && ` · kept on the ${s.stored_on === "shipment" ? "shipment" : "PO"}`}</div></div>
        {status}
      </div>
      {(files.length > 0 || appDocs.length > 0) && <ul className="mt-2 divide-y divide-gray-100">
        {appDocs.map(d => <li key={d.to} className="flex items-center gap-2.5 py-1.5"><FileText className="h-4 w-4 shrink-0 text-indigo-400" /><Link to={d.to} className="truncate text-sm font-medium text-indigo-600 hover:underline">{d.label}</Link></li>)}
        {files.map(d => <FileRow key={d.id} d={d} onOpen={() => open(d)} onRemove={() => setRemove(d)} who={who(d.uploaded_by)} where={d.where} />)}</ul>}
      {s.state === "waived" && <div className="mt-2 flex items-start justify-between gap-2 rounded-md bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600">
        <span>Not needed: {s.waived_reason}</span>
        <button type="button" className="inline-flex shrink-0 items-center gap-1 font-medium text-gray-500 hover:text-gray-900"
          onClick={() => run(() => db.remove("order_doc_waivers", { sales_order_id: o.id, slot: s.code }), "Needed again")}><Undo2 className="h-3 w-3" />Undo</button></div>}
      {waive && waive.code === s.code && <form className="mt-2 flex gap-2" onSubmit={e => { e.preventDefault(); const r = waive.reason.trim(); if (!r) return;
          run(() => db.insert("order_doc_waivers", { sales_order_id: o.id, slot: s.code, reason: r }), "Marked as not needed").then(() => setWaive(null)); }}>
        <input autoFocus aria-label="Why is it not needed" placeholder="Why is it not needed?" value={waive.reason} onChange={e => setWaive({ code: s.code, reason: e.target.value })}
          className="h-8 min-w-0 flex-1 rounded-md border border-gray-300 px-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        <Button size="sm" type="submit" disabled={!waive.reason.trim()}>Save</Button><Button size="sm" variant="ghost" type="button" onClick={() => setWaive(null)}>Cancel</Button></form>}
      <div className="mt-auto flex items-center gap-3 pt-3">
        <UploadButton busy={busy} label={files.length ? "Add file" : "Upload"} onFiles={f => upload(f, { ...target(s), slot: s.code, label: s.label })} name={s.label} />
        {s.made_in_app === "packing_list" && !appDocs.length && <Link to={`${base}/documents/new?type=packing_list`} className="text-xs font-medium text-indigo-600 hover:underline">Make in the app</Link>}
        {s.is_required && s.state === "missing" && waive?.code !== s.code && <button type="button" onClick={() => setWaive({ code: s.code, reason: "" })} className="text-xs font-medium text-gray-500 hover:text-gray-900">Not needed…</button>}
      </div>
    </DropBox>;
  };
  const needed = rows.filter(r => r.is_required), optional = rows.filter(r => !r.is_required);
  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{needed.map(card)}</div>
    {optional.length > 0 && <div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Optional</h3>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{optional.map(card)}</div></div>}
    {loose.length > 0 && <Section title="Other files" sub="Uploaded without a slot">
      <ul className="divide-y divide-gray-100 px-5">{loose.map(d => <FileRow key={d.id} d={d} onOpen={() => open(d)} onRemove={() => setRemove(d)} who={who(d.uploaded_by)} where={d.doc_type} />)}</ul></Section>}
    <p className="text-xs text-gray-400">Drop files on a box to add them. Which documents an order needs is set in Admin → Document slots.</p>
    <RemoveDialog d={remove} onClose={() => setRemove(null)} />
  </div>;
}

function DropBox({ onFiles, className, children }: { onFiles: (f: FileList) => void; className?: string; children: ReactNode }) {
  const [drag, setDrag] = useState(false);
  return <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
    className={cn(className, drag && "ring-2 ring-indigo-400")}>{children}</div>;
}
function UploadButton({ onFiles, busy, label, name }: { onFiles: (f: FileList | null) => void; busy: boolean; label: string; name: string }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <input ref={input} type="file" multiple className="hidden" aria-label={`Choose files for ${name}`} onChange={e => { onFiles(e.target.files); e.target.value = ""; }} />
    <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy}><Upload className="h-3.5 w-3.5" />{busy ? "Uploading…" : label}</Button>
  </>;
}

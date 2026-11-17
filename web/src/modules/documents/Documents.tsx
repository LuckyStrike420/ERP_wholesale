/**
 * Documents on a record (order, PO, customer, supplier): PI, customer PO, supplier PI, invoice, packing list, BL …
 * Files go to the private "documents" bucket; the attachments table keeps what and where. Links to a file are valid for 5 minutes.
 */
import { useRef, useState } from "react";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorText, useApp, useRows } from "@/app/store";
import { ConfirmDialog, Section, selectClass } from "@/app/ui";
import { DOC_TYPES, fileSize } from "@/app/format";
import { toast } from "sonner";

const MAX_MB = 50;
const safeName = (n: string) => n.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(-120);

export function DocumentsSection({ entity, id, className }: { entity: "sales_orders" | "purchase_orders" | "customers" | "suppliers"; id: string; className?: string }) {
  const { db, run, refresh } = useApp();
  const docs = useRows("attachments", { eq: { entity_table: entity, entity_id: id }, order: [["created_at", "desc"]] }).rows;
  const profiles = useRows("profiles").rows;
  const input = useRef<HTMLInputElement>(null);
  const [type, setType] = useState("PI"); const [busy, setBusy] = useState(false); const [drag, setDrag] = useState(false);
  const [remove, setRemove] = useState<any>(null);
  const who = (u: string) => profiles.find(p => p.user_id === u)?.full_name;

  const upload = async (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []); if (!list.length) return;
    setBusy(true);
    for (const f of list) {
      if (f.size > MAX_MB * 1048576) { toast.error(`${f.name} is larger than ${MAX_MB} MB`); continue; }
      const path = `${entity}/${id}/${crypto.randomUUID().slice(0, 8)}-${safeName(f.name)}`;
      try {
        await db.uploadFile(path, f);
        try { await db.insert("attachments", { entity_table: entity, entity_id: id, doc_type: type, file_name: f.name, storage_path: path, size_bytes: f.size, mime_type: f.type || null }); }
        catch (e) { await db.removeFile(path).catch(() => undefined); throw e; }   // no file without a record
        toast.success(`${f.name} added`);
      } catch (e) { toast.error(`${f.name}: ${errorText(e)}`, { duration: 9000 }); }
    }
    setBusy(false); refresh(); if (input.current) input.current.value = "";
  };
  // the tab is opened right away (inside the click), so the browser does not block it while the link is made
  const open = async (d: any) => {
    const w = window.open("", "_blank");
    try { const url = await db.fileUrl(d.storage_path); if (w) w.location.href = url; else window.location.href = url; }
    catch (e) { w?.close(); toast.error(errorText(e)); }
  };

  return <Section title={<span className="flex items-center gap-2">Documents{docs.length > 0 && <span className="rounded-full bg-gray-100 px-1.5 text-[11px] tabular-nums text-gray-600">{docs.length}</span>}</span>} className={className}>
    <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
      className={`flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-3 transition-colors ${drag ? "bg-indigo-50" : ""}`}>
      <select aria-label="Document type" className={selectClass + " w-40"} value={type} onChange={e => setType(e.target.value)}>{DOC_TYPES.map(t => <option key={t}>{t}</option>)}</select>
      <input ref={input} type="file" multiple className="hidden" onChange={e => upload(e.target.files)} aria-label="Choose files" />
      <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy}><Upload className="h-3.5 w-3.5" />{busy ? "Uploading…" : "Upload"}</Button>
      <span className="text-xs text-gray-400">or drop files here</span>
    </div>
    {!docs.length ? <p className="px-5 py-6 text-center text-sm text-gray-500">No documents yet</p> :
      <ul className="divide-y divide-gray-100">{docs.map(d => (
        <li key={d.id} className="flex items-center gap-3 px-5 py-2.5">
          <FileText className="h-4 w-4 shrink-0 text-gray-400" />
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => open(d)} className="block max-w-full truncate text-left text-sm font-medium text-gray-900 hover:text-indigo-600">{d.file_name}</button>
            <div className="text-xs text-gray-500">{[d.doc_type, fileSize(d.size_bytes), String(d.created_at).slice(0, 10).split("-").reverse().join("-"), who(d.uploaded_by)].filter(Boolean).join(" · ")}</div>
          </div>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-gray-900" aria-label={`Open ${d.file_name}`} onClick={() => open(d)}><Download className="h-3.5 w-3.5" /></Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-rose-600" aria-label={`Remove ${d.file_name}`} onClick={() => setRemove(d)}><Trash2 className="h-3.5 w-3.5" /></Button>
        </li>))}</ul>}
    <ConfirmDialog open={!!remove} onClose={() => setRemove(null)} danger title="Remove this document?" body={remove ? `${remove.file_name} is deleted for everyone. This cannot be undone.` : ""}
      confirmLabel="Remove" onConfirm={() => { const d = remove; run(async () => { await db.remove("attachments", { id: d.id }); await db.removeFile(d.storage_path); }, "Document removed"); }} />
  </Section>;
}

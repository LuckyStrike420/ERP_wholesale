/**
 * Timeline of an order (EspoCRM calls it the "stream"): status changes, payments, invoice, PO, shipment,
 * notes, tasks and documents in one list, newest first. Notes are written here.
 */
import { useState } from "react";
import { ArrowRightLeft, CheckCircle2, ClipboardList, FileText, MessageSquare, Pencil, Plus, Receipt, Ship, Sparkles, SquareCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MentionTextarea } from "@/app/Mentions";
import { useApp, useRows } from "@/app/store";
import { Section } from "@/app/ui";
import { date, money } from "@/app/format";
import { cn } from "@/lib/utils";

const ICON: Record<string, { icon: any; tone: string }> = {
  created: { icon: Sparkles, tone: "bg-indigo-50 text-indigo-600" }, status: { icon: ArrowRightLeft, tone: "bg-indigo-50 text-indigo-600" }, change: { icon: Pencil, tone: "bg-gray-100 text-gray-500" },
  payment: { icon: Receipt, tone: "bg-emerald-50 text-emerald-600" }, invoice: { icon: FileText, tone: "bg-sky-50 text-sky-600" }, correction: { icon: Pencil, tone: "bg-amber-50 text-amber-600" },
  write_off: { icon: Pencil, tone: "bg-amber-50 text-amber-600" }, purchase_order: { icon: ClipboardList, tone: "bg-sky-50 text-sky-600" }, shipment: { icon: Ship, tone: "bg-sky-50 text-sky-600" },
  note: { icon: MessageSquare, tone: "bg-amber-50 text-amber-700" }, task: { icon: SquareCheck, tone: "bg-gray-100 text-gray-600" }, task_done: { icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-600" },
  document: { icon: FileText, tone: "bg-gray-100 text-gray-600" },
};
// these only have a date, no time of day
const DATE_ONLY = new Set(["payment", "invoice", "write_off", "shipment"]);
/** a moment in your own time zone: "17 Nov 2026 22:24" */
const local = (v: any) => { const d = new Date(v); return isNaN(+d) ? "–" : `${date(d.toLocaleDateString("sv"))} ${d.toTimeString().slice(0, 5)}`; };

/** notes: only notes, with the box to add one; history: everything that happened, without the box; both: as before */
export function OrderTimeline({ o, className, mode = "both" }: { o: any; className?: string; mode?: "notes" | "history" | "both" }) {
  const { db, run } = useApp();
  const rows = useRows("v_order_timeline", { eq: { sales_order_id: o.id }, order: [["at", "desc"]] }).rows;
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [changes, setChanges] = useState(false);
  const kinds = mode === "notes" ? rows.filter(r => r.kind === "note") : rows;
  const shown = changes || mode === "notes" ? kinds : kinds.filter(r => r.kind !== "change");
  const hidden = kinds.length - shown.length;
  const add = async () => {
    if (!text.trim()) return; setBusy(true);
    const ok = await run(() => db.insert("record_notes", { body: text.trim(), sales_order_id: o.id }), "Note added");
    if (ok !== undefined) setText(""); setBusy(false);
  };
  return <Section title={mode === "notes" ? "Notes" : mode === "history" ? "History" : "Timeline"} className={className}
    action={hidden > 0 || changes ? <button type="button" onClick={() => setChanges(c => !c)} className="text-xs font-medium text-gray-500 hover:text-gray-900">{changes ? "Hide field changes" : `Show ${hidden} field change${hidden === 1 ? "" : "s"}`}</button> : undefined}>
    {mode !== "history" && <div className="border-b border-gray-100 px-5 py-3">
      <MentionTextarea placeholder="Add a note: a call, an agreement, something to remember… Type @ to mention a colleague" value={text} onChange={setText} onSubmit={add} className="border-gray-200 text-sm" />
      <div className="mt-2 flex items-center justify-between"><span className="text-xs text-gray-400">Ctrl + Enter to save · @ to mention</span>
        <Button size="sm" onClick={add} disabled={busy || !text.trim()}><Plus className="h-3.5 w-3.5" />Add note</Button></div>
    </div>}
    {!shown.length ? <p className="px-5 py-8 text-center text-sm text-gray-500">{mode === "notes" ? "No notes yet" : "Nothing logged yet"}</p> :
      <ol className="relative px-5 py-4">
        <span aria-hidden className="absolute bottom-6 left-[2.15rem] top-6 w-px bg-gray-100" />
        {shown.map((r, i) => { const k = ICON[r.kind] ?? ICON.change; const Icon = k.icon;
          return <li key={`${r.kind}-${r.ref_id ?? i}-${r.at}`} className="relative flex gap-3 pb-4 last:pb-0">
            <span className={cn("relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-white", k.tone)}><Icon className="h-3.5 w-3.5" /></span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-medium text-gray-900">{r.title}{r.amount != null && <span className="ml-1.5 font-normal tabular-nums text-gray-700">{money(r.amount, o.currency)}</span>}</span>
                <span className="text-xs tabular-nums text-gray-400">{DATE_ONLY.has(r.kind) ? date(r.at) : local(r.at)}</span>
              </div>
              {r.detail && <p className={cn("mt-0.5 text-sm", r.kind === "note" ? "whitespace-pre-line rounded-lg bg-amber-50/60 px-3 py-2 text-gray-800" : "text-gray-500")}>{r.detail}</p>}
              {(r.actor_name || r.kind === "note") && <div className="mt-0.5 text-xs text-gray-400">{r.actor_name}
                {r.kind === "note" && <button type="button" onClick={() => run(() => db.remove("record_notes", { id: r.ref_id }), "Note removed")} className="ml-2 hover:text-rose-600">remove</button>}</div>}
            </div>
          </li>; })}
      </ol>}
  </Section>;
}

/**
 * Admin → Document slots (/admin/document-slots): the boxes on an order's Documents tab.
 * Per slot: for which terms, from which status it is needed (empty = optional), where the file is kept
 * (order, shipment or purchase order) and whether a document made in the app counts.
 */
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useRows } from "@/app/store";
import { useNav, useParams } from "@/app/router";
import { ConfirmDialog, DataTable, FormPage, LinkButton, Loading, NotFound, Pill, Section, type Field } from "@/app/ui";
import { STATUS_LABEL, STATUS_ORDER } from "@/app/format";
import { AdminHead } from "./Admin";

const TERMS = ["FOB", "EXW", "FCA", "DAP", "DDP"];
const STORED: Record<string, string> = { order: "On the order", shipment: "On the shipment (shared by its orders)", purchase_order: "On the purchase order (shared by its orders)" };
const MADE: Record<string, string> = { packing_list: "A packing list made in the app", delivery_note: "A delivery note made in the app", invoice: "The invoice registered in the app" };
const slotPath = (s: any) => `/admin/document-slots/${s.code}`;
const slug = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "slot";

export function DocSlots() {
  const rows = useRows("doc_slots", { order: [["sort", "asc"]] }).rows;
  return <><AdminHead />
    <Section title="Document slots" sub="The boxes on an order's Documents tab. A needed slot that is still empty when the order reaches its status shows under Next actions; a validation rule can also make it block the step."
      action={<LinkButton size="sm" to="/admin/document-slots/new"><Plus />New slot</LinkButton>}>
      <DataTable rows={rows} rowTo={slotPath} empty="No document slots" cols={[
        { key: "label", header: "Document", render: s => <div><div className="font-semibold text-gray-900">{s.label}</div>{s.hint && <div className="text-xs text-gray-500">{s.hint}</div>}</div> },
        { key: "terms", header: "For", value: s => (s.terms ?? []).join(" "), render: s => <div className="flex flex-wrap gap-1">{(s.terms ?? []).map((t: string) => <Pill key={t}>{t}</Pill>)}</div> },
        { key: "required_from", header: "Needed from", render: s => s.required_from ? STATUS_LABEL[s.required_from] : <span className="text-gray-400">optional</span> },
        { key: "stored_on", header: "Kept", render: s => STORED[s.stored_on]?.replace(/ \(.*/, "") },
        { key: "made_in_app", header: "Also counts", render: s => s.made_in_app ? MADE[s.made_in_app] : "–" },
        { key: "active", header: "", render: s => s.active ? <Pill tone="green">on</Pill> : <Pill>off</Pill> }]} />
    </Section></>;
}

const fields: Field[] = [
  { name: "label", label: "Name", required: true, placeholder: "e.g. Certificate of origin" },
  ...TERMS.map(t => ({ name: `t_${t}`, label: t, type: "checkbox" as const, span: 1 as const, section: "For orders with terms" })),
  { name: "required_from", label: "Needed from status", type: "select", span: 1, section: "When", options: [{ value: "", label: "Optional (never needed)" }, ...STATUS_ORDER.filter(s => !["draft", "cancelled"].includes(s)).map(s => ({ value: s, label: STATUS_LABEL[s] }))] },
  { name: "stored_on", label: "Kept", type: "select", span: 1, section: "When", required: true, options: Object.entries(STORED).map(([value, label]) => ({ value, label })) },
  { name: "made_in_app", label: "Also counts as present", type: "select", section: "When", options: [{ value: "", label: "Only an uploaded file" }, ...Object.entries(MADE).map(([value, label]) => ({ value, label }))] },
  { name: "hint", label: "Explanation", section: "When", placeholder: "Shown on the box" },
  { name: "sort", label: "Order on the tab", type: "number", span: 1, section: "When", hint: "Lower comes first" },
  { name: "active", label: "Slot is on", type: "checkbox", section: "When" },
];

export function DocSlotForm() {
  const { code } = useParams(); const { db, run } = useApp(); const nav = useNav();
  const { rows, loading } = useRows("doc_slots"); const [confirm, setConfirm] = useState(false);
  const s = code ? rows.find(x => x.code === code) : undefined;
  if (loading && !rows.length) return <Loading />;
  if (code && !s) return <NotFound what="Document slot" back={{ to: "/admin/document-slots", label: "Document slots" }} />;
  const initial = s ? { ...s, required_from: s.required_from ?? "", made_in_app: s.made_in_app ?? "", ...Object.fromEntries(TERMS.map(t => [`t_${t}`, (s.terms ?? []).includes(t)])) }
    : { active: true, stored_on: "order", required_from: "", made_in_app: "", sort: 500, ...Object.fromEntries(TERMS.map(t => [`t_${t}`, true])) };
  return <>
    <FormPage title={s ? s.label : "New document slot"} back={{ to: "/admin/document-slots", label: "Document slots" }} fields={fields} done="/admin/document-slots" initial={initial}
      onSubmit={async v => {
        const terms = TERMS.filter(t => v[`t_${t}`]); if (!terms.length) throw new Error("Choose at least one of FOB, EXW, FCA, DAP, DDP");
        const body = { label: v.label.trim(), terms, required_from: v.required_from || null, stored_on: v.stored_on, made_in_app: v.made_in_app || null, hint: v.hint || null, sort: v.sort ?? 500, active: !!v.active };
        if (s) await db.update("doc_slots", { code: s.code }, body);
        else { let c = slug(body.label); if (rows.some(x => x.code === c)) c = `${c}_${rows.length + 1}`; await db.insert("doc_slots", { code: c, ...body }); }
      }}
      aside={s && <Section title="This slot"><div className="space-y-3 px-5 py-4 text-sm text-gray-600">
        <p>Switching it off hides the box on every order; files already uploaded stay on the order.</p>
        <Button variant="ghost" className="w-full text-rose-600" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />Delete slot</Button></div></Section>} />
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={`Delete "${s?.label}"?`} confirmLabel="Delete"
      body="Files in this slot stay on their orders, under Other files. Switching the slot off keeps it for later."
      onConfirm={() => s && run(() => db.remove("doc_slots", { code: s.code }), "Slot deleted").then(() => nav("/admin/document-slots"))} />
  </>;
}

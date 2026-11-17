/**
 * People at a customer or supplier, and notes on them.
 * /customers/jml/contacts/new, /customers/jml/contacts/1a2b3c4d (same under /suppliers)
 */
import { useState } from "react";
import { Mail, Phone, Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useApp, useRows } from "@/app/store";
import { Link, useNav, useParams } from "@/app/router";
import { byShort, bySlug, customerPath, supplierPath } from "@/app/paths";
import { ConfirmDialog, FormPage, LinkButton, Loading, NotFound, Section, type Field } from "@/app/ui";
import { date } from "@/app/format";

type Party = "customer" | "supplier";
const ROLES = ["Purchasing", "Finance", "Logistics", "Sales", "Quality", "Management", "Other"];
const partyPath = (party: Party, p: { name: string }, sub = "") => party === "customer" ? customerPath(p, sub) : supplierPath(p, sub);
const key = (party: Party) => party === "customer" ? "customer_id" : "supplier_id";

export function ContactsSection({ party, p, className }: { party: Party; p: { id: string; name: string }; className?: string }) {
  const rows = useRows("contacts", { eq: { [key(party)]: p.id }, order: [["is_primary", "desc"], ["name", "asc"]] }).rows;
  return <Section title="Contacts" className={className} action={<LinkButton size="sm" variant="outline" to={partyPath(party, p, "/contacts/new")}><Plus />Add contact</LinkButton>}>
    {!rows.length ? <p className="px-5 py-6 text-center text-sm text-gray-500">No contacts yet</p> :
      <ul className="divide-y divide-gray-100">{rows.map(c => <li key={c.id}>
        <Link to={partyPath(party, p, `/contacts/${String(c.id).slice(0, 8)}`)} className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-gray-50">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">{c.name.split(/\s+/).map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900">{c.name}{c.is_primary && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Main contact" />}
              {c.role && <span className="font-normal text-gray-500">· {c.role}</span>}</div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-500">
              {c.email && <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-indigo-600"><Mail className="h-3 w-3" />{c.email}</a>}
              {c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-indigo-600"><Phone className="h-3 w-3" />{c.phone}</a>}
            </div>
          </div>
        </Link></li>)}</ul>}
  </Section>;
}

export const CustomerContactForm = () => <ContactForm party="customer" />;
export const SupplierContactForm = () => <ContactForm party="supplier" />;

function ContactForm({ party }: { party: Party }) {
  const { slug, id } = useParams(); const { db, run } = useApp(); const nav = useNav();
  const parties = useRows(party === "customer" ? "customers" : "suppliers");
  const p = bySlug(parties.rows, slug);
  const contacts = useRows(p ? "contacts" : null, { eq: { [key(party)]: p?.id } });
  const [confirm, setConfirm] = useState(false);
  if (!p) return parties.loading ? <Loading /> : <NotFound what={party === "customer" ? "Customer" : "Supplier"} back={{ to: `/${party}s`, label: "Back" }} />;
  const c = id ? byShort(contacts.rows, id) : undefined;
  if (id && !c) return contacts.loading ? <Loading /> : <NotFound what="Contact" back={{ to: partyPath(party, p), label: p.name }} />;
  const fields: Field[] = [
    { name: "name", label: "Name", required: true }, { name: "role", label: "Role", type: "select", span: 1, free: true, options: ROLES.map(r => ({ value: r, label: r })), hint: "Pick one or type your own" },
    { name: "is_primary", label: "Main contact (shown on documents)", type: "checkbox", span: 1 },
    { name: "email", label: "E-mail", span: 1 }, { name: "phone", label: "Phone", span: 1 }, { name: "notes", label: "Note", type: "textarea" }];
  return <>
    <FormPage title={c ? c.name : "New contact"} sub={p.name} back={{ to: partyPath(party, p), label: p.name }} fields={fields} initial={c ?? {}}
      onSubmit={async v => {
        if (v.email && !/^\S+@\S+\.\S+$/.test(v.email)) throw new Error("E-mail: not a valid address");
        const body = { ...v, is_primary: !!v.is_primary };
        // one main contact per customer or supplier
        if (body.is_primary) for (const x of contacts.rows.filter(x => x.is_primary && x.id !== c?.id)) await db.update("contacts", { id: x.id }, { is_primary: false });
        if (c) await db.update("contacts", { id: c.id }, body); else await db.insert("contacts", { ...body, [key(party)]: p.id });
      }}
      aside={c && <Section title="This contact"><div className="px-5 py-4">
        <Button variant="ghost" className="w-full text-rose-600" onClick={() => setConfirm(true)}>Remove contact</Button></div></Section>} />
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={`Remove ${c?.name}?`} body="The contact is removed from this customer or supplier." confirmLabel="Remove"
      onConfirm={() => c && run(() => db.remove("contacts", { id: c.id }), "Contact removed").then(() => nav(partyPath(party, p)))} />
  </>;
}

/** short notes on a customer or supplier: calls, agreements, things to remember */
export function NotesSection({ party, p, className }: { party: Party; p: { id: string }; className?: string }) {
  const { db, run } = useApp();
  const rows = useRows("record_notes", { eq: { [key(party)]: p.id }, order: [["created_at", "desc"]] }).rows;
  const profiles = useRows("profiles").rows;
  const [text, setText] = useState("");
  const add = async () => { if (!text.trim()) return; const r = await run(() => db.insert("record_notes", { body: text.trim(), [key(party)]: p.id }), "Note added"); if (r !== undefined) setText(""); };
  return <Section title="Notes" className={className}>
    <div className="border-b border-gray-100 px-5 py-3">
      <Textarea aria-label="New note" rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="A call, an agreement, something to remember…" className="border-gray-200 text-sm"
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add(); }} />
      <div className="mt-2 flex justify-end"><Button size="sm" onClick={add} disabled={!text.trim()}><Plus className="h-3.5 w-3.5" />Add note</Button></div>
    </div>
    {!rows.length ? <p className="px-5 py-6 text-center text-sm text-gray-500">No notes yet</p> :
      <ul className="divide-y divide-gray-100">{rows.map(n => <li key={n.id} className="px-5 py-3">
        <p className="whitespace-pre-line text-sm text-gray-800">{n.body}</p>
        <div className="mt-1 text-xs text-gray-400">{date(n.created_at)}{profiles.find(x => x.user_id === n.created_by)?.full_name ? ` · ${profiles.find(x => x.user_id === n.created_by)?.full_name}` : ""}
          <button type="button" onClick={() => run(() => db.remove("record_notes", { id: n.id }), "Note removed")} className="ml-2 hover:text-rose-600">remove</button></div>
      </li>)}</ul>}
  </Section>;
}

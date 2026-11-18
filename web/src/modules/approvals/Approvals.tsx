/**
 * Approvals: /approvals (requests to decide and the history), the approval box on the order path,
 * and the policies under Admin → Approvals (/admin/approvals, /admin/approvals/new, /admin/approvals/1a2b3c4d).
 * The database keeps the rule: a low-margin order cannot leave Draft without a valid approval.
 */
import { useState } from "react";
import { Check, Plus, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useRows } from "@/app/store";
import { Link, useParams } from "@/app/router";
import { byShort, orderPath } from "@/app/paths";
import { DataTable, FormPage, LinkButton, Loading, NotFound, PageHeader, Pill, Section, TabLinks, type Field } from "@/app/ui";
import { dateTime, money, pct } from "@/app/format";
import { cn } from "@/lib/utils";
import { AdminHead } from "@/modules/admin/Admin";

const ROLE = { admin: "an admin", finance: "an admin or finance" } as Record<string, string>;
const who = (id: string | null | undefined, name: string | null | undefined, me?: string | null) => id && id === me ? "you" : name ?? "a colleague";
const canDecide = (role: string | null | undefined, approver: string | null | undefined) => role === "admin" || (!!role && role === (approver ?? "admin"));
export const policyText = (p: any) => `Margin below ${pct(p.margin_below, 1)}${p.order_type ? ` on ${p.order_type} orders` : ""}: approval by ${ROLE[p.approver_role] ?? "an admin"}`;

/** how many requests the signed-in user can decide (for the menu badge) */
export function usePendingApprovals() {
  const { session } = useApp();
  return useRows("v_approvals", { eq: { status: "pending" } }).rows.filter(a => canDecide(session?.role, a.approver_role)).length;
}

function Decide({ a }: { a: any }) {
  const { db, run, refresh } = useApp(); const [note, setNote] = useState("");
  const go = (ok: boolean) => run(async () => { await db.rpc("decide_approval", { p_id: a.id, p_approve: ok, p_note: note || null }); refresh(); }, ok ? "Approved" : "Rejected");
  return <div className="flex flex-wrap items-center gap-2">
    <input aria-label="Note with the decision" value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className="h-8 min-w-0 flex-1 rounded-md border border-gray-300 px-2 text-sm" />
    <Button size="sm" onClick={() => go(true)}><Check className="h-3.5 w-3.5" />Approve</Button>
    <Button size="sm" variant="outline" className="text-rose-700" onClick={() => go(false)}><X className="h-3.5 w-3.5" />Reject</Button>
  </div>;
}

export function Approvals({ tab }: { tab: "open" | "all" }) {
  const { session } = useApp();
  const rows = useRows("v_approvals", { order: [["requested_at", "desc"]] }).rows;
  const open = rows.filter(a => a.status === "pending");
  const shown = tab === "open" ? open : rows;
  return <>
    <PageHeader title="Approvals" sub="Orders with a margin below the limit wait here before the PI can go out. Set the limits under Admin → Approvals." />
    <TabLinks tabs={[{ to: "/approvals", label: "To decide", count: open.length }, { to: "/approvals/all", label: "All requests" }]} />
    {tab === "open" && !open.length && <Section><p className="py-10 text-center text-sm text-gray-500">Nothing waits for approval.</p></Section>}
    {tab === "open" && open.map(a => <section key={a.id} className="mb-4 rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={orderPath({ pi_number: a.pi_number, id: a.sales_order_id })} className="text-base font-semibold text-gray-900 hover:underline">{a.pi_number ? `PI ${a.pi_number}` : "Draft order"} · {a.customer_name}</Link>
          <div className="mt-0.5 text-sm text-gray-500">{a.order_type} · {money(a.order_value, a.currency)} · asked by {who(a.requested_by, a.requested_by_name, session?.id)}, {dateTime(a.requested_at)}</div>
          {a.note && <p className="mt-2 text-sm text-gray-700">“{a.note}”</p>}
        </div>
        <div className="text-right"><div className="text-2xl font-semibold tabular-nums text-rose-700">{pct(a.current_margin, 1)}</div><div className="text-xs text-gray-500">margin · limit {pct(a.margin_below, 1)}</div></div>
      </div>
      {Number(a.current_margin) < Number(a.margin_pct) - 0.00005 && <p className="mt-2 text-xs text-amber-700">The margin dropped since the request ({pct(a.margin_pct, 1)} then).</p>}
      <div className="mt-4 border-t border-gray-100 pt-3">{canDecide(session?.role, a.approver_role) ? <Decide a={a} /> : <p className="text-sm text-gray-500">Waiting for {ROLE[a.approver_role] ?? "an admin"}.</p>}</div>
    </section>)}
    {tab === "all" && <Section><DataTable rows={shown} rowTo={a => orderPath({ pi_number: a.pi_number, id: a.sales_order_id })} search exportName="approvals" cols={[
      { key: "pi_number", header: "Order", render: a => <span className="font-medium text-gray-900">{a.pi_number ? `PI ${a.pi_number}` : "Draft"}</span> },
      { key: "customer_name", header: "Customer" },
      { key: "margin_pct", header: "Margin asked", align: "right", render: a => pct(a.margin_pct, 1) },
      { key: "margin_below", header: "Limit", align: "right", render: a => pct(a.margin_below, 1) },
      { key: "status", header: "Decision", render: a => <Pill tone={a.status === "approved" ? "green" : a.status === "rejected" ? "red" : "amber"}>{a.status}</Pill> },
      { key: "requested_by_name", header: "Asked by" }, { key: "requested_at", header: "Asked", render: a => dateTime(a.requested_at) },
      { key: "decided_by_name", header: "Decided by", render: a => a.decided_by_name ?? (a.decided_at ? "–" : "") },
      { key: "decision_note", header: "Note", wrap: true }]} /></Section>}
  </>;
}

/** on the order path: shown for a draft whose margin needs approval */
export function OrderApproval({ o }: { o: any }) {
  const { db, run, refresh, session } = useApp();
  const v = useRows("v_order_approval", { eq: { sales_order_id: o.id } }).rows[0];
  const pending = useRows(v?.approval_status === "pending" ? "v_approvals" : null, { eq: { id: v?.approval_id } }).rows[0];
  const [note, setNote] = useState("");
  if (!v || o.status !== "draft") return null;
  const ask = () => run(async () => { await db.rpc("request_approval", { p_order: o.id, p_note: note || null }); refresh(); }, "Approval asked");
  const tone = v.approved_valid ? "border-emerald-200 bg-emerald-50/60" : v.approval_status === "rejected" ? "border-rose-200 bg-rose-50/60" : "border-amber-200 bg-amber-50/60";
  return <section className={cn("mb-6 rounded-xl border px-5 py-3.5", tone)} aria-label="Approval">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <ShieldCheck className={cn("mt-0.5 h-5 w-5 shrink-0", v.approved_valid ? "text-emerald-600" : "text-amber-600")} />
        <div className="min-w-0 text-sm">
          <div className="font-semibold text-gray-900">{v.approved_valid ? "Approved: the PI can go out" : v.approval_status === "pending" ? "Waiting for approval" : v.approval_status === "rejected" ? "Approval rejected" : "Needs approval before the PI goes out"}</div>
          <div className="text-gray-600">Margin {pct(v.margin_pct, 1)} is below {pct(v.margin_below, 1)} ({v.policy_name}).
            {v.approval_status && v.approval_status !== "pending" && <> {v.approval_status === "approved" ? "Approved" : "Rejected"} by {who(v.decided_by, v.decided_by_name, session?.id)}, {dateTime(v.decided_at)}{v.decision_note ? `: “${v.decision_note}”` : ""}.</>}
            {v.approval_status === "approved" && !v.approved_valid && <> The margin dropped below the approved {pct(v.approved_margin, 1)}: ask again.</>}
            {v.approval_status === "pending" && <> Asked by {who(v.requested_by, v.requested_by_name, session?.id)}, {dateTime(v.requested_at)}.</>}</div>
        </div>
      </div>
      {!v.approved_valid && v.approval_status !== "pending" && <div className="flex items-center gap-2">
        <input aria-label="Why (for the approver)" value={note} onChange={e => setNote(e.target.value)} placeholder="Why (optional)" className="h-8 w-48 rounded-md border border-gray-300 bg-white px-2 text-sm" />
        <Button size="sm" onClick={ask}>Ask for approval</Button></div>}
    </div>
    {pending && canDecide(session?.role, pending.approver_role) && <div className="mt-3 border-t border-amber-200/70 pt-3"><Decide a={pending} /></div>}
  </section>;
}

// ---------------- policies (admin) ----------------
export const policyPath = (p: { id: string }) => `/admin/approvals/${String(p.id).slice(0, 8)}`;
export function ApprovalPolicies() {
  const rows = useRows("approval_policies", { order: [["margin_below", "desc"]] }).rows;
  return <><AdminHead />
    <Section title="Approval rules" sub="An order with a margin below the limit stays Draft until it is approved. Orders without a known cost are not judged. Orders already sent are never blocked."
      action={<LinkButton size="sm" to="/admin/approvals/new"><Plus />New rule</LinkButton>}>
      <DataTable rows={rows} rowTo={p => policyPath(p)} empty="No approval rules" cols={[
        { key: "name", header: "Rule", render: p => <span className="font-semibold text-gray-900">{p.name}</span> },
        { key: "text", header: "When", wrap: true, value: p => policyText(p), render: p => policyText(p) },
        { key: "active", header: "", render: p => p.active ? <Pill tone="green">on</Pill> : <Pill>off</Pill> }]} />
    </Section></>;
}
const fields: Field[] = [
  { name: "name", label: "Name", required: true, placeholder: "e.g. Low margin" },
  { name: "margin_below", label: "Approval needed when the margin is below (%)", type: "percent", required: true, span: 1 },
  { name: "order_type", label: "For", type: "select", span: 1, options: [{ value: "", label: "All orders" }, { value: "EXW", label: "EXW orders" }, { value: "FOB", label: "FOB orders" }] },
  { name: "approver_role", label: "Who approves", type: "select", options: [{ value: "admin", label: "Admin" }, { value: "finance", label: "Admin or finance" }] },
  { name: "active", label: "Rule is on", type: "checkbox" },
];
export function ApprovalPolicyForm() {
  const { id } = useParams(); const { db } = useApp();
  const { rows, loading } = useRows("approval_policies");
  const p = id ? byShort(rows, id) : undefined;
  if (loading && !rows.length) return <Loading />;
  if (id && !p) return <NotFound what="Approval rule" back={{ to: "/admin/approvals", label: "Approval rules" }} />;
  return <FormPage title={p ? `Edit ${p.name}` : "New approval rule"} back={{ to: "/admin/approvals", label: "Approval rules" }} fields={fields}
    initial={p ? { ...p, order_type: p.order_type ?? "" } : { active: true, approver_role: "admin", order_type: "" }}
    live={v => v.margin_below != null && v.margin_below !== "" ? <div><div className="mb-1 text-xs font-semibold uppercase tracking-wider text-indigo-400">This rule</div>{policyText({ ...v, margin_below: Number(String(v.margin_below).replace(",", ".")) / 100, order_type: v.order_type || null })}</div> : null}
    onSubmit={async v => {
      const body = { name: v.name, margin_below: v.margin_below, order_type: v.order_type || null, approver_role: v.approver_role || "admin", active: !!v.active };
      if (p) await db.update("approval_policies", { id: p.id }, body); else await db.insert("approval_policies", body);
    }} />;
}

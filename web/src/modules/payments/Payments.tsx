/**
 * Payments module.
 *   /payments            to receive from customers, most urgent first
 *   /payments/suppliers  to pay to suppliers
 *   /payments/ledger     every payment in and out
 *   /payments/:id/void   void a payment (keeps it in the history)
 */
import { useMemo } from "react";
import { BellPlus, Clock, Receipt } from "lucide-react";
import { useApp, useRows } from "@/app/store";
import { Link, useNav, useParams, useQuery } from "@/app/router";
import { byShort, orderPath, poPath } from "@/app/paths";
import { DataTable, FormPage, Loading, NotFound, Notice, PageHeader, Pill, Section, StatusPill, TabLinks, selectClass } from "@/app/ui";
import { BUCKET_LABEL, BUCKET_TONE, date, dateShort, days, money } from "@/app/format";
import { cn } from "@/lib/utils";
import { newTaskPath, taskPath } from "@/modules/tasks/Tasks";

const ORDER = ["overdue", "reminder", "due_soon", "no_due_date", "scheduled"];
const RANK: Record<string, number> = Object.fromEntries(ORDER.map((b, i) => [b, i]));

function PaymentTabs() {
  const totals = useRows("v_open_items_totals").rows;
  const n = (d: string) => totals.filter(t => t.direction === d).reduce((a, t) => a + Number(t.items), 0);
  return <TabLinks tabs={[{ to: "/payments", label: "To receive", count: n("in") }, { to: "/payments/suppliers", label: "To pay", count: n("out") }, { to: "/payments/ledger", label: "Ledger" }]} />;
}

/** amounts per currency, one per line: euro and dollar are never added together */
const PerCurrency = ({ rows, k, empty = "–" }: { rows: any[]; k: string; empty?: string }) => {
  const shown = rows.filter(r => Number(r[k]) > 0);
  return shown.length ? <div className="space-y-0.5">{shown.map(r => <div key={r.currency}>{money(r[k], r.currency, 0)}</div>)}</div> : <span className="text-gray-400">{empty}</span>;
};

export function OpenItems({ direction }: { direction: "in" | "out" }) {
  const nav = useNav(); const q = useQuery();
  const bucket = q.get("bucket") ?? ""; const cur = q.get("currency") ?? "";
  const base = direction === "in" ? "/payments" : "/payments/suppliers";
  const set = (k: string, v: string) => { const n = new URLSearchParams(q); if (v) n.set(k, v); else n.delete(k); nav(`${base}${n.toString() ? "?" + n : ""}`, { replace: true }); };
  const items = useRows("v_open_items", { eq: { direction } });
  const totals = useRows("v_open_items_totals", { eq: { direction } }).rows;
  const summary = useRows("v_open_items_summary", { eq: { direction } }).rows;
  const count = (b: string) => summary.filter(s => s.bucket === b && (!cur || s.currency === cur)).reduce((a, s) => a + Number(s.items), 0);
  // open tasks per order / PO, so you see whether someone is already chasing it
  const tasks = useRows("v_tasks", { eq: { status: "open" } }).rows;
  const taskFor = (r: any) => tasks.filter(t => direction === "in" ? t.sales_order_id === r.id : t.purchase_order_id === r.id).sort((a, b) => String(a.due_date ?? "9").localeCompare(String(b.due_date ?? "9")))[0];
  const rows = useMemo(() => items.rows.filter(r => (!bucket || r.bucket === bucket) && (!cur || r.currency === cur))
    .sort((a, b) => RANK[a.bucket] - RANK[b.bucket] || Number(b.days_late ?? 0) - Number(a.days_late ?? 0) || Number(b.days_open ?? -1) - Number(a.days_open ?? -1)),
    [items.rows, bucket, cur]);
  const t = totals.filter(x => !cur || x.currency === cur);
  const undated = t.reduce((a, x) => a + Number(x.undated_items), 0), all = t.reduce((a, x) => a + Number(x.items), 0);
  const isIn = direction === "in";
  const pathOf = (r: any) => isIn ? orderPath({ pi_number: r.reference, id: r.id }) : poPath({ po_number: r.reference });

  return <>
    <PageHeader title="Payments" sub={isIn ? "Everything customers still have to pay, most urgent first." : "Everything we still have to pay to suppliers, most urgent first."} />
    <PaymentTabs />

    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <SummaryCard label={isIn ? "Still to receive" : "Still to pay"} value={<PerCurrency rows={t} k="outstanding" empty="nothing open" />} hint={`${all} open ${isIn ? "order" : "PO"}${all === 1 ? "" : "s"}`} />
      <SummaryCard label="Overdue" tone={t.some(x => Number(x.overdue_amount) > 0) ? "bad" : undefined} value={<PerCurrency rows={t} k="overdue_amount" empty="none" />}
        hint={`${count("overdue")} past their due date`} onClick={() => set("bucket", "overdue")} active={bucket === "overdue"} />
      <SummaryCard label={isIn ? "Reminder or due within 7 days" : "Due within 7 days"} tone={count("reminder") + count("due_soon") > 0 ? "warn" : undefined}
        value={<span className="tabular-nums">{count("reminder") + count("due_soon")}</span>} hint={isIn ? `${count("reminder")} EXW reminder${count("reminder") === 1 ? "" : "s"}, ${count("due_soon")} due soon` : `${count("due_soon")} due soon`}
        onClick={() => set("bucket", count("reminder") ? "reminder" : "due_soon")} active={bucket === "reminder" || bucket === "due_soon"} />
      <SummaryCard label="No due date" tone={undated ? "warn" : undefined} value={<PerCurrency rows={t} k="undated_amount" empty="none" />}
        hint={`${undated} of ${all} cannot be judged late or on time`} onClick={() => set("bucket", "no_due_date")} active={bucket === "no_due_date"} />
    </div>

    {undated > 0 && !bucket && <Notice tone="amber" className="mb-6">
      <b>{undated} of {all}</b> open amounts have no due date, so the app cannot tell whether they are late. They are listed by how long they have been open.
      Set a due date on the {isIn ? "order" : "PO"} (Edit → Payment terms) to track lateness.
    </Notice>}

    <Section>
      <DataTable rows={rows} rowTo={pathOf} exportName={isIn ? "to-receive" : "to-pay"} empty={bucket ? `Nothing in "${BUCKET_LABEL[bucket]}"` : "Nothing open"} search
        toolbar={<>
          <div className="flex flex-wrap gap-1">
            {[["", "All", all], ...ORDER.filter(b => isIn || b !== "reminder").map(b => [b, BUCKET_LABEL[b], count(b)])].map(([b, label, n]) =>
              <button key={String(b)} onClick={() => set("bucket", String(b))} className={cn("rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                bucket === b ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200")}>{label} <span className="tabular-nums opacity-70">{n}</span></button>)}
          </div>
          <select aria-label="Currency" className={selectClass + " h-8 w-28"} value={cur} onChange={e => set("currency", e.target.value)}><option value="">EUR + USD</option><option>EUR</option><option>USD</option></select>
        </>}
        cols={[
          { key: "reference", header: isIn ? "PI#" : "PO#", value: r => RANK[r.bucket] * 1e6 + Number(r.reference), render: r => <div><div className="font-semibold text-gray-900">{r.reference}</div><div className="mt-1"><Pill tone={BUCKET_TONE[r.bucket]}>{BUCKET_LABEL[r.bucket]}</Pill></div></div> },
          { key: "party", header: isIn ? "Customer" : "Supplier", wrap: true, render: r => <div className="min-w-40"><div className="text-gray-900">{r.party}</div><div className="text-xs text-gray-500">{r.order_type} · {r.currency}</div></div> },
          ...(isIn ? [{ key: "status", header: "Order status", render: (r: any) => <StatusPill status={r.status} /> }] : []),
          { key: "outstanding", header: "Outstanding", align: "right", render: r => <div><div className={cn("font-semibold", r.bucket === "overdue" ? "text-rose-600" : "text-gray-900")}>{money(r.outstanding, r.currency)}</div>
              <div className="text-xs text-gray-500">{Number(r.paid) ? `${money(r.paid, r.currency, 0)} paid of ${money(r.total, r.currency, 0)}` : `of ${money(r.total, r.currency, 0)}`}</div></div> },
          { key: "next_due_date", header: "Due", render: r => r.next_due_date ? <div>{dateShort(r.next_due_date)}<div className="text-xs text-gray-500">{r.next_due_part}</div></div>
              : <div>{r.reminder_due ? <span className="text-amber-700">reminder since {dateShort(r.reminder_date)}</span> : <span className="text-gray-400">not set</span>}
                  <div><Link to={pathOf(r) + "/edit"} className="text-xs text-indigo-600 hover:underline">set due date</Link></div></div> },
          { key: "days", header: "Late / open", value: r => r.days_late ?? -1, render: r => r.days_late ? <span className="font-semibold text-rose-600">{days(r.days_late)} late</span>
              : r.days_open != null ? <span className={cn("inline-flex items-center gap-1", Number(r.days_open) > 60 ? "font-medium text-amber-700" : "text-gray-600")}><Clock className="h-3 w-3" />{days(r.days_open)}</span>
              : <span className="text-gray-400">date unknown</span> },
          { key: "act", header: "", render: r => { const t = taskFor(r); const part = r.next_due_part === "deposit" ? "deposit" : "payment";
              return <div className="flex flex-col items-end gap-1">
                <Link to={pathOf(r) + "/payment"} className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-600"><Receipt className="h-3.5 w-3.5" />Payment</Link>
                {t ? <Link to={taskPath(t)} title={t.title} className="text-xs text-gray-500 hover:text-indigo-600">task {t.due_date ? dateShort(t.due_date) : "open"}</Link>
                  : <Link to={newTaskPath({ ...(isIn ? { order: r.reference } : { po: r.reference }), title: isIn ? `Chase ${part} PI ${r.reference} (${r.party})` : `Pay ${part} PO ${r.reference} (${r.party})`, due: r.next_due_date, back: isIn ? "/payments" : "/payments/suppliers" })}
                      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600"><BellPlus className="h-3 w-3" />add task</Link>}
              </div>; } },
        ]} />
    </Section>
  </>;
}

function SummaryCard({ label, value, hint, tone, onClick, active }: { label: string; value: React.ReactNode; hint?: string; tone?: "bad" | "warn"; onClick?: () => void; active?: boolean }) {
  const Tag = onClick ? "button" : "div";
  return <Tag onClick={onClick} className={cn("rounded-xl border bg-white px-5 py-4 text-left shadow-sm transition-colors", onClick && "hover:border-gray-300", active ? "border-indigo-400 ring-1 ring-indigo-200" : "border-gray-200/80")}>
    <div className="text-xs font-medium text-gray-500">{label}</div>
    <div className={cn("mt-1.5 text-xl font-semibold tracking-tight tabular-nums text-gray-900", tone === "bad" && "text-rose-600", tone === "warn" && "text-amber-600")}>{value}</div>
    {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
  </Tag>;
}

export const ToReceive = () => <OpenItems direction="in" />;
export const ToPay = () => <OpenItems direction="out" />;

export function Ledger() {
  const nav = useNav(); const q = useQuery(); const dir = q.get("direction") ?? "";
  const allocs = useRows("v_allocations", { order: [["payment_date", "desc"]] }).rows;
  const payments = useRows("v_payments", { order: [["payment_date", "desc"]] }).rows;
  const credit = useRows("v_customer_credit").rows; const customers = useRows("customers").rows;
  const cName = Object.fromEntries(customers.map(c => [c.id, c.name]));
  const rows = payments.filter(p => !dir || p.direction === dir).map(p => ({ ...p, links: allocs.filter(a => a.payment_id === p.id) }));
  const withCredit = credit.filter(c => Number(c.credit) > 0);
  return <>
    <PageHeader title="Payments" sub="Every payment received and made. Register a payment from the order or the PO it belongs to." />
    <PaymentTabs />
    {withCredit.length > 0 && <Notice tone="sky" className="mb-6"><b>Customer credit:</b> {withCredit.map(c => `${cName[c.customer_id] ?? "?"} ${money(c.credit, c.currency)}`).join(" · ")}</Notice>}
    <Section>
      <DataTable rows={rows} search exportName="payments" empty="No payments registered yet"
        toolbar={<select aria-label="Direction" className={selectClass + " h-8 w-40"} value={dir} onChange={e => nav(`/payments/ledger${e.target.value ? "?direction=" + e.target.value : ""}`, { replace: true })}>
          <option value="">In and out</option><option value="in">Received</option><option value="out">Paid</option></select>}
        cols={[{ key: "payment_date", header: "Date", render: p => date(p.payment_date) },
          { key: "direction", header: "", render: p => p.direction === "in" ? <Pill tone="green">Received</Pill> : <Pill>Paid</Pill> },
          { key: "party_name", header: "Party", render: p => <span className="text-gray-900">{p.party_name}</span> }, { key: "reference", header: "Reference" },
          { key: "for", header: "For", value: p => p.links.map((a: any) => a.pi_number ?? a.po_number).join(", "),
            render: p => p.links.length ? p.links.map((a: any) => <Link key={a.id} className="mr-2 text-indigo-600 hover:underline"
              to={a.sales_order_id ? orderPath({ pi_number: a.pi_number, id: a.sales_order_id }) : poPath({ po_number: a.po_number })}>{a.sales_order_id ? "PI " + a.pi_number : "PO " + a.po_number}</Link>) : "–" },
          { key: "amount", header: "Amount", align: "right", render: p => <span className={p.voided_at ? "text-gray-400 line-through" : "font-medium text-gray-900"}>{money(p.amount, p.currency)}</span> },
          { key: "unallocated", header: "Not allocated", align: "right", render: p => Number(p.unallocated) > 0 ? <span className="text-amber-600">{money(p.unallocated, p.currency)}</span> : "–" },
          { key: "voided_at", header: "", render: p => p.voided_at ? <Pill tone="red">Voided: {p.void_reason}</Pill>
              : <Link to={`/payments/${String(p.id).slice(0, 8)}/void`} className="text-xs text-rose-600 hover:underline">void</Link> }]} />
    </Section>
  </>;
}

export function VoidPayment() {
  const { id } = useParams(); const q = useQuery(); const { db } = useApp();
  const { rows, loading } = useRows("v_payments");
  const p = byShort(rows, id);
  const back = { to: q.get("back") ?? "/payments/ledger", label: q.get("back") ? "Back" : "Ledger" };
  if (!p) return loading ? <Loading /> : <NotFound what="Payment" back={back} />;
  return <FormPage title="Void payment" back={back} submitLabel="Void payment"
    sub={`${p.direction === "in" ? "Received from" : "Paid to"} ${p.party_name} on ${date(p.payment_date)}: ${money(p.amount, p.currency)}. The payment stays in the history, marked as voided, and no longer counts.`}
    fields={[{ name: "p_reason", label: "Reason", required: true }]} onSubmit={async v => { await db.rpc("void_payment", { p_payment: p.id, ...v }); }} />;
}

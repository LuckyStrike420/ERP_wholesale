/**
 * Tasks and reminders: /tasks, /tasks/new?order=26185&title=…&due=…&back=…, /tasks/1a2b3c4d
 * A task is always linked to at least one record (order, PO, customer, supplier) and shows on that record too.
 * A task on an order also shows on its customer; a task on a PO also on its supplier (the database fills that in).
 */
import { useMemo, useState, type ReactNode } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useRows } from "@/app/store";
import { Link, useNav, useParams, useQuery } from "@/app/router";
import { byShort, bySlug, customerPath, findOrder, orderPath, poPath, supplierPath } from "@/app/paths";
import { ConfirmDialog, DataTable, FormPage, Loading, NotFound, PageHeader, Pill, Section, Stat, TabLinks, LinkButton, type Field } from "@/app/ui";
import { dateShort, dateTime, TASK_STATE_LABEL, TASK_STATE_TONE } from "@/app/format";
import { cn } from "@/lib/utils";

export const taskPath = (t: { id: string }) => `/tasks/${String(t.id).slice(0, 8)}`;
/** link to a new task, already linked to the record you come from */
export const newTaskPath = (p: { order?: string | null; po?: string | null; customer?: string | null; supplier?: string | null; title?: string; due?: string | null; back?: string }) =>
  "/tasks/new?" + new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();

const RANK: Record<string, number> = { overdue: 0, today: 1, upcoming: 2, no_date: 3, done: 4 };
const sortTasks = (rows: any[]) => [...rows].sort((a, b) => RANK[a.state] - RANK[b.state] || String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999")));

/** the records a task belongs to, as links */
export function TaskLinks({ t, hide }: { t: any; hide?: string[] }) {
  const items: ReactNode[] = [];
  if (t.sales_order_id && !hide?.includes("order")) items.push(<Link key="o" to={orderPath({ pi_number: t.pi_number, id: t.sales_order_id })} className="hover:text-indigo-600">{t.pi_number ? `PI ${t.pi_number}` : "draft order"}</Link>);
  if (t.purchase_order_id && !hide?.includes("po")) items.push(<Link key="p" to={poPath({ po_number: t.po_number })} className="hover:text-indigo-600">PO {t.po_number}</Link>);
  if (t.customer_id && !hide?.includes("customer")) items.push(<Link key="c" to={customerPath({ name: t.customer_name })} className="hover:text-indigo-600">{t.customer_name}</Link>);
  if (t.supplier_id && !hide?.includes("supplier")) items.push(<Link key="s" to={supplierPath({ name: t.supplier_name })} className="hover:text-indigo-600">{t.supplier_name}</Link>);
  return <span className="text-xs text-gray-500">{items.map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>)}</span>;
}

/** tick a task off (or open it again) without leaving the page */
function DoneBox({ t }: { t: any }) {
  const { db, run } = useApp(); const done = t.status === "done";
  return <button type="button" aria-label={done ? `Reopen ${t.title}` : `Mark ${t.title} as done`} aria-pressed={done}
    onClick={e => { e.stopPropagation(); run(() => db.update("tasks", { id: t.id }, { status: done ? "open" : "done" }), done ? "Task reopened" : "Task done"); }}
    className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors", done ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300 bg-white hover:border-indigo-500")}>
    {done && <Check className="h-3 w-3" />}</button>;
}

/** compact list for a record page or the dashboard */
export function TaskItems({ rows, hide, empty = "No open tasks" }: { rows: any[]; hide?: string[]; empty?: ReactNode }) {
  const nav = useNav();
  if (!rows.length) return <p className="px-5 py-6 text-center text-sm text-gray-500">{empty}</p>;
  return <ul className="divide-y divide-gray-100">{sortTasks(rows).map(t => (
    <li key={t.id} onClick={() => nav(taskPath(t))} className="flex cursor-pointer items-start gap-3 px-5 py-2.5 transition-colors hover:bg-gray-50">
      <DoneBox t={t} />
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm", t.status === "done" ? "text-gray-400 line-through" : "font-medium text-gray-900")}>{t.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2"><TaskLinks t={t} hide={hide} />{t.assigned_name && <span className="text-xs text-gray-400">· {t.assigned_name}</span>}</div>
      </div>
      {t.status !== "done" && <span className="shrink-0 text-right text-xs">{t.due_date ? <Pill tone={TASK_STATE_TONE[t.state]}>{t.state === "today" ? "Today" : dateShort(t.due_date)}</Pill> : <span className="text-gray-400">no date</span>}</span>}
    </li>))}</ul>;
}

/** the tasks block on an order, PO, customer or supplier page */
export function TasksSection({ eq, newLink, hide, className }: { eq: Record<string, string>; newLink: string; hide?: string[]; className?: string }) {
  const rows = useRows("v_tasks", { eq }).rows;
  const [showDone, setShowDone] = useState(false);
  const open = rows.filter(t => t.status === "open"), done = rows.filter(t => t.status === "done");
  return <Section title={<span className="flex items-center gap-2">Tasks{open.length > 0 && <span className="rounded-full bg-gray-100 px-1.5 text-[11px] tabular-nums text-gray-600">{open.length}</span>}</span>} className={className}
    action={<LinkButton size="sm" variant="outline" to={newLink}><Plus />New task</LinkButton>}>
    <TaskItems rows={showDone ? [...open, ...done] : open} hide={hide} />
    {done.length > 0 && <button type="button" onClick={() => setShowDone(s => !s)} className="w-full border-t border-gray-100 px-5 py-2 text-left text-xs text-gray-500 hover:text-gray-900">
      {showDone ? "Hide done tasks" : `Show ${done.length} done task${done.length === 1 ? "" : "s"}`}</button>}
  </Section>;
}

// ---------------- /tasks ----------------
export function Tasks() {
  const q = useQuery(); const show = q.get("show") ?? "open"; const { db } = useApp();
  const { rows } = useRows("v_tasks");
  const open = rows.filter(t => t.status === "open");
  const count = (s: string) => open.filter(t => t.state === s).length;
  const shown = sortTasks(show === "done" ? rows.filter(t => t.status === "done") : show === "all" ? rows : open);
  return <>
    <PageHeader title="Tasks" sub="Reminders and to-dos, each linked to an order, PO, customer or supplier."><LinkButton to="/tasks/new"><Plus />New task</LinkButton></PageHeader>
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat label="Overdue" value={count("overdue")} tone={count("overdue") ? "bad" : undefined} />
      <Stat label="Due today" value={count("today")} tone={count("today") ? "warn" : undefined} />
      <Stat label="Upcoming" value={count("upcoming")} />
      <Stat label="Without date" value={count("no_date")} />
    </div>
    <TabLinks tabs={[{ to: "/tasks", label: "Open", count: open.length }, { to: "/tasks?show=done", label: "Done" }, { to: "/tasks?show=all", label: "All" }]} />
    <Section>
      <DataTable rows={shown} search exportName="tasks" rowTo={t => taskPath(t)} selectable bulk={(sel, clear) => <TasksBulk rows={sel} clear={clear} />} empty={show === "done" ? "No tasks done yet" : "Nothing to do. New tasks can be made from any order, PO or customer."}
        rowClass={t => t.status === "done" ? "text-gray-400" : undefined}
        cols={[
          { key: "x", header: "", width: "2.5rem", render: t => <DoneBox t={t} /> },
          { key: "title", header: "Task", wrap: true, edit: { kind: "text", save: (t, v) => db.update("tasks", { id: t.id }, { title: v }) }, render: t => <div><div className={t.status === "done" ? "line-through" : "font-medium text-gray-900"}>{t.title}</div>{t.details && <div className="line-clamp-1 text-xs text-gray-500">{t.details}</div>}</div> },
          { key: "links", header: "Linked to", value: t => [t.pi_number, t.po_number, t.customer_name, t.supplier_name].filter(Boolean).join(" "), render: t => <TaskLinks t={t} /> },
          { key: "due_date", header: "Due", edit: { kind: "date", save: (t, v) => db.update("tasks", { id: t.id }, { due_date: v }) }, render: t => t.due_date ? <span className="inline-flex items-center gap-2">{dateShort(t.due_date)}{t.status === "open" && t.state !== "upcoming" && <Pill tone={TASK_STATE_TONE[t.state]}>{TASK_STATE_LABEL[t.state]}</Pill>}</span> : <span className="text-gray-400">–</span> },
          { key: "assigned_name", header: "For", render: t => t.assigned_name ?? <span className="text-gray-400">anyone</span> },
          ...(show !== "open" ? [{ key: "done_at", header: "Done on", render: (t: any) => t.done_at ? dateShort(t.done_at) : "–" }] : []),
        ]} />
    </Section>
  </>;
}

function TasksBulk({ rows, clear }: { rows: any[]; clear: () => void }) {
  const { db, run } = useApp(); const [due, setDue] = useState(""); const [confirm, setConfirm] = useState(false);
  const all = (what: string, fn: (t: any) => Promise<unknown>) => run(async () => { for (const t of rows) await fn(t); }, `${what}: ${rows.length} task${rows.length === 1 ? "" : "s"}`).then(clear);
  return <div className="flex flex-wrap items-center gap-2">
    <Button size="sm" className="h-8" onClick={() => all("Done", t => db.update("tasks", { id: t.id }, { status: "done" }))}><Check className="h-3.5 w-3.5" />Mark done</Button>
    <Button size="sm" variant="outline" className="h-8 bg-white" onClick={() => all("Reopened", t => db.update("tasks", { id: t.id }, { status: "open" }))}>Reopen</Button>
    <span className="mx-1 h-5 w-px bg-indigo-200" />
    <input type="date" aria-label="New due date" value={due} onChange={e => setDue(e.target.value)} className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm" />
    <Button size="sm" variant="outline" className="h-8 bg-white" disabled={!due} onClick={() => all("Due date set", t => db.update("tasks", { id: t.id }, { due_date: due }))}>Set due date</Button>
    <Button size="sm" variant="ghost" className="h-8 text-rose-600" onClick={() => setConfirm(true)}><Trash2 className="h-3.5 w-3.5" />Delete</Button>
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={`Delete ${rows.length} task${rows.length === 1 ? "" : "s"}?`} body="They are removed from every record they are linked to." confirmLabel="Delete"
      onConfirm={() => all("Deleted", t => db.remove("tasks", { id: t.id }))} />
  </div>;
}

// ---------------- /tasks/new and /tasks/:id ----------------
export function TaskForm() {
  const { id } = useParams(); const q = useQuery(); const { db, run } = useApp(); const nav = useNav();
  const tasks = useRows("v_tasks"); const orders = useRows("v_orders", { order: [["po_date", "desc"]] }); const pos = useRows("v_purchase_orders", { order: [["po_number", "desc"]] });
  const customers = useRows("customers", { order: [["name", "asc"]] }); const suppliers = useRows("suppliers", { order: [["name", "asc"]] }); const profiles = useRows("profiles");
  const [confirm, setConfirm] = useState(false);
  const t = id ? byShort(tasks.rows, id) : undefined;
  const loading = tasks.loading || orders.loading || pos.loading || customers.loading || suppliers.loading || profiles.loading;
  const initial = useMemo(() => {
    if (t) return t;
    const o = q.get("order") ? findOrder(orders.rows, q.get("order")!) : undefined;
    const p = q.get("po") ? pos.rows.find(x => x.po_number === q.get("po")) : undefined;
    return { title: q.get("title") ?? "", due_date: q.get("due") ?? "", sales_order_id: o?.id, purchase_order_id: p?.id,
      customer_id: o ? undefined : q.get("customer") ? bySlug(customers.rows, q.get("customer")!)?.id : undefined,
      supplier_id: p ? undefined : q.get("supplier") ? bySlug(suppliers.rows, q.get("supplier")!)?.id : undefined };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, t?.id]);
  if (loading) return <Loading />;
  if (id && !t) return <NotFound what="Task" back={{ to: "/tasks", label: "All tasks" }} />;
  const back = q.get("back") ?? "/tasks";
  // "← PI 26185" rather than "← Back"
  const part = decodeURIComponent(back.split("?")[0].split("/")[2] ?? "");
  const backLabel = back.startsWith("/orders/") ? `PI ${part}` : back.startsWith("/purchasing/") ? `PO ${part}` : back.startsWith("/payments") ? "Payments"
    : back.startsWith("/customers/") ? customers.rows.find(c => customerPath(c) === back)?.name ?? "Customer"
    : back.startsWith("/suppliers/") ? suppliers.rows.find(s => supplierPath(s) === back)?.name ?? "Supplier" : "Tasks";
  const fields: Field[] = [
    { name: "title", label: "What needs to happen", required: true, placeholder: "e.g. Chase the deposit" },
    { name: "due_date", label: "Due / remind me on", type: "date", span: 1 },
    { name: "assigned_to", label: "For", type: "select", span: 1, options: profiles.rows.map(p => ({ value: p.user_id, label: p.full_name ?? p.role })), hint: "Empty = anyone" },
    { name: "details", label: "Details", type: "textarea" },
    { name: "sales_order_id", label: "Order", type: "select", span: 1, section: "Linked to", options: orders.rows.map(o => ({ value: o.id, label: `${o.pi_number ? `PI ${o.pi_number}` : "Draft"} · ${o.customer_name}` })) },
    { name: "purchase_order_id", label: "Purchase order", type: "select", span: 1, section: "Linked to", options: pos.rows.map(p => ({ value: p.id, label: `PO ${p.po_number} · ${p.supplier_name}` })) },
    { name: "customer_id", label: "Customer", type: "select", span: 1, section: "Linked to", options: customers.rows.map(c => ({ value: c.id, label: c.name })), hint: "Filled in from the order when empty" },
    { name: "supplier_id", label: "Supplier", type: "select", span: 1, section: "Linked to", options: suppliers.rows.map(s => ({ value: s.id, label: s.name })), hint: "Filled in from the PO when empty" },
  ];
  return <>
    <FormPage title={t ? "Edit task" : "New task"} back={{ to: back, label: backLabel }} fields={fields} initial={initial} done={back}
      submitLabel={t ? "Save" : "Create task"}
      sub={t ? <>Created {dateTime(t.created_at)}{t.created_by_name ? ` by ${t.created_by_name}` : ""}{t.done_at ? ` · done ${dateTime(t.done_at)}` : ""}</> : "Link the task to at least one record: it then shows on that order, PO, customer or supplier."}
      onSubmit={async v => {
        if (!v.sales_order_id && !v.purchase_order_id && !v.customer_id && !v.supplier_id) throw new Error("Link the task to at least one order, purchase order, customer or supplier");
        if (t) await db.update("tasks", { id: t.id }, v); else await db.insert("tasks", v);
      }}
      aside={t && <Section title="This task">
        <div className="space-y-3 px-5 py-4">
          <div className="flex items-center gap-2 text-sm"><Pill tone={TASK_STATE_TONE[t.state]}>{TASK_STATE_LABEL[t.state]}</Pill>{t.days_late ? <span className="text-rose-600">{t.days_late} days late</span> : null}</div>
          <Button variant="outline" className="w-full" onClick={() => run(() => db.update("tasks", { id: t.id }, { status: t.status === "done" ? "open" : "done" }), t.status === "done" ? "Task reopened" : "Task done").then(() => nav(back))}>
            <Check className="h-4 w-4" />{t.status === "done" ? "Reopen task" : "Mark as done"}</Button>
          <Button variant="ghost" className="w-full text-rose-600" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />Delete task</Button>
        </div></Section>} />
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title="Delete this task?" body="A done task can also simply stay as done. Deleting removes it from every record it is linked to."
      confirmLabel="Delete" onConfirm={() => t && run(() => db.remove("tasks", { id: t.id }), "Task deleted").then(() => nav(back))} />
  </>;
}

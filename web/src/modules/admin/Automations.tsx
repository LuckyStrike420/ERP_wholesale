/**
 * Automation rules ("when this, then that"): /admin/automations, /admin/automations/new, /admin/automations/1a2b3c4d
 * WHEN an order reaches a status / a date comes within N days / the margin is below X%
 * ONLY IF EXW or FOB, and/or the deposit / balance / anything is still open
 * THEN a task (title, due date, for whom) or a flag on the order.
 * The database runs them: right after a change, every hour, and when the app opens. A rule makes its task once per order.
 */
import { useState } from "react";
import { Play, Plus, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useRows } from "@/app/store";
import { useNav, useParams } from "@/app/router";
import { byShort } from "@/app/paths";
import { ConfirmDialog, DataTable, FormPage, LinkButton, Loading, NotFound, Pill, Section, type Field } from "@/app/ui";
import { dateShort, pct, STATUS_LABEL, STATUS_ORDER } from "@/app/format";
import { toast } from "@/app/notify";
import { AdminHead } from "./Admin";

export const rulePath = (r: { id: string }) => `/admin/automations/${String(r.id).slice(0, 8)}`;
const DATE_LABEL: Record<string, string> = { eta: "the ETA", etd: "the ETD", deposit_due_date: "the deposit due date", balance_due_date: "the balance due date" };
const DUE_LABEL: Record<string, string> = { ...DATE_LABEL, today: "the day the rule fires" };
const ONLY_LABEL: Record<string, string> = { deposit_open: "the deposit is still open", balance_open: "the balance is still open", anything_open: "anything is still open" };

/** the rule in one sentence */
export function ruleText(r: any) {
  const when = r.trigger_type === "status_reached" ? <>an order reaches <b>{STATUS_LABEL[r.status] ?? "…"}</b></>
    : r.trigger_type === "date_within" ? <><b>{DATE_LABEL[r.date_field] ?? "a date"}</b> is within <b>{r.within_days ?? "…"} days</b></>
    : r.trigger_type === "margin_below" ? <>the margin is below <b>{r.margin_pct != null ? pct(r.margin_pct, 1) : "…"}</b></> : <>…</>;
  const only = [r.order_type && <>it is <b>{r.order_type}</b></>, r.only_if && ONLY_LABEL[r.only_if]].filter(Boolean);
  const d = Number(r.task_due_days ?? 0);
  const due = !r.task_due ? "without a due date" : `due ${d === 0 ? "on" : `${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} ${d < 0 ? "before" : "after"}`} ${DUE_LABEL[r.task_due]}`;
  const then = r.action === "flag" ? <>flag the order: <b>“{r.flag_text || "…"}”</b></> : <>make the task <b>“{r.task_title || "…"}”</b>, {due}{r.assign_name ? `, for ${r.assign_name}` : ""}</>;
  return <>When {when}{only.length > 0 && <> and {only.map((x, i) => <span key={i}>{i > 0 && " and "}{x}</span>)}</>}: {then}.</>;
}

export function Automations() {
  const { db, run, refresh } = useApp();
  const { rows } = useRows("v_automation_rules", { order: [["created_at", "asc"]] });
  const runNow = async () => { const n = await run(() => db.rpc<number>("run_automations"), undefined); if (n !== undefined) { toast.success(n ? `${n} task${n === 1 ? "" : "s"} made` : "Nothing new to do"); refresh(); } };
  return <><AdminHead />
    <Section title="Automation rules" sub="When this happens, then do that. Rules run right after a change, every hour, and when the app opens; a task is made once per order."
      action={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={runNow}><Play className="h-3.5 w-3.5" />Run now</Button><LinkButton size="sm" to="/admin/automations/new"><Plus />New rule</LinkButton></div>}>
      <DataTable rows={rows} rowTo={r => rulePath(r)} empty="No rules yet" cols={[
        { key: "active", header: "On", width: "3rem", render: r => <input type="checkbox" aria-label={`Rule ${r.name} on`} checked={r.active} className="h-4 w-4 accent-indigo-600"
            onClick={e => e.stopPropagation()} onChange={() => run(() => db.update("automation_rules", { id: r.id }, { active: !r.active }), r.active ? "Rule switched off" : "Rule switched on")} /> },
        { key: "name", header: "Rule", wrap: true, render: r => <div className={r.active ? "" : "opacity-50"}><div className="flex items-center gap-2 font-medium text-gray-900"><Zap className="h-3.5 w-3.5 text-amber-500" />{r.name}</div>
            <div className="mt-0.5 text-xs leading-relaxed text-gray-600">{ruleText(r)}</div></div> },
        { key: "action", header: "Does", render: r => <Pill tone={r.action === "flag" ? "amber" : "blue"}>{r.action === "flag" ? "Flag" : "Task"}</Pill> },
        { key: "runs", header: "Tasks made", align: "right", render: r => r.action === "flag" ? <span className="text-gray-400">live</span> : `${r.runs}${r.last_run ? ` · last ${dateShort(r.last_run)}` : ""}` },
      ]} />
    </Section></>;
}

export function AutomationForm() {
  const { id } = useParams(); const { db, run } = useApp(); const nav = useNav();
  const rules = useRows("automation_rules"); const profiles = useRows("profiles").rows;
  const [confirm, setConfirm] = useState(false);
  if (rules.loading && !rules.rows.length) return <Loading />;
  const r = id ? byShort(rules.rows, id) : undefined;
  if (id && !r) return <NotFound what="Rule" back={{ to: "/admin/automations", label: "Automation rules" }} />;
  const isTask = (v: any) => v.action === "task", isFlag = (v: any) => v.action === "flag";
  const fields: Field[] = [
    { name: "name", label: "Name", required: true, placeholder: "e.g. PI sent: chase the deposit" },
    { name: "active", label: "Rule is on", type: "checkbox" },
    { name: "trigger_type", label: "When", type: "select", required: true, section: "When", options: [
      { value: "status_reached", label: "An order reaches a status" }, { value: "date_within", label: "A date comes within a number of days" }, { value: "margin_below", label: "The margin of an order is below …" }] },
    { name: "status", label: "Status", type: "select", section: "When", show: v => v.trigger_type === "status_reached", options: STATUS_ORDER.filter(s => s !== "draft").map(s => ({ value: s, label: STATUS_LABEL[s] })),
      hint: "Only orders that reach this status after the rule was made" },
    { name: "date_field", label: "Date", type: "select", span: 1, section: "When", show: v => v.trigger_type === "date_within", options: Object.entries(DATE_LABEL).map(([value, label]) => ({ value, label: label.replace("the ", "") })) },
    { name: "within_days", label: "Within … days", type: "number", span: 1, section: "When", show: v => v.trigger_type === "date_within" },
    { name: "margin_pct", label: "Margin below %", type: "percent", section: "When", show: v => v.trigger_type === "margin_below", hint: "Only orders with a cost price on every line" },
    { name: "order_type", label: "Order type", type: "select", span: 1, section: "Only if", options: [{ value: "EXW", label: "Only EXW" }, { value: "FOB", label: "Only FOB" }], hint: "Empty = both" },
    { name: "only_if", label: "Still open", type: "select", span: 1, section: "Only if", options: Object.entries(ONLY_LABEL).map(([value, label]) => ({ value, label: label.replace(" is still open", " open").replace(/^the /, "").replace(/^\w/, c => c.toUpperCase()) })), hint: "Empty = always" },
    { name: "action", label: "Then", type: "select", required: true, section: "Then", options: [{ value: "task", label: "Make a task on the order" }, { value: "flag", label: "Flag the order" }] },
    { name: "task_title", label: "Task", section: "Then", show: isTask, placeholder: "Chase deposit PI {pi} ({customer})", hint: "{pi}, {customer} and {type} are filled in" },
    { name: "task_due", label: "Due date", type: "select", span: 1, section: "Then", show: isTask, options: Object.entries(DUE_LABEL).map(([value, label]) => ({ value, label: label.replace(/^the /, "").replace(/^\w/, c => c.toUpperCase()) })) },
    { name: "task_due_days", label: "Days after (minus = before)", type: "number", span: 1, section: "Then", show: isTask },
    { name: "assign_to", label: "For", type: "select", section: "Then", show: isTask, options: profiles.map(p => ({ value: p.user_id, label: p.full_name ?? p.role })), hint: "Empty = anyone. The person gets a notification." },
    { name: "flag_text", label: "Flag text", section: "Then", show: isFlag, placeholder: "Low margin: {margin}", hint: "{margin}, {pi} and {customer} are filled in" },
  ];
  const initial = r ?? { active: true, trigger_type: "status_reached", status: "pi_sent", action: "task", task_due: "deposit_due_date", task_due_days: 0, only_if: "deposit_open" };
  return <>
    <FormPage title={r ? r.name : "New rule"} back={{ to: "/admin/automations", label: "Automation rules" }} fields={fields} initial={initial} done="/admin/automations"
      live={v => <div><div className="mb-1 text-xs font-semibold uppercase tracking-wider text-indigo-400">This rule</div>{ruleText({ ...v, margin_pct: v.margin_pct === "" || v.margin_pct == null ? null : Number(String(v.margin_pct).replace(",", ".")) / 100, assign_name: profiles.find(p => p.user_id === v.assign_to)?.full_name })}</div>}
      onSubmit={async v => {
        const body = { ...v, active: !!v.active, task_due_days: v.task_due_days ?? 0 };
        if (r) await db.update("automation_rules", { id: r.id }, body); else await db.insert("automation_rules", body);
      }}
      aside={r && <Section title="This rule"><div className="space-y-3 px-5 py-4 text-sm text-gray-600">
        <p>Tasks already made stay when you change or switch off the rule.</p>
        <Button variant="ghost" className="w-full text-rose-600" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />Delete rule</Button></div></Section>} />
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={`Delete "${r?.name}"?`} body="Tasks it made stay. Switching it off keeps it for later." confirmLabel="Delete"
      onConfirm={() => r && run(() => db.remove("automation_rules", { id: r.id }), "Rule deleted").then(() => nav("/admin/automations"))} />
  </>;
}

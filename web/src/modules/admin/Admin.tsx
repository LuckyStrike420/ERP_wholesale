/**
 * Admin: /admin (settings), /admin/settings/:key, /admin/rates, /admin/rates/new, /admin/users, /admin/users/:id, /admin/audit, /admin/import
 */
import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useRows } from "@/app/store";
import { useParams } from "@/app/router";

import { ConfirmDialog, DataTable, FormPage, LinkButton, Loading, NotFound, PageHeader, Pill, Section, SeverityPill, TabLinks } from "@/app/ui";
import { date, dateTime, money } from "@/app/format";
import type { ImportResult } from "@/data/client";

const changed = (a: any) => {
  if (a.action !== "UPDATE") return a.action === "INSERT" ? "created" : "deleted";
  const keys = Object.keys(a.new_data ?? {}).filter(k => JSON.stringify(a.new_data[k]) !== JSON.stringify(a.old_data?.[k]));
  return keys.map(k => `${k}: ${a.old_data?.[k] ?? "–"} → ${a.new_data[k] ?? "–"}`).join("; ");
};
export const AdminHead = () => <>
  <PageHeader title="Admin" sub="Settings, payment terms, exchange rates, users, the audit log and the workbook import." />
  <TabLinks tabs={[{ to: "/admin", label: "Settings" }, { to: "/admin/payment-terms", label: "Payment terms" }, { to: "/admin/rates", label: "Exchange rates" }, { to: "/admin/users", label: "Users" }, { to: "/admin/audit", label: "Audit log" }, { to: "/admin/import", label: "Import" }]} />
</>;

export function Settings() {
  const settings = useRows("app_settings", { order: [["key", "asc"]] }).rows;
  return <><AdminHead /><Section title="Calculation settings" sub="Click a setting to change it. You see the effect before it is saved.">
    <DataTable rows={settings.map(s => ({ ...s, id: s.key }))} rowTo={r => `/admin/settings/${r.key}`}
      cols={[{ key: "description", header: "Setting", render: r => <span className="text-gray-900">{r.description}</span> }, { key: "value", header: "Value", align: "right", render: r => <span className="font-semibold text-gray-900">{r.value}</span> },
        { key: "key", header: "Key", render: r => <code className="text-xs text-gray-500">{r.key}</code> }]} />
  </Section></>;
}

const HINT: Record<string, string> = { cost_decimals: "Whole number, 0 to 6", payment_tolerance: "Amount, 0 to 1", exw_reminder_working_days: "Whole number of working days, 0 to 60", fob_balance_days_before_eta: "Whole number of days, 0 to 365", reporting_currency: "EUR or USD" };
const METRIC: Record<string, string> = { margin_not_final: "Margin on orders without final costs", orders_overdue: "Orders overdue", overdue_amount: "Overdue amount", reminders_due: "EXW payment reminders", orders_paid: "Orders counted as paid" };

export function SettingForm() {
  const { key } = useParams(); const { db } = useApp();
  const { rows, loading } = useRows("app_settings", { eq: { key } }); const s = rows[0];
  if (!s) return loading ? <Loading /> : <NotFound what="Setting" back={{ to: "/admin", label: "Settings" }} />;
  return <FormPage title={s.description} sub={s.key.startsWith("company_") || s.key === "pi_footer" ? "Shown on the proforma invoice (PI) document." : `Current value: ${s.value}. A change applies from now on to every calculation that uses it. Costs that are already final do not change.`}
    back={{ to: "/admin", label: "Settings" }} initial={s} fields={[{ name: "value", label: "New value", required: !s.key.startsWith("company_") && s.key !== "pi_footer", hint: HINT[s.key],
      type: ["company_address", "company_bank", "pi_footer", "company_vat", "company_contact"].includes(s.key) ? "textarea" : "text" }]}
    onSubmit={async v => {
      const value = String(v.value ?? "").trim();
      const rows = await db.rpc<any[]>("preview_setting_change", { p_key: s.key, p_value: value });
      const go = async () => { await db.update("app_settings", { key: s.key }, { value }); };
      if (!rows.length) return go();
      return { confirm: { title: "This setting changes existing figures", label: "Save the setting", go,
        body: <table className="w-full text-sm"><thead><tr className="border-b text-left text-xs"><th className="py-1">Figure</th><th>Cur</th><th className="text-right">Now</th><th className="text-right">After</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} className="border-b last:border-0"><td className="py-1">{METRIC[r.metric] ?? r.metric}</td><td>{r.currency}</td><td className="text-right tabular-nums">{Number(r.value_before)}</td><td className="text-right font-semibold tabular-nums">{Number(r.value_after)}</td></tr>)}</tbody></table> } };
    }} />;
}

export function Rates() {
  const rates = useRows("fx_rates", { order: [["rate_date", "desc"]] }).rows;
  return <><AdminHead /><Section title="Exchange rates for the combined EUR total" action={<LinkButton size="sm" to="/admin/rates/new"><Plus />Add rate</LinkButton>}>
    <DataTable rows={rates.map(r => ({ ...r, id: r.rate_date + r.currency }))} empty="No rates yet: reports show EUR and USD separately, without a combined total"
      cols={[{ key: "rate_date", header: "From date", render: r => date(r.rate_date) }, { key: "currency", header: "Currency" },
        { key: "rate", header: "1 unit in EUR", align: "right", render: r => money(r.rate, null, 4) }, { key: "source", header: "Source" }]} />
    <p className="border-t border-gray-100 px-5 py-2.5 text-xs text-gray-500">A rate applies from its date until the next one. An order is converted at the rate on its PO date. This is for reporting only: invoices and payments stay in their own currency.</p>
  </Section></>;
}
export function RateNew() {
  const { db } = useApp();
  return <FormPage title="Add exchange rate" back={{ to: "/admin/rates", label: "Exchange rates" }} initial={{ currency: "USD" }}
    fields={[{ name: "rate_date", label: "From date", type: "date", required: true, span: 1 }, { name: "currency", label: "Currency", required: true, span: 1 },
      { name: "rate", label: "Value of 1 unit in EUR", type: "number", required: true, hint: "Example: 0.92 means 1 USD = 0.92 EUR" }, { name: "source", label: "Source", required: true, hint: "Where the rate comes from, e.g. ECB reference rate of that date" }]}
    onSubmit={async v => { await db.insert("fx_rates", v); }} />;
}

export function Users() {
  const { db } = useApp(); const profiles = useRows("profiles").rows;
  return <><AdminHead /><Section title="Users and roles">
    {db.mode === "local" && <p className="border-b bg-amber-50 px-5 py-2.5 text-sm text-amber-900">The local test database has no sign-in: you work as admin.</p>}
    <DataTable rows={profiles.map(p => ({ ...p, id: p.user_id }))} empty="No users yet" rowTo={db.mode === "supabase" ? r => `/admin/users/${String(r.user_id).slice(0, 8)}` : undefined}
      cols={[{ key: "full_name", header: "Name", render: r => <span className="text-gray-900">{r.full_name ?? "–"}</span> }, { key: "role", header: "Role", render: r => <Pill tone="blue">{r.role}</Pill> }, { key: "user_id", header: "User id", render: r => <code className="text-xs text-gray-500">{r.user_id}</code> }]} />
    <p className="border-t border-gray-100 px-5 py-2.5 text-xs text-gray-500">admin: everything. operations: orders, purchasing, shipping, stock, master data. finance: payments, write-offs, exchange rates. All roles can read everything. New users sign up in Supabase (Authentication → Users) and then get a role here.</p>
  </Section></>;
}
export function UserForm() {
  const { id } = useParams(); const { db } = useApp();
  const { rows, loading } = useRows("profiles"); const u = rows.find(p => String(p.user_id).startsWith(id));
  if (!u) return loading ? <Loading /> : <NotFound what="User" back={{ to: "/admin/users", label: "Users" }} />;
  return <FormPage title={`Edit ${u.full_name ?? "user"}`} back={{ to: "/admin/users", label: "Users" }} initial={u}
    fields={[{ name: "full_name", label: "Name" }, { name: "role", label: "Role", type: "select", required: true, options: ["admin", "finance", "operations"].map(r => ({ value: r, label: r })) }]}
    onSubmit={async v => { await db.update("profiles", { user_id: u.user_id }, v); }} />;
}

export function Audit() {
  const audit = useRows("audit_log", { order: [["id", "desc"]], limit: 300 }).rows;
  return <><AdminHead /><Section title="Audit log, latest 300 changes">
    <DataTable rows={audit} search exportName="audit-log" dense
      cols={[{ key: "changed_at", header: "When", render: a => dateTime(a.changed_at), width: "9.5rem" }, { key: "table_name", header: "Record" }, { key: "action", header: "Action" },
        { key: "change", header: "Change", value: changed, render: a => <span className="break-all text-xs">{changed(a)}</span> }]} />
  </Section></>;
}

export function Import() {
  const { db, run, refresh } = useApp();
  const runs = useRows("import_runs", { order: [["started_at", "desc"]], limit: 1 }).rows;
  const issues = useRows(runs[0] ? "import_issues" : null, { eq: { run_id: runs[0]?.id } }).rows;
  const [imp, setImp] = useState<{ result: ImportResult; saved: boolean; name: string; data: Uint8Array } | null>(null); const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"reset" | "empty" | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const doImport = async (data: Uint8Array, name: string, commit: boolean) => {
    setBusy(true); const r = await run(() => db.importWorkbook!(data, name, commit), commit ? "Import finished" : undefined);
    if (r) setImp({ ...r, name, data }); setBusy(false);
  };
  const failed = imp?.result.reconciliation.filter(r => !r.ok) ?? [];
  const issueCols = [{ key: "severity", header: "", render: (r: any) => <SeverityPill s={r.severity} /> }, { key: "sheet", header: "Sheet" }, { key: "row_no", header: "Row", align: "right" as const }, { key: "message", header: "Remark" }];
  return <><AdminHead />
    <Section title="Import the Excel workbook">
      {db.mode === "supabase"
        ? <p className="px-5 py-4 text-sm text-gray-700">On Supabase the import runs from the command line, in one transaction: <code>npm run import -- --file workbook.xlsx</code> shows the dry run, adding <code>--commit</code> saves it.</p>
        : <div className="px-5 py-4 text-sm text-gray-700">
            <p className="mb-3">Choose the workbook to see what would be imported. Nothing is saved until you confirm, and nothing can be saved while a figure differs from Excel. Records that already exist are skipped, so importing twice is safe.</p>
            <input ref={file} type="file" accept=".xlsx" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) await doImport(new Uint8Array(await f.arrayBuffer()), f.name, false); e.target.value = ""; }} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => file.current?.click()} disabled={busy}>{busy ? "Reading…" : "Choose workbook (dry run)"}</Button>
              <Button variant="outline" onClick={() => setConfirm("reset")}>Reset test data</Button>
              <Button variant="outline" onClick={() => setConfirm("empty")}>Start with an empty database</Button>
            </div>
          </div>}
    </Section>
    {imp && <Section title={`${imp.saved ? "Imported" : "Dry run"}: ${imp.name}`} className="mt-6"
      action={!imp.saved && !failed.length && <Button size="sm" disabled={busy} onClick={() => doImport(imp.data, imp.name, true)}>Save this import</Button>}>
      <div className="grid gap-4 px-5 py-4 text-sm md:grid-cols-3">
        <div><div className="mb-1 font-medium">New records</div>{Object.entries(imp.result.created).map(([t, n]) => <div key={t} className="flex justify-between"><span>{t}</span><span className="tabular-nums">{n}</span></div>)}</div>
        <div><div className="mb-1 font-medium">Already present, skipped</div>{Object.entries(imp.result.skipped).map(([t, n]) => <div key={t} className="flex justify-between"><span>{t}</span><span className="tabular-nums">{n}</span></div>)}</div>
        <div><div className="mb-1 font-medium">Reconciliation with Excel</div><div>{imp.result.reconciliation.length} figures compared</div>
          <div className={failed.length ? "font-semibold text-rose-600" : "text-emerald-600"}>{failed.length ? `${failed.length} differ: the import cannot be saved` : "all match"}</div></div>
      </div>
      <DataTable rows={[...failed.map((r, i) => ({ id: "f" + i, severity: "error", sheet: r.area, row_no: null, message: `${r.item}: Excel ${r.excel}, app ${r.app}` })), ...imp.result.issues.map((x: any, i) => ({ id: i, ...x, row_no: x.row }))]} dense empty="No remarks" cols={issueCols} />
    </Section>}
    {!imp && runs[0] && <Section title={`Last saved import: ${runs[0].file_name}, ${dateTime(runs[0].started_at)}`} className="mt-6">
      <DataTable rows={issues} dense empty="No remarks" cols={issueCols} />
    </Section>}
    <ConfirmDialog open={confirm === "reset"} onClose={() => setConfirm(null)} danger title="Reset the test data?" confirmLabel="Reset"
      body="Everything entered in this local test database is thrown away and the imported workbook is loaded again." onConfirm={() => run(async () => { await db.reset!(); setImp(null); refresh(); }, "Test data reset")} />
    <ConfirmDialog open={confirm === "empty"} onClose={() => setConfirm(null)} danger title="Empty the test database?" confirmLabel="Empty it"
      body="All data is removed. Use this to rehearse the import from scratch." onConfirm={() => run(async () => { await db.reset!(true); setImp(null); refresh(); }, "Database emptied")} />
  </>;
}


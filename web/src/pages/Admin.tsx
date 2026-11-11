import { useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useApp, useRows } from "@/app/store";
import { ConfirmDialog, DataTable, FormDialog, PageHeader, Pill, Section, SeverityPill } from "@/app/ui";
import { date, dateTime, money } from "@/app/format";
import type { ImportResult } from "@/data/client";

const changed = (a: any) => {
  if (a.action !== "UPDATE") return a.action === "INSERT" ? "created" : "deleted";
  const keys = Object.keys(a.new_data ?? {}).filter(k => JSON.stringify(a.new_data[k]) !== JSON.stringify(a.old_data?.[k]));
  return keys.map(k => `${k}: ${a.old_data?.[k] ?? "–"} → ${a.new_data[k] ?? "–"}`).join("; ");
};

export default function Admin() {
  const { db, save, run, refresh } = useApp();
  const settings = useRows("app_settings", { order: [["key", "asc"]] }).rows;
  const rates = useRows("fx_rates", { order: [["rate_date", "desc"]] }).rows;
  const profiles = useRows("profiles").rows;
  const audit = useRows("audit_log", { order: [["id", "desc"]], limit: 300 }).rows;
  const runs = useRows("import_runs", { order: [["started_at", "desc"]], limit: 1 }).rows;
  const issues = useRows("import_issues", runs[0] ? { eq: { run_id: runs[0].id } } : {}).rows;
  const [dlg, setDlg] = useState<{ kind: string; row?: any } | null>(null);
  const [imp, setImp] = useState<{ result: ImportResult; saved: boolean; name: string; data: Uint8Array } | null>(null); const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const doImport = async (data: Uint8Array, name: string, commit: boolean) => {
    setBusy(true);
    const r = await run(() => db.importWorkbook!(data, name, commit), commit ? "Import finished" : undefined);
    if (r) setImp({ ...r, name, data });
    setBusy(false);
  };
  const failed = imp?.result.reconciliation.filter(r => !r.ok) ?? [];
  return <>
    <PageHeader title="Admin" sub="Settings, exchange rates, users, the audit log and the workbook import." />
    <Tabs defaultValue="settings">
      <TabsList className="mb-4"><TabsTrigger value="settings">Settings</TabsTrigger><TabsTrigger value="rates">Exchange rates</TabsTrigger><TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="audit">Audit log</TabsTrigger><TabsTrigger value="import">Import</TabsTrigger></TabsList>

      <TabsContent value="settings"><Section title="Calculation settings">
        <DataTable rows={settings.map(s => ({ ...s, id: s.key }))} onRow={r => setDlg({ kind: "setting", row: r })}
          cols={[{ key: "description", header: "Setting" }, { key: "value", header: "Value", align: "right" }, { key: "key", header: "Key", render: r => <code className="text-xs text-muted-foreground">{r.key}</code> }]} />
      </Section></TabsContent>

      <TabsContent value="rates"><Section title="Exchange rates for the combined EUR total" action={<Button size="sm" onClick={() => setDlg({ kind: "rate" })}>Add rate</Button>}>
        <DataTable rows={rates.map(r => ({ ...r, id: r.rate_date + r.currency }))} empty="No rates yet: reports show EUR and USD separately, without a combined total"
          cols={[{ key: "rate_date", header: "From date", render: r => date(r.rate_date) }, { key: "currency", header: "Currency" },
            { key: "rate", header: "1 unit in EUR", align: "right", render: r => money(r.rate, null, 4) }, { key: "source", header: "Source" }]} />
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">A rate applies from its date until the next one. An order is converted at the rate on its PO date. This is for reporting only: invoices and payments stay in their own currency.</p>
      </Section></TabsContent>

      <TabsContent value="users"><Section title="Users and roles">
        {db.mode === "local" && <p className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-900">The local test database has no sign-in: you work as admin. Users and roles start to apply after the move to Supabase.</p>}
        <DataTable rows={profiles.map(p => ({ ...p, id: p.user_id }))} empty="No users yet" onRow={db.mode === "supabase" ? r => setDlg({ kind: "user", row: r }) : undefined}
          cols={[{ key: "full_name", header: "Name" }, { key: "role", header: "Role", render: r => <Pill tone="blue">{r.role}</Pill> }, { key: "user_id", header: "User id", render: r => <code className="text-xs text-muted-foreground">{r.user_id}</code> }]} />
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">admin: everything. operations: orders, purchasing, shipping, stock, master data. finance: payments, write-offs, exchange rates. All roles can read everything.</p>
      </Section></TabsContent>

      <TabsContent value="audit"><Section title="Audit log, latest 300 changes">
        <DataTable rows={audit} search exportName="audit-log" dense
          cols={[{ key: "changed_at", header: "When", render: a => dateTime(a.changed_at), width: "9.5rem" }, { key: "table_name", header: "Record" }, { key: "action", header: "Action" },
            { key: "change", header: "Change", value: changed, render: a => <span className="break-all text-xs">{changed(a)}</span> }]} />
      </Section></TabsContent>

      <TabsContent value="import">
        <Section title="Import the Excel workbook">
          {db.mode === "supabase"
            ? <p className="px-4 py-3 text-sm">On Supabase the import runs from the command line, in one transaction: <code>npm run import -- --file workbook.xlsx</code> shows the dry run, adding <code>--commit</code> saves it.</p>
            : <div className="px-4 py-3 text-sm">
                <p className="mb-3">Choose the workbook to see what would be imported. Nothing is saved until you confirm, and nothing can be saved while a figure differs from Excel. Records that already exist are skipped, so importing twice is safe.</p>
                <input ref={file} type="file" accept=".xlsx" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) await doImport(new Uint8Array(await f.arrayBuffer()), f.name, false); e.target.value = ""; }} />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => file.current?.click()} disabled={busy}>{busy ? "Reading…" : "Choose workbook (dry run)"}</Button>
                  <Button variant="outline" onClick={() => setDlg({ kind: "reset" })}>Reset test data</Button>
                  <Button variant="outline" onClick={() => setDlg({ kind: "empty" })}>Start with an empty database</Button>
                </div>
              </div>}
        </Section>
        {imp && <Section title={`${imp.saved ? "Imported" : "Dry run"}: ${imp.name}`} className="mt-4"
          action={!imp.saved && !failed.length && <Button size="sm" disabled={busy} onClick={() => doImport(imp.data, imp.name, true)}>Save this import</Button>}>
          <div className="grid gap-4 px-4 py-3 text-sm md:grid-cols-3">
            <div><div className="mb-1 font-medium">New records</div>{Object.entries(imp.result.created).map(([t, n]) => <div key={t} className="flex justify-between"><span>{t}</span><span className="tabular-nums">{n}</span></div>)}{!Object.keys(imp.result.created).length && <span className="text-muted-foreground">none</span>}</div>
            <div><div className="mb-1 font-medium">Already present, skipped</div>{Object.entries(imp.result.skipped).map(([t, n]) => <div key={t} className="flex justify-between"><span>{t}</span><span className="tabular-nums">{n}</span></div>)}{!Object.keys(imp.result.skipped).length && <span className="text-muted-foreground">none</span>}</div>
            <div><div className="mb-1 font-medium">Reconciliation with Excel</div><div>{imp.result.reconciliation.length} figures compared</div>
              <div className={failed.length ? "font-semibold text-red-700" : "text-emerald-700"}>{failed.length ? `${failed.length} differ: the import cannot be saved` : "all match"}</div></div>
          </div>
          <DataTable rows={[...failed.map((r, i) => ({ id: "f" + i, severity: "error", sheet: r.area, row: null, message: `${r.item}: Excel ${r.excel}, app ${r.app}` })), ...imp.result.issues.map((x, i) => ({ id: i, ...x }))]} dense empty="No remarks"
            cols={[{ key: "severity", header: "", render: r => <SeverityPill s={r.severity} /> }, { key: "sheet", header: "Sheet" }, { key: "row", header: "Row", align: "right" }, { key: "message", header: "Remark" }]} />
        </Section>}
        {!imp && runs[0] && <Section title={`Last saved import: ${runs[0].file_name}, ${dateTime(runs[0].started_at)}`} className="mt-4">
          <DataTable rows={issues} dense empty="No remarks"
            cols={[{ key: "severity", header: "", render: r => <SeverityPill s={r.severity} /> }, { key: "sheet", header: "Sheet" }, { key: "row_no", header: "Row", align: "right" }, { key: "message", header: "Remark" }]} />
        </Section>}
      </TabsContent>
    </Tabs>

    <FormDialog open={dlg?.kind === "setting"} onClose={() => setDlg(null)} title={dlg?.row?.description ?? "Setting"} description="Changing a setting changes every calculation that uses it, from now on."
      initial={dlg?.row} fields={[{ name: "value", label: "Value", required: true }]} onSubmit={v => save(() => db.update("app_settings", { key: dlg!.row.key }, v), "Setting saved")} />
    <FormDialog open={dlg?.kind === "rate"} onClose={() => setDlg(null)} title="Add exchange rate" initial={{ currency: "USD", source: "ECB reference rate" }}
      fields={[{ name: "rate_date", label: "From date", type: "date", required: true, span: 1 }, { name: "currency", label: "Currency", required: true, span: 1 },
        { name: "rate", label: "Value of 1 unit in EUR", type: "number", required: true, hint: "Example: 0.92 means 1 USD = 0.92 EUR" }, { name: "source", label: "Source" }]}
      onSubmit={v => save(() => db.insert("fx_rates", v), "Rate added")} />
    <FormDialog open={dlg?.kind === "user"} onClose={() => setDlg(null)} title="Edit user" initial={dlg?.row}
      fields={[{ name: "full_name", label: "Name" }, { name: "role", label: "Role", type: "select", required: true, options: ["admin", "finance", "operations"].map(r => ({ value: r, label: r })) }]}
      onSubmit={v => save(() => db.update("profiles", { user_id: dlg!.row.user_id }, v), "User saved")} />
    <ConfirmDialog open={dlg?.kind === "reset"} onClose={() => setDlg(null)} danger title="Reset the test data?" confirmLabel="Reset"
      body="Everything entered in this local test database is thrown away and the imported workbook is loaded again." onConfirm={() => run(async () => { await db.reset!(); setImp(null); refresh(); }, "Test data reset")} />
    <ConfirmDialog open={dlg?.kind === "empty"} onClose={() => setDlg(null)} danger title="Empty the test database?" confirmLabel="Empty it"
      body="All data is removed. Use this to rehearse the import from scratch." onConfirm={() => run(async () => { await db.reset!(true); setImp(null); refresh(); }, "Database emptied")} />
  </>;
}

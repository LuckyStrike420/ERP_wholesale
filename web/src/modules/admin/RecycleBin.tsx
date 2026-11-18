/**
 * Admin → Recycle bin (/admin/recycle-bin): deleted orders, order lines and documents, kept 30 days.
 * Restore puts a deletion back as a whole (an order with its lines, tasks, notes …). Admin can remove for good.
 */
import { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp, useRows } from "@/app/store";
import { ConfirmDialog, DataTable, Section } from "@/app/ui";
import { dateTime, date } from "@/app/format";
import { useCan } from "@/app/permissions";
import { AdminHead } from "./Admin";

const KIND: Record<string, string> = { sales_orders: "Order", sales_order_lines: "Order line", attachments: "Document", generated_documents: "Document", tasks: "Task", record_notes: "Note", order_adjustments: "Correction", approvals: "Approval", order_cost_lines: "Cost line" };

export function RecycleBin() {
  const { db, run, refresh, session } = useApp(); const can = useCan();
  const rows = useRows("v_recycle_bin", { order: [["deleted_at", "desc"]] }).rows;
  const [gone, setGone] = useState<any>(null);
  const restore = (b: any) => run(async () => { await db.rpc("restore_deleted", { p_batch: b.batch }); refresh(); }, `${b.label} restored`);
  return <><AdminHead />
    <Section title="Recycle bin" sub="Deleted orders, order lines and documents stay here for 30 days. Restoring puts everything back that was deleted with it.">
      <DataTable rows={rows.map(r => ({ ...r, id: r.batch }))} empty="The recycle bin is empty" cols={[
        { key: "label", header: "Deleted", render: r => <div><div className="font-medium text-gray-900">{r.label}</div>
          <div className="text-xs text-gray-500">{KIND[r.main_table] ?? r.main_table}{r.rows > 1 ? ` · with ${r.rows - 1} related record${r.rows === 2 ? "" : "s"} (${Object.keys(r.tables).filter(t => t !== r.main_table).map(t => (KIND[t] ?? t).toLowerCase() + "s").join(", ")})` : ""}</div></div> },
        { key: "deleted_by_name", header: "By", render: r => r.deleted_by_name ?? "–" },
        { key: "deleted_at", header: "When", render: r => dateTime(r.deleted_at) },
        { key: "purge_on", header: "Removed for good on", render: r => date(r.purge_on) },
        { key: "act", header: "", render: r => <span className="flex justify-end gap-1">
          {can("delete_records") && <Button size="sm" variant="outline" onClick={() => restore(r)}><RotateCcw className="h-3.5 w-3.5" />Restore</Button>}
          {session?.role !== "finance" && session?.role !== "operations" && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setGone(r)}><Trash2 className="h-3.5 w-3.5" /></Button>}</span> }]} />
    </Section>
    <ConfirmDialog open={!!gone} onClose={() => setGone(null)} danger title={`Remove "${gone?.label}" for good?`} body="It can no longer be restored. Document files are deleted too." confirmLabel="Remove for good"
      onConfirm={() => run(async () => { await db.rpc("purge_recycle_bin", { p_batch: gone.batch }); refresh(); }, "Removed for good")} />
  </>;
}

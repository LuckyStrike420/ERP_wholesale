/**
 * Admin → Permissions (/admin/permissions): per role, what it may do. Admin may always do everything.
 * Write permissions are enforced by the database; "See costs and margins" hides those fields in the app.
 */
import { Check } from "lucide-react";
import { useApp, useRows } from "@/app/store";
import { Section } from "@/app/ui";
import { PERMISSIONS } from "@/app/permissions";
import { cn } from "@/lib/utils";
import { AdminHead } from "./Admin";

const ROLES = [{ key: "finance", label: "Finance" }, { key: "operations", label: "Operations" }];

export function Permissions() {
  const { db, run, refresh } = useApp();
  const rows = useRows("role_permissions").rows; const people = useRows("profiles").rows;
  const allowed = (role: string, p: string) => !!rows.find(r => r.role === role && r.permission === p)?.allowed;
  const toggle = (role: string, p: string) => run(async () => { await db.update("role_permissions", { role, permission: p }, { allowed: !allowed(role, p) }); refresh(); },
    `${ROLES.find(r => r.key === role)?.label}: ${PERMISSIONS.find(x => x.key === p)?.label.toLowerCase()} ${allowed(role, p) ? "off" : "on"}`);
  return <><AdminHead />
    <Section title="Permissions per role" sub="On top of each role's area (operations: orders and purchasing; finance: payments). Admin may always do everything. Who has which role: Admin → Users.">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
          <th className="px-5 py-2.5">Permission</th>
          <th className="w-28 px-3 py-2.5 text-center">Admin</th>
          {ROLES.map(r => <th key={r.key} className="w-28 px-3 py-2.5 text-center">{r.label}<div className="font-normal normal-case tracking-normal text-gray-400">{people.filter(p => p.role === r.key).length} user(s)</div></th>)}
        </tr></thead>
        <tbody className="divide-y divide-gray-100">{PERMISSIONS.map(p => <tr key={p.key}>
          <td className="px-5 py-3"><div className="font-medium text-gray-900">{p.label}</div><div className="text-xs text-gray-500">{p.detail}</div></td>
          <td className="px-3 py-3 text-center"><span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-gray-100 text-gray-400" title="Admin may always"><Check className="h-4 w-4" /></span></td>
          {ROLES.map(r => { const on = allowed(r.key, p.key);
            return <td key={r.key} className="px-3 py-3 text-center">
              <button type="button" role="switch" aria-checked={on} aria-label={`${p.label} for ${r.label}`} onClick={() => toggle(r.key, p.key)}
                className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors", on ? "bg-indigo-600" : "bg-gray-200")}>
                <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} /></button></td>; })}
        </tr>)}</tbody>
      </table>
      <p className="border-t border-gray-100 px-5 py-2.5 text-xs text-gray-500">Changes count straight away. Someone who is not allowed gets a clear message when they try; buttons they cannot use are hidden.</p>
    </Section></>;
}

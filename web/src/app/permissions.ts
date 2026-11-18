/** Finer permissions per role (Admin → Permissions). Admin may always; the database enforces the write permissions. */
import { useApp, useRows } from "@/app/store";

export const PERMISSIONS: { key: string; label: string; detail: string }[] = [
  { key: "see_costs", label: "See costs and margins", detail: "Purchase prices, cost rules, margins, purchase orders and reports. Hidden in the app when off." },
  { key: "edit_prices", label: "Change sale prices", detail: "Prices on order lines, standard sale prices and price agreements." },
  { key: "register_payments", label: "Register customer payments", detail: "Also voiding or changing them." },
  { key: "pay_suppliers", label: "Register supplier payments", detail: "Also voiding or changing them." },
  { key: "manage_purchasing", label: "Purchase orders", detail: "Create and change purchase orders and supplier invoices." },
  { key: "delete_records", label: "Delete", detail: "Orders, order lines, documents, customers, suppliers and products." },
  { key: "export_data", label: "Export", detail: "Copy and CSV buttons on tables." },
];

/** can("see_costs") for the signed-in user; while the rules load, everything is allowed */
export function useCan() {
  const { session } = useApp();
  const rows = useRows(session?.role && session.role !== "admin" ? "role_permissions" : null).rows;
  return (p: string) => !session?.role || session.role === "admin" || rows.length === 0 || !!rows.find(r => r.role === session.role && r.permission === p)?.allowed;
}

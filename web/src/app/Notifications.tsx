/**
 * The bell: messages for you (a task assigned to you, someone mentioning you with @Name) and, live,
 * what needs your attention now (your tasks overdue or due today, overdue customer payments).
 * Messages are checked every minute and whenever something changes in the app.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AtSign, Bell, CheckCheck, CheckSquare, Receipt } from "lucide-react";
import { useApp, useRows } from "./store";
import { useNav } from "./router";
import { customerPath, orderPath, poPath, supplierPath } from "./paths";
import { taskPath } from "@/modules/tasks/Tasks";
import { cn } from "@/lib/utils";

const ago = (v: string) => {
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
};
const where = (n: any) => n.task_id ? taskPath({ id: n.task_id }) : n.sales_order_id ? orderPath({ pi_number: n.pi_number, id: n.sales_order_id })
  : n.purchase_order_id ? poPath({ po_number: n.po_number }) : n.customer_id ? customerPath({ name: n.customer_name }) : n.supplier_id ? supplierPath({ name: n.supplier_name }) : "/";
const about = (n: any) => [n.pi_number && `PI ${n.pi_number}`, n.po_number && `PO ${n.po_number}`, n.customer_name, n.supplier_name].filter(Boolean).join(" · ");

export function NotificationBell({ className }: { className?: string }) {
  const { db, session, version } = useApp(); const nav = useNav();
  const [items, setItems] = useState<any[]>([]); const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null); const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const load = () => db.select<any>("v_notifications", { order: [["created_at", "desc"]], limit: 40 }).then(setItems).catch(() => undefined);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [db, version]);   // eslint-disable-line react-hooks/exhaustive-deps
  const tasks = useRows("v_tasks", { eq: { status: "open" } }).rows.filter(t => !t.assigned_to || t.assigned_to === session?.id);
  const totals = useRows("v_open_items_totals").rows;
  const late = tasks.filter(t => t.state === "overdue").length, today = tasks.filter(t => t.state === "today").length;
  const overduePay = totals.filter(t => t.direction === "in").reduce((a, t) => a + Number(t.overdue_items), 0);
  const unread = items.filter(n => !n.read_at).length;

  useLayoutEffect(() => {
    if (!open) return; const r = btn.current?.getBoundingClientRect(); if (!r) return;
    const w = Math.min(384, window.innerWidth - 16);
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: r.bottom + 6 });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const openItem = async (n: any) => {
    setOpen(false); nav(where(n));
    if (!n.read_at) { await db.update("notifications", { id: n.id }, { read_at: new Date().toISOString() }).catch(() => undefined); load(); }
  };
  const readAll = async () => { for (const n of items.filter(x => !x.read_at)) await db.update("notifications", { id: n.id }, { read_at: new Date().toISOString() }).catch(() => undefined); load(); };
  const go = (to: string) => { setOpen(false); nav(to); };

  return <>
    <button ref={btn} type="button" onClick={() => setOpen(o => !o)} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open}
      className={cn("relative rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900", className)}>
      <Bell className="h-[18px] w-[18px]" />
      {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>}
    </button>
    {open && pos && createPortal(
      <div ref={panel} role="dialog" aria-label="Notifications" style={{ position: "fixed", left: pos.left, top: pos.top, width: Math.min(384, window.innerWidth - 16) }}
        className="z-[60] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-gray-900">Notifications</h2>
          {unread > 0 && <button type="button" onClick={readAll} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"><CheckCheck className="h-3.5 w-3.5" />Mark all read</button>}
        </header>
        {(late > 0 || today > 0 || overduePay > 0) && <div className="space-y-1 border-b border-gray-100 bg-gray-50/60 px-4 py-2.5 text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Needs your attention</div>
          {late > 0 && <button type="button" onClick={() => go("/tasks")} className="flex w-full items-center gap-2 text-left text-rose-700 hover:underline"><CheckSquare className="h-4 w-4" />{late} task{late === 1 ? "" : "s"} overdue</button>}
          {today > 0 && <button type="button" onClick={() => go("/tasks")} className="flex w-full items-center gap-2 text-left text-amber-800 hover:underline"><CheckSquare className="h-4 w-4" />{today} task{today === 1 ? "" : "s"} due today</button>}
          {overduePay > 0 && <button type="button" onClick={() => go("/payments?bucket=overdue")} className="flex w-full items-center gap-2 text-left text-rose-700 hover:underline"><Receipt className="h-4 w-4" />{overduePay} customer payment{overduePay === 1 ? "" : "s"} overdue</button>}
        </div>}
        <ul className="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto">
          {!items.length && <li className="px-4 py-8 text-center text-sm text-gray-500">Nothing yet. You get a message here when a task is assigned to you or someone mentions you with @{session?.name ?? "your name"}.</li>}
          {items.map(n => <li key={n.id}>
            <button type="button" onClick={() => openItem(n)} className={cn("flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50", !n.read_at && "bg-indigo-50/40")}>
              <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", n.kind === "mention" ? "bg-amber-50 text-amber-700" : "bg-indigo-50 text-indigo-600")}>
                {n.kind === "mention" ? <AtSign className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}</span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm", n.read_at ? "text-gray-700" : "font-semibold text-gray-900")}>{n.title}</span>
                {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-gray-600">{n.body}</span>}
                <span className="mt-0.5 block text-xs text-gray-400">{[about(n), ago(n.created_at)].filter(Boolean).join(" · ")}</span>
              </span>
              {!n.read_at && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-indigo-600" aria-label="unread" />}
            </button></li>)}
        </ul>
      </div>, document.body)}
  </>;
}

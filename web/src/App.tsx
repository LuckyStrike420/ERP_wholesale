import { useEffect, useState } from "react";
import { AlertTriangle, BarChart3, Boxes, CheckSquare, ClipboardList, Factory, LayoutDashboard, LogOut, Menu, Package, Plus, Receipt, Search, Settings, Ship, ShoppingCart, Tags, Users, X } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient, type DataClient, type Session } from "@/data/client";
import { AppProvider, errorText, useRows } from "@/app/store";
import { Link, ParamsProvider, RouterProvider, match, usePath } from "@/app/router";
import { NotFound } from "@/app/ui";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/routes";
import { CommandPalette, shortcutLabel, showCommandPalette } from "@/app/CommandPalette";
import { SidebarRecords } from "@/app/Favorites";
import { NotificationBell } from "@/app/Notifications";
import { ErrorDialog } from "@/app/notify";

const NAV: { group: string; items: { to: string; section: string; label: string; icon: any }[] }[] = [
  { group: "", items: [{ to: "/", section: "dashboard", label: "Overview", icon: LayoutDashboard }, { to: "/payments", section: "payments", label: "Payments", icon: Receipt }, { to: "/tasks", section: "tasks", label: "Tasks", icon: CheckSquare }] },
  { group: "Sales", items: [{ to: "/orders", section: "orders", label: "Orders", icon: ShoppingCart }, { to: "/customers", section: "customers", label: "Customers", icon: Users }, { to: "/prices", section: "prices", label: "Price agreements", icon: Tags }] },
  { group: "Purchasing", items: [{ to: "/purchasing", section: "purchasing", label: "Purchase orders", icon: ClipboardList }, { to: "/suppliers", section: "suppliers", label: "Suppliers", icon: Factory }] },
  { group: "Logistics", items: [{ to: "/shipping", section: "shipping", label: "Shipping", icon: Ship }, { to: "/stock", section: "stock", label: "NL stock", icon: Boxes }, { to: "/products", section: "products", label: "Products", icon: Package }] },
  { group: "Insight", items: [{ to: "/reports", section: "reports", label: "Reports", icon: BarChart3 }, { to: "/admin", section: "admin", label: "Admin", icon: Settings }] },
];

function resolve(path: string) {
  for (const r of ROUTES) { const p = match(r.path, path); if (p) return { route: r, params: p }; }
  return null;
}

function Shell({ db, session, onSignOut }: { db: DataClient; session: Session; onSignOut: () => void }) {
  const path = usePath();
  const hit = resolve(path);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const totals = useRows("v_open_items_totals").rows;
  const overdue = totals.filter(t => t.direction === "in").reduce((a, t) => a + Number(t.overdue_items), 0);
  const reminders = useRows("v_open_items_summary", { eq: { direction: "in", bucket: "reminder" } }).rows.reduce((a, t) => a + Number(t.items), 0);
  const badge = overdue + reminders;
  const tasks = useRows("v_tasks", { eq: { status: "open" } }).rows;
  const tasksLate = tasks.filter(t => t.state === "overdue").length, tasksToday = tasks.filter(t => t.state === "today").length;
  const Page = hit?.route.page;
  const nav = <nav className="flex-1 overflow-y-auto px-3 py-4">
    {NAV.map(g => (
      <div key={g.group} className="mb-5">
        {g.group && <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{g.group}</div>}
        {g.items.map(i => { const on = hit?.route.section === i.section;
          return <Link key={i.to} to={i.to} aria-current={on ? "page" : undefined}
            className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors", on ? "bg-gray-100 font-medium text-gray-900" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900")}>
            <i.icon className={cn("h-4 w-4 shrink-0", on ? "text-indigo-600" : "text-gray-400")} /><span className="flex-1">{i.label}</span>
            {i.section === "tasks" && tasksLate + tasksToday > 0 && <span title={`${tasksLate} overdue, ${tasksToday} due today`} className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular-nums", tasksLate ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800")}>{tasksLate + tasksToday}</span>}
            {i.section === "payments" && badge > 0 && <span title={`${overdue} overdue, ${reminders} EXW reminder(s)`} className="rounded-full bg-rose-100 px-1.5 text-[11px] font-semibold tabular-nums text-rose-700">{badge}</span>}
          </Link>; })}
      </div>))}
    <SidebarRecords />
  </nav>;
  const brand = <div className="flex items-center gap-2.5 px-5 py-4">
    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">YP</div>
    <div className="min-w-0 flex-1"><div className="text-sm font-semibold leading-tight text-gray-900">Your Products</div><div className="text-[11px] leading-tight text-gray-500">Orders & payments</div></div>
    <NotificationBell className="hidden lg:block" />
  </div>;
  const search = <div className="px-3 pt-1">
    <button type="button" onClick={showCommandPalette} className="flex w-full items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700">
      <Search className="h-4 w-4" /><span className="flex-1 text-left">Search…</span><kbd className="rounded border border-gray-200 bg-white px-1 text-[10px] font-medium">{shortcutLabel()}</kbd></button>
  </div>;
  const foot = <div className="border-t border-gray-100 px-4 py-3 text-xs">
    {db.mode === "local"
      ? <div className="flex items-start gap-1.5 text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>Local test database. Data lives in this browser only.</span></div>
      : <div className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="truncate font-medium text-gray-900">{session.name ?? session.email}</div><div className="text-gray-500">{session.role ?? "no role"}</div></div>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onSignOut} title="Sign out" aria-label="Sign out"><LogOut className="h-3.5 w-3.5" /></Button></div>}
  </div>;
  return (
    <div className="flex min-h-screen bg-gray-50 text-gray-900 print:bg-white">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-gray-200 bg-white lg:flex print:!hidden">{brand}{search}{nav}{foot}</aside>
      {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-gray-900/30" onClick={() => setOpen(false)} />
        <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl">{brand}{search}{nav}{foot}</aside></div>}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-gray-200 bg-white/80 px-4 backdrop-blur lg:hidden print:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(o => !o)} aria-label="Menu">{open ? <X /> : <Menu />}</Button>
          <span className="text-sm font-semibold">Your Products</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={showCommandPalette} aria-label="Search"><Search /></Button>
          <NotificationBell />
          <Link to="/orders/new" className="inline-flex h-8 items-center gap-1 rounded-md bg-indigo-600 px-3 text-xs font-medium text-white"><Plus className="h-3.5 w-3.5" />Order</Link>
        </header>
        <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:p-0"><div className="mx-auto max-w-[1400px]">
          {Page ? <ParamsProvider value={hit!.params}><Page key={path} /></ParamsProvider> : <NotFound what="This page" back={{ to: "/", label: "Go to the overview" }} />}
        </div></main>
        <CommandPalette />
      </div>
    </div>
  );
}

function SignIn({ db, onDone }: { db: DataClient; onDone: () => void }) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr("");
    try { await db.signIn!(email, pw); onDone(); } catch (x) { setErr(errorText(x)); } finally { setBusy(false); } };
  return <div className="flex min-h-screen items-center justify-center bg-gray-50">
    <form onSubmit={go} className="w-80 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2"><div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">YP</div><span className="font-semibold">Your Products · Orders & payments</span></div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">E-mail</label>
      <Input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} className="mb-3" required />
      <label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label>
      <Input type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} className="mb-4" required />
      {err && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
    </form>
  </div>;
}

export default function App() {
  const [db, setDb] = useState<DataClient | null>(null); const [session, setSession] = useState<Session | null | undefined>(undefined); const [err, setErr] = useState("");
  useEffect(() => { createClient().then(async c => { setDb(c); setSession(await c.session()); }).catch(e => setErr(errorText(e))); }, []);
  const reload = async () => setSession(await db!.session());
  if (err) return <div className="p-10 text-sm text-red-800">The database could not be opened: {err}</div>;
  if (!db || session === undefined) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Opening the database…</div>;
  if (!session) return <SignIn db={db} onDone={reload} />;
  if (!session.role) return <div className="p-10 text-sm">You are signed in as {session.email}, but no role has been assigned to this account yet. Ask the admin to give your account a role under Admin → Users.
    <Button variant="outline" size="sm" className="ml-3" onClick={async () => { await db.signOut?.(); reload(); }}>Sign out</Button></div>;
  return <RouterProvider><AppProvider db={db} session={session}><Shell db={db} session={session} onSignOut={async () => { await db.signOut?.(); reload(); }} /><Toaster position="bottom-right" richColors /><ErrorDialog /></AppProvider></RouterProvider>;
}

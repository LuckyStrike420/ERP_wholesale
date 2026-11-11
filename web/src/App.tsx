import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, Boxes, Building2, ClipboardList, Factory, LayoutDashboard, LogOut, Package, Receipt, Settings, Ship, ShoppingCart, Tags, Users } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient, type DataClient, type Session } from "@/data/client";
import { AppProvider, NavCtx, errorText, useRoute, useRows } from "@/app/store";
import { cn } from "@/lib/utils";
import Dashboard from "@/pages/Dashboard";
import Orders from "@/pages/Orders";
import OrderDetail from "@/pages/OrderDetail";
import { PurchaseOrders, PurchaseOrderDetail } from "@/pages/Purchasing";
import { Payments, Shipping, Stock } from "@/pages/Operations";
import { Customers, Suppliers, Products, Prices } from "@/pages/Master";
import Reports from "@/pages/Reports";
import Admin from "@/pages/Admin";

const NAV: { group: string; items: { route: string; label: string; icon: any }[] }[] = [
  { group: "", items: [{ route: "dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  { group: "Sales", items: [{ route: "orders", label: "Orders", icon: ShoppingCart }, { route: "customers", label: "Customers", icon: Users }, { route: "prices", label: "Price agreements", icon: Tags }] },
  { group: "Purchasing", items: [{ route: "purchasing", label: "Purchase orders", icon: ClipboardList }, { route: "suppliers", label: "Suppliers", icon: Factory }] },
  { group: "Money", items: [{ route: "payments", label: "Payments", icon: Receipt }] },
  { group: "Logistics", items: [{ route: "shipping", label: "Shipping", icon: Ship }, { route: "stock", label: "NL stock", icon: Boxes }, { route: "products", label: "Products", icon: Package }] },
  { group: "Insight", items: [{ route: "reports", label: "Reports", icon: BarChart3 }, { route: "admin", label: "Admin", icon: Settings }] },
];
const section = (route: string) => (route.startsWith("order-") ? "orders" : route.startsWith("po-") ? "purchasing" : route.split("/")[0]);

function Page({ route }: { route: string }): ReactNode {
  if (route.startsWith("order-")) return <OrderDetail key={route} id={route.slice(6)} />;
  if (route.startsWith("po-")) return <PurchaseOrderDetail key={route} id={route.slice(3)} />;
  switch (route) {
    case "orders": return <Orders />;
    case "purchasing": return <PurchaseOrders />;
    case "payments": return <Payments />;
    case "shipping": return <Shipping />;
    case "stock": return <Stock />;
    case "customers": return <Customers />;
    case "suppliers": return <Suppliers />;
    case "products": return <Products />;
    case "prices": return <Prices />;
    case "reports": return <Reports />;
    case "admin": return <Admin />;
    default: return <Dashboard />;
  }
}

function Shell({ db, session, onSignOut }: { db: DataClient; session: Session; onSignOut: () => void }) {
  const [route, nav] = useRoute();
  const counts = useRows("v_attention_counts").rows[0];
  const attention = Number(counts?.actionable ?? 0), infoCount = Number(counts?.info_count ?? 0);
  return (
    <NavCtx.Provider value={nav}>
      <div className="flex min-h-screen bg-slate-50 text-slate-900">
        <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r bg-white">
          <div className="flex items-center gap-2 border-b px-4 py-3.5">
            <Building2 className="h-5 w-5 text-sky-700" />
            <div><div className="text-sm font-semibold leading-tight">Your Products</div><div className="text-[11px] leading-tight text-muted-foreground">Orders & payments</div></div>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 py-3">
            {NAV.map(g => (
              <div key={g.group} className="mb-3">
                {g.group && <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.group}</div>}
                {g.items.map(i => (
                  <button key={i.route} onClick={() => nav(i.route)}
                    className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", section(route) === i.route ? "bg-sky-50 font-medium text-sky-900" : "text-slate-700 hover:bg-slate-100")}>
                    <i.icon className="h-4 w-4 shrink-0" /><span className="flex-1">{i.label}</span>
                    {i.route === "dashboard" && attention > 0 && <span title={`${attention} item(s) to act on${infoCount ? `; ${infoCount} more are information only` : ""}`} className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">{attention}</span>}
                  </button>))}
              </div>))}
          </nav>
          <div className="border-t px-3 py-2.5 text-xs">
            {db.mode === "local"
              ? <div className="flex items-start gap-1.5 text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>Local test database. Data lives in this browser only.</span></div>
              : <div className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="truncate font-medium">{session.name ?? session.email}</div><div className="text-muted-foreground">{session.role ?? "no role"}</div></div>
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onSignOut} title="Sign out"><LogOut className="h-3.5 w-3.5" /></Button></div>}
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-6 py-5"><div className="mx-auto max-w-[1400px]"><Page route={route} /></div></main>
      </div>
    </NavCtx.Provider>
  );
}

function SignIn({ db, onDone }: { db: DataClient; onDone: () => void }) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr("");
    try { await db.signIn!(email, pw); onDone(); } catch (x) { setErr(errorText(x)); } finally { setBusy(false); } };
  return <div className="flex min-h-screen items-center justify-center bg-slate-50">
    <form onSubmit={go} className="w-80 rounded-lg border bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2"><Building2 className="h-5 w-5 text-sky-700" /><span className="font-semibold">Your Products · Orders & payments</span></div>
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
  if (!session.role) return <div className="p-10 text-sm">You are signed in as {session.email}, but no role has been assigned to this account yet. Ask the admin to add you under Admin → Users.
    <Button variant="outline" size="sm" className="ml-3" onClick={async () => { await db.signOut?.(); reload(); }}>Sign out</Button></div>;
  return <AppProvider db={db}><Shell db={db} session={session} onSignOut={async () => { await db.signOut?.(); reload(); }} /><Toaster position="bottom-right" richColors /></AppProvider>;
}

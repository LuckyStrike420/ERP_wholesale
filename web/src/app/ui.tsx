/**
 * Shared building blocks. Every screen is composed from these, so the look and behaviour stay the same everywhere.
 * Design tokens: Tailwind gray neutrals, one accent (indigo), rose = late, amber = check, emerald = done.
 */
import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Copy, Download, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { errorText, useApp, useLoading } from "./store";
import { Link, useNav, usePath } from "./router";
import { PAYMENT_LABEL, STATUS_LABEL } from "./format";
import { Combobox } from "./Combobox";
import { CREATABLE_FIELD, quickCreate } from "./quickCreate";

// ---------------- page structure ----------------
export function PageHeader({ title, sub, back, children }: { title: ReactNode; sub?: ReactNode; back?: { to: string; label: string }; children?: ReactNode }) {
  return (
    <div className="mb-6">
      {back && <Link to={back.to} className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-gray-900"><ArrowLeft className="h-3.5 w-3.5" />{back.label}</Link>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
          {sub && <p className="mt-1 text-sm text-gray-500">{sub}</p>}
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}

export function Section({ title, children, action, className, sub }: { title?: ReactNode; children: ReactNode; action?: ReactNode; className?: string; sub?: ReactNode }) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-sm", className)}>
      {(title || action) && <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
        <div className="min-w-0"><h2 className="text-sm font-semibold text-gray-900">{title}</h2>{sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}</div>{action}
      </header>}
      <div>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone, to }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "bad" | "warn" | "good"; to?: string }) {
  const body = <>
    <div className="text-xs font-medium text-gray-500">{label}</div>
    <div className={cn("mt-1.5 text-2xl font-semibold tracking-tight tabular-nums text-gray-900", tone === "bad" && "text-rose-600", tone === "warn" && "text-amber-600", tone === "good" && "text-emerald-600")}>{value}</div>
    {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
  </>;
  const cls = "block rounded-xl border border-gray-200/80 bg-white px-5 py-4 shadow-sm";
  return to ? <Link to={to} className={cn(cls, "transition-colors hover:border-gray-300 hover:bg-gray-50/60")}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return <dl className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-4 gap-y-2 px-5 py-4 text-sm">
    {items.map(([k, v], i) => <div key={i} className="contents"><dt className="text-gray-500">{k}</dt><dd className="tabular-nums text-gray-900">{v}</dd></div>)}
  </dl>;
}

export function Notice({ tone = "amber", title, children, className }: { tone?: "amber" | "rose" | "sky" | "gray"; title?: ReactNode; children?: ReactNode; className?: string }) {
  const t = { amber: "border-amber-200 bg-amber-50 text-amber-900", rose: "border-rose-200 bg-rose-50 text-rose-900", sky: "border-sky-200 bg-sky-50 text-sky-900", gray: "border-gray-200 bg-gray-50 text-gray-800" }[tone];
  return <div className={cn("rounded-xl border px-4 py-3 text-sm", t, className)}>
    {title && <div className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" />{title}</div>}{children}</div>;
}

/** tabs that are pages: each tab has its own URL */
export function TabLinks({ tabs }: { tabs: { to: string; label: ReactNode; count?: number }[] }) {
  const path = usePath();
  return <nav className="mb-5 flex gap-1 border-b border-gray-200">
    {tabs.map(t => { const on = path === t.to;
      return <Link key={t.to} to={t.to} className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        on ? "border-indigo-600 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-900")}>{t.label}
        {t.count != null && <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", on ? "bg-indigo-50 text-indigo-700" : "bg-gray-100 text-gray-600")}>{t.count}</span>}</Link>; })}
  </nav>;
}

/** a link that looks like a button */
export function LinkButton({ to, children, variant = "default", size = "default", className }: { to: string; children: ReactNode; variant?: "default" | "outline" | "ghost"; size?: "default" | "sm"; className?: string }) {
  return <Link to={to} className={cn("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors [&_svg]:size-4",
    size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
    variant === "default" && "bg-indigo-600 text-white shadow-sm hover:bg-indigo-500",
    variant === "outline" && "border border-gray-300 bg-white text-gray-800 shadow-sm hover:bg-gray-50",
    variant === "ghost" && "text-gray-700 hover:bg-gray-100", className)}>{children}</Link>;
}

export const Loading = ({ what = "Loading…" }: { what?: string }) => <div className="py-16 text-center text-sm text-gray-500">{what}</div>;
export const NotFound = ({ what, back }: { what: string; back: { to: string; label: string } }) =>
  <div className="py-16 text-center"><p className="text-sm text-gray-600">{what} not found.</p><Link to={back.to} className="mt-2 inline-block text-sm text-indigo-600 hover:underline">{back.label}</Link></div>;

// ---------------- pills ----------------
const TONES: Record<string, string> = {
  grey: "bg-gray-100 text-gray-700 ring-gray-200", blue: "bg-indigo-50 text-indigo-700 ring-indigo-200", sky: "bg-sky-50 text-sky-700 ring-sky-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200", green: "bg-emerald-50 text-emerald-700 ring-emerald-200", red: "bg-rose-50 text-rose-700 ring-rose-200",
};
export function Pill({ tone = "grey", children }: { tone?: keyof typeof TONES | string; children: ReactNode }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone] ?? TONES.grey)}>{children}</span>;
}
export const StatusPill = ({ status }: { status: string }) =>
  <Pill tone={status === "cancelled" ? "red" : status === "completed" ? "green" : status === "draft" ? "grey" : "blue"}>{STATUS_LABEL[status] ?? status}</Pill>;
export const PaymentPill = ({ status }: { status: string }) =>
  <Pill tone={{ paid: "green", overpaid: "amber", unpaid: "amber", partially_paid: "amber", deposit_paid: "sky", cancelled: "red" }[status] ?? "grey"}>{PAYMENT_LABEL[status] ?? status}</Pill>;
export const SeverityPill = ({ s }: { s: string }) => <Pill tone={s === "error" ? "red" : s === "warning" ? "amber" : "sky"}>{s === "error" ? "Action" : s === "warning" ? "Check" : "Info"}</Pill>;

// ---------------- table ----------------
export interface Col<T = any> { key: string; header: string; align?: "right"; render?: (r: T) => ReactNode; value?: (r: T) => any; width?: string; wrap?: boolean; }

const toCsv = (cols: Col[], rows: any[]) => [cols.filter(c => c.header).map(c => c.header), ...rows.map(r => cols.filter(c => c.header).map(c => (c.value ? c.value(r) : r[c.key]) ?? ""))]
  .map(line => line.map(v => /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)).join(",")).join("\n");

export function DataTable<T extends Record<string, any>>({ rows, cols, rowTo, onRow, search, empty = "Nothing here yet", exportName, toolbar, dense, initialSort, loading, rowClass }: {
  rows: T[]; cols: Col<T>[]; rowTo?: (r: T) => string | null | undefined; onRow?: (r: T) => void; search?: boolean; empty?: ReactNode; exportName?: string; toolbar?: ReactNode;
  dense?: boolean; initialSort?: [string, 1 | -1]; loading?: boolean; rowClass?: (r: T) => string | undefined;
}) {
  const nav = useNav();
  const anyLoading = useLoading(); const isLoading = loading ?? anyLoading;
  const [q, setQ] = useState(""); const [sort, setSort] = useState<[string, 1 | -1] | null>(initialSort ?? null);
  const val = (c: Col<T>, r: T) => (c.value ? c.value(r) : r[c.key]);
  const shown = useMemo(() => {
    let out = rows;
    if (q.trim()) { const needle = q.toLowerCase(); out = out.filter(r => cols.some(c => String(val(c, r) ?? "").toLowerCase().includes(needle))); }
    if (sort) {
      const c = cols.find(x => x.key === sort[0]);
      if (c) out = [...out].sort((a, b) => { const x = val(c, a), y = val(c, b);
        if (x == null) return 1; if (y == null) return -1;
        const nx = Number(x), ny = Number(y);
        return (!isNaN(nx) && !isNaN(ny) && x !== "" && y !== "" ? nx - ny : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort[1]; });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort, cols]);
  const copy = async () => { try { await navigator.clipboard.writeText(toCsv(cols, shown)); toast.success(`${shown.length} rows copied as CSV: paste into Excel`); } catch { toast.error("Copy was blocked by the browser"); } };
  const download = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + toCsv(cols, shown)], { type: "text/csv" })); a.download = `${exportName}.csv`; a.click(); };
  const go = (r: T) => { const to = rowTo?.(r); if (to) nav(to); else onRow?.(r); };
  const clickable = !!(rowTo || onRow);
  return (
    <div>
      {(search || exportName || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2.5">
          {search && <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-gray-400" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search" className="h-8 w-56 border-gray-200 pl-8" /></div>}
          {toolbar}
          <div className="ml-auto flex items-center gap-1 text-xs text-gray-500">
            <span className="mr-2 tabular-nums">{shown.length} of {rows.length}</span>
            {exportName && <Button variant="ghost" size="sm" className="h-8 text-gray-600" onClick={copy}><Copy className="mr-1 h-3.5 w-3.5" />Copy</Button>}
            {exportName && <Button variant="ghost" size="sm" className="h-8 text-gray-600" onClick={download}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100 bg-gray-50/70 text-left text-xs text-gray-500">
            {cols.map(c => (
              <th key={c.key} style={{ width: c.width }} className={cn("select-none whitespace-nowrap px-4 py-2.5 font-medium", c.header && "cursor-pointer hover:text-gray-900", c.align === "right" && "text-right")}
                onClick={() => c.header && setSort(s => (s && s[0] === c.key ? [c.key, (s[1] * -1) as 1 | -1] : [c.key, 1]))}>
                {c.header}{sort?.[0] === c.key && (sort[1] === 1 ? <ArrowUp className="ml-1 inline h-3 w-3" /> : <ArrowDown className="ml-1 inline h-3 w-3" />)}
              </th>))}
          </tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.id ?? i} onClick={clickable ? () => go(r) : undefined} className={cn("border-b border-gray-100 last:border-0", clickable && "cursor-pointer transition-colors hover:bg-gray-50", rowClass?.(r))}>
                {cols.map(c => <td key={c.key} className={cn("px-4 align-top text-gray-700", !c.wrap && "whitespace-nowrap", dense ? "py-2" : "py-3", c.align === "right" && "text-right tabular-nums")}>{c.render ? c.render(r) : (r[c.key] ?? "–")}</td>)}
              </tr>))}
            {!shown.length && <tr><td colSpan={cols.length} className="px-4 py-10 text-center text-sm text-gray-500">{isLoading && !rows.length ? "Loading…" : empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- forms: always a page of their own ----------------
export interface Field { name: string; label: string; type?: "text" | "number" | "date" | "select" | "textarea" | "checkbox" | "percent"; options?: { value: string; label: string }[];
  required?: boolean; hint?: string; span?: 1 | 2; placeholder?: string; section?: string;
  /** select: allow any typed text as the value (e.g. a role) */ free?: boolean;
  /** select on customer_id / supplier_id / product_id: set false to not offer "add new" */ create?: boolean; }

export const selectClass = "h-9 rounded-md border border-gray-300 bg-white px-2.5 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

/** what a form's onSubmit may return: false = stay (refused), a path = go there, confirm = ask on the page before saving */
export type SubmitResult = void | false | string | { confirm: { title: string; body: ReactNode; label: string; danger?: boolean; go: () => Promise<void | false | string> } };

export function FormPage({ title, sub, back, fields, initial, submitLabel = "Save", onSubmit, aside, children, done }: {
  title: ReactNode; sub?: ReactNode; back: { to: string; label: string }; fields: Field[]; initial?: Record<string, any>; submitLabel?: string;
  onSubmit: (values: Record<string, any>) => Promise<SubmitResult>; aside?: ReactNode; children?: ReactNode; done?: string;
}) {
  const nav = useNav(); const { refresh, db } = useApp();
  const start = () => Object.fromEntries(fields.map(f => {
    const v = initial?.[f.name];
    return [f.name, f.type === "checkbox" ? !!v : f.type === "percent" && v != null && v !== "" ? String(Math.round(Number(v) * 1e6) / 1e4) : v ?? ""];
  }));
  const [v, setV] = useState<Record<string, any>>(start); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState<null | { title: string; body: ReactNode; label: string; danger?: boolean; go: () => Promise<void | false | string> }>(null);
  const set = (k: string, x: any) => { setV(s => ({ ...s, [k]: x })); setConfirm(null); };
  const finish = (r: void | false | string) => { if (r === false) return; refresh(); toast.success("Saved"); nav(typeof r === "string" ? r : done ?? back.to); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    const out: Record<string, any> = {};
    for (const f of fields) {
      let x = v[f.name];
      if (f.type === "number" || f.type === "percent") {
        x = String(x).trim() === "" ? null : Number(String(x).replace(",", "."));
        if (x !== null && isNaN(x)) return setErr(`${f.label}: not a number`);
        if (x !== null && f.type === "percent") x = Math.round(x * 100) / 10000;
      } else if (f.type !== "checkbox") x = String(x ?? "").trim() === "" ? null : String(x).trim();
      if (f.required && (x === null || x === "")) return setErr(`${f.label} is required`);
      out[f.name] = x;
    }
    setBusy(true);
    try { const r = await onSubmit(out); if (r && typeof r === "object") setConfirm(r.confirm); else finish(r); }
    catch (e2) { setErr(errorText(e2)); } finally { setBusy(false); }
  };
  const go = async () => { if (!confirm) return; setBusy(true); try { finish(await confirm.go()); } catch (e2) { setErr(errorText(e2)); } finally { setBusy(false); } };
  // fields grouped under optional section titles
  const groups: { title?: string; fields: Field[] }[] = [];
  for (const f of fields) { const last = groups[groups.length - 1]; if (!last || (f.section && f.section !== last.title)) groups.push({ title: f.section, fields: [f] }); else last.fields.push(f); }
  return <>
    <PageHeader title={title} sub={sub} back={back} />
    <div className={cn("grid gap-6", aside && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
      <form onSubmit={submit} className="min-w-0">
        <div className="space-y-5">
          {groups.map((g, gi) => (
            <Section key={gi} title={g.title}>
              <div className="grid grid-cols-2 gap-x-5 gap-y-4 px-5 py-5">
                {g.fields.map(f => (
                  <div key={f.name} className={cn(f.span === 1 ? "col-span-2 sm:col-span-1" : "col-span-2")}>
                    {f.type !== "checkbox" && <Label htmlFor={f.name} className="mb-1.5 block text-sm font-medium text-gray-700">{f.label}{f.required && <span className="text-rose-600"> *</span>}</Label>}
                    {f.type === "select" ? (() => {
                        // a list you can type in: for records (customer, supplier, product …), longer lists and free text; short fixed lists stay a plain menu
                        const kind = f.create === false ? undefined : CREATABLE_FIELD[f.name];
                        if (kind || f.free || (f.options?.length ?? 0) > 6)
                          return <Combobox id={f.name} label={f.label} value={v[f.name] || null} onChange={x => set(f.name, x ?? "")} options={f.options ?? []} required={f.required} free={f.free}
                            create={kind ? async t => { const id = await quickCreate(db, kind, t); refresh(); return id; } : undefined} createNoun={kind} />;
                        return <select id={f.name} className={selectClass + " w-full"} value={v[f.name] ?? ""} onChange={e => set(f.name, e.target.value)}>
                          <option value="">–</option>{f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
                      })()
                      : f.type === "textarea" ? <Textarea id={f.name} rows={3} value={v[f.name]} onChange={e => set(f.name, e.target.value)} className="border-gray-300" />
                      : f.type === "checkbox" ? <label className="flex items-center gap-2 text-sm text-gray-800"><input type="checkbox" className="h-4 w-4 rounded border-gray-300 accent-indigo-600" checked={!!v[f.name]} onChange={e => set(f.name, e.target.checked)} />{f.label}</label>
                      : <Input id={f.name} type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" || f.type === "percent" ? "decimal" : undefined}
                          placeholder={f.placeholder} value={v[f.name]} onChange={e => set(f.name, e.target.value)} className="h-9 border-gray-300" />}
                    {f.hint && <p className="mt-1.5 text-xs text-gray-500">{f.hint}</p>}
                  </div>))}
              </div>
            </Section>))}
          {children}
          {err && <Notice tone="rose">{err}</Notice>}
          {confirm && <Notice tone={confirm.danger ? "rose" : "amber"} title={confirm.title}>
            <div className="mt-2">{confirm.body}</div>
            <div className="mt-3 flex gap-2"><Button type="button" onClick={go} disabled={busy} variant={confirm.danger ? "destructive" : "default"}>{busy ? "Saving…" : confirm.label}</Button>
              <Button type="button" variant="outline" onClick={() => setConfirm(null)}>Change the form</Button></div>
          </Notice>}
          {!confirm && <div className="flex items-center gap-2 border-t border-gray-200 pt-5">
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
            <Button type="button" variant="ghost" onClick={() => nav(back.to)}>Cancel</Button>
          </div>}
        </div>
      </form>
      {aside && <aside className="space-y-4">{aside}</aside>}
    </div>
  </>;
}

/** only for a yes/no on something that cannot be undone (cancel an order, remove a line) */
export function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", danger, onConfirm, onClose }: {
  open: boolean; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return <Dialog open={open} onOpenChange={o => !o && onClose()}>
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription asChild><div className="pt-2 text-sm text-gray-700">{body}</div></DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={onClose}>Back</Button>
        <Button variant={danger ? "destructive" : "default"} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

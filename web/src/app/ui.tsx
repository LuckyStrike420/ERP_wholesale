import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Copy, Download, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { errorText, useLoading } from "./store";
import { PAYMENT_LABEL, STATUS_LABEL } from "./format";

export function PageHeader({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b pb-4">
      <div><h1 className="text-xl font-semibold tracking-tight">{title}</h1>{sub && <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Section({ title, children, action, className }: { title: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-md border bg-card", className)}>
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>{action}
      </header>
      <div>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "bad" | "warn" | "good" }) {
  return (
    <div className="rounded-md border bg-card px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "bad" && "text-red-700", tone === "warn" && "text-amber-700", tone === "good" && "text-emerald-700")}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return <dl className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-sm">
    {items.map(([k, v], i) => <div key={i} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}
  </dl>;
}

const TONES: Record<string, string> = {
  grey: "bg-slate-100 text-slate-700 border-slate-200", blue: "bg-sky-50 text-sky-800 border-sky-200", amber: "bg-amber-50 text-amber-800 border-amber-200",
  green: "bg-emerald-50 text-emerald-800 border-emerald-200", red: "bg-red-50 text-red-800 border-red-200",
};
export function Pill({ tone = "grey", children }: { tone?: keyof typeof TONES | string; children: ReactNode }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium", TONES[tone] ?? TONES.grey)}>{children}</span>;
}
export const StatusPill = ({ status }: { status: string }) =>
  <Pill tone={status === "cancelled" ? "red" : status === "completed" ? "green" : status === "draft" ? "grey" : "blue"}>{STATUS_LABEL[status] ?? status}</Pill>;
export const PaymentPill = ({ status }: { status: string }) =>
  <Pill tone={{ paid: "green", overpaid: "amber", unpaid: "amber", partially_paid: "amber", deposit_paid: "blue", cancelled: "red" }[status] ?? "grey"}>{PAYMENT_LABEL[status] ?? status}</Pill>;
export const SeverityPill = ({ s }: { s: string }) => <Pill tone={s === "error" ? "red" : s === "warning" ? "amber" : "blue"}>{s === "error" ? "Action" : s === "warning" ? "Check" : "Info"}</Pill>;

// ---------------- table ----------------
export interface Col<T = any> { key: string; header: string; align?: "right"; render?: (r: T) => ReactNode; value?: (r: T) => any; width?: string; }

const embedded = (() => { try { return window.self !== window.top; } catch { return true; } })();
const toCsv = (cols: Col[], rows: any[]) => [cols.map(c => c.header), ...rows.map(r => cols.map(c => (c.value ? c.value(r) : r[c.key]) ?? ""))]
  .map(line => line.map(v => /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)).join(",")).join("\n");

export function DataTable<T extends Record<string, any>>({ rows, cols, onRow, search, empty = "Nothing here yet", exportName, toolbar, dense, initialSort, loading }: {
  rows: T[]; cols: Col<T>[]; onRow?: (r: T) => void; search?: boolean; empty?: string; exportName?: string; toolbar?: ReactNode; dense?: boolean; initialSort?: [string, 1 | -1]; loading?: boolean;
}) {
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
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort[1]; });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort, cols]);
  const copy = async () => { try { await navigator.clipboard.writeText(toCsv(cols, shown)); toast.success(`${shown.length} rows copied as CSV: paste into Excel`); } catch { toast.error("Copy was blocked by the browser"); } };
  const download = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + toCsv(cols, shown)], { type: "text/csv" })); a.download = `${exportName}.csv`; a.click(); };
  return (
    <div>
      {(search || exportName || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          {search && <div className="relative"><Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" className="h-8 w-56 pl-8" /></div>}
          {toolbar}
          <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <span className="mr-2 tabular-nums">{shown.length} of {rows.length}</span>
            {exportName && <Button variant="ghost" size="sm" className="h-8" onClick={copy}><Copy className="mr-1 h-3.5 w-3.5" />Copy CSV</Button>}
            {exportName && !embedded && <Button variant="ghost" size="sm" className="h-8" onClick={download}><Download className="mr-1 h-3.5 w-3.5" />Download</Button>}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            {cols.map(c => (
              <th key={c.key} style={{ width: c.width }} className={cn("cursor-pointer select-none whitespace-nowrap px-3 py-2 font-medium", c.align === "right" && "text-right")}
                onClick={() => setSort(s => (s && s[0] === c.key ? [c.key, (s[1] * -1) as 1 | -1] : [c.key, 1]))}>
                {c.header}{sort?.[0] === c.key && (sort[1] === 1 ? <ArrowUp className="ml-1 inline h-3 w-3" /> : <ArrowDown className="ml-1 inline h-3 w-3" />)}
              </th>))}
          </tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.id ?? i} onClick={onRow ? () => onRow(r) : undefined} className={cn("border-b last:border-0", onRow && "cursor-pointer hover:bg-muted/50")}>
                {cols.map(c => <td key={c.key} className={cn("px-3 align-top", dense ? "py-1.5" : "py-2", c.align === "right" && "text-right tabular-nums")}>{c.render ? c.render(r) : (r[c.key] ?? "–")}</td>)}
              </tr>))}
            {!shown.length && <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-sm text-muted-foreground">{isLoading && !rows.length ? "Loading…" : empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- forms ----------------
export interface Field { name: string; label: string; type?: "text" | "number" | "date" | "select" | "textarea" | "checkbox" | "percent"; options?: { value: string; label: string }[];
  required?: boolean; hint?: string; span?: 1 | 2; placeholder?: string; }

export const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

export function FormDialog({ open, onClose, title, description, fields, initial, submitLabel = "Save", onSubmit }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; fields: Field[]; initial?: Record<string, any>; submitLabel?: string;
  onSubmit: (values: Record<string, any>) => Promise<void | false>;
}) {
  return <Dialog open={open} onOpenChange={o => !o && onClose()}>
    <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
      {open && <FormBody {...{ onClose, title, description, fields, initial, submitLabel, onSubmit }} />}
    </DialogContent>
  </Dialog>;
}

function FormBody({ onClose, title, description, fields, initial, submitLabel, onSubmit }: any) {
  const start = () => Object.fromEntries((fields as Field[]).map(f => {
    const v = initial?.[f.name];
    return [f.name, f.type === "checkbox" ? !!v : f.type === "percent" && v != null ? String(Math.round(Number(v) * 1e6) / 1e4) : v ?? ""];
  }));
  const [v, setV] = useState<Record<string, any>>(start); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = (k: string, x: any) => setV(s => ({ ...s, [k]: x }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    const out: Record<string, any> = {};
    for (const f of fields as Field[]) {
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
    try { const r = await onSubmit(out); if (r !== false) onClose(); } catch (e2) { setErr(errorText(e2)); } finally { setBusy(false); }
  };
  return <form onSubmit={submit}>
    <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description ?? " "}</DialogDescription></DialogHeader>
    <div className="my-4 grid grid-cols-2 gap-x-4 gap-y-3">
      {(fields as Field[]).map(f => (
        <div key={f.name} className={cn(f.span === 1 ? "col-span-1" : "col-span-2")}>
          {f.type !== "checkbox" && <Label htmlFor={f.name} className="mb-1 block text-xs font-medium text-muted-foreground">{f.label}{f.required && " *"}</Label>}
          {f.type === "select" ? <select id={f.name} className={selectClass + " w-full"} value={v[f.name] ?? ""} onChange={e => set(f.name, e.target.value)}>
              <option value="">–</option>{f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            : f.type === "textarea" ? <Textarea id={f.name} rows={2} value={v[f.name]} onChange={e => set(f.name, e.target.value)} />
            : f.type === "checkbox" ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!v[f.name]} onChange={e => set(f.name, e.target.checked)} />{f.label}</label>
            : <Input id={f.name} type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" || f.type === "percent" ? "decimal" : undefined}
                placeholder={f.placeholder} value={v[f.name]} onChange={e => set(f.name, e.target.value)} className="h-9" />}
          {f.hint && <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p>}
        </div>))}
    </div>
    {err && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
    <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button></DialogFooter>
  </form>;
}

export function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", danger, onConfirm, onClose }: {
  open: boolean; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return <Dialog open={open} onOpenChange={o => !o && onClose()}>
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription asChild><div className="pt-2 text-sm text-foreground">{body}</div></DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={onClose}>Back</Button>
        <Button variant={danger ? "destructive" : "default"} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

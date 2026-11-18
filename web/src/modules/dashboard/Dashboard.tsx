/**
 * The dashboard is a grid of independent widgets (see widgets.tsx).
 * Which widgets show, and in what order, is saved per user; "Customize" changes it.
 */
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRows } from "@/app/store";
import { useNav, useQuery } from "@/app/router";
import { LinkButton, selectClass } from "@/app/ui";
import { cn } from "@/lib/utils";
import { WIDGETS } from "./widgets";
import { useLayout } from "@/app/Layout";

// the layout is saved per user (all devices) like the record pages; the old browser-only layout is picked up once
const LEGACY = "yp.dashboard.layout.v1";
const SPAN = { full: "lg:col-span-6", wide: "lg:col-span-4", half: "lg:col-span-3", third: "lg:col-span-2" };

export default function Dashboard() {
  const nav = useNav(); const q = useQuery();
  const monthly = useRows("v_revenue_monthly").rows;
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => [...new Set([thisYear, ...monthly.map(m => m.year)])].sort((a, b) => b - a), [monthly, thisYear]);
  const year = Number(q.get("year") ?? thisYear);
  const lay = useLayout("dashboard", LEGACY); const { layout, save, editing, setEditing } = lay;
  const order = [...layout.order.filter(id => WIDGETS.some(w => w.id === id)), ...WIDGETS.map(w => w.id).filter(id => !layout.order.includes(id))];
  const shown = order.map(id => WIDGETS.find(w => w.id === id)!).filter(w => !layout.hidden.includes(w.id));
  const move = (id: string, d: -1 | 1) => { const o = [...order]; const i = o.indexOf(id), j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; save({ ...layout, order: o }); };
  const toggle = (id: string) => save({ ...layout, order, hidden: layout.hidden.includes(id) ? layout.hidden.filter(x => x !== id) : [...layout.hidden, id] });
  const hour = new Date().getHours();

  return <>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-sm text-gray-500">{hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Overview</h1>
      </div>
      <div className="flex items-center gap-2">
        <select aria-label="Year" className={selectClass + " w-24"} value={year} onChange={e => nav(Number(e.target.value) === thisYear ? "/" : `/?year=${e.target.value}`, { replace: true })}>{years.map(y => <option key={y}>{y}</option>)}</select>
        <Button variant="outline" onClick={() => setEditing(e => !e)} aria-pressed={editing}><SlidersHorizontal className="h-4 w-4" />Customize</Button>
        <LinkButton to="/orders/new"><Plus />New order</LinkButton>
      </div>
    </div>

    {editing && <section className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-gray-900">Dashboard widgets</h2>
        <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => save({ order: WIDGETS.map(w => w.id), hidden: [], size: {} })}>Reset</Button><Button size="sm" onClick={() => setEditing(false)}>Done</Button></div></div>
      <ul className="grid gap-2 sm:grid-cols-2">{order.map((id, i) => { const w = WIDGETS.find(x => x.id === id)!; const on = !layout.hidden.includes(id);
        return <li key={id} className={cn("flex items-center gap-3 rounded-lg border bg-white px-3 py-2", on ? "border-gray-200" : "border-dashed border-gray-300 opacity-60")}>
          <input type="checkbox" checked={on} onChange={() => toggle(id)} className="h-4 w-4 accent-indigo-600" aria-label={`Show ${w.title}`} />
          <div className="min-w-0 flex-1"><div className="text-sm font-medium text-gray-900">{w.title}</div><div className="truncate text-xs text-gray-500">{w.description}</div></div>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => move(id, -1)} aria-label={`Move ${w.title} up`}><ArrowUp className="h-3.5 w-3.5" /></Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === order.length - 1} onClick={() => move(id, 1)} aria-label={`Move ${w.title} down`}><ArrowDown className="h-3.5 w-3.5" /></Button>
        </li>; })}</ul>
    </section>}

    <div className="grid grid-cols-1 gap-6 lg:grid-cols-6">
      {shown.map(w => <div key={w.id} className={cn("min-w-0", SPAN[w.span])}><w.Component year={year} /></div>)}
    </div>
  </>;
}

/**
 * A field you type in instead of scrolling a list. Matches move to the top (exact, then starting with, then containing).
 * With `create`, a typed name that does not exist yet can be added on the spot ("+ Add “Acme” as new customer").
 * With `free`, whatever you type is the value (e.g. a contact's role).
 * The list is drawn above the page, so it is never cut off inside a table or a scrolling block.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { errorText } from "./store";
import { cn } from "@/lib/utils";
import { similarName } from "./duplicates";

export interface Option { value: string; label: string; hint?: string; keywords?: string }

/** 0 = no match; higher = better. Every typed word must appear. */
export function matchScore(o: Option, query: string) {
  const q = query.trim().toLowerCase(); if (!q) return 1;
  const label = o.label.toLowerCase(); const all = `${label} ${(o.hint ?? "").toLowerCase()} ${(o.keywords ?? "").toLowerCase()}`;
  const words = q.split(/\s+/);
  if (!words.every(w => all.includes(w))) return 0;
  if (label === q) return 1000;
  // per typed word: a whole word in the name counts most, the start of a word next, anywhere else least
  const tokens = label.split(/[\s·,/()-]+/);
  let sc = label.startsWith(q) ? 300 : label.includes(q) ? 100 : 0;
  for (const w of words) sc += tokens.includes(w) ? 10 : tokens.some(t => t.startsWith(w)) ? 6 : label.includes(w) ? 1 : 0;
  return sc + 1;
}

export function Combobox({ id, value, onChange, options, placeholder = "Type to search…", create, createNoun = "item", free, required, label, className, disabled }: {
  id?: string; value: string | null | undefined; onChange: (v: string | null) => void; options: Option[]; placeholder?: string;
  create?: (text: string) => Promise<string | null | undefined>; createNoun?: string; free?: boolean; required?: boolean; label?: string; className?: string; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null); const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false); const [text, setText] = useState(""); const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(0); const [busy, setBusy] = useState(false); const [made, setMade] = useState<{ value: string; label: string } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const selected = options.find(o => o.value === value);
  const shownLabel = selected?.label ?? (made && made.value === value ? made.label : free ? value ?? "" : "");

  const items = useMemo(() => {
    const scored = options.map((o, i) => ({ o, i, s: typed ? matchScore(o, text) : 1 })).filter(x => x.s > 0);
    if (typed) scored.sort((a, b) => b.s - a.s || a.i - b.i);
    const out: ({ kind: "option"; o: Option; similar?: boolean } | { kind: "create" | "free"; text: string; like?: string })[] = scored.map(x => ({ kind: "option" as const, o: x.o }));
    const t = text.trim(); const exact = options.some(o => o.label.toLowerCase() === t.toLowerCase());
    // before adding a new one: names that look the same go first, so you pick the existing record instead
    const sims = create && typed && t && !exact ? options.filter(o => similarName(o.label, t)) : [];
    for (const o of [...sims].reverse()) { const i = out.findIndex(x => x.kind === "option" && x.o.value === o.value); if (i >= 0) out.splice(i, 1); out.unshift({ kind: "option", o, similar: true }); }
    if (typed && t && !exact && create) out.push({ kind: "create", text: t, like: sims[0]?.label });
    if (typed && t && !exact && free) out.unshift({ kind: "free", text: t });
    return out;
  }, [options, text, typed, create, free]);

  // place the list under (or above, when there is no room) the field
  const place = () => {
    const r = input.current?.getBoundingClientRect(); if (!r) return;
    const up = window.innerHeight - r.bottom < 260 && r.top > window.innerHeight - r.bottom;
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: Math.max(r.width, 240), up });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const f = () => place(); window.addEventListener("scroll", f, true); window.addEventListener("resize", f);
    return () => { window.removeEventListener("scroll", f, true); window.removeEventListener("resize", f); };
  }, [open]);
  useEffect(() => { list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  // opening selects the current text, so typing replaces it
  const start = () => { if (disabled) return; setText(shownLabel); setTyped(false); setOpen(true); setActive(Math.max(0, options.findIndex(o => o.value === value))); input.current?.select(); };
  const close = () => { setOpen(false); setTyped(false); };
  const choose = async (it: (typeof items)[number] | undefined) => {
    if (!it) return;
    if (it.kind === "option") { onChange(it.o.value); close(); return; }
    if (it.kind === "free") { onChange(it.text); close(); return; }
    if (!create) return;
    setBusy(true);
    try { const v = await create(it.text); if (v) { setMade({ value: v, label: it.text }); onChange(v); toast.success(`${it.text} added as new ${createNoun}`); } close(); }
    catch (e) { toast.error(errorText(e), { duration: 9000 }); } finally { setBusy(false); }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { e.preventDefault(); start(); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(items[active]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Tab") { if (free && typed && text.trim() !== shownLabel) onChange(text.trim() || null); close(); }
  };

  return <div className={cn("relative", className)}>
    <input ref={input} id={id} role="combobox" aria-expanded={open} aria-autocomplete="list" aria-label={label} autoComplete="off" disabled={disabled}
      value={open ? text : shownLabel} placeholder={placeholder}
      onFocus={start} onClick={() => !open && start()}
      onChange={e => { setText(e.target.value); setTyped(true); setActive(0); if (!open) setOpen(true); }}
      onBlur={() => { if (free && typed && text.trim() !== shownLabel) onChange(text.trim() || null); close(); }}
      onKeyDown={onKey}
      className="h-9 w-full rounded-md border border-gray-300 bg-white pl-2.5 pr-14 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50" />
    <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 text-gray-400">
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {!required && value && !open && !disabled && <button type="button" tabIndex={-1} aria-label="Clear" onMouseDown={e => { e.preventDefault(); onChange(null); }} className="pointer-events-auto rounded p-0.5 hover:text-gray-700"><X className="h-3.5 w-3.5" /></button>}
      <ChevronDown className="h-4 w-4" />
    </span>
    {open && pos && createPortal(
      <ul ref={list} role="listbox" style={{ position: "fixed", left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
        className="z-[60] max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg">
        {!items.length && <li className="px-3 py-2 text-gray-500">{typed ? `Nothing matches “${text}”` : "Nothing to choose yet"}</li>}
        {items.map((it, i) => <li key={it.kind === "option" ? it.o.value : `${it.kind}-${it.text}`} data-i={i} role="option" aria-selected={i === active}
          onMouseDown={e => { e.preventDefault(); choose(it); }} onMouseEnter={() => setActive(i)}
          className={cn("flex cursor-pointer items-center gap-2 px-3 py-1.5", i === active ? "bg-indigo-50 text-gray-900" : "text-gray-700", it.kind !== "option" && "border-t border-gray-100 first:border-t-0")}>
          {it.kind === "option" ? <>
            <span className="min-w-0 flex-1 truncate">{it.o.label}</span>
            {it.similar ? <span className="shrink-0 rounded bg-amber-50 px-1.5 text-[11px] font-medium text-amber-700">similar name</span> : it.o.hint && <span className="shrink-0 text-xs text-gray-400">{it.o.hint}</span>}
            {it.o.value === value && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600" />}
          </> : it.kind === "create" ? <><Plus className="h-3.5 w-3.5 shrink-0 text-indigo-600" /><span className="font-medium text-indigo-700">{it.like ? `Add “${it.text}” anyway as new ${createNoun}` : `Add “${it.text}” as new ${createNoun}`}</span></>
            : <><Check className="h-3.5 w-3.5 shrink-0 text-gray-400" /><span>Use “{it.text}”</span></>}
        </li>)}
      </ul>, document.body)}
  </div>;
}

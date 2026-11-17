/**
 * A note field where typing "@" suggests colleagues; choosing one writes "@Full Name",
 * and the database then sends that person a notification.
 */
import { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useRows } from "./store";
import { cn } from "@/lib/utils";

export function MentionTextarea({ value, onChange, onSubmit, placeholder, className, label = "New note", rows = 2 }: {
  value: string; onChange: (v: string) => void; onSubmit?: () => void; placeholder?: string; className?: string; label?: string; rows?: number;
}) {
  const people = useRows("profiles").rows.filter(p => (p.full_name ?? "").trim());
  const ref = useRef<HTMLTextAreaElement>(null);
  const [q, setQ] = useState<string | null>(null); const [active, setActive] = useState(0);
  const matches = q === null ? [] : people.filter(p => p.full_name.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
  // the "@..." being typed right before the cursor, if any
  const scan = (text: string, caret: number) => { const m = /(^|\s)@([^\s@]{0,20}(?: [^\s@]{0,20})?)$/.exec(text.slice(0, caret)); setQ(m ? m[2] : null); setActive(0); };
  const pick = (name: string) => {
    const el = ref.current; if (!el) return;
    const caret = el.selectionStart; const before = value.slice(0, caret); const at = before.lastIndexOf("@");
    const next = `${value.slice(0, at)}@${name} ${value.slice(caret)}`;
    onChange(next); setQ(null);
    requestAnimationFrame(() => { el.focus(); const p = at + name.length + 2; el.setSelectionRange(p, p); });
  };
  return <div className="relative">
    <Textarea ref={ref} aria-label={label} rows={rows} value={value} placeholder={placeholder} className={className}
      onChange={e => { onChange(e.target.value); scan(e.target.value, e.target.selectionStart); }}
      onClick={e => scan(value, (e.target as HTMLTextAreaElement).selectionStart)}
      onBlur={() => setTimeout(() => setQ(null), 150)}
      onKeyDown={e => {
        if (matches.length) {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, matches.length - 1)); return; }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); return; }
          if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(matches[active].full_name); return; }
          if (e.key === "Escape") { e.preventDefault(); setQ(null); return; }
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit?.();
      }} />
    {matches.length > 0 && <ul role="listbox" aria-label="Mention someone" className="absolute left-2 top-full z-30 mt-1 w-64 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg">
      {matches.map((p, i) => <li key={p.user_id} role="option" aria-selected={i === active} onMouseDown={e => { e.preventDefault(); pick(p.full_name); }} onMouseEnter={() => setActive(i)}
        className={cn("flex cursor-pointer items-center gap-2 px-3 py-1.5", i === active ? "bg-indigo-50 text-gray-900" : "text-gray-700")}>
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700">{p.full_name.split(/\s+/).map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
        {p.full_name}<span className="ml-auto text-xs text-gray-400">{p.role}</span></li>)}
    </ul>}
  </div>;
}

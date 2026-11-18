/**
 * The chart of a grouped report: one measure, one axis, one series in the app's accent colour.
 * Bars for categories, a line for a time grouping. Hover shows the exact value. A table is always shown beside it.
 */
import { useEffect, useRef, useState } from "react";
import { money, pct, qty } from "@/app/format";
import type { FieldType } from "./engine";

const fmtVal = (v: number | null, type: string, cur?: string | null, short = false) => v == null ? "–"
  : type === "money" ? money(v, cur ?? "EUR", short ? 0 : 2) : type === "pct" ? pct(v, 1) : qty(Math.round(v * 100) / 100);
const shortNum = (v: number) => Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(Math.abs(v) >= 1e4 ? 0 : 1)}k` : String(Math.round(v * 100) / 100);
function ticks(max: number) { if (max <= 0) return [0]; const p = Math.pow(10, Math.floor(Math.log10(max))); const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => max / s <= 4) ?? p * 10; const out = []; for (let t = 0; t <= max + 1e-9; t += step) out.push(t); if (out[out.length - 1] < max) out.push(out[out.length - 1] + step); return out; }

export function ReportChart({ data, kind, type, currency, height = 220, label }: { data: { x: string; y: number | null }[]; kind: "bar" | "line"; type: FieldType | "number"; currency?: string | null; height?: number; label: string }) {
  const box = useRef<HTMLDivElement>(null); const [w, setW] = useState(600); const [hover, setHover] = useState<number | null>(null);
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(([e]) => setW(Math.max(240, e.contentRect.width))); ro.observe(el); return () => ro.disconnect(); }, []);
  const vals = data.map(d => d.y ?? 0); const minV = Math.min(0, ...vals); const maxV = Math.max(0, ...vals);
  const t = ticks(Math.max(maxV, Math.abs(minV)) || 1); const top = t[t.length - 1]; const bottom = minV < 0 ? -top : 0;
  const pad = { l: 48, r: 12, t: 12, b: data.length > 8 ? 54 : 30 }; const iw = w - pad.l - pad.r, ih = height - pad.t - pad.b;
  const y = (v: number) => pad.t + ih * (1 - (v - bottom) / (top - bottom || 1)); const band = iw / Math.max(1, data.length);
  const x = (i: number) => pad.l + band * i + band / 2; const barW = Math.max(2, Math.min(36, band * 0.62));
  const every = Math.ceil(data.length / Math.max(1, Math.floor(iw / 56)));
  const h = hover != null ? data[hover] : null;
  return <div ref={box} className="relative w-full min-w-0" onMouseLeave={() => setHover(null)}>
    <svg width={w} height={height} role="img" aria-label={label} className="block max-w-full overflow-visible">
      {(bottom < 0 ? [...t.slice(1).map(v => -v).reverse(), ...t] : t).map(v => <g key={v}>
        <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#d1d5db" : "#f3f4f6"} strokeWidth={1} />
        <text x={pad.l - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-gray-400 text-[10px] tabular-nums">{shortNum(v)}</text></g>)}
      {data.map((d, i) => i % every === 0 && <text key={i} x={x(i)} y={height - pad.b + 14} textAnchor={data.length > 8 ? "end" : "middle"} transform={data.length > 8 ? `rotate(-35 ${x(i)} ${height - pad.b + 14})` : undefined}
        className="fill-gray-500 text-[10px]">{d.x.length > 16 ? d.x.slice(0, 15) + "…" : d.x}</text>)}
      {kind === "bar" ? data.map((d, i) => { const v = d.y ?? 0; const y0 = y(0), y1 = y(v); const top_ = Math.min(y0, y1), hh = Math.max(1, Math.abs(y1 - y0));
          return <path key={i} d={roundedBar(x(i) - barW / 2, top_, barW, hh, v >= 0)} className={hover === i ? "fill-indigo-700" : "fill-indigo-600"} />; })
        : <>
          <polyline fill="none" stroke="#4f46e5" strokeWidth={2} strokeLinejoin="round" points={data.map((d, i) => `${x(i)},${y(d.y ?? 0)}`).join(" ")} />
          {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.y ?? 0)} r={hover === i ? 5 : 4} className="fill-indigo-600 stroke-white" strokeWidth={2} />)}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="#c7d2fe" strokeWidth={1} />}
        </>}
      {/* hit targets wider than the marks */}
      {data.map((_, i) => <rect key={i} x={pad.l + band * i} y={pad.t} width={band} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />)}
    </svg>
    {h && <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-lg" style={{ left: x(hover!), top: y(Math.max(0, h.y ?? 0)) - 8 }}>
      <div className="text-gray-300">{h.x}</div><div className="font-semibold tabular-nums">{fmtVal(h.y, type, currency)}</div></div>}
  </div>;
}
/** a bar with 4px rounded corners at its data end only */
function roundedBar(x: number, y: number, w: number, h: number, up: boolean) {
  const r = Math.min(4, w / 2, h);
  return up ? `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
    : `M${x},${y} V${y + h - r} Q${x},${y + h} ${x + r},${y + h} H${x + w - r} Q${x + w},${y + h} ${x + w},${y + h - r} V${y} Z`;
}
export { fmtVal };

/**
 * Messages to the user. Successes stay a small note in the corner (they should not interrupt);
 * errors open a clear pop-up in the middle of the screen that stays until you close it.
 * Use `toast` from here instead of from "sonner".
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast as sonner } from "sonner";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Problem { id: number; title: string; message: ReactNode; key: string }
let show: ((p: Omit<Problem, "id">) => void) | null = null;
let seq = 0;

function error(message: ReactNode, opts?: { title?: string; duration?: number }) {
  const key = typeof message === "string" ? message : String(++seq);
  if (show) show({ title: opts?.title ?? "This did not go through", message, key });
  else sonner.error(message, { duration: opts?.duration });
}

export const toast = Object.assign((m: ReactNode, o?: Parameters<typeof sonner>[1]) => sonner(m, o), {
  success: sonner.success, info: sonner.info, warning: sonner.warning, error,
});

/** the pop-up; mounted once in the app shell */
export function ErrorDialog() {
  const [list, setList] = useState<Problem[]>([]);
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // the same message twice (e.g. several lists failing to load together) is shown once
    show = p => setList(l => l.some(x => x.key === p.key) ? l : [...l, { ...p, id: ++seq }]);
    return () => { show = null; };
  }, []);
  const open = list.length > 0;
  useEffect(() => { if (open) ok.current?.focus(); }, [open]);
  if (!open) return null;
  const close = () => setList([]);
  return <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onKeyDown={e => { if (e.key === "Escape") close(); }}>
    <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-[1px]" onClick={close} aria-hidden />
    <div role="alertdialog" aria-modal="true" aria-labelledby="error-title" aria-describedby="error-body"
      className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200 animate-in fade-in zoom-in-95 duration-150">
      <button type="button" onClick={close} aria-label="Close" className="absolute right-3 top-3 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="h-4 w-4" /></button>
      <div className="flex gap-4 px-6 pb-4 pt-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100"><AlertTriangle className="h-5 w-5 text-rose-600" /></div>
        <div className="min-w-0 flex-1">
          <h2 id="error-title" className="pr-6 text-base font-semibold text-gray-900">{list.length > 1 ? `${list.length} things did not go through` : list[0].title}</h2>
          <div id="error-body" className="mt-2 max-h-[50vh] space-y-2 overflow-y-auto text-sm leading-relaxed text-gray-700">
            {list.map(p => <div key={p.id} className={list.length > 1 ? "rounded-lg bg-gray-50 px-3 py-2" : ""}>{p.message}</div>)}
          </div>
        </div>
      </div>
      <div className="flex justify-end border-t border-gray-100 bg-gray-50/70 px-6 py-3">
        <Button ref={ok} onClick={close}>OK</Button>
      </div>
    </div>
  </div>;
}

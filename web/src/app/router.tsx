/**
 * Path-based routing with readable URLs: /orders/26179, /orders/new, /customers/jml/edit.
 * BASE is where the app is served (GitHub Pages: /ERP_wholesale/). Unknown deep links are
 * served by 404.html (a copy of index.html), so every URL can be bookmarked and reloaded.
 */
import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from "react";

export const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const read = () => {
  let p = window.location.pathname;
  if (BASE && p.startsWith(BASE)) p = p.slice(BASE.length);
  return (p.replace(/\/+$/, "") || "/") + window.location.search;
};

interface Router { path: string; nav: (to: string, opts?: { replace?: boolean }) => void; back: (fallback: string) => void }
const Ctx = createContext<Router>({ path: "/", nav: () => {}, back: () => {} });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(read);
  useEffect(() => {
    // links from the old #hash routes keep working
    const h = window.location.hash.replace(/^#/, "");
    if (h && !h.startsWith("/")) { window.history.replaceState(null, "", BASE + legacy(h)); setPath(read()); }
    const on = () => setPath(read());
    window.addEventListener("popstate", on); return () => window.removeEventListener("popstate", on);
  }, []);
  const nav = (to: string, opts?: { replace?: boolean }) => {
    if (to === path) return;
    window.history[opts?.replace ? "replaceState" : "pushState"](null, "", BASE + to);
    setPath(read()); window.scrollTo(0, 0);
  };
  const back = (fallback: string) => nav(fallback);
  return <Ctx.Provider value={{ path, nav, back }}>{children}</Ctx.Provider>;
}
const legacy = (h: string) => h === "dashboard" ? "/" : "/" + h;

export const useRouter = () => useContext(Ctx);
export const useNav = () => useContext(Ctx).nav;
export const usePath = () => useContext(Ctx).path.split("?")[0];
export const useQuery = () => new URLSearchParams(useContext(Ctx).path.split("?")[1] ?? "");

/** match "/orders/:ref/edit" against a path; returns the params or null */
export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean), b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) out[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return out;
}

const ParamsCtx = createContext<Record<string, string>>({});
export const ParamsProvider = ParamsCtx.Provider;
export const useParams = () => useContext(ParamsCtx);

/** a real link: middle-click and ctrl-click open a new tab, a normal click stays in the app */
export function Link({ to, children, className, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const nav = useNav();
  return <a href={BASE + to} className={className} {...rest}
    onClick={e => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); e.stopPropagation(); nav(to); }}>{children}</a>;
}

import { createClient } from "@supabase/supabase-js";
import type { DataClient, Row, SelectOpts } from "./client";

/** Same contract as the local adapter, served by Supabase (PostgREST). Sign-in is handled in app/Auth. */
export function createSupabaseClient(url: string, key: string): DataClient & { auth: ReturnType<typeof createClient>["auth"] } {
  const sb = createClient(url, key);
  const ok = <T,>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };
  return {
    mode: "supabase",
    auth: sb.auth,
    async select<T>(from: string, o: SelectOpts = {}) {
      let q = sb.from(from).select("*");
      for (const [k, v] of Object.entries(o.eq ?? {})) q = v === null ? q.is(k, null) : q.eq(k, v);
      for (const [c, d] of o.order ?? []) q = q.order(c, { ascending: d !== "desc", nullsFirst: false });
      if (o.limit) q = q.limit(o.limit);
      return ok(await q) as T[];
    },
    async insert<T>(table: string, row: Row) { return ok(await sb.from(table).insert(row).select().single()) as T; },
    async update(table, match, patch) { ok(await sb.from(table).update(patch).match(match)); },
    async remove(table, match) { ok(await sb.from(table).delete().match(match)); },
    async rpc(fn, args = {}) { return ok(await sb.rpc(fn, args)) as any; },
    async session() {
      const { data } = await sb.auth.getSession(); const u = data.session?.user;
      if (!u) return null;
      const p = await sb.from("profiles").select("full_name, role").eq("user_id", u.id).maybeSingle();
      return { email: u.email ?? "", name: p.data?.full_name ?? null, role: p.data?.role ?? null };
    },
    async signIn(email, password) { const r = await sb.auth.signInWithPassword({ email, password }); if (r.error) throw new Error(r.error.message); },
    async signOut() { await sb.auth.signOut(); },
  };
}

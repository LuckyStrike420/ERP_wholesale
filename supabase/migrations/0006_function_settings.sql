-- =====================================================================
-- 0006: every function runs with a fixed search path, and trigger functions cannot be called directly.
-- =====================================================================
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, (p.prorettype = 'trigger'::regtype) as is_trigger
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname <> 'rls_auto_enable' loop
    execute format('alter function %s set search_path = public', f.sig);
    if f.is_trigger then execute format('revoke execute on function %s from authenticated', f.sig); end if;
  end loop;
end $$;

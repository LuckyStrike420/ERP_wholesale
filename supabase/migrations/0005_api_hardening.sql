-- =====================================================================
-- 0005: nothing in this schema is for visitors who are not signed in.
-- Supabase gives its "anon" role access to new objects by default; row-level security already
-- returns nothing to it, this removes the access itself. New tables, views and functions in later
-- migrations must grant to "authenticated" explicitly, as 0003 and 0004 do.
-- =====================================================================
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname <> 'rls_auto_enable' loop
    execute format('revoke execute on function %s from public', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  if exists (select from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
    revoke all on all sequences in schema public from anon;
    for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname <> 'rls_auto_enable' loop
      execute format('revoke execute on function %s from anon', f.sig);
    end loop;
    alter default privileges in schema public revoke all on tables from anon;
    alter default privileges in schema public revoke all on sequences from anon;
    alter default privileges in schema public revoke execute on functions from anon;
  end if;
end $$;

-- =====================================================================
-- 0012: speed. The row-level security policies called app_role() for every row of every table a view reads
-- (twice for reads: the read policy and the "for all" write policy). Wrapped in a sub-select, Postgres
-- evaluates it once per query (Supabase advice "auth_rls_initplan"). Same rules, same access.
-- Roll back: re-run the policy block of 0003 without the sub-selects.
-- =====================================================================
do $$
declare p record; q text; c text; cmd text;
begin
  for p in select * from pg_policies where schemaname = 'public' and (qual like '%app_role()%' or with_check like '%app_role()%') loop
    q := replace(p.qual, 'app_role()', '(select app_role())');
    c := replace(p.with_check, 'app_role()', '(select app_role())');
    execute format('drop policy %I on %I', p.policyname, p.tablename);
    cmd := format('create policy %I on %I as %s for %s to %s', p.policyname, p.tablename, p.permissive, p.cmd, array_to_string(p.roles, ', '));
    if q is not null then cmd := cmd || format(' using (%s)', q); end if;
    if c is not null then cmd := cmd || format(' with check (%s)', c); end if;
    execute cmd;
  end loop;
end $$;

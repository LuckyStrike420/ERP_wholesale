-- =====================================================================
-- 0013: speed. Each write policy was "for all", so it was also checked on every read next to read_all
-- (Supabase advice "multiple_permissive_policies"). Split into insert / update / delete with the same
-- condition: reading checks only read_all, writing checks exactly what it did before.
-- Roll back: drop the *_insert/_update/_delete policies and re-create the "for all" ones of 0003/0012.
-- =====================================================================
do $$
declare p record; cond text;
begin
  for p in select * from pg_policies where schemaname = 'public' and cmd = 'ALL' and policyname like 'write_%' loop
    cond := p.qual;
    execute format('drop policy %I on %I', p.policyname, p.tablename);
    execute format('create policy %I on %I for insert to %s with check (%s)', p.policyname || '_insert', p.tablename, array_to_string(p.roles, ', '), coalesce(p.with_check, cond));
    execute format('create policy %I on %I for update to %s using (%s) with check (%s)', p.policyname || '_update', p.tablename, array_to_string(p.roles, ', '), cond, coalesce(p.with_check, cond));
    execute format('create policy %I on %I for delete to %s using (%s)', p.policyname || '_delete', p.tablename, array_to_string(p.roles, ', '), cond);
  end loop;
end $$;

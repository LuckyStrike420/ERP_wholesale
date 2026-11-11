-- =====================================================================
-- 0003: audit log, users/roles and row-level security
-- =====================================================================

-- current user id from the Supabase JWT (null for service/import connections)
create or replace function app_user_id() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create table profiles (
  user_id   uuid primary key,          -- = auth.users.id in Supabase
  full_name text,
  role      text not null check (role in ('admin','finance','operations'))
);

create or replace function app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where user_id = app_user_id()
$$;

-- ---------- audit log ----------
create table audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  row_id     uuid,
  action     text not null,
  old_data   jsonb,
  new_data   jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index on audit_log (table_name, row_id);

create or replace function trg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb;
begin
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and o = n then return new; end if;
  insert into audit_log (table_name, row_id, action, old_data, new_data, changed_by)
  values (tg_table_name, nullif(coalesce(n, o) ->> 'id', '')::uuid, tg_op, o, n, app_user_id());
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'customers','suppliers','products','price_agreements',
    'sales_orders','sales_order_lines','order_cost_lines','order_adjustments','invoices',
    'purchase_orders','supplier_invoices','payments','payment_allocations','write_offs',
    'shipments','shipment_orders','batches','batch_items','stock_adjustments']
  loop
    execute format('create trigger audit after insert or update or delete on %I for each row execute function trg_audit()', t);
  end loop;
end $$;
-- tables without an id column are audited with their full row
create trigger audit after insert or update or delete on customer_terms     for each row execute function trg_audit();
create trigger audit after insert or update or delete on supplier_terms     for each row execute function trg_audit();
create trigger audit after insert or update or delete on product_cost_rules for each row execute function trg_audit();
create trigger audit after insert or update or delete on app_settings       for each row execute function trg_audit();

-- ---------- row-level security ----------
-- admin: everything. operations: orders, purchasing, shipping, stock, master data. finance: payments, write-offs, FX rates.
-- All three roles can read everything (both current users may see cost and margin).
do $$ begin
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

do $$
declare t text;
  ops text[] := array['customers','customer_terms','suppliers','supplier_terms','products','product_cost_rules','price_agreements',
    'sales_orders','sales_order_lines','order_cost_lines','order_adjustments','invoices','purchase_orders','supplier_invoices',
    'shipments','shipment_orders','batches','batch_items','stock_adjustments','attachments'];
  money text[] := array['payments','payment_allocations','write_offs','fx_rates'];
  admin_only text[] := array['app_settings','order_types','order_statuses','product_kinds','stock_adjustment_kinds','profiles','import_runs','import_issues'];
begin
  foreach t in array ops || money || admin_only || array['audit_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('create policy read_all on %I for select to authenticated using (app_role() is not null)', t);
  end loop;
  foreach t in array ops loop
    execute format($f$create policy write_ops on %I for all to authenticated
      using (app_role() in ('admin','operations')) with check (app_role() in ('admin','operations'))$f$, t);
  end loop;
  foreach t in array money loop
    execute format($f$create policy write_money on %I for all to authenticated
      using (app_role() in ('admin','finance')) with check (app_role() in ('admin','finance'))$f$, t);
  end loop;
  foreach t in array admin_only loop
    execute format($f$create policy write_admin on %I for all to authenticated
      using (app_role() = 'admin') with check (app_role() = 'admin')$f$, t);
  end loop;
end $$;
-- the audit log is written by triggers only
revoke insert, update, delete on audit_log from authenticated;

do $$
declare v text;
begin
  for v in select table_name from information_schema.views where table_schema = 'public' loop
    execute format('grant select on %I to authenticated', v);
  end loop;
end $$;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

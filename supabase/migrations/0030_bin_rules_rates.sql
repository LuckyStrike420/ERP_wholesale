-- =====================================================================
-- 0030: recycle bin, own validation rules, ECB exchange rates.
-- Recycle bin
-- - Deleting an order, an order line or a document keeps a copy of the row (and of everything deleted with it:
--   lines, cost lines, corrections, tasks, notes, documents, approvals) in recycle_bin, grouped per deletion.
-- - restore_deleted(batch) puts it all back in one go; purge_recycle_bin() removes what is older than 30 days
--   (daily). Document files stay in storage until the purge.
-- Validation rules
-- - validation_rules: "when an order reaches <status> (or later), <requirement> must be met", optionally per order type.
-- - Checked by the database when an order moves forward (at commit, like the approval gate); moving back is never
--   blocked; imports (app.no_automations) are not checked. v_order_rule_checks lists what is still missing for the
--   steps ahead, for the order page.
-- - Starting rules (the two examples asked for): PI needs a customer PO; FOB shipped needs a B/L number.
-- ECB rates
-- - fetch_ecb_rates() reads the ECB reference rates (data-api.ecb.europa.eu) since the last stored one and stores
--   them in fx_rates (source 'ECB'); a rate typed in by hand for the same day is kept. Daily on working days.
-- Roll back: drop the triggers and functions named below, tables recycle_bin and validation_rules,
--            view v_order_rule_checks, cron jobs purge-recycle-bin and ecb-rates.
-- =====================================================================

-- ---------- recycle bin ----------
create table recycle_bin (
  id          bigint generated always as identity primary key,
  batch       uuid not null,
  table_name  text not null,
  row_id      uuid,
  row_data    jsonb not null,
  label       text,
  deleted_by  uuid default app_user_id(),
  deleted_at  timestamptz not null default now()
);
create index on recycle_bin (batch);
create index on recycle_bin (deleted_at);

-- one batch per deleting transaction: the order and everything that goes with it
create or replace function recycle_batch() returns uuid language plpgsql as $$
declare b text := current_setting('app.recycle_batch', true); t text := current_setting('app.recycle_tx', true);
begin
  if b is null or b = '' or t is distinct from txid_current()::text then
    b := gen_random_uuid()::text;
    perform set_config('app.recycle_batch', b, true);
    perform set_config('app.recycle_tx', txid_current()::text, true);
  end if;
  return b::uuid;
end $$;

create or replace function trg_recycle() returns trigger language plpgsql security definer set search_path = public as $$
declare lbl text; j jsonb := to_jsonb(old);
begin
  if coalesce(current_setting('app.no_recycle', true), '') = 'on' then return old; end if;
  lbl := case tg_table_name
    when 'sales_orders' then coalesce('PI ' || (j ->> 'pi_number'), 'Draft order') || coalesce(' · ' || (select name from customers where id = (j ->> 'customer_id')::uuid), '')
    when 'sales_order_lines' then 'Line ' || (j ->> 'line_no') || ' of ' || coalesce((select coalesce('PI ' || pi_number, 'draft') from sales_orders where id = (j ->> 'sales_order_id')::uuid), 'an order')
                                  || coalesce(' · ' || (select name from products where id = (j ->> 'product_id')::uuid), '')
    when 'attachments' then 'Document ' || (j ->> 'file_name')
    when 'generated_documents' then initcap(replace(j ->> 'doc_type', '_', ' ')) || ' ' || (j ->> 'doc_number')
    when 'tasks' then 'Task ' || (j ->> 'title')
    when 'record_notes' then 'Note'
    else tg_table_name end;
  insert into recycle_bin (batch, table_name, row_id, row_data, label) values (recycle_batch(), tg_table_name, (j ->> 'id')::uuid, j, lbl);
  return old;
end $$;

-- the tables a deleted order takes with it, parents first (restore goes in this order)
create or replace function recycle_tables() returns text[] language sql immutable as $$
  select array['sales_orders','sales_order_lines','order_cost_lines','order_adjustments','approvals','tasks','record_notes','generated_documents','attachments']
$$;

do $$
declare t text;
begin
  foreach t in array recycle_tables() loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      execute format('create trigger recycle before delete on %I for each row execute function trg_recycle()', t);
    end if;
  end loop;
end $$;

-- what is in the bin: one row per deletion
create view v_recycle_bin with (security_invoker = true) as
select b.batch, min(b.deleted_at) as deleted_at, (array_agg(b.label order by array_position(recycle_tables(), b.table_name), b.id))[1] as label,
       (array_agg(b.table_name order by array_position(recycle_tables(), b.table_name), b.id))[1] as main_table,
       count(*)::int as rows, max(p.full_name) as deleted_by_name, (min(b.deleted_at) + interval '30 days')::date as purge_on,
       jsonb_object_agg(b.table_name, 1) as tables
  from recycle_bin b left join profiles p on p.user_id = b.deleted_by
 group by b.batch;

create or replace function restore_deleted(p_batch uuid) returns int
language plpgsql security definer set search_path = public as $$
declare t text; r record; n int := 0;
begin
  if app_user_id() is not null and (app_role() is null or not can('delete_records')) then
    raise exception 'Your role may not restore deleted records';
  end if;
  if not exists (select 1 from recycle_bin where batch = p_batch) then raise exception 'Nothing to restore: it was restored or removed already'; end if;
  perform set_config('app.no_automations', 'on', true);   -- a restored order is put back as it was, no new tasks or checks
  perform set_config('app.no_recycle', 'on', true);
  foreach t in array recycle_tables() loop
    for r in select * from recycle_bin where batch = p_batch and table_name = t order by id loop
      if t in ('sales_order_lines','order_cost_lines','order_adjustments','approvals','tasks','record_notes','generated_documents')
         and r.row_data ? 'sales_order_id' and r.row_data ->> 'sales_order_id' is not null
         and not exists (select 1 from sales_orders where id = (r.row_data ->> 'sales_order_id')::uuid) then
        raise exception 'Restore the order first: % belongs to an order that is not there any more', r.label;
      end if;
      execute format('insert into %I select * from jsonb_populate_record(null::%I, $1) on conflict do nothing', t, t) using r.row_data;
      n := n + 1;
    end loop;
  end loop;
  delete from recycle_bin where batch = p_batch;
  -- the settings stay on until the end of this transaction, so the checks at commit do not run on the restored rows
  return n;
end $$;

create or replace function purge_recycle_bin(p_batch uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int; f text;
begin
  if p_batch is not null and app_user_id() is not null and app_role() <> 'admin' then raise exception 'Only an admin can remove from the recycle bin for good'; end if;
  -- the document files go with them (Supabase storage), when there is storage
  for f in select row_data ->> 'storage_path' from recycle_bin
            where table_name = 'attachments' and (p_batch is null and deleted_at < now() - interval '30 days' or batch = p_batch) loop
    begin execute 'delete from storage.objects where bucket_id = ''documents'' and name = $1' using f; exception when others then null; end;
  end loop;
  delete from recycle_bin where (p_batch is null and deleted_at < now() - interval '30 days') or batch = p_batch;
  get diagnostics n = row_count;
  return n;
end $$;

alter table recycle_bin enable row level security;
grant select on recycle_bin to authenticated;
create policy read_all on recycle_bin for select to authenticated using ((select app_role()) is not null);
grant select on v_recycle_bin to authenticated;
revoke execute on function restore_deleted(uuid), purge_recycle_bin(uuid) from public;
grant execute on function restore_deleted(uuid), purge_recycle_bin(uuid) to authenticated;

-- ---------- validation rules ----------
create table validation_rules (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) > 0),
  active       boolean not null default true,
  status       text not null references order_statuses (code),
  order_type   text references order_types (code),
  requirement  text not null check (requirement in ('customer_po','pi_number','po_date','payment_term','customer_address','customer_vat',
                 'lines_have_po','cost_complete','shipment_linked','container_number','bl_number','etd','eta','docs_complete',
                 'deposit_paid','fully_paid','invoice')),
  message      text,
  created_by   uuid default app_user_id(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (status not in ('draft','cancelled'))
);
create trigger touch before update on validation_rules for each row execute function trg_touch_updated_at();
create trigger audit after insert or update or delete on validation_rules for each row execute function trg_audit();

create or replace function requirement_met(p_order uuid, p_req text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare o v_orders; c customers; s shipments; tol numeric := setting_num('payment_tolerance');
begin
  select * into o from v_orders where id = p_order;
  select * into c from customers where id = o.customer_id;
  select sh.* into s from shipment_orders so join shipments sh on sh.id = so.shipment_id where so.sales_order_id = p_order limit 1;
  return case p_req
    when 'customer_po'      then nullif(trim(o.customer_po), '') is not null
    when 'pi_number'        then nullif(trim(o.pi_number), '') is not null
    when 'po_date'          then o.po_date is not null
    when 'payment_term'     then o.payment_term_id is not null
    when 'customer_address' then nullif(trim(c.address), '') is not null
    when 'customer_vat'     then nullif(trim(c.vat_number), '') is not null
    when 'lines_have_po'    then not exists (select 1 from sales_order_lines l where l.sales_order_id = p_order and l.quantity - l.quantity_cancelled > 0 and l.purchase_order_id is null)
    when 'cost_complete'    then o.cost_missing_lines = 0
    when 'shipment_linked'  then s.id is not null
    when 'container_number' then nullif(trim(s.container_number), '') is not null
    when 'bl_number'        then nullif(trim(s.bl_number), '') is not null
    when 'etd'              then o.etd is not null
    when 'eta'              then o.eta is not null
    when 'docs_complete'    then coalesce(s.docs_complete, false)
    when 'deposit_paid'     then o.deposit_outstanding <= tol
    when 'fully_paid'       then o.outstanding <= tol
    when 'invoice'          then o.invoice_number is not null
    else true end;
end $$;

-- what is still missing per order, for the steps ahead (and the step it is in)
create view v_order_rule_checks with (security_invoker = true) as
select o.id as sales_order_id, r.id as rule_id, r.name, r.status, st.label as status_label, st.rank as status_rank, r.requirement,
       coalesce(nullif(trim(r.message), ''), r.name) as message, (st.rank <= os.rank) as passed_already
  from sales_orders o
  join order_statuses os on os.code = o.status
  join validation_rules r on r.active and (r.order_type is null or r.order_type = o.order_type)
  join order_statuses st on st.code = r.status
 where o.status not in ('cancelled','completed') and not requirement_met(o.id, r.requirement);
grant select on v_order_rule_checks to authenticated;

create or replace function validation_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text; from_rank int; to_rank int; msgs text;
begin
  if coalesce(current_setting('app.no_automations', true), '') = 'on' then return null; end if;
  select status into st from sales_orders where id = new.id;
  if st is null or st in ('draft','cancelled') then return null; end if;
  from_rank := case when tg_op = 'INSERT' then 0 else (select rank from order_statuses where code = old.status) end;
  to_rank := (select rank from order_statuses where code = st);
  if to_rank <= from_rank then return null; end if;
  select string_agg(coalesce(nullif(trim(r.message), ''), r.name), '; ' order by s.rank) into msgs
    from validation_rules r join order_statuses s on s.code = r.status
   where r.active and (r.order_type is null or r.order_type = new.order_type)
     and s.rank > from_rank and s.rank <= to_rank and not requirement_met(new.id, r.requirement);
  if msgs is not null then
    raise exception 'This order cannot move on yet: %. Change the rules under Admin → Validation rules.', msgs;
  end if;
  return null;
end $$;
create constraint trigger validation_gate after insert or update of status on sales_orders
  deferrable initially deferred for each row execute function validation_check();

alter table validation_rules enable row level security;
grant select, insert, update, delete on validation_rules to authenticated;
create policy read_all on validation_rules for select to authenticated using ((select app_role()) is not null);
create policy write_admin_insert on validation_rules for insert to authenticated with check ((select app_role()) = 'admin');
create policy write_admin_update on validation_rules for update to authenticated using ((select app_role()) = 'admin') with check ((select app_role()) = 'admin');
create policy write_admin_delete on validation_rules for delete to authenticated using ((select app_role()) = 'admin');

insert into validation_rules (name, status, order_type, requirement, message) values
  ('PI needs a customer PO', 'pi_sent', null, 'customer_po', 'a PI cannot go out without the customer''s PO number'),
  ('FOB shipped needs a B/L number', 'shipped', 'FOB', 'bl_number', 'a FOB order cannot be Shipped without a B/L number on its shipment');

-- ---------- ECB exchange rates ----------
-- the ECB CSV (one currency against EUR): returns date and "units of the currency per 1 EUR"
create or replace function ecb_csv_rates(p_csv text) returns table (rate_date date, per_eur numeric)
language plpgsql immutable as $$
declare lines text[] := regexp_split_to_array(replace(coalesce(p_csv, ''), E'\r', ''), E'\n'); hdr text[]; it int; iv int; f text[]; i int;
begin
  if array_length(lines, 1) is null or array_length(lines, 1) < 2 then return; end if;
  hdr := string_to_array(lines[1], ',');
  it := array_position(hdr, 'TIME_PERIOD'); iv := array_position(hdr, 'OBS_VALUE');
  if it is null or iv is null then raise exception 'ECB answer not understood (no TIME_PERIOD / OBS_VALUE column)'; end if;
  for i in 2 .. array_length(lines, 1) loop
    continue when trim(lines[i]) = '';
    f := string_to_array(lines[i], ',');
    continue when coalesce(f[iv], '') !~ '^[0-9]+(\.[0-9]+)?$';
    rate_date := f[it]::date; per_eur := f[iv]::numeric;
    return next;
  end loop;
end $$;

do $$ begin
  create extension if not exists http with schema extensions;
exception when others then raise notice 'http extension not available here: %', sqlerrm;
end $$;

create or replace function fetch_ecb_rates(p_from date default null) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare rep text := (select value from app_settings where key = 'reporting_currency');
        cur text; start date; body text; n int := 0; m int;
begin
  -- every non-EUR order currency, against EUR
  for cur in select distinct currency from order_types where currency <> 'EUR' loop
    start := coalesce(p_from,
      (select max(rate_date) + 1 from fx_rates where source = 'ECB'),
      least((select min(coalesce(po_date, pi_date)) from sales_orders) - 7, app_today() - 30),
      app_today() - 30);
    if start > app_today() then continue; end if;
    begin perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '20000'); exception when others then null; end;
    select content into body from http_get('https://data-api.ecb.europa.eu/service/data/EXR/D.' || cur || '.EUR.SP00.A?format=csvdata&startPeriod=' || start::text);
    -- 1 unit of each currency in the reporting currency
    if rep = 'EUR' then
      insert into fx_rates (rate_date, currency, rate, source)
      select x.rate_date, cur, round(1 / x.per_eur, 6), 'ECB' from ecb_csv_rates(body) x
      on conflict (rate_date, currency) do update set rate = excluded.rate where fx_rates.source = 'ECB';
    elsif rep = cur then
      insert into fx_rates (rate_date, currency, rate, source)
      select x.rate_date, 'EUR', round(x.per_eur, 6), 'ECB' from ecb_csv_rates(body) x
      on conflict (rate_date, currency) do update set rate = excluded.rate where fx_rates.source = 'ECB';
    end if;
    get diagnostics m = row_count; n := n + m;
  end loop;
  return n;
end $$;
revoke execute on function fetch_ecb_rates(date) from public;
grant execute on function fetch_ecb_rates(date) to authenticated;

-- daily jobs (Supabase only): rates on working days after the ECB publishes (around 16:00 CET), bin at night
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ecb-rates', '20 15 * * 1-5', 'select public.fetch_ecb_rates()');
    perform cron.schedule('purge-recycle-bin', '40 2 * * *', 'select public.purge_recycle_bin()');
  end if;
exception when others then raise notice 'cron jobs not scheduled: %', sqlerrm;
end $$;

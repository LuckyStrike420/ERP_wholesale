-- =====================================================================
-- 0017: editable shipping documents, carton data, contacts and saved filters
--  * products: carton data (pieces per carton already existed; carton_weight_kg = gross kg per carton)
--  * suppliers: address (for the PO document)
--  * contacts: people at a customer or supplier, with their role
--  * saved_views: a user's own saved filters (e.g. on the order list)
--  * generated_documents: packing lists and delivery notes. draft_document() fills a first version from the
--    order, its products and its shipment; after that the document is the user's own text and is never recalculated.
--  * v_order_timeline: also shows these documents
-- Roll back: drop the three tables, the function and the new columns; re-create v_order_timeline from 0016.
-- =====================================================================
alter table products add column carton_net_kg    numeric(10,3) check (carton_net_kg >= 0);
alter table products add column carton_length_cm numeric(8,1)  check (carton_length_cm > 0);
alter table products add column carton_width_cm  numeric(8,1)  check (carton_width_cm > 0);
alter table products add column carton_height_cm numeric(8,1)  check (carton_height_cm > 0);
comment on column products.carton_weight_kg is 'Gross weight of one full carton (kg)';
comment on column products.carton_net_kg is 'Net weight of the goods in one full carton (kg)';
alter table suppliers add column address text;

-- ---------- contacts ----------
create table contacts (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid references customers on delete cascade,
  supplier_id uuid references suppliers on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  role        text,
  email       text,
  phone       text,
  is_primary  boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now(),
  check (num_nonnulls(customer_id, supplier_id) = 1)
);
create index on contacts (customer_id);
create index on contacts (supplier_id);

-- ---------- saved filters ----------
create table saved_views (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid default app_user_id(),
  page       text not null,
  name       text not null check (length(trim(name)) > 0),
  query      text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, page, name)
);

-- ---------- packing lists and delivery notes ----------
create table generated_documents (
  id             uuid primary key default gen_random_uuid(),
  doc_type       text not null check (doc_type in ('packing_list','delivery_note')),
  doc_number     text not null check (length(trim(doc_number)) > 0),
  sales_order_id uuid not null references sales_orders on delete cascade,
  shipment_id    uuid references shipments on delete set null,
  doc_date       date not null default current_date,
  header         jsonb not null default '{}',
  lines          jsonb not null default '[]',
  created_by     uuid default app_user_id(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (doc_type, doc_number)
);
create index on generated_documents (sales_order_id);

create or replace function trg_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger touch before update on generated_documents for each row execute function trg_touch_updated_at();

-- first version of a document: order, customer, company details, shipment and the carton data of each product
create or replace function draft_document(p_order uuid, p_type text) returns jsonb
language plpgsql stable set search_path = public as $$
declare o record; c record; sh record; n int; base text; result jsonb;
begin
  if p_type not in ('packing_list','delivery_note') then raise exception 'Unknown document type %', p_type; end if;
  select * into o from sales_orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  select * into c from customers where id = o.customer_id;
  select s.* into sh from shipment_orders so join shipments s on s.id = so.shipment_id where so.sales_order_id = p_order limit 1;
  base := case p_type when 'packing_list' then 'PL-' else 'DN-' end || coalesce(o.pi_number, 'draft-' || left(o.id::text, 8));
  select count(*) into n from generated_documents where doc_type = p_type and doc_number like base || '%';
  select jsonb_build_object(
    'doc_type', p_type,
    'doc_number', base || case when n > 0 then '-' || (n + 1) else '' end,
    'doc_date', app_today(),
    'shipment_id', sh.id,
    'header', jsonb_build_object(
      'shipper', concat_ws(E'\n', nullif((select value from app_settings where key = 'company_name'), ''), nullif((select value from app_settings where key = 'company_address'), '')),
      'consignee', concat_ws(E'\n', c.name, coalesce(nullif(c.address, ''), c.country)),
      'deliver_to', concat_ws(E'\n', c.name, coalesce(nullif(c.address, ''), c.country)),
      'pi_number', o.pi_number, 'customer_po', o.customer_po, 'terms', o.order_type,
      'forwarder', sh.forwarder, 'container_number', sh.container_number, 'seal_number', null, 'bl_number', sh.bl_number,
      'port_loading', sh.port_loading, 'port_discharge', sh.port_discharge, 'etd', sh.etd, 'eta', sh.eta,
      'shipping_marks', null, 'notes', null),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', p.id, 'description', p.name, 'sku', p.sku, 'qty', l.quantity - l.quantity_cancelled,
               'units_per_carton', p.units_per_carton, 'net_kg_carton', p.carton_net_kg, 'gross_kg_carton', p.carton_weight_kg,
               'length_cm', p.carton_length_cm, 'width_cm', p.carton_width_cm, 'height_cm', p.carton_height_cm,
               'cartons', null, 'net_kg', null, 'gross_kg', null, 'cbm', null, 'remarks', null) order by l.line_no)
        from sales_order_lines l join products p on p.id = l.product_id
       where l.sales_order_id = p_order and l.quantity - l.quantity_cancelled > 0), '[]'))
  into result;
  return result;
end $$;

-- ---------- access and history ----------
do $$
declare t text;
begin
  foreach t in array array['contacts','generated_documents'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('create policy read_all on %I for select to authenticated using ((select app_role()) is not null)', t);
    execute format('create policy write_all_insert on %I for insert to authenticated with check ((select app_role()) is not null)', t);
    execute format('create policy write_all_update on %I for update to authenticated using ((select app_role()) is not null) with check ((select app_role()) is not null)', t);
    execute format('create policy write_all_delete on %I for delete to authenticated using ((select app_role()) is not null)', t);
    execute format('create trigger audit after insert or update or delete on %I for each row execute function trg_audit()', t);
  end loop;
end $$;
-- saved filters are private to the user who made them
alter table saved_views enable row level security;
grant select, insert, update, delete on saved_views to authenticated;
create policy own_select on saved_views for select to authenticated using (user_id = (select app_user_id()));
create policy own_insert on saved_views for insert to authenticated with check (user_id = (select app_user_id()) and (select app_role()) is not null);
create policy own_update on saved_views for update to authenticated using (user_id = (select app_user_id())) with check (user_id = (select app_user_id()));
create policy own_delete on saved_views for delete to authenticated using (user_id = (select app_user_id()));
grant execute on function draft_document(uuid, text) to authenticated;
revoke execute on function draft_document(uuid, text) from public;

-- ---------- timeline: also the generated documents ----------
create or replace view v_order_timeline with (security_invoker = true) as
with ev as (
  select a.row_id as sales_order_id, a.changed_at as at, case when a.action = 'INSERT' then 'created' when a.old_data ->> 'status' is distinct from a.new_data ->> 'status' then 'status' else 'change' end as kind,
         case when a.action = 'INSERT' then 'Order created'
              when a.old_data ->> 'status' is distinct from a.new_data ->> 'status'
                then 'Status: ' || coalesce(so.label, a.old_data ->> 'status') || ' → ' || coalesce(sn.label, a.new_data ->> 'status')
              else 'Order changed' end as title,
         case when a.action = 'UPDATE' then
           (select string_agg(replace(n.key, '_', ' '), ', ' order by n.key) from jsonb_each(a.new_data) n
             where n.value is distinct from a.old_data -> n.key and n.key not in ('status')) end as detail,
         null::numeric as amount, a.changed_by as actor, null::uuid as ref_id
    from audit_log a
    left join order_statuses so on so.code = a.old_data ->> 'status'
    left join order_statuses sn on sn.code = a.new_data ->> 'status'
   where a.table_name = 'sales_orders' and a.action in ('INSERT','UPDATE')
  union all
  select al.sales_order_id, p.payment_date::timestamptz, 'payment',
         case when p.voided_at is not null then 'Payment voided' else 'Payment received' end,
         nullif(concat_ws(' · ', p.reference, p.void_reason), ''), al.amount, null::uuid, p.id
    from payment_allocations al join payments p on p.id = al.payment_id
   where al.sales_order_id is not null
  union all
  select i.sales_order_id, i.invoice_date::timestamptz, 'invoice', 'Invoice ' || coalesce(i.invoice_number, ''), null, null, null, i.id
    from invoices i
  union all
  select ad.sales_order_id, ad.created_at, 'correction', 'Correction', ad.reason, ad.amount, null, ad.id
    from order_adjustments ad
  union all
  select w.sales_order_id, w.write_off_date::timestamptz, 'write_off', 'Write-off', w.reason, w.amount, null, w.id
    from write_offs w where w.sales_order_id is not null
  union all
  select x.sales_order_id, po.created_at, 'purchase_order', 'PO ' || po.po_number || ' to ' || s.name, null, null, null, po.id
    from (select distinct sales_order_id, purchase_order_id from sales_order_lines where purchase_order_id is not null) x
    join purchase_orders po on po.id = x.purchase_order_id join suppliers s on s.id = po.supplier_id
  union all
  select so2.sales_order_id, coalesce(sh.etd, sh.eta, sh.ready_date)::timestamptz, 'shipment',
         'Shipment' || coalesce(' ' || sh.container_number, ''),
         nullif(concat_ws(' · ', 'ETD ' || to_char(sh.etd, 'DD-MM-YYYY'), 'ETA ' || to_char(sh.eta, 'DD-MM-YYYY')), ''), null, null, sh.id
    from shipment_orders so2 join shipments sh on sh.id = so2.shipment_id
   where so2.sales_order_id is not null and coalesce(sh.etd, sh.eta, sh.ready_date) is not null
  union all
  select n.sales_order_id, n.created_at, 'note', 'Note', n.body, null, n.created_by, n.id
    from record_notes n where n.sales_order_id is not null
  union all
  select t.sales_order_id, t.created_at, 'task', 'Task: ' || t.title, case when t.due_date is not null then 'due ' || to_char(t.due_date, 'DD-MM-YYYY') end, null, t.created_by, t.id
    from tasks t where t.sales_order_id is not null
  union all
  select t.sales_order_id, t.done_at, 'task_done', 'Task done: ' || t.title, null, null, null, t.id
    from tasks t where t.sales_order_id is not null and t.done_at is not null
  union all
  select d.entity_id, d.created_at, 'document', 'Document added: ' || d.file_name, d.doc_type, null, d.uploaded_by, d.id
    from attachments d where d.entity_table = 'sales_orders'
  union all
  select g.sales_order_id, g.created_at, 'generated',
         case g.doc_type when 'packing_list' then 'Packing list ' else 'Delivery note ' end || g.doc_number || ' made', null, null, g.created_by, g.id
    from generated_documents g
)
select ev.sales_order_id, ev.at, ev.kind, ev.title, ev.detail, ev.amount, ev.actor, pr.full_name as actor_name, ev.ref_id
  from ev left join profiles pr on pr.user_id = ev.actor;
grant select on v_order_timeline to authenticated;

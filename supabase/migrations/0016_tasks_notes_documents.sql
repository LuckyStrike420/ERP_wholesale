-- =====================================================================
-- 0016: tasks, notes, documents and the timeline of an order (ideas from EspoCRM: Tasks, Stream, Documents)
--  * tasks: always linked to at least one record (order, PO, customer, supplier or shipment).
--    A task on an order also shows on that customer; a task on a PO also on that supplier.
--  * record_notes: short notes on a record, shown in its timeline
--  * attachments (existing table): gets size, type and uploader; the files live in the private storage bucket "documents"
--  * v_tasks: tasks with readable links and a state (overdue / today / upcoming / no_date / done)
--  * v_order_timeline: everything that happened to an order, in one list
-- Every role may work with tasks, notes and documents. Roll back: drop the views, the two tables and the new columns.
-- =====================================================================

-- ---------- tasks ----------
create table tasks (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (length(trim(title)) > 0),
  details           text,
  due_date          date,
  status            text not null default 'open' check (status in ('open','done')),
  done_at           timestamptz,
  assigned_to       uuid references profiles (user_id) on delete set null,
  sales_order_id    uuid references sales_orders on delete cascade,
  purchase_order_id uuid references purchase_orders on delete cascade,
  customer_id       uuid references customers on delete cascade,
  supplier_id       uuid references suppliers on delete cascade,
  shipment_id       uuid references shipments on delete cascade,
  created_by        uuid default app_user_id(),
  created_at        timestamptz not null default now(),
  check (num_nonnulls(sales_order_id, purchase_order_id, customer_id, supplier_id, shipment_id) > 0)
);
create index on tasks (sales_order_id);
create index on tasks (purchase_order_id);
create index on tasks (customer_id);
create index on tasks (supplier_id);
create index on tasks (status, due_date);

create or replace function trg_task_links() returns trigger language plpgsql as $$
begin
  if new.sales_order_id is not null and new.customer_id is null then
    select customer_id into new.customer_id from sales_orders where id = new.sales_order_id;
  end if;
  if new.purchase_order_id is not null and new.supplier_id is null then
    select supplier_id into new.supplier_id from purchase_orders where id = new.purchase_order_id;
  end if;
  if new.status = 'done' and new.done_at is null then new.done_at := now(); end if;
  if new.status = 'open' then new.done_at := null; end if;
  return new;
end $$;
create trigger task_links before insert or update on tasks for each row execute function trg_task_links();

-- ---------- notes ----------
create table record_notes (
  id                uuid primary key default gen_random_uuid(),
  body              text not null check (length(trim(body)) > 0),
  sales_order_id    uuid references sales_orders on delete cascade,
  purchase_order_id uuid references purchase_orders on delete cascade,
  customer_id       uuid references customers on delete cascade,
  supplier_id       uuid references suppliers on delete cascade,
  created_by        uuid default app_user_id(),
  created_at        timestamptz not null default now(),
  check (num_nonnulls(sales_order_id, purchase_order_id, customer_id, supplier_id) > 0)
);
create index on record_notes (sales_order_id);
create index on record_notes (purchase_order_id);

-- ---------- documents ----------
alter table attachments add column size_bytes  bigint;
alter table attachments add column mime_type   text;
alter table attachments add column uploaded_by uuid default app_user_id();
alter table attachments add column notes       text;
alter table attachments add constraint attachments_entity_table check (entity_table in ('sales_orders','purchase_orders','customers','suppliers','shipments'));

-- ---------- access and history ----------
do $$
declare t text;
begin
  foreach t in array array['tasks','record_notes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('create policy read_all on %I for select to authenticated using ((select app_role()) is not null)', t);
    execute format('create policy write_all_insert on %I for insert to authenticated with check ((select app_role()) is not null)', t);
    execute format('create trigger audit after insert or update or delete on %I for each row execute function trg_audit()', t);
  end loop;
end $$;
create policy write_all_update on tasks for update to authenticated using ((select app_role()) is not null) with check ((select app_role()) is not null);
create policy write_all_delete on tasks for delete to authenticated using ((select app_role()) is not null);
-- a note is changed or removed by whoever wrote it, or by an admin
create policy write_own_update on record_notes for update to authenticated
  using (created_by = (select app_user_id()) or (select app_role()) = 'admin') with check ((select app_role()) is not null);
create policy write_own_delete on record_notes for delete to authenticated
  using (created_by = (select app_user_id()) or (select app_role()) = 'admin');

-- documents: every role (finance adds payment proofs, operations the shipping documents)
drop policy if exists write_ops_insert on attachments;
drop policy if exists write_ops_update on attachments;
drop policy if exists write_ops_delete on attachments;
drop policy if exists write_ops on attachments;
create policy write_all_insert on attachments for insert to authenticated with check ((select app_role()) is not null);
create policy write_all_update on attachments for update to authenticated using ((select app_role()) is not null) with check ((select app_role()) is not null);
create policy write_all_delete on attachments for delete to authenticated using ((select app_role()) is not null);
create trigger audit after insert or update or delete on attachments for each row execute function trg_audit();

-- the private file bucket (only on Supabase; the local test database keeps files in the browser)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;
    execute 'drop policy if exists documents_read on storage.objects';
    execute 'drop policy if exists documents_insert on storage.objects';
    execute 'drop policy if exists documents_delete on storage.objects';
    execute $p$create policy documents_read on storage.objects for select to authenticated
      using (bucket_id = 'documents' and (select public.app_role()) is not null)$p$;
    execute $p$create policy documents_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'documents' and (select public.app_role()) is not null)$p$;
    execute $p$create policy documents_delete on storage.objects for delete to authenticated
      using (bucket_id = 'documents' and (select public.app_role()) is not null)$p$;
  end if;
end $$;

-- ---------- views ----------
create view v_tasks with (security_invoker = true) as
select t.id, t.title, t.details, t.due_date, t.status, t.done_at, t.assigned_to, p.full_name as assigned_name,
       t.sales_order_id, o.pi_number, (o.id is not null and o.pi_number is null) as order_is_draft,
       t.purchase_order_id, po.po_number,
       t.customer_id, c.name as customer_name,
       t.supplier_id, s.name as supplier_name,
       t.shipment_id, sh.container_number,
       t.created_by, cb.full_name as created_by_name, t.created_at,
       case when t.status = 'done' then 'done'
            when t.due_date is null then 'no_date'
            when t.due_date < app_today() then 'overdue'
            when t.due_date = app_today() then 'today'
            else 'upcoming' end as state,
       case when t.status = 'open' and t.due_date < app_today() then app_today() - t.due_date end as days_late
  from tasks t
  left join profiles p        on p.user_id = t.assigned_to
  left join profiles cb       on cb.user_id = t.created_by
  left join sales_orders o    on o.id = t.sales_order_id
  left join purchase_orders po on po.id = t.purchase_order_id
  left join customers c       on c.id = t.customer_id
  left join suppliers s       on s.id = t.supplier_id
  left join shipments sh      on sh.id = t.shipment_id;

-- one row per event; "at" orders the list, events that only have a date sit at the start of that day
create view v_order_timeline with (security_invoker = true) as
with ev as (
  -- the order itself: created, status changes, other changes (from the audit log)
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
)
select ev.sales_order_id, ev.at, ev.kind, ev.title, ev.detail, ev.amount, ev.actor, pr.full_name as actor_name, ev.ref_id
  from ev left join profiles pr on pr.user_id = ev.actor;

grant select on v_tasks, v_order_timeline to authenticated;

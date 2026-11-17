-- =====================================================================
-- 0018: favourites and notifications (ideas from Salesforce)
--  * favorites: records a user pins (order, PO, customer, supplier, product); private to that user
--  * notifications: messages for one user, written by the database itself:
--      - a task is assigned to you by someone else
--      - someone mentions you in a note with @Full Name
--    Time-based alerts (overdue payments, tasks due today) are not stored: the app shows them live.
--  * v_notifications: with readable names for the linked records
-- Roll back: drop the view, the two tables and the two triggers.
-- =====================================================================
create table favorites (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid default app_user_id(),
  entity_type text not null check (entity_type in ('order','po','customer','supplier','product')),
  entity_id   uuid not null,
  label       text not null,
  path        text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, entity_type, entity_id)
);

create table notifications (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  kind              text not null check (kind in ('task_assigned','mention')),
  title             text not null,
  body              text,
  task_id           uuid references tasks on delete cascade,
  sales_order_id    uuid references sales_orders on delete cascade,
  purchase_order_id uuid references purchase_orders on delete cascade,
  customer_id       uuid references customers on delete cascade,
  supplier_id       uuid references suppliers on delete cascade,
  actor             uuid,
  read_at           timestamptz,
  created_at        timestamptz not null default now()
);
create index on notifications (user_id, read_at);

-- a task assigned to someone else tells that person
create or replace function trg_notify_task() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not null and new.status = 'open'
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and new.assigned_to is distinct from app_user_id() then
    insert into notifications (user_id, kind, title, body, task_id, sales_order_id, purchase_order_id, customer_id, supplier_id, actor)
    values (new.assigned_to, 'task_assigned', 'Task for you: ' || new.title,
            case when new.due_date is not null then 'Due ' || to_char(new.due_date, 'DD-MM-YYYY') end,
            new.id, new.sales_order_id, new.purchase_order_id, new.customer_id, new.supplier_id, app_user_id());
  end if;
  return new;
end $$;
create trigger notify after insert or update of assigned_to on tasks for each row execute function trg_notify_task();

-- "@Full Name" in a note tells that person (not the writer)
create or replace function trg_notify_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, kind, title, body, sales_order_id, purchase_order_id, customer_id, supplier_id, actor)
  select p.user_id, 'mention', coalesce(a.full_name, 'Someone') || ' mentioned you', left(new.body, 300),
         new.sales_order_id, new.purchase_order_id, new.customer_id, new.supplier_id, new.created_by
    from profiles p
    left join profiles a on a.user_id = new.created_by
   where length(trim(coalesce(p.full_name, ''))) > 0
     and position(lower('@' || trim(p.full_name)) in lower(new.body)) > 0
     and p.user_id is distinct from new.created_by;
  return new;
end $$;
create trigger notify after insert on record_notes for each row execute function trg_notify_mentions();

create view v_notifications with (security_invoker = true) as
select n.id, n.user_id, n.kind, n.title, n.body, n.read_at, n.created_at, n.actor, a.full_name as actor_name,
       n.task_id, n.sales_order_id, o.pi_number, n.purchase_order_id, po.po_number,
       n.customer_id, c.name as customer_name, n.supplier_id, s.name as supplier_name
  from notifications n
  left join profiles a         on a.user_id = n.actor
  left join sales_orders o     on o.id = n.sales_order_id
  left join purchase_orders po on po.id = n.purchase_order_id
  left join customers c        on c.id = n.customer_id
  left join suppliers s        on s.id = n.supplier_id;

-- ---------- access: both are private to their user ----------
alter table favorites enable row level security;
alter table notifications enable row level security;
grant select, insert, update, delete on favorites to authenticated;
grant select, update, delete on notifications to authenticated;
create policy own_select on favorites for select to authenticated using (user_id = (select app_user_id()));
create policy own_insert on favorites for insert to authenticated with check (user_id = (select app_user_id()) and (select app_role()) is not null);
create policy own_delete on favorites for delete to authenticated using (user_id = (select app_user_id()));
create policy own_select on notifications for select to authenticated using (user_id = (select app_user_id()));
create policy own_update on notifications for update to authenticated using (user_id = (select app_user_id())) with check (user_id = (select app_user_id()));
create policy own_delete on notifications for delete to authenticated using (user_id = (select app_user_id()));
grant select on v_notifications to authenticated;

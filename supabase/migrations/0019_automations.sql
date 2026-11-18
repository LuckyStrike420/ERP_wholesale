-- =====================================================================
-- 0019: automation rules ("when this, then that"; Salesforce calls it Flow)
--  * automation_rules: WHEN  an order reaches a status / a date (ETA, ETD, due date) is within N days / the margin is below X%
--                      ONLY IF (optional) EXW or FOB, and/or the deposit / balance / anything is still open
--                      THEN  make a task (title, due date, for whom)  or  flag the order with a text
--  * automation_runs: a rule makes its task once per order (also when the task is later deleted)
--  * automation_match(): the WHEN + ONLY IF test, used by both the runner and the flags
--  * run_automations(): makes the tasks that are due. It runs after orders and shipments change, every hour
--    (pg_cron, when available) and when the app opens. A failing rule never blocks saving an order.
--  * v_order_flags: the flags, worked out live (they disappear when the condition is no longer true)
-- "Reaches a status" counts only status changes after the rule was made, so a new rule does not fire on old orders.
-- Starting rules (17-18 nov 2026, from the user's examples; all can be changed or switched off):
--   PI sent → task "Chase deposit" on the deposit due date (only while the deposit is open)
--   ETA within 14 days → task "Chase balance" on the balance due date (only while the balance is open)
--   margin below 10% → flag on the order (10% is a starting value to adjust)
-- Roll back: drop the triggers, the cron job, the functions, the view and the two tables.
-- =====================================================================
create table automation_rules (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) > 0),
  active         boolean not null default true,
  trigger_type   text not null check (trigger_type in ('status_reached','date_within','margin_below')),
  status         text references order_statuses (code),
  date_field     text check (date_field in ('eta','etd','deposit_due_date','balance_due_date')),
  within_days    int check (within_days >= 0),
  margin_pct     numeric(7,4),
  order_type     text references order_types (code),
  only_if        text check (only_if in ('deposit_open','balance_open','anything_open')),
  action         text not null check (action in ('task','flag')),
  task_title     text,
  task_due       text check (task_due in ('deposit_due_date','balance_due_date','eta','etd','today')),
  task_due_days  int not null default 0,
  assign_to      uuid references profiles (user_id) on delete set null,
  flag_text      text,
  created_by     uuid default app_user_id(),
  created_at     timestamptz not null default now(),
  check (trigger_type <> 'status_reached' or status is not null),
  check (trigger_type <> 'date_within' or (date_field is not null and within_days is not null)),
  check (trigger_type <> 'margin_below' or margin_pct is not null),
  check (action <> 'task' or length(trim(coalesce(task_title, ''))) > 0),
  check (action <> 'flag' or length(trim(coalesce(flag_text, ''))) > 0)
);

create table automation_runs (
  id             uuid primary key default gen_random_uuid(),
  rule_id        uuid not null references automation_rules on delete cascade,
  sales_order_id uuid not null references sales_orders on delete cascade,
  task_id        uuid references tasks on delete set null,
  created_at     timestamptz not null default now(),
  unique (rule_id, sales_order_id)
);

-- does this rule apply to this order now?
create or replace function automation_match(r automation_rules, o v_orders) returns boolean
language sql stable set search_path = public as $$
  select o.status not in ('draft','cancelled')
     and (r.order_type is null or o.order_type = r.order_type)
     and case r.only_if
           when 'deposit_open'  then o.deposit_outstanding > setting_num('payment_tolerance')
           when 'balance_open'  then o.outstanding - o.deposit_outstanding > setting_num('payment_tolerance')
           when 'anything_open' then o.outstanding > setting_num('payment_tolerance')
           else true end
     and case r.trigger_type
           when 'status_reached' then o.status_rank >= (select rank from order_statuses where code = r.status) and exists (
             select 1 from audit_log a
              where a.table_name = 'sales_orders' and a.row_id = o.id and a.changed_at >= r.created_at
                and a.new_data ->> 'status' = r.status
                and (a.action = 'INSERT' or a.old_data ->> 'status' is distinct from r.status))
           when 'date_within' then (case r.date_field when 'eta' then o.eta when 'etd' then o.etd
                                      when 'deposit_due_date' then o.deposit_due_date when 'balance_due_date' then o.balance_due_date end)
                                   between app_today() and app_today() + r.within_days
           when 'margin_below' then o.cost_missing_lines = 0 and o.margin_pct is not null and o.margin_pct < r.margin_pct
           else false end
$$;

create or replace function run_automations() returns int
language plpgsql security definer set search_path = public as $$
declare r automation_rules; o v_orders; n int := 0; due date; tid uuid; ttl text;
begin
  for r in select * from automation_rules where active and action = 'task' order by created_at loop
    for o in select v.* from v_orders v
              where not exists (select 1 from automation_runs x where x.rule_id = r.id and x.sales_order_id = v.id)
                and automation_match(r, v) loop
      due := case r.task_due when 'deposit_due_date' then o.deposit_due_date when 'balance_due_date' then o.balance_due_date
                             when 'eta' then o.eta when 'etd' then o.etd when 'today' then app_today() end + r.task_due_days;
      ttl := replace(replace(replace(r.task_title, '{pi}', coalesce(o.pi_number, 'draft')), '{customer}', o.customer_name), '{type}', o.order_type);
      insert into tasks (title, due_date, sales_order_id, assigned_to, details)
      values (ttl, due, o.id, r.assign_to, 'Made by the rule "' || r.name || '"') returning id into tid;
      insert into automation_runs (rule_id, sales_order_id, task_id) values (r.id, o.id, tid);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

create view v_order_flags with (security_invoker = true) as
select o.id as sales_order_id, o.pi_number, r.id as rule_id, r.name as rule_name,
       replace(replace(replace(r.flag_text, '{pi}', coalesce(o.pi_number, 'draft')), '{customer}', o.customer_name), '{margin}', coalesce(round(o.margin_pct * 100, 1)::text || '%', '?')) as flag_text
  from automation_rules r cross join v_orders o
 where r.active and r.action = 'flag' and automation_match(r, o);

create view v_automation_rules with (security_invoker = true) as
select r.*, p.full_name as assign_name,
       (select count(*) from automation_runs x where x.rule_id = r.id) as runs,
       (select max(created_at) from automation_runs x where x.rule_id = r.id) as last_run
  from automation_rules r left join profiles p on p.user_id = r.assign_to;

-- right after a change, so "PI sent → task" appears at once; never blocks the change itself
create or replace function trg_run_automations() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.no_automations', true), '') <> 'on' then
    begin perform run_automations(); exception when others then null; end;
  end if;
  return null;
end $$;
create trigger automations after insert or update on sales_orders for each statement execute function trg_run_automations();
create trigger automations after insert or update on sales_order_lines for each statement execute function trg_run_automations();
create trigger automations after insert or update on shipments for each statement execute function trg_run_automations();
create trigger automations after insert on shipment_orders for each statement execute function trg_run_automations();
create trigger automations after insert or update on automation_rules for each statement execute function trg_run_automations();

-- starting rules
insert into automation_rules (name, trigger_type, status, only_if, action, task_title, task_due) values
  ('PI sent: chase the deposit', 'status_reached', 'pi_sent', 'deposit_open', 'task', 'Chase deposit PI {pi} ({customer})', 'deposit_due_date');
insert into automation_rules (name, trigger_type, date_field, within_days, only_if, action, task_title, task_due) values
  ('ETA in 14 days: chase the balance', 'date_within', 'eta', 14, 'balance_open', 'task', 'Chase balance PI {pi} ({customer})', 'balance_due_date');
insert into automation_rules (name, trigger_type, margin_pct, action, flag_text) values
  ('Margin below 10%', 'margin_below', 0.10, 'flag', 'Low margin: {margin}');

-- ---------- access and history ----------
alter table automation_rules enable row level security;
alter table automation_runs enable row level security;
grant select, insert, update, delete on automation_rules to authenticated;
grant select on automation_runs to authenticated;
create policy read_all on automation_rules for select to authenticated using ((select app_role()) is not null);
create policy write_admin_insert on automation_rules for insert to authenticated with check ((select app_role()) = 'admin');
create policy write_admin_update on automation_rules for update to authenticated using ((select app_role()) = 'admin') with check ((select app_role()) = 'admin');
create policy write_admin_delete on automation_rules for delete to authenticated using ((select app_role()) = 'admin');
create policy read_all on automation_runs for select to authenticated using ((select app_role()) is not null);
create trigger audit after insert or update or delete on automation_rules for each row execute function trg_audit();
grant select on v_order_flags, v_automation_rules to authenticated;
grant execute on function run_automations(), automation_match(automation_rules, v_orders) to authenticated;

-- every hour, also when nobody has the app open (Supabase only)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('run-automations', '7 * * * *', 'select public.run_automations()');
    exception when others then raise notice 'pg_cron not scheduled: %', sqlerrm;
    end;
  end if;
end $$;

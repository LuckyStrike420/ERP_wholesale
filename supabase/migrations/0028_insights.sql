-- =====================================================================
-- 0028: insight.
-- - v_reorder_patterns: per customer and product, how often it is ordered (average days between order dates),
--   the usual quantity, and when the next order is expected.
-- - Automation rule type "reorder_due": a task (linked to the customer) once the expected order is late by the
--   grace days, if the product was ordered at least "min orders" times and no draft for it is open.
--   One task per expected date: after a new order the next cycle starts. Starting rule: 3 orders, 7 days grace.
-- - v_customer_health: per customer, three signals in green / amber / red and an overall score:
--   paying (average days late against the balance due date, over the last 2 years, open late orders included),
--   trend (revenue last 12 months against the 12 months before, in the reporting currency),
--   activity (days since the last order against the usual time between orders).
--   The limits are settings (Admin → Settings, health_*).
-- - targets: revenue and margin target per month in the reporting currency; v_target_progress sets them
--   against what was booked (PO date, PIs sent, every currency converted at the exchange rate).
-- Roll back: drop views v_target_progress, v_customer_health, v_reorder_patterns; drop table targets;
--            remove the reorder columns/rule; re-create run_automations and v_automation_rules from 0019.
-- =====================================================================

-- ---------- settings ----------
insert into app_settings (key, value, description) values
  ('health_late_green_days',  '7',   'Customer health: paying on average at most this many days late is green'),
  ('health_late_amber_days',  '30',  'Customer health: paying on average at most this many days late is amber (more is red)'),
  ('health_trend_green_pct',  '90',  'Customer health: revenue last 12 months at least this % of the 12 months before is green'),
  ('health_trend_amber_pct',  '50',  'Customer health: revenue last 12 months at least this % of the 12 months before is amber (less is red)'),
  ('health_quiet_amber_factor','1.5','Customer health: no order for more than this many times the usual time between orders is amber'),
  ('health_quiet_red_factor', '3',   'Customer health: no order for more than this many times the usual time between orders is red')
on conflict (key) do nothing;

create or replace function validate_setting(p_key text, p_value text) returns void
language plpgsql stable set search_path = public as $$
declare n numeric;
begin
  if p_key in ('cost_decimals', 'payment_tolerance', 'exw_reminder_working_days', 'fob_balance_days_before_eta')
     or p_key like 'health\_%' then
    if p_value is null or p_value !~ '^\s*\d+(\.\d+)?\s*$' then
      raise exception 'Setting %: "%" is not a valid number', p_key, p_value;
    end if;
    n := p_value::numeric;
    if p_key = 'cost_decimals' and (n <> trunc(n) or n > 6) then
      raise exception 'Setting cost_decimals must be a whole number from 0 to 6';
    elsif p_key = 'payment_tolerance' and n > 1 then
      raise exception 'Setting payment_tolerance must be between 0 and 1';
    elsif p_key = 'exw_reminder_working_days' and (n <> trunc(n) or n > 60) then
      raise exception 'Setting exw_reminder_working_days must be a whole number from 0 to 60';
    elsif p_key = 'fob_balance_days_before_eta' and (n <> trunc(n) or n > 365) then
      raise exception 'Setting fob_balance_days_before_eta must be a whole number from 0 to 365';
    elsif p_key in ('health_late_green_days', 'health_late_amber_days') and (n <> trunc(n) or n > 365) then
      raise exception 'Setting % must be a whole number of days from 0 to 365', p_key;
    elsif p_key in ('health_trend_green_pct', 'health_trend_amber_pct') and n > 1000 then
      raise exception 'Setting % must be a percentage from 0 to 1000', p_key;
    elsif p_key in ('health_quiet_amber_factor', 'health_quiet_red_factor') and (n < 1 or n > 20) then
      raise exception 'Setting % must be a factor from 1 to 20', p_key;
    end if;
  elsif p_key = 'reporting_currency' then
    if not exists (select 1 from order_types where currency = p_value) then
      raise exception 'Setting reporting_currency must be one of the order currencies (%)', (select string_agg(distinct currency, ', ') from order_types);
    end if;
  end if;
end $$;

-- ---------- reorder rhythm ----------
create view v_reorder_patterns with (security_invoker = true) as
with d as (
  select l.customer_id, l.product_id, l.revenue_date as order_date, sum(l.qty) as qty
    from v_order_lines l
   where l.status not in ('draft','cancelled') and l.revenue_date is not null and l.qty > 0
   group by 1, 2, 3
), s as (
  select customer_id, product_id, count(*)::int as orders, min(order_date) as first_order, max(order_date) as last_order,
         round(avg(qty)) as usual_qty,
         case when count(*) >= 2 then round((max(order_date) - min(order_date))::numeric / (count(*) - 1))::int end as usual_days
    from d group by 1, 2
)
select s.customer_id, c.name as customer_name, s.product_id, p.name as product_name, p.sku,
       s.orders, s.first_order, s.last_order, s.usual_qty, s.usual_days,
       s.last_order + s.usual_days as expected_next,
       app_today() - (s.last_order + s.usual_days) as days_overdue,
       exists (select 1 from sales_orders o join sales_order_lines l on l.sales_order_id = o.id
                where o.customer_id = s.customer_id and l.product_id = s.product_id and o.status = 'draft') as draft_open
  from s join customers c on c.id = s.customer_id join products p on p.id = s.product_id;

alter table automation_rules drop constraint automation_rules_trigger_type_check;
alter table automation_rules add constraint automation_rules_trigger_type_check
  check (trigger_type in ('status_reached','date_within','margin_below','reorder_due'));
alter table automation_rules add column min_orders int check (min_orders >= 2), add column grace_days int check (grace_days >= 0);
alter table automation_rules add constraint automation_rules_reorder_check
  check (trigger_type <> 'reorder_due' or (min_orders is not null and grace_days is not null and action = 'task'));

alter table automation_runs alter column sales_order_id drop not null;
alter table automation_runs add column customer_id uuid references customers on delete cascade,
                            add column product_id uuid references products on delete cascade,
                            add column cycle date;
create unique index automation_runs_reorder on automation_runs (rule_id, customer_id, product_id, cycle) where sales_order_id is null;

create or replace function run_automations() returns int
language plpgsql security definer set search_path = public as $$
declare r automation_rules; o v_orders; p v_reorder_patterns; n int := 0; due date; tid uuid; ttl text;
begin
  for r in select * from automation_rules where active and action = 'task' and trigger_type <> 'reorder_due' order by created_at loop
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
  -- reorders: customer + product, once per expected date
  for r in select * from automation_rules where active and trigger_type = 'reorder_due' order by created_at loop
    for p in select v.* from v_reorder_patterns v
              where v.orders >= r.min_orders and v.usual_days > 0 and not v.draft_open
                and v.expected_next + r.grace_days < app_today()
                and not exists (select 1 from automation_runs x where x.rule_id = r.id and x.sales_order_id is null
                                   and x.customer_id = v.customer_id and x.product_id = v.product_id and x.cycle = v.expected_next) loop
      ttl := replace(replace(replace(replace(r.task_title, '{customer}', p.customer_name), '{product}', p.product_name),
                     '{expected}', to_char(p.expected_next, 'DD Mon YYYY')), '{days}', p.days_overdue::text);
      insert into tasks (title, due_date, customer_id, assigned_to, details)
      values (ttl, app_today() + r.task_due_days, p.customer_id, r.assign_to,
              'Usually orders ' || p.product_name || ' every ' || p.usual_days || ' days (about ' || p.usual_qty || ' pcs, ' || p.orders || ' orders). '
              || 'Last order ' || to_char(p.last_order, 'DD Mon YYYY') || ', expected ' || to_char(p.expected_next, 'DD Mon YYYY') || '. Made by the rule "' || r.name || '"')
      returning id into tid;
      insert into automation_runs (rule_id, customer_id, product_id, cycle, task_id) values (r.id, p.customer_id, p.product_id, p.expected_next, tid);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

drop view v_automation_rules;
create view v_automation_rules with (security_invoker = true) as
select r.*, p.full_name as assign_name,
       (select count(*) from automation_runs x where x.rule_id = r.id) as runs,
       (select max(created_at) from automation_runs x where x.rule_id = r.id) as last_run
  from automation_rules r left join profiles p on p.user_id = r.assign_to;
grant select on v_automation_rules, v_reorder_patterns to authenticated;

insert into automation_rules (name, trigger_type, min_orders, grace_days, action, task_title, task_due)
values ('Reorder overdue', 'reorder_due', 3, 7, 'task', 'Reorder due: {customer} · {product}', 'today');

-- ---------- customer health ----------
create view v_customer_health with (security_invoker = true) as
with rev as (
  select l.customer_id,
         sum(l.revenue * fx_rate(l.currency, l.revenue_date)) filter (where l.revenue_date > app_today() - 365) as revenue_12m,
         sum(l.revenue * fx_rate(l.currency, l.revenue_date)) filter (where l.revenue_date <= app_today() - 365 and l.revenue_date > app_today() - 730) as revenue_prev_12m,
         sum(l.margin * fx_rate(l.currency, l.revenue_date)) filter (where l.revenue_date > app_today() - 365 and l.cost_known) as margin_12m,
         sum(l.revenue * fx_rate(l.currency, l.revenue_date)) filter (where l.revenue_date > app_today() - 365 and l.cost_known) as revenue_12m_costed
    from v_order_lines l
   where l.status not in ('draft','cancelled') and l.revenue_date is not null
   group by 1
), dates as (
  select customer_id, count(*)::int as orders, max(d) as last_order,
         case when count(*) >= 2 then round((max(d) - min(d))::numeric / (count(*) - 1))::int end as usual_days
    from (select distinct customer_id, coalesce(po_date, pi_date) as d from sales_orders
           where status not in ('draft','cancelled') and coalesce(po_date, pi_date) is not null) x
   group by 1
), pays as (
  select a.sales_order_id, p.payment_date,
         sum(a.amount) over (partition by a.sales_order_id order by p.payment_date, p.id) as cum
    from payment_allocations a join payments p on p.id = a.payment_id
   where p.voided_at is null and a.sales_order_id is not null
), late as (
  select o.customer_id,
         case when pd.paid_date is not null then greatest(pd.paid_date - o.balance_due_date, 0)
              when o.outstanding > setting_num('payment_tolerance') and o.balance_due_date < app_today() then app_today() - o.balance_due_date end as days_late,
         o.overdue_amount * fx_rate(o.currency, app_today()) as overdue_reporting
    from v_orders o
    left join lateral (select min(x.payment_date) as paid_date from pays x
                        where x.sales_order_id = o.id and x.cum >= o.total_receivable - o.written_off - setting_num('payment_tolerance')) pd on true
   where o.status not in ('draft','cancelled') and o.balance_due_date is not null and o.balance_due_date > app_today() - 730
), pay as (
  select customer_id, round(avg(days_late))::int as avg_days_late, count(days_late)::int as judged_orders,
         count(*) filter (where days_late > 0)::int as late_orders, sum(overdue_reporting) as overdue_reporting
    from late group by 1
), base as (
  select c.id as customer_id, c.name as customer_name, c.country,
         round(rev.revenue_12m, 2) as revenue_12m, round(rev.revenue_prev_12m, 2) as revenue_prev_12m,
         case when coalesce(rev.revenue_prev_12m, 0) > 0 then round(coalesce(rev.revenue_12m, 0) / rev.revenue_prev_12m, 4) end as trend_ratio,
         case when coalesce(rev.revenue_12m_costed, 0) > 0 then round(rev.margin_12m / rev.revenue_12m_costed, 4) end as margin_pct_12m,
         d.orders, d.last_order, d.usual_days, app_today() - d.last_order as days_since_last_order,
         pay.avg_days_late, pay.judged_orders, pay.late_orders, round(coalesce(pay.overdue_reporting, 0), 2) as overdue_reporting
    from customers c
    left join rev on rev.customer_id = c.id
    left join dates d on d.customer_id = c.id
    left join pay on pay.customer_id = c.id
), scored as (
  select b.*,
    case when b.avg_days_late is null then null
         when b.avg_days_late <= setting_num('health_late_green_days') then 'green'
         when b.avg_days_late <= setting_num('health_late_amber_days') then 'amber' else 'red' end as pay_score,
    case when b.trend_ratio is null then null
         when b.trend_ratio * 100 >= setting_num('health_trend_green_pct') then 'green'
         when b.trend_ratio * 100 >= setting_num('health_trend_amber_pct') then 'amber' else 'red' end as trend_score,
    case when b.usual_days is null or b.usual_days = 0 or b.last_order is null then null
         when b.days_since_last_order <= b.usual_days * setting_num('health_quiet_amber_factor') then 'green'
         when b.days_since_last_order <= b.usual_days * setting_num('health_quiet_red_factor') then 'amber' else 'red' end as activity_score
  from base b
)
select s.*,
  case when 'red' in (pay_score, trend_score, activity_score) then 'red'
       when 'amber' in (pay_score, trend_score, activity_score) then 'amber'
       when coalesce(pay_score, trend_score, activity_score) is null then null
       else 'green' end as score
from scored s;
grant select on v_customer_health to authenticated;

-- ---------- targets ----------
create table targets (
  year       int not null check (year between 2000 and 2100),
  month      int not null check (month between 1 and 12),
  revenue    numeric(14,2) check (revenue >= 0),
  margin     numeric(14,2),
  updated_at timestamptz not null default now(),
  primary key (year, month)
);
create trigger touch before update on targets for each row execute function trg_touch_updated_at();
create trigger audit after insert or update or delete on targets for each row execute function trg_audit();
alter table targets enable row level security;
grant select, insert, update, delete on targets to authenticated;
create policy read_all on targets for select to authenticated using ((select app_role()) is not null);
create policy write_insert on targets for insert to authenticated with check ((select app_role()) in ('admin','finance'));
create policy write_update on targets for update to authenticated using ((select app_role()) in ('admin','finance')) with check ((select app_role()) in ('admin','finance'));
create policy write_delete on targets for delete to authenticated using ((select app_role()) in ('admin','finance'));

create view v_target_progress with (security_invoker = true) as
with m as (
  select year, month, sum(revenue_reporting) as revenue, sum(margin_reporting) as margin, bool_or(fx_rate_missing) as fx_rate_missing
    from v_revenue_monthly group by 1, 2
), k as (select year, month from targets union select year, month from m)
select k.year, k.month, t.revenue as revenue_target, t.margin as margin_target,
       round(coalesce(m.revenue, 0), 2) as revenue_actual, round(coalesce(m.margin, 0), 2) as margin_actual,
       case when t.revenue > 0 then round(coalesce(m.revenue, 0) / t.revenue, 4) end as revenue_achieved,
       case when t.margin > 0 then round(coalesce(m.margin, 0) / t.margin, 4) end as margin_achieved,
       coalesce(m.fx_rate_missing, false) as fx_rate_missing,
       (select value from app_settings where key = 'reporting_currency') as currency
  from k left join targets t using (year, month) left join m using (year, month);
grant select on v_target_progress to authenticated;

-- =====================================================================
-- 0029: customer health, corrected.
-- - Paying also counts open orders that are late on the deposit (v_orders.days_late), not only on the balance.
-- - A customer who buys in one currency is measured in that currency (no exchange rate needed); a customer in
--   EUR and USD is measured in the reporting currency (needs exchange rates; fx_rate_missing says when one lacks).
--   New columns: currency, fx_rate_missing.
-- Roll back: re-create v_customer_health from 0028.
-- =====================================================================
drop view v_customer_health;
create view v_customer_health with (security_invoker = true) as
with cur as (
  select customer_id, case when count(distinct currency) = 1 then min(currency) else (select value from app_settings where key = 'reporting_currency') end as currency,
         count(distinct currency) = 1 as single
    from v_order_lines where status not in ('draft','cancelled') group by 1
), lx as (
  select l.*, case when c.single then 1::numeric else fx_rate(l.currency, l.revenue_date) end as k
    from v_order_lines l join cur c on c.customer_id = l.customer_id
   where l.status not in ('draft','cancelled') and l.revenue_date is not null
), rev as (
  select l.customer_id,
         sum(l.revenue * l.k) filter (where l.revenue_date > app_today() - 365) as revenue_12m,
         sum(l.revenue * l.k) filter (where l.revenue_date <= app_today() - 365 and l.revenue_date > app_today() - 730) as revenue_prev_12m,
         sum(l.margin * l.k) filter (where l.revenue_date > app_today() - 365 and l.cost_known) as margin_12m,
         sum(l.revenue * l.k) filter (where l.revenue_date > app_today() - 365 and l.cost_known) as revenue_12m_costed,
         bool_or(l.k is null) as fx_rate_missing
    from lx l
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
         case when pd.paid_date is not null and o.balance_due_date is not null then greatest(pd.paid_date - o.balance_due_date, 0)
              when pd.paid_date is null then o.days_late end as days_late,
         o.overdue_amount * case when c.single then 1::numeric else fx_rate(o.currency, app_today()) end as overdue_reporting
    from v_orders o
    left join cur c on c.customer_id = o.customer_id
    left join lateral (select min(x.payment_date) as paid_date from pays x
                        where x.sales_order_id = o.id and x.cum >= o.total_receivable - o.written_off - setting_num('payment_tolerance')) pd on true
   where o.status not in ('draft','cancelled')
     and ((pd.paid_date is not null and o.balance_due_date > app_today() - 730) or (pd.paid_date is null and o.days_late is not null))
), pay as (
  select customer_id, round(avg(days_late))::int as avg_days_late, count(days_late)::int as judged_orders,
         count(*) filter (where days_late > 0)::int as late_orders, sum(overdue_reporting) as overdue_reporting
    from late group by 1
), base as (
  select c.id as customer_id, c.name as customer_name, c.country, coalesce(cur.currency, (select value from app_settings where key = 'reporting_currency')) as currency,
         coalesce(rev.fx_rate_missing, false) as fx_rate_missing,
         round(rev.revenue_12m, 2) as revenue_12m, round(rev.revenue_prev_12m, 2) as revenue_prev_12m,
         case when coalesce(rev.revenue_prev_12m, 0) > 0 then round(coalesce(rev.revenue_12m, 0) / rev.revenue_prev_12m, 4) end as trend_ratio,
         case when coalesce(rev.revenue_12m_costed, 0) > 0 then round(rev.margin_12m / rev.revenue_12m_costed, 4) end as margin_pct_12m,
         d.orders, d.last_order, d.usual_days, app_today() - d.last_order as days_since_last_order,
         pay.avg_days_late, pay.judged_orders, pay.late_orders, round(coalesce(pay.overdue_reporting, 0), 2) as overdue_reporting
    from customers c
    left join rev on rev.customer_id = c.id
    left join dates d on d.customer_id = c.id
    left join pay on pay.customer_id = c.id
    left join cur on cur.customer_id = c.id
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

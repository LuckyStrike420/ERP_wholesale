-- =====================================================================
-- 0009: open items for the payment overview
-- One row per open receivable (order) and payable (PO), with its next due date and how urgent it is.
-- Nothing is invented: without a due date an item is "no_due_date", never "late".
-- Roll back: drop view v_open_items_summary, v_open_items.
-- =====================================================================
create view v_open_items with (security_invoker = true) as
with t as (select setting_num('payment_tolerance') as tol),
items as (
  select 'in'::text as direction, o.id, o.pi_number as reference, o.customer_id as party_id, o.customer_name as party,
         o.order_type, o.currency, o.status, o.payment_status,
         o.total_receivable as total, o.paid, o.outstanding, o.deposit_outstanding,
         o.deposit_due_date, o.balance_due_date,
         coalesce(o.pi_date, o.po_date) as open_since,
         o.overdue_amount, o.days_late, o.reminder_due, o.reminder_date, o.invoice_number
    from v_orders o, t
   where o.status not in ('draft', 'cancelled') and o.outstanding > t.tol
  union all
  select 'out', p.id, p.po_number, p.supplier_id, p.supplier_name,
         p.order_type, p.currency, null, case when p.paid > 0 then 'partially_paid' else 'unpaid' end,
         p.payable, p.paid, p.outstanding, p.deposit_outstanding,
         p.deposit_due_date, p.balance_due_date,
         p.po_date,                                   -- unknown PO date stays unknown
         p.overdue_amount, p.days_late, false, null::date, p.invoice_number
    from v_purchase_orders p, t
   where p.outstanding > t.tol
),
due as (
  select i.*,
         least(case when i.deposit_outstanding > (select tol from t) then i.deposit_due_date end, i.balance_due_date) as next_due_date
    from items i
)
select d.direction, d.id, d.reference, d.party_id, d.party, d.order_type, d.currency, d.status, d.payment_status,
       d.total, d.paid, d.outstanding, d.deposit_outstanding,
       d.next_due_date,
       case when d.next_due_date is null then null
            when d.next_due_date = d.deposit_due_date and d.deposit_outstanding > (select tol from t) then 'deposit' else 'balance' end as next_due_part,
       d.open_since, app_today() - d.open_since as days_open,
       d.overdue_amount, d.days_late, d.reminder_due, d.reminder_date, d.invoice_number,
       case when d.overdue_amount > 0 then 'overdue'
            when d.reminder_due then 'reminder'
            when d.next_due_date is null then 'no_due_date'
            when d.next_due_date <= app_today() + 7 then 'due_soon'
            else 'scheduled' end as bucket
  from due d;

create view v_open_items_summary with (security_invoker = true) as
select direction, currency, bucket, count(*) as items, sum(outstanding) as outstanding, sum(overdue_amount) as overdue_amount
  from v_open_items group by 1, 2, 3;

create view v_open_items_totals with (security_invoker = true) as
select direction, currency, count(*) as items, sum(outstanding) as outstanding,
       sum(overdue_amount) as overdue_amount, count(*) filter (where bucket = 'overdue') as overdue_items,
       sum(outstanding) filter (where bucket = 'no_due_date') as undated_amount, count(*) filter (where bucket = 'no_due_date') as undated_items
  from v_open_items group by 1, 2;

grant select on v_open_items, v_open_items_summary, v_open_items_totals to authenticated;

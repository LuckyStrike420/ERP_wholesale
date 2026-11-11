-- =====================================================================
-- 0007: unknown is not zero (audit package 1: OMS-001, 003, 004, 006, 012)
-- Changes only what is SHOWN. No data is changed; existing amounts stay identical.
-- Views are replaced with the same columns plus new ones at the end.
-- Roll back: re-apply the view definitions of 0002 (v_order_lines, v_orders, v_revenue_monthly,
-- v_attention) and drop the new views below.
-- =====================================================================

-- OMS-001: margin % is unknown (null), not 100%, when a line has no cost price
create or replace view v_order_lines with (security_invoker = true) as
with base as (
  select
    l.id, l.sales_order_id, l.line_no, l.product_id, l.purchase_order_id, l.batch_item_id,
    o.pi_number, o.order_type, t.currency, o.customer_id, o.status,
    coalesce(l.line_date, o.po_date) as revenue_date, l.line_date,
    l.quantity, l.quantity_cancelled,
    case when o.status = 'cancelled' then 0 else l.quantity - l.quantity_cancelled end as qty,
    l.unit_price, l.cost_override, l.notes,
    (l.frozen_unit_cost is not null) as cost_is_final,
    coalesce(l.frozen_unit_cost, c.unit_cost)     as unit_cost,
    coalesce(l.frozen_cost_source, c.cost_source) as cost_source,
    c.cost_basis,
    coalesce(l.frozen_royalty, calc_royalty(l.product_id, o.order_type, coalesce(l.line_date, o.po_date))) as royalty_per_unit,
    coalesce((select sum(x.amount) from order_cost_lines x where x.sales_order_line_id = l.id), 0) as extra_costs,
    po.currency as po_currency,
    si.amount   as po_invoice_amount
  from sales_order_lines l
  join sales_orders o on o.id = l.sales_order_id
  join order_types  t on t.code = o.order_type
  left join purchase_orders   po on po.id = l.purchase_order_id
  left join supplier_invoices si on si.purchase_order_id = po.id
  cross join lateral calc_unit_cost(l.product_id, o.customer_id, o.order_type, l.unit_price,
                                    l.batch_item_id, l.cost_override, coalesce(l.line_date, o.po_date)) c
),
amounts as (
  select b.*,
    round(b.qty * b.unit_price, 2)               as revenue,
    round(b.qty * coalesce(b.unit_cost, 0), 2)   as purchase_value,
    round(b.qty * b.royalty_per_unit, 2)         as royalty_total,
    (b.purchase_order_id is not null and b.currency = b.po_currency) as counts_for_po
  from base b
),
variance as (
  -- the supplier invoice stands: its difference with the expected amount is spread over the PO's lines
  select a.*,
    case when a.counts_for_po and a.po_invoice_amount is not null then
      a.po_invoice_amount - sum(a.purchase_value) filter (where a.counts_for_po) over (partition by a.purchase_order_id)
    end as po_variance,
    sum(a.purchase_value) filter (where a.counts_for_po) over (partition by a.purchase_order_id) as po_expected,
    row_number() over (partition by a.purchase_order_id, a.counts_for_po order by a.purchase_value desc, a.id) as po_rank
  from amounts a
),
shared as (
  select v.*,
    case when v.po_variance is null or v.po_expected = 0 then 0
         else round(v.po_variance * v.purchase_value / v.po_expected, 2) end as share_raw
  from variance v
),
fixed as (
  select s.*,
    s.share_raw
      + case when s.po_variance is not null and s.po_expected <> 0 and s.po_rank = 1
             then s.po_variance - sum(s.share_raw) over (partition by s.purchase_order_id, s.counts_for_po)
             else 0 end as invoice_variance
  from shared s
)
select
  f.id, f.sales_order_id, f.line_no, f.product_id, f.purchase_order_id, f.batch_item_id,
  f.pi_number, f.order_type, f.currency, f.customer_id, f.status, f.revenue_date, f.line_date,
  f.quantity, f.quantity_cancelled, f.qty, f.unit_price, f.cost_override,
  f.unit_cost, f.cost_source, f.cost_is_final, f.cost_basis,
  (f.cost_basis is not null and f.unit_price < f.cost_basis) as below_basis,
  f.royalty_per_unit, f.extra_costs,
  f.revenue, f.purchase_value, f.royalty_total, f.invoice_variance,
  f.purchase_value + f.invoice_variance + f.royalty_total + f.extra_costs                 as total_cost,
  f.revenue - (f.purchase_value + f.invoice_variance + f.royalty_total + f.extra_costs)   as margin,
  case when f.revenue <> 0 and f.unit_cost is not null
       then round((f.revenue - (f.purchase_value + f.invoice_variance + f.royalty_total + f.extra_costs)) / f.revenue, 4)
  end as margin_pct,
  f.counts_for_po, f.notes,
  (f.unit_cost is not null) as cost_known
from fixed f;


create or replace view v_orders with (security_invoker = true) as
with l as (
  select sales_order_id, sum(revenue) as order_value, sum(total_cost) as total_cost, sum(margin) as margin, count(*) as line_count,
         count(*) filter (where not cost_known and status <> 'cancelled') as cost_missing_lines
    from v_order_lines group by 1
),
adj as (select sales_order_id, sum(amount) as amount from order_adjustments group by 1),
pay as (
  select a.sales_order_id, sum(a.amount) as amount, max(p.payment_date) as last_payment_date
    from payment_allocations a join payments p on p.id = a.payment_id
   where p.voided_at is null and a.sales_order_id is not null group by 1
),
wo as (select sales_order_id, sum(amount) as amount from write_offs where sales_order_id is not null group by 1),
ship as (
  select so.sales_order_id, max(s.eta) as eta, max(s.etd) as etd
    from shipment_orders so join shipments s on s.id = so.shipment_id
   where so.sales_order_id is not null group by 1
),
base as (
  select
    o.id, o.pi_number, o.order_type, t.currency, o.customer_id, c.name as customer_name,
    o.customer_po, o.po_date, o.pi_date, o.status, st.rank as status_rank, st.is_open,
    coalesce(o.deposit_pct, 0) as deposit_pct, coalesce(o.payment_days, 0) as payment_days,
    o.deposit_amount as deposit_amount_fixed, o.notes,
    coalesce(l.line_count, 0) as line_count,
    coalesce(l.cost_missing_lines, 0) as cost_missing_lines,
    case when o.status = 'cancelled' then 0 else coalesce(l.order_value, 0) end as order_value,
    case when o.status = 'cancelled' then 0 else coalesce(adj.amount, 0) end     as adjustments,
    coalesce(l.total_cost, 0) as total_cost,
    coalesce(l.margin, 0)     as margin,
    coalesce(pay.amount, 0)   as paid,
    pay.last_payment_date,
    coalesce(wo.amount, 0)    as written_off,
    i.invoice_number, i.invoice_date, ship.etd, ship.eta,
    o.deposit_due_date,
    o.balance_due_date as balance_due_date_manual,
    setting_num('payment_tolerance') as tol
  from sales_orders o
  join order_types t     on t.code = o.order_type
  join order_statuses st on st.code = o.status
  join customers c       on c.id = o.customer_id
  left join l    on l.sales_order_id = o.id
  left join adj  on adj.sales_order_id = o.id
  left join pay  on pay.sales_order_id = o.id
  left join wo   on wo.sales_order_id = o.id
  left join invoices i on i.sales_order_id = o.id
  left join ship on ship.sales_order_id = o.id
),
calc as (
  select b.*,
    b.order_value + b.adjustments as total_receivable,
    case when b.status = 'cancelled' then 0
         else least(coalesce(b.deposit_amount_fixed, round((b.order_value + b.adjustments) * b.deposit_pct, 2)),
                    greatest(b.order_value + b.adjustments, 0)) end as deposit_due,
    coalesce(b.balance_due_date_manual,
             case when b.order_type = 'FOB' and b.eta is not null
                  then b.eta - setting_num('fob_balance_days_before_eta')::int end,
             b.invoice_date + b.payment_days) as balance_due_date,
    case when b.order_type = 'EXW'
         then add_working_days(coalesce(b.pi_date, b.po_date), setting_num('exw_reminder_working_days')::int) end as reminder_date
  from base b
),
calc2 as (
  select c.*,
    c.total_receivable - c.paid - c.written_off as outstanding,
    least(c.paid, c.deposit_due)                as deposit_paid,
    c.deposit_due - least(c.paid, c.deposit_due) as deposit_outstanding
  from calc c
)
select
  id, pi_number, order_type, currency, customer_id, customer_name, customer_po, po_date, pi_date,
  status, status_rank, is_open, line_count,
  order_value, adjustments, total_receivable, total_cost, margin,
  case when order_value <> 0 and cost_missing_lines = 0 then round(margin / order_value, 4) end as margin_pct,
  deposit_pct, deposit_due, deposit_paid, deposit_outstanding,
  total_receivable - deposit_due as balance_due,
  paid, written_off, outstanding, last_payment_date,
  invoice_number, invoice_date, etd, eta,
  deposit_due_date, balance_due_date, reminder_date,
  case when status in ('draft','cancelled') or outstanding <= tol then 0
       when balance_due_date < app_today() then outstanding
       when deposit_due_date < app_today() then deposit_outstanding
       else 0 end as overdue_amount,
  case when status in ('draft','cancelled') or outstanding <= tol then null
       when balance_due_date < app_today() then app_today() - balance_due_date
       when deposit_due_date < app_today() and deposit_outstanding > tol then app_today() - deposit_due_date
  end as days_late,
  (order_type = 'EXW' and status not in ('draft','cancelled') and outstanding > tol and reminder_date < app_today()) as reminder_due,
  case when status = 'cancelled' then 'cancelled'
       when status = 'draft' then 'draft'
       when outstanding < -tol then 'overpaid'
       when outstanding <= tol then 'paid'
       when deposit_due > 0 and deposit_outstanding <= tol then 'deposit_paid'
       when paid > 0 then 'partially_paid'
       else 'unpaid' end as payment_status,
  (invoice_number is not null and outstanding <= tol) as paid_and_invoiced,
  notes,
  cost_missing_lines,
  (cost_missing_lines = 0) as cost_complete
from calc2;


create or replace view v_revenue_monthly with (security_invoker = true) as
select extract(year from l.revenue_date)::int as year, extract(month from l.revenue_date)::int as month,
       l.order_type, l.currency,
       sum(l.revenue) as revenue, sum(l.margin) as margin, sum(l.qty) as units,
       sum(l.revenue * fx_rate(l.currency, l.revenue_date)) as revenue_reporting,
       sum(l.margin  * fx_rate(l.currency, l.revenue_date)) as margin_reporting,
       bool_or(fx_rate(l.currency, l.revenue_date) is null) as fx_rate_missing,
       count(*) filter (where not l.cost_known) as cost_missing_lines,
       case when sum(l.revenue) <> 0 and count(*) filter (where not l.cost_known) = 0 then round(sum(l.margin) / sum(l.revenue), 4) end as margin_pct
  from v_order_lines l
 where l.status not in ('draft','cancelled') and l.revenue_date is not null
 group by 1, 2, 3, 4;


create or replace view v_product_sales with (security_invoker = true) as
select l.product_id, p.name as product_name, extract(year from l.revenue_date)::int as year, l.order_type, l.currency,
       sum(l.qty) as units, sum(l.revenue) as revenue, sum(l.margin) as margin,
       count(*) filter (where not l.cost_known) as cost_missing_lines
  from v_order_lines l join products p on p.id = l.product_id
 where l.status not in ('draft','cancelled')
 group by 1, 2, 3, 4, 5;

-- one row per year, type and currency, for the dashboard key figures (margin % is calculated here, not in the browser)
create view v_revenue_yearly with (security_invoker = true) as
select year, order_type, currency, sum(revenue) as revenue, sum(margin) as margin, sum(units) as units,
       sum(cost_missing_lines) as cost_missing_lines,
       case when sum(revenue) <> 0 and sum(cost_missing_lines) = 0 then round(sum(margin) / sum(revenue), 4) end as margin_pct
  from v_revenue_monthly group by 1, 2, 3;

-- OMS-003: how much of the expected cash flow has a due date
create view v_cash_flow_summary with (security_invoker = true) as
select direction, currency,
       sum(amount) as total_amount,
       coalesce(sum(amount) filter (where due_date is not null), 0) as dated_amount,
       coalesce(sum(amount) filter (where due_date is null), 0)     as undated_amount,
       count(*) as items,
       count(*) filter (where due_date is null) as undated_items
  from v_cash_flow group by 1, 2;

-- OMS-004: what "nothing overdue" is based on
create view v_overdue_coverage with (security_invoker = true) as
select
  (select count(*) from v_orders where overdue_amount > 0) + (select count(*) from v_purchase_orders where overdue_amount > 0) as overdue_items,
  (select count(*) from v_orders where reminder_due) as reminder_items,
  (select count(*) from v_cash_flow where due_date is null) as undated_items;

-- OMS-006 (v_attention) and OMS-012 (one count for badge and header)
create or replace view v_attention with (security_invoker = true) as
-- order lines (the Excel "Check" column, minus the checks foreign keys make impossible)
select 'error' as severity, 'cost_missing' as code, 'sales_order_lines' as entity, l.id as entity_id,
       coalesce(l.pi_number, 'draft') as reference, 'Purchase price missing for ' || p.name as message
  from v_order_lines l join products p on p.id = l.product_id
 where l.unit_cost is null and l.status <> 'cancelled'
union all
select 'warning', 'below_basis', 'sales_order_lines', l.id, coalesce(l.pi_number, 'draft'),
       'Sale price ' || l.unit_price || ' is below the cost basis ' || l.cost_basis || ' for ' || p.name
  from v_order_lines l join products p on p.id = l.product_id
 where l.below_basis and l.status <> 'cancelled'
union all
select 'warning', 'price_differs_from_agreement', 'sales_order_lines', l.id, coalesce(l.pi_number, 'draft'),
       'Price differs from the customer''s price agreement for ' || p.name
  from v_order_lines l join products p on p.id = l.product_id
 where l.status <> 'cancelled'
   and exists (select 1 from price_agreements a
                where a.product_id = l.product_id and a.customer_id = l.customer_id and a.order_type = l.order_type
                  and (a.valid_from is null or l.revenue_date is null or a.valid_from <= l.revenue_date)
                  and (a.valid_to   is null or l.revenue_date is null or a.valid_to   >= l.revenue_date))
   and not exists (select 1 from price_agreements a
                where a.product_id = l.product_id and a.customer_id = l.customer_id and a.order_type = l.order_type
                  and round(a.sale_price, 4) = round(l.unit_price, 4)
                  and (a.valid_from is null or l.revenue_date is null or a.valid_from <= l.revenue_date)
                  and (a.valid_to   is null or l.revenue_date is null or a.valid_to   >= l.revenue_date))
union all
select 'warning', 'fob_from_stock', 'sales_order_lines', l.id, coalesce(l.pi_number, 'draft'), 'FOB line sold from NL stock?'
  from v_order_lines l where l.order_type = 'FOB' and l.batch_item_id is not null and l.status <> 'cancelled'
union all
select 'warning', 'stock_sale_without_po', 'sales_order_lines', l.id, coalesce(l.pi_number, 'draft'), 'Sold from NL stock, no PO to the supplier yet'
  from v_order_lines l where l.batch_item_id is not null and l.purchase_order_id is null and l.qty > 0
union all
select 'error', 'negative_stock', 'batch_items', s.batch_item_id, s.batch_number, 'Negative stock for ' || s.product_name
  from v_batch_item_stock s where s.stock < 0
union all
select 'warning', 'batch_empty', 'batches', b.batch_id, b.batch_number, 'Batch has no products yet'
  from v_batch_stock b where b.product_count = 0
-- orders
union all
select 'warning', 'draft_order', 'sales_orders', o.id, o.customer_name, 'Order has no PI# yet'
  from v_orders o where o.status = 'draft'
union all
select 'warning', 'order_incomplete', 'sales_orders', o.id, coalesce(o.pi_number, o.customer_name),
       'Missing: ' || concat_ws(', ', case when o.line_count = 0 then 'order lines' end,
                                      case when o.po_date is null then 'PO date' end,
                                      case when o.customer_po is null then 'customer PO#' end)
  from v_orders o where o.status <> 'cancelled' and (o.line_count = 0 or o.po_date is null or o.customer_po is null)
union all
select 'error', 'receivable_overdue', 'sales_orders', o.id, o.pi_number,
       o.currency || ' ' || o.overdue_amount || ' overdue by ' || o.days_late || ' days'
  from v_orders o where o.overdue_amount > 0
union all
select 'warning', 'exw_payment_reminder', 'sales_orders', o.id, o.pi_number,
       'EXW order unpaid since ' || o.reminder_date || ': ' || o.currency || ' ' || o.outstanding
  from v_orders o where o.reminder_due
union all
select 'warning', 'deposit_missing', 'sales_orders', o.id, o.pi_number,
       'Status is "' || o.status || '" but the deposit is not fully received'
  from v_orders o where o.status_rank >= 40 and o.status not in ('cancelled') and o.deposit_outstanding > 0.01
union all
select 'info', 'waiting_for_eta', 'sales_orders', o.id, o.pi_number, 'FOB balance has no due date: ETA unknown'
  from v_orders o where o.order_type = 'FOB' and o.status in ('shipped','delivered') and o.balance_due_date is null and o.outstanding > 0.01
union all
select 'info', 'ready_to_complete', 'sales_orders', o.id, o.pi_number, 'Paid and invoiced: can be set to completed'
  from v_orders o where o.paid_and_invoiced and o.is_open and o.status <> 'draft' and o.total_receivable > 0
union all
select 'warning', 'customer_overpaid', 'sales_orders', o.id, o.pi_number, 'Overpaid by ' || o.currency || ' ' || (-o.outstanding)
  from v_orders o where o.payment_status = 'overpaid'
-- purchase orders
union all
select 'warning', 'supplier_invoice_differs', 'purchase_orders', po.id, po.po_number,
       'Supplier invoice differs from expected by ' || po.currency || ' ' || po.invoice_difference
  from v_purchase_orders po where abs(coalesce(po.invoice_difference, 0)) > 0.01
union all
select 'error', 'payable_overdue', 'purchase_orders', po.id, po.po_number,
       po.currency || ' ' || po.overdue_amount || ' overdue by ' || po.days_late || ' days'
  from v_purchase_orders po where po.overdue_amount > 0
union all
select 'info', 'po_without_due_dates', 'purchase_orders', po.id, po.po_number, 'No payment due dates set on this PO'
  from v_purchase_orders po where po.outstanding > 0.01 and po.deposit_due_date is null and po.balance_due_date is null
union all
select 'warning', 'po_without_lines', 'purchase_orders', po.id, po.po_number, 'No order lines linked to this PO'
  from v_purchase_orders po where po.line_count = 0
-- shipments
union all
select 'warning', 'shipment_awaiting_info', 'shipments', s.id, coalesce(s.pi_numbers, s.po_numbers), 'Shipment has no ETD/ETA'
  from v_shipments s where s.status = 'awaiting_info'
union all
select 'warning', 'shipped_without_shipment', 'sales_orders', o.id, o.pi_number,
       'Status is "' || o.status || '" but no shipment is linked to this order'
  from v_orders o
 where o.status in ('shipped','delivered')
   and not exists (select 1 from shipment_orders x where x.sales_order_id = o.id);


create view v_attention_counts with (security_invoker = true) as
select count(*) filter (where severity <> 'info') as actionable, count(*) filter (where severity = 'info') as info_count
  from v_attention;

grant select on v_revenue_yearly, v_cash_flow_summary, v_overdue_coverage, v_attention_counts to authenticated;

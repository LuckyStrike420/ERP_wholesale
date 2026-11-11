-- =====================================================================
-- 0002: calculation functions, business-rule triggers and views
-- Every figure the app shows comes from the views in this file.
-- =====================================================================

-- ---------- helpers ----------
create or replace function setting_num(p_key text) returns numeric
language sql stable as $$ select value::numeric from app_settings where key = p_key $$;

-- "today" can be pinned for tests and reports: set app.today = '2026-11-10'
create or replace function app_today() returns date
language sql stable as $$
  select coalesce(nullif(current_setting('app.today', true), '')::date, current_date)
$$;

create or replace function add_working_days(p_date date, p_days int) returns date
language plpgsql immutable as $$
declare d date := p_date; n int := 0;
begin
  if p_date is null then return null; end if;
  while n < p_days loop
    d := d + 1;
    if extract(isodow from d) < 6 then n := n + 1; end if;
  end loop;
  return d;
end $$;

-- value of 1 unit of p_currency in the reporting currency on p_date (latest rate on or before that date)
create or replace function fx_rate(p_currency char(3), p_date date) returns numeric
language sql stable as $$
  select case
    when p_currency = (select value from app_settings where key = 'reporting_currency') then 1::numeric
    else (select rate from fx_rates
           where currency = p_currency and rate_date <= coalesce(p_date, app_today())
           order by rate_date desc limit 1)
  end
$$;

-- ---------- purchase price per piece ----------
-- Priority: 1 override on the line, 2 batch (EXW only), 3 price agreement, 4 product rule.
-- Rule formula: basis + (sale price - basis) * share.
create or replace function calc_unit_cost(
  p_product uuid, p_customer uuid, p_order_type text, p_unit_price numeric,
  p_batch_item uuid, p_override numeric, p_date date
) returns table (unit_cost numeric, cost_source text, cost_basis numeric)
language plpgsql stable as $$
declare
  dec int := setting_num('cost_decimals')::int;
  b numeric; s numeric; a numeric; c numeric;
begin
  if p_override is not null then
    return query select round(p_override, dec), 'override'::text, null::numeric; return;
  end if;

  if p_batch_item is not null and p_order_type = 'EXW' then
    select bi.cost_basis, bi.share_above_basis into b, s from batch_items bi where bi.id = p_batch_item;
    if b is not null or s is not null then
      return query select round(coalesce(b,0) + (p_unit_price - coalesce(b,0)) * coalesce(s,0), dec), 'batch'::text, b;
      return;
    end if;
  end if;

  select pa.agreed_cost into a
    from price_agreements pa
   where pa.product_id = p_product and pa.order_type = p_order_type
     and round(pa.sale_price, 4) = round(p_unit_price, 4)
     and pa.agreed_cost is not null
     and (pa.customer_id = p_customer or pa.customer_id is null)
     and (pa.valid_from is null or p_date is null or pa.valid_from <= p_date)
     and (pa.valid_to   is null or p_date is null or pa.valid_to   >= p_date)
   order by (pa.customer_id is null), pa.valid_from desc nulls last
   limit 1;
  if found then
    return query select round(a, dec), 'agreement'::text, null::numeric; return;
  end if;

  b := null; s := null;
  select r.cost_basis, r.share_above_basis into b, s
    from product_cost_rules r
   where r.product_id = p_product and r.order_type = p_order_type
     and r.valid_from <= coalesce(p_date, app_today())
   order by r.valid_from desc limit 1;
  c := round(coalesce(b,0) + (p_unit_price - coalesce(b,0)) * coalesce(s,0), dec);
  if c is null or c = 0 then
    return query select null::numeric, null::text, b; return;      -- purchase price missing
  end if;
  return query select c, 'product_rule'::text, b;
end $$;

create or replace function calc_royalty(p_product uuid, p_order_type text, p_date date) returns numeric
language sql stable as $$
  select coalesce((select r.royalty_per_unit from product_cost_rules r
                    where r.product_id = p_product and r.order_type = p_order_type
                      and r.valid_from <= coalesce(p_date, app_today())
                    order by r.valid_from desc limit 1), 0)
$$;

-- ---------- order lines ----------
create view v_order_lines with (security_invoker = true) as
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
  case when f.revenue <> 0
       then round((f.revenue - (f.purchase_value + f.invoice_variance + f.royalty_total + f.extra_costs)) / f.revenue, 4)
  end as margin_pct,
  f.counts_for_po, f.notes
from fixed f;

-- ---------- customer side: one row per order ----------
create view v_orders with (security_invoker = true) as
with l as (
  select sales_order_id, sum(revenue) as order_value, sum(total_cost) as total_cost, sum(margin) as margin, count(*) as line_count
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
  case when order_value <> 0 then round(margin / order_value, 4) end as margin_pct,
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
  notes
from calc2;

-- ---------- supplier side: one row per own PO ----------
create view v_purchase_orders with (security_invoker = true) as
with l as (
  select purchase_order_id,
         sum(purchase_value) filter (where counts_for_po) as expected,
         count(*) as line_count,
         string_agg(distinct pi_number, ', ' order by pi_number) as pi_numbers
    from v_order_lines where purchase_order_id is not null group by 1
),
pay as (
  select a.purchase_order_id, sum(a.amount) as amount, max(p.payment_date) as last_payment_date
    from payment_allocations a join payments p on p.id = a.payment_id
   where p.voided_at is null and a.purchase_order_id is not null group by 1
),
wo as (select purchase_order_id, sum(amount) as amount from write_offs where purchase_order_id is not null group by 1),
base as (
  select po.id, po.po_number, po.supplier_id, s.name as supplier_name, po.order_type, po.currency, po.po_date,
         coalesce(po.deposit_pct, 0) as deposit_pct, po.deposit_due_date, po.balance_due_date, po.notes,
         coalesce(l.line_count, 0) as line_count, l.pi_numbers,
         coalesce(l.expected, 0) as expected_amount,
         si.invoice_number, si.invoice_date, si.amount as invoice_amount,
         coalesce(pay.amount, 0) as paid, pay.last_payment_date,
         coalesce(wo.amount, 0)  as written_off,
         setting_num('payment_tolerance') as tol
    from purchase_orders po
    join suppliers s on s.id = po.supplier_id
    left join l   on l.purchase_order_id = po.id
    left join supplier_invoices si on si.purchase_order_id = po.id
    left join pay on pay.purchase_order_id = po.id
    left join wo  on wo.purchase_order_id = po.id
),
calc as (
  select b.*,
    coalesce(b.invoice_amount, b.expected_amount) as payable,
    round(coalesce(b.invoice_amount, b.expected_amount) * b.deposit_pct, 2) as deposit_due
  from base b
)
select
  id, po_number, supplier_id, supplier_name, order_type, currency, po_date, line_count, pi_numbers,
  expected_amount, invoice_number, invoice_date, invoice_amount,
  invoice_amount - expected_amount as invoice_difference,
  payable, deposit_pct, deposit_due,
  least(paid, deposit_due) as deposit_paid,
  deposit_due - least(paid, deposit_due) as deposit_outstanding,
  paid, written_off,
  payable - paid - written_off as outstanding,
  (payable - paid - written_off <= tol) as fully_paid,
  last_payment_date, deposit_due_date, balance_due_date,
  case when payable - paid - written_off <= tol then 0
       when balance_due_date < app_today() then payable - paid - written_off
       when deposit_due_date < app_today() then deposit_due - least(paid, deposit_due)
       else 0 end as overdue_amount,
  case when payable - paid - written_off <= tol then null
       when balance_due_date < app_today() then app_today() - balance_due_date
       when deposit_due_date < app_today() and deposit_due - least(paid, deposit_due) > tol then app_today() - deposit_due_date
  end as days_late,
  notes
from calc;

-- ---------- credit per customer / prepaid per supplier ----------
create view v_payments with (security_invoker = true) as
select p.*, coalesce(c.name, s.name) as party_name,
       coalesce((select sum(a.amount) from payment_allocations a where a.payment_id = p.id), 0) as allocated,
       case when p.voided_at is null
            then p.amount - coalesce((select sum(a.amount) from payment_allocations a where a.payment_id = p.id), 0)
            else 0 end as unallocated
  from payments p
  left join customers c on c.id = p.customer_id
  left join suppliers s on s.id = p.supplier_id;

-- money received from a customer that is not (or no longer) owed: kept as credit by default
create view v_customer_credit with (security_invoker = true) as
select customer_id, currency, sum(amount) as credit from (
  select customer_id, currency, unallocated as amount from v_payments where direction = 'in' and unallocated > 0
  union all
  select customer_id, currency, -outstanding from v_orders where outstanding < 0
) x group by 1, 2;

-- ---------- stock ----------
create view v_batch_item_stock with (security_invoker = true) as
select bi.id as batch_item_id, bi.batch_id, b.batch_number, b.supplier_id, b.received_date,
       bi.product_id, p.name as product_name, bi.qty_received,
       coalesce(adj.qty, 0)  as adjustments,
       coalesce(sold.qty, 0) as sold,
       bi.qty_received + coalesce(adj.qty, 0) - coalesce(sold.qty, 0) as stock,
       coalesce(sold.qty_no_po, 0) as sold_without_po
  from batch_items bi
  join batches b  on b.id = bi.batch_id
  join products p on p.id = bi.product_id
  left join (select batch_item_id, sum(quantity) as qty from stock_adjustments group by 1) adj on adj.batch_item_id = bi.id
  left join (select batch_item_id, sum(qty) as qty,
                    sum(qty) filter (where purchase_order_id is null) as qty_no_po
               from v_order_lines where batch_item_id is not null group by 1) sold on sold.batch_item_id = bi.id;

create view v_batch_stock with (security_invoker = true) as
select b.id as batch_id, b.batch_number, b.supplier_id, b.reference, b.received_date,
       count(s.batch_item_id) as product_count,
       coalesce(sum(s.qty_received), 0) as received, coalesce(sum(s.adjustments), 0) as adjustments,
       coalesce(sum(s.sold), 0) as sold, coalesce(sum(s.stock), 0) as stock,
       coalesce(sum(s.sold_without_po), 0) as sold_without_po
  from batches b left join v_batch_item_stock s on s.batch_id = b.id
 group by b.id;

create view v_product_stock with (security_invoker = true) as
select p.id as product_id, p.name as product_name,
       coalesce(sum(s.qty_received + s.adjustments), 0) as received_and_adjusted,
       coalesce(sum(s.sold), 0) as sold_from_stock,
       coalesce(sum(s.stock), 0) as stock
  from products p left join v_batch_item_stock s on s.product_id = p.id
 group by p.id;

-- dated history of every stock change
create view v_stock_movements with (security_invoker = true) as
select bi.id as batch_item_id, b.received_date as movement_date, 'receipt' as kind, bi.qty_received as quantity, b.batch_number as reference
  from batch_items bi join batches b on b.id = bi.batch_id
union all
select a.batch_item_id, a.adjustment_date, coalesce(a.kind, 'Overig'), a.quantity, a.reference from stock_adjustments a
union all
select l.batch_item_id, l.revenue_date, 'sale', -l.qty, l.pi_number from v_order_lines l where l.batch_item_id is not null and l.qty <> 0;

-- ---------- shipping ----------
create view v_shipments with (security_invoker = true) as
select s.*,
  case when s.eta is not null and s.eta <= app_today() then 'arrived'
       when s.etd is not null and s.etd <= app_today() then 'in_transit'
       when s.etd is not null or s.eta is not null   then 'planned'
       else 'awaiting_info' end as status,
  (select string_agg(o.pi_number, ', ') from shipment_orders x join sales_orders o on o.id = x.sales_order_id where x.shipment_id = s.id) as pi_numbers,
  (select string_agg(po.po_number, ', ') from shipment_orders x join purchase_orders po on po.id = x.purchase_order_id where x.shipment_id = s.id) as po_numbers
from shipments s;

-- ---------- reporting ----------
-- Revenue and margin by PO date. Drafts (no PI# yet) and cancelled orders do not count.
create view v_revenue_monthly with (security_invoker = true) as
select extract(year from l.revenue_date)::int as year, extract(month from l.revenue_date)::int as month,
       l.order_type, l.currency,
       sum(l.revenue) as revenue, sum(l.margin) as margin, sum(l.qty) as units,
       sum(l.revenue * fx_rate(l.currency, l.revenue_date)) as revenue_reporting,
       sum(l.margin  * fx_rate(l.currency, l.revenue_date)) as margin_reporting,
       bool_or(fx_rate(l.currency, l.revenue_date) is null) as fx_rate_missing
  from v_order_lines l
 where l.status not in ('draft','cancelled') and l.revenue_date is not null
 group by 1, 2, 3, 4;

create view v_outstanding_summary with (security_invoker = true) as
select currency,
       sum(receivable) as receivable, sum(receivable_overdue) as receivable_overdue,
       sum(payable) as payable, sum(payable_overdue) as payable_overdue,
       sum(open_orders) as open_orders
from (
  select currency, greatest(outstanding, 0) as receivable, overdue_amount as receivable_overdue,
         0::numeric as payable, 0::numeric as payable_overdue,
         case when is_open then 1 else 0 end as open_orders
    from v_orders where status not in ('draft','cancelled')
  union all
  select currency, 0, 0, greatest(outstanding, 0), overdue_amount, 0 from v_purchase_orders
) x group by currency;

-- expected money in and out, by due date
create view v_cash_flow with (security_invoker = true) as
select 'in' as direction, currency, id as order_id, pi_number as reference, customer_name as party,
       'deposit' as part, deposit_due_date as due_date, deposit_outstanding as amount
  from v_orders where status not in ('draft','cancelled') and deposit_outstanding > 0
union all
select 'in', currency, id, pi_number, customer_name, 'balance', balance_due_date, outstanding - deposit_outstanding
  from v_orders where status not in ('draft','cancelled') and outstanding - deposit_outstanding > 0
union all
select 'out', currency, id, po_number, supplier_name, 'deposit', deposit_due_date, deposit_outstanding
  from v_purchase_orders where deposit_outstanding > 0 and outstanding > 0
union all
select 'out', currency, id, po_number, supplier_name, 'balance', balance_due_date, outstanding - deposit_outstanding
  from v_purchase_orders where outstanding - deposit_outstanding > 0;

-- ---------- needs attention ----------
create view v_attention with (security_invoker = true) as
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
  from v_shipments s where s.status = 'awaiting_info';

-- =====================================================================
-- business-rule triggers
-- =====================================================================

-- defaults copied from the customer / supplier terms
create or replace function trg_sales_order_defaults() returns trigger language plpgsql as $$
begin
  if new.deposit_pct is null or new.payment_days is null then
    select coalesce(new.deposit_pct, ct.deposit_pct), coalesce(new.payment_days, ct.payment_days)
      into new.deposit_pct, new.payment_days
      from customer_terms ct where ct.customer_id = new.customer_id and ct.order_type = new.order_type;
  end if;
  new.deposit_pct  := coalesce(new.deposit_pct, 0);
  new.payment_days := coalesce(new.payment_days, 0);
  return new;
end $$;
create trigger sales_order_defaults before insert on sales_orders for each row execute function trg_sales_order_defaults();

create or replace function trg_purchase_order_defaults() returns trigger language plpgsql as $$
declare t_cur char(3); t_pct numeric;
begin
  select st.currency, st.deposit_pct into t_cur, t_pct
    from supplier_terms st where st.supplier_id = new.supplier_id and st.order_type = new.order_type;
  new.currency    := coalesce(new.currency, t_cur, (select currency from order_types where code = new.order_type));
  new.deposit_pct := coalesce(new.deposit_pct, t_pct, 0);
  return new;
end $$;
create trigger purchase_order_defaults before insert on purchase_orders for each row execute function trg_purchase_order_defaults();

-- order status flow
create or replace function trg_sales_order_status() returns trigger language plpgsql as $$
declare r_old int; r_new int; v record;
begin
  if new.order_type <> old.order_type and exists
     (select 1 from payment_allocations a join payments p on p.id = a.payment_id
       where a.sales_order_id = old.id and p.voided_at is null) then
    raise exception 'Order type (and currency) cannot change once payments are booked on the order';
  end if;

  if new.status is distinct from old.status then
    select rank into r_old from order_statuses where code = old.status;
    select rank into r_new from order_statuses where code = new.status;

    if old.status = 'cancelled' then
      raise exception 'A cancelled order cannot be reopened';
    elsif new.status = 'cancelled' then
      if r_old >= (select rank from order_statuses where code = 'shipped') then
        raise exception 'An order that has shipped cannot be cancelled';
      end if;
    elsif new.status = 'draft' then
      raise exception 'An order cannot go back to draft';
    elsif r_new < r_old and r_new <> (select max(rank) from order_statuses where rank < r_old) then
      raise exception 'Status can only go back one step at a time (% -> %)', old.status, new.status;
    end if;

    if new.status = 'completed' then
      select * into v from v_orders where id = old.id;
      if v.invoice_number is null then
        raise exception 'Order cannot be completed: no invoice registered';
      elsif v.outstanding > setting_num('payment_tolerance') then
        raise exception 'Order cannot be completed: % % still outstanding', v.currency, v.outstanding;
      end if;
    end if;

    if old.status = 'draft' then
      new.pi_date := coalesce(new.pi_date, app_today());
    end if;
  end if;

  -- the requested deposit is fixed at the first status change past draft ("stays as invoiced")
  if new.status is distinct from old.status and new.status not in ('draft','cancelled') and new.deposit_amount is null then
    select round(total_receivable * coalesce(new.deposit_pct, 0), 2) into new.deposit_amount
      from v_orders where id = old.id;
  end if;
  return new;
end $$;
create trigger sales_order_status before update on sales_orders for each row execute function trg_sales_order_status();

-- explicit action: recalculate the requested deposit from the current order value
create or replace function recalculate_deposit(p_order uuid) returns numeric language plpgsql as $$
declare v numeric;
begin
  select round(total_receivable * deposit_pct, 2) into v from v_orders where id = p_order;
  update sales_orders set deposit_amount = v where id = p_order;
  return v;
end $$;

-- order lines
create or replace function trg_sales_order_line_check() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from sales_orders where id = coalesce(new.sales_order_id, old.sales_order_id);
  if st in ('completed','cancelled') then
    raise exception 'Lines of a % order cannot be changed', st;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.batch_item_id is not null and not exists
     (select 1 from batch_items bi where bi.id = new.batch_item_id and bi.product_id = new.product_id) then
    raise exception 'This product is not in the chosen batch';
  end if;
  return new;
end $$;
create trigger sales_order_line_check before insert or update or delete on sales_order_lines
  for each row execute function trg_sales_order_line_check();

-- supplier invoice received: cost prices of that PO's lines become final
create or replace function trg_freeze_costs() returns trigger language plpgsql as $$
begin
  update sales_order_lines l
     set frozen_unit_cost = v.unit_cost, frozen_cost_source = v.cost_source,
         frozen_royalty = v.royalty_per_unit, cost_frozen_at = now()
    from v_order_lines v
   where v.id = l.id and l.purchase_order_id = new.purchase_order_id
     and l.frozen_unit_cost is null and v.unit_cost is not null
     and v.status not in ('completed','cancelled');
  return new;
end $$;
create trigger supplier_invoice_freeze_costs after insert on supplier_invoices for each row execute function trg_freeze_costs();

-- payments
create or replace function trg_payment_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payments are never deleted: void the payment instead';
  end if;
  if old.voided_at is not null and new.voided_at is null then
    raise exception 'A voided payment cannot be restored: book it again';
  end if;
  if (new.amount, new.currency, new.direction) is distinct from (old.amount, old.currency, old.direction)
     or new.customer_id is distinct from old.customer_id or new.supplier_id is distinct from old.supplier_id then
    if exists (select 1 from payment_allocations a where a.payment_id = old.id) then
      raise exception 'Amount, currency and party cannot change once the payment is allocated: void it and book it again';
    end if;
  end if;
  return new;
end $$;
create trigger payment_guard before update or delete on payments for each row execute function trg_payment_guard();

create or replace function trg_allocation_check() returns trigger language plpgsql as $$
declare p payments%rowtype; allocated numeric; o record;
begin
  select * into p from payments where id = new.payment_id;
  if p.voided_at is not null then raise exception 'This payment is voided'; end if;

  if new.sales_order_id is not null then
    if p.direction <> 'in' then raise exception 'A supplier payment cannot be allocated to a customer order'; end if;
    select so.customer_id, t.currency, so.status into o
      from sales_orders so join order_types t on t.code = so.order_type where so.id = new.sales_order_id;
    if o.customer_id <> p.customer_id then raise exception 'Payment and order belong to different customers'; end if;
    if o.status in ('draft','cancelled') then raise exception 'Payments cannot be allocated to a % order', o.status; end if;
  else
    if p.direction <> 'out' then raise exception 'A customer payment cannot be allocated to a purchase order'; end if;
    select po.supplier_id as party, po.currency into o from purchase_orders po where po.id = new.purchase_order_id;
    if o.party <> p.supplier_id then raise exception 'Payment and PO belong to different suppliers'; end if;
  end if;
  if o.currency <> p.currency then
    raise exception 'Currency mismatch: payment is in %, order is in %', p.currency, o.currency;
  end if;

  select coalesce(sum(a.amount), 0) into allocated
    from payment_allocations a where a.payment_id = new.payment_id and a.id <> new.id;
  if allocated + new.amount > p.amount then
    raise exception 'Allocation exceeds the payment: % available, % requested', p.amount - allocated, new.amount;
  end if;
  return new;
end $$;
create trigger allocation_check before insert or update on payment_allocations for each row execute function trg_allocation_check();

-- deposit covered -> status moves to "deposit received" by itself
create or replace function trg_allocation_status() returns trigger language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if new.sales_order_id is null then return new; end if;
  select status, deposit_due, deposit_outstanding into v from v_orders where id = new.sales_order_id;
  if v.status in ('pi_sent','po_received') and v.deposit_due > 0
     and v.deposit_outstanding <= setting_num('payment_tolerance') then
    update sales_orders set status = 'deposit_received' where id = new.sales_order_id;
  end if;
  return new;
end $$;
create trigger allocation_status after insert or update on payment_allocations for each row execute function trg_allocation_status();

-- book a payment and allocate it to one order in one step (what the "Register payment" button calls)
create or replace function register_customer_payment(
  p_order uuid, p_date date, p_amount numeric, p_reference text default null, p_notes text default null
) returns uuid language plpgsql as $$
declare o record; pid uuid; alloc numeric;
begin
  select id, customer_id, currency, outstanding into o from v_orders where id = p_order;
  if o.id is null then raise exception 'Order not found'; end if;
  insert into payments (direction, customer_id, payment_date, amount, currency, reference, notes)
       values ('in', o.customer_id, p_date, p_amount, o.currency, p_reference, p_notes) returning id into pid;
  alloc := least(p_amount, greatest(o.outstanding, 0));          -- anything above the open amount stays as customer credit
  if alloc > 0 then
    insert into payment_allocations (payment_id, sales_order_id, amount) values (pid, p_order, alloc);
  end if;
  return pid;
end $$;

create or replace function register_supplier_payment(
  p_po uuid, p_date date, p_amount numeric, p_reference text default null, p_notes text default null
) returns uuid language plpgsql as $$
declare o record; pid uuid; alloc numeric;
begin
  select id, supplier_id, currency, outstanding into o from v_purchase_orders where id = p_po;
  if o.id is null then raise exception 'Purchase order not found'; end if;
  insert into payments (direction, supplier_id, payment_date, amount, currency, reference, notes)
       values ('out', o.supplier_id, p_date, p_amount, o.currency, p_reference, p_notes) returning id into pid;
  alloc := least(p_amount, greatest(o.outstanding, 0));
  if alloc > 0 then
    insert into payment_allocations (payment_id, purchase_order_id, amount) values (pid, p_po, alloc);
  end if;
  return pid;
end $$;

create or replace function void_payment(p_payment uuid, p_reason text) returns void language plpgsql as $$
begin
  update payments set voided_at = now(), void_reason = p_reason where id = p_payment and voided_at is null;
  if not found then raise exception 'Payment not found or already voided'; end if;
end $$;

-- =====================================================================
-- 0038: payment terms counted from the delivery date, and early payment discounts.
-- - Anchor "delivery_date": the day the goods were collected (pick-up date) or arrived (ETA / delivery date of the shipment).
-- - payment_terms.discount_pct / discount_days: e.g. 3% off when paid within 14 days, counted from the same date
--   as the balance (or the single payment when the deposit is 100%); the normal term (e.g. 30 days) stays the due date.
-- - v_orders: delivery_date, discount_pct, discount_until, discount_amount, discount_open (can still be used),
--   discount_to_book (paid in time and short by about the discount).
-- - book_early_discount(order): books the remaining amount as a write-off "Early payment discount".
-- - Attention item for orders whose discount can be booked.
-- Roll back: re-create v_orders (0023) and v_attention (0037), drop the function and the two columns, restore the anchor checks.
-- =====================================================================
alter table payment_terms add column discount_pct numeric(5,4) not null default 0 check (discount_pct >= 0 and discount_pct < 0.5);
alter table payment_terms add column discount_days int check (discount_days is null or discount_days >= 0);
alter table payment_terms drop constraint payment_terms_deposit_anchor_check;
alter table payment_terms add constraint payment_terms_deposit_anchor_check check (deposit_anchor in ('order_date','pi_date','po_date','invoice_date','etd','eta','delivery_date'));
alter table payment_terms drop constraint payment_terms_balance_anchor_check;
alter table payment_terms add constraint payment_terms_balance_anchor_check check (balance_anchor in ('order_date','pi_date','po_date','invoice_date','etd','eta','delivery_date'));

create or replace view v_orders with (security_invoker = true) as
with l as (
  select sales_order_id, sum(revenue) as order_value, sum(total_cost) as total_cost, sum(margin) as margin, count(*) as line_count,
         count(*) filter (where not cost_known and status <> 'cancelled') as cost_missing_lines
    from v_order_lines group by 1
),
vat as (
  select vl.sales_order_id, sum(round(vl.revenue * coalesce(sl.vat_rate, p.vat_rate, 0), 2)) as amount
    from v_order_lines vl join sales_order_lines sl on sl.id = vl.id left join products p on p.id = sl.product_id group by 1
),
adj as (select sales_order_id, sum(amount) as amount from order_adjustments group by 1),
pay as (
  select a.sales_order_id, sum(a.amount) as amount, max(p.payment_date) as last_payment_date
    from payment_allocations a join payments p on p.id = a.payment_id
   where p.voided_at is null and a.sales_order_id is not null group by 1
),
wo as (select sales_order_id, sum(amount) as amount from write_offs where sales_order_id is not null group by 1),
ship as (
  select so.sales_order_id, max(s.eta) as eta, max(s.etd) as etd,
         -- 0038: delivered = picked up (pick-up date) or arrived (ETA / delivery date)
         max(case when s.mode = 'pickup' then s.etd else s.eta end) as delivery_date
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
    coalesce(o.vat_applies, false) as vat_applies,
    case when o.status = 'cancelled' or not coalesce(o.vat_applies, false) then 0 else coalesce(vat.amount, 0) end as vat_amount,
    coalesce(l.total_cost, 0) as total_cost,
    coalesce(l.margin, 0)     as margin,
    coalesce(pay.amount, 0)   as paid,
    pay.last_payment_date,
    coalesce(wo.amount, 0)    as written_off,
    i.invoice_number, i.invoice_date, ship.etd, ship.eta, ship.delivery_date,
    o.deposit_due_date as deposit_due_date_manual,
    o.balance_due_date as balance_due_date_manual,
    o.payment_term_id, pt.name as payment_term_name,
    pt.deposit_anchor, pt.deposit_days, pt.balance_anchor, pt.balance_days,
    coalesce(pt.discount_pct, 0) as discount_pct, pt.discount_days,
    setting_num('payment_tolerance') as tol
  from sales_orders o
  join order_types t     on t.code = o.order_type
  join order_statuses st on st.code = o.status
  join customers c       on c.id = o.customer_id
  left join l    on l.sales_order_id = o.id
  left join vat  on vat.sales_order_id = o.id
  left join adj  on adj.sales_order_id = o.id
  left join pay  on pay.sales_order_id = o.id
  left join wo   on wo.sales_order_id = o.id
  left join invoices i on i.sales_order_id = o.id
  left join ship on ship.sales_order_id = o.id
  left join payment_terms pt on pt.id = o.payment_term_id
),
calc as (
  select b.*,
    b.order_value + b.vat_amount + b.adjustments as total_receivable,
    case when b.status = 'cancelled' then 0
         else least(coalesce(b.deposit_amount_fixed, round((b.order_value + b.vat_amount + b.adjustments) * b.deposit_pct, 2)),
                    greatest(b.order_value + b.vat_amount + b.adjustments, 0)) end as deposit_due,
    -- due dates: a date set on the order wins; then the order's payment term; orders without a term keep the old rules
    coalesce(b.deposit_due_date_manual,
             case when b.payment_term_id is not null and b.deposit_pct > 0 then
               case b.deposit_anchor when 'order_date' then coalesce(b.pi_date, b.po_date) when 'pi_date' then b.pi_date when 'po_date' then b.po_date
                    when 'invoice_date' then b.invoice_date when 'etd' then b.etd when 'eta' then b.eta when 'delivery_date' then b.delivery_date end + b.deposit_days end) as deposit_due_date,
    case when b.balance_due_date_manual is not null then b.balance_due_date_manual
         when b.payment_term_id is not null then
           case when b.deposit_pct < 1 then
             case b.balance_anchor when 'order_date' then coalesce(b.pi_date, b.po_date) when 'pi_date' then b.pi_date when 'po_date' then b.po_date
                  when 'invoice_date' then b.invoice_date when 'etd' then b.etd when 'eta' then b.eta when 'delivery_date' then b.delivery_date end + b.balance_days end
         else coalesce(case when b.order_type = 'FOB' and b.eta is not null
                            then b.eta - setting_num('fob_balance_days_before_eta')::int end,
                       b.invoice_date + b.payment_days) end as balance_due_date,
    -- early payment discount: counted from the same date as the balance (or the single payment)
    case when b.discount_pct > 0 and b.discount_days is not null then
      case case when b.deposit_pct >= 1 then b.deposit_anchor else b.balance_anchor end
           when 'order_date' then coalesce(b.pi_date, b.po_date) when 'pi_date' then b.pi_date when 'po_date' then b.po_date
           when 'invoice_date' then b.invoice_date when 'etd' then b.etd when 'eta' then b.eta when 'delivery_date' then b.delivery_date end
      + b.discount_days end as discount_until,
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
  (cost_missing_lines = 0) as cost_complete,
  payment_term_id, payment_term_name,
  (deposit_due_date_manual is not null) as deposit_due_date_set,
  (balance_due_date_manual is not null) as balance_due_date_set,
  vat_applies, vat_amount,
  delivery_date, discount_pct, discount_until,
  round(total_receivable * discount_pct, 2) as discount_amount,
  -- still possible: pay the total minus the discount by discount_until
  (discount_pct > 0 and status not in ('draft','cancelled') and outstanding > tol
   and (discount_until is null or discount_until >= app_today())) as discount_open,
  -- paid in time, short by about the discount: book it as a write-off
  (discount_pct > 0 and status not in ('draft','cancelled') and outstanding > tol
   and outstanding <= round(total_receivable * discount_pct, 2) + tol
   and discount_until is not null and last_payment_date <= discount_until) as discount_to_book
from calc2;

create or replace function book_early_discount(p_order uuid) returns numeric
language plpgsql security invoker set search_path = public as $$
declare o record;
begin
  select * into o from v_orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if not coalesce(o.discount_to_book, false) then raise exception 'There is no early payment discount to book on this order'; end if;
  insert into write_offs (sales_order_id, write_off_date, amount, reason)
  values (p_order, coalesce(o.last_payment_date, app_today()), o.outstanding,
          'Early payment discount ' || rtrim(rtrim(to_char(o.discount_pct * 100, 'FM990.00'), '0'), '.') || '% (paid by ' || to_char(o.discount_until, 'DD-MM-YYYY') || ')');
  return o.outstanding;
end $$;
grant execute on function book_early_discount(uuid) to authenticated;

create or replace view v_attention with (security_invoker = true) as
with ol as materialized (select * from v_order_lines),
     so as materialized (select * from v_orders),
     pos as materialized (select * from v_purchase_orders)
-- order lines (the Excel "Check" column, minus the checks foreign keys make impossible)
select 'error' as severity, 'cost_missing' as code, 'sales_order_lines' as entity, l.id as entity_id,
       coalesce(l.pi_number, 'draft') as reference, 'Purchase price missing for ' || p.name as message
  from ol l join products p on p.id = l.product_id
 where l.unit_cost is null and l.status <> 'cancelled'
union all
select 'warning', 'below_basis', 'sales_order_lines', l.id, coalesce(l.pi_number, 'draft'),
       'Sale price ' || l.unit_price || ' is below the cost basis ' || l.cost_basis || ' for ' || p.name
  from ol l join products p on p.id = l.product_id
 where l.below_basis and l.status <> 'cancelled'
union all
select 'warning', 'price_differs_from_agreement', 'sales_order_lines', l.id, coalesce(l.pi_number, 'draft'),
       'Price differs from the customer''s price agreement for ' || p.name
  from ol l join products p on p.id = l.product_id
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
  from ol l where l.order_type = 'FOB' and l.batch_item_id is not null and l.status <> 'cancelled'
union all
select 'warning', 'stock_sale_without_po', 'sales_order_lines', l.id, coalesce(l.pi_number, 'draft'), 'Sold from NL stock, no PO to the supplier yet'
  from ol l where l.batch_item_id is not null and l.purchase_order_id is null and l.qty > 0 and not l.own_stock
union all
select 'error', 'negative_stock', 'batch_items', s.batch_item_id, s.batch_number, 'Negative stock for ' || s.product_name
  from v_batch_item_stock s where s.stock < 0
union all
select 'warning', 'batch_empty', 'batches', b.batch_id, b.batch_number, 'Batch has no products yet'
  from v_batch_stock b where b.product_count = 0
-- orders
union all
select 'warning', 'draft_order', 'sales_orders', o.id, o.customer_name, 'Order has no PI# yet'
  from so o where o.status = 'draft'
union all
select 'warning', 'order_incomplete', 'sales_orders', o.id, coalesce(o.pi_number, o.customer_name),
       'Missing: ' || concat_ws(', ', case when o.line_count = 0 then 'order lines' end,
                                      case when o.po_date is null then 'PO date' end,
                                      case when o.customer_po is null then 'customer PO#' end)
  from so o where o.status <> 'cancelled' and (o.line_count = 0 or o.po_date is null or o.customer_po is null)
union all
select 'error', 'receivable_overdue', 'sales_orders', o.id, o.pi_number,
       o.currency || ' ' || o.overdue_amount || ' overdue by ' || o.days_late || ' days'
  from so o where o.overdue_amount > 0
union all
select 'warning', 'exw_payment_reminder', 'sales_orders', o.id, o.pi_number,
       'EXW order unpaid since ' || o.reminder_date || ': ' || o.currency || ' ' || o.outstanding
  from so o where o.reminder_due
union all
select 'warning', 'deposit_missing', 'sales_orders', o.id, o.pi_number,
       'Status is "' || o.status || '" but the deposit is not fully received'
  from so o where o.status_rank >= 40 and o.status not in ('cancelled') and o.deposit_outstanding > 0.01
union all
select 'info', 'waiting_for_eta', 'sales_orders', o.id, o.pi_number, 'FOB balance has no due date: ETA unknown'
  from so o where o.order_type = 'FOB' and o.status in ('shipped','delivered') and o.balance_due_date is null and o.outstanding > 0.01
union all
select 'info', 'ready_to_complete', 'sales_orders', o.id, o.pi_number, 'Paid and invoiced: can be set to completed'
  from so o where o.paid_and_invoiced and o.is_open and o.status <> 'draft' and o.total_receivable > 0
union all
select 'warning', 'customer_overpaid', 'sales_orders', o.id, o.pi_number, 'Overpaid by ' || o.currency || ' ' || (-o.outstanding)
  from so o where o.payment_status = 'overpaid'
-- purchase orders
union all
select 'warning', 'supplier_invoice_differs', 'purchase_orders', po.id, po.po_number,
       'Supplier invoice differs from expected by ' || po.currency || ' ' || po.invoice_difference
  from pos po where abs(coalesce(po.invoice_difference, 0)) > 0.01
union all
select 'error', 'payable_overdue', 'purchase_orders', po.id, po.po_number,
       po.currency || ' ' || po.overdue_amount || ' overdue by ' || po.days_late || ' days'
  from pos po where po.overdue_amount > 0
union all
select 'info', 'po_without_due_dates', 'purchase_orders', po.id, po.po_number, 'No payment due dates set on this PO'
  from pos po where po.outstanding > 0.01 and po.deposit_due_date is null and po.balance_due_date is null
union all
select 'warning', 'po_without_lines', 'purchase_orders', po.id, po.po_number, 'No order lines linked to this PO'
  from pos po where po.line_count = 0
-- shipments
union all
select 'warning', 'shipment_awaiting_info', 'shipments', s.id, coalesce(s.pi_numbers, s.po_numbers), 'Shipment has no ETD/ETA'
  from v_shipments s where s.status = 'awaiting_info'
union all
select 'warning', 'below_moq', 'sales_order_lines', l.id, coalesce(l.pi_number, 'draft'),
       'Quantity ' || l.qty || ' is below the MOQ of ' || m.moq || ' in the price agreement for ' || p.name
  from ol l join products p on p.id = l.product_id
 cross join lateral (select a.moq from price_agreements a
                      where a.product_id = l.product_id and a.order_type = l.order_type and a.moq is not null
                        and round(a.sale_price, 4) = round(l.unit_price, 4)
                        and (a.customer_id = l.customer_id or a.customer_id is null)
                        and (a.valid_from is null or l.revenue_date is null or a.valid_from <= l.revenue_date)
                        and (a.valid_to   is null or l.revenue_date is null or a.valid_to   >= l.revenue_date)
                      order by (a.customer_id is null), a.valid_from desc nulls last limit 1) m
 where l.status not in ('completed','cancelled') and l.qty > 0 and l.qty < m.moq
union all
select 'warning', 'shipped_without_shipment', 'sales_orders', o.id, o.pi_number,
       'Status is "' || o.status || '" but no shipment is linked to this order'
  from so o
 where o.status in ('shipped','delivered')
   and not exists (select 1 from shipment_orders x where x.sales_order_id = o.id)
-- 0033: DAP / DDP: we arrange the transport, so its cost belongs in the margin
union all
select 'warning', 'transport_cost_missing', 'sales_orders', d.sales_order_id, coalesce(d.pi_number, 'draft'),
       d.incoterm || ': we arrange the transport, but no transport cost is entered yet'
  from v_order_delivery d where d.transport_missing
-- 0036: a document that is needed by now and not uploaded (and not marked "not needed")
union all
select 'warning', 'document_missing', 'sales_orders', d.sales_order_id, coalesce(d.pi_number, 'draft'), d.label || ' missing'
  from v_order_doc_slots d where d.due_now and d.state = 'missing' and d.status not in ('completed','cancelled')
union all
select 'info', 'early_discount_to_book', 'sales_orders', o.id, o.pi_number,
       'Paid within the discount term: book the ' || round(o.discount_pct * 100, 1) || '% discount (' || o.currency || ' ' || o.outstanding || ')'
  from so o where o.discount_to_book;


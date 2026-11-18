-- =====================================================================
-- 0023: Dutch VAT on EXW sales and purchases with a Dutch company.
-- - products.vat_rate: 21% (default) or 9%. Order lines keep the rate they were sold at (sales_order_lines.vat_rate).
-- - sales_orders.vat_applies / purchase_orders.vat_applies: filled automatically when the order is made (empty = no VAT)
--   (EXW and the customer / supplier is in the Netherlands), and can be switched on the order.
-- - v_orders: vat_amount; total to receive, deposit, balance and outstanding include VAT. Revenue and margin do not.
-- - v_purchase_orders: vat_amount; payable, deposit and outstanding include VAT. The supplier invoice amount is
--   entered without VAT (it is also the cost price); its VAT follows the PO lines' rates.
-- Roll back: re-create v_orders from 0015 and v_purchase_orders from 0002, drop the triggers and the vat columns.
-- =====================================================================
create or replace function is_dutch(p_country text) returns boolean language sql immutable as $$
  select lower(trim(coalesce(p_country, ''))) in ('nl', 'nld', 'netherlands', 'the netherlands', 'nederland', 'holland')
$$;

alter table products add column vat_rate numeric(5,4) not null default 0.21 check (vat_rate in (0.21, 0.09));
alter table sales_order_lines add column vat_rate numeric(5,4) check (vat_rate in (0, 0.21, 0.09));
alter table sales_orders add column vat_applies boolean;
alter table purchase_orders add column vat_applies boolean;

-- a line takes the product's rate when it is made or gets another product
create or replace function trg_line_vat_rate() returns trigger language plpgsql as $$
begin
  if new.vat_rate is null or (tg_op = 'UPDATE' and new.product_id is distinct from old.product_id and new.vat_rate is not distinct from old.vat_rate) then
    select vat_rate into new.vat_rate from products where id = new.product_id;
  end if;
  return new;
end $$;
create trigger vat_rate before insert or update of product_id on sales_order_lines for each row execute function trg_line_vat_rate();

-- an order decides once whether VAT applies; a change of customer or type decides again, unless the same change sets it
create or replace function trg_order_vat() returns trigger language plpgsql as $$
begin
  if new.vat_applies is null or (tg_op = 'UPDATE' and (new.customer_id is distinct from old.customer_id or new.order_type is distinct from old.order_type)
                                  and new.vat_applies is not distinct from old.vat_applies) then
    select new.order_type = 'EXW' and is_dutch(c.country) into new.vat_applies from customers c where c.id = new.customer_id;
  end if;
  return new;
end $$;
create trigger vat_applies before insert or update of customer_id, order_type on sales_orders for each row execute function trg_order_vat();

create or replace function trg_po_vat() returns trigger language plpgsql as $$
begin
  if new.vat_applies is null or (tg_op = 'UPDATE' and (new.supplier_id is distinct from old.supplier_id or new.order_type is distinct from old.order_type)
                                  and new.vat_applies is not distinct from old.vat_applies) then
    select new.order_type = 'EXW' and is_dutch(s.country) into new.vat_applies from suppliers s where s.id = new.supplier_id;
  end if;
  return new;
end $$;
create trigger vat_applies before insert or update of supplier_id, order_type on purchase_orders for each row execute function trg_po_vat();

-- existing data: only where VAT now applies (others stay empty = no VAT); older lines without a rate use the product's
update sales_orders o set vat_applies = true from customers c where c.id = o.customer_id and o.vat_applies is null and o.order_type = 'EXW' and is_dutch(c.country);
update purchase_orders po set vat_applies = true from suppliers s where s.id = po.supplier_id and po.vat_applies is null and po.order_type = 'EXW' and is_dutch(s.country);

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
    coalesce(o.vat_applies, false) as vat_applies,
    case when o.status = 'cancelled' or not coalesce(o.vat_applies, false) then 0 else coalesce(vat.amount, 0) end as vat_amount,
    coalesce(l.total_cost, 0) as total_cost,
    coalesce(l.margin, 0)     as margin,
    coalesce(pay.amount, 0)   as paid,
    pay.last_payment_date,
    coalesce(wo.amount, 0)    as written_off,
    i.invoice_number, i.invoice_date, ship.etd, ship.eta,
    o.deposit_due_date as deposit_due_date_manual,
    o.balance_due_date as balance_due_date_manual,
    o.payment_term_id, pt.name as payment_term_name,
    pt.deposit_anchor, pt.deposit_days, pt.balance_anchor, pt.balance_days,
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
                    when 'invoice_date' then b.invoice_date when 'etd' then b.etd when 'eta' then b.eta end + b.deposit_days end) as deposit_due_date,
    case when b.balance_due_date_manual is not null then b.balance_due_date_manual
         when b.payment_term_id is not null then
           case when b.deposit_pct < 1 then
             case b.balance_anchor when 'order_date' then coalesce(b.pi_date, b.po_date) when 'pi_date' then b.pi_date when 'po_date' then b.po_date
                  when 'invoice_date' then b.invoice_date when 'etd' then b.etd when 'eta' then b.eta end + b.balance_days end
         else coalesce(case when b.order_type = 'FOB' and b.eta is not null
                            then b.eta - setting_num('fob_balance_days_before_eta')::int end,
                       b.invoice_date + b.payment_days) end as balance_due_date,
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
  vat_applies, vat_amount
from calc2;

create or replace view v_purchase_orders with (security_invoker = true) as
with l as (
  select vl.purchase_order_id,
         sum(vl.purchase_value) filter (where vl.counts_for_po) as expected,
         sum(round(vl.purchase_value * coalesce(sl.vat_rate, p.vat_rate, 0), 2)) filter (where vl.counts_for_po) as expected_vat,
         count(*) as line_count,
         string_agg(distinct vl.pi_number, ', ' order by vl.pi_number) as pi_numbers
    from v_order_lines vl join sales_order_lines sl on sl.id = vl.id left join products p on p.id = sl.product_id
   where vl.purchase_order_id is not null group by 1
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
         coalesce(po.vat_applies, false) as vat_applies,
         case when not coalesce(po.vat_applies, false) then 0
              when si.amount is not null and coalesce(l.expected, 0) <> 0 then round(si.amount * l.expected_vat / l.expected, 2)
              else coalesce(l.expected_vat, 0) end as vat_amount,
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
    coalesce(b.invoice_amount, b.expected_amount) + b.vat_amount as payable,
    round((coalesce(b.invoice_amount, b.expected_amount) + b.vat_amount) * b.deposit_pct, 2) as deposit_due
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
  notes,
  vat_applies, vat_amount
from calc;

grant select on v_orders, v_purchase_orders to authenticated;

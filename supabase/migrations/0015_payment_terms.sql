-- =====================================================================
-- 0015: payment terms you manage yourself, chosen per customer and order type
--  * payment_terms: a deposit part and a balance part, each with an anchor date and a number of days
--    (negative = before the anchor). Anchor "order_date" = PI date, or the customer's PO date while there is no PI date.
--  * customer_terms.payment_term_id: the term a customer gets per order type; new orders copy it
--  * sales_orders.payment_term_id: the term of this order (changeable per order)
--  * v_orders: due dates come from the order's term. A date typed on the order still wins.
--    Orders without a term keep the old rules (FOB: ETA - setting, otherwise invoice date + payment days).
-- Starting terms (agreed 17 nov 2026): "100% payment" = everything before ETD;
-- "30% deposit / 70% balance" = deposit 7 days after the order date, balance 10 days before ETA.
-- Existing customer deposits other than 100% / 30% get a term of their own with the 30/70 timing, so their percentage stays.
-- Roll back: drop the two columns, the table and the triggers, and re-create v_orders from 0007.
-- =====================================================================
create table payment_terms (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique check (length(trim(name)) > 0),
  deposit_pct    numeric(7,4) not null default 0 check (deposit_pct between 0 and 1),
  deposit_anchor text check (deposit_anchor in ('order_date','pi_date','po_date','invoice_date','etd','eta')),
  deposit_days   int not null default 0,
  balance_anchor text check (balance_anchor in ('order_date','pi_date','po_date','invoice_date','etd','eta')),
  balance_days   int not null default 0,
  active         boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now()
);

insert into payment_terms (name, deposit_pct, deposit_anchor, deposit_days, balance_anchor, balance_days) values
  ('100% payment',              1.00, 'etd',         0, null,   0),
  ('30% deposit / 70% balance', 0.30, 'order_date',  7, 'eta', -10);

alter table customer_terms add column payment_term_id uuid references payment_terms;
alter table sales_orders   add column payment_term_id uuid references payment_terms;
create index on sales_orders (payment_term_id);

-- the customer's deposit % follows the chosen term (it is what new orders copy)
create or replace function trg_customer_terms_follow_term() returns trigger language plpgsql as $$
begin
  if new.payment_term_id is not null then
    select deposit_pct into new.deposit_pct from payment_terms where id = new.payment_term_id;
  end if;
  return new;
end $$;
create trigger follow_term before insert or update on customer_terms for each row execute function trg_customer_terms_follow_term();

create or replace function trg_payment_terms_changed() returns trigger language plpgsql as $$
begin
  if new.deposit_pct is distinct from old.deposit_pct then
    update customer_terms set deposit_pct = new.deposit_pct where payment_term_id = new.id;
  end if;
  return new;
end $$;
create trigger payment_terms_changed after update on payment_terms for each row execute function trg_payment_terms_changed();

-- new orders: the term of the customer for this order type, unless one is given
create or replace function trg_sales_order_defaults() returns trigger language plpgsql as $$
begin
  if new.payment_term_id is null then
    select ct.payment_term_id into new.payment_term_id
      from customer_terms ct where ct.customer_id = new.customer_id and ct.order_type = new.order_type;
  end if;
  if new.deposit_pct is null and new.payment_term_id is not null then
    select deposit_pct into new.deposit_pct from payment_terms where id = new.payment_term_id;
  end if;
  if new.deposit_pct is null or new.payment_days is null then
    select coalesce(new.deposit_pct, ct.deposit_pct), coalesce(new.payment_days, ct.payment_days)
      into new.deposit_pct, new.payment_days
      from customer_terms ct where ct.customer_id = new.customer_id and ct.order_type = new.order_type;
  end if;
  new.deposit_pct  := coalesce(new.deposit_pct, 0);
  new.payment_days := coalesce(new.payment_days, 0);
  return new;
end $$;

-- another term on an existing order: its deposit % comes along (unless the same change sets a % of its own),
-- and when it replaces an earlier term, a deposit already fixed on a sent PI is recalculated with the new %
create or replace function trg_sales_order_term_change() returns trigger language plpgsql as $$
declare t_pct numeric;
begin
  if new.payment_term_id is distinct from old.payment_term_id and new.payment_term_id is not null then
    select deposit_pct into t_pct from payment_terms where id = new.payment_term_id;
    if new.deposit_pct is not distinct from old.deposit_pct then new.deposit_pct := t_pct; end if;
    if old.payment_term_id is not null and old.deposit_amount is not null and new.deposit_amount is not distinct from old.deposit_amount then
      select round(total_receivable * new.deposit_pct, 2) into new.deposit_amount from v_orders where id = old.id;
    end if;
  end if;
  return new;
end $$;
create trigger sales_order_term_change before update of payment_term_id on sales_orders for each row execute function trg_sales_order_term_change();

-- links existing customer terms and orders to a payment term with the same deposit %; changes no percentage or amount
create or replace function link_payment_terms() returns void language plpgsql as $$
declare p numeric;
begin
  for p in select distinct deposit_pct from customer_terms where payment_term_id is null
             and deposit_pct not in (select deposit_pct from payment_terms) loop
    insert into payment_terms (name, deposit_pct, deposit_anchor, deposit_days, balance_anchor, balance_days)
    values (format('%s%% deposit / %s%% balance', round(p * 100)::int, 100 - round(p * 100)::int), p,
            case when p > 0 then 'order_date' end, case when p > 0 then 7 else 0 end, 'eta', -10)
    on conflict (name) do nothing;
  end loop;
  update customer_terms ct set payment_term_id = (select id from payment_terms pt where pt.deposit_pct = ct.deposit_pct order by created_at limit 1)
   where ct.payment_term_id is null;
  update sales_orders o set payment_term_id = ct.payment_term_id
    from customer_terms ct
   where o.payment_term_id is null and ct.customer_id = o.customer_id and ct.order_type = o.order_type
     and o.deposit_pct = ct.deposit_pct and ct.payment_term_id is not null;
end $$;
select link_payment_terms();

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
  left join adj  on adj.sales_order_id = o.id
  left join pay  on pay.sales_order_id = o.id
  left join wo   on wo.sales_order_id = o.id
  left join invoices i on i.sales_order_id = o.id
  left join ship on ship.sales_order_id = o.id
  left join payment_terms pt on pt.id = o.payment_term_id
),
calc as (
  select b.*,
    b.order_value + b.adjustments as total_receivable,
    case when b.status = 'cancelled' then 0
         else least(coalesce(b.deposit_amount_fixed, round((b.order_value + b.adjustments) * b.deposit_pct, 2)),
                    greatest(b.order_value + b.adjustments, 0)) end as deposit_due,
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
  (balance_due_date_manual is not null) as balance_due_date_set
from calc2;
-- ---------- order entry: a term can be chosen on the order screen ----------
drop function preview_order(uuid, text, date, jsonb);
-- p_lines: [{"idx":1,"product_id":..,"quantity":..,"unit_price":..,"batch_item_id":..,"cost_override":..}]
create or replace function preview_order(p_customer uuid, p_order_type text, p_po_date date, p_lines jsonb, p_payment_term uuid default null)
returns jsonb language plpgsql volatile set search_path = public as $$
declare oid uuid; result jsonb;
begin
  begin
    insert into sales_orders (customer_id, order_type, po_date, status, payment_term_id) values (p_customer, p_order_type, p_po_date, 'draft', p_payment_term) returning id into oid;
    insert into sales_order_lines (sales_order_id, line_no, product_id, quantity, unit_price, batch_item_id, cost_override)
    select oid, (x ->> 'idx')::int, (x ->> 'product_id')::uuid, (x ->> 'quantity')::numeric, (x ->> 'unit_price')::numeric,
           nullif(x ->> 'batch_item_id', '')::uuid, nullif(x ->> 'cost_override', '')::numeric
      from jsonb_array_elements(coalesce(p_lines, '[]')) x;
    select jsonb_build_object(
      'lines', coalesce((select jsonb_agg(jsonb_build_object('idx', l.line_no, 'unit_cost', l.unit_cost, 'cost_source', l.cost_source, 'cost_basis', l.cost_basis,
                 'below_basis', l.below_basis, 'revenue', l.revenue, 'total_cost', l.total_cost, 'margin', l.margin, 'margin_pct', l.margin_pct) order by l.line_no)
               from v_order_lines l where l.sales_order_id = oid), '[]'),
      'order', (select jsonb_build_object('currency', o.currency, 'order_value', o.order_value, 'total_cost', o.total_cost, 'margin', o.margin,
                 'margin_pct', o.margin_pct, 'cost_missing_lines', o.cost_missing_lines, 'deposit_pct', o.deposit_pct, 'deposit_due', o.deposit_due,
                 'balance_due', o.balance_due, 'payment_term_id', o.payment_term_id, 'payment_term_name', o.payment_term_name,
                 'deposit_due_date', o.deposit_due_date, 'balance_due_date', o.balance_due_date)
               from v_orders o where o.id = oid))
      into result;
    raise exception 'preview_rollback';
  exception when others then
    if sqlerrm <> 'preview_rollback' then raise; end if;
  end;
  return result;
end $$;

-- p_order: {"customer_id","order_type","pi_number","customer_po","po_date","notes","deposit_pct","payment_days","payment_term_id"}
create or replace function create_order(p_order jsonb, p_lines jsonb)
returns text language plpgsql set search_path = public as $$
declare oid uuid; pi text := nullif(trim(p_order ->> 'pi_number'), '');
begin
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then raise exception 'Add at least one order line'; end if;
  insert into sales_orders (customer_id, order_type, pi_number, customer_po, po_date, notes, status, pi_date, deposit_pct, payment_days, payment_term_id)
  values ((p_order ->> 'customer_id')::uuid, p_order ->> 'order_type', pi, nullif(trim(p_order ->> 'customer_po'), ''),
          nullif(p_order ->> 'po_date', '')::date, nullif(p_order ->> 'notes', ''),
          case when pi is null then 'draft' else 'pi_sent' end, case when pi is null then null else app_today() end,
          nullif(p_order ->> 'deposit_pct', '')::numeric, nullif(p_order ->> 'payment_days', '')::int, nullif(p_order ->> 'payment_term_id', '')::uuid)
  returning id into oid;
  insert into sales_order_lines (sales_order_id, line_no, product_id, quantity, unit_price, batch_item_id, cost_override, notes)
  select oid, row_number() over (order by ord), (x ->> 'product_id')::uuid, (x ->> 'quantity')::numeric, (x ->> 'unit_price')::numeric,
         nullif(x ->> 'batch_item_id', '')::uuid, nullif(x ->> 'cost_override', '')::numeric, nullif(x ->> 'notes', '')
    from jsonb_array_elements(p_lines) with ordinality as t(x, ord);
  return coalesce(pi, 'draft-' || left(oid::text, 8));
end $$;

grant execute on function preview_order(uuid, text, date, jsonb, uuid), create_order(jsonb, jsonb) to authenticated;
revoke execute on function preview_order(uuid, text, date, jsonb, uuid) from public;

-- ---------- access and history ----------
alter table payment_terms enable row level security;
grant select, insert, update, delete on payment_terms to authenticated;
create policy read_all on payment_terms for select to authenticated using ((select app_role()) is not null);
create policy write_ops_insert on payment_terms for insert to authenticated with check ((select app_role()) in ('admin','operations'));
create policy write_ops_update on payment_terms for update to authenticated using ((select app_role()) in ('admin','operations')) with check ((select app_role()) in ('admin','operations'));
create policy write_ops_delete on payment_terms for delete to authenticated using ((select app_role()) in ('admin','operations'));
create trigger audit after insert or update or delete on payment_terms for each row execute function trg_audit();
grant select on v_orders to authenticated;
revoke execute on function link_payment_terms() from public;

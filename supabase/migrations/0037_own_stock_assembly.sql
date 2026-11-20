-- =====================================================================
-- 0037: own stock, purchase orders with their own lines, and assembling products from components.
-- 1. batches.own_stock: a batch we bought and paid ourselves. Sales from it need no PO to the supplier
--    (no "sold from NL stock, no PO" item, not under "to pay suppliers"); its cost is the batch's purchase price
--    plus its landed costs. v_order_lines gets own_stock.
-- 2. purchase_order_lines: lines on a PO that are not tied to a sales order (retail boxes, components, own stock,
--    services such as assembling). They count in what the PO costs. receive_po_lines() puts product lines into a
--    new own-stock batch at the PO price (in euros at that day's rate); batch_items.purchase_order_line_id keeps the link.
-- 3. products.unit (pcs or ml); product_recipes: the components per piece of a finished product;
--    assemblies + assemble(): uses chosen component batches (stock adjustments of kind "Assembly"), makes a new
--    own-stock batch of the finished product at the cost of its components, and books the assembler's fee as a
--    landed cost of kind "assembly" on that batch. undo_assembly() reverses one while nothing of it was sold.
--    v_recipe_capacity: how many pieces the components in stock still allow, and which component limits it.
-- Roll back: re-create v_order_lines (0032), v_attention (0036), v_purchase_orders (0023), v_batch_item_stock (0002);
--            drop the new functions, tables and columns.
-- =====================================================================
alter table batches add column own_stock boolean not null default false;

alter table products add column unit text not null default 'pcs' check (unit in ('pcs','ml'));

create table purchase_order_lines (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders (id) on delete cascade,
  line_no           int not null default 1,
  product_id        uuid references products (id),
  description       text,
  quantity          numeric(14,2) not null check (quantity > 0),
  unit_price        numeric(14,4) not null check (unit_price >= 0),
  vat_rate          numeric(5,4) check (vat_rate between 0 and 1),
  notes             text,
  created_at        timestamptz not null default now(),
  check (product_id is not null or length(trim(coalesce(description, ''))) > 0)
);
create index on purchase_order_lines (purchase_order_id);
alter table purchase_order_lines enable row level security;
grant select, insert, update, delete on purchase_order_lines to authenticated;
create policy read_all on purchase_order_lines for select to authenticated using ((select app_role()) is not null);
create policy write_insert on purchase_order_lines for insert to authenticated with check ((select app_role()) in ('admin','operations','finance'));
create policy write_update on purchase_order_lines for update to authenticated using ((select app_role()) in ('admin','operations','finance')) with check ((select app_role()) in ('admin','operations','finance'));
create policy write_delete on purchase_order_lines for delete to authenticated using ((select app_role()) in ('admin','operations','finance'));
create trigger audit after insert or update or delete on purchase_order_lines for each row execute function trg_audit();

alter table batch_items add column purchase_order_line_id uuid references purchase_order_lines (id) on delete set null;

create table product_recipes (
  product_id   uuid not null references products (id) on delete cascade,
  component_id uuid not null references products (id),
  qty_per_unit numeric(14,4) not null check (qty_per_unit > 0),
  notes        text,
  primary key (product_id, component_id),
  check (product_id <> component_id)
);
alter table product_recipes enable row level security;
grant select, insert, update, delete on product_recipes to authenticated;
create policy read_all on product_recipes for select to authenticated using ((select app_role()) is not null);
create policy write_insert on product_recipes for insert to authenticated with check ((select app_role()) in ('admin','operations'));
create policy write_update on product_recipes for update to authenticated using ((select app_role()) in ('admin','operations')) with check ((select app_role()) in ('admin','operations'));
create policy write_delete on product_recipes for delete to authenticated using ((select app_role()) in ('admin','operations'));
create trigger audit after insert or update or delete on product_recipes for each row execute function trg_audit();

create table assemblies (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products (id),
  quantity      int not null check (quantity > 0),
  assembled_on  date not null default app_today(),
  batch_id      uuid not null references batches (id),
  supplier_id   uuid references suppliers (id),
  notes         text,
  created_by    uuid default app_user_id(),
  created_at    timestamptz not null default now()
);
alter table assemblies enable row level security;
grant select, insert, update, delete on assemblies to authenticated;
create policy read_all on assemblies for select to authenticated using ((select app_role()) is not null);
create policy write_insert on assemblies for insert to authenticated with check ((select app_role()) in ('admin','operations'));
create policy write_update on assemblies for update to authenticated using ((select app_role()) in ('admin','operations')) with check ((select app_role()) in ('admin','operations'));
create policy write_delete on assemblies for delete to authenticated using ((select app_role()) in ('admin','operations'));
create trigger audit after insert or update or delete on assemblies for each row execute function trg_audit();

alter table stock_adjustments add column assembly_id uuid references assemblies (id) on delete cascade;
insert into stock_adjustment_kinds (code) values ('Assembly') on conflict do nothing;
alter table landed_costs drop constraint landed_costs_kind_check;
alter table landed_costs add constraint landed_costs_kind_check check (kind in ('freight','duties','insurance','forwarder','inspection','commission','storage','assembly','other'));

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
    coalesce((select sum(x.amount) from order_cost_lines x where x.sales_order_line_id = l.id), 0) + round(coalesce(ll.amount, 0), 2) as extra_costs,
    round(coalesce(ll.amount, 0), 2) as landed_costs, coalesce(ll.fx_missing, false) as landed_fx_missing,
    coalesce(ob.own_stock, false) as own_stock,
    po.currency as po_currency,
    si.amount   as po_invoice_amount
  from sales_order_lines l
  join sales_orders o on o.id = l.sales_order_id
  join order_types  t on t.code = o.order_type
  left join purchase_orders   po on po.id = l.purchase_order_id
  left join supplier_invoices si on si.purchase_order_id = po.id
  left join line_landed() ll on ll.line_id = l.id
  left join batch_items obi on obi.id = l.batch_item_id
  left join batches ob on ob.id = obi.batch_id
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
  (f.unit_cost is not null) as cost_known,
  f.landed_costs, f.landed_fx_missing, f.own_stock
from fixed f;

create or replace view v_batch_item_stock with (security_invoker = true) as
select bi.id as batch_item_id, bi.batch_id, b.batch_number, b.supplier_id, b.received_date,
       bi.product_id, p.name as product_name, bi.qty_received,
       coalesce(adj.qty, 0)  as adjustments,
       coalesce(sold.qty, 0) as sold,
       bi.qty_received + coalesce(adj.qty, 0) - coalesce(sold.qty, 0) as stock,
       case when b.own_stock then 0 else coalesce(sold.qty_no_po, 0) end as sold_without_po,
       b.own_stock
  from batch_items bi
  join batches b  on b.id = bi.batch_id
  join products p on p.id = bi.product_id
  left join (select batch_item_id, sum(quantity) as qty from stock_adjustments group by 1) adj on adj.batch_item_id = bi.id
  left join (select batch_item_id, sum(qty) as qty,
                    sum(qty) filter (where purchase_order_id is null) as qty_no_po
               from v_order_lines where batch_item_id is not null group by 1) sold on sold.batch_item_id = bi.id;

create or replace view v_purchase_orders with (security_invoker = true) as
with sl as (
  select vl.purchase_order_id,
         sum(vl.purchase_value) filter (where vl.counts_for_po) as expected,
         sum(round(vl.purchase_value * coalesce(sl.vat_rate, p.vat_rate, 0), 2)) filter (where vl.counts_for_po) as expected_vat,
         count(*) as line_count,
         string_agg(distinct vl.pi_number, ', ' order by vl.pi_number) as pi_numbers
    from v_order_lines vl join sales_order_lines sl on sl.id = vl.id left join products p on p.id = sl.product_id
   where vl.purchase_order_id is not null group by 1
),
-- 0037: the PO's own lines (stock, components, services), not tied to a sales order
own as (
  select x.purchase_order_id, sum(round(x.quantity * x.unit_price, 2)) as expected,
         sum(round(round(x.quantity * x.unit_price, 2) * coalesce(x.vat_rate, p.vat_rate, 0), 2)) as expected_vat, count(*) as line_count
    from purchase_order_lines x left join products p on p.id = x.product_id group by 1
),
l as (
  select coalesce(sl.purchase_order_id, own.purchase_order_id) as purchase_order_id,
         coalesce(sl.expected, 0) + coalesce(own.expected, 0) as expected,
         coalesce(sl.expected_vat, 0) + coalesce(own.expected_vat, 0) as expected_vat,
         coalesce(sl.line_count, 0) + coalesce(own.line_count, 0) as line_count,
         sl.pi_numbers
    from sl full join own on own.purchase_order_id = sl.purchase_order_id
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

-- what is still to receive per PO line
create view v_purchase_order_lines with (security_invoker = true) as
select x.*, p.name as product_name, p.unit,
       coalesce((select sum(bi.qty_received) from batch_items bi where bi.purchase_order_line_id = x.id), 0) as received,
       round(x.quantity * x.unit_price, 2) as amount
  from purchase_order_lines x left join products p on p.id = x.product_id;
grant select on v_purchase_order_lines to authenticated;

-- put received PO lines into a new own-stock batch; p_lines = [{line_id, qty}]
create or replace function receive_po_lines(p_po uuid, p_batch_number text, p_received date, p_lines jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare po record; bid uuid; r record; rate numeric;
begin
  select * into po from purchase_orders where id = p_po;
  if not found then raise exception 'Purchase order not found'; end if;
  if nullif(trim(p_batch_number), '') is null then raise exception 'Give the batch a number'; end if;
  if exists (select 1 from batches where batch_number = trim(p_batch_number)) then raise exception 'Batch % already exists', trim(p_batch_number); end if;
  rate := case when po.currency = 'EUR' then 1 else fx_convert(1, po.currency, 'EUR', coalesce(p_received, app_today())) end;
  if rate is null then raise exception 'No exchange rate % → EUR for %', po.currency, coalesce(p_received, app_today()); end if;
  insert into batches (batch_number, supplier_id, reference, received_date, own_stock)
  values (trim(p_batch_number), po.supplier_id, 'PO ' || po.po_number, coalesce(p_received, app_today()), true) returning id into bid;
  -- one batch line per product (several PO lines of one product are added up, at their average price)
  for r in
    select x.product_id, min(x.id::text)::uuid as line_id, sum((j ->> 'qty')::numeric) as qty,
           sum((j ->> 'qty')::numeric * x.unit_price) / nullif(sum((j ->> 'qty')::numeric), 0) as price
      from jsonb_array_elements(p_lines) j join purchase_order_lines x on x.id = (j ->> 'line_id')::uuid
     where x.purchase_order_id = p_po and (j ->> 'qty')::numeric > 0
     group by x.product_id
  loop
    if r.product_id is null then raise exception 'A line without a product (a service) cannot go into stock'; end if;
    insert into batch_items (batch_id, product_id, qty_received, cost_basis, purchase_order_line_id)
    values (bid, r.product_id, round(r.qty)::int, round(r.price * rate, 4), r.line_id);
  end loop;
  if not exists (select 1 from batch_items where batch_id = bid) then raise exception 'Nothing to receive'; end if;
  return bid;
end $$;
grant execute on function receive_po_lines(uuid, text, date, jsonb) to authenticated;

-- cost per piece of a batch line in euros: purchase price + landed costs per piece (null when the price is unknown)
create or replace function batch_item_unit_cost(p_item uuid) returns numeric
language sql stable security invoker set search_path = public as $$
  select bi.cost_basis + coalesce((select l.per_unit_eur from v_batch_landed l where l.batch_item_id = bi.id), 0)
    from batch_items bi where bi.id = p_item
$$;

-- assemble p_qty pieces of p_product from chosen component batches; p_inputs = [{batch_item_id, qty}]
create or replace function assemble(p_product uuid, p_qty int, p_batch_number text, p_date date, p_inputs jsonb,
                                    p_supplier uuid default null, p_cost numeric default null, p_currency text default 'EUR',
                                    p_invoice text default null, p_notes text default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare bid uuid; aid uuid; r record; total numeric := 0; missing text; d date := coalesce(p_date, app_today()); ref text;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'How many pieces are assembled?'; end if;
  if nullif(trim(p_batch_number), '') is null then raise exception 'Give the batch a number'; end if;
  if exists (select 1 from batches where batch_number = trim(p_batch_number)) then raise exception 'Batch % already exists', trim(p_batch_number); end if;
  if not exists (select 1 from product_recipes where product_id = p_product) then raise exception 'This product has no recipe yet'; end if;
  -- every component of the recipe must be used
  select string_agg(c.name, ', ') into missing
    from product_recipes pr join products c on c.id = pr.component_id
   where pr.product_id = p_product
     and not exists (select 1 from jsonb_array_elements(p_inputs) j join batch_items bi on bi.id = (j ->> 'batch_item_id')::uuid
                      where bi.product_id = pr.component_id and (j ->> 'qty')::numeric > 0);
  if missing is not null then raise exception 'Choose a batch for: %', missing; end if;
  -- enough in stock in each chosen batch, and only components of the recipe
  for r in
    select bi.id, p.name, s.batch_number, s.stock, sum((j ->> 'qty')::numeric) as qty, bi.product_id
      from jsonb_array_elements(p_inputs) j join batch_items bi on bi.id = (j ->> 'batch_item_id')::uuid
      join products p on p.id = bi.product_id join v_batch_item_stock s on s.batch_item_id = bi.id
     where (j ->> 'qty')::numeric > 0 group by bi.id, p.name, s.batch_number, s.stock, bi.product_id
  loop
    if not exists (select 1 from product_recipes where product_id = p_product and component_id = r.product_id) then
      raise exception '% is not in the recipe', r.name; end if;
    if r.qty > r.stock then raise exception 'Batch % has only % of % in stock (% needed)', r.batch_number, r.stock, r.name, r.qty; end if;
    if r.qty <> round(r.qty) then raise exception 'Use whole numbers for %', r.name; end if;
    total := total + r.qty * coalesce(batch_item_unit_cost(r.id), 0);
  end loop;

  insert into batches (batch_number, supplier_id, reference, received_date, own_stock, notes)
  values (trim(p_batch_number), p_supplier, 'Assembly', d, true, p_notes) returning id into bid;
  insert into batch_items (batch_id, product_id, qty_received, cost_basis)
  values (bid, p_product, p_qty, round(total / p_qty, 4));
  insert into assemblies (product_id, quantity, assembled_on, batch_id, supplier_id, notes)
  values (p_product, p_qty, d, bid, p_supplier, p_notes) returning id into aid;
  ref := 'Assembly ' || trim(p_batch_number);
  insert into stock_adjustments (adjustment_date, batch_item_id, kind, quantity, reference, assembly_id)
  select d, (j ->> 'batch_item_id')::uuid, 'Assembly', -round((j ->> 'qty')::numeric)::int, ref, aid
    from jsonb_array_elements(p_inputs) j where (j ->> 'qty')::numeric > 0;
  -- the assembler's fee is part of what a piece costs
  if coalesce(p_cost, 0) <> 0 then
    insert into landed_costs (batch_id, kind, description, supplier_id, invoice_number, invoice_date, amount, currency, allocate_by)
    values (bid, 'assembly', 'Assembling ' || p_qty || ' pcs', p_supplier, nullif(trim(p_invoice), ''), d, p_cost, coalesce(p_currency, 'EUR'), 'quantity');
  end if;
  return bid;
end $$;
grant execute on function assemble(uuid, int, text, date, jsonb, uuid, numeric, text, text, text) to authenticated;

-- undo an assembly while nothing of it was sold: the components go back into their batches
create or replace function undo_assembly(p_assembly uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare a record;
begin
  select * into a from assemblies where id = p_assembly;
  if not found then raise exception 'Assembly not found'; end if;
  if exists (select 1 from sales_order_lines l join batch_items bi on bi.id = l.batch_item_id where bi.batch_id = a.batch_id) then
    raise exception 'Pieces of this batch are already sold; it cannot be undone';
  end if;
  if exists (select 1 from stock_adjustments s join batch_items bi on bi.id = s.batch_item_id where bi.batch_id = a.batch_id) then
    raise exception 'This batch already has stock corrections; remove those first';
  end if;
  delete from assemblies where id = p_assembly;          -- removes the component adjustments too
  delete from landed_costs where batch_id = a.batch_id;
  delete from batches where id = a.batch_id;
end $$;
grant execute on function undo_assembly(uuid) to authenticated;

-- assemblies with what they used and what a piece cost
create view v_assemblies with (security_invoker = true) as
select a.id, a.product_id, p.name as product_name, a.quantity, a.assembled_on, a.batch_id, b.batch_number, a.supplier_id, s.name as supplier_name, a.notes, a.created_at,
       bi.cost_basis as components_per_unit, coalesce(l.per_unit_eur, 0) as fee_per_unit, bi.cost_basis + coalesce(l.per_unit_eur, 0) as cost_per_unit,
       (select string_agg(cp.name || ' ' || (-sa.quantity) || ' from ' || cb.batch_number, ', ' order by cp.name)
          from stock_adjustments sa join batch_items cbi on cbi.id = sa.batch_item_id join batches cb on cb.id = cbi.batch_id join products cp on cp.id = cbi.product_id
         where sa.assembly_id = a.id) as used
  from assemblies a join products p on p.id = a.product_id join batches b on b.id = a.batch_id
  left join batch_items bi on bi.batch_id = a.batch_id and bi.product_id = a.product_id
  left join v_batch_landed l on l.batch_item_id = bi.id
  left join suppliers s on s.id = a.supplier_id;
grant select on v_assemblies to authenticated;

-- per finished product: how many pieces the components in stock still allow, and which component limits it
create view v_recipe_capacity with (security_invoker = true) as
with c as (
  select pr.product_id, pr.component_id, cp.name as component_name, cp.unit, pr.qty_per_unit,
         coalesce(st.stock, 0) as stock, floor(coalesce(st.stock, 0) / pr.qty_per_unit) as pieces
    from product_recipes pr join products cp on cp.id = pr.component_id
    left join v_product_stock st on st.product_id = pr.component_id
)
select distinct on (c.product_id) c.product_id, c.pieces::int as can_make, c.component_name as limited_by, c.component_id as limited_by_id
  from c order by c.product_id, c.pieces, c.component_name;
grant select on v_recipe_capacity to authenticated;

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
  from v_order_doc_slots d where d.due_now and d.state = 'missing' and d.status not in ('completed','cancelled');

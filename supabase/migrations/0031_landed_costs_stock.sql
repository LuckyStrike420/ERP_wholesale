-- =====================================================================
-- 0031: full cost price per order, and real stock management for NL stock.
-- Landed costs
-- - landed_costs: freight, duties, insurance, forwarder, inspection, commission, storage or other costs, on a shipment
--   (spread over the orders on it), on one order, or on a stock batch (spread over its products, then per piece
--   sold from it). Spread by value, quantity, volume (cbm) or weight; when volume or weight is missing for a
--   line, that cost is spread by quantity. Other currencies at the ECB rate of the invoice date.
-- - v_landed_cost_allocation (cost → order line), v_batch_landed (per piece of a batch product), v_line_landed.
-- - v_order_lines: extra_costs now includes them (so total cost, margin and margin % do); new columns at the end:
--   landed_costs, landed_fx_missing.
-- Stock
-- - products.min_stock; v_product_stock gets min_stock, sold_90d, below_min.
-- - stock_on(date): quantity, cost and value per batch product on a date (purchase price + landed costs per piece).
-- - stock_counts / stock_count_lines: a count with counted quantities; book_stock_count() books the differences
--   as 'Telling' corrections on the count date.
-- Roll back: re-create v_order_lines from 0007 and v_product_stock from 0002; drop the new tables, views, functions
--            and products.min_stock.
-- =====================================================================

-- ---------- landed costs ----------
create table landed_costs (
  id             uuid primary key default gen_random_uuid(),
  shipment_id    uuid references shipments on delete cascade,
  sales_order_id uuid references sales_orders on delete cascade,
  batch_id       uuid references batches on delete cascade,
  kind           text not null check (kind in ('freight','duties','insurance','forwarder','inspection','commission','storage','other')),
  description    text,
  supplier_id    uuid references suppliers on delete set null,
  invoice_number text,
  invoice_date   date,
  amount         numeric(14,2) not null check (amount <> 0),
  currency       char(3) not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  allocate_by    text not null default 'value' check (allocate_by in ('value','quantity','volume','weight')),
  created_by     uuid default app_user_id(),
  created_at     timestamptz not null default now(),
  check (num_nonnulls(shipment_id, sales_order_id, batch_id) = 1)
);
create index on landed_costs (shipment_id); create index on landed_costs (sales_order_id); create index on landed_costs (batch_id);
create trigger audit after insert or update or delete on landed_costs for each row execute function trg_audit();
create trigger recycle before delete on landed_costs for each row execute function trg_recycle();

-- a cost in another currency, at the rate of its date (fx_rate gives 1 unit in the reporting currency)
create or replace function fx_convert(p_amount numeric, p_from text, p_to text, p_date date) returns numeric
language sql stable as $$
  select case when p_from = p_to then p_amount
              else p_amount * fx_rate(p_from::char(3), p_date) / nullif(fx_rate(p_to::char(3), p_date), 0) end
$$;

create view v_landed_cost_allocation with (security_invoker = true) as
with tgt as (
  select c.id as cost_id, l.id as line_id, l.sales_order_id, t.currency as order_currency,
         case when o.status = 'cancelled' then 0 else l.quantity - l.quantity_cancelled end as q,
         l.unit_price, p.units_per_carton, p.carton_length_cm, p.carton_width_cm, p.carton_height_cm, p.carton_weight_kg,
         c.amount, c.currency, c.allocate_by, coalesce(c.invoice_date, o.po_date, app_today()) as cost_date
    from landed_costs c
    join sales_orders o on o.id = c.sales_order_id
                        or (c.shipment_id is not null and o.id in (select so.sales_order_id from shipment_orders so where so.shipment_id = c.shipment_id))
    join order_types t on t.code = o.order_type
    join sales_order_lines l on l.sales_order_id = o.id
    join products p on p.id = l.product_id
   where c.batch_id is null
), w as (
  select t.*,
    case t.allocate_by
      when 'quantity' then t.q::numeric
      when 'value'    then t.q * t.unit_price * coalesce(fx_rate(t.order_currency::char(3), t.cost_date), 1)
      when 'volume'   then ceil(t.q::numeric / nullif(t.units_per_carton, 0)) * t.carton_length_cm * t.carton_width_cm * t.carton_height_cm / 1000000
      when 'weight'   then ceil(t.q::numeric / nullif(t.units_per_carton, 0)) * t.carton_weight_kg end as w
  from tgt t
), w2 as (
  select w.*, bool_or(w.w is null and w.q > 0) over (partition by w.cost_id) as incomplete,
         sum(coalesce(w.w, 0)) over (partition by w.cost_id) as wsum, sum(w.q) over (partition by w.cost_id) as qsum,
         count(*) over (partition by w.cost_id) as n
  from w
), share as (
  select w2.*,
    case when not w2.incomplete and w2.wsum > 0 then coalesce(w2.w, 0) / w2.wsum
         when w2.qsum > 0 then w2.q::numeric / w2.qsum else 1.0 / w2.n end as part,
    case when w2.incomplete or w2.wsum <= 0 then 'quantity' else w2.allocate_by end as basis_used
  from w2
)
select cost_id, line_id, sales_order_id, part, basis_used, currency as cost_currency, order_currency,
       round(amount * part, 4) as amount_cost_currency,
       round(fx_convert(amount * part, currency, order_currency, cost_date), 4) as amount,
       (currency <> order_currency and fx_convert(1, currency, order_currency, cost_date) is null) as fx_missing
  from share;

create view v_batch_landed with (security_invoker = true) as
with tgt as (
  select c.id as cost_id, bi.id as batch_item_id, bi.qty_received as q, bi.cost_basis,
         p.units_per_carton, p.carton_length_cm, p.carton_width_cm, p.carton_height_cm, p.carton_weight_kg,
         c.amount, c.currency, c.allocate_by, coalesce(c.invoice_date, b.received_date, app_today()) as cost_date
    from landed_costs c join batch_items bi on bi.batch_id = c.batch_id join batches b on b.id = bi.batch_id join products p on p.id = bi.product_id
), w as (
  select t.*,
    case t.allocate_by
      when 'quantity' then t.q::numeric
      when 'value'    then t.q * t.cost_basis
      when 'volume'   then ceil(t.q::numeric / nullif(t.units_per_carton, 0)) * t.carton_length_cm * t.carton_width_cm * t.carton_height_cm / 1000000
      when 'weight'   then ceil(t.q::numeric / nullif(t.units_per_carton, 0)) * t.carton_weight_kg end as w
  from tgt t
), w2 as (
  select w.*, bool_or(w.w is null and w.q > 0) over (partition by w.cost_id) as incomplete,
         sum(coalesce(w.w, 0)) over (partition by w.cost_id) as wsum, sum(w.q) over (partition by w.cost_id) as qsum, count(*) over (partition by w.cost_id) as n
  from w
), share as (
  select w2.*, case when not w2.incomplete and w2.wsum > 0 then coalesce(w2.w, 0) / w2.wsum when w2.qsum > 0 then w2.q::numeric / w2.qsum else 1.0 / w2.n end as part
  from w2
)
select batch_item_id,
       round(sum(fx_convert(amount * part, currency, 'EUR', cost_date)), 2) as total_eur,
       case when max(q) > 0 then round(sum(fx_convert(amount * part, currency, 'EUR', cost_date)) / max(q), 4) end as per_unit_eur,
       bool_or(currency <> 'EUR' and fx_convert(1, currency, 'EUR', cost_date) is null) as fx_missing
  from share group by batch_item_id;

-- per order line: its share of shipment / order costs, plus pieces sold from a batch × landed cost per piece
create view v_line_landed with (security_invoker = true) as
select line_id, sum(amount) as amount, bool_or(fx_missing) as fx_missing from (
  select line_id, amount, fx_missing from v_landed_cost_allocation
  union all
  select l.id, (case when o.status = 'cancelled' then 0 else l.quantity - l.quantity_cancelled end)
               * fx_convert(bl.per_unit_eur, 'EUR', t.currency, coalesce(l.line_date, o.po_date, app_today())),
         bl.fx_missing
    from sales_order_lines l join sales_orders o on o.id = l.sales_order_id join order_types t on t.code = o.order_type
    join v_batch_landed bl on bl.batch_item_id = l.batch_item_id
) x group by line_id;

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
    po.currency as po_currency,
    si.amount   as po_invoice_amount
  from sales_order_lines l
  join sales_orders o on o.id = l.sales_order_id
  join order_types  t on t.code = o.order_type
  left join purchase_orders   po on po.id = l.purchase_order_id
  left join supplier_invoices si on si.purchase_order_id = po.id
  left join v_line_landed ll on ll.line_id = l.id
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
  f.landed_costs, f.landed_fx_missing
from fixed f;

alter table landed_costs enable row level security;
grant select, insert, update, delete on landed_costs to authenticated;
create policy read_all on landed_costs for select to authenticated using ((select app_role()) is not null);
create policy write_insert on landed_costs for insert to authenticated with check ((select app_role()) in ('admin','operations','finance'));
create policy write_update on landed_costs for update to authenticated using ((select app_role()) in ('admin','operations','finance')) with check ((select app_role()) in ('admin','operations','finance'));
create policy write_delete on landed_costs for delete to authenticated using ((select app_role()) in ('admin','operations','finance'));
grant select on v_landed_cost_allocation, v_batch_landed, v_line_landed to authenticated;

-- the recycle bin knows landed costs too
create or replace function recycle_tables() returns text[] language sql immutable as $$
  select array['sales_orders','sales_order_lines','order_cost_lines','order_adjustments','approvals','tasks','record_notes','generated_documents','attachments','landed_costs']
$$;

-- ---------- stock ----------
alter table products add column min_stock int check (min_stock >= 0);

create or replace view v_product_stock with (security_invoker = true) as
select p.id as product_id, p.name as product_name,
       coalesce(sum(s.qty_received + s.adjustments), 0) as received_and_adjusted,
       coalesce(sum(s.sold), 0) as sold_from_stock,
       coalesce(sum(s.stock), 0) as stock,
       p.min_stock,
       coalesce((select sum(l.quantity - l.quantity_cancelled) from sales_order_lines l join sales_orders o on o.id = l.sales_order_id
                  join batch_items bi on bi.id = l.batch_item_id
                 where bi.product_id = p.id and o.status <> 'cancelled' and coalesce(l.line_date, o.po_date) > app_today() - 90), 0) as sold_90d,
       (p.min_stock is not null and coalesce(sum(s.stock), 0) < p.min_stock) as below_min
  from products p left join v_batch_item_stock s on s.product_id = p.id
 group by p.id;

-- quantity and value per batch product on a date
create or replace function stock_on(p_date date)
returns table (batch_item_id uuid, batch_id uuid, batch_number text, product_id uuid, product_name text,
               qty numeric, purchase_price numeric, landed_per_unit numeric, unit_value numeric, value numeric)
language sql stable security invoker set search_path = public as $$
  select bi.id, b.id, b.batch_number, p.id, p.name,
         q.qty, bi.cost_basis, coalesce(bl.per_unit_eur, 0),
         bi.cost_basis + coalesce(bl.per_unit_eur, 0),
         round(q.qty * (bi.cost_basis + coalesce(bl.per_unit_eur, 0)), 2)
    from batch_items bi join batches b on b.id = bi.batch_id join products p on p.id = bi.product_id
    left join v_batch_landed bl on bl.batch_item_id = bi.id
    cross join lateral (select
        (case when coalesce(b.received_date, p_date) <= p_date then bi.qty_received else 0 end)
      + coalesce((select sum(a.quantity) from stock_adjustments a where a.batch_item_id = bi.id and coalesce(a.adjustment_date, p_date) <= p_date), 0)
      - coalesce((select sum(l.quantity - l.quantity_cancelled) from sales_order_lines l join sales_orders o on o.id = l.sales_order_id
                   where l.batch_item_id = bi.id and o.status <> 'cancelled' and coalesce(l.line_date, o.po_date, p_date) <= p_date), 0) as qty) q
$$;
grant execute on function stock_on(date) to authenticated;

create table stock_counts (
  id         uuid primary key default gen_random_uuid(),
  count_date date not null default app_today(),
  notes      text,
  status     text not null default 'open' check (status in ('open','booked')),
  booked_at  timestamptz,
  created_by uuid default app_user_id(),
  created_at timestamptz not null default now()
);
create table stock_count_lines (
  count_id      uuid not null references stock_counts on delete cascade,
  batch_item_id uuid not null references batch_items on delete cascade,
  counted       int check (counted >= 0),
  expected      numeric,
  primary key (count_id, batch_item_id)
);
create trigger audit after insert or update or delete on stock_counts for each row execute function trg_audit();

create or replace function book_stock_count(p_count uuid) returns int
language plpgsql security invoker set search_path = public as $$
declare c stock_counts; n int := 0; r record;
begin
  select * into c from stock_counts where id = p_count for update;
  if not found then raise exception 'Count not found'; end if;
  if c.status = 'booked' then raise exception 'This count is booked already'; end if;
  for r in select cl.batch_item_id, cl.counted, s.qty as expected from stock_count_lines cl
             join stock_on(c.count_date) s on s.batch_item_id = cl.batch_item_id
            where cl.count_id = p_count and cl.counted is not null loop
    update stock_count_lines set expected = r.expected where count_id = p_count and batch_item_id = r.batch_item_id;
    if r.counted <> r.expected then
      insert into stock_adjustments (adjustment_date, batch_item_id, kind, quantity, reference, notes)
      values (c.count_date, r.batch_item_id, 'Telling', r.counted - r.expected, 'Count ' || to_char(c.count_date, 'DD-MM-YYYY'), c.notes);
      n := n + 1;
    end if;
  end loop;
  update stock_counts set status = 'booked', booked_at = now() where id = p_count;
  return n;
end $$;

alter table stock_counts enable row level security;
alter table stock_count_lines enable row level security;
grant select, insert, update, delete on stock_counts, stock_count_lines to authenticated;
create policy read_all on stock_counts for select to authenticated using ((select app_role()) is not null);
create policy write_insert on stock_counts for insert to authenticated with check ((select app_role()) in ('admin','operations'));
create policy write_update on stock_counts for update to authenticated using ((select app_role()) in ('admin','operations')) with check ((select app_role()) in ('admin','operations'));
create policy write_delete on stock_counts for delete to authenticated using ((select app_role()) in ('admin','operations') and status = 'open');
create policy read_all on stock_count_lines for select to authenticated using ((select app_role()) is not null);
create policy write_insert on stock_count_lines for insert to authenticated with check ((select app_role()) in ('admin','operations'));
create policy write_update on stock_count_lines for update to authenticated using ((select app_role()) in ('admin','operations')) with check ((select app_role()) in ('admin','operations'));
create policy write_delete on stock_count_lines for delete to authenticated using ((select app_role()) in ('admin','operations'));
grant execute on function book_stock_count(uuid) to authenticated;

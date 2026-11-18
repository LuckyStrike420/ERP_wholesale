-- 0032: keep the landed-cost calculation out of the planner's way.
-- v_order_lines is inlined in almost every money view (orders, attention, open items, cash flow, health, targets ...).
-- Joining v_line_landed there inlined two allocation queries with window functions into each of them,
-- which made every view much heavier to plan; a burst of them after saving an order timed out.
-- A plpgsql set-returning function is never inlined: it is planned once, on its own, and run once per query.
create or replace function line_landed()
returns table (line_id uuid, amount numeric, fx_missing boolean)
language plpgsql stable security invoker set search_path = public
rows 50
as $$
begin
  return query select v.line_id, v.amount, v.fx_missing from v_line_landed v;
end $$;
grant execute on function line_landed() to authenticated;

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
  left join line_landed() ll on ll.line_id = l.id
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

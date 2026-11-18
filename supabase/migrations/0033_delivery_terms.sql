-- =====================================================================
-- 0033: delivery terms (incoterms) per order, separate from the order type.
-- The order type (EXW / FOB) stays what it was: where the goods come from and in which currency.
-- The delivery term says who arranges and pays the transport: EXW, FCA, FOB (customer) or DAP, DDP (we do).
-- - customers.default_incoterm: the customer's usual term, filled in on new orders
-- - sales_orders.incoterm + delivery_place: per order; empty on older orders = same as the order type
-- - v_order_delivery: the term per order and whether a DAP/DDP order still lacks a transport cost
--   (freight or forwarder cost on the order or its shipment, or an old freight cost line)
-- - Attention item and order flag "Transport cost missing" for those orders (not for drafts or cancelled orders)
-- Roll back: re-create v_attention (0010), v_order_flags (0019) and create_order (0022), drop v_order_delivery,
--            the trigger and the three columns.
-- =====================================================================
alter table customers add column default_incoterm text check (default_incoterm in ('EXW','FCA','FOB','DAP','DDP'));
alter table sales_orders add column incoterm text check (incoterm in ('EXW','FCA','FOB','DAP','DDP'));
alter table sales_orders add column delivery_place text;

-- a new order gets the customer's usual term, otherwise the term that matches its type
create or replace function trg_order_incoterm() returns trigger language plpgsql set search_path = public as $$
begin
  if new.incoterm is null then
    select c.default_incoterm into new.incoterm from customers c where c.id = new.customer_id;
    new.incoterm := coalesce(new.incoterm, new.order_type);
  end if;
  return new;
end $$;
create trigger order_incoterm before insert on sales_orders for each row execute function trg_order_incoterm();

create view v_order_delivery with (security_invoker = true) as
select o.id as sales_order_id, o.pi_number, o.status,
       coalesce(o.incoterm, o.order_type) as incoterm, o.delivery_place,
       coalesce(o.incoterm, o.order_type) in ('DAP','DDP') as we_arrange_transport,
       t.has_cost as has_transport_cost,
       (coalesce(o.incoterm, o.order_type) in ('DAP','DDP') and o.status not in ('draft','cancelled') and not t.has_cost) as transport_missing
  from sales_orders o
  cross join lateral (select
       exists (select 1 from landed_costs c where c.sales_order_id = o.id and c.kind in ('freight','forwarder'))
    or exists (select 1 from landed_costs c join shipment_orders so on so.shipment_id = c.shipment_id
                where so.sales_order_id = o.id and c.kind in ('freight','forwarder'))
    or exists (select 1 from order_cost_lines x join sales_order_lines l on l.id = x.sales_order_line_id
                where l.sales_order_id = o.id and x.kind = 'freight') as has_cost) t;
grant select on v_order_delivery to authenticated;

create or replace function create_order(p_order jsonb, p_lines jsonb)
returns text language plpgsql set search_path = public as $$
declare oid uuid; pi text := nullif(trim(p_order ->> 'pi_number'), '');
begin
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then raise exception 'Add at least one order line'; end if;
  -- saved as a draft first; with a PI number it then moves to PI sent, unless the margin needs approval
  insert into sales_orders (customer_id, order_type, pi_number, customer_po, po_date, notes, status, deposit_pct, payment_days, payment_term_id, incoterm, delivery_place)
  values ((p_order ->> 'customer_id')::uuid, p_order ->> 'order_type', pi, nullif(trim(p_order ->> 'customer_po'), ''),
          nullif(p_order ->> 'po_date', '')::date, nullif(p_order ->> 'notes', ''), 'draft',
          nullif(p_order ->> 'deposit_pct', '')::numeric, nullif(p_order ->> 'payment_days', '')::int, nullif(p_order ->> 'payment_term_id', '')::uuid,
          nullif(p_order ->> 'incoterm', ''), nullif(trim(p_order ->> 'delivery_place'), ''))
  returning id into oid;
  insert into sales_order_lines (sales_order_id, line_no, product_id, quantity, unit_price, batch_item_id, cost_override, notes)
  select oid, row_number() over (order by ord), (x ->> 'product_id')::uuid, (x ->> 'quantity')::numeric, (x ->> 'unit_price')::numeric,
         nullif(x ->> 'batch_item_id', '')::uuid, nullif(x ->> 'cost_override', '')::numeric, nullif(x ->> 'notes', '')
    from jsonb_array_elements(p_lines) with ordinality as t(x, ord);
  if pi is not null then
    if exists (select 1 from v_order_approval where sales_order_id = oid and not approved_valid) then perform request_approval(oid, null);
    else update sales_orders set status = 'pi_sent', pi_date = app_today() where id = oid; end if;
  end if;
  return coalesce(pi, 'draft-' || left(oid::text, 8));
end $$;

create or replace view v_order_flags with (security_invoker = true) as
select o.id as sales_order_id, o.pi_number, r.id as rule_id, r.name as rule_name,
       replace(replace(replace(r.flag_text, '{pi}', coalesce(o.pi_number, 'draft')), '{customer}', o.customer_name), '{margin}', coalesce(round(o.margin_pct * 100, 1)::text || '%', '?')) as flag_text
  from automation_rules r cross join v_orders o
 where r.active and r.action = 'flag' and automation_match(r, o)
union all
select d.sales_order_id, d.pi_number, null::uuid, 'Delivery terms', 'Transport cost missing (' || d.incoterm || ')'
  from v_order_delivery d where d.transport_missing;

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
  from ol l where l.batch_item_id is not null and l.purchase_order_id is null and l.qty > 0
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
  from v_order_delivery d where d.transport_missing;


-- =====================================================================
-- 0008: cost history and settings (audit package 2: OMS-009, 010, 025, 026)
-- Nothing in the data is changed. New rules apply to new and changed rows only.
--  * settings are validated (type and range) and their effect can be previewed without saving
--  * an order's cost prices become final when it is completed (as they already do on a supplier invoice)
--  * the effect of a new cost rule can be previewed without saving
--  * price agreements for the same product, customer, type and price cannot overlap in time
--  * a warning when an order quantity is below the MOQ of the agreement that applies (MOQ never changes a price)
--  * the choice of cost source can be explained
-- Roll back: drop the triggers and functions below, re-apply setting_num and v_attention of 0002/0007.
-- =====================================================================

-- ---------- OMS-010: valid settings only ----------
create or replace function validate_setting(p_key text, p_value text) returns void
language plpgsql stable set search_path = public as $$
declare n numeric;
begin
  if p_key in ('cost_decimals', 'payment_tolerance', 'exw_reminder_working_days', 'fob_balance_days_before_eta') then
    if p_value is null or p_value !~ '^\s*\d+(\.\d+)?\s*$' then
      raise exception 'Setting %: "%" is not a valid number', p_key, p_value;
    end if;
    n := p_value::numeric;
    if p_key = 'cost_decimals' and (n <> trunc(n) or n > 6) then
      raise exception 'Setting cost_decimals must be a whole number from 0 to 6';
    elsif p_key = 'payment_tolerance' and n > 1 then
      raise exception 'Setting payment_tolerance must be between 0 and 1';
    elsif p_key = 'exw_reminder_working_days' and (n <> trunc(n) or n > 60) then
      raise exception 'Setting exw_reminder_working_days must be a whole number from 0 to 60';
    elsif p_key = 'fob_balance_days_before_eta' and (n <> trunc(n) or n > 365) then
      raise exception 'Setting fob_balance_days_before_eta must be a whole number from 0 to 365';
    end if;
  elsif p_key = 'reporting_currency' then
    if not exists (select 1 from order_types where currency = p_value) then
      raise exception 'Setting reporting_currency must be one of the order currencies (%)', (select string_agg(distinct currency, ', ') from order_types);
    end if;
  end if;
end $$;

create or replace function trg_app_setting_check() returns trigger language plpgsql set search_path = public as $$
begin perform validate_setting(new.key, new.value); return new; end $$;
create trigger app_setting_check before insert or update on app_settings for each row execute function trg_app_setting_check();

-- a setting can be overridden for the length of one transaction (used only by the preview below)
create or replace function setting_num(p_key text) returns numeric
language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('app.override_' || p_key, true), '')::numeric,
                  (select value::numeric from app_settings where key = p_key))
$$;

create or replace function setting_metrics() returns table (metric text, currency char(3), v numeric)
language sql stable set search_path = public as $$
  select 'margin_not_final'::text, l.currency, coalesce(sum(l.margin), 0) from v_order_lines l
   where not l.cost_is_final and l.status not in ('draft', 'cancelled') group by l.currency
  union all select 'orders_overdue', o.currency, count(*) filter (where o.overdue_amount > 0) from v_orders o group by o.currency
  union all select 'overdue_amount', o.currency, coalesce(sum(o.overdue_amount), 0) from v_orders o group by o.currency
  union all select 'reminders_due', o.currency, count(*) filter (where o.reminder_due) from v_orders o group by o.currency
  union all select 'orders_paid', o.currency, count(*) filter (where o.payment_status = 'paid') from v_orders o group by o.currency
$$;

-- what would change if this setting had this value? Nothing is saved.
create or replace function preview_setting_change(p_key text, p_value text)
returns table (metric text, currency char(3), value_before numeric, value_after numeric)
language plpgsql volatile set search_path = public as $$
declare b jsonb; a jsonb;
begin
  perform validate_setting(p_key, p_value);
  if p_key = 'reporting_currency' then return; end if;      -- only the combined total in reports changes
  select coalesce(jsonb_agg(jsonb_build_object('m', s.metric, 'c', s.currency, 'v', s.v)), '[]') into b from setting_metrics() s;
  perform set_config('app.override_' || p_key, p_value, true);
  select coalesce(jsonb_agg(jsonb_build_object('m', s.metric, 'c', s.currency, 'v', s.v)), '[]') into a from setting_metrics() s;
  perform set_config('app.override_' || p_key, '', true);
  return query
    select y.m, y.c::char(3), x.v, y.v
      from jsonb_to_recordset(a) as y(m text, c text, v numeric)
      left join jsonb_to_recordset(b) as x(m text, c text, v numeric) on x.m = y.m and x.c = y.c
     where x.v is distinct from y.v;
end $$;

-- ---------- OMS-009: final cost prices when an order is completed ----------
create or replace function trg_freeze_on_complete() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update sales_order_lines l
       set frozen_unit_cost = v.unit_cost, frozen_cost_source = v.cost_source,
           frozen_royalty = v.royalty_per_unit, cost_frozen_at = now()
      from v_order_lines v
     where v.id = l.id and l.sales_order_id = new.id
       and l.frozen_unit_cost is null and v.unit_cost is not null;
  end if;
  return new;
end $$;
create trigger sales_order_freeze_on_complete before update on sales_orders for each row execute function trg_freeze_on_complete();
revoke execute on function trg_app_setting_check(), trg_freeze_on_complete() from authenticated;

-- which orders would get another margin if this cost rule were saved? Rolled back, nothing is saved.
create or replace function preview_cost_rule_change(
  p_product uuid, p_order_type text, p_valid_from date,
  p_cost_basis numeric, p_share numeric, p_royalty numeric)
returns table (sales_order_id uuid, pi_number text, customer_name text, status text, revenue_date date,
               qty numeric, margin_before numeric, margin_after numeric)
language plpgsql volatile set search_path = public as $$
declare b jsonb; a jsonb;
begin
  select coalesce(jsonb_object_agg(l.id::text, l.margin), '{}') into b from v_order_lines l
   where l.product_id = p_product and l.order_type = p_order_type and l.status <> 'cancelled' and not l.cost_is_final;
  begin
    insert into product_cost_rules (product_id, order_type, valid_from, cost_basis, share_above_basis, royalty_per_unit)
    values (p_product, p_order_type, p_valid_from, p_cost_basis, p_share, p_royalty)
    on conflict (product_id, order_type, valid_from)
    do update set cost_basis = excluded.cost_basis, share_above_basis = excluded.share_above_basis, royalty_per_unit = excluded.royalty_per_unit;
    select coalesce(jsonb_object_agg(l.id::text, l.margin), '{}') into a from v_order_lines l
     where l.product_id = p_product and l.order_type = p_order_type and l.status <> 'cancelled' and not l.cost_is_final;
    raise exception 'preview_rollback';
  exception when others then
    if sqlerrm <> 'preview_rollback' then raise; end if;
  end;
  return query
    select l.sales_order_id, l.pi_number::text, o.customer_name::text, l.status::text, l.revenue_date::date, l.qty::numeric,
           (b ->> l.id::text)::numeric, (a ->> l.id::text)::numeric
      from v_order_lines l join v_orders o on o.id = l.sales_order_id
     where a ? l.id::text and (b ->> l.id::text)::numeric is distinct from (a ->> l.id::text)::numeric
     order by l.revenue_date, l.pi_number;
end $$;

-- ---------- OMS-026: no overlapping agreements for the same product, customer, type and price ----------
create or replace function trg_price_agreement_check() returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from price_agreements a
              where a.id <> new.id and a.product_id = new.product_id and a.order_type = new.order_type
                and a.customer_id is not distinct from new.customer_id
                and round(a.sale_price, 4) = round(new.sale_price, 4)
                and coalesce(a.valid_from, date '-infinity') <= coalesce(new.valid_to, date 'infinity')
                and coalesce(new.valid_from, date '-infinity') <= coalesce(a.valid_to, date 'infinity')) then
    raise exception 'Another agreement for this product, customer, type and price already covers (part of) this period. Change the dates of one of them.';
  end if;
  return new;
end $$;
create trigger price_agreement_check before insert or update on price_agreements for each row execute function trg_price_agreement_check();
revoke execute on function trg_price_agreement_check() from authenticated;

-- ---------- OMS-025: explain the choice of cost price ----------
create or replace function explain_unit_cost(
  p_product uuid, p_customer uuid, p_order_type text, p_unit_price numeric,
  p_batch_item uuid, p_override numeric, p_date date)
returns table (step int, source text, applies boolean, detail text)
language plpgsql stable set search_path = public as $$
declare chosen text; cost numeric; bi record; ag record; r record; others text;
begin
  select c.cost_source, c.unit_cost into chosen, cost from calc_unit_cost(p_product, p_customer, p_order_type, p_unit_price, p_batch_item, p_override, p_date) c;

  step := 1; source := 'override'; applies := chosen = 'override';
  detail := case when p_override is not null then 'A cost price was entered on this line: ' || p_override else 'No cost price entered on the line.' end;
  return next;

  step := 2; source := 'batch'; applies := chosen = 'batch';
  if p_order_type <> 'EXW' then detail := 'Batch costs only apply to EXW orders.';
  elsif p_batch_item is null then detail := 'No NL-stock batch chosen on this line.';
  else
    select * into bi from batch_items where id = p_batch_item;
    detail := case when bi.cost_basis is not null or bi.share_above_basis is not null then 'The chosen batch has its own cost basis ' || coalesce(bi.cost_basis::text, '–') else 'The chosen batch has no cost basis.' end;
  end if;
  return next;

  step := 3; source := 'agreement'; applies := chosen = 'agreement';
  select a.agreed_cost, a.sale_price, a.customer_id into ag from price_agreements a
   where a.product_id = p_product and a.order_type = p_order_type and a.agreed_cost is not null
     and round(a.sale_price, 4) = round(p_unit_price, 4) and (a.customer_id = p_customer or a.customer_id is null)
     and (a.valid_from is null or p_date is null or a.valid_from <= p_date) and (a.valid_to is null or p_date is null or a.valid_to >= p_date)
   order by (a.customer_id is null), a.valid_from desc nulls last limit 1;
  if found then
    detail := 'A ' || case when ag.customer_id is null then 'standard' else 'customer' end || ' agreement exists for exactly this price: purchase price ' || ag.agreed_cost || '.';
  else
    select string_agg(distinct round(a.sale_price, 4)::text, ', ') into others from price_agreements a
     where a.product_id = p_product and a.order_type = p_order_type and a.agreed_cost is not null and (a.customer_id = p_customer or a.customer_id is null)
       and (a.valid_from is null or p_date is null or a.valid_from <= p_date) and (a.valid_to is null or p_date is null or a.valid_to >= p_date);
    detail := case when others is null then 'No price agreement with a purchase price applies on this date.'
                   else 'Agreements exist at sale price ' || others || ', but not at exactly ' || round(p_unit_price, 4) || ': the price must match exactly.' end;
  end if;
  return next;

  step := 4; source := 'product_rule'; applies := chosen = 'product_rule';
  select * into r from product_cost_rules x
   where x.product_id = p_product and x.order_type = p_order_type and x.valid_from <= coalesce(p_date, app_today())
   order by x.valid_from desc limit 1;
  detail := case when found then 'Product rule from ' || r.valid_from || ': basis ' || coalesce(r.cost_basis::text, '–') || ', share above basis ' || coalesce((r.share_above_basis * 100)::text || '%', '–')
                 else 'No product cost rule for this type on this date.' end;
  return next;

  step := 5; source := coalesce(chosen, 'none'); applies := cost is not null;
  detail := case when cost is null then 'Purchase price is missing.' else 'Result: purchase price ' || cost || ' per piece (' || chosen || ').' end;
  return next;
end $$;

grant execute on function validate_setting(text, text), setting_metrics(), preview_setting_change(text, text),
  preview_cost_rule_change(uuid, text, date, numeric, numeric, numeric),
  explain_unit_cost(uuid, uuid, text, numeric, uuid, numeric, date) to authenticated;
revoke execute on function validate_setting(text, text), setting_metrics(), preview_setting_change(text, text),
  preview_cost_rule_change(uuid, text, date, numeric, numeric, numeric),
  explain_unit_cost(uuid, uuid, text, numeric, uuid, numeric, date) from public;

-- ---------- OMS-025: MOQ is a warning, never a price ----------
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
select 'warning', 'below_moq', 'sales_order_lines', l.id, coalesce(l.pi_number, 'draft'),
       'Quantity ' || l.qty || ' is below the MOQ of ' || m.moq || ' in the price agreement for ' || p.name
  from v_order_lines l join products p on p.id = l.product_id
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
  from v_orders o
 where o.status in ('shipped','delivered')
   and not exists (select 1 from shipment_orders x where x.sales_order_id = o.id);

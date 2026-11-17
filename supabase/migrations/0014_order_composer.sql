-- =====================================================================
-- 0014: order entry on one screen (ideas from EspoCRM Sales Orders) and the PI document
--  * products get a standard sale price per order type: the fallback when no price agreement applies
--  * suggest_sale_price: customer agreement > standard agreement > product standard price > nothing
--    (agreements with a MOQ act as quantity breaks: the highest MOQ the quantity reaches wins)
--  * preview_order: the figures of an order that is not saved yet, from the same views as a real order
--  * create_order: the order and all its lines in one transaction
--  * customers get an address; company details for the PI live in the settings
-- Nothing existing changes. Roll back: drop the three functions, the three columns and the company_* settings.
-- =====================================================================
alter table products add column sale_price_exw numeric(14,4) check (sale_price_exw >= 0);
alter table products add column sale_price_fob numeric(14,4) check (sale_price_fob >= 0);
alter table customers add column address text;

insert into app_settings (key, value, description) values
  ('company_name',    '', 'PI document: company name'),
  ('company_address', '', 'PI document: company address (one line per line)'),
  ('company_vat',     '', 'PI document: VAT number and chamber of commerce number'),
  ('company_bank',    '', 'PI document: bank details (bank, IBAN, BIC; one line per line)'),
  ('company_contact', '', 'PI document: e-mail and phone'),
  ('pi_footer',       '', 'PI document: extra text at the bottom (terms, validity)')
on conflict (key) do nothing;

create or replace function suggest_sale_price(p_product uuid, p_customer uuid, p_order_type text, p_date date, p_qty numeric)
returns table (sale_price numeric, source text, moq int)
language plpgsql stable set search_path = public as $$
begin
  return query
    select a.sale_price, case when a.customer_id is null then 'standard_agreement' else 'customer_agreement' end, a.moq
      from price_agreements a
     where a.product_id = p_product and a.order_type = p_order_type
       and (a.customer_id = p_customer or a.customer_id is null)
       and (a.valid_from is null or p_date is null or a.valid_from <= p_date)
       and (a.valid_to   is null or p_date is null or a.valid_to   >= p_date)
       and (a.moq is null or p_qty is null or p_qty >= a.moq)
     order by (a.customer_id is null), coalesce(a.moq, 0) desc, a.valid_from desc nulls last
     limit 1;
  if found then return; end if;
  return query
    select case p_order_type when 'EXW' then p.sale_price_exw else p.sale_price_fob end, 'product_price'::text, null::int
      from products p where p.id = p_product
       and case p_order_type when 'EXW' then p.sale_price_exw else p.sale_price_fob end is not null;
end $$;

-- p_lines: [{"idx":1,"product_id":..,"quantity":..,"unit_price":..,"batch_item_id":..,"cost_override":..}]
create or replace function preview_order(p_customer uuid, p_order_type text, p_po_date date, p_lines jsonb)
returns jsonb language plpgsql volatile set search_path = public as $$
declare oid uuid; result jsonb;
begin
  begin
    insert into sales_orders (customer_id, order_type, po_date, status) values (p_customer, p_order_type, p_po_date, 'draft') returning id into oid;
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
                 'balance_due', o.balance_due)
               from v_orders o where o.id = oid))
      into result;
    raise exception 'preview_rollback';
  exception when others then
    if sqlerrm <> 'preview_rollback' then raise; end if;
  end;
  return result;
end $$;

-- p_order: {"customer_id","order_type","pi_number","customer_po","po_date","notes","deposit_pct","payment_days"}
create or replace function create_order(p_order jsonb, p_lines jsonb)
returns text language plpgsql set search_path = public as $$
declare oid uuid; pi text := nullif(trim(p_order ->> 'pi_number'), '');
begin
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then raise exception 'Add at least one order line'; end if;
  insert into sales_orders (customer_id, order_type, pi_number, customer_po, po_date, notes, status, pi_date, deposit_pct, payment_days)
  values ((p_order ->> 'customer_id')::uuid, p_order ->> 'order_type', pi, nullif(trim(p_order ->> 'customer_po'), ''),
          nullif(p_order ->> 'po_date', '')::date, nullif(p_order ->> 'notes', ''),
          case when pi is null then 'draft' else 'pi_sent' end, case when pi is null then null else app_today() end,
          nullif(p_order ->> 'deposit_pct', '')::numeric, nullif(p_order ->> 'payment_days', '')::int)
  returning id into oid;
  insert into sales_order_lines (sales_order_id, line_no, product_id, quantity, unit_price, batch_item_id, cost_override, notes)
  select oid, row_number() over (order by ord), (x ->> 'product_id')::uuid, (x ->> 'quantity')::numeric, (x ->> 'unit_price')::numeric,
         nullif(x ->> 'batch_item_id', '')::uuid, nullif(x ->> 'cost_override', '')::numeric, nullif(x ->> 'notes', '')
    from jsonb_array_elements(p_lines) with ordinality as t(x, ord);
  return coalesce(pi, 'draft-' || left(oid::text, 8));
end $$;

grant execute on function suggest_sale_price(uuid, uuid, text, date, numeric), preview_order(uuid, text, date, jsonb), create_order(jsonb, jsonb) to authenticated;
revoke execute on function suggest_sale_price(uuid, uuid, text, date, numeric), preview_order(uuid, text, date, jsonb), create_order(jsonb, jsonb) from public;

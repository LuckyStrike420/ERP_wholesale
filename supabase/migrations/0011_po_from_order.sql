-- =====================================================================
-- 0011: create the purchase order for a sales order in one step
-- Creates the PO (currency and deposit from the supplier's terms, as for any new PO) and links the chosen
-- order lines to it, in one transaction: either both happen or nothing does.
-- Roll back: drop function create_po_for_order.
-- =====================================================================
create or replace function create_po_for_order(
  p_order uuid, p_po_number text, p_supplier uuid, p_po_date date, p_lines uuid[], p_notes text default null)
returns text language plpgsql set search_path = public as $$
declare o record; po_id uuid; n int;
begin
  select so.id, so.order_type, so.status, so.pi_number into o from sales_orders so where so.id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if o.status in ('completed', 'cancelled') then raise exception 'A % order cannot get a new PO', o.status; end if;
  if coalesce(trim(p_po_number), '') = '' then raise exception 'PO# is required'; end if;
  if p_supplier is null then raise exception 'Choose the supplier'; end if;
  if coalesce(array_length(p_lines, 1), 0) = 0 then raise exception 'Choose at least one order line for this PO'; end if;
  select count(*) into n from sales_order_lines l where l.id = any(p_lines) and l.sales_order_id = p_order and l.purchase_order_id is null;
  if n <> array_length(p_lines, 1) then raise exception 'One of the chosen lines does not belong to this order or already has a PO'; end if;

  insert into purchase_orders (po_number, supplier_id, order_type, po_date, notes)
  values (trim(p_po_number), p_supplier, o.order_type, p_po_date,
          coalesce(p_notes, 'Created from PI ' || coalesce(o.pi_number, 'draft')))
  returning id into po_id;
  update sales_order_lines set purchase_order_id = po_id where id = any(p_lines);
  return trim(p_po_number);
end $$;
grant execute on function create_po_for_order(uuid, text, uuid, date, uuid[], text) to authenticated;
revoke execute on function create_po_for_order(uuid, text, uuid, date, uuid[], text) from public;

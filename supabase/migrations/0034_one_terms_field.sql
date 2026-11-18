-- =====================================================================
-- 0034: one place for the terms of an order.
-- The order screen now asks only for the terms (FOB, EXW, FCA, DAP, DDP); the order type follows from it:
-- FOB → FOB (China, dollars), all others → EXW (NL stock, euros). Everything that ran on the order type
-- (currency, stock, purchase prices, payment terms, price agreements) keeps working as before.
-- The trigger keeps the two in step for every way an order is written (screens, imports, scripts):
--   a new or changed term sets the type; a changed type alone resets the term to the plain EXW / FOB;
--   a new order without a term gets the customer's usual term when it fits the type, else the type.
-- Roll back: re-create trg_order_incoterm and the insert-only trigger from 0033.
-- =====================================================================
create or replace function trg_order_incoterm() returns trigger language plpgsql set search_path = public as $$
declare usual text;
begin
  if tg_op = 'INSERT' and new.incoterm is null then
    select c.default_incoterm into usual from customers c where c.id = new.customer_id;
    new.incoterm := case when usual is not null and (usual = 'FOB') = (new.order_type = 'FOB') then usual else new.order_type end;
  elsif tg_op = 'UPDATE' and new.incoterm is not distinct from old.incoterm and new.order_type is distinct from old.order_type then
    new.incoterm := new.order_type;
  end if;
  if new.incoterm is not null then
    new.order_type := case when new.incoterm = 'FOB' then 'FOB' else 'EXW' end;
  end if;
  return new;
end $$;
drop trigger order_incoterm on sales_orders;
create trigger order_incoterm before insert or update of incoterm, order_type on sales_orders
  for each row execute function trg_order_incoterm();

-- =====================================================================
-- 0024: switching VAT on or off on an order whose PI is out recalculates the deposit fixed on that PI
-- (the deposit is a % of the total, and the total now includes or leaves out VAT).
-- Roll back: drop trigger vat_deposit on sales_orders; drop function trg_vat_deposit().
-- =====================================================================
create or replace function trg_vat_deposit() returns trigger language plpgsql as $$
begin
  if new.vat_applies is distinct from old.vat_applies and new.deposit_amount is not null then
    update sales_orders s set deposit_amount = (select round(v.total_receivable * v.deposit_pct, 2) from v_orders v where v.id = new.id)
     where s.id = new.id;
  end if;
  return null;
end $$;
create trigger vat_deposit after update of vat_applies on sales_orders for each row execute function trg_vat_deposit();

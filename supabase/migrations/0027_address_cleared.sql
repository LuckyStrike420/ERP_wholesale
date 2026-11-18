-- =====================================================================
-- 0027: clearing every address field also clears the address (0026 only rebuilt it when a part was filled).
-- Roll back: re-create trg_party_location from 0026.
-- =====================================================================
create or replace function trg_party_location() returns trigger language plpgsql as $$
begin
  new.country := country_name(new.country);
  if coalesce(new.street, new.street2, new.postal_code, new.city) is not null
     or (tg_op = 'UPDATE' and coalesce(old.street, old.street2, old.postal_code, old.city) is not null) then
    new.address := nullif(concat_ws(E'\n', nullif(trim(new.street), ''), nullif(trim(new.street2), ''),
                                    nullif(trim(concat_ws(' ', nullif(trim(new.postal_code), ''), nullif(trim(new.city), ''))), '')), '');
  end if;
  return new;
end $$;

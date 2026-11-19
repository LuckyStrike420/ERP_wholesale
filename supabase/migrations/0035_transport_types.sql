-- =====================================================================
-- 0035: transport types for shipments, and documents that follow them.
-- A shipment was always a container. Now it has a type, and only the fields of that type are asked:
--   sea_container  forwarder, container, seal, B/L, ports, ETD/ETA (as before)
--   sea_lcl        forwarder, pallets, B/L or HBL, ports, ETD/ETA
--   road           carrier, CMR number, pallets, loading date (etd), delivery date (eta)
--   pickup         collected by, vehicle plate, CMR number, pick-up date (etd): the customer collects from our warehouse
--   courier        FedEx / UPS / DHL / PostNL / other with a tracking number, sent (etd), delivered (eta)
-- ETD/ETA keep their meaning for the status (planned, in transit, arrived); a pick-up is "collected" once its date has passed.
-- Packing list / delivery note: terms are the real terms with place (e.g. "DDP Hamburg"), and the transport block follows
-- the type; without a shipment the terms decide (EXW/FCA → pick-up from our warehouse, DAP/DDP → road, FOB → container).
-- New setting warehouse_address: where customers collect.
-- Roll back: re-create v_shipments and draft_document from 0026, drop the new columns and the setting.
-- =====================================================================
alter table shipments add column mode text not null default 'sea_container'
  check (mode in ('sea_container','sea_lcl','road','pickup','courier'));
alter table shipments add column carrier text;
alter table shipments add column tracking_number text;
alter table shipments add column cmr_number text;
alter table shipments add column pallets int check (pallets >= 0);
alter table shipments add column collected_by text;
alter table shipments add column vehicle_plate text;

insert into app_settings (key, value, description) values
  ('warehouse_address', E'De Langkamp 6\n3961 MS Wijk bij Duurstede\nThe Netherlands', 'Warehouse address where customers collect (EXW / FCA); printed on packing lists and delivery notes')
on conflict (key) do nothing;

create or replace view v_shipments with (security_invoker = true) as
select s.id, s.forwarder, s.container_number, s.bl_number, s.port_loading, s.port_discharge, s.ready_date, s.etd, s.eta, s.docs_complete, s.notes,
  case when s.mode = 'pickup' and s.etd is not null and s.etd <= app_today() then 'collected'
       when s.eta is not null and s.eta <= app_today() then 'arrived'
       when s.etd is not null and s.etd <= app_today() then 'in_transit'
       when s.etd is not null or s.eta is not null   then 'planned'
       else 'awaiting_info' end as status,
  (select string_agg(o.pi_number, ', ') from shipment_orders x join sales_orders o on o.id = x.sales_order_id where x.shipment_id = s.id) as pi_numbers,
  (select string_agg(po.po_number, ', ') from shipment_orders x join purchase_orders po on po.id = x.purchase_order_id where x.shipment_id = s.id) as po_numbers,
  s.port_loading_country, s.port_discharge_country,
  s.mode, s.carrier, s.tracking_number, s.cmr_number, s.pallets, s.collected_by, s.vehicle_plate
from shipments s;

create or replace function draft_document(p_order uuid, p_type text) returns jsonb
language plpgsql stable set search_path = public as $$
declare o record; c record; sh record; n int; base text; result jsonb; mode text;
begin
  if p_type not in ('packing_list','delivery_note') then raise exception 'Unknown document type %', p_type; end if;
  select * into o from sales_orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  select * into c from customers where id = o.customer_id;
  select s.* into sh from shipment_orders so join shipments s on s.id = so.shipment_id where so.sales_order_id = p_order limit 1;
  -- how it travels: the shipment's type, or, without a shipment, what the terms say (EXW/FCA: the customer collects)
  mode := coalesce(sh.mode, case when coalesce(o.incoterm, o.order_type) in ('EXW','FCA') then 'pickup'
                                 when coalesce(o.incoterm, o.order_type) in ('DAP','DDP') then 'road' else 'sea_container' end);
  base := case p_type when 'packing_list' then 'PL-' else 'DN-' end || coalesce(o.pi_number, 'draft-' || left(o.id::text, 8));
  select count(*) into n from generated_documents where doc_type = p_type and doc_number like base || '%';
  select jsonb_build_object(
    'doc_type', p_type,
    'doc_number', base || case when n > 0 then '-' || (n + 1) else '' end,
    'doc_date', app_today(),
    'shipment_id', sh.id,
    'header', jsonb_build_object(
      'shipper', concat_ws(E'\n', nullif((select value from app_settings where key = 'company_name'), ''), nullif((select value from app_settings where key = 'company_address'), '')),
      'consignee', concat_ws(E'\n', c.name, nullif(c.address, ''), c.country),
      -- collected from our warehouse: the buyer is not an address we deliver to
      'deliver_to', case when mode = 'pickup' then null else concat_ws(E'\n', c.name, nullif(c.address, ''), c.country) end,
      'pickup_address', case when mode = 'pickup' then concat_ws(E'\n', nullif((select value from app_settings where key = 'company_name'), ''), nullif((select value from app_settings where key = 'warehouse_address'), '')) end,
      'pi_number', o.pi_number, 'customer_po', o.customer_po,
      'terms', concat_ws(' ', coalesce(o.incoterm, o.order_type), nullif(o.delivery_place, '')),
      'mode', mode,
      'forwarder', coalesce(sh.forwarder, sh.carrier), 'carrier', sh.carrier, 'tracking_number', sh.tracking_number,
      'cmr_number', sh.cmr_number, 'pallets', sh.pallets, 'collected_by', sh.collected_by, 'vehicle_plate', sh.vehicle_plate,
      'container_number', sh.container_number, 'seal_number', null, 'bl_number', sh.bl_number,
      'port_loading', nullif(concat_ws(', ', sh.port_loading, sh.port_loading_country), ''), 'port_discharge', nullif(concat_ws(', ', sh.port_discharge, sh.port_discharge_country), ''), 'etd', to_char(sh.etd, 'FMDD Mon YYYY'), 'eta', to_char(sh.eta, 'FMDD Mon YYYY'),
      'shipping_marks', null, 'notes', null),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', p.id, 'description', p.name, 'sku', p.sku, 'qty', l.quantity - l.quantity_cancelled,
               'units_per_carton', p.units_per_carton, 'net_kg_carton', p.carton_net_kg, 'gross_kg_carton', p.carton_weight_kg,
               'length_cm', p.carton_length_cm, 'width_cm', p.carton_width_cm, 'height_cm', p.carton_height_cm,
               'cartons', null, 'net_kg', null, 'gross_kg', null, 'cbm', null, 'remarks', null) order by l.line_no)
        from sales_order_lines l join products p on p.id = l.product_id
       where l.sales_order_id = p_order and l.quantity - l.quantity_cancelled > 0), '[]'))
  into result;
  return result;
end $$;

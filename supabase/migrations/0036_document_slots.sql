-- =====================================================================
-- 0036: document slots per order ("hokjes").
-- doc_slots: the documents an order needs, per terms, from which status, and where the file lives
--   (on the order, on its shipment so every order in a container shares it, or on its purchase order).
--   Managed in Admin → Document slots.
-- attachments.slot: which slot a file fills (older files get it from their type).
-- order_doc_waivers: a slot marked "not needed" for one order, with a reason.
-- v_order_doc_slots: per order and slot: present (uploaded or made in the app), waived or missing, and whether it is needed by now.
-- Attention item "… missing" for a needed slot; validation rules can require a slot (requirement "doc:<slot>").
-- Roll back: re-create v_attention (0033), requirement_met (0030) and the requirement check; drop the view,
--            order_doc_waivers, attachments.slot and doc_slots.
-- =====================================================================
create table doc_slots (
  code          text primary key check (code ~ '^[a-z0-9_]+$'),
  label         text not null check (length(trim(label)) > 0),
  terms         text[] not null default '{FOB,EXW,FCA,DAP,DDP}' check (terms <@ array['FOB','EXW','FCA','DAP','DDP']),
  required_from text references order_statuses (code) check (required_from is null or required_from not in ('draft','cancelled')),
  stored_on     text not null default 'order' check (stored_on in ('order','shipment','purchase_order')),
  made_in_app   text check (made_in_app in ('packing_list','delivery_note','invoice')),
  sort          int not null default 100,
  active        boolean not null default true,
  hint          text
);
alter table doc_slots enable row level security;
grant select, insert, update, delete on doc_slots to authenticated;
create policy read_all on doc_slots for select to authenticated using ((select app_role()) is not null);
create policy write_admin_insert on doc_slots for insert to authenticated with check ((select app_role()) = 'admin');
create policy write_admin_update on doc_slots for update to authenticated using ((select app_role()) = 'admin') with check ((select app_role()) = 'admin');
create policy write_admin_delete on doc_slots for delete to authenticated using ((select app_role()) = 'admin');
create trigger audit after insert or update or delete on doc_slots for each row execute function trg_audit();

insert into doc_slots (code, label, terms, required_from, stored_on, made_in_app, sort, hint) values
  ('customer_po',        'Customer PO',             '{FOB,EXW,FCA,DAP,DDP}', 'pi_sent',       'order',          null,           10, 'The purchase order the customer sent us'),
  ('pi_signed',          'PI (signed)',             '{FOB,EXW,FCA,DAP,DDP}', 'po_received',   'order',          null,           20, 'Our PI, signed by the customer'),
  ('supplier_pi',        'Supplier PI',             '{FOB,EXW,FCA,DAP,DDP}', 'in_production', 'purchase_order', null,           30, 'Kept on the purchase order, so every order on that PO shares it'),
  ('commercial_invoice', 'Commercial invoice',      '{FOB,EXW,FCA,DAP,DDP}', 'shipped',       'order',          'invoice',      40, 'Counts as present once the invoice is registered in the app'),
  ('packing_list',       'Packing list',            '{FOB,EXW,FCA,DAP,DDP}', 'ready_to_ship', 'order',          'packing_list', 50, 'Counts as present once a packing list is saved in the app'),
  ('bl',                 'BL',                      '{FOB}',                 'shipped',       'shipment',       null,           60, 'Kept on the shipment, so every order in the container shares it'),
  ('cmr',                'CMR / waybill',           '{EXW,FCA,DAP,DDP}',     'shipped',       'shipment',       null,           70, 'Kept on the shipment or pick-up'),
  ('pol',                'POL / proof of delivery', '{EXW,FCA,DAP,DDP}',     'delivered',     'order',          null,           80, 'Signed by the customer: proof the goods left the Netherlands or arrived'),
  ('transport_invoice',  'Transport invoice',       '{DAP,DDP}',             'delivered',     'order',          null,           90, 'The forwarder''s or carrier''s invoice'),
  ('payment_proof',      'Payment proof',           '{FOB,EXW,FCA,DAP,DDP}', null,            'order',          null,          100, null),
  ('certificate',        'Certificates / test report', '{FOB,EXW,FCA,DAP,DDP}', null,         'order',          null,          110, null),
  ('other',              'Other',                   '{FOB,EXW,FCA,DAP,DDP}', null,            'order',          null,          900, 'Anything else');

alter table attachments add column slot text references doc_slots (code) on update cascade on delete set null;
create index on attachments (slot);
update attachments set slot = case doc_type
    when 'Customer PO' then 'customer_po' when 'PI' then 'pi_signed' when 'Supplier PI' then 'supplier_pi'
    when 'Commercial invoice' then 'commercial_invoice' when 'Packing list' then 'packing_list' when 'BL' then 'bl'
    when 'Certificate' then 'certificate' when 'Payment proof' then 'payment_proof' else 'other' end
 where slot is null;

create table order_doc_waivers (
  sales_order_id uuid not null references sales_orders (id) on delete cascade,
  slot           text not null references doc_slots (code) on update cascade on delete cascade,
  reason         text not null check (length(trim(reason)) > 0),
  waived_by      uuid default app_user_id(),
  waived_at      timestamptz not null default now(),
  primary key (sales_order_id, slot)
);
alter table order_doc_waivers enable row level security;
grant select, insert, update, delete on order_doc_waivers to authenticated;
create policy read_all on order_doc_waivers for select to authenticated using ((select app_role()) is not null);
create policy write_all_insert on order_doc_waivers for insert to authenticated with check ((select app_role()) is not null);
create policy write_all_update on order_doc_waivers for update to authenticated using ((select app_role()) is not null) with check ((select app_role()) is not null);
create policy write_all_delete on order_doc_waivers for delete to authenticated using ((select app_role()) is not null);
create trigger audit after insert or update or delete on order_doc_waivers for each row execute function trg_audit();

create view v_order_doc_slots with (security_invoker = true) as
select o.id as sales_order_id, o.pi_number, o.status, ds.code, ds.label, ds.sort, ds.stored_on, ds.made_in_app, ds.hint,
       ds.required_from, rs.label as required_from_label, rs.rank as required_rank,
       (ds.required_from is not null) as is_required,
       (ds.required_from is not null and os.rank >= rs.rank and o.status <> 'cancelled') as due_now,
       f.files, m.made, w.reason as waived_reason,
       case when f.files > 0 or m.made then 'present' when w.sales_order_id is not null then 'waived' else 'missing' end as state
  from sales_orders o
  join order_statuses os on os.code = o.status
  join doc_slots ds on ds.active and coalesce(o.incoterm, o.order_type) = any (ds.terms)
  left join order_statuses rs on rs.code = ds.required_from
  left join order_doc_waivers w on w.sales_order_id = o.id and w.slot = ds.code
  cross join lateral (select count(*)::int as files from attachments a where a.slot = ds.code and (
         (a.entity_table = 'sales_orders' and a.entity_id = o.id)
      or (a.entity_table = 'shipments' and a.entity_id in (select x.shipment_id from shipment_orders x where x.sales_order_id = o.id))
      or (a.entity_table = 'purchase_orders' and a.entity_id in (select l.purchase_order_id from sales_order_lines l where l.sales_order_id = o.id and l.purchase_order_id is not null)))) f
  cross join lateral (select case ds.made_in_app
         when 'invoice' then exists (select 1 from invoices i where i.sales_order_id = o.id)
         when 'packing_list' then exists (select 1 from generated_documents g where g.sales_order_id = o.id and g.doc_type = 'packing_list')
         when 'delivery_note' then exists (select 1 from generated_documents g where g.sales_order_id = o.id and g.doc_type = 'delivery_note')
         else false end as made) m;
grant select on v_order_doc_slots to authenticated;

alter table validation_rules drop constraint validation_rules_requirement_check;
alter table validation_rules add constraint validation_rules_requirement_check check (requirement in ('customer_po','pi_number','po_date','payment_term','customer_address','customer_vat',
                 'lines_have_po','cost_complete','shipment_linked','container_number','bl_number','etd','eta','docs_complete',
                 'deposit_paid','fully_paid','invoice') or requirement ~ '^doc:[a-z0-9_]+$');

create or replace function requirement_met(p_order uuid, p_req text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare o v_orders; c customers; s shipments; tol numeric := setting_num('payment_tolerance');
begin
  select * into o from v_orders where id = p_order;
  select * into c from customers where id = o.customer_id;
  select sh.* into s from shipment_orders so join shipments sh on sh.id = so.shipment_id where so.sales_order_id = p_order limit 1;
  return case p_req
    when 'customer_po'      then nullif(trim(o.customer_po), '') is not null
    when 'pi_number'        then nullif(trim(o.pi_number), '') is not null
    when 'po_date'          then o.po_date is not null
    when 'payment_term'     then o.payment_term_id is not null
    when 'customer_address' then nullif(trim(c.address), '') is not null
    when 'customer_vat'     then nullif(trim(c.vat_number), '') is not null
    when 'lines_have_po'    then not exists (select 1 from sales_order_lines l where l.sales_order_id = p_order and l.quantity - l.quantity_cancelled > 0 and l.purchase_order_id is null)
    when 'cost_complete'    then o.cost_missing_lines = 0
    when 'shipment_linked'  then s.id is not null
    when 'container_number' then nullif(trim(s.container_number), '') is not null
    when 'bl_number'        then nullif(trim(s.bl_number), '') is not null
    when 'etd'              then o.etd is not null
    when 'eta'              then o.eta is not null
    when 'docs_complete'    then coalesce(s.docs_complete, false)
    when 'deposit_paid'     then o.deposit_outstanding <= tol
    when 'fully_paid'       then o.outstanding <= tol
    when 'invoice'          then o.invoice_number is not null
    -- doc:<slot>: the document is there (uploaded or made in the app) or marked "not needed"; a slot that is not for this order's terms is met
    else case when p_req like 'doc:%' then not exists (select 1 from v_order_doc_slots d where d.sales_order_id = p_order and d.code = substr(p_req, 5) and d.state = 'missing')
              else true end end;
end $$;

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
  from v_order_delivery d where d.transport_missing
-- 0036: a document that is needed by now and not uploaded (and not marked "not needed")
union all
select 'warning', 'document_missing', 'sales_orders', d.sales_order_id, coalesce(d.pi_number, 'draft'), d.label || ' missing'
  from v_order_doc_slots d where d.due_now and d.state = 'missing' and d.status not in ('completed','cancelled');

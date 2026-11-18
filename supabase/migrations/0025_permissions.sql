-- =====================================================================
-- 0025: finer permissions per role, on top of the role rules from 0003 (they can only take rights away).
-- - role_permissions: per role (finance, operations) and permission: allowed or not. Admin may always do everything.
-- - can(p): may the signed-in user do p? Database work without a user (cron, imports, tests) may.
-- - The database enforces the write permissions (payments, prices, purchasing, deleting).
--   "see_costs" hides purchase prices, costs and margins in the app; the database still serves them to the role.
-- - Every role starts with every permission, so nothing changes until an admin switches something off.
-- Roll back: drop the permission triggers, functions can/require_permission/trg_*_permission and table role_permissions.
-- =====================================================================
create table role_permissions (
  role       text not null check (role in ('finance','operations')),
  permission text not null check (permission in ('see_costs','edit_prices','register_payments','pay_suppliers','manage_purchasing','delete_records','export_data')),
  allowed    boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (role, permission)
);
create trigger touch before update on role_permissions for each row execute function trg_touch_updated_at();
create trigger audit after insert or update or delete on role_permissions for each row execute function trg_audit();
insert into role_permissions (role, permission)
select r, p from unnest(array['finance','operations']) r,
  unnest(array['see_costs','edit_prices','register_payments','pay_suppliers','manage_purchasing','delete_records','export_data']) p;

create or replace function can(p text) returns boolean language sql stable security definer set search_path = public as $$
  select case when app_user_id() is null then true
              when app_role() = 'admin' then true
              when app_role() is null then false
              else coalesce((select allowed from role_permissions where role = app_role() and permission = p), false) end
$$;

create or replace function require_permission(p text, what text) returns void language plpgsql stable as $$
begin
  if not can(p) then raise exception 'Your role (%) may not %. An admin can change this under Admin → Permissions.', coalesce(app_role(), 'none'), what; end if;
end $$;

-- generic: TG_ARGV[0] = permission, TG_ARGV[1] = what is being done (for the message)
create or replace function trg_require_permission() returns trigger language plpgsql as $$
begin
  perform require_permission(tg_argv[0], tg_argv[1]);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- payments: in = customer payments, out = supplier payments
create or replace function trg_payment_permission() returns trigger language plpgsql as $$
declare d text := case when tg_op = 'DELETE' then old.direction else new.direction end;
begin
  if d = 'in' then perform require_permission('register_payments', 'register or change customer payments');
  else perform require_permission('pay_suppliers', 'register or change supplier payments'); end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger permission before insert or update or delete on payments for each row execute function trg_payment_permission();

-- prices
create trigger permission before insert or update or delete on price_agreements for each row execute function trg_require_permission('edit_prices', 'change price agreements');
create trigger permission_price before update of unit_price on sales_order_lines for each row
  when (new.unit_price is distinct from old.unit_price) execute function trg_require_permission('edit_prices', 'change sale prices on orders');
create trigger permission_price before update of sale_price_fob, sale_price_exw on products for each row
  when (new.sale_price_fob is distinct from old.sale_price_fob or new.sale_price_exw is distinct from old.sale_price_exw)
  execute function trg_require_permission('edit_prices', 'change standard sale prices');

-- purchasing
create trigger permission before insert or update or delete on purchase_orders for each row execute function trg_require_permission('manage_purchasing', 'create or change purchase orders');
create trigger permission before insert or update or delete on supplier_invoices for each row execute function trg_require_permission('manage_purchasing', 'register supplier invoices');

-- deleting
create trigger permission_delete before delete on sales_orders for each row execute function trg_require_permission('delete_records', 'delete orders');
create trigger permission_delete before delete on sales_order_lines for each row execute function trg_require_permission('delete_records', 'delete order lines');
create trigger permission_delete before delete on attachments for each row execute function trg_require_permission('delete_records', 'delete documents');
create trigger permission_delete before delete on generated_documents for each row execute function trg_require_permission('delete_records', 'delete documents');
create trigger permission_delete before delete on customers for each row execute function trg_require_permission('delete_records', 'delete customers');
create trigger permission_delete before delete on suppliers for each row execute function trg_require_permission('delete_records', 'delete suppliers');
create trigger permission_delete before delete on products for each row execute function trg_require_permission('delete_records', 'delete products');

-- ---------- access ----------
alter table role_permissions enable row level security;
grant select, update on role_permissions to authenticated;
create policy read_all on role_permissions for select to authenticated using ((select app_role()) is not null);
create policy write_admin_update on role_permissions for update to authenticated using ((select app_role()) = 'admin') with check ((select app_role()) = 'admin');
grant execute on function can(text) to authenticated;

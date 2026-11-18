-- =====================================================================
-- 0020: page layout per user (Salesforce "App Builder"): which blocks show on a page, in what order and how wide.
-- One row per user and page (dashboard, order, customer, purchase_order). Private to the user.
-- Roll back: drop table user_layouts.
-- =====================================================================
create table user_layouts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid default app_user_id(),
  page       text not null,
  layout     jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  unique (user_id, page)
);
create trigger touch before update on user_layouts for each row execute function trg_touch_updated_at();
alter table user_layouts enable row level security;
grant select, insert, update, delete on user_layouts to authenticated;
create policy own_select on user_layouts for select to authenticated using (user_id = (select app_user_id()));
create policy own_insert on user_layouts for insert to authenticated with check (user_id = (select app_user_id()) and (select app_role()) is not null);
create policy own_update on user_layouts for update to authenticated using (user_id = (select app_user_id())) with check (user_id = (select app_user_id()));
create policy own_delete on user_layouts for delete to authenticated using (user_id = (select app_user_id()));

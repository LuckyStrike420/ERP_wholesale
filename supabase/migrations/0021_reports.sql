-- =====================================================================
-- 0021: report builder: saved reports (source, columns, filters, grouping, chart).
-- A report is the owner's; "shared" makes it visible (read-only) to everyone; "on_dashboard" offers it as a dashboard widget.
-- The report itself only reads existing views; it changes nothing.
-- Roll back: drop table reports.
-- =====================================================================
create table reports (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) > 0),
  description  text,
  owner        uuid default app_user_id(),
  shared       boolean not null default false,
  on_dashboard boolean not null default false,
  definition   jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger touch before update on reports for each row execute function trg_touch_updated_at();
create trigger audit after insert or update or delete on reports for each row execute function trg_audit();
alter table reports enable row level security;
grant select, insert, update, delete on reports to authenticated;
create policy read_own_or_shared on reports for select to authenticated
  using ((select app_role()) is not null and (owner = (select app_user_id()) or shared or (select app_role()) = 'admin'));
create policy own_insert on reports for insert to authenticated with check (owner = (select app_user_id()) and (select app_role()) is not null);
create policy own_update on reports for update to authenticated
  using (owner = (select app_user_id()) or (select app_role()) = 'admin') with check ((select app_role()) is not null);
create policy own_delete on reports for delete to authenticated using (owner = (select app_user_id()) or (select app_role()) = 'admin');

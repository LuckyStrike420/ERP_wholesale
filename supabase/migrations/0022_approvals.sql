-- =====================================================================
-- 0022: approvals. A policy says "an order whose margin is below X% needs approval before the PI goes out".
-- - approval_policies: margin_below (fraction), optional order type, who decides (admin, or admin + finance).
-- - approvals: a request per order, with the margin at the moment of asking; approved, rejected or pending.
-- - The gate: an order cannot leave Draft (PI sent or further) while it needs approval and has no valid one.
--   An approval stays valid as long as the margin does not drop below the approved margin.
--   Orders that are already past Draft are never blocked; orders without a known cost are not judged.
-- - create_order saves as Draft first; with a PI number it moves to PI sent, or, when blocked, stays Draft and asks for approval itself.
-- - Approvers get a notification for a request; the requester gets one for the decision.
-- Roll back: drop trigger approval_gate on sales_orders; drop view v_order_approval; drop table approvals, approval_policies;
--            restore create_order from 0015; restore the notifications kind check from 0018.
-- =====================================================================
create table approval_policies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) > 0),
  active        boolean not null default true,
  margin_below  numeric(7,4) not null check (margin_below > -1 and margin_below < 1),
  order_type    text check (order_type in ('EXW','FOB')),
  approver_role text not null default 'admin' check (approver_role in ('admin','finance')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger touch before update on approval_policies for each row execute function trg_touch_updated_at();
create trigger audit after insert or update or delete on approval_policies for each row execute function trg_audit();

create table approvals (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references sales_orders on delete cascade,
  policy_id      uuid references approval_policies on delete set null,
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  margin_pct     numeric(9,6),
  margin_below   numeric(7,4),
  note           text,
  requested_by   uuid default app_user_id(),
  requested_at   timestamptz not null default now(),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text
);
create index on approvals (sales_order_id, requested_at desc);
create index on approvals (status) where status = 'pending';
create trigger audit after insert or update or delete on approvals for each row execute function trg_audit();

-- the policy that applies to an order (strictest first) and its latest approval; only orders that need one
create view v_order_approval with (security_invoker = true) as
select o.id as sales_order_id, o.pi_number, o.customer_name, o.order_type, o.status as order_status, o.currency, o.order_value,
       o.margin_pct, p.id as policy_id, p.name as policy_name, p.margin_below, p.approver_role,
       a.id as approval_id, a.status as approval_status, a.margin_pct as approved_margin, a.note, a.requested_by, a.requested_at,
       a.decided_by, a.decided_at, a.decision_note, rq.full_name as requested_by_name, dc.full_name as decided_by_name,
       coalesce(a.status = 'approved' and o.margin_pct >= a.margin_pct - 0.00005, false) as approved_valid
  from v_orders o
  join lateral (select * from approval_policies p
                 where p.active and (p.order_type is null or p.order_type = o.order_type)
                   and o.cost_missing_lines = 0 and o.margin_pct is not null and o.margin_pct < p.margin_below
                 order by p.margin_below desc limit 1) p on true
  left join lateral (select * from approvals a where a.sales_order_id = o.id order by a.requested_at desc limit 1) a on true
  left join profiles rq on rq.user_id = a.requested_by
  left join profiles dc on dc.user_id = a.decided_by;

-- every request with what it is about (for the approvals list)
create view v_approvals with (security_invoker = true) as
select a.*, o.pi_number, o.customer_name, o.order_type, o.status as order_status, o.currency, o.order_value,
       o.margin_pct as current_margin, p.name as policy_name, p.approver_role,
       rq.full_name as requested_by_name, dc.full_name as decided_by_name
  from approvals a
  join v_orders o on o.id = a.sales_order_id
  left join approval_policies p on p.id = a.policy_id
  left join profiles rq on rq.user_id = a.requested_by
  left join profiles dc on dc.user_id = a.decided_by;

-- ---------- the gate ----------
create or replace function approval_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text; v record;
begin
  if coalesce(current_setting('app.no_automations', true), '') = 'on' then return null; end if;   -- imports
  if tg_op = 'UPDATE' and old.status <> 'draft' then return null; end if;
  select status into st from sales_orders where id = new.id;                                       -- the status at commit
  if st is null or st in ('draft','cancelled') then return null; end if;
  select * into v from v_order_approval where sales_order_id = new.id;
  if found and not v.approved_valid then
    raise exception 'Approval needed first: the margin of % is %, below % (%). Ask for approval on the order page.',
      coalesce('PI ' || v.pi_number, 'this order'), round(v.margin_pct * 100, 1) || '%', round(v.margin_below * 100, 1) || '%', v.policy_name;
  end if;
  return null;
end $$;
create constraint trigger approval_gate after insert or update of status on sales_orders
  deferrable initially deferred for each row execute function approval_check();

-- ---------- asking and deciding ----------
create or replace function request_approval(p_order uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v record; aid uuid;
begin
  if app_role() is null and app_user_id() is not null then raise exception 'Not allowed'; end if;
  select * into v from v_order_approval where sales_order_id = p_order;
  if not found then raise exception 'This order does not need approval'; end if;
  if v.approval_status = 'pending' then return v.approval_id; end if;
  if v.approved_valid then raise exception 'This order is already approved'; end if;
  insert into approvals (sales_order_id, policy_id, margin_pct, margin_below, note)
  values (p_order, v.policy_id, v.margin_pct, v.margin_below, nullif(trim(p_note), '')) returning id into aid;
  return aid;
end $$;

create or replace function decide_approval(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record; who text := app_role();
begin
  select a.*, p.approver_role into r from approvals a left join approval_policies p on p.id = a.policy_id where a.id = p_id for update of a;
  if not found then raise exception 'Approval request not found'; end if;
  if r.status <> 'pending' then raise exception 'This request is already %', r.status; end if;
  if app_user_id() is not null and not (who = 'admin' or who = coalesce(r.approver_role, 'admin')) then
    raise exception 'Only % can decide on this request', case when r.approver_role = 'finance' then 'admin or finance' else 'an admin' end;
  end if;
  update approvals set status = case when p_approve then 'approved' else 'rejected' end, decided_by = app_user_id(), decided_at = now(),
         decision_note = nullif(trim(p_note), '') where id = p_id;
end $$;

-- ---------- create_order: a blocked order stays a draft and asks for approval ----------
create or replace function create_order(p_order jsonb, p_lines jsonb)
returns text language plpgsql set search_path = public as $$
declare oid uuid; pi text := nullif(trim(p_order ->> 'pi_number'), '');
begin
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then raise exception 'Add at least one order line'; end if;
  -- saved as a draft first; with a PI number it then moves to PI sent, unless the margin needs approval
  insert into sales_orders (customer_id, order_type, pi_number, customer_po, po_date, notes, status, deposit_pct, payment_days, payment_term_id)
  values ((p_order ->> 'customer_id')::uuid, p_order ->> 'order_type', pi, nullif(trim(p_order ->> 'customer_po'), ''),
          nullif(p_order ->> 'po_date', '')::date, nullif(p_order ->> 'notes', ''), 'draft',
          nullif(p_order ->> 'deposit_pct', '')::numeric, nullif(p_order ->> 'payment_days', '')::int, nullif(p_order ->> 'payment_term_id', '')::uuid)
  returning id into oid;
  insert into sales_order_lines (sales_order_id, line_no, product_id, quantity, unit_price, batch_item_id, cost_override, notes)
  select oid, row_number() over (order by ord), (x ->> 'product_id')::uuid, (x ->> 'quantity')::numeric, (x ->> 'unit_price')::numeric,
         nullif(x ->> 'batch_item_id', '')::uuid, nullif(x ->> 'cost_override', '')::numeric, nullif(x ->> 'notes', '')
    from jsonb_array_elements(p_lines) with ordinality as t(x, ord);
  if pi is not null then
    if exists (select 1 from v_order_approval where sales_order_id = oid and not approved_valid) then perform request_approval(oid, null);
    else update sales_orders set status = 'pi_sent', pi_date = app_today() where id = oid; end if;
  end if;
  return coalesce(pi, 'draft-' || left(oid::text, 8));
end $$;

-- ---------- notifications ----------
alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (kind in ('task_assigned','mention','approval_request','approval_decided'));

create or replace function trg_notify_approval() returns trigger
language plpgsql security definer set search_path = public as $$
declare pi text; role_needed text;
begin
  select coalesce('PI ' || pi_number, 'Draft order') into pi from sales_orders where id = new.sales_order_id;
  if tg_op = 'INSERT' then
    select approver_role into role_needed from approval_policies where id = new.policy_id;
    insert into notifications (user_id, kind, title, body, sales_order_id, actor)
    select p.user_id, 'approval_request', 'Approval asked: ' || pi,
           'Margin ' || coalesce(round(new.margin_pct * 100, 1) || '%', '?') || ', below ' || round(new.margin_below * 100, 1) || '%' || coalesce(E'\n' || new.note, ''),
           new.sales_order_id, new.requested_by
      from profiles p where (p.role = 'admin' or p.role = coalesce(role_needed, 'admin')) and p.user_id is distinct from new.requested_by;
  elsif new.status <> old.status and new.requested_by is not null and new.requested_by is distinct from new.decided_by then
    insert into notifications (user_id, kind, title, body, sales_order_id, actor)
    values (new.requested_by, 'approval_decided', initcap(new.status) || ': ' || pi, new.decision_note, new.sales_order_id, new.decided_by);
  end if;
  return new;
end $$;
create trigger notify after insert or update of status on approvals for each row execute function trg_notify_approval();

-- ---------- access ----------
alter table approval_policies enable row level security;
alter table approvals enable row level security;
grant select, insert, update, delete on approval_policies to authenticated;
grant select on approvals to authenticated;
create policy read_all on approval_policies for select to authenticated using ((select app_role()) is not null);
create policy write_admin_insert on approval_policies for insert to authenticated with check ((select app_role()) = 'admin');
create policy write_admin_update on approval_policies for update to authenticated using ((select app_role()) = 'admin') with check ((select app_role()) = 'admin');
create policy write_admin_delete on approval_policies for delete to authenticated using ((select app_role()) = 'admin');
create policy read_all on approvals for select to authenticated using ((select app_role()) is not null);
grant select on v_order_approval, v_approvals to authenticated;
revoke execute on function request_approval(uuid, text), decide_approval(uuid, boolean, text), approval_check() from public;
grant execute on function request_approval(uuid, text), decide_approval(uuid, boolean, text) to authenticated;

-- a starting policy, switched off: set the percentage and switch it on under Admin → Approvals
insert into approval_policies (name, active, margin_below) values ('Low margin', false, 0.10);

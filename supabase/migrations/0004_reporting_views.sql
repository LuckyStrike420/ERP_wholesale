-- =====================================================================
-- 0004: views for the payment history and the reports
-- =====================================================================
create view v_allocations with (security_invoker = true) as
select a.id, a.payment_id, a.amount, a.sales_order_id, a.purchase_order_id,
       p.direction, p.payment_date, p.currency, p.reference, p.notes, p.amount as payment_amount,
       p.voided_at, p.void_reason, coalesce(c.name, s.name) as party_name, so.pi_number, po.po_number
  from payment_allocations a
  join payments p on p.id = a.payment_id
  left join customers c on c.id = p.customer_id
  left join suppliers s on s.id = p.supplier_id
  left join sales_orders so on so.id = a.sales_order_id
  left join purchase_orders po on po.id = a.purchase_order_id;

create view v_customer_summary with (security_invoker = true) as
select o.customer_id, o.customer_name, o.currency,
       count(*) as orders, count(*) filter (where o.is_open) as open_orders,
       sum(o.order_value) as order_value, sum(o.margin) as margin,
       sum(o.paid) as paid, sum(greatest(o.outstanding, 0)) as outstanding, sum(o.overdue_amount) as overdue
  from v_orders o where o.status not in ('draft','cancelled')
 group by 1, 2, 3;

create view v_supplier_summary with (security_invoker = true) as
select po.supplier_id, po.supplier_name, po.currency,
       count(*) as purchase_orders, sum(po.payable) as payable, sum(po.paid) as paid,
       sum(greatest(po.outstanding, 0)) as outstanding, sum(po.overdue_amount) as overdue
  from v_purchase_orders po group by 1, 2, 3;

create view v_product_sales with (security_invoker = true) as
select l.product_id, p.name as product_name, extract(year from l.revenue_date)::int as year, l.order_type, l.currency,
       sum(l.qty) as units, sum(l.revenue) as revenue, sum(l.margin) as margin
  from v_order_lines l join products p on p.id = l.product_id
 where l.status not in ('draft','cancelled')
 group by 1, 2, 3, 4, 5;

grant select on v_allocations, v_customer_summary, v_supplier_summary, v_product_sales to authenticated;

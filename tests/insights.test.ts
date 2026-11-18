import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one } from './db.ts';
import { seed, mkOrder, num } from './fixtures.ts';

test('reorders: rhythm per customer and product; one task once the expected order is late; a draft or a new order stops it', async () => {
  const db = await freshDb('2026-11-10'); const s = await seed(db);
  for (const [pi, d] of [['R1', '2026-06-01'], ['R2', '2026-07-01'], ['R3', '2026-07-31']] as const)
    await mkOrder(db, { pi, type: 'EXW', customer: s.cust, poDate: d, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  const p = await one<any>(db, `select orders, usual_days, expected_next::text, days_overdue, usual_qty from v_reorder_patterns where customer_id = $1 and product_id = $2`, [s.cust, s.fixed]);
  assert.deepEqual([p.orders, p.usual_days, p.expected_next, p.days_overdue, num(p.usual_qty)], [3, 30, '2026-08-30', 72, 100]);

  await db.query(`select run_automations()`);
  const t = (await db.query<any>(`select title, customer_id from tasks where title like 'Reorder due%'`)).rows;
  assert.equal(t.length, 1); assert.equal(t[0].customer_id, s.cust);
  await db.query(`select run_automations()`);
  assert.equal((await db.query(`select 1 from tasks where title like 'Reorder due%'`)).rows.length, 1, 'no second task for the same cycle');

  // a new order starts a new cycle (not yet late) → no new task
  await mkOrder(db, { pi: 'R4', type: 'EXW', customer: s.cust, poDate: '2026-11-01', lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  await db.query(`select run_automations()`);
  assert.equal((await db.query(`select 1 from tasks where title like 'Reorder due%'`)).rows.length, 1);
});

test('customer health: paying, trend and activity scored; worst signal wins', async () => {
  const db = await freshDb('2026-11-10'); const s = await seed(db);
  // last year 1000, this year 400 → trend 40% (red); two orders 300 days apart, last 9 days ago → activity green
  await mkOrder(db, { pi: 'H1', type: 'EXW', customer: s.cust, poDate: '2025-06-01', lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  const h2 = await mkOrder(db, { pi: 'H2', type: 'EXW', customer: s.cust, poDate: '2026-11-01', lines: [{ product: s.fixed, qty: 40, price: 10 }] });
  // H2 due 2026-11-02, paid in full 2026-11-08 → 6 days late (green); H1 has no due date → not judged
  await db.query(`update sales_orders set balance_due_date = '2026-11-02' where id = $1`, [h2]);
  const pay = (await one<any>(db, `insert into payments (direction, customer_id, payment_date, amount, currency) values ('in', $1, '2026-11-08', 400, 'EUR') returning id`, [s.cust])).id;
  await db.query(`insert into payment_allocations (payment_id, sales_order_id, amount) values ($1, $2, 400)`, [pay, h2]);
  const pz = await one<any>(db, `select avg_days_late, judged_orders, pay_score from v_customer_health where customer_id = $1`, [s.cust]);
  assert.deepEqual([pz.avg_days_late, pz.judged_orders, pz.pay_score], [6, 1, 'green']);
  const h = await one<any>(db, `select revenue_12m, revenue_prev_12m, trend_ratio, trend_score, activity_score, score, usual_days from v_customer_health where customer_id = $1`, [s.cust]);
  assert.deepEqual([num(h.revenue_12m), num(h.revenue_prev_12m), num(h.trend_ratio), h.trend_score, h.activity_score, h.score], [400, 1000, 0.4, 'red', 'green', 'red']);
  // the limit is a setting: at 30% the trend becomes amber
  await db.query(`update app_settings set value = '30' where key = 'health_trend_amber_pct'`);
  assert.equal((await one<any>(db, `select trend_score from v_customer_health where customer_id = $1`, [s.cust])).trend_score, 'amber');
});

test('customer health: an open order late on its deposit counts as paying late; one currency needs no exchange rate', async () => {
  const db = await freshDb('2026-11-10'); const s = await seed(db);
  const o = await mkOrder(db, { pi: 'D1', type: 'FOB', customer: s.cust, poDate: '2026-09-01', lines: [{ product: s.fixed, qty: 10, price: 100 }] });
  await db.query(`update sales_orders set deposit_pct = 0.3, deposit_due_date = '2026-10-01' where id = $1`, [o]);
  const h = await one<any>(db, `select avg_days_late, pay_score, currency, revenue_12m, overdue_reporting from v_customer_health where customer_id = $1`, [s.cust]);
  assert.deepEqual([h.avg_days_late, h.pay_score, h.currency, num(h.revenue_12m), num(h.overdue_reporting)], [40, 'red', 'USD', 1000, 300]);
});

test('targets: target against booked revenue per month', async () => {
  const db = await freshDb('2026-11-10'); const s = await seed(db);
  await mkOrder(db, { pi: 'T1', type: 'EXW', customer: s.cust, poDate: '2026-10-05', lines: [{ product: s.fixed, qty: 10, price: 50 }] });
  await db.query(`insert into targets (year, month, revenue, margin) values (2026, 10, 1000, 200), (2026, 11, 2000, null)`);
  const r = (await db.query<any>(`select month, revenue_target, revenue_actual, revenue_achieved from v_target_progress where year = 2026 order by month`)).rows;
  assert.deepEqual(r.map(x => [x.month, num(x.revenue_target), num(x.revenue_actual), x.revenue_achieved == null ? null : num(x.revenue_achieved)]), [[10, 1000, 500, 0.5], [11, 2000, 0, 0]]);
});

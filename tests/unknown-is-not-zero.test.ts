import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, all } from './db.ts';
import { seed, mkOrder, order, num } from './fixtures.ts';

// Audit package 1: what is unknown is shown as unknown, never as zero or 100%.

test('OMS-001: a line without cost price gives an unknown margin %, not 100%', async () => {
  const db = await freshDb(); const s = await seed(db);
  // s.pct has no cost rule for FOB -> cost unknown
  const o = await mkOrder(db, { pi: 'U1', type: 'FOB', customer: s.cust, lines: [{ product: s.pct, qty: 10, price: 10 }] });
  const l = await one<any>(db, `select * from v_order_lines where sales_order_id = $1`, [o]);
  assert.equal(l.unit_cost, null); assert.equal(l.cost_known, false); assert.equal(l.margin_pct, null);
  const v = await order(db, o);
  assert.deepEqual([num(v.order_value), num(v.margin)], [100, 100]);          // amounts unchanged
  assert.deepEqual([v.cost_complete, num(v.cost_missing_lines), v.margin_pct], [false, 1, null]);
  // a second line with a known cost does not make the order complete
  await db.query(`insert into sales_order_lines (sales_order_id, line_no, product_id, quantity, unit_price) values ($1,2,$2,10,10)`, [o, s.fixed]);
  const v2 = await order(db, o);
  assert.deepEqual([v2.cost_complete, num(v2.cost_missing_lines), v2.margin_pct], [false, 1, null]);
  // a fully costed order keeps its percentage
  const ok = await mkOrder(db, { pi: 'U2', type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 10 }] });
  const vo = await order(db, ok);
  assert.equal(vo.cost_complete, true); assert.equal(num(vo.margin_pct), 0.544);
});

test('OMS-001: reports carry the missing-cost count and the margin % comes from the database', async () => {
  const db = await freshDb(); const s = await seed(db);
  await mkOrder(db, { pi: 'U1', type: 'FOB', customer: s.cust, lines: [{ product: s.pct, qty: 10, price: 10 }] });
  await mkOrder(db, { pi: 'U2', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 10 }] });
  const y = await all<any>(db, `select * from v_revenue_yearly order by order_type`);
  const exw = y.find(r => r.order_type === 'EXW'), fob = y.find(r => r.order_type === 'FOB');
  assert.deepEqual([num(exw.cost_missing_lines), exw.margin_pct === null], [0, false]);
  assert.deepEqual([num(fob.cost_missing_lines), fob.margin_pct], [1, null]);
  assert.equal(num(fob.revenue), 100);
  const p = await all<any>(db, `select * from v_product_sales where product_id = $1`, [s.pct]);
  assert.equal(num(p[0].cost_missing_lines), 1);
});

test('OMS-003: cash flow summary separates amounts with and without a due date', async () => {
  const db = await freshDb(); const s = await seed(db);
  const o = await mkOrder(db, { pi: 'C1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  let r = await one<any>(db, `select * from v_cash_flow_summary where direction = 'in' and currency = 'EUR'`);
  assert.deepEqual([num(r.total_amount), num(r.dated_amount), num(r.undated_amount), num(r.undated_items)], [1000, 0, 1000, 1]);
  await db.query(`update sales_orders set deposit_due_date = '2026-12-01' where id = $1`, [o]);
  r = await one<any>(db, `select * from v_cash_flow_summary where direction = 'in' and currency = 'EUR'`);
  assert.deepEqual([num(r.dated_amount), num(r.undated_amount), num(r.undated_items)], [1000, 0, 0]);
});

test('OMS-004: overdue coverage counts overdue, reminders and items without a due date', async () => {
  const db = await freshDb(); const s = await seed(db);
  await mkOrder(db, { pi: 'D1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });   // no due date
  const o2 = await mkOrder(db, { pi: 'D2', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  await db.query(`update sales_orders set deposit_due_date = '2026-10-15' where id = $1`, [o2]);                          // overdue at 2026-11-10
  const c = await one<any>(db, `select * from v_overdue_coverage`);
  assert.deepEqual([num(c.overdue_items), num(c.undated_items)], [1, 1]);
  assert.ok(num(c.reminder_items) >= 1);                                                                                    // EXW unpaid since PO date
});

test('OMS-006: shipped or delivered without a linked shipment is flagged, not changed', async () => {
  const db = await freshDb(); const s = await seed(db);
  const o = await mkOrder(db, { pi: 'S1', type: 'FOB', customer: s.cust, status: 'shipped', lines: [{ product: s.fixed, qty: 1, price: 10 }] });
  const flagged = async () => (await all<any>(db, `select * from v_attention where code = 'shipped_without_shipment'`));
  let f = await flagged();
  assert.equal(f.length, 1); assert.equal(f[0].entity_id, o); assert.equal(f[0].reference, 'S1');
  assert.equal((await order(db, o)).status, 'shipped');
  const sh = (await one<any>(db, `insert into shipments (etd, eta) values ('2026-10-01','2026-11-20') returning id`)).id;
  await db.query(`insert into shipment_orders (shipment_id, sales_order_id) values ($1,$2)`, [sh, o]);
  assert.equal((await flagged()).length, 0);
});

test('OMS-012: one count for badge and header', async () => {
  const db = await freshDb(); const s = await seed(db);
  await mkOrder(db, { pi: 'N1', type: 'FOB', customer: s.cust, lines: [{ product: s.pct, qty: 1, price: 10 }] });   // cost_missing = error
  const all_ = await all<any>(db, `select severity from v_attention`);
  const c = await one<any>(db, `select * from v_attention_counts`);
  assert.equal(num(c.actionable), all_.filter(a => a.severity !== 'info').length);
  assert.equal(num(c.info_count), all_.filter(a => a.severity === 'info').length);
  assert.ok(num(c.actionable) >= 1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, all } from './db.ts';
import { seed, mkOrder, num } from './fixtures.ts';

test('payment overview: open items get a bucket from their own due dates, never an invented one', async () => {
  const db = await freshDb(); const s = await seed(db);          // today = 2026-11-10 in the test database
  const late = await mkOrder(db, { pi: 'L1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 10 }] });
  await db.query(`update sales_orders set deposit_due_date = '2026-11-01' where id = $1`, [late]);
  const soon = await mkOrder(db, { pi: 'S1', type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 10 }] });
  await db.query(`update sales_orders set deposit_due_date = '2026-11-14' where id = $1`, [soon]);
  const later = await mkOrder(db, { pi: 'P1', type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 10 }] });
  await db.query(`update sales_orders set deposit_due_date = '2026-12-31' where id = $1`, [later]);
  await mkOrder(db, { pi: 'N1', type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 10 }] });
  const paid = await mkOrder(db, { pi: 'X1', type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 10 }] });
  await db.query(`select register_customer_payment($1,'2026-11-02',100,'B')`, [paid]);
  await mkOrder(db, { type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 10 }] });   // draft: not an open item
  const rows = await all<any>(db, `select reference, bucket, next_due_date, days_late, days_open from v_open_items where direction = 'in' order by reference`);
  const b = Object.fromEntries(rows.map(r => [r.reference, r.bucket]));
  assert.deepEqual(b, { L1: 'overdue', N1: 'no_due_date', P1: 'scheduled', S1: 'due_soon' });
  assert.equal(num(rows.find(r => r.reference === 'L1').days_late), 9);
  assert.equal(rows.find(r => r.reference === 'N1').next_due_date, null);
  const sum = await all<any>(db, `select * from v_open_items_summary where direction = 'in' and bucket = 'overdue'`);
  assert.equal(num(sum[0].items), 1);
});

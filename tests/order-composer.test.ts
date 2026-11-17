import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, all } from './db.ts';
import { seed, mkOrder, order, num } from './fixtures.ts';

test('sale price suggestion: customer agreement, then quantity break, then standard, then product price', async () => {
  const db = await freshDb(); const s = await seed(db);
  const sug = async (cust: string, qty: number) => (await all<any>(db, `select * from suggest_sale_price($1,$2,'EXW','2026-11-01',$3)`, [s.fixed, cust, qty]))[0];
  assert.equal(await sug(s.cust, 10), undefined);                                         // nothing known: no suggestion
  await db.query(`update products set sale_price_exw = 12 where id = $1`, [s.fixed]);
  assert.deepEqual([num((await sug(s.cust, 10)).sale_price), (await sug(s.cust, 10)).source], [12, 'product_price']);
  await db.query(`insert into price_agreements (product_id, customer_id, order_type, sale_price) values ($1, null, 'EXW', 11)`, [s.fixed]);
  assert.equal((await sug(s.cust, 10)).source, 'standard_agreement');
  await db.query(`insert into price_agreements (product_id, customer_id, order_type, sale_price) values ($1, $2, 'EXW', 10)`, [s.fixed, s.cust]);
  await db.query(`insert into price_agreements (product_id, customer_id, order_type, sale_price, moq) values ($1, $2, 'EXW', 9, 500)`, [s.fixed, s.cust]);
  assert.equal(num((await sug(s.cust, 100)).sale_price), 10);
  assert.equal(num((await sug(s.cust, 500)).sale_price), 9);                               // quantity break
  assert.equal(num((await sug(s.cust2, 100)).sale_price), 11);                             // other customer: standard
});

test('preview equals the saved order, and saves nothing', async () => {
  const db = await freshDb(); const s = await seed(db);
  const lines = [{ idx: 1, product_id: s.fixed, quantity: 100, unit_price: 10 }, { idx: 2, product_id: s.pct, quantity: 5, unit_price: 20 }];
  const before = num((await one<any>(db, `select count(*) as n from sales_orders`)).n);
  const p = (await one<any>(db, `select preview_order($1,'FOB','2026-11-01',$2::jsonb) as p`, [s.cust, JSON.stringify(lines)])).p;
  assert.equal(num((await one<any>(db, `select count(*) as n from sales_orders`)).n), before);
  const ref = (await one<any>(db, `select create_order($1::jsonb,$2::jsonb) as r`, [JSON.stringify({ customer_id: s.cust, order_type: 'FOB', pi_number: 'C77', po_date: '2026-11-01' }), JSON.stringify(lines)])).r;
  assert.equal(ref, 'C77');
  const o = await one<any>(db, `select * from v_orders where pi_number = 'C77'`);
  assert.deepEqual([num(p.order.order_value), num(p.order.margin), num(p.order.deposit_due), num(p.order.cost_missing_lines)],
                   [num(o.order_value), num(o.margin), num(o.deposit_due), num(o.cost_missing_lines)]);
  assert.equal(o.status, 'pi_sent'); assert.equal(num(o.line_count), 2);
  const draft = (await one<any>(db, `select create_order($1::jsonb,$2::jsonb) as r`, [JSON.stringify({ customer_id: s.cust, order_type: 'EXW' }), JSON.stringify([lines[0]])])).r;
  assert.match(draft, /^draft-/);
  await assert.rejects(db.query(`select create_order($1::jsonb,'[]'::jsonb)`, [JSON.stringify({ customer_id: s.cust, order_type: 'EXW' })]), /at least one/);
  // a refused line leaves no half order behind
  await assert.rejects(db.query(`select create_order($1::jsonb,$2::jsonb)`, [JSON.stringify({ customer_id: s.cust, order_type: 'EXW', pi_number: 'C78' }), JSON.stringify([{ product_id: s.fixed, quantity: 1 }])]));
  assert.equal(num((await one<any>(db, `select count(*) as n from sales_orders where pi_number = 'C78'`)).n), 0);
  assert.ok(order);
});

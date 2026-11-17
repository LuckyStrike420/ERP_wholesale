import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, all } from './db.ts';
import { seed, mkOrder, num } from './fixtures.ts';

test('a PO is created from an order and linked to the chosen lines in one step', async () => {
  const db = await freshDb(); const s = await seed(db);
  const o = await mkOrder(db, { pi: 'K1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }, { product: s.fixed, qty: 50, price: 10 }] });
  const lines = await all<any>(db, `select id, line_no from sales_order_lines where sales_order_id = $1 order by line_no`, [o]);
  const sup = (await one<any>(db, `select id from suppliers limit 1`)).id;
  const no = (await one<any>(db, `select create_po_for_order($1,'P-900',$2,'2026-11-10',$3) as n`, [o, sup, [lines[0].id]])).n;
  assert.equal(no, 'P-900');
  const po = await one<any>(db, `select * from v_purchase_orders where po_number = 'P-900'`);
  assert.equal(po.order_type, 'EXW'); assert.equal(num(po.line_count), 1);
  assert.equal(num(po.expected_amount), 456);                                    // 100 x 4.56 cost
  // the same line cannot get a second PO; nothing is created when it fails
  await assert.rejects(db.query(`select create_po_for_order($1,'P-901',$2,null,$3)`, [o, sup, [lines[0].id]]), /already has a PO/);
  assert.equal(num((await one<any>(db, `select count(*) as n from purchase_orders where po_number = 'P-901'`)).n), 0);
  await assert.rejects(db.query(`select create_po_for_order($1,'P-902',$2,null,$3)`, [o, sup, []]), /at least one/);
  await assert.rejects(db.query(`select create_po_for_order($1,'P-900',$2,null,$3)`, [o, sup, [lines[1].id]]), /unique|already exists|duplicate/i);
  assert.equal((await one<any>(db, `select purchase_order_id from sales_order_lines where id = $1`, [lines[1].id])).purchase_order_id, null);
});

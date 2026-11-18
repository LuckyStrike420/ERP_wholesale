import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one } from './db.ts';
import { seed, mkOrder, num } from './fixtures.ts';

test('EXW from a batch: purchase 5, sold at 10, margin shared 50% → cost 7.50, and that is what the PO to the supplier says', async () => {
  const db = await freshDb(); const s = await seed(db);
  const b = (await one<any>(db, `insert into batches (batch_number, supplier_id) values ('B-1', $1) returning id`, [s.sup])).id;
  const bi = (await one<any>(db, `insert into batch_items (batch_id, product_id, qty_received, cost_basis, share_above_basis) values ($1, $2, 100, 5, 0.5) returning id`, [b, s.fixed])).id;
  const id = await mkOrder(db, { pi: 'E1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 10 }] });
  await db.query(`update sales_order_lines set batch_item_id = $1 where sales_order_id = $2`, [bi, id]);
  let l = await one<any>(db, `select unit_cost, cost_source, purchase_value from v_order_lines where sales_order_id = $1`, [id]);
  assert.deepEqual([num(l.unit_cost), l.cost_source, num(l.purchase_value)], [7.5, 'batch', 75]);

  // margin not shared: the purchase price itself
  await db.query(`update batch_items set share_above_basis = null where id = $1`, [bi]);
  l = await one<any>(db, `select unit_cost from v_order_lines where sales_order_id = $1`, [id]);
  assert.equal(num(l.unit_cost), 5);

  // shared again; a PO for the line carries the batch cost
  await db.query(`update batch_items set share_above_basis = 0.5 where id = $1`, [bi]);
  const lineId = (await one<any>(db, `select id from sales_order_lines where sales_order_id = $1`, [id])).id;
  await db.query(`select create_po_for_order($1, 'P-1', $2, '2026-11-18', array[$3]::uuid[])`, [id, s.sup, lineId]);
  const po = await one<any>(db, `select expected_amount from v_purchase_orders where po_number = 'P-1'`);
  assert.equal(num(po.expected_amount), 75);
  const st = await one<any>(db, `select stock, sold, sold_without_po from v_batch_item_stock where batch_item_id = $1`, [bi]);
  assert.deepEqual([num(st.stock), num(st.sold), num(st.sold_without_po)], [90, 10, 0]);
});

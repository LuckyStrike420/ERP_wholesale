import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, all } from './db.ts';
const num = (v: any) => Number(v);
import { seed, mkOrder } from './fixtures.ts';

test('own stock: a sale from it needs no PO and costs the batch price', async () => {
  const db = await freshDb(); const s = await seed(db);
  const b = (await one<any>(db, `insert into batches (batch_number, own_stock) values ('OWN1', true) returning id`)).id;
  const bi = (await one<any>(db, `insert into batch_items (batch_id, product_id, qty_received, cost_basis) values ($1, $2, 100, 5.418) returning id`, [b, s.fixed])).id;
  const o = await mkOrder(db, { pi: 'S1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 12, batchItem: bi }] });
  const l = await one<any>(db, `select unit_cost, own_stock from v_order_lines where sales_order_id = $1`, [o]);
  assert.equal(num(l.unit_cost), 5.418); assert.equal(l.own_stock, true);
  assert.equal((await all<any>(db, `select 1 from v_attention where code = 'stock_sale_without_po'`)).length, 0);
  assert.equal(num((await one<any>(db, `select sold_without_po from v_batch_item_stock where batch_item_id = $1`, [bi])).sold_without_po), 0);
});

test('PO with its own lines: counts in what the PO costs; received lines become an own-stock batch', async () => {
  const db = await freshDb(); const s = await seed(db);
  const sup = (await one<any>(db, `select id from suppliers limit 1`)).id;
  const po = (await one<any>(db, `insert into purchase_orders (po_number, supplier_id, order_type, currency, po_date) values ('2806', $1, 'EXW', 'EUR', current_date) returning id`, [sup])).id;
  const box = (await one<any>(db, `insert into products (name, kind) values ('Retail box', 'Verpakking') returning id`)).id;
  const line = (await one<any>(db, `insert into purchase_order_lines (purchase_order_id, product_id, quantity, unit_price) values ($1, $2, 1000, 0.35) returning id`, [po, box])).id;
  await db.query(`insert into purchase_order_lines (purchase_order_id, description, quantity, unit_price) values ($1, 'Plates / setup', 1, 120)`, [po]);
  const p = await one<any>(db, `select expected_amount, line_count from v_purchase_orders where id = $1`, [po]);
  assert.equal(num(p.expected_amount), 470); assert.equal(Number(p.line_count), 2);
  const bid = (await one<any>(db, `select receive_po_lines($1, 'B-2806', current_date, $2::jsonb) id`, [po, JSON.stringify([{ line_id: line, qty: 600 }])])).id;
  const it = await one<any>(db, `select bi.qty_received, bi.cost_basis, b.own_stock from batch_items bi join batches b on b.id = bi.batch_id where bi.batch_id = $1`, [bid]);
  assert.deepEqual([it.qty_received, num(it.cost_basis), it.own_stock], [600, 0.35, true]);
  assert.equal(num((await one<any>(db, `select received from v_purchase_order_lines where id = $1`, [line])).received), 600);
});

test('assembly: uses the chosen component batches, makes a batch at component cost + fee; undo puts it back', async () => {
  const db = await freshDb(); const s = await seed(db);
  const mk = async (name: string, unit = 'pcs') => (await one<any>(db, `insert into products (name, unit, kind) values ($1, $2, 'Onderdeel') returning id`, [name, unit])).id;
  const fin = (await one<any>(db, `insert into products (name, kind) values ('Snake Complex', 'Eindproduct') returning id`)).id;
  const box = await mk('Box'), bottle = await mk('Bottle'), cream = await mk('Cream', 'ml');
  await db.query(`insert into product_recipes (product_id, component_id, qty_per_unit) values ($1, $2, 1), ($1, $3, 1), ($1, $4, 100)`, [fin, box, bottle, cream]);
  const b = (await one<any>(db, `insert into batches (batch_number, own_stock) values ('C1', true) returning id`)).id;
  const ib = (await one<any>(db, `insert into batch_items (batch_id, product_id, qty_received, cost_basis) values ($1, $2, 500, 0.40) returning id`, [b, box])).id;
  const it = (await one<any>(db, `insert into batch_items (batch_id, product_id, qty_received, cost_basis) values ($1, $2, 500, 0.60) returning id`, [b, bottle])).id;
  const ic = (await one<any>(db, `insert into batch_items (batch_id, product_id, qty_received, cost_basis) values ($1, $2, 20000, 0.01) returning id`, [b, cream])).id;
  assert.deepEqual([(await one<any>(db, `select can_make, limited_by from v_recipe_capacity where product_id = $1`, [fin]))].map(r => [r.can_make, r.limited_by])[0], [200, 'Cream']);
  const sup = (await one<any>(db, `select id from suppliers limit 1`)).id;
  const inputs = JSON.stringify([{ batch_item_id: ib, qty: 100 }, { batch_item_id: it, qty: 100 }, { batch_item_id: ic, qty: 10000 }]);
  const nb = (await one<any>(db, `select assemble($1, 100, 'SC-1', current_date, $2::jsonb, $3, 50, 'EUR') id`, [fin, inputs, sup])).id;
  const a = await one<any>(db, `select components_per_unit, fee_per_unit, cost_per_unit, used from v_assemblies where batch_id = $1`, [nb]);
  assert.equal(num(a.components_per_unit), 2); assert.equal(num(a.fee_per_unit), 0.5); assert.equal(num(a.cost_per_unit), 2.5);
  assert.equal(num((await one<any>(db, `select stock from v_batch_item_stock where batch_item_id = $1`, [ib])).stock), 400);
  assert.equal(num((await one<any>(db, `select stock from v_product_stock where product_id = $1`, [fin])).stock), 100);
  // not enough / missing component
  await assert.rejects(db.query(`select assemble($1, 10, 'SC-2', current_date, $2::jsonb)`, [fin, JSON.stringify([{ batch_item_id: ib, qty: 10 }])]), /Choose a batch for/);
  await assert.rejects(db.query(`select assemble($1, 10, 'SC-3', current_date, $2::jsonb)`, [fin, JSON.stringify([{ batch_item_id: ib, qty: 9999 }, { batch_item_id: it, qty: 10 }, { batch_item_id: ic, qty: 10 }])]), /has only/);
  // undo
  const aid = (await one<any>(db, `select id from assemblies where batch_id = $1`, [nb])).id;
  await db.query(`select undo_assembly($1)`, [aid]);
  assert.equal(num((await one<any>(db, `select stock from v_batch_item_stock where batch_item_id = $1`, [ib])).stock), 500);
  assert.equal((await all<any>(db, `select 1 from batches where id = $1`, [nb])).length, 0);
});

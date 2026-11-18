import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one } from './db.ts';
import { seed, mkOrder, num } from './fixtures.ts';

test('landed costs: a shipment cost is spread over its orders and lowers the margin; other currencies at the ECB rate', async () => {
  const db = await freshDb(); const s = await seed(db);
  const a = await mkOrder(db, { pi: 'L1', type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });   // 1000
  const b = await mkOrder(db, { pi: 'L2', type: 'FOB', customer: s.cust2, lines: [{ product: s.fixed, qty: 300, price: 10 }] });  // 3000
  const sh = (await one<any>(db, `insert into shipments (container_number) values ('C1') returning id`)).id;
  await db.query(`insert into shipment_orders (shipment_id, sales_order_id) values ($1, $2), ($1, $3)`, [sh, a, b]);
  const before = num((await one<any>(db, `select margin from v_orders where id = $1`, [a])).margin);

  await db.query(`insert into landed_costs (shipment_id, kind, amount, currency, allocate_by) values ($1, 'freight', 400, 'USD', 'value')`, [sh]);
  const la = await one<any>(db, `select total_cost, margin from v_orders where id = $1`, [a]);
  assert.equal(num(la.margin), before - 100);          // a has 1/4 of the value
  assert.equal(num((await one<any>(db, `select extra_costs from v_order_lines where sales_order_id = $1`, [b])).extra_costs), 300);

  // by quantity, a direct order cost, and a EUR cost on a USD order at the rate of its date
  await db.query(`insert into fx_rates (rate_date, currency, rate, source) values ('2026-09-01', 'USD', 0.8, 'test')`);
  await db.query(`insert into landed_costs (sales_order_id, kind, amount, currency, allocate_by, invoice_date) values ($1, 'inspection', 80, 'EUR', 'quantity', '2026-10-05')`, [a]);
  assert.equal(num((await one<any>(db, `select landed_costs from v_order_lines where sales_order_id = $1`, [a])).landed_costs), 200);   // 100 USD + 80 EUR = 100 USD
  // volume without carton data falls back to quantity
  await db.query(`insert into landed_costs (shipment_id, kind, amount, currency, allocate_by) values ($1, 'forwarder', 40, 'USD', 'volume')`, [sh]);
  const basis = await one<any>(db, `select distinct basis_used from v_landed_cost_allocation where cost_id = (select id from landed_costs where kind = 'forwarder')`);
  assert.equal(basis.basis_used, 'quantity');
});

test('landed costs on a batch: per piece, carried into an EXW sale from that batch and into the stock value', async () => {
  const db = await freshDb(); const s = await seed(db);
  const b = (await one<any>(db, `insert into batches (batch_number, supplier_id, received_date) values ('B-9', $1, '2026-09-01') returning id`, [s.sup])).id;
  const bi = (await one<any>(db, `insert into batch_items (batch_id, product_id, qty_received, cost_basis) values ($1, $2, 200, 5) returning id`, [b, s.fixed])).id;
  await db.query(`insert into landed_costs (batch_id, kind, amount, currency, allocate_by) values ($1, 'duties', 100, 'EUR', 'quantity')`, [b]);
  assert.equal(num((await one<any>(db, `select per_unit_eur from v_batch_landed where batch_item_id = $1`, [bi])).per_unit_eur), 0.5);
  const o = await mkOrder(db, { pi: 'E1', type: 'EXW', customer: s.cust, poDate: '2026-10-01', lines: [{ product: s.fixed, qty: 10, price: 9, batchItem: bi }] });
  assert.equal(num((await one<any>(db, `select landed_costs from v_order_lines where sales_order_id = $1`, [o])).landed_costs), 5);

  // stock on dates: before receipt 0; after the sale 190 at 5.50
  assert.equal(num((await one<any>(db, `select qty from stock_on('2026-08-31') where batch_item_id = $1`, [bi])).qty), 0);
  const v = await one<any>(db, `select qty, unit_value, value from stock_on('2026-10-02') where batch_item_id = $1`, [bi]);
  assert.deepEqual([num(v.qty), num(v.unit_value), num(v.value)], [190, 5.5, 1045]);
});

test('stock count: differences are booked as count corrections; minimum stock is flagged', async () => {
  const db = await freshDb('2026-11-10'); const s = await seed(db);
  const b = (await one<any>(db, `insert into batches (batch_number, received_date) values ('B-7', '2026-09-01') returning id`)).id;
  const bi = (await one<any>(db, `insert into batch_items (batch_id, product_id, qty_received, cost_basis) values ($1, $2, 50, 2) returning id`, [b, s.pct])).id;
  const c = (await one<any>(db, `insert into stock_counts (count_date) values ('2026-11-10') returning id`)).id;
  await db.query(`insert into stock_count_lines (count_id, batch_item_id, counted) values ($1, $2, 47)`, [c, bi]);
  assert.equal((await one<any>(db, `select book_stock_count($1) as n`, [c])).n, 1);
  const adj = await one<any>(db, `select kind, quantity, reference from stock_adjustments where batch_item_id = $1`, [bi]);
  assert.deepEqual([adj.kind, adj.quantity, adj.reference], ['Telling', -3, 'Count 10-11-2026']);
  await assert.rejects(db.query(`select book_stock_count($1)`, [c]), /booked already/);

  await db.query(`update products set min_stock = 60 where id = $1`, [s.pct]);
  const p = await one<any>(db, `select stock, min_stock, below_min from v_product_stock where product_id = $1`, [s.pct]);
  assert.deepEqual([num(p.stock), p.min_stock, p.below_min], [47, 60, true]);
});

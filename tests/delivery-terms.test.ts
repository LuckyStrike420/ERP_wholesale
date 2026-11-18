import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, all } from './db.ts';
import { seed, mkOrder } from './fixtures.ts';

test('delivery terms: customer default on new orders; DAP/DDP without transport cost is flagged until a freight cost exists', async () => {
  const db = await freshDb(); const s = await seed(db);
  // without a customer default the term follows the order type
  const plain = await mkOrder(db, { pi: 'T0', type: 'EXW', customer: s.cust2, lines: [{ product: s.fixed, qty: 10, price: 10 }] });
  assert.equal((await one<any>(db, `select incoterm from sales_orders where id = $1`, [plain])).incoterm, 'EXW');

  await db.query(`update customers set default_incoterm = 'DDP' where id = $1`, [s.cust]);
  const o = await mkOrder(db, { pi: 'T1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 576, price: 12 }] });
  const d = await one<any>(db, `select incoterm, we_arrange_transport, transport_missing from v_order_delivery where sales_order_id = $1`, [o]);
  assert.deepEqual([d.incoterm, d.we_arrange_transport, d.transport_missing], ['DDP', true, true]);
  assert.equal((await all<any>(db, `select 1 from v_attention where code = 'transport_cost_missing' and entity_id = $1`, [o])).length, 1);
  assert.equal((await all<any>(db, `select 1 from v_order_flags where sales_order_id = $1 and rule_id is null`, [o])).length, 1);

  // a draft is not flagged yet; an EXW order never
  const draft = await mkOrder(db, { type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 1, price: 12 }] });
  assert.equal((await one<any>(db, `select transport_missing from v_order_delivery where sales_order_id = $1`, [draft])).transport_missing, false);
  assert.equal((await one<any>(db, `select transport_missing from v_order_delivery where sales_order_id = $1`, [plain])).transport_missing, false);

  // the forwarder's invoice on the order clears it
  await db.query(`insert into landed_costs (sales_order_id, kind, amount, currency, allocate_by) values ($1, 'freight', 250, 'EUR', 'value')`, [o]);
  assert.equal((await one<any>(db, `select transport_missing from v_order_delivery where sales_order_id = $1`, [o])).transport_missing, false);
  assert.equal((await all<any>(db, `select 1 from v_attention where code = 'transport_cost_missing'`)).length, 0);

  // a cost on the shipment counts too
  const o2 = await mkOrder(db, { pi: 'T2', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 12 }] });
  const sh = (await one<any>(db, `insert into shipments (container_number) values ('X1') returning id`)).id;
  await db.query(`insert into shipment_orders (shipment_id, sales_order_id) values ($1, $2)`, [sh, o2]);
  await db.query(`insert into landed_costs (shipment_id, kind, amount, currency, allocate_by) values ($1, 'forwarder', 90, 'EUR', 'value')`, [sh]);
  assert.equal((await one<any>(db, `select transport_missing from v_order_delivery where sales_order_id = $1`, [o2])).transport_missing, false);

  // create_order takes the term and place from the order screen
  const ref = (await one<any>(db, `select create_order($1::jsonb, $2::jsonb) as r`, [JSON.stringify({ customer_id: s.cust, order_type: 'EXW', pi_number: 'T3', incoterm: 'DAP', delivery_place: 'Hamburg' }),
    JSON.stringify([{ product_id: s.fixed, quantity: 5, unit_price: 12 }])])).r;
  const c = await one<any>(db, `select incoterm, delivery_place from sales_orders where pi_number = $1`, [ref]);
  assert.deepEqual([c.incoterm, c.delivery_place], ['DAP', 'Hamburg']);
});

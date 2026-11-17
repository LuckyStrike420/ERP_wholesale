import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, all } from './db.ts';
import { seed, mkOrder, num } from './fixtures.ts';

test('draft documents: order, customer, shipment and carton data; numbers do not repeat', async () => {
  const db = await freshDb(); const s = await seed(db);
  await db.query(`update customers set address = 'Street 1' || chr(10) || 'London' where id = $1`, [s.cust]);
  await db.query(`update app_settings set value = 'Your Products' where key = 'company_name'`);
  await db.query(`update products set units_per_carton = 24, carton_net_kg = 10.5, carton_weight_kg = 11.2, carton_length_cm = 60, carton_width_cm = 40, carton_height_cm = 30 where id = $1`, [s.fixed]);
  const id = await mkOrder(db, { pi: 'D1', type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }, { product: s.pct, qty: 5, price: 2 }] });

  // no shipment yet: the draft still works
  let d = (await one<any>(db, `select draft_document($1, 'packing_list') as d`, [id])).d;
  assert.equal(d.doc_number, 'PL-D1');
  assert.equal(d.shipment_id, null);
  assert.equal(d.header.consignee, 'Customer A\nStreet 1\nLondon');
  assert.equal(d.header.shipper, 'Your Products');
  assert.deepEqual(d.lines.map((l: any) => [l.description, num(l.qty), l.units_per_carton]), [['Fixed cost product', 100, 24], ['Percentage product', 5, null]]);
  assert.equal(num(d.lines[0].gross_kg_carton), 11.2);

  const sh = (await one<any>(db, `insert into shipments (container_number, port_loading) values ('MSKU1234567', 'Ningbo') returning id`)).id;
  await db.query(`insert into shipment_orders (shipment_id, sales_order_id) values ($1, $2)`, [sh, id]);
  d = (await one<any>(db, `select draft_document($1, 'packing_list') as d`, [id])).d;
  assert.deepEqual([d.shipment_id, d.header.container_number, d.header.port_loading], [sh, 'MSKU1234567', 'Ningbo']);

  await db.query(`insert into generated_documents (doc_type, doc_number, sales_order_id, header, lines) values ('packing_list', $1, $2, $3, $4)`, [d.doc_number, id, d.header, JSON.stringify(d.lines)]);
  assert.equal((await one<any>(db, `select draft_document($1, 'packing_list') as d`, [id])).d.doc_number, 'PL-D1-2');
  assert.equal((await one<any>(db, `select draft_document($1, 'delivery_note') as d`, [id])).d.doc_number, 'DN-D1');
  await assert.rejects(db.query(`insert into generated_documents (doc_type, doc_number, sales_order_id) values ('packing_list', 'PL-D1', $1)`, [id]), /unique|duplicate/);
  const tl = await all<any>(db, `select title from v_order_timeline where sales_order_id = $1 and kind = 'generated'`, [id]);
  assert.deepEqual(tl.map(t => t.title), ['Packing list PL-D1 made']);
});

test('contacts belong to exactly one customer or supplier; saved filters are per page and name', async () => {
  const db = await freshDb(); const s = await seed(db);
  await db.query(`insert into contacts (customer_id, name, role) values ($1, 'Anna', 'Purchasing')`, [s.cust]);
  await assert.rejects(db.query(`insert into contacts (customer_id, supplier_id, name) values ($1, $2, 'Both')`, [s.cust, s.sup]), /check/);
  await assert.rejects(db.query(`insert into contacts (name) values ('Nobody')`), /check/);
  await db.query(`insert into saved_views (page, name, query) values ('orders', 'JML open', 'customer=jml')`);
  assert.equal(num((await one<any>(db, `select count(*) as n from saved_views`)).n), 1);
});

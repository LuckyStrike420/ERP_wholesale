import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one } from './db.ts';
import { seed, mkOrder } from './fixtures.ts';

test('transport types: documents follow the terms and the shipment; a pick-up is collected once its date passed', async () => {
  const db = await freshDb(); const s = await seed(db);
  // EXW without a shipment: collected from our warehouse
  const exw = await mkOrder(db, { pi: 'X1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 12 }] });
  let d = (await one<any>(db, `select draft_document($1, 'packing_list') d`, [exw])).d;
  assert.equal(d.header.mode, 'pickup'); assert.equal(d.header.deliver_to, null);
  assert.match(d.header.pickup_address, /De Langkamp 6\n3961 MS Wijk bij Duurstede/);
  assert.equal(d.header.terms, 'EXW');
  // DDP with a place: road, terms with place
  await db.query(`update sales_orders set incoterm = 'DDP', delivery_place = 'Hamburg' where id = $1`, [exw]);
  d = (await one<any>(db, `select draft_document($1, 'delivery_note') d`, [exw])).d;
  assert.equal(d.header.mode, 'road'); assert.equal(d.header.terms, 'DDP Hamburg'); assert.notEqual(d.header.deliver_to, null);
  // a courier shipment wins over the terms
  const sh = (await one<any>(db, `insert into shipments (mode, carrier, tracking_number, etd) values ('courier', 'UPS', '1Z999', current_date + 3) returning id`)).id;
  await db.query(`insert into shipment_orders (shipment_id, sales_order_id) values ($1, $2)`, [sh, exw]);
  d = (await one<any>(db, `select draft_document($1, 'delivery_note') d`, [exw])).d;
  assert.deepEqual([d.header.mode, d.header.carrier, d.header.tracking_number], ['courier', 'UPS', '1Z999']);
  // statuses
  const p = (await one<any>(db, `insert into shipments (mode, collected_by, etd) values ('pickup', 'Spedition Müller', app_today() - 1) returning id`)).id;
  assert.equal((await one<any>(db, `select status from v_shipments where id = $1`, [p])).status, 'collected');
  assert.equal((await one<any>(db, `select status from v_shipments where id = $1`, [sh])).status, 'planned');
});

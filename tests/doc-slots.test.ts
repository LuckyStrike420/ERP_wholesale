import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, all } from './db.ts';
import { seed, mkOrder } from './fixtures.ts';

const slots = async (db: any, o: string) => Object.fromEntries((await all<any>(db, `select code, state, due_now from v_order_doc_slots where sales_order_id = $1`, [o])).map(r => [r.code, r]));

test('document slots: per terms, needed from a status, filled by an upload on order/shipment/PO, by the app, or waived', async () => {
  const db = await freshDb(); const s = await seed(db);
  const fob = await mkOrder(db, { pi: 'D1', type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 12 }] });
  let x = await slots(db, fob);
  assert.ok(x.bl && !x.cmr && !x.transport_invoice, 'FOB has a BL slot, no CMR');
  assert.equal(x.customer_po.due_now, true); assert.equal(x.customer_po.state, 'missing');
  assert.equal(x.packing_list.due_now, false);
  assert.equal((await all<any>(db, `select 1 from v_attention where code = 'document_missing' and entity_id = $1`, [fob])).length, 1);

  await db.query(`insert into attachments (entity_table, entity_id, doc_type, slot, file_name, storage_path) values ('sales_orders', $1, 'Customer PO', 'customer_po', 'po.pdf', 'x/po.pdf')`, [fob]);
  // BL on the shared shipment
  const sh = (await one<any>(db, `insert into shipments (container_number) values ('C1') returning id`)).id;
  await db.query(`insert into shipment_orders (shipment_id, sales_order_id) values ($1, $2)`, [sh, fob]);
  await db.query(`insert into attachments (entity_table, entity_id, doc_type, slot, file_name, storage_path) values ('shipments', $1, 'BL', 'bl', 'bl.pdf', 'x/bl.pdf')`, [sh]);
  // a packing list made in the app
  await db.query(`insert into generated_documents (sales_order_id, doc_type, doc_number, header, lines) values ($1, 'packing_list', 'PL-D1', '{}', '[]')`, [fob]);
  // waive the signed PI
  await db.query(`insert into order_doc_waivers (sales_order_id, slot, reason) values ($1, 'pi_signed', 'Customer confirmed by email')`, [fob]);
  x = await slots(db, fob);
  assert.deepEqual([x.customer_po.state, x.bl.state, x.packing_list.state, x.pi_signed.state], ['present', 'present', 'present', 'waived']);
  assert.equal((await all<any>(db, `select 1 from v_attention where code = 'document_missing' and entity_id = $1`, [fob])).length, 0);

  // DDP: CMR, POL and transport invoice, no BL
  const ddp = await mkOrder(db, { pi: 'D2', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 12 }] });
  await db.query(`update sales_orders set incoterm = 'DDP' where id = $1`, [ddp]);
  x = await slots(db, ddp);
  assert.ok(x.cmr && x.pol && x.transport_invoice && !x.bl);

  // a validation rule can require a slot
  assert.equal((await one<any>(db, `select requirement_met($1, 'doc:bl') ok`, [fob])).ok, true);
  assert.equal((await one<any>(db, `select requirement_met($1, 'doc:cmr') ok`, [ddp])).ok, false);
  assert.equal((await one<any>(db, `select requirement_met($1, 'doc:bl') ok`, [ddp])).ok, true, 'a slot that is not for these terms is met');
  await db.query(`insert into validation_rules (name, status, requirement) values ('CMR before delivered', 'delivered', 'doc:cmr')`);
});

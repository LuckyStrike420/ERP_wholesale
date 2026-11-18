import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one } from './db.ts';
import { seed, mkOrder, num } from './fixtures.ts';

test('VAT: EXW with a Dutch customer adds 21% or 9% per product to what is due; revenue and margin stay without VAT', async () => {
  const db = await freshDb(); const s = await seed(db);
  const nl = (await one<any>(db, `insert into customers (name, country) values ('Dutch BV', 'Netherlands') returning id`)).id;
  const food = (await one<any>(db, `insert into products (name, vat_rate) values ('Snack', 0.09) returning id`)).id;
  await db.query(`update products set vat_rate = 0.21 where id = $1`, [s.fixed]);

  const id = await mkOrder(db, { pi: 'V1', type: 'EXW', customer: nl, lines: [{ product: s.fixed, qty: 10, price: 10 }, { product: food, qty: 10, price: 10 }] });
  let o = await one<any>(db, `select vat_applies, order_value, vat_amount, total_receivable, outstanding, margin from v_orders where id = $1`, [id]);
  assert.equal(o.vat_applies, true);
  assert.deepEqual([num(o.order_value), num(o.vat_amount), num(o.total_receivable), num(o.outstanding)], [200, 30, 230, 230]);

  // a rate change on the product does not change a line already sold
  await db.query(`update products set vat_rate = 0.09 where id = $1`, [s.fixed]);
  assert.equal(num((await one<any>(db, `select vat_amount from v_orders where id = $1`, [id])).vat_amount), 30);

  // switched off on the order: no VAT
  await db.query(`update sales_orders set vat_applies = false where id = $1`, [id]);
  assert.equal(num((await one<any>(db, `select total_receivable from v_orders where id = $1`, [id])).total_receivable), 200);

  // FOB, or a customer outside the Netherlands: no VAT
  const fob = await mkOrder(db, { pi: 'V2', type: 'FOB', customer: nl, lines: [{ product: s.fixed, qty: 1, price: 100 }] });
  const abroad = await mkOrder(db, { pi: 'V3', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 1, price: 100 }] });
  for (const x of [fob, abroad]) assert.equal(num((await one<any>(db, `select vat_amount from v_orders where id = $1`, [x])).vat_amount), 0);

  // purchase side: EXW PO to a Dutch supplier pays VAT on top of the purchase value
  const sup = (await one<any>(db, `insert into suppliers (name, country) values ('NL Supplier', 'Nederland') returning id`)).id;
  const po = (await one<any>(db, `insert into purchase_orders (po_number, supplier_id, order_type, currency) values ('P-V', $1, 'EXW', 'EUR') returning id, vat_applies`, [sup]));
  assert.equal(po.vat_applies, true);
  const id4 = await mkOrder(db, { pi: 'V4', type: 'EXW', customer: nl, lines: [{ product: food, qty: 100, price: 10 }] });
  await db.query(`update sales_order_lines set purchase_order_id = $1, cost_override = 5 where sales_order_id = $2`, [po.id, id4]);
  let p = await one<any>(db, `select expected_amount, vat_amount, payable, outstanding from v_purchase_orders where id = $1`, [po.id]);
  assert.deepEqual([num(p.expected_amount), num(p.vat_amount), num(p.payable)], [500, 45, 545]);
  // the supplier invoice (without VAT) sets the base; VAT follows
  await db.query(`insert into supplier_invoices (purchase_order_id, invoice_number, invoice_date, amount) values ($1, 'SI-1', '2026-11-10', 520)`, [po.id]);
  p = await one<any>(db, `select vat_amount, payable from v_purchase_orders where id = $1`, [po.id]);
  assert.deepEqual([num(p.vat_amount), num(p.payable)], [46.8, 566.8]);
});

test('VAT: switched on after the PI went out, the fixed deposit follows the new total', async () => {
  const db = await freshDb(); const s = await seed(db);
  const id = await mkOrder(db, { pi: 'VD', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 10 }] });
  await db.query(`update sales_orders set deposit_pct = 1 where id = $1`, [id]);
  await db.query(`update sales_orders set status = 'po_received' where id = $1`, [id]);
  const before = await one<any>(db, `select deposit_amount from sales_orders where id = $1`, [id]);
  assert.equal(num(before.deposit_amount), 100);
  await db.query(`update sales_orders set vat_applies = true where id = $1`, [id]);
  const o = await one<any>(db, `select deposit_due, balance_due, total_receivable from v_orders where id = $1`, [id]);
  assert.deepEqual([num(o.total_receivable), num(o.deposit_due), num(o.balance_due)], [121, 121, 0]);
});

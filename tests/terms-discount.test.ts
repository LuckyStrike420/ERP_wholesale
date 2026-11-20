import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, all } from './db.ts';
import { seed, mkOrder } from './fixtures.ts';

test('payment terms: days after delivery; 3% discount within 14 days, net 30, booked as a write-off', async () => {
  const db = await freshDb(); const s = await seed(db);
  const term = (await one<any>(db, `insert into payment_terms (name, deposit_pct, deposit_anchor, deposit_days, balance_anchor, balance_days, discount_pct, discount_days)
    values ('3% 14 days, net 30 after delivery', 1, 'delivery_date', 30, null, 0, 0.03, 14) returning id`)).id;
  const o = await mkOrder(db, { pi: 'K1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  await db.query(`update sales_orders set payment_term_id = $2, vat_applies = false, deposit_pct = 1 where id = $1`, [o, term]);
  let v = await one<any>(db, `select deposit_due_date, discount_until, discount_amount, total_receivable from v_orders where id = $1`, [o]);
  assert.equal(v.deposit_due_date, null, 'no delivery yet: no due date');
  // collected on 1 Nov
  const sh = (await one<any>(db, `insert into shipments (mode, etd, collected_by) values ('pickup', '2026-11-01', 'X') returning id`)).id;
  await db.query(`insert into shipment_orders (shipment_id, sales_order_id) values ($1, $2)`, [sh, o]);
  v = await one<any>(db, `select deposit_due_date, discount_until, discount_amount, delivery_date from v_orders where id = $1`, [o]);
  const iso = (d: any) => new Date(d).toISOString().slice(0, 10);
  assert.equal(iso(v.deposit_due_date), '2026-12-01'); assert.equal(iso(v.discount_until), '2026-11-15'); assert.equal(Number(v.discount_amount), 30);
  // paid 970 on 10 Nov: discount can be booked
  const p = (await one<any>(db, `insert into payments (direction, customer_id, payment_date, amount, currency) values ('in', $1, '2026-11-10', 970, 'EUR') returning id`, [s.cust])).id;
  await db.query(`insert into payment_allocations (payment_id, sales_order_id, amount) values ($1, $2, 970)`, [p, o]);
  v = await one<any>(db, `select outstanding, discount_to_book from v_orders where id = $1`, [o]);
  assert.equal(Number(v.outstanding), 30); assert.equal(v.discount_to_book, true);
  assert.equal((await all<any>(db, `select 1 from v_attention where code = 'early_discount_to_book' and entity_id = $1`, [o])).length, 1);
  await db.query(`select book_early_discount($1)`, [o]);
  v = await one<any>(db, `select outstanding, payment_status, discount_to_book from v_orders where id = $1`, [o]);
  assert.equal(Number(v.outstanding), 0); assert.equal(v.payment_status, 'paid'); assert.equal(v.discount_to_book, false);
  assert.match((await one<any>(db, `select reason from write_offs where sales_order_id = $1`, [o])).reason, /Early payment discount 3/);
});

test('discount: a late payment cannot book it', async () => {
  const db = await freshDb(); const s = await seed(db);
  const term = (await one<any>(db, `insert into payment_terms (name, deposit_pct, deposit_anchor, deposit_days, discount_pct, discount_days) values ('3/14 net 30 invoice', 1, 'invoice_date', 30, 0.03, 14) returning id`)).id;
  const o = await mkOrder(db, { pi: 'K2', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  await db.query(`update sales_orders set payment_term_id = $2, vat_applies = false, deposit_pct = 1 where id = $1`, [o, term]);
  await db.query(`insert into invoices (sales_order_id, invoice_number, invoice_date) values ($1, 'F1', '2026-11-01')`, [o]);
  const p = (await one<any>(db, `insert into payments (direction, customer_id, payment_date, amount, currency) values ('in', $1, '2026-11-20', 970, 'EUR') returning id`, [s.cust])).id;
  await db.query(`insert into payment_allocations (payment_id, sales_order_id, amount) values ($1, $2, 970)`, [p, o]);
  assert.equal((await one<any>(db, `select discount_to_book from v_orders where id = $1`, [o])).discount_to_book, false);
  await assert.rejects(db.query(`select book_early_discount($1)`, [o]), /no early payment discount/);
});

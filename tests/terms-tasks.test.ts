import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, all } from './db.ts';
import { seed, mkOrder, num } from './fixtures.ts';

const D = `*, deposit_due_date::text as dd, balance_due_date::text as bd`;
const term = async (db: any, name: string) => (await one<any>(db, `select id from payment_terms where name = $1`, [name])).id;

test('payment terms: due dates follow the term, a typed date wins, orders without a term keep the old rule', async () => {
  const db = await freshDb('2026-11-10'); const s = await seed(db);
  const t3070 = await term(db, '30% deposit / 70% balance'), t100 = await term(db, '100% payment');
  await db.query(`update customer_terms set payment_term_id = $2 where customer_id = $1 and order_type = 'FOB'`, [s.cust, t3070]);
  await db.query(`update customer_terms set payment_term_id = $2 where customer_id = $1 and order_type = 'EXW'`, [s.cust, t100]);

  // FOB 30/70: deposit 7 days after the order date (PO date while there is no PI date), balance 10 days before ETA
  const fob = await mkOrder(db, { pi: 'T1', type: 'FOB', customer: s.cust, poDate: '2026-10-01', lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  let o = await one<any>(db, `select ${D} from v_orders where id = $1`, [fob]);
  assert.equal(o.payment_term_name, '30% deposit / 70% balance');
  assert.equal(num(o.deposit_pct), 0.3);
  assert.equal(o.dd, '2026-10-08');
  assert.equal(o.balance_due_date, null);                              // ETA unknown: no balance date, never "late"
  assert.equal(num(o.overdue_amount), 300);                             // deposit 300 was due on 8 Oct
  const item = await one<any>(db, `select * from v_open_items where id = $1`, [fob]);
  assert.equal(item.bucket, 'overdue');

  const sh = (await one<any>(db, `insert into shipments (eta) values ('2026-12-20') returning id`)).id;
  await db.query(`insert into shipment_orders (shipment_id, sales_order_id) values ($1, $2)`, [sh, fob]);
  o = await one<any>(db, `select ${D} from v_orders where id = $1`, [fob]);
  assert.equal(o.bd, '2026-12-10');

  await db.query(`update sales_orders set deposit_due_date = '2026-11-30' where id = $1`, [fob]);   // typed on the order: wins
  o = await one<any>(db, `select ${D} from v_orders where id = $1`, [fob]);
  assert.equal(o.dd, '2026-11-30');
  assert.equal(o.deposit_due_date_set, true);
  assert.equal(num(o.overdue_amount), 0);

  // EXW 100%: everything due at ETD
  const exw = await mkOrder(db, { pi: 'T2', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 10 }] });
  o = await one<any>(db, `select ${D} from v_orders where id = $1`, [exw]);
  assert.deepEqual([num(o.deposit_pct), num(o.deposit_due), o.deposit_due_date], [1, 100, null]);
  const sh2 = (await one<any>(db, `insert into shipments (etd) values ('2026-11-05') returning id`)).id;
  await db.query(`insert into shipment_orders (shipment_id, sales_order_id) values ($1, $2)`, [sh2, exw]);
  o = await one<any>(db, `select ${D} from v_orders where id = $1`, [exw]);
  assert.equal(o.dd, '2026-11-05');
  assert.equal(num(o.overdue_amount), 100);

  // another customer without a term: old rule, no dates
  const legacy = await mkOrder(db, { pi: 'T3', type: 'FOB', customer: s.cust2, lines: [{ product: s.fixed, qty: 10, price: 10 }] });
  o = await one<any>(db, `select * from v_orders where id = $1`, [legacy]);
  assert.deepEqual([o.payment_term_id, o.deposit_due_date, o.balance_due_date], [null, null, null]);
});

test('payment terms: changing the term changes the deposit; existing customers are linked by their deposit %', async () => {
  const db = await freshDb(); const s = await seed(db);
  await db.query(`update customer_terms set deposit_pct = 0.2 where customer_id = $1 and order_type = 'FOB'`, [s.cust2]);
  await db.query(`select link_payment_terms()`);
  const links = await all<any>(db, `select c.name, ct.order_type, pt.name as term from customer_terms ct join customers c on c.id = ct.customer_id join payment_terms pt on pt.id = ct.payment_term_id order by 1, 2`);
  assert.deepEqual(links.map(l => l.term), ['100% payment', '30% deposit / 70% balance', '100% payment', '20% deposit / 80% balance']);
  const t20 = await one<any>(db, `select * from payment_terms where name = '20% deposit / 80% balance'`);
  assert.deepEqual([t20.deposit_anchor, t20.deposit_days, t20.balance_anchor, t20.balance_days], ['order_date', 7, 'eta', -10]);

  const id = await mkOrder(db, { pi: 'T4', type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  await db.query(`update sales_orders set status = 'po_received' where id = $1`, [id]);           // deposit fixed at 300
  assert.equal(num((await one<any>(db, `select deposit_amount from sales_orders where id = $1`, [id])).deposit_amount), 300);
  await db.query(`update sales_orders set payment_term_id = $2 where id = $1`, [id, t20.id]);
  const o = await one<any>(db, `select * from v_orders where id = $1`, [id]);
  assert.deepEqual([num(o.deposit_pct), num(o.deposit_due), o.payment_term_name], [0.2, 200, '20% deposit / 80% balance']);

  // a term's percentage change reaches the customers that use it (new orders), not existing orders
  await db.query(`update payment_terms set deposit_pct = 0.25 where id = $1`, [t20.id]);
  assert.equal(num((await one<any>(db, `select deposit_pct from customer_terms where customer_id = $1 and order_type = 'FOB'`, [s.cust2])).deposit_pct), 0.25);
  assert.equal(num((await one<any>(db, `select deposit_pct from sales_orders where id = $1`, [id])).deposit_pct), 0.2);

  // the order screen can choose a term
  const lines = JSON.stringify([{ idx: 1, product_id: s.fixed, quantity: 100, unit_price: 10 }]);
  const p = (await one<any>(db, `select preview_order($1,'FOB','2026-11-01',$2::jsonb,$3) as p`, [s.cust, lines, t20.id])).p;
  assert.deepEqual([num(p.order.deposit_due), p.order.payment_term_name], [250, '20% deposit / 80% balance']);
  await db.query(`select create_order($1::jsonb,$2::jsonb)`, [JSON.stringify({ customer_id: s.cust, order_type: 'FOB', pi_number: 'T5', po_date: '2026-11-01', payment_term_id: t20.id }), lines]);
  assert.equal((await one<any>(db, `select payment_term_name from v_orders where pi_number = 'T5'`)).payment_term_name, '20% deposit / 80% balance');
});

test('tasks are always linked, show on the customer of their order, and appear with notes, payments and documents in the timeline', async () => {
  const db = await freshDb('2026-11-10'); const s = await seed(db);
  const id = await mkOrder(db, { pi: 'T6', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 10 }] });
  await assert.rejects(db.query(`insert into tasks (title) values ('floating task')`), /check/);
  const task = (await one<any>(db, `insert into tasks (title, due_date, sales_order_id) values ('Chase deposit', '2026-11-08', $1) returning *`, [id]));
  assert.equal(task.customer_id, s.cust);
  let v = await one<any>(db, `select * from v_tasks where id = $1`, [task.id]);
  assert.deepEqual([v.state, num(v.days_late), v.pi_number, v.customer_name], ['overdue', 2, 'T6', 'Customer A']);
  await db.query(`update tasks set status = 'done' where id = $1`, [task.id]);
  v = await one<any>(db, `select * from v_tasks where id = $1`, [task.id]);
  assert.equal(v.state, 'done'); assert.ok(v.done_at);
  await db.query(`update tasks set status = 'open' where id = $1`, [task.id]);
  assert.equal((await one<any>(db, `select done_at from tasks where id = $1`, [task.id])).done_at, null);

  await db.query(`insert into record_notes (body, sales_order_id) values ('Customer asked for split shipment', $1)`, [id]);
  const pay = (await one<any>(db, `insert into payments (direction, customer_id, payment_date, amount, currency, reference) values ('in', $1, '2026-11-09', 50, 'EUR', 'TT') returning id`, [s.cust])).id;
  await db.query(`insert into payment_allocations (payment_id, sales_order_id, amount) values ($1, $2, 50)`, [pay, id]);
  await db.query(`insert into attachments (entity_table, entity_id, doc_type, file_name, storage_path) values ('sales_orders', $1, 'PI', 'pi.pdf', 'x/pi.pdf')`, [id]);
  await assert.rejects(db.query(`insert into attachments (entity_table, entity_id, file_name, storage_path) values ('nonsense', $1, 'a', 'b')`, [id]), /check/);

  const kinds = (await all<any>(db, `select kind from v_order_timeline where sales_order_id = $1`, [id])).map(r => r.kind).sort();
  for (const k of ['created', 'task', 'note', 'payment', 'document']) assert.ok(kinds.includes(k), `timeline misses ${k}: ${kinds}`);
  const payRow = await one<any>(db, `select * from v_order_timeline where sales_order_id = $1 and kind = 'payment'`, [id]);
  assert.deepEqual([payRow.title, num(payRow.amount), payRow.detail], ['Payment received', 50, 'TT']);
});

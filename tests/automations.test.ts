import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, all } from './db.ts';
import { seed, mkOrder, num } from './fixtures.ts';

test('starting rules: PI sent → deposit task once; ETA within 14 days → balance task; low margin → flag', async () => {
  const db = await freshDb('2026-11-10'); const s = await seed(db);
  const id = await mkOrder(db, { pi: 'A1', type: 'FOB', customer: s.cust, poDate: '2026-11-01', lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  // the order is created as "PI sent" and its deposit is open: one task, made at once
  let tasks = await all<any>(db, `select title, due_date::text as due, sales_order_id from tasks`);
  assert.deepEqual(tasks.map(t => t.title), ['Chase deposit PI A1 (Customer A)']);
  await db.query(`select run_automations()`); await db.query(`update sales_orders set notes = 'x' where id = $1`, [id]);
  assert.equal(num((await one<any>(db, `select count(*) as n from tasks`)).n), 1);           // never twice
  await db.query(`delete from tasks`); await db.query(`select run_automations()`);
  assert.equal(num((await one<any>(db, `select count(*) as n from tasks`)).n), 0);           // deleted stays deleted

  // ETA 2026-11-20 is within 14 days of 10 Nov and the balance is open
  const sh = (await one<any>(db, `insert into shipments (eta) values ('2026-11-20') returning id`)).id;
  await db.query(`insert into shipment_orders (shipment_id, sales_order_id) values ($1, $2)`, [sh, id]);
  tasks = await all<any>(db, `select title from tasks`);
  assert.deepEqual(tasks.map(t => t.title), ['Chase balance PI A1 (Customer A)']);

  // margin: the fixed cost product costs 4.56 per piece → sold at 10 no flag; sold at 5.00 → 8.8% → flag
  assert.equal((await all<any>(db, `select * from v_order_flags where sales_order_id = $1`, [id])).length, 0);
  await db.query(`update sales_order_lines set unit_price = 5 where sales_order_id = $1`, [id]);
  const flags = await all<any>(db, `select flag_text from v_order_flags where sales_order_id = $1`, [id]);
  assert.equal(flags.length, 1); assert.match(flags[0].flag_text, /^Low margin: \d/);
});

test('a new status rule does not fire on orders that reached the status before it existed; it does for later ones', async () => {
  const db = await freshDb('2026-11-10'); const s = await seed(db);
  await db.query(`update automation_rules set active = false`);
  const old = await mkOrder(db, { pi: 'B1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 1, price: 10 }] });
  await db.query(`insert into automation_rules (name, trigger_type, status, action, task_title, task_due, task_due_days, created_at)
                  values ('Shipped: ask for feedback', 'status_reached', 'po_received', 'task', 'Ask {customer} about {pi}', 'today', 3, now() + interval '1 second')`);
  await db.query(`update sales_orders set status = 'po_received' where id = $1`, [old]);   // the change itself happens before the rule's start
  await new Promise(r => setTimeout(r, 1100));
  const later = await mkOrder(db, { pi: 'B2', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 1, price: 10 }] });
  await db.query(`update sales_orders set status = 'po_received' where id = $1`, [later]);
  const t = await all<any>(db, `select title, due_date::text as due from tasks`);
  assert.deepEqual(t.map(x => [x.title, x.due]), [['Ask Customer A about B2', '2026-11-13']]);
});

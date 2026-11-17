import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, all } from './db.ts';
import { seed, mkOrder, num } from './fixtures.ts';

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
const as = (db: any, u: string) => db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: u })]);

test('assigning a task to someone else and @mentioning them create a notification for them only', async () => {
  const db = await freshDb(); const s = await seed(db);
  await db.query(`insert into profiles (user_id, full_name, role) values ($1, 'Sander', 'admin'), ($2, 'Bob Builder', 'operations')`, [A, B]);
  const id = await mkOrder(db, { pi: 'N1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 1, price: 1 }] });
  await as(db, A);
  await db.query(`insert into tasks (title, sales_order_id, assigned_to, due_date) values ('Check carton marks', $1, $2, '2026-11-20')`, [id, B]);
  await db.query(`insert into tasks (title, sales_order_id, assigned_to) values ('My own task', $1, $2)`, [id, A]);   // to yourself: no message
  await db.query(`insert into record_notes (body, sales_order_id) values ('@bob builder can you call them? cc @Sander', $1)`, [id]);
  const rows = await all<any>(db, `select user_id, kind, title, body, pi_number, actor_name from v_notifications order by kind`);
  assert.deepEqual(rows.map(r => [r.user_id, r.kind]), [[B, 'mention'], [B, 'task_assigned']]);   // Sander wrote it, so no mention for Sander
  assert.equal(rows[0].title, 'Sander mentioned you');
  assert.equal(rows[1].title, 'Task for you: Check carton marks');
  assert.equal(rows[1].body, 'Due 20-11-2026');
  assert.deepEqual([rows[0].pi_number, rows[0].actor_name], ['N1', 'Sander']);
  // reassigning tells the new person
  await db.query(`update tasks set assigned_to = $1 where title = 'My own task'`, [B]);
  assert.equal(num((await one<any>(db, `select count(*) as n from notifications where user_id = $1`, [B])).n), 3);
});

test('favourites are unique per user and record', async () => {
  const db = await freshDb(); const s = await seed(db);
  await as(db, A);
  await db.query(`insert into favorites (entity_type, entity_id, label, path) values ('customer', $1, 'Customer A', '/customers/customer-a')`, [s.cust]);
  await assert.rejects(db.query(`insert into favorites (entity_type, entity_id, label, path) values ('customer', $1, 'Customer A', '/customers/customer-a')`, [s.cust]), /unique|duplicate/);
  assert.equal((await one<any>(db, `select user_id from favorites`)).user_id, A);
});

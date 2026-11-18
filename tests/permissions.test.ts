import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one } from './db.ts';
import { seed, mkOrder } from './fixtures.ts';

const ADMIN = '00000000-0000-0000-0000-0000000000a1', OPS = '00000000-0000-0000-0000-0000000000a2';
const as = (db: any, u: string) => db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: u })]);
const fails = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: any) => re.test(e.message));

test('permissions: everything allowed until an admin switches it off; then the database refuses', async () => {
  const db = await freshDb(); const s = await seed(db);
  await db.query(`insert into profiles (user_id, full_name, role) values ($1, 'Admin', 'admin'), ($2, 'Ops', 'operations')`, [ADMIN, OPS]);
  const id = await mkOrder(db, { pi: 'PM1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 10 }] });

  await as(db, OPS);
  assert.equal((await one<any>(db, `select can('edit_prices') as ok`)).ok, true);
  await db.query(`update sales_order_lines set unit_price = 11 where sales_order_id = $1`, [id]);

  await db.query(`select set_config('request.jwt.claims', '', false)`);
  await db.query(`update role_permissions set allowed = false where role = 'operations' and permission in ('edit_prices', 'delete_records')`);
  await as(db, OPS);
  assert.equal((await one<any>(db, `select can('edit_prices') as ok`)).ok, false);
  await fails(db.query(`update sales_order_lines set unit_price = 12 where sales_order_id = $1`, [id]), /may not change sale prices/);
  await fails(db.query(`delete from sales_order_lines where sales_order_id = $1`, [id]), /may not delete order lines/);
  // other changes on the line still work
  await db.query(`update sales_order_lines set notes = 'ok' where sales_order_id = $1`, [id]);

  // the admin may always
  await as(db, ADMIN);
  await db.query(`update sales_order_lines set unit_price = 12 where sales_order_id = $1`, [id]);
  assert.equal((await one<any>(db, `select can('delete_records') as ok`)).ok, true);
});

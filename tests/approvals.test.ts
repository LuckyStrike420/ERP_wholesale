import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one } from './db.ts';
import { seed, mkOrder } from './fixtures.ts';

const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b';
const as = (db: any, u: string) => db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: u })]);
const fails = async (p: Promise<unknown>, re: RegExp) => { await assert.rejects(p, (e: any) => re.test(e.message)); };

test('approvals: a low-margin order cannot leave Draft until approved; the approval holds while the margin does', async () => {
  const db = await freshDb(); const s = await seed(db);
  await db.query(`insert into profiles (user_id, full_name, role) values ($1, 'Sander', 'admin'), ($2, 'Bob Builder', 'operations')`, [A, B]);
  await db.query(`update approval_policies set active = true, margin_below = 0.10`);
  // the fixed-cost product: find a price that gives a margin below 10%
  const draft = await mkOrder(db, { type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 1 }] });
  const o = await one<any>(db, `select margin_pct, cost_missing_lines from v_orders where id = $1`, [draft]);
  const unitCost = 1 - Number(o.margin_pct);              // cost per unit when sold at 1
  const low = Math.round(unitCost / 0.95 * 100) / 100;    // ~5% margin
  await db.query(`update sales_order_lines set unit_price = $1 where sales_order_id = $2`, [low, draft]);
  assert.equal((await db.query(`select 1 from v_order_approval where sales_order_id = $1`, [draft])).rows.length, 1);

  // Bob cannot send the PI
  await as(db, B);
  await fails(db.query(`update sales_orders set pi_number = 'AP1', status = 'pi_sent' where id = $1`, [draft]), /Approval needed first/);
  assert.equal((await one<any>(db, `select status from sales_orders where id = $1`, [draft])).status, 'draft');

  // Bob asks; Sander is told; Bob cannot decide himself
  const aid = (await one<any>(db, `select request_approval($1, 'Volume deal') as id`, [draft])).id;
  await as(db, A);
  const n = await one<any>(db, `select kind, title from notifications where user_id = $1`, [A]);
  assert.equal(n.kind, 'approval_request');
  await as(db, B);
  await fails(db.query(`select decide_approval($1, true)`, [aid]), /Only an admin/);
  await as(db, A);
  await db.query(`select decide_approval($1, true, 'OK this once')`, [aid]);
  assert.equal((await one<any>(db, `select kind from notifications where user_id = $1`, [B])).kind, 'approval_decided');

  // now it can go; lowering the price after approval would make it invalid again (checked on a second order)
  await as(db, B);
  await db.query(`update sales_orders set pi_number = 'AP1', status = 'pi_sent' where id = $1`, [draft]);
  assert.equal((await one<any>(db, `select status from sales_orders where id = $1`, [draft])).status, 'pi_sent');

  const second = await mkOrder(db, { type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: low }] });
  const a2 = (await one<any>(db, `select request_approval($1) as id`, [second])).id;
  await as(db, A); await db.query(`select decide_approval($1, true)`, [a2]);
  await db.query(`update sales_order_lines set unit_price = $1 where sales_order_id = $2`, [Math.round(unitCost * 100) / 100, second]);
  await fails(db.query(`update sales_orders set status = 'pi_sent', pi_number = 'AP2' where id = $1`, [second]), /Approval needed first/);

  // a healthy margin passes without asking; orders already past Draft are never blocked
  const fine = await mkOrder(db, { type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 100 }] });
  await db.query(`update sales_orders set status = 'pi_sent', pi_number = 'AP3' where id = $1`, [fine]);
  await db.query(`update sales_order_lines set unit_price = $1 where sales_order_id = $2`, [low, fine]);
  await db.query(`update sales_orders set status = 'po_received' where id = $1`, [fine]);

  // the order composer keeps a blocked order as Draft and asks for approval itself
  const ref = (await one<any>(db, `select create_order($1, $2) as r`, [
    JSON.stringify({ customer_id: s.cust, order_type: 'EXW', pi_number: 'AP4', po_date: '2026-11-10' }),
    JSON.stringify([{ product_id: s.fixed, quantity: 10, unit_price: low }])])).r;
  assert.equal(ref, 'AP4');
  const c = await one<any>(db, `select o.status, a.status as ask from sales_orders o join approvals a on a.sales_order_id = o.id where o.pi_number = 'AP4'`);
  assert.deepEqual([c.status, c.ask], ['draft', 'pending']);
  // and moves a healthy one straight to PI sent
  await db.query(`select create_order($1, $2)`, [JSON.stringify({ customer_id: s.cust, order_type: 'EXW', pi_number: 'AP5', po_date: '2026-11-10' }),
    JSON.stringify([{ product_id: s.fixed, quantity: 10, unit_price: 100 }])]);
  assert.equal((await one<any>(db, `select status from sales_orders where pi_number = 'AP5'`)).status, 'pi_sent');
});

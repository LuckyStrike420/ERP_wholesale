import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one } from './db.ts';
import { seed, mkOrder, num } from './fixtures.ts';

const count = async (db: any, sql: string, p: unknown[] = []) => (await one<any>(db, `select count(*)::int as n from ${sql}`, p)).n;

test('recycle bin: a deleted order comes back with its lines, tasks and notes; a single line too', async () => {
  const db = await freshDb(); const s = await seed(db);
  const id = await mkOrder(db, { pi: 'B1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 10 }, { product: s.fixed, qty: 5, price: 12 }] });
  await db.query(`insert into tasks (title, sales_order_id) values ('Call', $1)`, [id]);
  await db.query(`insert into record_notes (body, sales_order_id) values ('Note', $1)`, [id]);
  const before = await one<any>(db, `select order_value, total_receivable from v_orders where id = $1`, [id]);

  await db.query(`delete from sales_orders where id = $1`, [id]);
  assert.equal(await count(db, `sales_orders where id = $1`, [id]), 0);
  const bin = await one<any>(db, `select batch, label, rows, main_table from v_recycle_bin`);
  const tasks = await count(db, `recycle_bin where table_name = 'tasks'`);   // ours + any the automation rules made
  assert.deepEqual([bin.label, bin.rows, bin.main_table], ['PI B1 · ' + (await one<any>(db, `select name from customers where id = $1`, [s.cust])).name, 4 + tasks, 'sales_orders']);

  assert.equal(await one<any>(db, `select restore_deleted($1) as n`, [bin.batch]).then(r => r.n), 4 + tasks);
  const after = await one<any>(db, `select order_value, total_receivable from v_orders where id = $1`, [id]);
  assert.deepEqual([num(after.order_value), num(after.total_receivable)], [num(before.order_value), num(before.total_receivable)]);
  assert.equal(await count(db, `tasks where sales_order_id = $1`, [id]), tasks);
  assert.equal(await count(db, `recycle_bin`), 0);

  // one line
  await db.query(`delete from sales_order_lines where sales_order_id = $1 and line_no = 2`, [id]);
  const b2 = await one<any>(db, `select batch, label from v_recycle_bin`);
  assert.match(b2.label, /^Line 2 of PI B1/);
  await db.query(`select restore_deleted($1)`, [b2.batch]);
  assert.equal(await count(db, `sales_order_lines where sales_order_id = $1`, [id]), 2);

  // older than 30 days goes
  await db.query(`delete from sales_order_lines where sales_order_id = $1 and line_no = 2`, [id]);
  await db.query(`update recycle_bin set deleted_at = now() - interval '31 days'`);
  assert.equal((await one<any>(db, `select purge_recycle_bin() as n`)).n, 1);
});

test('validation rules: forward moves are checked, back moves and imports are not', async () => {
  const db = await freshDb(); const s = await seed(db);
  await db.query(`update validation_rules set active = true`);
  // PI without a customer PO
  const id = await mkOrder(db, { type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 10, price: 10 }] });
  await db.query(`update sales_orders set customer_po = null where id = $1`, [id]);
  await assert.rejects(db.query(`update sales_orders set pi_number = 'V1', status = 'pi_sent' where id = $1`, [id]), /customer's PO number/);
  assert.equal((await one<any>(db, `select count(*)::int as n from v_order_rule_checks where sales_order_id = $1`, [id])).n, 2);
  await db.query(`update sales_orders set customer_po = 'C-1', pi_number = 'V1', status = 'pi_sent' where id = $1`, [id]);

  // FOB shipped needs a B/L, also when it jumps several steps
  await assert.rejects(db.query(`update sales_orders set status = 'delivered' where id = $1`, [id]), /B\/L number/);
  const sh = (await one<any>(db, `insert into shipments (bl_number) values ('BL-9') returning id`)).id;
  await db.query(`insert into shipment_orders (shipment_id, sales_order_id) values ($1, $2)`, [sh, id]);
  await db.query(`update sales_orders set status = 'shipped' where id = $1`, [id]);
  // back is fine even when a rule is no longer met
  await db.query(`update shipments set bl_number = null where id = $1`, [sh]);
  await db.query(`update sales_orders set status = 'ready_to_ship' where id = $1`, [id]);
  // an import may set any status
  await db.query(`set app.no_automations = 'on'`);
  await db.query(`update sales_orders set status = 'shipped' where id = $1`, [id]);
});

test('ECB rates: the CSV answer is read by its column names', async () => {
  const db = await freshDb();
  const csv = 'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS\r\n'
    + 'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-11-09,1.1520,A\r\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-11-10,1.1600,A\r\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-11-11,NaN,M\r\n';
  const r = (await db.query<any>(`select rate_date::text as d, per_eur from ecb_csv_rates($1)`, [csv])).rows;
  assert.deepEqual(r.map(x => [x.d, num(x.per_eur)]), [['2026-11-09', 1.152], ['2026-11-10', 1.16]]);
  await assert.rejects(db.query(`select * from ecb_csv_rates('nonsense\nrow')`), /not understood/);
});

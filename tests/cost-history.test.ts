import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, all } from './db.ts';
import { seed, mkOrder, order, num } from './fixtures.ts';

// Audit package 2: cost history, settings and price agreements.

test('OMS-010: invalid settings are refused, valid ones accepted', async () => {
  const db = await freshDb();
  const set = (k: string, v: string) => db.query(`update app_settings set value = $2 where key = $1`, [k, v]);
  await assert.rejects(set('cost_decimals', 'abc'), /not a valid number/);
  await assert.rejects(set('cost_decimals', '100'), /0 to 6/);
  await assert.rejects(set('cost_decimals', '2.5'), /whole number/);
  await assert.rejects(set('payment_tolerance', '5'), /between 0 and 1/);
  await assert.rejects(set('payment_tolerance', '-1'), /not a valid number/);
  await assert.rejects(set('exw_reminder_working_days', '61'), /0 to 60/);
  await assert.rejects(set('fob_balance_days_before_eta', '366'), /0 to 365/);
  await assert.rejects(set('reporting_currency', 'GBP'), /order currencies/);
  await set('cost_decimals', '4'); await set('payment_tolerance', '0.05'); await set('reporting_currency', 'USD');
  assert.equal(num((await one<any>(db, `select setting_num('cost_decimals') as v`)).v), 4);
});

test('OMS-010: a setting change can be previewed without saving', async () => {
  const db = await freshDb(); const s = await seed(db);
  const o = await mkOrder(db, { pi: 'T1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  await db.query(`select register_customer_payment($1,'2026-10-02',999.70,'B1')`, [o]);                  // 0.30 outstanding
  assert.equal((await order(db, o)).payment_status, 'partially_paid');
  const p = await all<any>(db, `select * from preview_setting_change('payment_tolerance', '0.5')`);
  const paid = p.find(r => r.metric === 'orders_paid' && r.currency === 'EUR');
  assert.deepEqual([num(paid.value_before), num(paid.value_after)], [0, 1]);
  assert.equal((await one<any>(db, `select value from app_settings where key = 'payment_tolerance'`)).value, '0.01');   // nothing saved
  assert.equal(num((await one<any>(db, `select setting_num('payment_tolerance') as v`)).v), 0.01);                       // override is gone
  assert.equal((await order(db, o)).payment_status, 'partially_paid');
  await assert.rejects(db.query(`select * from preview_setting_change('payment_tolerance', 'x')`), /not a valid number/);
});

test('OMS-009: an order\'s costs become final when it is completed', async () => {
  const db = await freshDb(); const s = await seed(db);
  const done = await mkOrder(db, { pi: 'F1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  const open = await mkOrder(db, { pi: 'F2', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  await db.query(`insert into invoices (sales_order_id, invoice_number, invoice_date) values ($1,'CI-1','2026-10-05')`, [done]);
  await db.query(`select register_customer_payment($1,'2026-10-06',1000,'B1')`, [done]);
  const before = await one<any>(db, `select * from v_order_lines where sales_order_id = $1`, [done]);
  assert.equal(before.cost_is_final, false);
  await db.query(`update sales_orders set status = 'completed' where id = $1`, [done]);
  // the cost rule changes afterwards
  await db.query(`update product_cost_rules set cost_basis = 6 where product_id = $1 and order_type = 'EXW'`, [s.fixed]);
  const a = await one<any>(db, `select * from v_order_lines where sales_order_id = $1`, [done]);
  assert.deepEqual([a.cost_is_final, num(a.unit_cost), num(a.margin)], [true, 4.56, num(before.margin)]);
  const b = await one<any>(db, `select * from v_order_lines where sales_order_id = $1`, [open]);
  assert.deepEqual([b.cost_is_final, num(b.unit_cost)], [false, 6]);                                      // open orders follow the new rule
});

test('OMS-009: the effect of a new cost rule is previewed and nothing is saved', async () => {
  const db = await freshDb(); const s = await seed(db);
  const open = await mkOrder(db, { pi: 'P1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  const done = await mkOrder(db, { pi: 'P2', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  await db.query(`insert into invoices (sales_order_id, invoice_number, invoice_date) values ($1,'CI-2','2026-10-05')`, [done]);
  await db.query(`select register_customer_payment($1,'2026-10-06',1000,'B2')`, [done]);
  await db.query(`update sales_orders set status = 'completed' where id = $1`, [done]);
  const audits = num((await one<any>(db, `select count(*) as n from audit_log`)).n);
  const p = await all<any>(db, `select * from preview_cost_rule_change($1,'EXW','2026-01-01',6,null,null)`, [s.fixed]);
  assert.equal(p.length, 1); assert.equal(p[0].pi_number, 'P1');                                            // the completed order is final: not listed
  assert.deepEqual([num(p[0].margin_before), num(p[0].margin_after)], [544, 400]);
  assert.equal(num((await one<any>(db, `select cost_basis as v from product_cost_rules where product_id = $1 and order_type = 'EXW'`, [s.fixed])).v), 4.56);
  assert.equal(num((await one<any>(db, `select count(*) as n from audit_log`)).n), audits);
  // a rule that only starts later does not touch an earlier order
  assert.equal((await all<any>(db, `select * from preview_cost_rule_change($1,'EXW','2027-01-01',6,null,null)`, [s.fixed])).length, 0);
  assert.equal(open.length > 0, true);
});

test('OMS-026: overlapping agreements for the same product, customer, type and price are refused', async () => {
  const db = await freshDb(); const s = await seed(db);
  const ins = (cust: string | null, price: number, from: string | null, to: string | null) =>
    db.query(`insert into price_agreements (product_id, customer_id, order_type, sale_price, agreed_cost, valid_from, valid_to) values ($1,$2,'EXW',$3,5,$4,$5)`, [s.fixed, cust, price, from, to]);
  await ins(s.cust, 10, '2026-01-01', '2026-06-30');
  await assert.rejects(ins(s.cust, 10, '2026-06-30', '2026-12-31'), /already covers/);       // one day overlap
  await assert.rejects(ins(s.cust, 10, null, null), /already covers/);                        // open-ended
  await ins(s.cust, 10, '2026-07-01', null);                                                  // follows directly
  await ins(s.cust, 11, '2026-01-01', null);                                                  // other price
  await ins(s.cust2, 10, '2026-01-01', null);                                                 // other customer
  await ins(null, 10, '2026-01-01', null);                                                    // standard price
  // editing an agreement does not collide with itself
  await db.query(`update price_agreements set agreed_cost = 6 where customer_id = $1 and sale_price = 10 and valid_from = '2026-01-01'`, [s.cust]);
});

test('OMS-025: MOQ only warns, it never changes the price; the choice of cost price is explained', async () => {
  const db = await freshDb(); const s = await seed(db);
  await db.query(`insert into price_agreements (product_id, customer_id, order_type, sale_price, agreed_cost, moq) values ($1,$2,'EXW',10,3,100)`, [s.fixed, s.cust]);
  const small = await mkOrder(db, { pi: 'M1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 50, price: 10 }] });
  const big = await mkOrder(db, { pi: 'M2', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  const moq = await all<any>(db, `select reference from v_attention where code = 'below_moq'`);
  assert.deepEqual(moq.map(m => m.reference), ['M1']);
  assert.equal(num((await one<any>(db, `select unit_cost as v from v_order_lines where sales_order_id = $1`, [small])).v), 3);   // price unchanged by MOQ
  assert.equal(big.length > 0, true);
  // a price one cent off the agreement falls back to the product rule, and the explanation says why
  const ex = await all<any>(db, `select * from explain_unit_cost($1,$2,'EXW',10.01,null,null,'2026-10-01')`, [s.fixed, s.cust]);
  assert.equal(ex.length, 5);
  assert.deepEqual(ex.filter(r => r.applies).map(r => r.source), ['product_rule', 'product_rule']);
  assert.match(ex.find(r => r.step === 3).detail, /Agreements exist at sale price 10\.0000.*exactly 10\.0100/);
  const hit = await all<any>(db, `select * from explain_unit_cost($1,$2,'EXW',10,null,null,'2026-10-01')`, [s.fixed, s.cust]);
  assert.equal(hit.find(r => r.step === 3).applies, true);
  assert.match(hit.find(r => r.step === 5).detail, /purchase price 3/);
});
